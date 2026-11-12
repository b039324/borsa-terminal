import { api, enc } from '../api.js';
import { esc, px, short, skeleton, toast } from '../util.js';

const COND = { above: 'Fiyat şu değere ulaşırsa/üstüne çıkarsa (≥)', below: 'Fiyat şu değere inerse/altına düşerse (≤)', chg_up: 'Günlük yükseliş % şu kadar olursa (≥)', chg_down: 'Günlük düşüş % şu kadar olursa (≥)' };

export default {
  async mount(root, _p, ctx) {
    root.innerHTML = `
      <h2 class="page-title">Fiyat Alarmları</h2>
      <section class="card"><h3>Yeni Alarm</h3>
        <form id="f" class="form-grid">
          <label>Sembol<input name="symbol" required placeholder="THYAO" maxlength="20"></label>
          <label>Koşul<select name="condition">${Object.entries(COND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>Değer<input name="value" type="number" step="any" min="0" required></label>
          <label>Not<input name="note" maxlength="200" placeholder="isteğe bağlı"></label>
          <button class="btn primary">Alarm Kur</button>
        </form>
        <div class="muted small">Alarmlar sunucu açıkken arka planda her dakika kontrol edilir; tetiklenince bu sayfada bildirim çıkar (tarayıcı izni verirseniz masaüstü bildirimi de gelir). Veri 15 dk gecikmelidir.</div>
      </section>
      <section class="card"><div id="list">${skeleton(2)}</div></section>`;

    const load = async () => {
      const rows = await api.get('/api/alerts');
      if (!ctx.alive()) return;
      const act = rows.filter((r) => r.active), done = rows.filter((r) => !r.active);
      const tr = (r, isActive) => `<tr data-id="${r.id}"><td><a href="#/stock/${enc(r.symbol)}"><b>${esc(short(r.symbol))}</b></a></td>
        <td>${esc(r.label)} <b>${r.value}</b></td>
        <td class="r mono">${isActive ? px(r.price) : px(r.triggered_price)}</td>
        <td class="muted small">${esc(r.note || '')}</td><td class="small">${isActive ? esc(r.created_at.replace('T', ' ')) : esc((r.triggered_at || '').replace('T', ' '))}</td>
        <td class="r">${isActive ? '' : '<button class="btn sm" data-re>Yeniden kur</button> '}<button class="btn ghost sm" data-del>Sil</button></td></tr>`;
      root.querySelector('#list').innerHTML = `
        <h3>Aktif Alarmlar (${act.length})</h3>
        ${act.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Sembol</th><th>Koşul</th><th class="r">Güncel</th><th>Not</th><th>Kuruldu</th><th></th></tr></thead><tbody>${act.map((r) => tr(r, true)).join('')}</tbody></table></div>` : '<div class="empty small">Aktif alarm yok.</div>'}
        <h3 class="mt">Tetiklenenler (${done.length})</h3>
        ${done.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Sembol</th><th>Koşul</th><th class="r">Tetik fiyatı</th><th>Not</th><th>Zaman</th><th></th></tr></thead><tbody>${done.map((r) => tr(r, false)).join('')}</tbody></table></div>` : '<div class="empty small">Henüz tetiklenen alarm yok.</div>'}`;
    };

    root.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const r = await api.post('/api/alerts', { ...f, value: Number(f.value) });
        toast(`${short(r.symbol)} alarmı kuruldu (güncel fiyat ${px(r.price)})`, 'ok');
        e.target.value.value = '';
        await load();
      } catch (err) { toast(err.message, 'err'); }
    });
    root.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      if (e.target.closest('[data-del]')) await api.del(`/api/alerts/${tr.dataset.id}`);
      else if (e.target.closest('[data-re]')) await api.post(`/api/alerts/${tr.dataset.id}/reactivate`);
      else return;
      await load();
    });

    await load();
    ctx.poll(() => load().catch(() => {}), 15000);
  },
};
