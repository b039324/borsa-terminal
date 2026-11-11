import { api, enc } from '../api.js';
import { chg, big, esc, flash, px, rangeBar, short, skeleton, sortRows, toast } from '../util.js';

export default {
  async mount(root, _p, ctx) {
    let rows = [];
    let sort = { key: 'symbol', dir: 1 };
    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Takip Listesi</h2>
        <form id="add" class="inline-form"><input name="symbol" placeholder="Sembol ekle (THYAO, US:AAPL…)" required maxlength="20"><button class="btn primary">Ekle</button></form>
      </div>
      <section class="card"><div id="tbl">${skeleton(3)}</div><div class="muted small foot">Fiyatlar ~15 dk gecikmeli · 30 sn'de bir yenilenir · <span id="upd"></span></div></section>`;

    const head = (k, label, cls = '') => `<th class="sortable ${cls}" data-k="${k}">${label}${sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    let built = false;

    const paint = () => {
      const el = root.querySelector('#tbl');
      if (!rows.length) { el.innerHTML = '<div class="empty">Takip listeniz boş. Yukarıdan sembol ekleyin veya bir hisse sayfasında ★ simgesine basın.</div>'; built = false; return; }
      const sorted = sortRows(rows, sort.key, sort.dir);
      el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr>${head('symbol', 'Sembol')}${head('price', 'Fiyat', 'r')}${head('change', 'Değişim', 'r')}${head('change_pct', '%', 'r')}${head('volume', 'Hacim', 'r')}<th>Gün Aralığı</th><th>52 Hafta</th><th>Not</th><th></th></tr></thead>
        <tbody>${sorted.map((w) => `<tr data-sym="${esc(w.symbol)}">
          <td><a href="#/stock/${enc(w.symbol)}"><b>${esc(short(w.symbol))}</b></a><div class="muted small">${esc(w.name || '')}</div></td>
          <td class="r mono c-px"></td><td class="r mono c-chg"></td><td class="r c-pct"></td>
          <td class="r mono">${big(w.volume)}</td>
          <td class="c-day">${rangeBar(w.low, w.high, w.price)}</td><td class="c-52">${rangeBar(w.year_low, w.year_high, w.price)}</td>
          <td><input class="note" value="${esc(w.note)}" placeholder="not…" maxlength="300" aria-label="Not"></td>
          <td><button class="btn ghost sm" data-del title="Listeden çıkar">✕</button></td></tr>`).join('')}</tbody></table></div>`;
      built = true;
      update();
    };

    const update = () => {
      rows.forEach((w) => {
        const tr = root.querySelector(`tr[data-sym="${CSS.escape(w.symbol)}"]`);
        if (!tr) return;
        flash(tr.querySelector('.c-px'), w.stale ? '—' : px(w.price), w.price);
        tr.querySelector('.c-chg').textContent = w.change == null ? '—' : (w.change > 0 ? '+' : '') + px(w.change);
        tr.querySelector('.c-chg').className = 'r mono c-chg ' + (w.change > 0 ? 'up' : w.change < 0 ? 'down' : '');
        tr.querySelector('.c-pct').innerHTML = chg(w.change_pct);
        tr.querySelector('.c-day').innerHTML = rangeBar(w.low, w.high, w.price);
      });
      const u = rows.find((r) => r.updated)?.updated;
      root.querySelector('#upd').textContent = u ? `Son güncelleme: ${u}` : '';
    };

    const load = async () => {
      rows = await api.get('/api/watchlist');
      if (!ctx.alive()) return;
      if (!built || root.querySelectorAll('#tbl tbody tr').length !== rows.length) paint(); else update();
    };

    root.addEventListener('click', async (e) => {
      const th = e.target.closest('th.sortable');
      if (th) { sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : 1 }; paint(); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        await api.del(`/api/watchlist/${enc(del.closest('tr').dataset.sym)}`);
        await load();
      }
    });
    root.addEventListener('change', async (e) => {
      if (e.target.classList.contains('note')) {
        await api.put(`/api/watchlist/${enc(e.target.closest('tr').dataset.sym)}/note`, { note: e.target.value });
        toast('Not kaydedildi', 'ok', 1500);
      }
    });
    root.querySelector('#add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.symbol;
      try {
        const r = await api.post('/api/watchlist', { symbol: input.value });
        toast(`${r.symbol} eklendi`, 'ok');
        input.value = '';
        await load();
      } catch (err) { toast(err.message, 'err'); }
    });

    try { await load(); } catch (e) { root.querySelector('#tbl').innerHTML = `<div class="err">⚠ ${esc(e.message)}</div>`; }
    ctx.poll(() => load().catch(() => {}), 30000);
  },
};
