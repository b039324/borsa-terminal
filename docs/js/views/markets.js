// Piyasalar: BIST 30 / BIST 100 hisse listesi (bist-terminal "Piyasalar" ekranı). Arama, sıralama, tek dokunuşla takibe alma.
import { api, enc } from '../api.js';
import { cls, errorBox, esc, pct, px, short, skeleton, store, toast } from '../util.js';

const UNIS = [['bist30', 'BIST 30'], ['bist100', 'BIST 100']];
const SORTS = [['az', 'A-Z'], ['up', 'Yükselen'], ['down', 'Düşen'], ['vol', 'Hacim']];
const BY = {
  az: (a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0),
  up: (a, b) => (b.change_pct ?? -1e9) - (a.change_pct ?? -1e9),
  down: (a, b) => (a.change_pct ?? 1e9) - (b.change_pct ?? 1e9),
  vol: (a, b) => (b.turnover || 0) - (a.turnover || 0),
};
const fold = (s) => String(s || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u');
const cleanSym = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export default {
  async mount(root, _p, ctx) {
    let uni = store.get('mk_uni', 'bist30'), sort = store.get('mk_sort', 'az'), q = '';
    if (!UNIS.some(([k]) => k === uni)) uni = 'bist30';
    if (!BY[sort]) sort = 'az';
    const cache = {}; // evren -> { t, rows }
    let wl = new Set();

    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Piyasalar</h2>
        <div class="toolbar"><select id="uni" aria-label="Endeks">${UNIS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn sm" id="refresh">↻ Yenile</button></div></div>
      <section class="card">
        <input id="q" class="mk-search" type="search" placeholder="Kod veya şirket adı ara (BIST 100 içinde)" autocomplete="off" aria-label="Hisse ara">
        <div class="chips mk-sorts" id="sorts"></div>
        <div id="list">${skeleton(6)}</div>
        <div class="muted small foot" id="info"></div>
      </section>`;
    const $q = (s) => root.querySelector(s);
    $q('#uni').value = uni;

    const fetchUni = async (u, force = false) => {
      const c = cache[u];
      if (!force && c && Date.now() - c.t < 12000) return c.rows;
      const r = await api.get(`/api/market/universe?universe=${u}`);
      cache[u] = { t: Date.now(), rows: r.rows };
      return r.rows;
    };

    const drawSorts = () => { $q('#sorts').innerHTML = SORTS.map(([k, l]) => `<button class="chip ${sort === k ? 'on' : ''}" data-s="${k}" aria-pressed="${sort === k}">${l}</button>`).join(''); };

    const draw = (force = false) => ctx.alive() && (async () => {
      const term = fold(q.trim());
      let rows;
      try { rows = await fetchUni(term ? 'bist100' : uni, force); } catch (e) { if (ctx.alive()) $q('#list').innerHTML = errorBox(e); return; }
      if (!ctx.alive()) return;
      if (term) rows = rows.filter((r) => fold(r.symbol).includes(term) || fold(r.name).includes(term));
      rows = [...rows].sort(BY[sort]);
      const code = cleanSym(q);
      const exact = code.length >= 3 && code.length <= 6 && !rows.some((r) => short(r.symbol) === code);
      $q('#list').innerHTML = (exact ? `<a class="mk-open" href="#/stock/${enc(code)}"><span>“${esc(code)}” kodunu aç</span><span>→</span></a>` : '')
        + (rows.length ? rows.map((r) => {
          const on = wl.has(r.symbol);
          return `<div class="mrow" data-sym="${esc(r.symbol)}"><a class="mlink" href="#/stock/${enc(r.symbol)}">
            <div class="mid"><b>${esc(short(r.symbol))}</b><span class="muted small">${esc(r.name)}</span></div>
            <div class="mpx mono"><b>${px(r.price)}</b><span class="${cls(r.change_pct)}">${pct(r.change_pct)}</span></div></a>
            <button type="button" class="star ${on ? 'on' : ''}" data-sym="${esc(r.symbol)}" aria-pressed="${on}" aria-label="${on ? 'Takipten çıkar' : 'Takibe ekle'}">${on ? '★' : '＋'}</button></div>`;
        }).join('') : (exact ? '' : '<div class="empty">Sonuç yok.</div>'));
      const up = rows.filter((r) => r.change_pct > 0).length, dn = rows.filter((r) => r.change_pct < 0).length;
      $q('#info').textContent = `${rows.length} hisse · ${up} yükselen · ${dn} düşen · fiyatlar ~15 dk gecikmeli · 15 sn'de bir yenilenir`;
    })();

    const loadWl = async () => { try { wl = new Set((await api.get('/api/watchlist')).map((w) => w.symbol)); } catch { /* yıldızlar boş kalır */ } };

    root.addEventListener('click', async (e) => {
      const chip = e.target.closest('#sorts .chip');
      if (chip) { sort = chip.dataset.s; store.set('mk_sort', sort); drawSorts(); draw(); return; }
      const star = e.target.closest('button.star');
      if (!star) return;
      const s = star.dataset.sym;
      star.disabled = true;
      try {
        if (wl.has(s)) { await api.del(`/api/watchlist/${enc(s)}`); wl.delete(s); toast(`${short(s)} takipten çıkarıldı`, 'ok', 1800); }
        else { await api.post('/api/watchlist', { symbol: s }); wl.add(s); toast(`${short(s)} takibe eklendi`, 'ok', 1800); }
        const on = wl.has(s);
        star.classList.toggle('on', on); star.textContent = on ? '★' : '＋';
        star.setAttribute('aria-pressed', String(on)); star.setAttribute('aria-label', on ? 'Takipten çıkar' : 'Takibe ekle');
      } catch (err) { toast(err.message, 'err'); } finally { star.disabled = false; }
    });
    $q('#uni').addEventListener('change', (e) => { uni = e.target.value; store.set('mk_uni', uni); draw(); });
    $q('#refresh').addEventListener('click', () => draw(true));
    let tmr = 0;
    $q('#q').addEventListener('input', (e) => { q = e.target.value; clearTimeout(tmr); tmr = setTimeout(draw, 150); });
    $q('#q').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const code = cleanSym(e.target.value);
      if (code.length >= 2) { e.preventDefault(); e.target.blur(); location.hash = `#/stock/${code}`; }
    });

    drawSorts();
    await loadWl();
    await draw();
    ctx.poll(() => { if (document.activeElement !== $q('#q')) draw(true); }, 15000);
  },
};
