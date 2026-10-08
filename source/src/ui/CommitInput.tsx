import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/** Text input that keeps its own draft and only reports the value on blur or Enter (one save per edit, not per keystroke). */
export function CommitInput({ value, onCommit, ...props }: { value: string; onCommit: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  const committed = useRef<string | null>(null);
  const commit = () => {
    const clean = draft.trim();
    if (!clean) { setDraft(value); return; }
    if (clean !== value) { committed.current = clean; onCommit(clean); }
  };
  // On a phone, closing a panel or switching view does not always blur the field first: what was typed is saved then too.
  useEffect(() => () => {
    const { draft: typed, value: saved, onCommit: save } = latest.current;
    const clean = typed.trim();
    if (clean && clean !== saved && clean !== committed.current) save(clean);
  }, []);
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
        if (event.key === "Escape") { setDraft(value); (event.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

/** Color input that previews while you drag and saves once, when the picker closes. */
export function CommitColor({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label: string }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value) ? value : "#6b7280";
  const [draft, setDraft] = useState(valid);
  useEffect(() => setDraft(valid), [valid]);
  return (
    <input
      className="color-input"
      type="color"
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { if (draft !== valid) onCommit(draft); }}
    />
  );
}
