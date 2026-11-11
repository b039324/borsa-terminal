// Veri katmanı: Worker üzerinden Yahoo verisi, bellek önbelleği, sembol çözümleme (data_provider.py karşılığı).
import { NAMES, OVERVIEW } from './universe.js';

export const cfg = { workerUrl: '', defaultSuffix: '.IS' };
const authState = { pass: '' };
export const setPass = (p) => { authState.pass = p; };
export const getPass = () => authState.pass;

export class AuthError extends Error {}

export async function call(path, { method = 'GET', body, signal } = {}) {
  let r;
  try {
    r = await fetch(cfg.workerUrl + path, {
      method, signal,
      headers: { Authorization: 'Bearer ' + authState.pass, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Worker\'a ulaşılamadı. Adresi (config.js) ve internet bağlantısını kontrol edin.');
  }
  let j = null;
  try { j = await r.json(); } catch { /* json değil */ }
  if (r.status === 401) { const e = new AuthError((j && j.error) || 'Şifre yanlış'); throw e; }
  if (!r.ok) { const e = new Error((j && j.error) || `Sunucu hatası (${r.status})`); e.status = r.status; e.body = j; throw e; }
  return j;
}

// ---- önbellek (TTL + hata olursa eski değer)
const cache = new Map();
const inflight = new Map();
export async function cached(key, ttl, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < ttl * 1000) return hit.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await fn();
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (hit && !(e instanceof AuthError)) return hit.v;
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

// ---- yardımcılar
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
export { num };
const OV = Object.fromEntries(OVERVIEW.map(([s, n]) => [s, n]));
export const baseName = (s) => s.split('.')[0];
export const displayName = (s, fallback) => OV[s] || NAMES[baseName(s)] || fallback || s;

/** Worker karesi -> {t,d,o,h,l,c,v}; d = borsanın yerel tarihi (YYYY-MM-DD) */
function toFrame(ch) {
  const off = (ch.meta && ch.meta.gmtoffset) || 0;
  return { t: ch.t, d: ch.t.map((x) => new Date((x + off) * 1000).toISOString().slice(0, 10)), o: ch.o, h: ch.h, l: ch.l, c: ch.c, v: ch.v, meta: ch.meta };
}
export const emptyFrame = () => ({ t: [], d: [], o: [], h: [], l: [], c: [], v: [], meta: {} });

function dedupeDaily(fr) { // aynı güne düşen mumlar: sonuncuyu tut
  const keep = [];
  for (let i = 0; i < fr.d.length; i++) if (i === fr.d.length - 1 || fr.d[i] !== fr.d[i + 1]) keep.push(i);
  if (keep.length === fr.d.length) return fr;
  const pick = (a) => keep.map((i) => a[i]);
  return { ...fr, t: pick(fr.t), d: pick(fr.d), o: pick(fr.o), h: pick(fr.h), l: pick(fr.l), c: pick(fr.c), v: pick(fr.v) };
}

const chartQS = (s, range, interval, ev = '') => `/api/chart?symbol=${encodeURIComponent(s)}&range=${range}&interval=${interval}${ev}`;

async function fetchFrame(s, range, interval) {
  const fr = toFrame(await call(chartQS(s, range, interval)));
  return interval === '1d' || interval === '1wk' || interval === '1mo' ? dedupeDaily(fr) : fr;
}

// ---- sembol çözümleme
const resolved = {};
export async function hasData(s) {
  try { return (await cached(`probe|${s}`, 600, () => fetchFrame(s, '5d', '1d'))).c.length > 0; } catch (e) { if (e instanceof AuthError) throw e; return false; }
}
export async function resolve(raw) {
  const s = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) throw new Error('Boş sembol');
  if (s.startsWith('US:')) return s.slice(3);
  if (/[.^=-]/.test(s)) return s;
  if (resolved[s]) return resolved[s];
  const cand = s + cfg.defaultSuffix;
  const out = !cfg.defaultSuffix || (await hasData(cand)) ? cand : (await hasData(s)) ? s : cand;
  resolved[s] = out;
  return out;
}

// ---- geçmiş veri
export const RANGES = {
  '1d': { range: '5d', interval: '5m', days: 1 },
  '5d': { range: '1mo', interval: '30m', days: 5 },
  '1mo': { range: '5y', interval: '1d', bars: 22 },
  '3mo': { range: '5y', interval: '1d', bars: 66 },
  '6mo': { range: '5y', interval: '1d', bars: 126 },
  '1y': { range: '5y', interval: '1d', bars: 252 },
  '2y': { range: '5y', interval: '1d', bars: 504 },
  '5y': { range: '10y', interval: '1wk', bars: 260 },
  max: { range: 'max', interval: '1mo', bars: null },
};

export const getDaily = (s) => cached(`daily|${s}`, 300, () => fetchFrame(s, '5y', '1d'));

export async function getChartFrame(s, rangeKey) {
  const c = RANGES[rangeKey] || RANGES['6mo'];
  let df;
  if (c.interval === '1d') df = await getDaily(s);
  else df = await cached(`hist|${s}|${c.range}|${c.interval}`, c.interval.endsWith('m') ? 60 : 600, () => fetchFrame(s, c.range, c.interval));
  if (!df.c.length) return [df, 0];
  let start;
  if (c.days) {
    const dates = [...new Set(df.d)].slice(-c.days);
    start = df.d.findIndex((x) => dates.includes(x));
  } else start = c.bars ? Math.max(0, df.c.length - c.bars) : 0;
  return [df, start];
}

/** Toplu günlük veri (tarayıcı). 12'şerli parçalar halinde. */
export async function getDailyBatch(symbols, range = '1y') {
  const out = {};
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 6) chunks.push(symbols.slice(i, i + 6));
  await Promise.all(chunks.map(async (ch) => {
    const res = await cached(`batch|${range}|${ch.join(',')}`, 120, () => call(`/api/charts?symbols=${encodeURIComponent(ch.join(','))}&range=${range}`));
    for (const s of ch) if (res[s] && !res[s].error) out[s] = dedupeDaily(toFrame(res[s]));
  }));
  return out;
}

