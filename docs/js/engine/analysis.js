// Teknik analiz özeti, pivot, performans, mum formasyonları (analysis.py karşılığı).
import { computeAll } from './ind.js';

const BUY = 'AL', SELL = 'SAT', NEUTRAL = 'NÖTR';
const f = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const last = (a) => f(a[a.length - 1]);
const prevv = (a) => (a.length > 1 ? f(a[a.length - 2]) : null);

const label = (s) => (s >= 0.5 ? 'GÜÇLÜ AL' : s >= 0.1 ? 'AL' : s > -0.1 ? 'NÖTR' : s > -0.5 ? 'SAT' : 'GÜÇLÜ SAT');
function verdict(items) {
  const buy = items.filter((i) => i.signal === BUY).length, sell = items.filter((i) => i.signal === SELL).length;
  const score = items.length ? (buy - sell) / items.length : 0;
  return { buy, sell, neutral: items.length - buy - sell, score: Math.round(score * 1000) / 1000, label: label(score) };
}

export function technicalSummary(df) {
  if (df.c.length < 30) return { error: 'Teknik analiz için yeterli veri yok', oscillators: [], moving_averages: [] };
  const s = computeAll(df);
  const L = (k) => last(s[k]);
  const close = last(df.c);
  const osc = [], mas = [];
  const add = (lst, name, value, signal, note = '') => lst.push({ name, value, signal, note });

  let v = L('rsi');
  if (v !== null) add(osc, 'RSI (14)', v, v < 30 ? BUY : v > 70 ? SELL : NEUTRAL, v < 30 ? 'Aşırı satım' : v > 70 ? 'Aşırı alım' : '');
  const k = L('stoch_k'), d = L('stoch_d');
  if (k !== null && d !== null) add(osc, 'Stokastik (14,3,3)', k, k < 20 && k > d ? BUY : k > 80 && k < d ? SELL : NEUTRAL);
  v = L('cci');
  if (v !== null) add(osc, 'CCI (20)', v, v < -100 ? BUY : v > 100 ? SELL : NEUTRAL);
  const a = L('adx'), pdi = L('plus_di'), mdi = L('minus_di');
  if (a !== null && pdi !== null && mdi !== null) add(osc, 'ADX (14)', a, a > 25 && pdi > mdi ? BUY : a > 25 && mdi > pdi ? SELL : NEUTRAL, a > 25 ? 'Güçlü trend' : 'Zayıf trend');
  v = L('willr');
  if (v !== null) add(osc, 'Williams %R (14)', v, v < -80 ? BUY : v > -20 ? SELL : NEUTRAL);
  const m = L('macd'), ms = L('macd_signal');
  if (m !== null && ms !== null) add(osc, 'MACD (12,26,9)', m, m > ms ? BUY : m < ms ? SELL : NEUTRAL);
  v = L('mfi');
  if (v !== null) add(osc, 'MFI (14)', v, v < 20 ? BUY : v > 80 ? SELL : NEUTRAL);
  v = L('roc');
  if (v !== null) add(osc, 'Momentum (ROC 10)', v, v > 0 ? BUY : v < 0 ? SELL : NEUTRAL);

  for (const n of [10, 20, 50, 100, 200]) { v = L('sma' + n); if (v !== null) add(mas, `SMA ${n}`, v, close > v ? BUY : close < v ? SELL : NEUTRAL); }
  for (const n of [9, 21, 50]) { v = L('ema' + n); if (v !== null) add(mas, `EMA ${n}`, v, close > v ? BUY : close < v ? SELL : NEUTRAL); }
  const lo = L('bb_lower'), up = L('bb_upper');
  if (lo !== null && up !== null) add(mas, 'Bollinger (20,2)', L('bb_mid'), close < lo ? BUY : close > up ? SELL : NEUTRAL, close < lo ? 'Alt banda temas' : close > up ? 'Üst banda temas' : 'Bant içinde');

  const s50 = L('sma50'), s200 = L('sma200');
  let trend = null;
  if (s50 !== null && s200 !== null) {
    const p50 = prevv(s['sma50']), p200 = prevv(s['sma200']);
    if (p50 !== null && p200 !== null && p50 <= p200 && s50 > s200) trend = "Altın kesişim (SMA50, SMA200'ü yukarı kesti)";
    else if (p50 !== null && p200 !== null && p50 >= p200 && s50 < s200) trend = "Ölüm kesişimi (SMA50, SMA200'ü aşağı kesti)";
    else trend = s50 > s200 ? 'Yükseliş trendi (SMA50 > SMA200)' : 'Düşüş trendi (SMA50 < SMA200)';
  }
  return { close, oscillators: osc, moving_averages: mas, verdict_osc: verdict(osc), verdict_ma: verdict(mas), verdict_all: verdict([...osc, ...mas]), trend, atr: L('atr') };
}

