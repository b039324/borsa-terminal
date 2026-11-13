// REST benzeri istemci yönlendiricisi: görünümler eski /api/... yollarını çağırmaya devam eder.
import * as dp from './data.js';
import * as store from './store.js';
import * as pf from './portfolio.js';
import * as al from './alerts.js';
import * as fund from './fundamentals.js';
import * as scr from './screener.js';
import { computeAll } from './ind.js';
import { technicalSummary, pivots, performance, candlePatterns } from './analysis.js';
import { OVERVIEW, UNIVERSES } from './universe.js';
import { sectorOf } from './sectors.js';

const fail = (msg) => { throw new Error(msg); };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const ok = Number.isFinite;
const points = (times, vals) => { const o = []; for (let i = 0; i < times.length; i++) if (ok(vals[i])) o.push({ time: times[i], value: r4(vals[i]) }); return o; };
const sym = async (raw) => dp.resolve(raw);
const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ piyasa
async function overview() {
  const quotes = await dp.getQuotes(OVERVIEW.map((o) => o[0]));
  const items = [];
  for (const [s, name, group] of OVERVIEW) {
    const q = quotes[s];
    if (q) items.push({ symbol: s, name, group, price: q.price, change: q.change, change_pct: q.change_pct, currency: q.currency, updated: q.updated });
  }
  const gc = quotes['GC=F'], fx = quotes['USDTRY=X'];
  if (gc && fx && gc.prev_close && fx.prev_close) {
    const g = 31.1035;
    const price = (gc.price * fx.price) / g, prev = (gc.prev_close * fx.prev_close) / g;
    items.splice(5, 0, { symbol: 'GRAM-ALTIN', name: 'Gram Altın (TRY, hesaplanan)', group: 'Emtia', price, change: price - prev, change_pct: (price / prev - 1) * 100, currency: 'TRY', updated: gc.updated, calculated: true });
  }
  return items;
}

async function movers(universe = 'bist30', n = 5) {
  const rows = await scr.scan(universe);
  const byChg = [...rows].sort((a, b) => b.change_pct - a.change_pct);
  const pick = (r) => ({ symbol: r.symbol, name: r.name, price: r.price, change_pct: r.change_pct, volume: r.volume, turnover: r.turnover, signal: r.signal, rsi: r.rsi });
  return {
    gainers: byChg.slice(0, n).map(pick), losers: byChg.slice().reverse().slice(0, n).map(pick),
    active: [...rows].sort((a, b) => b.turnover - a.turnover).slice(0, n).map(pick),
    breadth: { up: rows.filter((r) => r.change_pct > 0).length, down: rows.filter((r) => r.change_pct < 0).length, flat: rows.filter((r) => r.change_pct === 0).length },
  };
}

function marketStatus() {
  const check = (tz, o, c) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const t = (+get('hour') % 24) * 60 + +get('minute');
    return [!['Sat', 'Sun'].includes(get('weekday')) && o <= t && t < c, `${get('hour')}:${get('minute')}`];
  };
  const [bist, bt] = check('Europe/Istanbul', 600, 1080), [ny, nt] = check('America/New_York', 570, 960);
  return {
    markets: [
      { name: 'BIST', open: bist, hours: '10:00–18:00 (İstanbul)', local_time: bt },
      { name: 'NYSE/Nasdaq', open: ny, hours: '09:30–16:00 (New York)', local_time: nt },
      { name: 'Kripto', open: true, hours: '7/24', local_time: '' },
    ],
    delay_note: 'Fiyatlar ~15 dk gecikmelidir. Resmî tatiller dikkate alınmaz.',
  };
}

// ------------------------------------------------------------------ hisse
async function quoteOf(raw) {
  const s = await sym(raw);
  try { return await dp.getQuote(s); } catch (e) { fail(`${s} için fiyat alınamadı: ${e.message}`); }
}

