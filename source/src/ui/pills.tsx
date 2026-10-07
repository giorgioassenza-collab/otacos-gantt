import type { ReactNode } from "react";

export interface PillOption { value: string; label: ReactNode; color?: string }

/** Single choice shown as tappable pills (project, status, format...). Easier than a select on a phone. */
export function PillRadio({ label, options, value, onChange, allowEmpty }: { label: string; options: PillOption[]; value: string; onChange: (value: string) => void; allowEmpty?: boolean }) {
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="pills">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              className="pill"
              onClick={() => onChange(allowEmpty && on ? "" : option.value)}
            >
              {option.color && <span className="chip-dot" style={{ color: option.color }} />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