export function pivots(df) {
  if (df.c.length < 2) return {};
  const i = df.c.length - 2;
  const h = df.h[i], l = df.l[i], c = df.c[i];
  const p = (h + l + c) / 3, rng = h - l;
  return {
    classic: { S3: l - 2 * (h - p), S2: p - rng, S1: 2 * p - h, P: p, R1: 2 * p - l, R2: p + rng, R3: h + 2 * (p - l) },
    fibonacci: { S3: p - rng, S2: p - 0.618 * rng, S1: p - 0.382 * rng, P: p, R1: p + 0.382 * rng, R2: p + 0.618 * rng, R3: p + rng },
  };
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std1 = (a) => { const m = avg(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

export function performance(df) {
  const c = df.c;
  if (c.length < 3) return {};
  const lastc = c[c.length - 1];
  const ret = (bars) => (c.length > bars ? f((lastc / c[c.length - bars - 1] - 1) * 100) : null);
  const year = df.d[df.d.length - 1].slice(0, 4);
  const first = df.d.findIndex((d) => d >= `${year}-01-01`);
  const ytdLen = c.length - first;
  const ytd = first >= 0 && ytdLen > 1 ? f((lastc / c[first] - 1) * 100) : null;
  const lr = []; for (let i = 1; i < c.length; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const vol = lr.length > 20 ? f(std1(lr.slice(-252)) * Math.sqrt(252) * 100) : null;
  const win = c.slice(-252);
  let peak = -Infinity, dd = 0;
  for (const x of win) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); }
  const hi = Math.max(...win), lo = Math.min(...win);
  const v20 = df.v.slice(-20), av = avg(v20);
  return {
    returns: { '1G': ret(1), '1H': ret(5), '1A': ret(21), '3A': ret(63), '6A': ret(126), YBB: ytd, '1Y': ret(252) },
    volatility_annual: vol, max_drawdown_1y: f(dd * 100), high_52w: f(hi), low_52w: f(lo),
    from_high_pct: f((lastc / hi - 1) * 100), from_low_pct: f((lastc / lo - 1) * 100),
    avg_volume_20: f(av), volume_ratio: av ? f(df.v[df.v.length - 1] / av) : null,
  };
}

export function candlePatterns(df) {
  const out = [];
  if (df.c.length < 3) return out;
  const { o, h, l, c } = df;
  const i = c.length - 1;
  const body = Math.abs(c[i] - o[i]);
  const rng = Math.max(h[i] - l[i], 1e-9);
  const upper = h[i] - Math.max(c[i], o[i]);
  const lower = Math.min(c[i], o[i]) - l[i];
  const down = i >= 3 ? c[i - 1] < c[i - 3] : false;
  const upT = i >= 3 ? c[i - 1] > c[i - 3] : false;
  if (body / rng < 0.1) out.push({ name: 'Doji', bias: 'Kararsızlık', desc: 'Açılış ve kapanış neredeyse eşit.' });
  if (lower > 2 * body && upper < body && body / rng > 0.05 && down) out.push({ name: 'Çekiç', bias: 'Yükseliş', desc: 'Düşüş sonrası uzun alt gölge.' });
  if (upper > 2 * body && lower < body && body / rng > 0.05 && upT) out.push({ name: 'Kayan Yıldız', bias: 'Düşüş', desc: 'Yükseliş sonrası uzun üst gölge.' });
  if (c[i - 1] < o[i - 1] && c[i] > o[i] && c[i] >= o[i - 1] && o[i] <= c[i - 1]) out.push({ name: 'Yutan Boğa', bias: 'Yükseliş', desc: 'Yeşil mum önceki kırmızıyı yuttu.' });
  if (c[i - 1] > o[i - 1] && c[i] < o[i] && o[i] >= c[i - 1] && c[i] <= o[i - 1]) out.push({ name: 'Yutan Ayı', bias: 'Düşüş', desc: 'Kırmızı mum önceki yeşili yuttu.' });
  if (h[i] < h[i - 1] && l[i] > l[i - 1]) out.push({ name: 'İç Mum (Inside Bar)', bias: 'Kararsızlık', desc: 'Önceki mumun aralığı içinde kaldı.' });
  return out;
}
