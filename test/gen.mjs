// deterministik sentetik OHLCV üretir ve JS motorunun çıktısını yazar
import fs from 'fs';
import { computeAll } from '/home/claude/borsa-pages/web/js/engine/ind.js';
import { technicalSummary, pivots, performance, candlePatterns } from '/home/claude/borsa-pages/web/js/engine/analysis.js';
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const n = 900, df = { t: [], d: [], o: [], h: [], l: [], c: [], v: [] };
let p = 100, day = new Date(Date.UTC(2023, 0, 2));
while (df.c.length < n) {
  day = new Date(day.getTime() + 86400000);
  if ([0, 6].includes(day.getUTCDay())) continue;
  const o = p, c = p * (1 + (rnd() - 0.48) * 0.04), h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
  df.t.push(day / 1000); df.d.push(day.toISOString().slice(0, 10)); df.o.push(o); df.h.push(h); df.l.push(l); df.c.push(c); df.v.push(Math.floor(1e6 * (0.5 + rnd())));
  p = c;
}
fs.writeFileSync('frame.json', JSON.stringify(df));
const s = computeAll(df);
const last = Object.fromEntries(Object.entries(s).map(([k, a]) => [k, a[a.length - 1]]));
fs.writeFileSync('js_out.json', JSON.stringify({ last, summary: technicalSummary(df), pivots: pivots(df), perf: performance(df), patterns: candlePatterns(df), nanCount: Object.fromEntries(Object.entries(s).map(([k, a]) => [k, a.filter((x) => x !== x).length])) }));
