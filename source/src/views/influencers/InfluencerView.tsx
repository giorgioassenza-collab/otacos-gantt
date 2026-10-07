import { memo, useCallback, useDeferredValue, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useBoard } from "../../store";
import { useUI } from "../../ui/uiContext";
import { useToast } from "../../ui/Toast";
import { useMenu, type MenuItem } from "../../ui/Menu";
import { usePref } from "../../lib/usePref";
import { Sheet, SheetBody } from "../../ui/Sheet";
import { SelectField } from "../../ui/fields";
import { EmptyState, Notice } from "../../ui/common";
import { ChevronDown, ExternalLink, MoreHorizontal, Pencil, Plus, Search, Trash2, Users, X } from "../../ui/icons";
import { currentDateKey, formatDateLabel } from "../../data/dates";
import {
  influencerProgressCounts,
  influencerTypeIsVisible,
  nextInfluencerSortOrder,
  setInfluencerField,
  syncInfluencerProgressTasks
} from "../../data/labels";
import { deleteInfluencerById } from "../../data/merge";
import { normalizeData, normalizeInfluencerRow } from "../../data/normalize";
import type { BoardData, Influencer, InfluencerOptionKey } from "../../data/types";
import {
  importInfluencerSeedIfNeeded,
  loadInfluencerRowsFromSheet,
  rowMatchKey,
  type InfluencerSheetRow
} from "../../external/influencerSheet";
import {
  VISIBLE_COLUMNS,
  columnLabel,
  duplicateMap,
  isOptionKey,
  optionNames,
  optionStyle,
  profileUrl,
  safeHref,
  sortedInfluencers,
  type DuplicateInfo,
  type OptionSource,
  type OptionStyle
} from "./helpers";
import type { InfluencerColumn } from "../../data/starter";

/* ------------------------------------------------------------------ small hooks */

const WIDE = "(min-width: 900px)";

function useMedia(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/* --------------------------------------------------------------------- filtering */

type FilterKey = "city" | "target" | "status" | "where";
type Filters = Record<FilterKey, string>;
const FILTERS: { key: FilterKey; all: string; label: string }[] = [
  { key: "city", all: "All cities", label: "City" },
  { key: "target", all: "All targets", label: "Target" },
  { key: "status", all: "All statuses", label: "Status" },
  { key: "where", all: "All places", label: "Where" }
];
const NO_FILTERS: Filters = { city: "all", target: "all", status: "all", where: "all" };

interface Sort { key: string; dir: "asc" | "desc" }

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/* ------------------------------------------------------------------ sheet import */

/**
 * Appends rows read from the Google Sheet. Same pipeline as the old importInfluencerSeedIfNeeded: normalize the rows,
 * drop deleted options, make sure every option exists, age CONTACTED rows (all done by normalizeData), re-sync the
 * staffing tasks. Returns how many rows were added.
 */
function appendSheetRows(draft: BoardData, rows: InfluencerSheetRow[], skipKnown: boolean): number {
  const known = new Set((draft.influencers || []).map((row) => rowMatchKey(row)));
  const wanted = skipKnown
    ? rows.filter((row) => {
        const key = rowMatchKey(row);
        if (known.has(key)) return false;
        known.add(key);
        return true;
      })
    : rows;
  if (!wanted.length) return 0;
  let sortOrder = nextInfluencerSortOrder(draft);
  const created = wanted.map((row) => normalizeInfluencerRow({ ...row, sortOrder: sortOrder++ }));
  draft.influencers = [...(draft.influencers || []), ...created];
  const normalized = normalizeData(draft);
  draft.influencers = normalized.influencers;
  draft.influencerOptions = normalized.influencerOptions;
  draft.influencerDeletedOptions = normalized.influencerDeletedOptions;
  draft.influencerTypeProgressConfig = normalized.influencerTypeProgressConfig;
  draft.influencerPreviewVisibility = normalized.influencerPreviewVisibility;
  syncInfluencerProgressTasks(draft);
  return created.length;
}

type ImportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "confirm"; rows: InfluencerSheetRow[]; known: number }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

