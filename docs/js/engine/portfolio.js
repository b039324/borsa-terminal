// Portföy hesapları (portfolio.py karşılığı)
import { getQuotes, getQuote, fxRate, getDaily, getSector, displayName } from './data.js';
import * as store from './store.js';

const EPS = 1e-9;
const fmtG = (x) => String(+x.toPrecision(6));

export const getTransactions = (pid, st = store.get()) => st.transactions.filter((t) => t.portfolio_id === pid).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id || 1e12) - (b.id || 1e12)));

export function replay(txs) {
  const book = {};
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id || 1e12) - (b.id || 1e12)));
  for (const t of sorted) {
    const p = (book[t.symbol] ??= { symbol: t.symbol, name: t.name, currency: t.currency || 'TRY', qty: 0, avg: 0, realized: 0, dividends: 0, fees: 0 });
    const q = t.quantity, px = t.price, fee = t.fee || 0;
    if (t.type === 'BUY') {
      const total = p.qty * p.avg + q * px + fee;
      p.qty += q; p.avg = total / p.qty; p.fees += fee;
    } else if (t.type === 'SELL') {
      if (q > p.qty + EPS) throw new Error(`${t.symbol}: ${t.date} tarihinde eldeki adetten (${fmtG(p.qty)}) fazla satış`);
      p.realized += (px - p.avg) * q - fee; p.qty -= q; p.fees += fee;
      if (p.qty < EPS) { p.qty = 0; p.avg = 0; }
    } else p.dividends += q * px - fee;
  }
  return book;
}
export const validate = (txs) => { replay(txs); };

export async function summary(pid) {
  const book = replay(getTransactions(pid));
  const open = Object.keys(book).filter((s) => book[s].qty > EPS);
  const quotes = await getQuotes(open);
  const fxc = {};
  const fx = async (c) => (fxc[c] ??= await fxRate(c));
  const positions = [];
  for (const s of open) {
    const p = book[s], q = quotes[s];
    const cur = (q && q.currency) || p.currency;
    const last = q ? q.price : p.avg;
    const prev = q && q.prev_close ? q.prev_close : last;
    const r = await fx(cur);
    const value = p.qty * last, cost = p.qty * p.avg;
    positions.push({
      symbol: s, name: p.name || displayName(s), currency: cur, qty: p.qty, avg: p.avg, last, change_pct: q ? q.change_pct : null, stale: !q,
      value, cost, pnl: value - cost, pnl_pct: cost ? (value / cost - 1) * 100 : null, day_pnl: p.qty * (last - prev),
      value_try: value * r, cost_try: cost * r, pnl_try: (value - cost) * r, day_pnl_try: p.qty * (last - prev) * r, realized_try: p.realized * r,
      sector: await getSector(s),
    });
  }
  const totV = positions.reduce((s, x) => s + x.value_try, 0), totC = positions.reduce((s, x) => s + x.cost_try, 0);
  for (const x of positions) x.weight = totV ? (x.value_try / totV) * 100 : 0;
  positions.sort((a, b) => b.value_try - a.value_try);
  const bySector = {};
  for (const x of positions) bySector[x.sector] = (bySector[x.sector] || 0) + x.value_try;
  let realized = 0, divs = 0;
  for (const p of Object.values(book)) { const r = await fx(p.currency); realized += p.realized * r; divs += p.dividends * r; }
  const day = positions.reduce((s, x) => s + x.day_pnl_try, 0);
  return {
    positions,
    totals: {
      value_try: totV, cost_try: totC, pnl_try: totV - totC, pnl_pct: totC ? (totV / totC - 1) * 100 : null,
      day_pnl_try: day, day_pnl_pct: totV - day ? (day / (totV - day)) * 100 : null, realized_try: realized, dividends_try: divs,
      total_return_try: totV - totC + realized + divs,
    },
    allocation_sector: Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([sector, v]) => ({ sector, value_try: v, weight: totV ? (v / totV) * 100 : 0 })),
    note: "Toplamlar güncel kurla TRY'ye çevrilir; yabancı para varlıklarda alış tarihi kuru kullanılmaz.",
  };
}

export async function history(pid) {
  const txs = getTransactions(pid).filter((t) => t.type === 'BUY' || t.type === 'SELL');
  const empty = { dates: [], value: [], invested: [], pnl: [] };
  if (!txs.length) return empty;
  const start = txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date);
  const closes = {};
  await Promise.all([...new Set(txs.map((t) => t.symbol))].map(async (s) => {
    try { const d = await getDaily(s); closes[s] = { d: d.d, c: d.c, cur: d.meta && d.meta.currency }; } catch { /* sembolü atla */ }
  }));
  const syms = Object.keys(closes);
  if (!syms.length) return empty;
  const idx = [...new Set(syms.flatMap((s) => closes[s].d))].sort().filter((d) => d >= start);
  if (!idx.length) return empty;
  const value = idx.map(() => 0), flow = idx.map(() => 0);
  for (const s of syms) {
    const st = txs.filter((t) => t.symbol === s);
    const q = await getQuote(s).catch(() => null);
    const r = await fxRate((q && q.currency) || closes[s].cur || 'TRY');
    const map = Object.fromEntries(closes[s].d.map((d, i) => [d, closes[s].c[i]]));
    const firstDate = closes[s].d[0];
    // ffill: tüm tarihler üzerinde son bilinen kapanış
    const allDates = [...new Set([...closes[s].d, ...idx])].sort();
    const pxAt = {}; let lastPx = null;
    for (const d of allDates) { if (d in map) lastPx = map[d]; pxAt[d] = lastPx; }
    idx.forEach((d, i) => {
      let qty = 0;
      for (const t of st) if (t.date <= d) qty += t.type === 'BUY' ? t.quantity : -t.quantity;
      const px = d >= firstDate ? pxAt[d] : null;
      value[i] += (px === null || px === undefined ? 0 : qty * px) * r;
    });
    for (const t of st) {
      let k = idx.findIndex((d) => d >= (t.date > idx[0] ? t.date : idx[0]));
      if (k < 0) k = idx.length - 1;
      const amt = t.type === 'BUY' ? t.quantity * t.price + t.fee : -(t.quantity * t.price - t.fee);
      flow[k] += amt * r;
    }
  }
  const invested = []; let acc = 0;
  for (const f of flow) { acc += f; invested.push(acc); }
  const rd = (x) => Math.round(x * 100) / 100;
  return { dates: idx, value: value.map(rd), invested: invested.map(rd), pnl: value.map((v, i) => rd(v - invested[i])) };
}
