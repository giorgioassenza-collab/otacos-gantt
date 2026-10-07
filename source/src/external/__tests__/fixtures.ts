/**
 * SYNTHETIC FIXTURES. None of this is real O'Tacos data: names, dates and amounts are invented
 * and only mimic the column layout the original parser expects (see parseBudgetRows).
 *
 * Month tab layout (blocks 4 columns wide, side by side):
 *   cols 0-3   EVENTS      | DATE | WHY | WHAT | amount
 *   cols 4-7   INFLUENCER  | DATE | WHY | WHAT | amount
 *   cols 8-11  MEDIA       | DATE | WHY | WHAT | amount   (and, lower down, a GENERAL block)
 *   cols 13-14 forecast    | WHAT | amount   (no DATE column before it)
 */

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\n");
}

/** A month tab with all block types: events, influencer, media, general (fee) and forecast. */
export const monthTabRows: string[][] = [
  ["EVENTS", "", "", "", "INFLUENCER", "", "", "", "MEDIA BUDGET", "", "", "", "", "FORECAST", ""],
  ["DATE", "WHY", "WHAT", "€", "DATE", "WHY", "WHAT", "€", "DATE", "WHY", "WHAT", "€", "", "WHAT", "€"],
  ["2026-08-03", "Store opening", "Banner, \"large\"", "€ 1.234,50", "2026-08-05", "Creator A", "Reel", "€ 800", "", "Underperforming Stores", "META", "€ 2,000.00", "", "Next month media", "€ 3,500"],
  ["2026-08-10", "Tasting", "Catering", "€ 300", "", "Creator B", "Story", "€ 450,5", "", "Local push", "TIKTOK", "€ 1.500,25", "", "Freebies", "€ 0"],
  ["", "", "totale", "€ 1.534,50", "", "", "totale", "€ 1.250,50", "", "", "totale", "€ 3.500,25", "", "", ""],
  ["", "", "", "", "", "", "", "", "GENERAL EXPENSES (buffer)", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "DATE", "WHY", "WHAT", "€", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "Fee", "Agency fee", "€ 2,500", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "Empty amount row", "", "", "", ""]
];

/** A tab that is only a header (blank budget month). */
export const headerOnlyRows: string[][] = [
  ["EVENTS", "", "", "", "INFLUENCER", "", "", ""],
  ["DATE", "WHY", "WHAT", "€", "DATE", "WHY", "WHAT", "€"],
  ["", "", "totale", "€ 0", "", "", "totale", "€ 0"]
];

/** A smaller tab for a second month. */
export const secondMonthRows: string[][] = [
  ["INFLUENCER", "", "", ""],
  ["DATE", "WHY", "WHAT", "€"],
  ["2025-12-01", "Creator C", "Video", "€ 600"],
  ["2025-12-02", "Creator D", "Video", "€ 400"]
];

export const monthTabCsv = toCsv(monthTabRows);
export const headerOnlyCsv = toCsv(headerOnlyRows);
export const secondMonthCsv = toCsv(secondMonthRows);

/** Synthetic stand-in for gviz's "default tab" answer (the sheet's summary tab), which has no DATE/WHAT headers. */
export const summaryTabCsv = toCsv([
  ["SYNTH", "", "", ""],
  ["JULY", "€ 1", "€ 2", "€ 3"],
  ["TOTAL YEAR", "€ 4", "€ 5", "€ 6"]
]);

/** TOTAL tab in the layout parseBudgetTotals expects (header row with EXPENSES). */
export const totalsRows: string[][] = [
  ["", "MEDIA", "INFLUENCER", "EVENTS", "GENERAL", "EXPENSES", "INVOICED", "DELTA"],
  ["JULY", "€ 100", "€ 200", "€ 50", "€ 25", "€ 375", "", ""],
  ["JANUARY", "€ 10", "", "", "€ 5", "€ 15", "", ""],
  ["TOTAL Q1", "€ 1", "€ 1", "€ 1", "€ 1", "€ 4", "", ""],
  ["TOTAL YEAR", "€ 110", "€ 200", "€ 50", "€ 30", "€ 390", "", ""]
];

export const influencerSheetCsv = toCsv([
  ["SYNTHETIC INFLUENCER LIST", "", "", "", "", "", "", "", "", "", ""],
  ["name", "City", "TARGET", "Type", "TT PROFILE", "IG PROFILE", "OUTPUT", "PRICE", "STATUS", "WHERE", "WHEN"],
  ["Creator A", "Milano", "Food", "Micro", "@creatora", "@creatora_ig", "2 reels", "€ 500", "TBC", "Store 1", "June"],
  ["  Creator B  ", "Roma", "Lifestyle", "Macro", "", "@creatorb", "1 video", "", "contacted", "", ""],
  ["", "Torino", "", "", "@nobody", "", "", "", "", "", ""],
  ["Creator C", "Napoli", "Food", "Nano", "@creatorc", "", "", "", "tbc", "Store 2", "July"]
]);

