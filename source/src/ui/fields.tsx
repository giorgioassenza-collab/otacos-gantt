import { useId, type ChangeEvent, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldProps { label: string; hint?: string; children: (id: string) => ReactNode; className?: string }

export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={`field${className ? " " + className : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, className, ...props }: { label: string; hint?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} hint={hint} className={className}>{(id) => <input id={id} className="input" {...props} />}</Field>;
}

export function TextAreaField({ label, hint, className, ...props }: { label: string; hint?: string; className?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} hint={hint} className={className}>{(id) => <textarea id={id} className="textarea" {...props} />}</Field>;
}

export interface Option { value: string; label?: string }

export function SelectField({ label, hint, options, className, placeholder, ...props }: { label: string; hint?: string; options: (string | Option)[]; className?: string; placeholder?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <select id={id} className="select" {...props}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const text = typeof option === "string" ? option : option.label ?? option.value;
            return <option key={value} value={value}>{text}</option>;
          })}
        </select>
      )}
    </Field>
  );
}

export function CheckField({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Toggle chips for picking several people / socials. */
export function MultiPick({ label, options, value, onChange, empty }: { label: string; options: { value: string; label: string; color?: string }[]; value: string[]; onChange: (next: string[]) => void; empty?: string }) {
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((v) => v !== item) : [...value, item]);
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="field-label">{label}</span>
      {options.length === 0 ? (
        <p className="field-hint">{empty ?? "Nothing to pick yet."}</p>
      ) : (
        <div className="multipick">
          {options.map((option) => {
            const on = value.includes(option.value);
            return (
              <button key={option.value} type="button" className="multipick-item" aria-pressed={on} onClick={() => toggle(option.value)}>
                {option.color && <span className="chip-dot" style={{ color: option.color }} />}
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
