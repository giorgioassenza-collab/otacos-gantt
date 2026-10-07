import { describe, expect, it } from "vitest";
import type { BudgetTransaction } from "../../external/budget";
import {
  categoryBucket, categoryLabel, categorySlices, filterByMonth, formatTransactionDate, monthOptions, monthSeries,
  parseTransactionDate, percentLabel, previousMonthWithData, sortTransactions
} from "./budgetModel";

// Throwaway fixtures for the pure helpers only. Nothing here is shipped or shown in the UI.
function tx(partial: Partial<BudgetTransaction>): BudgetTransaction {
  return { sheet: "T", category: "Media", date: "", why: "", what: "", amount: 1, month: "Aug 2026", ...partial };
}

describe("categories", () => {
  it("treats General as Fee and folds unknown names into Other", () => {
    expect(categoryBucket("General")).toBe("Fee");
    expect(categoryBucket("fee")).toBe("Fee");
    expect(categoryBucket("Influencer")).toBe("Influencer");
    expect(categoryBucket("Printing")).toBe("Other");
    expect(categoryLabel("General")).toBe("Fee");
    expect(categoryLabel("")).toBe("Other");
  });

  it("sums per bucket, biggest first", () => {
    const slices = categorySlices([tx({ category: "General", amount: 5 }), tx({ category: "Fee", amount: 5 }), tx({ category: "Media", amount: 20 })]);
    expect(slices.map((s) => [s.name, s.amount, s.count])).toEqual([["Media", 20, 1], ["Fee", 10, 2]]);
  });
});

describe("months", () => {
  const rows = [
    tx({ month: "Aug 2026", amount: 10 }),
    tx({ month: "Jul 2025", amount: 5, category: "Influencer" }),
    tx({ month: "No date", amount: 1 }),
    tx({ month: "Jan 2026", amount: 7 })
  ];

  it("lists months chronologically with No date last", () => {
    expect(monthOptions(rows)).toEqual(["Jul 2025", "Jan 2026", "Aug 2026", "No date"]);
  });

  it("builds a stacked series per month and filters by month", () => {
    const series = monthSeries(rows);
    expect(series.map((m) => m.total)).toEqual([5, 7, 10, 1]);
    expect(series[0].parts[0].name).toBe("Influencer");
    expect(filterByMonth(rows, "Aug 2026")).toHaveLength(1);
    expect(filterByMonth(rows, "all")).toHaveLength(4);
  });

  it("finds the previous month that has data", () => {
    const months = monthOptions(rows);
    expect(previousMonthWithData(months, "Aug 2026")).toBe("Jan 2026");
    expect(previousMonthWithData(months, "Jul 2025")).toBeNull();
    expect(previousMonthWithData(months, "No date")).toBeNull();
    expect(previousMonthWithData(months, "all")).toBeNull();
  });
});

describe("percentLabel", () => {
  it("rounds and guards", () => {
    expect(percentLabel(1, 3)).toBe("33%");
    expect(percentLabel(1, 1000)).toBe("<1%");
    expect(percentLabel(0, 10)).toBe("0%");
    expect(percentLabel(5, 0)).toBe("0%");
  });
});

describe("parseTransactionDate", () => {
  const ymd = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null);

  it("reads ISO dates", () => {
    expect(ymd(parseTransactionDate("2026-08-12"))).toEqual([2026, 8, 12]);
  });

  it("uses the tab month to resolve day/month order", () => {
    expect(ymd(parseTransactionDate("12/08/2026", "Aug 2026"))).toEqual([2026, 8, 12]);
    expect(ymd(parseTransactionDate("08/12/2026", "Aug 2026"))).toEqual([2026, 8, 12]);
  });

  it("is unambiguous when one side exceeds 12, and null when truly ambiguous", () => {
    expect(ymd(parseTransactionDate("25/08/2026"))).toEqual([2026, 8, 25]);
    expect(parseTransactionDate("12/08/2026")).toBeNull();
    expect(parseTransactionDate("12/08/2026", "Mar 2026")).toBeNull();
    expect(ymd(parseTransactionDate("05/05/2026"))).toEqual([2026, 5, 5]);
  });

  it("reads named months and borrows the year from the tab only when missing", () => {
    expect(ymd(parseTransactionDate("12 Aug", "Aug 2026"))).toEqual([2026, 8, 12]);
    expect(parseTransactionDate("12 Aug")).toBeNull();
    expect(ymd(parseTransactionDate("3 Sep 2025", "Aug 2026"))).toEqual([2025, 9, 3]);
  });

  it("rejects impossible dates and free text", () => {
    expect(parseTransactionDate("31/02/2026", "Feb 2026")).toBeNull();
    expect(parseTransactionDate("soon")).toBeNull();
    expect(parseTransactionDate("")).toBeNull();
  });

  it("formats readable dates and passes unreadable text through", () => {
    expect(formatTransactionDate("2026-08-12")).toBe("12 Aug 2026");
    expect(formatTransactionDate("soon")).toBe("soon");
    expect(formatTransactionDate("")).toBe("");
  });
});

describe("sortTransactions", () => {
  const rows = [
    tx({ what: "a", date: "10/08/2026", amount: 50 }),
    tx({ what: "b", date: "02/08/2026", amount: 200 }),
    tx({ what: "c", date: "", amount: 75 }),
    tx({ what: "d", month: "Jul 2026", date: "30/07/2026", amount: 75 }),
    tx({ what: "e", month: "No date", date: "", amount: 999 })
  ];
  const names = (list: BudgetTransaction[]) => list.map((t) => t.what);

  it("sorts by date, newest first, with undated months last in both directions", () => {
    expect(names(sortTransactions(rows, "date-desc"))).toEqual(["a", "b", "c", "d", "e"]);
    expect(names(sortTransactions(rows, "date-asc"))).toEqual(["d", "c", "b", "a", "e"]);
  });

  it("sorts by amount, largest first, keeping No date rows last", () => {
    expect(names(sortTransactions(rows, "amount-desc"))).toEqual(["b", "c", "d", "a", "e"]);
    expect(names(sortTransactions(rows, "amount-asc"))[0]).toBe("a");
    expect(names(sortTransactions(rows, "amount-asc")).at(-1)).toBe("e");
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortTransactions(rows, "amount-desc");
    expect(rows).toEqual(copy);
  });
});

