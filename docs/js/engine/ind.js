// Teknik indikatörler (pandas davranışıyla uyumlu). Seriler: NaN içeren düz diziler.
const NaNv = NaN;
const isn = (x) => x !== x || x === null || x === undefined;

export const fill = (n, v = NaNv) => new Array(n).fill(v);

export function rolling(x, n, fn) {
  const out = fill(x.length);
  for (let i = n - 1; i < x.length; i++) {
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) if (isn(x[j])) { ok = false; break; }
    if (ok) out[i] = fn(x, i - n + 1, i + 1);
  }
  return out;
}
const mean = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i]; return s / (b - a); };
export const sma = (x, n) => rolling(x, n, mean);
const stdev0 = (x, a, b) => { const m = mean(x, a, b); let s = 0; for (let i = a; i < b; i++) s += (x[i] - m) ** 2; return Math.sqrt(s / (b - a)); };
export const rmax = (x, n) => rolling(x, n, (v, a, b) => { let m = -Infinity; for (let i = a; i < b; i++) if (v[i] > m) m = v[i]; return m; });
export const rmin = (x, n) => rolling(x, n, (v, a, b) => { let m = Infinity; for (let i = a; i < b; i++) if (v[i] < m) m = v[i]; return m; });
const rsum = (x, n) => rolling(x, n, (v, a, b) => { let s = 0; for (let i = a; i < b; i++) s += v[i]; return s; });

/** pandas ewm(alpha, adjust=False, min_periods). Baştaki NaN'lar atlanır. */
export function ewm(x, alpha, minPeriods) {
  const out = fill(x.length);
  let prev = null, cnt = 0;
  for (let i = 0; i < x.length; i++) {
    if (!isn(x[i])) {
      prev = prev === null ? x[i] : (1 - alpha) * prev + alpha * x[i];
      cnt++;
    }
    if (prev !== null && cnt >= minPeriods) out[i] = prev;
  }
  return out;
}
export const ema = (x, n) => ewm(x, 2 / (n + 1), n);

const sub = (a, b) => a.map((v, i) => v - b[i]);
const diff = (x) => x.map((v, i) => (i === 0 ? NaNv : v - x[i - 1]));

export function rsi(c, n = 14) {
  const d = diff(c);
  const gain = ewm(d.map((v) => (isn(v) ? NaNv : Math.max(v, 0))), 1 / n, n);
  const loss = ewm(d.map((v) => (isn(v) ? NaNv : Math.max(-v, 0))), 1 / n, n);
  return gain.map((g, i) => {
    const l = loss[i];
    if (isn(g) || isn(l)) return NaNv;
    if (l === 0) return g > 0 ? 100 : NaNv;
    return 100 - 100 / (1 + g / l);
  });
}

export function macd(c, fast = 12, slow = 26, signal = 9) {
  const line = sub(ema(c, fast), ema(c, slow));
  const sig = ewm(line, 2 / (signal + 1), signal);
  return { macd: line, signal: sig, hist: sub(line, sig) };
}

export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n);
  const sd = rolling(c, n, stdev0);
  return { upper: mid.map((m, i) => m + k * sd[i]), mid, lower: mid.map((m, i) => m - k * sd[i]) };
}

export function stochastic(df, n = 14, sk = 3, sd = 3) {
  const ll = rmin(df.l, n), hh = rmax(df.h, n);
  const raw = df.c.map((c, i) => { const r = hh[i] - ll[i]; return r === 0 ? NaNv : (100 * (c - ll[i])) / r; });
  const k = sma(raw, sk);
  return { k, d: sma(k, sd) };
}

export function trueRange(df) {
  return df.h.map((h, i) => {
    if (i === 0) return h - df.l[i];
    const pc = df.c[i - 1];
    return Math.max(h - df.l[i], Math.abs(h - pc), Math.abs(df.l[i] - pc));
  });
}
export const atr = (df, n = 14) => ewm(trueRange(df), 1 / n, n);

export function adx(df, n = 14) {
  const up = diff(df.h), down = diff(df.l).map((v) => -v);
  const pdm = up.map((u, i) => (u > down[i] && u > 0 ? u : 0));
  const mdm = up.map((u, i) => (down[i] > u && down[i] > 0 ? down[i] : 0));
  const tr = ewm(trueRange(df), 1 / n, n);
  const pdi = ewm(pdm, 1 / n, n).map((v, i) => (100 * v) / tr[i]);
  const mdi = ewm(mdm, 1 / n, n).map((v, i) => (100 * v) / tr[i]);
  const dx = pdi.map((p, i) => { const s = p + mdi[i]; return s === 0 ? NaNv : (100 * Math.abs(p - mdi[i])) / s; });
  return { adx: ewm(dx, 1 / n, n), plus_di: pdi, minus_di: mdi };
}

export function obv(df) {
  let acc = 0;
  return df.c.map((c, i) => { if (i > 0) acc += Math.sign(c - df.c[i - 1]) * df.v[i]; return acc; });
}

const tp = (df) => df.h.map((h, i) => (h + df.l[i] + df.c[i]) / 3);

export function cci(df, n = 20) {
  const t = tp(df), ma = sma(t, n);
  const md = rolling(t, n, (v, a, b) => { const m = mean(v, a, b); let s = 0; for (let i = a; i < b; i++) s += Math.abs(v[i] - m); return s / (b - a); });
  return t.map((v, i) => (md[i] === 0 ? NaNv : (v - ma[i]) / (0.015 * md[i])));
}

export function willr(df, n = 14) {
  const hh = rmax(df.h, n), ll = rmin(df.l, n);
  return df.c.map((c, i) => { const r = hh[i] - ll[i]; return r === 0 ? NaNv : (-100 * (hh[i] - c)) / r; });
}

export function mfi(df, n = 14) {
  const t = tp(df), d = diff(t), flow = t.map((v, i) => v * df.v[i]);
  const pos = rsum(flow.map((f, i) => (d[i] > 0 ? f : 0)), n);
  const neg = rsum(flow.map((f, i) => (d[i] < 0 ? f : 0)), n);
  return pos.map((p, i) => (neg[i] === 0 ? NaNv : 100 - 100 / (1 + p / neg[i])));
}

export const roc = (c, n = 10) => c.map((v, i) => (i < n ? NaNv : 100 * (v / c[i - n] - 1)));

export function computeAll(df) {
  const c = df.c, out = {};
  for (const n of [10, 20, 50, 100, 200]) out['sma' + n] = sma(c, n);
  for (const n of [9, 21, 50]) out['ema' + n] = ema(c, n);
  const bb = bollinger(c);
  Object.assign(out, { bb_upper: bb.upper, bb_mid: bb.mid, bb_lower: bb.lower, rsi: rsi(c) });
  const m = macd(c);
  Object.assign(out, { macd: m.macd, macd_signal: m.signal, macd_hist: m.hist });
  const st = stochastic(df);
  Object.assign(out, { stoch_k: st.k, stoch_d: st.d });
  const a = adx(df);
  Object.assign(out, { adx: a.adx, plus_di: a.plus_di, minus_di: a.minus_di, atr: atr(df), obv: obv(df), cci: cci(df), willr: willr(df), mfi: mfi(df), roc: roc(c) });
  return out;
}