async function chart(raw, range = '6mo') {
  const s = await sym(raw);
  if (!dp.RANGES[range]) fail(`Geçersiz aralık: ${range}`);
  const [df, start] = await dp.getChartFrame(s, range);
  if (!df.c.length) fail(`${s} için grafik verisi bulunamadı`);
  const cfg = dp.RANGES[range];
  const intraday = cfg.interval.endsWith('m');
  const off = (df.meta && df.meta.gmtoffset) || 0;
  const series = computeAll(df);
  const times = (intraday ? df.t.slice(start).map((t) => t + off) : df.d.slice(start));
  const sl = (a) => a.slice(start);
  const o = sl(df.o), h = sl(df.h), l = sl(df.l), c = sl(df.c), v = sl(df.v);
  return {
    symbol: s, name: dp.displayName(s), range, intraday, interval: cfg.interval,
    candles: times.map((t, i) => ({ time: t, open: r4(o[i]), high: r4(h[i]), low: r4(l[i]), close: r4(c[i]) })),
    volume: times.map((t, i) => ({ time: t, value: v[i], up: c[i] >= o[i] })),
    indicators: Object.fromEntries(Object.entries(series).map(([k, a]) => [k, points(times, sl(a))])),
  };
}

async function technical(raw) {
  const s = await sym(raw);
  const df = await dp.getDaily(s);
  if (!df.c.length) fail(`${s} için veri yok`);
  return { symbol: s, timeframe: '1G (günlük)', summary: technicalSummary(df), pivots: pivots(df), performance: performance(df), patterns: candlePatterns(df) };
}

async function financials(raw, period = 'annual') {
  const s = await sym(raw);
  const out = {};
  for (const kind of ['income', 'balance', 'cashflow']) {
    try { out[kind] = await dp.getStatement(s, kind, period); } catch { out[kind] = { columns: [], rows: [] }; }
  }
  return { symbol: s, period, ...out };
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd1 = (a) => { const m = avg(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

async function compare(symbolsCsv, range = '1y') {
  if (range === '1d' || range === '5d') fail('Karşılaştırma en az 1 aylık aralık ister');
  const syms = [];
  for (const x of symbolsCsv.split(',').filter((z) => z.trim()).slice(0, 6)) syms.push(await sym(x));
  if (syms.length < 2) fail('En az iki sembol girin');
  const closes = {};
  await Promise.all(syms.map(async (s) => {
    try { const [df, st] = await dp.getChartFrame(s, range); closes[s] = Object.fromEntries(df.d.slice(st).map((d, i) => [d, df.c[st + i]])); } catch { /* atla */ }
  }));
  const names = syms.filter((s) => closes[s]);
  if (names.length < 2) fail('Karşılaştırılacak yeterli veri bulunamadı');
  const dates = [...new Set(names.flatMap((s) => Object.keys(closes[s])))].sort();
  const cols = {}; // ffill
  for (const s of names) { let last = null; cols[s] = dates.map((d) => { if (d in closes[s]) last = closes[s][d]; return last; }); }
  const keep = dates.map((_, i) => names.every((s) => cols[s][i] !== null));
  const D = dates.filter((_, i) => keep[i]);
  if (!D.length) fail('Ortak tarih aralığı yok');
  const F = Object.fromEntries(names.map((s) => [s, cols[s].filter((_, i) => keep[i])]));
  const rets = Object.fromEntries(names.map((s) => [s, F[s].slice(1).map((x, i) => x / F[s][i] - 1)]));
  const corr = (a, b) => { const ma = avg(a), mb = avg(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } const r = n / Math.sqrt(da * db); return Number.isFinite(r) ? Math.round(r * 100) / 100 : 0; };
  const stats = [], series = [];
  for (const s of names) {
    const reb = F[s].map((x) => (x / F[s][0]) * 100 - 100);
    let peak = -Infinity, dd = 0; for (const x of F[s]) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); }
    stats.push({ symbol: s, name: dp.displayName(s), return: reb[reb.length - 1], volatility: sd1(rets[s]) * Math.sqrt(252) * 100, max_drawdown: dd * 100 });
    series.push({ symbol: s, name: dp.displayName(s), points: points(D, reb) });
  }
  return { series, stats, correlation: { symbols: names, matrix: names.map((a) => names.map((b) => corr(rets[a], rets[b]))) } };
}

// ------------------------------------------------------------------ takip listesi
async function watchlistList() {
  const st = await store.load();
  const items = [...st.watchlist]; // kullanıcının belirlediği sıra (yeniler sona eklenir)
  const quotes = await dp.getQuotes(items.map((i) => i.symbol));
  return items.map((i) => {
    const q = quotes[i.symbol] || {};
    return { ...i, price: q.price ?? null, change: q.change ?? null, change_pct: q.change_pct ?? null, volume: q.volume ?? null, currency: q.currency ?? null, high: q.high ?? null, low: q.low ?? null, year_high: q.year_high ?? null, year_low: q.year_low ?? null, updated: q.updated ?? null, stale: !quotes[i.symbol] };
  });
}

async function watchlistAdd(b) {
  let s, q;
  try { s = await dp.resolve(b.symbol); q = await dp.getQuote(s); } catch { fail(`'${b.symbol}' için veri bulunamadı. BIST için THYAO, ABD için US:AAPL deneyin.`); }
  await store.mutate((d) => {
    if (d.watchlist.some((w) => w.symbol === s)) fail(`${s} zaten listede`);
    d.watchlist.push({ symbol: s, name: q.name, note: (b.note || '').slice(0, 300), added_at: store.stamp() });
  });
  return { symbol: s, name: q.name };
}

// ------------------------------------------------------------------ portföy
async function mkTx(pid, t) {
  if (!(t.quantity > 0)) fail('Adet 0\'dan büyük olmalı');
  if (!(t.price >= 0)) fail('Fiyat negatif olamaz');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) fail('Tarih YYYY-AA-GG biçiminde olmalı');
  let s, cur;
  try { s = await dp.resolve(t.symbol); cur = (await dp.getQuote(s)).currency; } catch { fail(`'${t.symbol}' için veri bulunamadı`); }
  return { portfolio_id: pid, symbol: s, name: dp.displayName(s), type: ['BUY', 'SELL', 'DIVIDEND'].includes(t.type) ? t.type : 'BUY', quantity: +t.quantity, price: +t.price, fee: +(t.fee || 0), currency: cur, date: t.date, note: (t.note || '').slice(0, 300) };
}
const needPf = (pid) => store.get().portfolios.some((p) => p.id === pid) || fail('Portföy bulunamadı');

