import { useEffect, useMemo, useState } from "react";
import { budgetCurrency, type BudgetTransaction } from "../../external/budget";
import { ChevronDown } from "../../ui/icons";
import { categoryBucket, categoryColor, categoryLabel, formatTransactionDate, sortTransactions, type SortKey } from "./budgetModel";

const PAGE = 50;

const SORT_LABELS: Record<SortKey, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "amount-desc": "Largest first",
  "amount-asc": "Smallest first"
};

function CategoryTag({ raw }: { raw: string }) {
  return (
    <span className="bud-cattag">
      <i style={{ background: categoryColor(categoryBucket(raw)) }} aria-hidden="true" />
      {categoryLabel(raw)}
    </span>
  );
}

const dash = (value: string) => value || "–";

export function TransactionsTable({ transactions, scope }: { transactions: BudgetTransaction[]; scope: string }) {
  const [sort, setSort] = useState<SortKey>("date-desc");
  const [limit, setLimit] = useState(PAGE);
  const sorted = useMemo(() => sortTransactions(transactions, sort), [transactions, sort]);
  useEffect(() => setLimit(PAGE), [transactions, sort]);
  const shown = sorted.slice(0, limit);

  const dateDir = sort.startsWith("date") ? (sort.endsWith("desc") ? "descending" : "ascending") : "none";
  const amountDir = sort.startsWith("amount") ? (sort.endsWith("desc") ? "descending" : "ascending") : "none";
  const toggleDate = () => setSort(sort === "date-desc" ? "date-asc" : "date-desc");
  const toggleAmount = () => setSort(sort === "amount-desc" ? "amount-asc" : "amount-desc");

  return (
    <div className="bud-tx-wrap">
      <div className="bud-tx-tools">
        <label className="bud-sort-select">
          <span className="sr-only">Sort transactions</span>
          <select className="select select--sm" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
          </select>
        </label>
      </div>

      <table className="bud-table">
        <caption className="sr-only">Transactions, {scope}</caption>
        <thead>
          <tr>
            <th scope="col" aria-sort={dateDir}>
              <button type="button" className="bud-sort" data-dir={dateDir} onClick={toggleDate}>Date<ChevronDown size={14} aria-hidden="true" /></button>
            </th>
            <th scope="col">Why</th>
            <th scope="col">What</th>
            <th scope="col">Category</th>
            <th scope="col" className="num" aria-sort={amountDir}>
              <button type="button" className="bud-sort" data-dir={amountDir} onClick={toggleAmount}>Amount<ChevronDown size={14} aria-hidden="true" /></button>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((tx, index) => (
            <tr key={index}>
              <td className="bud-date">{dash(formatTransactionDate(tx.date, tx.month))}</td>
              <td>{dash(tx.why)}</td>
              <td>{dash(tx.what)}</td>
              <td><CategoryTag raw={tx.category} /></td>
              <td className="num"><b>{budgetCurrency(tx.amount)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="bud-list" aria-label={`Transactions, ${scope}`}>
        {shown.map((tx, index) => (
          <li key={index} className="bud-tx">
            <div className="bud-tx-main">
              <span className="bud-tx-why">{dash(tx.why || tx.what)}</span>
              <b className="bud-tx-amount">{budgetCurrency(tx.amount)}</b>
            </div>
            {tx.why && tx.what && <div className="bud-tx-what">{tx.what}</div>}
            <div className="bud-tx-meta">
              <span>{dash(formatTransactionDate(tx.date, tx.month))}</span>
              <CategoryTag raw={tx.category} />
            </div>
          </li>
        ))}
      </ul>

      {sorted.length > shown.length && (
        <div className="bud-more">
          <span className="muted">Showing {shown.length} of {sorted.length}</span>
          <button type="button" className="btn btn--sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, sorted.length - shown.length)} more</button>
        </div>
      )}
    </div>
  );
}
