import Link from "next/link";
import { balanceSheet, dateLabel, parseDay, shortDate, todayDay } from "@/lib/balance-sheet";
import { fmt2 } from "@/lib/money";
import { COMPANY } from "@/lib/pdf";

// The Balance Sheet in the QuickBooks style: a report "paper" with the company, the title and the date at the top,
// grouped accounts with totals, an optional comparison date and a change column. Account names open the general ledger.
export async function BalanceSheetView({ asof, compare }: { asof?: string; compare?: string }) {
  const asOf = parseDay(asof) ?? todayDay();
  const other = parseDay(compare);
  const sheet = await balanceSheet(other ? [asOf, other] : [asOf]);
  const two = sheet.dates.length > 1;
  const iso = asOf.toISOString().slice(0, 10);
  const query = `to=${iso}${other ? `&compare=${other.toISOString().slice(0, 10)}` : ""}`;

  return (
    <section className="panel">
      <form method="get" className="filters" style={{ justifyContent: "space-between" }}>
        <input type="hidden" name="tab" value="balance" />
        <div className="filters">
          <label className="small muted" htmlFor="bs-asof">As of</label>
          <input id="bs-asof" type="date" name="asof" defaultValue={iso} />
          <label className="small muted" htmlFor="bs-compare">Compare with</label>
          <input id="bs-compare" type="date" name="compare" defaultValue={other?.toISOString().slice(0, 10) ?? ""} />
          <button type="submit" className="btn sm primary">Run report</button>
          {(asof || compare) && <Link className="small" href="/finance?tab=balance">Reset</Link>}
        </div>
        <div className="filters">
          <a className="btn sm" href={`/api/reports/balance-sheet?format=pdf&${query}`} target="_blank" rel="noreferrer">PDF</a>
          <a className="btn sm" href={`/api/reports/balance-sheet?format=pdf&download=1&${query}`}>Download PDF</a>
          <a className="btn sm" href={`/api/reports/balance-sheet?${query}`}>CSV</a>
        </div>
      </form>

      <div className="bs-paper">
        <header className="bs-head">
          <div className="bs-co">{COMPANY}</div>
          <h2 className="bs-title">Balance Sheet</h2>
          <div className="bs-asof">As of {dateLabel(asOf)}{other ? `, compared with ${dateLabel(other)}` : ""}</div>
        </header>
        <div className="tablewrap">
          <table className="bs">
            <thead>
              <tr>
                <th />
                {two ? <><th className="r">{shortDate(sheet.dates[0])}</th><th className="r">{shortDate(sheet.dates[1])}</th><th className="r">Change</th></> : <th className="r">Total</th>}
              </tr>
            </thead>
            <tbody>
              {sheet.lines.map((l, i) => (
                <tr key={i} className={`bs-${l.kind}${l.kind === "title" && l.indent === 0 ? " top" : ""}`}>
                  <td style={{ paddingLeft: 12 + l.indent * 20 }}>
                    {l.accountId ? <Link href={`/finance?tab=ledger&account=${l.accountId}`}>{l.label}</Link> : l.label}
                  </td>
                  {l.amounts ? (
                    <>
                      {l.amounts.map((a, j) => <td key={j} className="r num">{fmt2(a)}</td>)}
                      {two && <td className="r num">{fmt2(l.amounts[0].minus(l.amounts[1]))}</td>}
                    </>
                  ) : <td colSpan={two ? 3 : 1} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="bs-foot">
          <span>Accrual basis</span>
          <span>{sheet.balanced ? <span className="pill good">Balanced</span> : <span className="pill bad">Assets do not equal liabilities plus equity</span>}</span>
        </footer>
      </div>
    </section>
  );
}