/* ------------------------------------------------------------------------- view */

export default function InfluencerView() {
  const { state, data, mutate, sync } = useBoard();
  const ui = useUI();
  const toast = useToast();
  const menu = useMenu();
  const wide = useMedia(WIDE);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stripOpen, setStripOpen] = usePref<boolean>("otw2.inf.strip", true);
  const [cardLimit, setCardLimit] = useState(80);
  const [imp, setImp] = useState<ImportState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const dataRef = useRef(data);
  dataRef.current = data;
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const menuRef = useRef(menu);
  menuRef.current = menu;

  /* ------------------------------------------------------------ derived lists */
  const ordered = useMemo(() => sortedInfluencers(data.influencers), [data.influencers]);
  const rowNumbers = useMemo(() => new Map(ordered.map((row, index) => [row.id, index + 1])), [ordered]);
  const duplicates = useMemo(() => duplicateMap(ordered), [ordered]);
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    ordered.forEach((row) => map.set(row.id, VISIBLE_COLUMNS.map((column) => String(row[column.key] ?? "")).join(" ").toLowerCase()));
    return map;
  }, [ordered]);

  const filterValues = useMemo(() => {
    const result = {} as Record<FilterKey, string[]>;
    FILTERS.forEach(({ key }) => {
      const values = [...new Set(ordered.map((row) => row[key]).filter(Boolean))].sort(compareText);
      if (filters[key] !== "all" && !values.includes(filters[key])) values.push(filters[key]);
      result[key] = values;
    });
    return result;
  }, [ordered, filters]);

  const needle = deferredQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    const rows = ordered.filter((row) => {
      if (needle && !haystacks.get(row.id)?.includes(needle)) return false;
      return FILTERS.every(({ key }) => filters[key] === "all" || row[key] === filters[key]);
    });
    if (!sort) return rows;
    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = String(a[key] ?? "");
      const right = String(b[key] ?? "");
      if (!left && !right) return 0;
      if (!left) return 1;
      if (!right) return -1;
      return compareText(left, right) * factor;
    });
  }, [ordered, haystacks, needle, filters, sort]);

  const activeFilters = FILTERS.filter(({ key }) => filters[key] !== "all").length;
  const anyActive = activeFilters > 0 || query.trim() !== "";
  const stale = query !== deferredQuery;

  const styleFor = useMemo(() => {
    const source: OptionSource = { projects: data.projects, influencerOptions: data.influencerOptions };
    const cache = new Map<string, OptionStyle>();
    return (key: InfluencerOptionKey, value: string): OptionStyle => {
      const id = `${key}\u0000${value}`;
      let found = cache.get(id);
      if (!found) {
        found = optionStyle(source, key, value);
        cache.set(id, found);
      }
      return found;
    };
  }, [data.projects, data.influencerOptions]);

  const labels = useMemo(() => {
    const result: Record<string, string> = {};
    VISIBLE_COLUMNS.forEach((column) => { result[column.key] = columnLabel(data, column); });
    return result;
  }, [data]);

  /* ------------------------------------------------------------------ writes */
  const fail = useCallback((error: unknown) => {
    toast.show(error instanceof Error && error.message ? error.message : "The change could not be saved.", { error: true });
  }, [toast]);

  const applyOption = useCallback((id: string, key: InfluencerOptionKey, value: string) => {
    mutate((draft) => setInfluencerField(draft, id, key, value)).catch(fail);
  }, [mutate, fail]);

  const removeRow = useCallback((id: string) => {
    mutate((draft) => {
      deleteInfluencerById(draft, id);
      syncInfluencerProgressTasks(draft);
    }).catch(fail);
    toast.show("Influencer deleted", { action: { label: "Undo", run: () => void sync.undo() } });
  }, [mutate, fail, toast, sync]);

  const openEditor = useCallback((id: string) => uiRef.current.open({ kind: "influencer", id }), []);

  const pickOption = useCallback((anchor: DOMRect, id: string, key: InfluencerOptionKey) => {
    const board = dataRef.current;
    const row = board.influencers.find((item) => item.id === id);
    if (!row) return;
    const current = row[key] || "";
    const names = optionNames(board, key, current);
    if (!names.length) {
      toast.show(`There are no ${key} options yet. Add some in Settings.`, {
        action: { label: "Open settings", run: () => uiRef.current.open({ kind: "settings", section: "influencers" }) }
      });
      return;
    }
    const source: OptionSource = { projects: board.projects, influencerOptions: board.influencerOptions };
    const items: MenuItem[] = [
      { key: "__none", label: <span className="muted">None</span>, checked: !current, onSelect: () => { if (current) applyOption(id, key, ""); } },
      { key: "__divider", label: "", divider: true, onSelect: () => {} },
      ...names.map((name): MenuItem => ({
        key: name,
        checked: name === current,
        label: (<><span className="inf-swatch" style={{ background: optionStyle(source, key, name).background }} aria-hidden="true" />{name}</>),
        onSelect: () => { if (name !== current) applyOption(id, key, name); }
      }))
    ];
    menuRef.current.open(anchor, items, `Change ${key}`);
  }, [applyOption, toast]);

  const openRowMenu = useCallback((anchor: DOMRect | { x: number; y: number }, id: string) => {
    const items: MenuItem[] = [
      { key: "edit", label: <><Pencil size={16} aria-hidden />Edit</>, onSelect: () => openEditor(id) },
      { key: "gantt", label: <><Plus size={16} aria-hidden />Add to Gantt</>, onSelect: () => uiRef.current.open({ kind: "influencerToGantt", influencerId: id }) },
      { key: "__divider", label: "", divider: true, onSelect: () => {} },
      { key: "delete", label: <><Trash2 size={16} aria-hidden />Delete</>, danger: true, onSelect: () => removeRow(id) }
    ];
    menuRef.current.open(anchor, items, "Influencer actions");
  }, [openEditor, removeRow]);

  /* ------------------------------------------------------------------ import */
  const startImport = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setImp({ kind: "loading" });
    const existing = dataRef.current.influencers.length;
    if (existing === 0) {
      let added = 0;
      const result = await importInfluencerSeedIfNeeded({
        existingCount: 0,
        signal: controller.signal,
        save: async (rows) => { await mutate((draft) => { added = appendSheetRows(draft, rows, false); }); }
      });
      if (controller.signal.aborted) return;
      if (result.status === "imported") {
        setImp({ kind: "idle" });
        toast.show(`Imported ${added || result.count} influencers from the Google Sheet`, { action: { label: "Undo", run: () => void sync.undo() } });
      } else if (result.status === "empty") {
        setImp({ kind: "info", message: `${result.reason} Check that the sheet has a header row with a NAME column.` });
      } else if (result.status === "failed") {
        setImp({ kind: "error", message: result.error.message });
      } else {
        setImp({ kind: "idle" });
      }
      return;
    }
    const result = await loadInfluencerRowsFromSheet({ signal: controller.signal });
    if (controller.signal.aborted) return;
    if (result.status === "failed") {
      setImp({ kind: "error", message: result.error.message });
    } else if (result.status === "empty") {
      setImp({ kind: "info", message: `${result.reason} Check that the sheet has a header row with a NAME column.` });
    } else {
      const known = new Set(dataRef.current.influencers.map((row) => rowMatchKey(row)));
      const fresh = result.rows.filter((row) => !known.has(rowMatchKey(row)));
      if (!fresh.length) setImp({ kind: "info", message: `The sheet has ${result.rows.length} influencers and all of them are already on the board.` });
      else setImp({ kind: "confirm", rows: fresh, known: result.rows.length - fresh.length });
    }
  }, [mutate, sync, toast]);

  const confirmImport = useCallback(async (rows: InfluencerSheetRow[]) => {
    setImp({ kind: "idle" });
    let added = 0;
    try {
      await mutate((draft) => { added = appendSheetRows(draft, rows, true); });
      toast.show(added ? `Added ${added} influencers from the Google Sheet` : "Nothing new to add", added ? { action: { label: "Undo", run: () => void sync.undo() } } : undefined);
    } catch (error) {
      setImp({ kind: "error", message: error instanceof Error && error.message ? error.message : "Saving the imported influencers failed." });
    }
  }, [mutate, sync, toast]);

  const cancelImport = useCallback(() => {
    abortRef.current?.abort();
    setImp({ kind: "idle" });
  }, []);

  /* ------------------------------------------------------------------- UI bits */
  const clearFilters = () => { setQuery(""); setFilters(NO_FILTERS); setCardLimit(80); };
  const setFilter = (key: FilterKey, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setCardLimit(80); };
  const cycleSort = useCallback((key: string) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }, []);

  const newInfluencer = () => ui.open({ kind: "influencer" });
  const total = data.influencers.length;
  const loading = !state.ready;

  const selects = FILTERS.map(({ key, all, label }) => (
    <select
      key={key}
      className="select select--sm select-compact"
      aria-label={`Filter by ${label.toLowerCase()}`}
      value={filters[key]}
      onChange={(event) => setFilter(key, event.target.value)}
    >
      <option value="all">{all}</option>
      {filterValues[key].map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
  ));

  return (
    <div className="inf">
      <div className="view-toolbar inf-toolbar" role="toolbar" aria-label="Influencer controls">
        <div className="inf-search">
          <Search aria-hidden />
          <input
            type="search"
            className="input input--sm"
            aria-label="Search influencers"
            placeholder="Search name, profile, status"
            value={query}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => { setQuery(event.target.value); setCardLimit(80); }}
          />
        </div>
        {wide ? selects : (
          <button type="button" className="btn btn--sm inf-filter-btn" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
            <SlidersHorizontal aria-hidden />
            Filters
            {activeFilters > 0 && <span className="inf-count-badge" aria-label={`${activeFilters} active`}>{activeFilters}</span>}
          </button>
        )}
        {wide && anyActive && <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}><X aria-hidden />Clear filters{activeFilters > 0 ? ` (${activeFilters})` : ""}</button>}
        <span className="grow" />
        <button type="button" className="btn btn--sm inf-import-btn" onClick={() => void startImport()} disabled={imp.kind === "loading"} aria-label="Import from Google Sheet" title="Import from Google Sheet">
          <FileSpreadsheet aria-hidden />
          <span className="inf-btn-label">Import from Google Sheet</span>
        </button>
        <button type="button" className="btn btn--primary new-btn" onClick={newInfluencer} aria-label="New influencer"><Plus /><span className="new-label">New influencer</span></button>
      </div>

      <div className="view-scroll" aria-busy={loading}>
        {state.readOnly && <div className="inf-pad"><Notice>The board is open in read-only mode. Changes to influencers are not saved.</Notice></div>}

        <ImportPanel state={imp} onConfirm={confirmImport} onCancel={cancelImport} onRetry={() => void startImport()} onDismiss={() => setImp({ kind: "idle" })} />

        {loading ? (
          state.isError ? (
            <div className="inf-pad"><Notice tone="error">{state.message || "The board could not be loaded."} The influencer list appears as soon as the board is reachable. Check your connection and reload.</Notice></div>
          ) : (
            <div className="inf-pad inf-skeletons" role="status" aria-label="Loading influencers">
              {Array.from({ length: 7 }, (_, index) => <div key={index} className="skeleton inf-skeleton" />)}
            </div>
          )
        ) : (
          <>
            <ProgressStrip data={data} open={stripOpen} onToggle={() => setStripOpen(!stripOpen)} />

            {total === 0 ? (
              <EmptyState
                icon={<Users />}
                title="No influencers yet"
                action={
                  <div className="inf-empty-actions">
                    <button type="button" className="btn btn--primary" onClick={newInfluencer}><Plus />Add influencer</button>
                    <button type="button" className="btn" onClick={() => void startImport()} disabled={imp.kind === "loading"}><FileSpreadsheet />Import from Google Sheet</button>
                  </div>
                }
              >
                Keep every creator you talk to in one list: profiles, price, status and where they will shoot. Add them one by one, or import the team's Google Sheet.
              </EmptyState>
            ) : (
              <>
                <p className="inf-results" role="status" aria-live="polite">
                  {filtered.length === total ? `${total} influencers` : `Showing ${filtered.length} of ${total} influencers`}
                </p>
                {filtered.length === 0 ? (
                  <EmptyState
                    icon={<Search />}
                    title="No influencers match"
                    action={<button type="button" className="btn" onClick={clearFilters}><X />Clear filters</button>}
                  >
                    Nothing in the list fits the current search and filters. Clear them to see everyone.
                  </EmptyState>
                ) : wide ? (
                  <InfluencerTable
                    rows={filtered}
                    rowNumbers={rowNumbers}
                    duplicates={duplicates}
                    labels={labels}
                    styleFor={styleFor}
                    sort={sort}
                    stale={stale}
                    onSort={cycleSort}
                    onOpen={openEditor}
                    onPick={pickOption}
                    onRowMenu={openRowMenu}
                  />
                ) : (
                  <>
                    <ul className={`inf-cards${stale ? " is-stale" : ""}`} aria-label="Influencers">
                      {filtered.slice(0, cardLimit).map((row) => (
                        <InfluencerCard key={row.id} row={row} duplicate={duplicates.get(row.id)} styleFor={styleFor} onOpen={openEditor} onPick={pickOption} />
                      ))}
                    </ul>
                    {filtered.length > cardLimit && (
                      <div className="inf-more">
                        <button type="button" className="btn" onClick={() => setCardLimit((limit) => limit + 80)}>Show {Math.min(80, filtered.length - cardLimit)} more</button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {menu.element}

      {filtersOpen && !wide && (
        <Sheet
          title="Filters"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={clearFilters} disabled={!anyActive}>Clear filters</button>
              <span className="spacer" />
              <button type="button" className="btn btn--primary" onClick={() => setFiltersOpen(false)}>Show {filtered.length} {filtered.length === 1 ? "result" : "results"}</button>
            </>
          }
        >
          <SheetBody>
            {FILTERS.map(({ key, all, label }) => (
              <SelectField
                key={key}
                label={label}
                value={filters[key]}
                onChange={(event) => setFilter(key, event.target.value)}
                options={[{ value: "all", label: all }, ...filterValues[key].map((value) => ({ value, label: value }))]}
              />
            ))}
          </SheetBody>
        </Sheet>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- import panel */

function ImportPanel({ state, onConfirm, onCancel, onRetry, onDismiss }: {
  state: ImportState;
  onConfirm: (rows: InfluencerSheetRow[]) => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return (
      <div className="inf-pad">
        <div className="inf-import" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="inf-import-text">Reading the influencer sheet from Google Sheets...</span>
          <button type="button" className="btn btn--sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }
  if (state.kind === "confirm") {
    const count = state.rows.length;
    return (
      <div className="inf-pad">
        <div className="inf-import" role="status">
          <span className="inf-import-text">
            The sheet has {count} {count === 1 ? "influencer" : "influencers"} that {count === 1 ? "is" : "are"} not on the board yet
            {state.known > 0 ? ` (${state.known} already here)` : ""}. They are added at the bottom of the list.
          </span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => onConfirm(state.rows)}>Add {count}</button>
          <button type="button" className="btn btn--sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }
  if (state.kind === "info") {
    return (
      <div className="inf-pad">
        <div className="inf-import" role="status">
          <span className="inf-import-text">{state.message}</span>
          <button type="button" className="btn btn--sm" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    );
  }
  return (
    <div className="inf-pad">
      <div className="inf-import inf-import--error" role="alert">
        <span className="inf-import-text">Import failed. {state.message}</span>
        <button type="button" className="btn btn--sm" onClick={onRetry}>Try again</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- staffing strip */

function ProgressStrip({ data, open, onToggle }: { data: BoardData; open: boolean; onToggle: () => void }) {
  const today = currentDateKey();
  const items = useMemo(() => (data.influencerOptions?.type || [])
    .filter((type) => influencerTypeIsVisible(type, data))
    .map((type) => {
      const counts = influencerProgressCounts(data, type);
      const needed = Math.max(0, Number(type.needed) || 0);
      return { type, needed, ...counts };
    }), [data]);
  if (!items.length) return null;
  const booked = items.reduce((sum, item) => sum + item.confirmed, 0);
  const needed = items.reduce((sum, item) => sum + item.needed, 0);
  const contacted = items.reduce((sum, item) => sum + item.contacted, 0);
  return (
    <section className="inf-strip" aria-label="Staffing progress">
      <button type="button" className="inf-strip-head" aria-expanded={open} aria-controls="inf-strip-list" onClick={onToggle}>
        <span className="inf-strip-title">Staffing</span>
        <span className="inf-strip-sum">{needed > 0 ? `${booked}/${needed} booked` : `${booked} booked`} · {contacted} contacted</span>
        <ChevronDown className="inf-strip-chevron" aria-hidden />
      </button>
      {open && (
        <ul className="inf-strip-list" id="inf-strip-list">
          {items.map(({ type, needed: target, assigned, confirmed, contacted: reached }) => {
            const bookedPct = target ? Math.min(100, (confirmed / target) * 100) : 0;
            const contactedPct = target ? Math.min(100 - bookedPct, (reached / target) * 100) : 0;
            const late = Boolean(type.deadline) && type.deadline! < today && (target === 0 || confirmed < target);
            return (
              <li key={type.name} className="inf-prog">
                <span className="inf-prog-name">{type.name}</span>
                <span
                  className="inf-prog-bar"
                  role="img"
                  aria-label={target ? `${confirmed} of ${target} booked, ${reached} contacted` : `${confirmed} booked, ${reached} contacted, no target set`}
                >
                  <i className="is-booked" style={{ width: `${bookedPct}%` }} />
                  <i className="is-contacted" style={{ width: `${contactedPct}%` }} />
                </span>
                <span className="inf-prog-ratio">{confirmed}/{target || "-"}</span>
                <span className="inf-prog-meta">{reached} contacted · {assigned} assigned</span>
                <span className="inf-prog-deadline" data-late={late}>{type.deadline ? `Deadline ${formatDateLabel(type.deadline)}` : "No deadline"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- the table */

type StyleFor = (key: InfluencerOptionKey, value: string) => OptionStyle;
type PickOption = (anchor: DOMRect, id: string, key: InfluencerOptionKey) => void;

function ProfileLink({ platform, row, className, button }: { platform: "tt" | "ig"; row: Influencer; className?: string; button?: boolean }) {
  const value = (platform === "tt" ? row.ttProfile : row.igProfile) || "";
  const stored = platform === "tt" ? row.ttLink : row.igLink;
  const href = safeHref(profileUrl(platform, value, row));
  if (!value && !stored) return null;
  const network = platform === "tt" ? "TikTok" : "Instagram";
  if (!href) return <span className={className}>{value}</span>;
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${network} profile ${value || row.name} (opens in a new tab)`}
      title={value || undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {button ? <><ExternalLink aria-hidden />{network}</> : (value || network)}
    </a>
  );
}

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  if (dir === "asc") return <ArrowUp aria-hidden />;
  if (dir === "desc") return <ArrowDown aria-hidden />;
  return <ArrowUpDown aria-hidden className="inf-sort-idle" />;
}

function InfluencerTable({ rows, rowNumbers, duplicates, labels, styleFor, sort, stale, onSort, onOpen, onPick, onRowMenu }: {
  rows: Influencer[];
  rowNumbers: Map<string, number>;
  duplicates: Map<string, DuplicateInfo>;
  labels: Record<string, string>;
  styleFor: StyleFor;
  sort: Sort | null;
  stale: boolean;
  onSort: (key: string) => void;
  onOpen: (id: string) => void;
  onPick: PickOption;
  onRowMenu: (anchor: DOMRect | { x: number; y: number }, id: string) => void;
}) {
  return (
    <table className={`inf-table${stale ? " is-stale" : ""}`}>
      <caption className="sr-only">Influencers. Select a row to edit it, or a colored cell to change its value.</caption>
      <thead>
        <tr>
          <th scope="col" className="inf-th-num"><span className="sr-only">Row number</span><span aria-hidden="true">#</span></th>
          {VISIBLE_COLUMNS.map((column) => {
            const dir = sort?.key === column.key ? sort.dir : null;
            return (
              <th
                key={column.key}
                scope="col"
                className={column.key === "name" ? "inf-th-name" : undefined}
                aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
              >
                <button type="button" className="inf-th-btn" onClick={() => onSort(column.key)} title={`Sort by ${labels[column.key]}`}>
                  {labels[column.key]}
                  <SortIcon dir={dir} />
                </button>
              </th>
            );
          })}
          <th scope="col" className="inf-th-actions"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <InfluencerRow
            key={row.id}
            row={row}
            num={rowNumbers.get(row.id) ?? 0}
            duplicate={duplicates.get(row.id)}
            labels={labels}
            styleFor={styleFor}
            onOpen={onOpen}
            onPick={onPick}
            onRowMenu={onRowMenu}
          />
        ))}
      </tbody>
    </table>
  );
}

const InfluencerRow = memo(function InfluencerRow({ row, num, duplicate, labels, styleFor, onOpen, onPick, onRowMenu }: {
  row: Influencer;
  num: number;
  duplicate: DuplicateInfo | undefined;
  labels: Record<string, string>;
  styleFor: StyleFor;
  onOpen: (id: string) => void;
  onPick: PickOption;
  onRowMenu: (anchor: DOMRect | { x: number; y: number }, id: string) => void;
}) {
  return (
    <tr
      className={`inf-row${duplicate ? " is-dup" : ""}`}
      onClick={() => onOpen(row.id)}
      onContextMenu={(event) => { event.preventDefault(); onRowMenu({ x: event.clientX, y: event.clientY }, row.id); }}
    >
      <td className="inf-num">{num}</td>
      {VISIBLE_COLUMNS.map((column) => (
        <Cell key={column.key} row={row} column={column} label={labels[column.key]} duplicate={duplicate} styleFor={styleFor} onOpen={onOpen} onPick={onPick} />
      ))}
      <td className="inf-actions">
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          aria-label={`Actions for ${row.name || "influencer"}`}
          aria-haspopup="menu"
          onClick={(event) => { event.stopPropagation(); onRowMenu(event.currentTarget.getBoundingClientRect(), row.id); }}
        >
          <MoreHorizontal />
        </button>
      </td>
    </tr>
  );
});

function Cell({ row, column, label, duplicate, styleFor, onOpen, onPick }: {
  row: Influencer;
  column: InfluencerColumn;
  label: string;
  duplicate: DuplicateInfo | undefined;
  styleFor: StyleFor;
  onOpen: (id: string) => void;
  onPick: PickOption;
}) {
  const key = column.key;
  const value = String(row[key] ?? "");

  if (key === "name") {
    return (
      <th scope="row" className="inf-name">
        <button type="button" className="inf-name-btn" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }} aria-label={`Edit ${value || "influencer"}`}>
          {value || "Unnamed"}
        </button>
        {duplicate && (
          <span className="inf-dup" title={`This user may already be present at row ${duplicate.rowNumber}`}>
            <TriangleAlert aria-hidden />
            Possible duplicate of #{duplicate.rowNumber}
          </span>
        )}
      </th>
    );
  }

  if (isOptionKey(key)) {
    return (
      <td
        className="inf-opt-cell"
        onClick={(event: MouseEvent<HTMLTableCellElement>) => { event.stopPropagation(); onPick(event.currentTarget.getBoundingClientRect(), row.id, key); }}
      >
        {value ? (
          <button type="button" className="inf-chip" style={styleFor(key, value)} aria-haspopup="menu" aria-label={`${label}: ${value}. Change`}>{value}</button>
        ) : (
          <button type="button" className="inf-chip inf-chip--empty" aria-haspopup="menu" aria-label={`Set ${label.toLowerCase()}`}>-</button>
        )}
      </td>
    );
  }

  if (key === "ttProfile" || key === "igProfile") {
    return <td className="inf-text"><ProfileLink platform={key === "ttProfile" ? "tt" : "ig"} row={row} className="inf-profile" /></td>;
  }

  if (key === "price") return <td className="inf-text inf-price">{value}</td>;
  return <td className="inf-text" title={value.length > 40 ? value : undefined}><span className="inf-clamp">{value}</span></td>;
}

/* --------------------------------------------------------------------- phone card */

const InfluencerCard = memo(function InfluencerCard({ row, duplicate, styleFor, onOpen, onPick }: {
  row: Influencer;
  duplicate: DuplicateInfo | undefined;
  styleFor: StyleFor;
  onOpen: (id: string) => void;
  onPick: PickOption;
}) {
  const chips: { key: InfluencerOptionKey; value: string }[] = (["type", "city", "target", "where", "when"] as InfluencerOptionKey[])
    .map((key) => ({ key, value: row[key] || "" }))
    .filter((chip) => chip.value);
  const hasLinks = Boolean(row.ttProfile || row.ttLink || row.igProfile || row.igLink);
  const statusStyle: CSSProperties | undefined = row.status ? styleFor("status", row.status) : undefined;
  return (
    <li className="inf-card">
      <div className="inf-card-top">
        <button type="button" className="inf-card-name" onClick={() => onOpen(row.id)}>
          {row.name || "Unnamed"}
          <span className="sr-only">. Edit influencer</span>
        </button>
        <button
          type="button"
          className={`chip inf-card-status${row.status ? "" : " is-empty"}`}
          style={statusStyle}
          aria-haspopup="menu"
          aria-label={row.status ? `Status: ${row.status}. Change status` : "Set status"}
          onClick={(event) => onPick(event.currentTarget.getBoundingClientRect(), row.id, "status")}
        >
          {row.status || "Set status"}
        </button>
      </div>
      {duplicate && (
        <p className="inf-dup" title={`This user may already be present at row ${duplicate.rowNumber}`}>
          <TriangleAlert aria-hidden />
          Possible duplicate of #{duplicate.rowNumber}
        </p>
      )}
      {chips.length > 0 && (
        <div className="inf-card-chips">
          {chips.map((chip) => <span key={chip.key} className="chip" style={styleFor(chip.key, chip.value)}>{chip.value}</span>)}
        </div>
      )}
      {(row.price || row.output) && (
        <p className="inf-card-meta">
          {row.price && <b>{row.price}</b>}
          {row.output && <span>{row.output}</span>}
        </p>
      )}
      {hasLinks && (
        <div className="inf-card-links">
          <ProfileLink platform="tt" row={row} className="btn btn--sm inf-link" button />
          <ProfileLink platform="ig" row={row} className="btn btn--sm inf-link" button />
        </div>
      )}
    </li>
  );
});
