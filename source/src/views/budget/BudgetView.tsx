import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUDGET_SHEET_ID, budgetCurrency, loadBudget,
  type BudgetData, type BudgetLoadError, type BudgetOfficialSummary, type BudgetTabReport
} from "../../external/budget";
import { EmptyState } from "../../ui/common";
import { CircleAlert, ExternalLink, RefreshCw, Wallet } from "../../ui/icons";
import { CategoryChart, MonthChart } from "./BudgetCharts";
import { TransactionsTable } from "./BudgetTransactions";
import {
  ALL_MONTHS, categorySlices, filterByMonth, monthOptions, monthSeries, percentLabel, presentBuckets,
  previousMonthWithData, sumAmounts, NO_DATE
} from "./budgetModel";

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${BUDGET_SHEET_ID}/edit?gid=0`;

interface Loaded {
  data: BudgetData;
  tabs: BudgetTabReport[];
  failedTabs: BudgetTabReport[];
  fallbackUsed: boolean;
  official: BudgetOfficialSummary | null;
  officialError: string;
  at: Date;
}

const timeLabel = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function signedCurrency(value: number): string {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${budgetCurrency(Math.abs(value))}`;
}

export default function BudgetView() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<BudgetLoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(ALL_MONTHS);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setFailure(null);
    loadBudget(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.status === "failed") setFailure(result.error);
        else {
          setLoaded({
            data: result.data,
            tabs: result.tabs,
            failedTabs: result.status === "partial" ? result.failedTabs : [],
            fallbackUsed: result.fallbackUsed,
            official: result.official ?? null,
            officialError: result.officialError ?? "",
            at: new Date()
          });
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailure({ kind: "network", message: "Something went wrong while loading the Budget. Try again." });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const transactions = loaded?.data.transactions;
  const months = useMemo(() => monthOptions(transactions ?? []), [transactions]);
  const activeMonth = months.includes(month) ? month : ALL_MONTHS;
  const selection = useMemo(() => filterByMonth(transactions ?? [], activeMonth), [transactions, activeMonth]);
  const total = useMemo(() => sumAmounts(selection), [selection]);
  const slices = useMemo(() => categorySlices(selection), [selection]);
  const series = useMemo(() => monthSeries(transactions ?? []), [transactions]);
  const buckets = useMemo(() => presentBuckets(transactions ?? []), [transactions]);

  const datedMonths = months.filter((m) => m !== NO_DATE);
  const scope = activeMonth === ALL_MONTHS
    ? datedMonths.length > 1 ? `All months, ${datedMonths[0]} to ${datedMonths[datedMonths.length - 1]}` : "All months"
    : activeMonth;
  const previous = previousMonthWithData(months, activeMonth);
  const previousTotal = previous ? sumAmounts(filterByMonth(transactions ?? [], previous)) : null;
  const top = slices[0];

  const refreshing = loading && loaded !== null;
  const initialLoading = loading && loaded === null;
  const hasRows = selection.length > 0;

  return (
    <div className="bud" data-busy={refreshing || undefined} aria-busy={loading}>
      <div className="view-toolbar" role="toolbar" aria-label="Budget controls">
        <select
          className="select select--sm select-compact"
          aria-label="Month"
          value={activeMonth}
          disabled={!loaded || months.length === 0}
          onChange={(event) => setMonth(event.target.value)}
        >
          <option value={ALL_MONTHS}>All months</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="grow" />
        {loaded && <span className="bud-updated muted">Updated {timeLabel(loaded.at)}</span>}
        <button type="button" className="btn btn--sm" onClick={load} disabled={loading} aria-label="Refresh budget">
          {loading ? <span className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          <span>Refresh</span>
        </button>
      </div>

      <div className="view-scroll">
        <div className="bud-page">
          {initialLoading && <BudgetSkeleton />}

          {!initialLoading && !loaded && failure && (
            <EmptyState
              icon={<CircleAlert />}
              title="Couldn't load the budget"
              action={
                <div className="bud-actions">
                  <button type="button" className="btn btn--primary" onClick={load}><RefreshCw aria-hidden="true" />Retry</button>
                  <a className="btn btn--ghost" href={SHEET_URL} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Open the sheet</a>
                </div>
              }
            >
              {failure.message}
            </EmptyState>
          )}

          {loaded && (
            <>
              {loaded.failedTabs.length > 0 && (
                <div className="notice notice--info bud-notice" role="status">
                  <span>
                    {loaded.failedTabs.length === 1 ? "One sheet tab" : `${loaded.failedTabs.length} sheet tabs`} could not be read ({loaded.failedTabs.map((t) => t.name).join(", ")}),
                    so the figures below may be missing some spending. Everything else loaded.
                  </span>
                  <button type="button" className="btn btn--sm" onClick={load} disabled={loading}>Retry</button>
                </div>
              )}
              {failure && (
                <div className="notice notice--info bud-notice" role="status">
                  <span>{failure.message} Showing the data loaded at {timeLabel(loaded.at)}.</span>
                  <button type="button" className="btn btn--sm" onClick={load} disabled={loading}>Retry</button>
                </div>
              )}

              <div className="bud-body">
                <RemainingBudget official={loaded.official} error={loaded.officialError} sumOfRows={transactions ? sumAmounts(transactions) : 0} />
                <ExcludedNote data={loaded.data} />
                {!transactions?.length ? (
                  <EmptyState
                    icon={<Wallet />}
                    title="No spending recorded yet"
                    action={<a className="btn" href={SHEET_URL} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Open the sheet</a>}
                  >
                    This view reads the Budget Google Sheet. Month tabs (like AUG26) list each payment with a date, why, what and an amount. Spending appears here as soon as rows are added to a month tab.
                  </EmptyState>
                ) : (
                  <>
                    <section className="bud-hero" aria-label="Total spent">
                      <p className="bud-hero-label">Total spent <span className="muted">· {scope}</span></p>
                      <p className="bud-hero-value">{budgetCurrency(total)}</p>
                      <dl className="bud-stats">
                        <div>
                          <dt>Transactions</dt>
                          <dd>{selection.length}</dd>
                        </div>
                        {top && (
                          <div>
                            <dt>Largest category</dt>
                            <dd>{top.name} <span className="muted">{percentLabel(top.amount, total)}</span></dd>
                          </div>
                        )}
                        {activeMonth === ALL_MONTHS && datedMonths.length > 1 && (
                          <div>
                            <dt>Average per month</dt>
                            <dd>{budgetCurrency(sumAmounts(transactions.filter((t) => t.month !== NO_DATE)) / datedMonths.length)} <span className="muted">over {datedMonths.length} months</span></dd>
                          </div>
                        )}
                        {previous && previousTotal !== null && (
                          <div>
                            <dt>Compared with {previous}</dt>
                            <dd>{signedCurrency(total - previousTotal)}</dd>
                          </div>
                        )}
                      </dl>
                    </section>

                    <div className="bud-charts">
                      <section className="bud-section" aria-labelledby="bud-h-cat">
                        <h2 id="bud-h-cat">Spend by category</h2>
                        {hasRows && <CategoryChart slices={slices} total={total} scope={scope} />}
                      </section>
                      <section className="bud-section" aria-labelledby="bud-h-month">
                        <h2 id="bud-h-month">Spend per month</h2>
                        <MonthChart series={series} buckets={buckets} selected={activeMonth} />
                      </section>
                    </div>

                    <section className="bud-section" aria-labelledby="bud-h-tx">
                      <h2 id="bud-h-tx">Transactions <span className="muted">{selection.length}</span></h2>
                      <TransactionsTable transactions={selection} scope={scope} />
                    </section>
                  </>
                )}

                <SourcesPanel loaded={loaded} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The headline: what is left of the budget, as stated by the sheet's own TOTAL tab. */
function RemainingBudget({ official, error, sumOfRows }: { official: BudgetOfficialSummary | null; error: string; sumOfRows: number }) {
  if (!official || official.remaining === null) {
    return (
      <div className="notice notice--info bud-notice" role="status">
        {error
          ? `The remaining budget could not be read from the sheet's TOTAL tab (${error}). Spending below is still up to date.`
          : "The sheet has no TOTAL tab with a REMAINING BUDGET row, so the remaining budget cannot be shown."}
      </div>
    );
  }
  const spent = official.totalSpent;
  const available = official.totalAvailable;
  const share = spent !== null && available ? Math.min(100, Math.max(0, (spent / available) * 100)) : null;
  const overspent = official.remaining < 0;
  const differs = spent !== null && Math.abs(sumOfRows - spent) >= 1;
  return (
    <section className={`bud-remaining${overspent ? " is-over" : ""}`} aria-label="Remaining budget">
      <div className="bud-remaining-main">
        <p className="bud-hero-label">Remaining budget</p>
        <p className="bud-remaining-value">{budgetCurrency(official.remaining)}</p>
        {share !== null && (
          <>
            <div className="bud-remaining-bar" role="img" aria-label={`${Math.round(share)}% of the budget spent: ${budgetCurrency(spent ?? 0)} of ${budgetCurrency(available ?? 0)}`}>
              <div className="bud-remaining-fill" style={{ width: `${share}%` }} />
            </div>
            <p className="bud-remaining-caption muted">{Math.round(share)}% spent · {budgetCurrency(spent ?? 0)} of {budgetCurrency(available ?? 0)}</p>
          </>
        )}
      </div>
      <dl className="bud-stats bud-remaining-stats">
        {spent !== null && <div><dt>Total spent</dt><dd>{budgetCurrency(spent)}</dd></div>}
        {official.baseBudget !== null && <div><dt>Base budget</dt><dd>{budgetCurrency(official.baseBudget)}</dd></div>}
        {official.integration !== null && <div><dt>Integration</dt><dd>{budgetCurrency(official.integration)}</dd></div>}
        {available !== null && <div><dt>Total available</dt><dd>{budgetCurrency(available)}</dd></div>}
      </dl>
      {differs && (
        <p className="bud-remaining-note muted">
          The month tabs add up to {budgetCurrency(sumOfRows)}, while the sheet&apos;s TOTAL tab states {budgetCurrency(spent ?? 0)}. The remaining budget follows the TOTAL tab.
        </p>
      )}
    </section>
  );
}

/** Amounts the sheet marks in red (Jul–Oct 2025) are not counted; say so, and list them so nothing disappears silently. */
function ExcludedNote({ data }: { data: BudgetData }) {
  const excluded = data.excluded ?? [];
  if (data.colorsUnavailable) {
    return (
      <div className="notice notice--info bud-notice" role="status">
        The sheet could only be read without its colors this time, so amounts marked red in Jul–Oct 2025 may be counted in the figures below. The remaining budget is not affected.
      </div>
    );
  }
  if (!excluded.length) return null;
  const sum = excluded.reduce((total, item) => total + item.amount, 0);
  return (
    <details className="bud-details bud-excluded">
      <summary>
        Not counted: {excluded.length} {excluded.length === 1 ? "amount" : "amounts"} marked red in the sheet <span className="muted">· {budgetCurrency(sum)} · Jul–Oct 2025</span>
      </summary>
      <ul className="bud-tabs">
        {excluded.map((item) => (
          <li key={`${item.sheet}-${item.cell}`}>
            <b>{item.sheet}</b>
            <span>{[item.why, item.what].filter(Boolean).join(" · ") || item.category}</span>
            <span className="muted">{budgetCurrency(item.amount)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SourcesPanel({ loaded }: { loaded: Loaded }) {
  const read = loaded.tabs.filter((t) => t.status === "loaded");
  const blank = loaded.tabs.filter((t) => t.status === "empty");
  const failed = loaded.tabs.filter((t) => t.status === "error");
  const missing = loaded.tabs.filter((t) => t.status === "missing").length;
  return (
    <details className="bud-details bud-sources">
      <summary>Sources <span className="muted">{read.length} month {read.length === 1 ? "tab" : "tabs"} read</span></summary>
      <div className="bud-sources-body">
        {loaded.fallbackUsed && <p>No month tab could be read, so this shows the sheet&apos;s default tab only.</p>}
        <p className="muted">{loaded.data.title}. Read-only: this app never writes to the sheet.</p>
        {read.length > 0 && (
          <ul className="bud-tabs">
            {read.map((tab) => (
              <li key={tab.name}>
                <b>{tab.name}</b>
                <span className="muted">{tab.transactions ?? 0} {(tab.transactions ?? 0) === 1 ? "transaction" : "transactions"}</span>
              </li>
            ))}
          </ul>
        )}
        {failed.length > 0 && (
          <ul className="bud-tabs">
            {failed.map((tab) => (
              <li key={tab.name}>
                <b>{tab.name}</b>
                <span className="muted">could not be read{tab.reason ? `: ${tab.reason}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {(blank.length > 0 || missing > 0) && (
          <p className="muted">
            {blank.length > 0 && `${blank.length} ${blank.length === 1 ? "tab was" : "tabs were"} blank (${blank.map((t) => t.name).join(", ")}). `}
            {missing > 0 && `${missing} other tab names were checked and are not in the sheet.`}
          </p>
        )}
        <a href={SHEET_URL} target="_blank" rel="noopener noreferrer" className="bud-sheet-link">Open the Google Sheet <ExternalLink size={14} aria-hidden="true" /></a>
      </div>
    </details>
  );
}

function BudgetSkeleton() {
  return (
    <div className="bud-skeleton" role="status" aria-label="Loading the budget">
      <div className="skeleton" style={{ height: 14, width: 160 }} />
      <div className="skeleton" style={{ height: 56, width: 240 }} />
      <div className="bud-skeleton-rows">
        {[88, 64, 40, 24].map((w) => <div key={w} className="skeleton" style={{ height: 36, width: `${w}%` }} />)}
      </div>
      <div className="bud-skeleton-rows">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 52 }} />)}
      </div>
    </div>
  );
}
