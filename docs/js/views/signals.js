// Sinyaller: BIST 30 / BIST 100 için AL / TUT / SAT listesi (bist-terminal "Sinyaller" ekranı).
// Skor engine/signals.js'te; girdi teknik tarayıcı satırlarıdır.
import { api } from '../api.js';
import { errorBox, esc, short, skeleton, store } from '../util.js';
import { signalOf } from '../engine/signals.js';
import { sectorOf } from '../engine/sectors.js';

const UNIS = [['bist30', 'BIST 30'], ['bist100', 'BIST 100']];
const FILTERS = [['all', 'Tümü', ''], ['AL', 'AL', 'al'], ['TUT', 'TUT', 'tut'], ['SAT', 'SAT', 'sat']];
const todayTR = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

// Son ziyarete göre değişen sinyaller: gün içinde etiketler, gün değişince bir önceki günün etiketleri "önceki" olur.
function loadSS() {
  const s = store.get('sig_state', null), day = todayTR();
  if (!s || typeof s !== 'object') return { day, labels: {}, prev: {} };
  return s.day !== day ? { day, labels: {}, prev: s.labels || {} } : { day, labels: s.labels || {}, prev: s.prev || {} };
}

export default {
  async mount(root, _p, ctx) {
    let uni = store.get('sg_uni', 'bist30'), filter = 'all', group = store.get('sg_group', false), items = [];
    if (!UNIS.some(([k]) => k === uni)) uni = 'bist30';
    const SS = loadSS();

    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Sinyaller</h2>
        <div class="toolbar"><select id="uni" aria-label="Kaynak">${UNIS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn sm" id="refresh">↻ Yenile</button></div></div>
      <section class="card">
        <div class="muted small" id="sub">Yükleniyor…</div>
        <div class="chips sg-chips" id="chips"></div>
        <div id="changed"></div>
        <div id="list">${skeleton(5)}</div>
        <div class="muted small foot">Sinyaller teknik göstergelere dayanır (RSI, 50/200 günlük ortalama, MACD, yıllık momentum); günlük mumlarla hesaplanır, analist ortalaması katılmaz. Bilgi amaçlıdır, yatırım tavsiyesi değildir.</div>
      </section>`;
    const $q = (s) => root.querySelector(s);
    $q('#uni').value = uni;

    const paint = () => {
      const cnt = { AL: 0, TUT: 0, SAT: 0 };
      items.forEach((a) => cnt[a.sig.key]++);
      $q('#chips').innerHTML = FILTERS.map(([k, l, c]) => `<button class="chip sg-${c} ${filter === k ? 'on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${l} ${k === 'all' ? items.length : cnt[k]}</button>`).join('')
        + `<button class="chip ${group ? 'on' : ''}" data-g="1" aria-pressed="${group}">Sektöre göre</button>`;
      const ch = items.filter((a) => SS.prev[a.sym] && SS.labels[a.sym] && SS.prev[a.sym] !== SS.labels[a.sym]);
      $q('#changed').innerHTML = ch.length ? `<h4 class="sg-h">Son ziyarete göre değişenler</h4><div class="sg-changed">${ch.map((a) => `<a class="sg-cell" href="#/stock/${encodeURIComponent(a.symbol)}"><b>${esc(a.sym)}</b><span><span class="sgb ${SS.prev[a.sym]}">${SS.prev[a.sym]}</span> → <span class="sgb ${SS.labels[a.sym]}">${SS.labels[a.sym]}</span></span></a>`).join('')}</div>` : '';
      const dir = filter === 'SAT' ? 1 : -1; // SAT'ta en zayıf skor üstte
      const shown = items.filter((a) => filter === 'all' || a.sig.key === filter).sort((a, b) => dir * (a.sig.score - b.sig.score) || (a.sym < b.sym ? -1 : 1));
      const rowOf = (a) => `<a class="srow" href="#/stock/${encodeURIComponent(a.symbol)}"><div class="sid"><b>${esc(a.sym)}</b><span class="muted small">${esc(a.sig.reason)}</span></div><span class="muted mono">${a.sig.score}/100</span><span class="sgb ${a.sig.key}">${a.sig.key}</span></a>`;
      let html;
      if (!shown.length) html = '<div class="empty">Bu filtrede hisse yok.</div>';
      else if (group) {
        const g = {};
        shown.forEach((a) => { (g[a.sector] = g[a.sector] || []).push(a); });
        html = Object.entries(g).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([name, arr]) => {
          const c = { AL: 0, TUT: 0, SAT: 0 };
          arr.forEach((a) => c[a.sig.key]++);
          return `<div class="sg-grp"><span>${esc(name)} <small class="muted">${arr.length} hisse</small></span><span class="mono"><b class="up">AL ${c.AL}</b> <b class="warn-t">TUT ${c.TUT}</b> <b class="down">SAT ${c.SAT}</b></span></div>${arr.map(rowOf).join('')}`;
        }).join('');
      } else html = shown.map(rowOf).join('');
      $q('#list').innerHTML = `<h4 class="sg-h">${filter === 'all' ? `${UNIS.find(([k]) => k === uni)[1]} sinyalleri` : `${filter} sinyali veren hisseler`}</h4>${html}`;
    };

    const load = async () => {
      $q('#list').innerHTML = skeleton(5);
      $q('#sub').textContent = uni === 'bist100' ? 'BIST 100 taranıyor… (birkaç saniye sürebilir)' : 'Hesaplanıyor…';
      let r;
      try { r = await api.get(`/api/screener?universe=${uni}`); } catch (e) { if (ctx.alive()) { $q('#list').innerHTML = errorBox(e); $q('#sub').textContent = ''; } return; }
      if (!ctx.alive()) return;
      items = r.rows.map((row) => ({ symbol: row.symbol, sym: short(row.symbol), sector: sectorOf(row.symbol), sig: signalOf(row) }));
      items.forEach((a) => { SS.labels[a.sym] = a.sig.key; });
      store.set('sig_state', SS);
      $q('#sub').textContent = `${items.length} hisse · günlük mumlara göre · ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
      paint();
    };

    root.addEventListener('click', (e) => {
      const b = e.target.closest('#chips .chip');
      if (!b) return;
      if (b.dataset.g) { group = !group; store.set('sg_group', group); } else filter = b.dataset.f;
      paint();
    });
    $q('#uni').addEventListener('change', (e) => { uni = e.target.value; store.set('sg_uni', uni); filter = 'all'; load(); });
    $q('#refresh').addEventListener('click', load);
    await load();
  },
};
