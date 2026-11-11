import { api, enc } from '../api.js';
import { big, chg, errorBox, esc, num, pct, px, short, signalClass, skeleton, sortRows, store } from '../util.js';

const FILTERS = [
  ['buy', 'Sinyal: AL / GÜÇLÜ AL', (r) => r.score >= 0.1],
  ['sell', 'Sinyal: SAT / GÜÇLÜ SAT', (r) => r.score <= -0.1],
  ['oversold', 'RSI < 30 (aşırı satım)', (r) => r.rsi != null && r.rsi < 30],
  ['overbought', 'RSI > 70 (aşırı alım)', (r) => r.rsi != null && r.rsi > 70],
  ['above200', 'SMA200 üstünde', (r) => r.above_sma200 === true],
  ['below200', 'SMA200 altında', (r) => r.above_sma200 === false],
  ['golden', 'SMA50 > SMA200 (yükseliş trendi)', (r) => (r.trend || '').startsWith('Yükseliş') || (r.trend || '').startsWith('Altın')],
  ['volume', 'Hacim ≥ 1,5× ortalama', (r) => (r.volume_ratio || 0) >= 1.5],
  ['near_high', '52H zirveye %5 içinde', (r) => r.from_high_pct != null && r.from_high_pct >= -5],
  ['macd', 'MACD pozitif', (r) => r.macd_up],
];

export default {
  async mount(root, _p, ctx) {
    let rows = [], uni = store.get('uni', 'bist30');
    const active = new Set(store.get('scr_filters', []));
    let sort = { key: 'score', dir: -1 };
    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Teknik Tarayıcı</h2>
        <div class="toolbar"><select id="uni"><option value="bist30">BIST 30</option><option value="bist50">BIST 50 (geniş liste)</option></select><button class="btn sm" id="refresh">↻ Yenile</button></div></div>
      <section class="card"><div class="chips" id="flt">${FILTERS.map(([k, l]) => `<button class="chip ${active.has(k) ? 'on' : ''}" data-k="${k}" aria-pressed="${active.has(k)}">${l}</button>`).join('')}</div>
        <div class="muted small">Seçili filtrelerin tümünü sağlayan hisseler listelenir. Günlük veriden hesaplanır; sinyal puanı osilatör ve ortalama sinyallerinin birleşimidir.</div></section>
      <section class="card"><div id="res">${skeleton(3)}</div></section>`;
    root.querySelector('#uni').value = uni;

    const paint = () => {
      const fl = FILTERS.filter(([k]) => active.has(k));
      const list = sortRows(rows.filter((r) => fl.every(([, , f]) => f(r))), sort.key, sort.dir);
      const th = (k, l, c = '') => `<th class="sortable ${c}" data-k="${k}">${l}${sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
      root.querySelector('#res').innerHTML = `<div class="muted small">${list.length} / ${rows.length} hisse</div><div class="table-wrap"><table class="tbl"><thead><tr>${th('symbol', 'Sembol')}${th('price', 'Fiyat', 'r')}${th('change_pct', 'Gün %', 'r')}${th('rsi', 'RSI', 'r')}${th('ret_1a', '1A %', 'r')}${th('ret_3a', '3A %', 'r')}${th('from_high_pct', '52H Zirve', 'r')}${th('volume_ratio', 'Hacim×', 'r')}<th>Trend</th>${th('score', 'Sinyal', 'r')}</tr></thead><tbody>
        ${list.map((r) => `<tr class="clickable" onclick="location.hash='#/stock/${enc(r.symbol)}'"><td><b>${esc(short(r.symbol))}</b><div class="muted small">${esc(r.name)}</div></td>
          <td class="r mono">${px(r.price)}</td><td class="r">${chg(r.change_pct)}</td>
          <td class="r mono ${r.rsi < 30 ? 'up' : r.rsi > 70 ? 'down' : ''}">${num(r.rsi, 1)}</td><td class="r">${chg(r.ret_1a, 1)}</td><td class="r">${chg(r.ret_3a, 1)}</td>
          <td class="r mono">${pct(r.from_high_pct, 1)}</td><td class="r mono">${r.volume_ratio != null ? num(r.volume_ratio, 2) : '—'}</td>
          <td class="small muted">${esc((r.trend || '').split(' (')[0])}</td><td class="r"><span class="pill ${signalClass(r.signal)}">${r.signal}</span></td></tr>`).join('') || '<tr><td colspan="10" class="empty">Filtrelere uyan hisse yok.</td></tr>'}</tbody></table></div>`;
    };

    const load = async () => {
      root.querySelector('#res').innerHTML = skeleton(3);
      try {
        const d = await api.get(`/api/screener?universe=${uni}`);
        if (!ctx.alive()) return;
        rows = d.rows;
        paint();
      } catch (e) { if (ctx.alive()) root.querySelector('#res').innerHTML = errorBox(e); }
    };

    root.querySelector('#uni').addEventListener('change', (e) => { uni = e.target.value; store.set('uni', uni); load(); });
    root.querySelector('#refresh').addEventListener('click', load);
    root.querySelector('#flt').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      active.has(b.dataset.k) ? active.delete(b.dataset.k) : active.add(b.dataset.k);
      b.classList.toggle('on'); b.setAttribute('aria-pressed', active.has(b.dataset.k));
      store.set('scr_filters', [...active]);
      paint();
    });
    root.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (th) { sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : -1 }; paint(); }
    });
    await load();
    ctx.poll(load, 120000);
  },
};
