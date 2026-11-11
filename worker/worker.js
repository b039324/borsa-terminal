/**
 * Borsa Terminal — Cloudflare Worker
 * ------------------------------------------------------------------
 *  - Şifre kontrolü (Authorization: Bearer <şifre>; şifre env.AUTH_PASSWORD secret'ında)
 *  - Yahoo Finance köprüsü: chart, quotes, info (temel veri), statements, news, search
 *  - KV'de tek belge olarak takip listesi / portföy / alarmlar (cihazlar arası senkron)
 *
 *  Bağlantılar (Settings > Bindings / Variables):
 *    KV Namespace  : STORE
 *    Secret        : AUTH_PASSWORD   (en az 10 karakter)
 *    Variable (ops): ALLOWED_ORIGIN  (örn. https://kullanici.github.io) — boşsa her yerden erişilebilir
 *
 *  Hesaplamalar (teknik/temel analiz, portföy K/Z) tarayıcıda yapılır; Worker yalnızca ham veri taşır.
 */

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]);
const INTERVALS = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "5d", "1wk", "1mo"]);
const MAX_BATCH = 12; // ücretsiz plan: istek başına 50 alt istek ve düşük CPU sınırı

// ----------------------------------------------------------------- yardımcılar
function corsHeaders(env, req) {
  const allowed = (env.ALLOWED_ORIGIN || "").trim();
  const origin = req.headers.get("Origin") || "";
  const allow = !allowed || allowed === "*" ? "*" : origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reply(env, req, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env, req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function validSymbol(s) {
  return typeof s === "string" && /^[A-Za-z0-9.\-=^_]{1,24}$/.test(s);
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Brute-force yavaşlatma (isolate başına bellekte; KV yazmadan)
const fails = new Map();
function locked(ip) {
  const now = Date.now();
  const arr = (fails.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  fails.set(ip, arr);
  return arr.length >= 8;
}

// ----------------------------------------------------------------- Yahoo: cookie + crumb
const AUTH_KEY = "__yahoo_auth";
const AUTH_TTL = 6 * 3600 * 1000;
let authMem = null;

function cookieFrom(res) {
  if (typeof res.headers.getSetCookie === "function") {
    const all = res.headers.getSetCookie();
    if (all && all.length) return all.map((c) => c.split(";")[0]).join("; ");
  }
  const one = res.headers.get("set-cookie");
  return one ? one.split(";")[0] : "";
}

async function fetchCrumb() {
  let last = new Error("Crumb alınamadı");
  for (const cu of ["https://fc.yahoo.com/", "https://finance.yahoo.com/quote/AAPL"]) {
    try {
      const cr = await fetch(cu, { headers: BROWSER_HEADERS, redirect: "manual" });
      const cookie = cookieFrom(cr);
      if (!cookie) continue;
      for (const host of ["query2", "query1"]) {
        const r = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { headers: { ...BROWSER_HEADERS, Cookie: cookie } });
        const crumb = (await r.text()).trim();
        if (r.ok && crumb && !crumb.includes("<html")) return { cookie, crumb };
        last = new Error(`Crumb alınamadı (HTTP ${r.status})`);
      }
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function getAuth(env, force = false) {
  const now = Date.now();
  if (!force && authMem && authMem.exp > now) return authMem;
  if (!force && env.STORE) {
    try {
      const kv = await env.STORE.get(AUTH_KEY, "json");
      if (kv && kv.exp > now) return (authMem = kv);
    } catch { /* yoksay */ }
  }
  const a = { ...(await fetchCrumb()), exp: now + AUTH_TTL };
  authMem = a;
  if (env.STORE) {
    try { await env.STORE.put(AUTH_KEY, JSON.stringify(a), { expirationTtl: 24 * 3600 }); } catch { /* yoksay */ }
  }
  return a;
}

const swapHost = (u) => (u.includes("//query1.") ? u.replace("//query1.", "//query2.") : u.replace("//query2.", "//query1."));

async function yahooJson(url, { crumb = false, env } = {}) {
  const attempts = [url, swapHost(url)];
  let lastStatus = 0;
  for (let i = 0; i < attempts.length; i++) {
    let u = attempts[i];
    const headers = { ...BROWSER_HEADERS };
    if (crumb) {
      const a = await getAuth(env, i > 0);
      headers.Cookie = a.cookie;
      u += (u.includes("?") ? "&" : "?") + "crumb=" + encodeURIComponent(a.crumb);
    }
    const r = await fetch(u, { headers, cf: { cacheTtl: 0 } });
    lastStatus = r.status;
    if (r.ok) return r.json();
    if (r.status === 404) break; // sembol yok; tekrar denemenin anlamı yok
  }
  throw Object.assign(new Error(`Yahoo yanıtı: HTTP ${lastStatus}`), { status: lastStatus === 404 ? 404 : 502 });
}

// kısa süreli kenar önbelleği (Yahoo'yu yormamak için)
async function cached(req, key, ttl, loader) {
  const cache = caches.default;
  const ck = new Request("https://cache.local/" + encodeURIComponent(key));
  const hit = await cache.match(ck);
  if (hit) return hit.json();
  const val = await loader();
  const res = new Response(JSON.stringify(val), { headers: { "Cache-Control": `public, max-age=${ttl}`, "Content-Type": "application/json" } });
  try { await cache.put(ck, res); } catch { /* yoksay */ }
  return val;
}

// ----------------------------------------------------------------- veri yükleyiciler
function parseChart(j) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) {
    const e = j && j.chart && j.chart.error;
    throw Object.assign(new Error((e && e.description) || "Veri bulunamadı"), { status: 404 });
  }
  const q = (r.indicators.quote && r.indicators.quote[0]) || {};
  const t = r.timestamp || [];
  const m = r.meta || {};
  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (let i = 0; i < t.length; i++) {
    const c = num(q.close && q.close[i]);
    if (c === null) continue;
    out.t.push(t[i]);
    out.o.push(num(q.open[i]) ?? c);
    out.h.push(num(q.high[i]) ?? c);
    out.l.push(num(q.low[i]) ?? c);
    out.c.push(c);
    out.v.push(num(q.volume[i]) ?? 0);
  }
  const div = r.events && r.events.dividends ? Object.values(r.events.dividends).map((d) => ({ t: d.date, a: d.amount })).sort((a, b) => a.t - b.t) : [];
  return {
    meta: {
      currency: m.currency || null, exchange: m.exchangeName || null, gmtoffset: m.gmtoffset || 0, tz: m.exchangeTimezoneName || null,
      price: num(m.regularMarketPrice), prev: num(m.previousClose) ?? num(m.chartPreviousClose),
      open: num(m.regularMarketOpen), high: num(m.regularMarketDayHigh), low: num(m.regularMarketDayLow), volume: num(m.regularMarketVolume),
      yearHigh: num(m.fiftyTwoWeekHigh), yearLow: num(m.fiftyTwoWeekLow), name: m.longName || m.shortName || null, time: m.regularMarketTime || null,
    },
    ...out,
    dividends: div,
  };
}

async function loadChart(env, req, symbol, range, interval, events = false) {
  const ttl = /m$|^1h$/.test(interval) && interval !== "1mo" ? 30 : 300;
  return cached(req, `chart|${symbol}|${range}|${interval}|${events}`, ttl, async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=${events ? "div" : "history"}`;
    return parseChart(await yahooJson(url, { env }));
  });
}

function quoteFrom(symbol, ch) {
  const m = ch.meta, c = ch.c;
  const n = c.length;
  const price = m.price ?? (n ? c[n - 1] : null);
  // önceki kapanış: bugünkü (devam eden) mumdan bir önceki günlük kapanış
  const prev = n > 1 ? c[n - 2] : m.prev;
  const win = ch.h.slice(-252), lw = ch.l.slice(-252);
  return {
    symbol, name: m.name, price, prev_close: prev, open: m.open ?? (n ? ch.o[n - 1] : null),
    high: m.high ?? (n ? ch.h[n - 1] : null), low: m.low ?? (n ? ch.l[n - 1] : null), volume: m.volume ?? (n ? ch.v[n - 1] : null),
    currency: m.currency, exchange: m.exchange, market_cap: null,
    year_high: m.yearHigh ?? (win.length ? Math.max(...win) : null), year_low: m.yearLow ?? (lw.length ? Math.min(...lw) : null),
    time: m.time,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message }; }
    }
  }));
  return out;
}

function flattenInfo(j) {
  const r = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!r) throw Object.assign(new Error("Temel veri bulunamadı"), { status: 404 });
  const info = {};
  for (const mod of ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"]) {
    const o = r[mod];
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && "raw" in v) info[k] = v.raw;
      else if (v === null || typeof v !== "object") info[k] = v;
    }
  }
  return info;
}

const STMT_TYPES = {
  income: ["TotalRevenue", "GrossProfit", "OperatingIncome", "EBITDA", "NetIncome", "BasicEPS"],
  balance: ["TotalAssets", "CurrentAssets", "CashAndCashEquivalents", "TotalLiabilitiesNetMinorityInterest", "CurrentLiabilities", "TotalDebt", "StockholdersEquity"],
  cashflow: ["OperatingCashFlow", "InvestingCashFlow", "FinancingCashFlow", "CapitalExpenditure", "FreeCashFlow"],
};

async function loadStatement(env, req, symbol, kind, period) {
  const types = STMT_TYPES[kind];
  if (!types) throw Object.assign(new Error("Geçersiz tablo türü"), { status: 400 });
  const pre = period === "quarterly" ? "quarterly" : "annual";
  return cached(req, `stmt|${symbol}|${kind}|${pre}`, 6 * 3600, async () => {
    const p2 = Math.floor(Date.now() / 1000) + 86400;
    const p1 = p2 - 6 * 365 * 86400;
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types.map((t) => pre + t).join(",")}&period1=${p1}&period2=${p2}&merge=false`;
    const j = await yahooJson(url, { env });
    const series = {};
    for (const item of (j.timeseries && j.timeseries.result) || []) {
      const type = item.meta && item.meta.type && item.meta.type[0];
      if (!type || !item[type]) continue;
      series[type.slice(pre.length)] = item[type].filter((x) => x && x.reportedValue).map((x) => ({ d: x.asOfDate, v: num(x.reportedValue.raw) }));
    }
    return { series };
  });
}

// ----------------------------------------------------------------- ana yönlendirici
async function handle(req, env, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === "/api/health") return reply(env, req, { ok: true, kv: !!env.STORE, password_set: !!env.AUTH_PASSWORD });

  // --- şifre
  const pw = env.AUTH_PASSWORD || "";
  if (pw.length < 10) return reply(env, req, { error: "Worker'da AUTH_PASSWORD (en az 10 karakter) tanımlı değil" }, 500);
  const ip = req.headers.get("CF-Connecting-IP") || "?";
  if (locked(ip)) return reply(env, req, { error: "Çok fazla yanlış deneme. 10 dakika sonra tekrar deneyin." }, 429);
  const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(given, pw)) {
    if (given) {
      fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
      await new Promise((r) => setTimeout(r, 500));
    }
    return reply(env, req, { error: "Şifre yanlış" }, 401);
  }

  if (p === "/api/auth") return reply(env, req, { ok: true });

  // --- KV belge
  if (p === "/api/store") {
    if (!env.STORE) return reply(env, req, { error: "KV (STORE) bağlı değil" }, 500);
    if (req.method === "GET") {
      const doc = await env.STORE.get("state", "json");
      return reply(env, req, doc || { rev: 0, data: null });
    }
    if (req.method === "PUT") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.data !== "object" || body.data === null) return reply(env, req, { error: "Geçersiz gövde" }, 400);
      const raw = JSON.stringify(body.data);
      if (raw.length > 5_000_000) return reply(env, req, { error: "Veri çok büyük" }, 413);
      const cur = (await env.STORE.get("state", "json")) || { rev: 0 };
      if (Number(body.rev) !== cur.rev) return reply(env, req, { error: "Veri başka bir cihazda değişti", conflict: true, rev: cur.rev }, 409);
      const next = { rev: cur.rev + 1, data: body.data, updated: new Date().toISOString() };
      await env.STORE.put("state", JSON.stringify(next));
      return reply(env, req, { rev: next.rev });
    }
    return reply(env, req, { error: "Yöntem desteklenmiyor" }, 405);
  }

  if (req.method !== "GET") return reply(env, req, { error: "Yöntem desteklenmiyor" }, 405);

  // --- piyasa verisi
  if (p === "/api/chart") {
    const sym = q.get("symbol"), range = q.get("range") || "6mo", interval = q.get("interval") || "1d";
    if (!validSymbol(sym) || !RANGES.has(range) || !INTERVALS.has(interval)) return reply(env, req, { error: "Geçersiz parametre" }, 400);
    return reply(env, req, await loadChart(env, req, sym, range, interval, q.get("events") === "div"));
  }

  if (p === "/api/charts") { // toplu günlük veri (tarayıcı)
    const syms = (q.get("symbols") || "").split(",").filter(Boolean).slice(0, MAX_BATCH);
    const range = q.get("range") || "1y";
    if (!syms.length || !syms.every(validSymbol) || !RANGES.has(range)) return reply(env, req, { error: "Geçersiz parametre" }, 400);
    const res = await mapLimit(syms, 6, (s) => loadChart(env, req, s, range, "1d"));
    return reply(env, req, Object.fromEntries(syms.map((s, i) => [s, res[i]])));
  }

  if (p === "/api/quotes") {
    const syms = (q.get("symbols") || "").split(",").filter(Boolean).slice(0, MAX_BATCH);
    if (!syms.length || !syms.every(validSymbol)) return reply(env, req, { error: "Geçersiz parametre" }, 400);
    const res = await mapLimit(syms, 6, async (s) => quoteFrom(s, await loadChart(env, req, s, "5d", "1d")));
    return reply(env, req, Object.fromEntries(syms.map((s, i) => [s, res[i]])));
  }

  if (p === "/api/info") {
    const sym = q.get("symbol");
    if (!validSymbol(sym)) return reply(env, req, { error: "Geçersiz sembol" }, 400);
    const info = await cached(req, `info|${sym}`, 3600, async () => {
      const mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
      return flattenInfo(await yahooJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${mods}`, { crumb: true, env }));
    });
    return reply(env, req, info);
  }

  if (p === "/api/statement") {
    const sym = q.get("symbol");
    if (!validSymbol(sym)) return reply(env, req, { error: "Geçersiz sembol" }, 400);
    return reply(env, req, await loadStatement(env, req, sym, q.get("kind"), q.get("period")));
  }

  if (p === "/api/dividends") {
    const sym = q.get("symbol");
    if (!validSymbol(sym)) return reply(env, req, { error: "Geçersiz sembol" }, 400);
    const ch = await loadChart(env, req, sym, "5y", "1mo", true);
    return reply(env, req, ch.dividends);
  }

  if (p === "/api/news" || p === "/api/search") {
    const text = (q.get(p === "/api/news" ? "symbol" : "q") || "").slice(0, 40);
    if (!text) return reply(env, req, p === "/api/news" ? [] : { quotes: [] });
    const isNews = p === "/api/news";
    const data = await cached(req, `${p}|${text}`, isNews ? 600 : 3600, async () => {
      const u = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(text)}&quotesCount=${isNews ? 0 : 8}&newsCount=${isNews ? 12 : 0}&listsCount=0`;
      const j = await yahooJson(u, { env });
      return isNews ? (j.news || []).map((n) => ({ title: n.title, url: n.link, source: n.publisher, published: n.providerPublishTime })) : { quotes: j.quotes || [] };
    });
    return reply(env, req, data);
  }

  return reply(env, req, { error: "Bulunamadı" }, 404);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    try {
      return await handle(req, env, new URL(req.url));
    } catch (e) {
      return reply(env, req, { error: e.message || "Sunucu hatası" }, e.status || 502);
    }
  },
};