const pad = (cells: string[], width = 14): string[] => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")];

/**
 * SYNTHETIC, shaped like the live gviz `&headers=0` output: the INFLUENCER title and the DATE label over the
 * all-dates influencer column are blank (gviz drops them), the amount header cell is empty, there is a "totale"
 * row, a blank-DATE GENERAL header below the media block, and a BUDGET FORECAST block in column 12 whose
 * rows also hold stray legend words (EVENTS / INFLUENCER) with no amount.
 */
export const liveHeaders0Rows: string[][] = [
  pad(["SYNTHETIC - EXPENSES - SEP99", "", "", "", "", "", "", "", "", "", "", "", "BUDGET FORECAST"]),
  pad(["EVENTS", "", "", "", "", "", "", "", "MEDIA BUDGET", "", "", "", "WHAT", "€"]),
  pad(["DATE", "WHY", "WHAT", "", "", "WHY", "WHAT", "", "DATE", "WHY", "WHAT", "", "EVENTS"]),
  pad(["", "Synth launch", "Synth stickers", "€ 99,99", "01/09/2026", "Creator A", "Reel", "€ 1.200,00", "02/09/2026", "Synth ads", "META", "€ 2.000,00", "Synthetic forecast line", "€ 700,00"]),
  pad(["", "", "", "", "03/09/2026", "Creator B", "Story", "€ 350,50", "04/09/2026", "Synth ads", "TikTok", "€ 800,00", "INFLUENCER"]),
  pad(["", "", "", "", "", "", "", "", "", "", "totale", "€ 2.800,00"]),
  pad(["", "", "", "", "", "", "", "", "", "WHY", "WHAT", ""]),
  pad(["", "", "", "", "", "", "", "", "", "Fee", "Agency fee", "€ 500,00"]),
  pad(["", "", "totale", "€ 99,99", "", "", "totale", "€ 1.550,50", "", "", "totale", "€ 500,00"])
];

/** Same layout with every block title dropped (the older-tab case): categories must come from the column order. */
export const liveHeaders0NoTitleRows: string[][] = [
  pad([]),
  pad(["", "WHY", "WHAT", "", "", "WHY", "WHAT", "", "", "WHY", "WHAT", ""]),
  pad(["10/11/2025", "Synth a", "Synth item", "€ 10,00", "11/11/2025", "Synth b", "Creator C", "€ 20,00", "12/11/2025", "Synth c", "META", "€ 30,00"]),
  pad(["", "", "", "", "", "", "", "", "", "", "totale", "€ 30,00"]),
  pad(["", "", "", "", "", "", "", "", "", "WHY", "WHAT", ""]),
  pad(["", "", "", "", "", "", "", "", "", "Fee", "Agency fee", "€ 40,00"])
];

export const liveHeaders0Csv = toCsv(liveHeaders0Rows);
export const liveHeaders0NoTitleCsv = toCsv(liveHeaders0NoTitleRows);

/**
 * SYNTHETIC TOTAL tab in the shape of the live default tab fetched with gviz `&headers=0`: month rows
 * (one with a negative amount), TOTAL YEAR, then TOTAL SPENT / INTEGRATION / REMAINING BUDGET with the amount in
 * column 5 and empty trailing cells. Every figure is invented.
 */
export const officialTotalRows: string[][] = [
  ["99", "", "", "", "", "", "", "", "", "", ""],
  ["JULY", "€ 1.000,00", "€ 2.000,00", "€ 300,00", "€ 400,00", "€ 3.700,00", "€ 1.234,56", "€ 99,00", "€ 12,00", "", ""],
  ["MAY", "€ 10,00", "€ 20,00", "€ 30,00", "€ 40,00", "€ 100,00", "€ 5,00", "-€ 777,77", "", "", ""],
  ["TOTAL YEAR", "EUR 1.234,56", "EUR 2.345,67", "€ 1,00", "€ 2,00", "€ 3.800,00", "€ 6,00", "€ 7,00", "€ 8,00", "<->", "€ 9,00"],
  ["JULY 99 ", "€ 500,00", "€ 600,00", "€ 700,00", "€ 800,00", "€ 2.600,00", "", "", "", "", ""],
  ["TOTAL SPENT", "", "", "", "", "€ 60.000,00", "", "", "", "", ""],
  ["INTEGRATION", "", "", "", "", "€ 10.000,00", "", "", "", "", ""],
  ["REMAINING BUDGET", "", "", "", "", "€ 45.000,50", "", "", "", "", ""]
];
export const officialTotalTabCsv = toCsv(officialTotalRows);
