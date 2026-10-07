import type { ReactNode } from "react";
import { budgetCurrency } from "../../external/budget";
import { categoryColor, percentLabel, type MonthPoint, type Slice } from "./budgetModel";
import { useChartTip } from "./ChartTip";

interface TipRow {
  name: string;
  color: string;
  amount: number;
  strong?: boolean;
}

function TipBody({ title, rows, footer }: { title: string; rows: TipRow[]; footer?: ReactNode }) {
  return (
    <>
      <div className="bud-tip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.name} className={`bud-tip-row${row.strong ? " is-strong" : ""}`}>
          <i style={{ background: row.color }} aria-hidden="true" />
          <b>{budgetCurrency(row.amount)}</b>
          <span>{row.name}</span>
        </div>
      ))}
      {footer && <div className="bud-tip-foot">{footer}</div>}
    </>
  );
}

function barWidth(amount: number, max: number): string {
  if (amount <= 0 || max <= 0) return "0%";
  return `${Math.max(1.5, (amount / max) * 100)}%`;
}

/** Spend by category: one horizontal bar per category, named and valued directly. Identity is never color alone. */
export function CategoryChart({ slices, total, scope }: { slices: Slice[]; total: number; scope: string }) {
  const { bind, node } = useChartTip();
  const max = Math.max(0, ...slices.map((s) => s.amount));
  const summary = `Spend by category, ${scope}: ${slices.map((s) => `${s.name} ${budgetCurrency(s.amount)}, ${percentLabel(s.amount, total)}`).join("; ")}.`;
  return (
    <figure className="bud-figure">
      <div className="bud-cats" role="img" aria-label={summary}>
        {slices.map((slice) => {
          const share = percentLabel(slice.amount, total);
          return (
            <div
              key={slice.name}
              className="bud-cat"
              {...bind(
                <TipBody
                  title={slice.name}
                  rows={[{ name: `${share} of spend`, color: categoryColor(slice.name), amount: slice.amount, strong: true }]}
                  footer={`${slice.count} ${slice.count === 1 ? "transaction" : "transactions"}`}
                />
              )}
            >
              <div className="bud-cat-head">
                <span className="bud-cat-name">{slice.name}</span>
                <span className="bud-cat-val">
                  <b>{budgetCurrency(slice.amount)}</b>
                  <span>{share}</span>
                </span>
              </div>
              <div className="bud-cat-bar" aria-hidden="true">
                <i style={{ width: barWidth(slice.amount, max), background: categoryColor(slice.name) }} />
              </div>
            </div>
          );
        })}
      </div>
      {node}
    </figure>
  );
}

/** Spend per month, stacked by category. Every month stays visible; the selected month is emphasised. */
export function MonthChart({ series, buckets, selected }: { series: MonthPoint[]; buckets: string[]; selected: string }) {
  const { bind, node } = useChartTip();
  const max = Math.max(0, ...series.map((m) => m.total));
  const summary = `Spend per month, stacked by category: ${series.map((m) => `${m.month} ${budgetCurrency(m.total)}`).join("; ")}.`;
  return (
    <figure className="bud-figure">
      <ul className="bud-legend" aria-label="Categories">
        {buckets.map((name) => (
          <li key={name}>
            <i style={{ background: categoryColor(name) }} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
      <div className="bud-months" role="img" aria-label={summary}>
        {series.map((month) => {
          const dim = selected !== "all" && selected !== month.month;
          return (
            <div
              key={month.month}
              className="bud-month"
              data-dim={dim || undefined}
              data-selected={selected === month.month || undefined}
              {...bind(
                <TipBody
                  title={month.month}
                  rows={month.parts.map((p) => ({ name: p.name, color: categoryColor(p.name), amount: p.amount }))}
                  footer={<><b>{budgetCurrency(month.total)}</b> total, {month.count} {month.count === 1 ? "transaction" : "transactions"}</>}
                />
              )}
            >
              <span className="bud-month-name">{month.month}</span>
              <div className="bud-month-track" aria-hidden="true">
                <div className="bud-stack" style={{ width: barWidth(month.total, max) }}>
                  {month.parts.filter((p) => p.amount > 0).map((part) => (
                    <i key={part.name} style={{ flexGrow: part.amount, background: categoryColor(part.name) }} />
                  ))}
                </div>
              </div>
              <b className="bud-month-total">{budgetCurrency(month.total)}</b>
            </div>
          );
        })}
      </div>
      {node}
      <details className="bud-details">
        <summary>Table view</summary>
        <div className="bud-scroll">
          <table className="bud-matrix">
            <caption className="sr-only">Spend per month by category, in euros</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                {buckets.map((name) => <th scope="col" key={name} className="num">{name}</th>)}
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {series.map((month) => (
                <tr key={month.month}>
                  <th scope="row">{month.month}</th>
                  {buckets.map((name) => {
                    const part = month.parts.find((p) => p.name === name);
                    return <td key={name} className="num">{part ? budgetCurrency(part.amount) : "–"}</td>;
                  })}
                  <td className="num"><b>{budgetCurrency(month.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
