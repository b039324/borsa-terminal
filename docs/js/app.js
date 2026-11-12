// Uygulama kabuğu: yönlendirme, üst şerit, arama, piyasa durumu, alarm bildirimleri, tema.
import { api, enc, authEvents } from './api.js';
import { WORKER_URL, DEFAULT_SUFFIX } from './config.js';
import * as data from './engine/data.js';
import * as kv from './engine/store.js';
import { $, $$, chg, debounce, esc, flash, px, short, store, toast, errorBox } from './util.js';
import dashboard from './views/dashboard.js';
import stock from './views/stock.js';
import watchlist from './views/watchlist.js';
import portfolio from './views/portfolio.js';
import screener from './views/screener.js';
import compare from './views/compare.js';
import alerts from './views/alerts.js';

const routes = [
  [/^\/$/, dashboard],
  [/^\/stock\/(.+)$/, stock],
  [/^\/watchlist$/, watchlist],
  [/^\/portfolio$/, portfolio],
  [/^\/screener$/, screener],
  [/^\/compare$/, compare],
  [/^\/alerts$/, alerts],
];

let cleanups = [];
let token = 0;

const ctx = () => {
  const my = ++token;
  return {
    alive: () => my === token,
    poll(fn, ms) {
      const id = setInterval(() => { if (!document.hidden && my === token) fn(); }, ms);
      cleanups.push(() => clearInterval(id));
    },
    onCleanup: (f) => cleanups.push(f),
  };
};

async function navigate() {
  cleanups.forEach((f) => { try { f(); } catch { /* temizlik hatası önemsiz */ } });
  cleanups = [];
  const path = location.hash.replace(/^#/, '') || '/';
  const view = $('#view');
  const c = ctx();
  $$('#side a').forEach((a) => a.classList.toggle('active', a.dataset.nav === '/' ? path === '/' : path.startsWith(a.dataset.nav)));
  for (const [re, mod] of routes) {
    const m = path.match(re);
    if (m) {
      view.scrollTop = 0;
      window.scrollTo(0, 0);
      try {
        await mod.mount(view, { id: m[1] ? decodeURIComponent(m[1]) : null }, c);
      } catch (e) {
        console.error(e);
        if (c.alive()) view.innerHTML = errorBox(e);
      }
      return;
    }
  }
  view.innerHTML = '<div class="empty">Sayfa bulunamadı. <a href="#/">Panele dön</a></div>';
}

// ------------------------------------------------------------- üst şerit
async function refreshTape() {
  try {
    const items = await api.get('/api/market/overview');
    const wanted = ['XU100.IS', 'XU030.IS', 'USDTRY=X', 'EURTRY=X', 'GRAM-ALTIN', 'GC=F', 'BZ=F', '^GSPC', '^IXIC', 'BTC-USD'];
    const list = wanted.map((s) => items.find((i) => i.symbol === s)).filter(Boolean);
    const tape = $('#tape');
    if (!tape.dataset.built) {
      tape.innerHTML = list.map((i) => `<a class="tape-item" data-sym="${esc(i.symbol)}" href="${i.symbol === 'GRAM-ALTIN' ? '#/stock/GC=F' : '#/stock/' + enc(i.symbol)}"><b>${esc(i.name.replace(/ \(.*\)/, ''))}</b> <span class="t-px"></span> <span class="t-chg"></span></a>`).join('');
      tape.dataset.built = '1';
    }
    list.forEach((i) => {
      const el = tape.querySelector(`[data-sym="${CSS.escape(i.symbol)}"]`);
      if (!el) return;
      flash(el.querySelector('.t-px'), px(i.price), i.price);
      el.querySelector('.t-chg').innerHTML = chg(i.change_pct);
    });
  } catch { /* şerit kritik değil */ }
}

async function refreshStatus() {
  try {
    const s = await api.get('/api/market/status');
    $('#mkt-status').innerHTML = s.markets.map((m) => `<span class="mkt ${m.open ? 'open' : 'closed'}" title="${esc(m.hours)} ${esc(s.delay_note)}"><i></i>${esc(m.name)} ${m.open ? 'Açık' : 'Kapalı'}</span>`).join('');
  } catch { /* yoksay */ }
}

// ------------------------------------------------------------- arama
function setupSearch() {
  const input = $('#search'), box = $('#suggest');
  let items = [], idx = -1;
  const go = (sym) => {
    box.hidden = true;
    input.value = '';
    location.hash = `#/stock/${enc(sym)}`;
  };
  const paint = () => {
    box.hidden = !items.length;
    box.innerHTML = items.map((r, i) => `<div class="sg ${i === idx ? 'sel' : ''}" data-sym="${esc(r.symbol)}"><b>${esc(short(r.symbol))}</b><span>${esc(r.name || '')}</span><em>${esc(r.exchange || '')}</em></div>`).join('');
  };
  const query = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 1) { items = []; return paint(); }
    try { items = await api.get(`/api/search?q=${enc(q)}`); } catch { items = []; }
    idx = -1;
    paint();
  }, 200);
  input.addEventListener('input', query);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(-1, idx - 1); paint(); e.preventDefault(); }
    else if (e.key === 'Escape') { box.hidden = true; }
    else if (e.key === 'Enter') {
      const raw = input.value.trim();
      const up = raw.toUpperCase();
      const exact = items.find((r) => r.symbol === up || r.symbol.split('.')[0] === up);
      if (idx >= 0) go(items[idx].symbol);
      else if (exact) go(exact.symbol);
      else if (items.length) go(items[0].symbol);
      else if (raw) go(up);
    }
  });
  box.addEventListener('mousedown', (e) => {
    const d = e.target.closest('.sg');
    if (d) go(d.dataset.sym);
  });
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// ------------------------------------------------------------- alarm bildirimleri
async function pollAlerts() {
  try {
    const pend = await api.get('/api/alerts/pending');
    const all = await api.get('/api/alerts');
    const n = all.filter((a) => a.active).length;
    const badge = $('#alert-count');
    badge.hidden = !n;
    badge.textContent = n;
    if (pend.length) {
      for (const a of pend) {
        const msg = `🔔 ${short(a.symbol)}: ${a.label || ''} ${a.value} koşulu gerçekleşti (fiyat ${px(a.triggered_price)})`;
        toast(msg, 'alert', 12000);
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Borsa Terminal alarmı', { body: msg });
      }
      await api.post('/api/alerts/ack');
    }
  } catch { /* yoksay */ }
}

