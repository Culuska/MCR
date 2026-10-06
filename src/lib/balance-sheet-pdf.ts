import { dateLabel, shortDate, type BalanceSheet } from "@/lib/balance-sheet";
import { statementPdf } from "@/lib/statement-pdf";

export function balanceSheetPdf(bs: BalanceSheet): Promise<Buffer> {
  const compare = bs.dates.length > 1;
  return statementPdf({
    title: "Balance Sheet",
    sub: `As of ${dateLabel(bs.dates[0])}${compare ? `, compared with ${dateLabel(bs.dates[1])}` : ""}`,
    heads: compare ? [...bs.dates.map(shortDate), "Change"] : ["Total"],
    lines: bs.lines, compare, balanced: bs.balanced,
  });
}
