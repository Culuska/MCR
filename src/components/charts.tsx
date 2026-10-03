import { fmt } from "@/lib/money";

type Month = { label: string; in: { toNumber(): number }; out: { toNumber(): number } };

const short = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${Math.round(a / 1e3)}k` : `$${Math.round(a)}`; };

// Money in and out per month, drawn to one scale. Server-rendered SVG, no client code.
export function CashFlowChart({ months }: { months: Month[] }) {
  const vals = months.flatMap((m) => [m.in.toNumber(), m.out.toNumber()]);
  const max = Math.max(1, ...vals);
  const step = [1e3, 2e3, 5e3, 1e4, 2e4, 25e3, 5e4, 1e5, 2e5, 25e4, 5e5, 1e6].find((s) => s * 4 >= max) ?? Math.ceil(max / 4);
  const top = step * 4;
  const W = 600, H = 220, L = 52, R = 8, T = 10, B = 26, ph = H - T - B, pw = W - L - R, gw = pw / months.length, bw = Math.min(26, gw / 3);
  const y = (v: number) => T + ph - (v / top) * ph;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money in and out by month">
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={y(step * k)} y2={y(step * k)} stroke="var(--line)" />
            <text x={L - 8} y={y(step * k) + 4} textAnchor="end">{short(step * k)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = L + gw * i + gw / 2, a = m.in.toNumber(), b = m.out.toNumber();
          return (
            <g key={i}>
              <rect x={cx - bw - 2} y={y(a)} width={bw} height={T + ph - y(a)} fill="var(--accent)" rx="2" aria-label={`${m.label} in: ${fmt(a)}`} />
              <rect x={cx + 2} y={y(b)} width={bw} height={T + ph - y(b)} fill="var(--rust)" rx="2" aria-label={`${m.label} out: ${fmt(b)}`} />
              <text x={cx} y={H - 8} textAnchor="middle">{m.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
