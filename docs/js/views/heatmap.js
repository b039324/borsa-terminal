// Isı haritası: kutu büyüklüğü = işlem hacmi (karekök), renk = günlük değişim. Hisse veya sektör gruplu görünüm.
import { api, enc } from '../api.js';
import { cls, errorBox, esc, pct, px, short, store } from '../util.js';

const UNIS = [['bist30', 'BIST 30'], ['bist100', 'BIST 100']];

/** Squarified treemap: items [{v,...}] → [{...,x,y,w,h}] (W×H alanına) */
function treemap(items, W, H) {
  const total = items.reduce((s, i) => s + i.v, 0) || 1;
  const k = (W * H) / total;
  const nodes = items.map((i) => ({ ...i, a: i.v * k }));
  const out = [];
  let x = 0, y = 0, w = W, h = H, row = [];
  const worst = (r, side) => {
    const s = r.reduce((t, n) => t + n.a, 0), mx = Math.max(...r.map((n) => n.a)), mn = Math.min(...r.map((n) => n.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = (r) => {
    const s = r.reduce((t, n) => t + n.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; r.forEach((n) => { const ch = n.a / cw; out.push({ ...n, x, y: cy, w: cw, h: ch }); cy += ch; }); x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; r.forEach((n) => { const cw = n.a / rh; out.push({ ...n, x: cx, y, w: cw, h: rh }); cx += cw; }); y += rh; h -= rh; }
  };
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(w, h), n = nodes[i];
    if (!row.length || worst([...row, n], side) <= worst(row, side)) { row.push(n); i++; } else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

const heatColor = (c) => (c == null ? '#2B333E' : c >= 2 ? '#187A55' : c >= 1 ? '#17674A' : c >= 0.25 ? '#1F5A44' : c > -0.25 ? '#2F3742' : c > -1 ? '#5C3A3A' : c > -2 ? '#8A3A3A' : '#A63232');
const LEGEND = [['≤-2', '#A63232'], ['-1', '#8A3A3A'], ['-0,25', '#5C3A3A'], ['0', '#2F3742'], ['+0,25', '#1F5A44'], ['+1', '#17674A'], ['≥+2', '#187A55']];

function tileHTML(r, t) {
  const big = t.w >= 74 && t.h >= 54, mid = t.w >= 52 && t.h >= 38, s = short(r.symbol);
  const inner = big ? `<b>${esc(s)}</b><span class="mono">${px(r.price)}</span><em class="mono">${pct(r.change_pct)}</em>` : mid ? `<b>${esc(s)}</b><em class="mono">${pct(r.change_pct)}</em>` : `<b>${esc(s)}</b>`;
  return `<a class="hmt ${big ? 'big' : mid ? 'mid' : 'sm'}" href="#/stock/${enc(r.symbol)}" style="left:${t.x.toFixed(1)}px;top:${t.y.toFixed(1)}px;width:${t.w.toFixed(1)}px;height:${t.h.toFixed(1)}px;background:${heatColor(r.change_pct)}" aria-label="${esc(s)} ${px(r.price)} ${pct(r.change_pct)}">${inner}</a>`;
}

export default {
  async mount(root, _p, ctx) {
    let uni = store.get('hm_uni', 'bist30'), mode = store.get('hm_mode', 'stock'), rows = [];
    if (!UNIS.some(([k]) => k === uni)) uni = 'bist30';
    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Isı Haritası</h2>
        <div class="toolbar"><select id="uni" aria-label="Endeks">${UNIS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <div class="seg" id="mode" role="group" aria-label="Görünüm"><button type="button" data-v="stock">Hisse</button><button type="button" data-v="sector">Sektör</button></div>
          <button class="btn sm" id="refresh">↻ Yenile</button></div></div>
      <section class="card">
        <div class="muted small" id="sub">Yükleniyor…</div>
        <div id="box" class="hm"></div>
        <div class="hm-leg mono" aria-hidden="true">${LEGEND.map(([l, c]) => `<span style="background:${c}">${l}</span>`).join('')}</div>
        <div class="muted small foot">Kutu büyüklüğü işlem hacmine (karekök), renk günlük değişime (%) göre. Sektörler genel sınıflamadır; başlıktaki yüzde hacim ağırlıklı ortalamadır. Bir kutuya basınca hisse açılır.</div>
      </section>`;
    const $q = (s) => root.querySelector(s);
    const box = $q('#box');
    $q('#uni').value = uni;
    const markMode = () => root.querySelectorAll('#mode button').forEach((b) => { b.classList.toggle('on', b.dataset.v === mode); b.setAttribute('aria-pressed', String(b.dataset.v === mode)); });
    markMode();

    const vol = (r) => Math.sqrt(Math.max(r.turnover || 0, 1));
    const paint = () => {
      if (!rows.length) { box.innerHTML = '<div class="empty">Veri alınamadı.</div>'; return; }
      const W = box.clientWidth, H = box.clientHeight;
      if (mode === 'sector') {
        const groups = {};
        rows.forEach((r) => { (groups[r.sector] = groups[r.sector] || []).push(r); });
        const gItems = Object.entries(groups).map(([name, arr]) => ({ name, arr, v: arr.reduce((t, r) => t + vol(r), 0) })).sort((a, b) => b.v - a.v);
        box.innerHTML = treemap(gItems, W, H).map((g) => {
          const inset = 2, lab = g.w >= 64 && g.h >= 52 ? 16 : 0;
          const ix = g.x + inset, iy = g.y + inset + lab, iw = g.w - 2 * inset, ih = g.h - 2 * inset - lab;
          if (iw < 10 || ih < 10) return '';
          const wsum = g.arr.reduce((t, r) => t + (r.turnover || 1), 0);
          const avg = g.arr.reduce((t, r) => t + (r.change_pct || 0) * (r.turnover || 1), 0) / wsum;
          const inner = treemap(g.arr.map((r) => ({ r, v: vol(r) })).sort((a, b) => b.v - a.v), iw, ih);
          return `<div class="hmg" style="left:${g.x.toFixed(1)}px;top:${g.y.toFixed(1)}px;width:${g.w.toFixed(1)}px;height:${g.h.toFixed(1)}px">${lab ? `<span class="hmgl">${esc(g.name)} <em class="mono ${cls(avg)}">${pct(avg, 1)}</em></span>` : ''}</div>`
            + inner.map((t) => tileHTML(t.r, { x: ix + t.x, y: iy + t.y, w: t.w, h: t.h })).join('');
        }).join('');
      } else {
        box.innerHTML = treemap(rows.map((r) => ({ r, v: vol(r) })).sort((a, b) => b.v - a.v), W, H).map((t) => tileHTML(t.r, t)).join('');
      }
      const up = rows.filter((r) => r.change_pct > 0).length, dn = rows.filter((r) => r.change_pct < 0).length;
      $q('#sub').textContent = `${up} yükselen · ${dn} düşen · ${rows.length - up - dn} değişmeyen · ~15 dk gecikmeli · 15 sn'de bir yenilenir`;
    };
    const size = () => { box.style.height = Math.max(360, Math.min(640, window.innerHeight - 330)) + 'px'; };

    const load = async () => {
      try { rows = (await api.get(`/api/market/universe?universe=${uni}`)).rows; } catch (e) { if (ctx.alive()) box.innerHTML = errorBox(e); return; }
      if (ctx.alive()) paint();
    };

    root.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.v; store.set('hm_mode', mode); markMode(); paint(); }));
    $q('#uni').addEventListener('change', async (e) => { uni = e.target.value; store.set('hm_uni', uni); box.innerHTML = ''; await load(); });
    $q('#refresh').addEventListener('click', load);
    let tmr = 0;
    const onResize = () => { clearTimeout(tmr); tmr = setTimeout(() => { size(); paint(); }, 150); };
    window.addEventListener('resize', onResize);
    ctx.onCleanup(() => window.removeEventListener('resize', onResize));

    size();
    await load();
    ctx.poll(load, 15000);
  },
};
