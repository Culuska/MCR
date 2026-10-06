import Link from "next/link";
import { periodFrom, periodLabel, previousPeriod, profitAndLoss } from "@/lib/profit-loss";
import { fmt2 } from "@/lib/money";
import { COMPANY } from "@/lib/pdf";

// The Profit and Loss in the QuickBooks style, for any date range, optionally beside the previous period of the same length.
export async function ProfitLossView({ from, to, compare }: { from?: string; to?: string; compare?: string }) {
  const period = periodFrom(from, to);
  const previous = compare === "prev" ? previousPeriod(period) : undefined;
  const pl = await profitAndLoss(previous ? [period, previous] : [period]);
  const two = !!previous;
  const f = period.from.toISOString().slice(0, 10), t = period.to.toISOString().slice(0, 10);
  const query = `from=${f}&to=${t}${two ? "&compare=prev" : ""}`;

  return (
    <section className="panel">
      <form method="get" className="filters" style={{ justifyContent: "space-between" }}>
        <input type="hidden" name="tab" value="profit" />
        <div className="filters">
          <label className="small muted" htmlFor="pl-from">From</label>
          <input id="pl-from" type="date" name="from" defaultValue={f} />
          <label className="small muted" htmlFor="pl-to">To</label>
          <input id="pl-to" type="date" name="to" defaultValue={t} />
          <label className="small"><input type="checkbox" name="compare" value="prev" defaultChecked={two} /> Compare with previous period</label>
          <button type="submit" className="btn sm primary">Run report</button>
          {(from || to || compare) && <Link className="small" href="/finance?tab=profit">Reset</Link>}
        </div>
        <div className="filters">
          <a className="btn sm" href={`/api/reports/profit-loss?format=pdf&${query}`} target="_blank" rel="noreferrer">PDF</a>
          <a className="btn sm" href={`/api/reports/profit-loss?format=pdf&download=1&${query}`}>Download PDF</a>
          <a className="btn sm" href={`/api/reports/profit-loss?${query}`}>CSV</a>
        </div>
      </form>

      <div className="bs-paper">
        <header className="bs-head">
          <div className="bs-co">{COMPANY}</div>
          <h2 className="bs-title">Profit and Loss</h2>
          <div className="bs-asof">{periodLabel(period)}{previous ? `, compared with ${periodLabel(previous)}` : ""}</div>
        </header>
        <div className="tablewrap">
          <table className="bs">
            <thead>
              <tr>
                <th />
                {two ? <><th className="r">This period</th><th className="r">Previous period</th><th className="r">Change</th></> : <th className="r">Total</th>}
              </tr>
            </thead>
            <tbody>
              {pl.lines.map((l, i) => (
                <tr key={i} className={`bs-${l.kind}${l.kind === "title" ? " top" : ""}`}>
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
        <footer className="bs-foot"><span>Accrual basis</span><span className="small">Cost of Construction is job cost: wages, materials, fuel, equipment, transport, subcontractors, site costs and tools.</span></footer>
      </div>
    </section>
  );
}