// ------------------------------------------------------------- tema
function setupTheme() {
  const apply = (t) => { document.documentElement.dataset.theme = t; store.set('theme', t); };
  apply(store.get('theme', 'dark'));
  $('#theme').addEventListener('click', () => {
    apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    navigate(); // grafik renklerini yenile
  });
}

// ------------------------------------------------------------- giriş
const SAVED = 'bt_pass';
const savedPass = () => { try { return localStorage.getItem(SAVED) || sessionStorage.getItem(SAVED) || ''; } catch { return ''; } };
const clearPass = () => { try { localStorage.removeItem(SAVED); sessionStorage.removeItem(SAVED); } catch { /* yoksay */ } data.setPass(''); kv.reset(); };

function askLogin(message = '') {
  return new Promise((resolve) => {
    const box = $('#login'), form = $('#login-form'), msg = $('#login-msg'), pw = $('#login-pw');
    box.hidden = false;
    msg.textContent = message;
    pw.value = '';
    pw.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      $('#login-go').disabled = true;
      msg.textContent = '';
      data.setPass(pw.value);
      try {
        await data.call('/api/auth');
        try { (($('#login-remember').checked ? localStorage : sessionStorage)).setItem(SAVED, pw.value); } catch { /* yoksay */ }
        box.hidden = true;
        resolve();
      } catch (err) {
        data.setPass('');
        msg.textContent = err.message;
      }
      $('#login-go').disabled = false;
    };
  });
}

async function ensureLogin() {
  data.cfg.workerUrl = WORKER_URL.replace(/\/+$/, '');
  data.cfg.defaultSuffix = DEFAULT_SUFFIX;
  if (/BURAYA/.test(WORKER_URL)) {
    $('#login').hidden = false;
    $('#login-form').innerHTML = '<h1>Kurulum gerekli</h1><p class="small">js/config.js dosyasındaki WORKER_URL değerini kendi Cloudflare Worker adresinizle değiştirin (KURULUM.md, adım 2).</p>';
    return new Promise(() => {});
  }
  const p = savedPass();
  if (p) {
    data.setPass(p);
    try { await data.call('/api/auth'); return; } catch (e) {
      if (!(e instanceof data.AuthError)) { $('#login').hidden = true; return; } // ağ hatası: arayüz kendi hatasını gösterir
      clearPass();
      return askLogin('Kayıtlı şifre artık geçerli değil.');
    }
  }
  return askLogin();
}

let relogin = false;
authEvents.addEventListener('auth-required', async () => {
  if (relogin) return;
  relogin = true;
  clearPass();
  await askLogin('Oturum geçersiz, şifrenizi yeniden girin.');
  relogin = false;
  navigate();
});

async function boot() {
  setupTheme();
  setupSearch();
  await ensureLogin();
  const b = $('#logout');
  b.hidden = false;
  b.addEventListener('click', () => { clearPass(); location.reload(); });
  window.addEventListener('hashchange', navigate);
  navigate();
  refreshTape(); refreshStatus(); pollAlerts();
  setInterval(() => { if (!document.hidden) refreshTape(); }, 30000);
  setInterval(refreshStatus, 60000);
  setInterval(() => { if (!document.hidden) pollAlerts(); }, 60000);
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
}

// ------------------------------------------------------------- uygulama olarak yükleme (PWA)
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('#install').hidden = false;
});
$('#install').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('#install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install').hidden = true; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* kayıt olmazsa site yine çalışır */ });

boot();
