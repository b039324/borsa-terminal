// worker.js'yi Node'da çalıştırır; Yahoo ve KV taklit edilir. Ayrıca web/ klasörünü sunar.
import http from 'http'; import fs from 'fs'; import path from 'path';
import worker from '/home/claude/borsa-pages/worker/worker.js';

const kv = new Map();
const env = { AUTH_PASSWORD: 'test-sifre-12345', STORE: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
const cstore = new Map();
globalThis.caches = { default: { match: async (r) => { const v = cstore.get(r.url); return v ? new Response(v) : undefined; }, put: async (r, res) => { cstore.set(r.url, await res.text()); } } };

const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
function series(sym, range, interval) {
  let seed = hash(sym); const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const base = sym.includes('USDTRY') ? 35 : sym.includes('EURTRY') ? 38 : sym === 'GC=F' ? 2600 : sym.startsWith('^') || sym.startsWith('XU') ? 10000 : 20 + (hash(sym) % 200);
  const intr = /m$/.test(interval) && interval !== '1mo';
  const t = [], q = { open: [], high: [], low: [], close: [], volume: [] };
  const now = Math.floor(Date.now() / 1000);
  let times = [];
  if (intr) { const step = interval === '5m' ? 300 : 1800; const days = range === '5d' ? 6 : 24; for (let d = days; d >= 0; d--) { const day0 = Math.floor((now - d * 86400) / 86400) * 86400; const wd = new Date(day0 * 1000).getUTCDay(); if (wd === 0 || wd === 6) continue; for (let s = 7 * 3600; s < 15 * 3600; s += step) { if (day0 + s <= now) times.push(day0 + s); } } }
  else { const step = interval === '1wk' ? 7 : interval === '1mo' ? 30 : 1; const n = interval === '1d' ? ({ '5d': 5, '1mo': 22, '3mo': 66, '6mo': 126, '1y': 252, '2y': 504, '5y': 1260 }[range] || 1260) : interval === '1wk' ? 520 : 120; let dd = Math.floor(now / 86400) * 86400; while (times.length < n) { const wd = new Date(dd * 1000).getUTCDay(); if (step > 1 || (wd !== 0 && wd !== 6)) times.push(dd + 7 * 3600); dd -= step * 86400; } times.reverse(); }
  let p = base * (0.7 + rnd() * 0.3);
  for (const ts of times) { const o = p, c = p * (1 + (rnd() - 0.47) * (intr ? 0.004 : 0.03)); t.push(ts); q.open.push(o); q.close.push(c); q.high.push(Math.max(o, c) * 1.003); q.low.push(Math.min(o, c) * 0.997); q.volume.push(Math.floor(1e6 * (0.4 + rnd()))); p = c; }
  return { t, q };
}
const yahoo = (u) => {
  const url = new URL(u); const p = url.pathname; const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.host === 'fc.yahoo.com') return new Response('', { status: 404, headers: { 'set-cookie': 'A3=abc; Path=/' } });
  if (p.endsWith('/getcrumb')) return new Response('crumb123');
  let m;
  if ((m = p.match(/\/v8\/finance\/chart\/(.+)$/))) {
    const sym = decodeURIComponent(m[1]); if (sym.startsWith('NOPE')) return new Response('{}', { status: 404 });
    const { t, q } = series(sym, url.searchParams.get('range'), url.searchParams.get('interval'));
    const last = q.close[q.close.length - 1];
    const ev = url.searchParams.get('events') === 'div' ? { dividends: { a: { date: t[Math.max(0, t.length - 5)], amount: 1.5 }, b: { date: t[Math.max(0, t.length - 2)], amount: 2 } } } : undefined;
    return J({ chart: { result: [{ meta: { currency: sym.endsWith('.IS') || sym.includes('TRY') ? 'TRY' : 'USD', exchangeName: 'IST', gmtoffset: 10800, exchangeTimezoneName: 'Europe/Istanbul', regularMarketPrice: last, previousClose: q.close[q.close.length - 2], longName: 'Test ' + sym, fiftyTwoWeekHigh: Math.max(...q.high), fiftyTwoWeekLow: Math.min(...q.low), regularMarketTime: t[t.length - 1] }, timestamp: t, indicators: { quote: [q] }, events: ev }], error: null } });
  }
  if (p.includes('/quoteSummary/')) { const r = (x) => ({ raw: x }); return J({ quoteSummary: { result: [{ price: { longName: { raw: undefined }, marketCap: r(5e10) }, summaryDetail: { trailingPE: r(8.5), dividendRate: r(2), payoutRatio: r(0.2), beta: r(1.1) }, defaultKeyStatistics: { priceToBook: r(1.4), trailingEps: r(3) }, financialData: { returnOnEquity: r(0.25), profitMargins: r(0.18), debtToEquity: r(60), currentRatio: r(1.6), revenueGrowth: r(0.3), targetMeanPrice: r(300), recommendationKey: 'buy' }, assetProfile: { sector: 'Industrials', industry: 'Airlines', longBusinessSummary: 'Test şirketi', website: 'https://example.com', fullTimeEmployees: 1000, country: 'Turkey' } }] } }); }
  if (p.includes('/timeseries/')) { const types = url.searchParams.get('type').split(','); return J({ timeseries: { result: types.map((ty) => ({ meta: { type: [ty] }, [ty]: [2022, 2023, 2024].map((y) => ({ asOfDate: `${y}-12-31`, reportedValue: { raw: 1e9 * (y - 2020) } })) })) } }); }
  if (p.includes('/finance/search')) { const nc = url.searchParams.get('newsCount') !== '0'; return J(nc ? { news: [{ title: 'Haber 1', link: 'https://example.com/1', publisher: 'Test', providerPublishTime: Math.floor(Date.now() / 1000) - 3600 }] } : { quotes: [{ symbol: 'AAPL', shortname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }] }); }
  return new Response('nope', { status: 404 });
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => (String(u.url || u).includes('yahoo.com') ? yahoo(String(u.url || u)) : realFetch(u, o));

const MIME = { '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (rq, rs) => {
  const url = new URL(rq.url, 'http://127.0.0.1:8793');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const req = new Request('http://127.0.0.1:8793' + rq.url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : Buffer.concat(chunks) });
    const res = await worker.fetch(req, env);
    rs.writeHead(res.status, Object.fromEntries(res.headers)); rs.end(Buffer.from(await res.arrayBuffer())); return;
  }
  let f = path.join('/tmp/xt/web', url.pathname === '/' ? 'index.html' : url.pathname);
  if (fs.existsSync(f)) { rs.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(fs.readFileSync(f)); } else { rs.writeHead(404); rs.end(); }
}).listen(8793, () => console.log('hazır'));