function csvOf(pid) {
  const esc = (v) => { v = String(v ?? ''); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [['date', 'symbol', 'type', 'quantity', 'price', 'fee', 'note'], ...pf.getTransactions(pid).map((t) => [t.date, t.symbol, t.type, t.quantity, t.price, t.fee, t.note])];
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ alarmlar
async function alertsList() {
  const st = await store.load();
  const rows = [...st.alerts].sort((a, b) => b.active - a.active || b.id - a.id);
  const quotes = await dp.getQuotes([...new Set(rows.filter((r) => r.active).map((r) => r.symbol))]);
  return rows.map((r) => ({ ...r, label: al.LABELS[r.condition], price: quotes[r.symbol] ? quotes[r.symbol].price : null }));
}

// ------------------------------------------------------------------ tablo
const ROUTES = [
  ['GET', /^\/api\/health$/, async () => ({ ok: true, demo: false, auth: true, default_suffix: dp.cfg.defaultSuffix })],
  ['GET', /^\/api\/market\/overview$/, () => overview()],
  ['GET', /^\/api\/market\/movers$/, (m, q) => movers(q.get('universe') || 'bist30', +(q.get('n') || 5))],
  ['GET', /^\/api\/market\/status$/, async () => marketStatus()],
  ['GET', /^\/api\/search$/, (m, q) => dp.search((q.get('q') || '').slice(0, 40))],
  ['GET', /^\/api\/stock\/([^/]+)\/quote$/, (m) => quoteOf(decodeURIComponent(m[1]))],
  ['GET', /^\/api\/stock\/([^/]+)\/chart$/, (m, q) => chart(decodeURIComponent(m[1]), q.get('range') || '6mo')],
  ['GET', /^\/api\/stock\/([^/]+)\/technical$/, (m) => technical(decodeURIComponent(m[1]))],
  ['GET', /^\/api\/stock\/([^/]+)\/fundamentals$/, async (m) => { const s = await sym(decodeURIComponent(m[1])); try { return await fund.build(s); } catch (e) { fail(`Temel veri alınamadı: ${e.message}`); } }],
  ['GET', /^\/api\/stock\/([^/]+)\/financials$/, (m, q) => financials(decodeURIComponent(m[1]), q.get('period') === 'quarterly' ? 'quarterly' : 'annual')],
  ['GET', /^\/api\/stock\/([^/]+)\/news$/, async (m) => { try { return await dp.getNews(await sym(decodeURIComponent(m[1]))); } catch { return []; } }],
  ['GET', /^\/api\/compare$/, (m, q) => compare(q.get('symbols') || '', q.get('range') || '1y')],
  ['GET', /^\/api\/market\/universe$/, async (m, q) => {
    const u = q.get('universe') || 'bist30';
    const syms = UNIVERSES[u] || fail(`Bilinmeyen evren: ${u}`);
    const qs = await dp.getQuotes(syms);
    const rows = syms.filter((s) => qs[s]).map((s) => { const x = qs[s]; return { symbol: s, name: x.name, sector: sectorOf(s), price: x.price, change_pct: x.change_pct, volume: x.volume, turnover: (x.volume || 0) * (x.price || 0), updated: x.updated }; });
    return { universe: u, count: syms.length, rows };
  }],
  ['GET', /^\/api\/screener$/, async (m, q) => { const u = q.get('universe') || 'bist30'; if (!UNIVERSES[u]) fail(`Bilinmeyen evren: ${u}`); return { universe: u, count: UNIVERSES[u].length, rows: await scr.scan(u) }; }],

  ['GET', /^\/api\/watchlist$/, () => watchlistList()],
  ['POST', /^\/api\/watchlist$/, (m, q, b) => watchlistAdd(b)],
  ['PUT', /^\/api\/watchlist\/order$/, async (m, q, b) => {
    const want = Array.isArray(b.symbols) ? b.symbols.map((s) => String(s).toUpperCase()) : fail('Geçersiz sıra');
    await store.mutate((d) => {
      const pos = new Map(want.map((s, i) => [s, i]));
      const rest = d.watchlist.filter((w) => !pos.has(w.symbol));
      d.watchlist = [...d.watchlist.filter((w) => pos.has(w.symbol)).sort((a, b2) => pos.get(a.symbol) - pos.get(b2.symbol)), ...rest];
    });
    return { ok: true };
  }],
  ['PUT', /^\/api\/watchlist\/([^/]+)\/note$/, async (m, q, b) => {
    const s = decodeURIComponent(m[1]).toUpperCase();
    await store.mutate((d) => {
      const w = d.watchlist.find((x) => x.symbol === s) || fail(`${s} takip listesinde değil`);
      w.note = (b.note || '').slice(0, 300);
      if ('target' in b) { // hedef fiyat: yalnız gönderildiyse değişir; boş/0 ise silinir
        if (b.target != null && b.target !== '' && !(+b.target > 0)) fail('Hedef fiyat pozitif olmalı');
        if (b.target != null && b.target !== '') w.target = +b.target; else delete w.target;
      }
    });
    return { ok: true };
  }],
  ['DELETE', /^\/api\/watchlist\/([^/]+)$/, async (m) => { const s = decodeURIComponent(m[1]).toUpperCase(); await store.mutate((d) => { d.watchlist = d.watchlist.filter((x) => x.symbol !== s); }); return { ok: true }; }],

  ['GET', /^\/api\/portfolios$/, async () => (await store.load()).portfolios],
  ['POST', /^\/api\/portfolios$/, async (m, q, b) => {
    const name = (b.name || '').trim();
    if (!name || name.length > 60) fail('Portföy adı 1-60 karakter olmalı');
    return store.mutate((d) => { if (d.portfolios.some((p) => p.name === name)) fail('Bu isimde bir portföy zaten var'); const id = ++d.seq.pf; d.portfolios.push({ id, name, created_at: store.stamp() }); return { id, name }; });
  }],
  ['DELETE', /^\/api\/portfolios\/(\d+)$/, async (m) => { await store.load(); const pid = +m[1]; needPf(pid); return store.mutate((d) => { if (d.portfolios.length <= 1) fail('Son portföy silinemez'); d.transactions = d.transactions.filter((t) => t.portfolio_id !== pid); d.portfolios = d.portfolios.filter((p) => p.id !== pid); return { ok: true }; }); }],
  ['GET', /^\/api\/portfolios\/(\d+)\/summary$/, async (m) => { await store.load(); needPf(+m[1]); return pf.summary(+m[1]); }],
  ['GET', /^\/api\/portfolios\/(\d+)\/history$/, async (m) => { await store.load(); needPf(+m[1]); return pf.history(+m[1]); }],
  ['GET', /^\/api\/portfolios\/(\d+)\/transactions$/, async (m) => { await store.load(); needPf(+m[1]); return pf.getTransactions(+m[1]).reverse(); }],
  ['POST', /^\/api\/portfolios\/(\d+)\/transactions$/, async (m, q, b) => {
    await store.load(); const pid = +m[1]; needPf(pid);
    const t = await mkTx(pid, { date: today(), ...b });
    return store.mutate((d) => { pf.validate([...pf.getTransactions(pid, d), t]); t.id = ++d.seq.tx; d.transactions.push(t); return { id: t.id }; });
  }],
  ['POST', /^\/api\/portfolios\/(\d+)\/import$/, async (m, q, b) => {
    await store.load(); const pid = +m[1]; needPf(pid);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    const news = []; for (const r of rows) news.push(await mkTx(pid, { date: today(), ...r }));
    return store.mutate((d) => { pf.validate([...pf.getTransactions(pid, d), ...news]); for (const t of news) { t.id = ++d.seq.tx; d.transactions.push(t); } return { imported: news.length }; });
  }],
  ['DELETE', /^\/api\/transactions\/(\d+)$/, async (m) => {
    await store.load(); const tid = +m[1];
    const tx = store.get().transactions.find((t) => t.id === tid) || fail('İşlem bulunamadı');
    return store.mutate((d) => {
      try { pf.validate(pf.getTransactions(tx.portfolio_id, d).filter((t) => t.id !== tid)); } catch (e) { fail(`Bu işlem silinirse tutarsızlık oluşur: ${e.message}`); }
      d.transactions = d.transactions.filter((t) => t.id !== tid); return { ok: true };
    });
  }],
  ['GET', /^\/api\/portfolios\/(\d+)\/export\.csv$/, async (m) => { await store.load(); needPf(+m[1]); return { __csv: csvOf(+m[1]), filename: `portfoy_${m[1]}.csv` }; }],

  ['GET', /^\/api\/alerts$/, () => alertsList()],
  ['POST', /^\/api\/alerts$/, async (m, q, b) => {
    let s, qt;
    try { s = await dp.resolve(b.symbol); qt = await dp.getQuote(s); } catch { fail(`'${b.symbol}' için veri bulunamadı`); }
    if (!['above', 'below', 'chg_up', 'chg_down'].includes(b.condition)) fail('Geçersiz koşul');
    if (!(b.value > 0)) fail(['chg_up', 'chg_down'].includes(b.condition) ? 'Yüzde değeri pozitif olmalı' : 'Fiyat pozitif olmalı');
    return store.mutate((d) => { const id = ++d.seq.al; d.alerts.push({ id, symbol: s, condition: b.condition, value: +b.value, note: (b.note || '').slice(0, 200), active: 1, created_at: store.stamp(), triggered_at: null, triggered_price: null, seen: 0 }); return { id, symbol: s, price: qt.price }; });
  }],
  ['GET', /^\/api\/alerts\/pending$/, async () => { await al.checkAlerts().catch(() => {}); return store.get().alerts.filter((a) => !a.active && a.triggered_at && !a.seen).map((a) => ({ ...a, label: al.LABELS[a.condition] })); }],
  ['POST', /^\/api\/alerts\/ack$/, async () => { if (store.get().alerts.some((a) => !a.active && !a.seen)) await store.mutate((d) => { d.alerts.forEach((a) => { if (!a.active && !a.seen) a.seen = 1; }); }); return { ok: true }; }],
  ['POST', /^\/api\/alerts\/check$/, () => al.checkAlerts()],
  ['POST', /^\/api\/alerts\/(\d+)\/reactivate$/, async (m) => { const id = +m[1]; await store.mutate((d) => { const a = d.alerts.find((x) => x.id === id); if (a) Object.assign(a, { active: 1, triggered_at: null, triggered_price: null, seen: 0 }); }); return { ok: true }; }],
  ['DELETE', /^\/api\/alerts\/(\d+)$/, async (m) => { const id = +m[1]; await store.mutate((d) => { d.alerts = d.alerts.filter((a) => a.id !== id); }); return { ok: true }; }],
];

export async function dispatch(method, path, body) {
  const u = new URL(path, 'http://x');
  for (const [mth, re, fn] of ROUTES) {
    if (mth !== method) continue;
    const m = u.pathname.match(re);
    if (m) { await store.load().catch((e) => { throw e; }); return fn(m, u.searchParams, body || {}); }
  }
  throw new Error(`Bilinmeyen istek: ${method} ${path}`);
}
