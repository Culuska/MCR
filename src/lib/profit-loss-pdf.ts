import { periodLabel, type ProfitLoss } from "@/lib/profit-loss";
import { statementPdf } from "@/lib/statement-pdf";

export function profitLossPdf(pl: ProfitLoss): Promise<Buffer> {
  const compare = pl.periods.length > 1;
  return statementPdf({
    title: "Profit and Loss",
    sub: compare ? `${periodLabel(pl.periods[0])}, compared with ${periodLabel(pl.periods[1])}` : periodLabel(pl.periods[0]),
    heads: compare ? ["This period", "Previous period", "Change"] : ["Total"],
    lines: pl.lines, compare,
  });
}