// ---- anlık fiyatlar
export async function getQuotes(symbols) {
  symbols = [...new Set(symbols)];
  const out = {};
  const need = [];
  const now = Date.now();
  for (const s of symbols) {
    const hit = cache.get(`quote|${s}`);
    if (hit && now - hit.t < 30000) out[s] = hit.v; else need.push(s);
  }
  for (let i = 0; i < need.length; i += 12) {
    const ch = need.slice(i, i + 12);
    let res;
    try { res = await call(`/api/quotes?symbols=${encodeURIComponent(ch.join(','))}`); } catch (e) { if (e instanceof AuthError) throw e; res = {}; }
    for (const s of ch) {
      const q = res[s];
      if (q && !q.error && num(q.price) !== null) { const b = buildQuote(s, q); cache.set(`quote|${s}`, { t: Date.now(), v: b }); out[s] = b; }
      else { const old = cache.get(`quote|${s}`); if (old) out[s] = old.v; }
    }
  }
  return out;
}

function buildQuote(symbol, q) {
  const price = num(q.price), prev = num(q.prev_close);
  const cur = q.currency || (symbol.endsWith('.IS') ? 'TRY' : 'USD');
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return {
    symbol, name: displayName(symbol, q.name), price, prev_close: prev,
    change: prev ? price - prev : null, change_pct: prev ? (price / prev - 1) * 100 : null,
    open: num(q.open), high: num(q.high), low: num(q.low), volume: num(q.volume), currency: String(cur).toUpperCase(),
    market_cap: num(q.market_cap), year_high: num(q.year_high), year_low: num(q.year_low),
    updated: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

export async function getQuote(symbol) {
  const r = await getQuotes([symbol]);
  if (!r[symbol]) throw new Error(`${symbol} için veri bulunamadı`);
  return r[symbol];
}

export async function fxRate(currency) {
  const cur = (currency || 'TRY').toUpperCase();
  if (cur === 'TRY') return 1;
  if (cur === 'GBX') return (await fxRate('GBP')) / 100;
  try { return (await getQuote(`${cur}TRY=X`)).price; } catch { return 1; }
}

// ---- temel veri
export const getInfo = (s) => cached(`info|${s}`, 3600, () => call(`/api/info?symbol=${encodeURIComponent(s)}`));
export async function getSector(s) { try { return (await getInfo(s)).sector || 'Diğer'; } catch { return 'Diğer'; } }

const ROWS = {
  income: [['TotalRevenue', 'Toplam Gelir'], ['GrossProfit', 'Brüt Kâr'], ['OperatingIncome', 'Faaliyet Kârı'], ['EBITDA', 'FAVÖK (EBITDA)'], ['NetIncome', 'Net Kâr'], ['BasicEPS', 'Hisse Başı Kâr (EPS)']],
  balance: [['TotalAssets', 'Toplam Varlıklar'], ['CurrentAssets', 'Dönen Varlıklar'], ['CashAndCashEquivalents', 'Nakit ve Benzerleri'], ['TotalLiabilitiesNetMinorityInterest', 'Toplam Yükümlülükler'], ['CurrentLiabilities', 'Kısa Vadeli Yükümlülükler'], ['TotalDebt', 'Toplam Borç'], ['StockholdersEquity', 'Özkaynaklar']],
  cashflow: [['OperatingCashFlow', 'İşletme Nakit Akışı'], ['InvestingCashFlow', 'Yatırım Nakit Akışı'], ['FinancingCashFlow', 'Finansman Nakit Akışı'], ['CapitalExpenditure', 'Yatırım Harcaması (CAPEX)'], ['FreeCashFlow', 'Serbest Nakit Akışı']],
};

export async function getStatement(s, kind, period) {
  const { series } = await cached(`stmt|${s}|${kind}|${period}`, 6 * 3600, () => call(`/api/statement?symbol=${encodeURIComponent(s)}&kind=${kind}&period=${period}`));
  const dates = [...new Set(Object.values(series).flatMap((a) => a.map((x) => x.d)))].sort().reverse();
  if (!dates.length) return { columns: [], rows: [] };
  const rows = [];
  for (const [key, lab] of ROWS[kind]) {
    if (!series[key]) continue;
    const m = Object.fromEntries(series[key].map((x) => [x.d, x.v]));
    rows.push({ key, label: lab, values: dates.map((d) => (m[d] ?? null)) });
  }
  return { columns: dates.map((d) => (period === 'quarterly' ? d.slice(0, 7) : d.slice(0, 4))), rows };
}

export async function getNews(s) {
  const raw = await cached(`news|${s}`, 600, () => call(`/api/news?symbol=${encodeURIComponent(s)}`));
  return raw.filter((n) => n.title).slice(0, 12).map((n) => ({ title: n.title, summary: '', url: n.url, published: n.published ? new Date(n.published * 1000).toISOString() : '', source: n.source || '' }));
}

export async function getDividends(s) {
  const raw = await cached(`div|${s}`, 6 * 3600, () => call(`/api/dividends?symbol=${encodeURIComponent(s)}`));
  return raw.slice(-12).map((d) => ({ date: new Date(d.t * 1000).toISOString().slice(0, 10), amount: num(d.a) })).reverse();
}

export async function search(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const qu = q.toUpperCase();
  const local = Object.entries(NAMES).filter(([b, n]) => b.includes(qu) || n.toUpperCase().includes(qu)).slice(0, 6)
    .map(([b, n]) => ({ symbol: b + '.IS', name: n, exchange: 'BIST', type: 'EQUITY' }));
  let remote = [];
  try {
    const r = await cached(`search|${qu}`, 3600, () => call(`/api/search?q=${encodeURIComponent(q)}`));
    remote = (r.quotes || []).filter((x) => x.symbol).map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange, type: x.quoteType }));
  } catch (e) { if (e instanceof AuthError) throw e; }
  const seen = new Set(local.map((x) => x.symbol));
  return [...local, ...remote.filter((x) => !seen.has(x.symbol)).slice(0, 8)];
}
