import { api, enc } from '../api.js';
import { buildLines } from '../charts.js';
import { cls, errorBox, esc, num, pct, short, skeleton, store, toast } from '../util.js';

const RANGES = [['1mo', '1A'], ['3mo', '3A'], ['6mo', '6A'], ['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y']];

const corrColor = (v) => {
  const a = Math.min(1, Math.abs(v));
  return v >= 0 ? `rgba(22,199,132,${(a * 0.55).toFixed(2)})` : `rgba(234,57,67,${(a * 0.55).toFixed(2)})`;
};

export default {
  async mount(root, _p, ctx) {
    let syms = store.get('cmp_syms', ['THYAO.IS', 'GARAN.IS', 'XU100.IS']);
    let range = store.get('cmp_range', '1y');
    let ctl;
    ctx.onCleanup(() => ctl?.destroy());
    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Hisse Karşılaştırma</h2></div>
      <section class="card">
        <div class="toolbar wrap"><div class="chips" id="chips"></div>
          <form id="add" class="inline-form"><input name="s" placeholder="Sembol ekle (en fazla 6)" maxlength="20"><button class="btn sm">Ekle</button></form>
          <div class="seg" id="rng">${RANGES.map(([k, l]) => `<button data-r="${k}" class="${k === range ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div id="chart" class="chart"></div>
        <div class="muted small">Başlangıç = %0 olacak şekilde normalize edilmiş getiri (fiyat getirisi).</div>
      </section>
      <div class="grid cols-2"><section class="card"><h3>İstatistikler</h3><div id="stats"></div></section>
      <section class="card"><h3>Korelasyon (günlük getiriler)</h3><div id="corr"></div></section></div>`;

    const q = (s) => root.querySelector(s);
    const paintChips = () => {
      q('#chips').innerHTML = syms.map((s) => `<span class="chip on">${esc(short(s))} <button class="x" data-rm="${esc(s)}" aria-label="${esc(s)} kaldır">✕</button></span>`).join('');
    };

    const load = async () => {
      paintChips();
      store.set('cmp_syms', syms); store.set('cmp_range', range);
      if (syms.length < 2) { q('#chart').innerHTML = '<div class="empty">Karşılaştırma için en az iki sembol ekleyin.</div>'; q('#stats').innerHTML = ''; q('#corr').innerHTML = ''; return; }
      q('#stats').innerHTML = skeleton(1);
      try {
        const d = await api.get(`/api/compare?symbols=${enc(syms.join(','))}&range=${range}`);
        if (!ctx.alive()) return;
        ctl?.destroy();
        ctl = buildLines(q('#chart'), d.series.map((s) => ({ name: short(s.symbol), points: s.points })), { percent: true });
        q('#stats').innerHTML = `<table class="tbl compact"><thead><tr><th>Sembol</th><th class="r">Getiri</th><th class="r">Volatilite (yıllık)</th><th class="r">Maks. düşüş</th></tr></thead><tbody>
          ${d.stats.map((s) => `<tr><td><b>${esc(short(s.symbol))}</b><div class="muted small">${esc(s.name)}</div></td><td class="r mono ${cls(s.return)}">${pct(s.return, 1)}</td><td class="r mono">${pct(s.volatility, 1, false)}</td><td class="r mono down">${pct(s.max_drawdown, 1)}</td></tr>`).join('')}</tbody></table>`;
        const c = d.correlation;
        q('#corr').innerHTML = `<table class="tbl corr"><thead><tr><th></th>${c.symbols.map((s) => `<th class="r">${esc(short(s))}</th>`).join('')}</tr></thead><tbody>
          ${c.matrix.map((row, i) => `<tr><th>${esc(short(c.symbols[i]))}</th>${row.map((v) => `<td class="r mono" style="background:${corrColor(v)}">${num(v, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table>
          <div class="muted small">1'e yakın: birlikte hareket eder (çeşitlendirme az). 0 veya negatif: çeşitlendirme avantajı.</div>`;
      } catch (e) { q('#chart').innerHTML = errorBox(e); q('#stats').innerHTML = ''; q('#corr').innerHTML = ''; }
    };

    q('#add').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.s.value.trim().toUpperCase();
      if (!v) return;
      if (syms.length >= 6) return toast('En fazla 6 sembol', 'err');
      if (!syms.includes(v)) syms.push(v); // sunucu çözümler: THYAO -> THYAO.IS, US:AAPL -> AAPL
      e.target.s.value = '';
      load();
    });
    q('#chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]');
      if (b) { syms = syms.filter((s) => s !== b.dataset.rm); load(); }
    });
    q('#rng').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      range = b.dataset.r;
      q('#rng').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      load();
    });
    await load();
  },
};
