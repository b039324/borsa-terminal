import { api, enc } from '../api.js';
import { buildLines } from '../charts.js';
import { chg, cls, curSym, errorBox, esc, modal, money, num, pct, px, short, skeleton, store, toast, today } from '../util.js';

const PALETTE = ['#4c8dff', '#16c784', '#f5a623', '#e84393', '#9b59b6', '#00cec9', '#fdcb6e', '#ea3943', '#a29bfe', '#55efc4', '#fab1a0', '#74b9ff'];
const TYPE_TR = { BUY: 'Alış', SELL: 'Satış', DIVIDEND: 'Temettü' };

function donut(items, title) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const segs = items.map((it, i) => {
    const len = (it.value / total) * C;
    const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(it.label)}: ${pct((it.value / total) * 100, 1, false)}</title></circle>`;
    off += len;
    return s;
  }).join('');
  return `<div class="donut-card"><h4>${title}</h4><div class="donut-row"><svg viewBox="0 0 140 140" class="donut" role="img" aria-label="${title}">${segs}</svg>
    <ul class="legend-list">${items.map((it, i) => `<li><i style="background:${PALETTE[i % PALETTE.length]}"></i><span>${esc(it.label)}</span><b>${pct((it.value / total) * 100, 1, false)}</b></li>`).join('')}</ul></div></div>`;
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV boş');
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l, n) => {
    const c = l.split(sep);
    const r = Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
    if (!r.symbol || !r.date || !r.quantity || r.price === undefined) throw new Error(`Satır ${n + 2} eksik: symbol,date,type,quantity,price zorunlu`);
    return { symbol: r.symbol, date: r.date, type: (r.type || 'BUY').toUpperCase(), quantity: +r.quantity.replace(',', '.'), price: +r.price.replace(',', '.'), fee: +(r.fee || '0').replace(',', '.'), note: r.note || '' };
  });
}

export default {
  async mount(root, _p, ctx) {
    const pfs = await api.get('/api/portfolios');
    let pid = store.get('pid', pfs[0].id);
    if (!pfs.some((p) => p.id === pid)) pid = pfs[0].id;
    let hist;

    root.innerHTML = `
      <div class="page-head"><h2 class="page-title">Portföy</h2>
        <div class="toolbar">
          <select id="pf-select" aria-label="Portföy seç"></select>
          <button class="btn sm" id="pf-new">＋ Yeni</button><button class="btn sm ghost" id="pf-del">Sil</button>
          <a class="btn sm" id="pf-export">⬇ CSV</a>
          <label class="btn sm">⬆ İçe aktar<input type="file" id="pf-import" accept=".csv,text/csv" hidden></label>
        </div></div>
      <div id="kpis">${skeleton(1)}</div>
      <div class="grid cols-2-1">
        <section class="card"><h3>Pozisyonlar</h3><div id="positions">${skeleton(2)}</div></section>
        <section class="card" id="alloc"></section>
      </div>
      <section class="card"><h3>Portföy Değeri (güncel kurla, ₺)</h3><div id="hist" class="chart short"></div><div class="muted small">Yatırılan = alışlar − satışlar (net nakit akışı). Tarihsel kur kullanılmaz.</div></section>
      <section class="card"><h3>İşlem Ekle</h3>
        <form id="tx" class="form-grid">
          <label>Sembol<input name="symbol" required maxlength="20" placeholder="THYAO"></label>
          <label>İşlem<select name="type"><option value="BUY">Alış</option><option value="SELL">Satış</option><option value="DIVIDEND">Temettü</option></select></label>
          <label>Adet<input name="quantity" type="number" step="any" min="0" required></label>
          <label><span>Fiyat <button type="button" class="link" id="fill">güncel fiyat</button></span><input name="price" type="number" step="any" min="0" required></label>
          <label>Masraf<input name="fee" type="number" step="any" min="0" value="0"></label>
          <label>Tarih<input name="date" type="date" required value="${today()}"></label>
          <label>Not<input name="note" maxlength="300"></label>
          <button class="btn primary">Kaydet</button>
        </form>
        <div class="muted small">Temettü için adet = sahip olunan lot, fiyat = hisse başına temettü. Satışlar eldeki adedi aşamaz. Maliyet yöntemi: ağırlıklı ortalama.</div>
      </section>
      <section class="card"><h3>İşlem Geçmişi</h3><div id="txs">${skeleton(1)}</div></section>`;

    const sel = root.querySelector('#pf-select');
    const fillSelect = (list) => { sel.innerHTML = list.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join(''); };
    fillSelect(pfs);
    const q = (s) => root.querySelector(s);
    let chartCtl;
    ctx.onCleanup(() => chartCtl?.destroy());

    const kpi = (label, value, sub, c = '') => `<div class="kpi"><div class="label">${label}</div><div class="value ${c}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

    const loadSummary = async () => {
      const s = await api.get(`/api/portfolios/${pid}/summary`);
      if (!ctx.alive()) return;
      const t = s.totals;
      q('#kpis').innerHTML = `<div class="kpis">${kpi('Toplam Değer', money(t.value_try, 'TRY', 0), `Maliyet ${money(t.cost_try, 'TRY', 0)}`)}
        ${kpi('Gerçekleşmemiş K/Z', money(t.pnl_try, 'TRY', 0), chg(t.pnl_pct), cls(t.pnl_try))}
        ${kpi('Bugün', money(t.day_pnl_try, 'TRY', 0), chg(t.day_pnl_pct), cls(t.day_pnl_try))}
        ${kpi('Gerçekleşen K/Z', money(t.realized_try, 'TRY', 0), '', cls(t.realized_try))}
        ${kpi('Temettü Geliri', money(t.dividends_try, 'TRY', 0))}
        ${kpi('Toplam Getiri', money(t.total_return_try, 'TRY', 0), 'K/Z + gerçekleşen + temettü', cls(t.total_return_try))}</div>`;
      q('#positions').innerHTML = s.positions.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Sembol</th><th class="r">Adet</th><th class="r">Ort. Maliyet</th><th class="r">Son</th><th class="r">Gün</th><th class="r">Değer</th><th class="r">K/Z</th><th class="r">K/Z %</th><th class="r">Ağırlık</th></tr></thead><tbody>
        ${s.positions.map((p) => `<tr class="clickable" onclick="location.hash='#/stock/${enc(p.symbol)}'"><td><b>${esc(short(p.symbol))}</b><div class="muted small">${esc(p.sector)}</div></td>
          <td class="r mono">${num(p.qty, p.qty % 1 ? 4 : 0)}</td><td class="r mono">${px(p.avg)}</td><td class="r mono">${px(p.last)}${p.stale ? ' ⚠' : ''}</td><td class="r">${chg(p.change_pct)}</td>
          <td class="r mono">${num(p.value, 0)} ${curSym(p.currency)}</td><td class="r mono ${cls(p.pnl)}">${p.pnl > 0 ? '+' : ''}${num(p.pnl, 0)}</td><td class="r">${chg(p.pnl_pct)}</td><td class="r mono">${pct(p.weight, 1, false)}</td></tr>`).join('')}
        </tbody></table></div><div class="muted small">${esc(s.note)}</div>` : '<div class="empty">Pozisyon yok. Aşağıdan ilk alımınızı ekleyin.</div>';
      q('#alloc').innerHTML = s.positions.length
        ? donut(s.positions.map((p) => ({ label: short(p.symbol), value: p.value_try })), 'Hisse Dağılımı') + donut(s.allocation_sector.map((x) => ({ label: x.sector, value: x.value_try })), 'Sektör Dağılımı')
        : '<div class="empty small">Dağılım için pozisyon gerekli.</div>';
    };

    const loadHistory = async () => {
      hist = await api.get(`/api/portfolios/${pid}/history`);
      if (!ctx.alive()) return;
      const el = q('#hist');
      chartCtl?.destroy();
      if (!hist.dates.length) { el.innerHTML = '<div class="empty small">Grafik için alış/satış işlemi gerekli.</div>'; return; }
      const pts = (arr) => hist.dates.map((d, i) => ({ time: d, value: arr[i] }));
      chartCtl = buildLines(el, [{ name: 'Değer', type: 'area', points: pts(hist.value) }, { name: 'Yatırılan', color: '#f5a623', points: pts(hist.invested) }], { fmt: (v) => Math.round(v).toLocaleString('tr-TR') });
    };

    const loadTx = async () => {
      const tx = await api.get(`/api/portfolios/${pid}/transactions`);
      if (!ctx.alive()) return;
      q('#txs').innerHTML = tx.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Tarih</th><th>Sembol</th><th>İşlem</th><th class="r">Adet</th><th class="r">Fiyat</th><th class="r">Masraf</th><th class="r">Tutar</th><th>Not</th><th></th></tr></thead><tbody>
        ${tx.map((t) => `<tr data-id="${t.id}"><td>${esc(t.date)}</td><td><b>${esc(short(t.symbol))}</b></td><td><span class="pill ${t.type === 'BUY' ? 'up' : t.type === 'SELL' ? 'down' : 'flat'}">${TYPE_TR[t.type]}</span></td>
          <td class="r mono">${num(t.quantity, t.quantity % 1 ? 4 : 0)}</td><td class="r mono">${px(t.price)}</td><td class="r mono">${num(t.fee)}</td><td class="r mono">${num(t.quantity * t.price, 2)} ${curSym(t.currency)}</td><td class="muted small">${esc(t.note)}</td>
          <td><button class="btn ghost sm" data-del title="Sil">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">İşlem yok.</div>';
    };

    const reload = async () => {
      await Promise.all([loadSummary(), loadHistory(), loadTx()].map((p) => p.catch((e) => toast(e.message, 'err'))));
    };

    q('#pf-export').addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const r = await api.get(`/api/portfolios/${pid}/export.csv`);
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([r.__csv], { type: 'text/csv;charset=utf-8' })), download: r.filename });
        a.click(); URL.revokeObjectURL(a.href);
      } catch (err) { toast(err.message, 'err'); }
    });

    // --- olaylar
    sel.addEventListener('change', () => { pid = +sel.value; store.set('pid', pid); reload(); });
    q('#pf-new').addEventListener('click', () => {
      const m = modal('Yeni Portföy', '<form id="mf" class="form-grid one"><label>Ad<input name="name" required maxlength="60"></label><button class="btn primary">Oluştur</button></form>');
      m.el.querySelector('#mf').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await api.post('/api/portfolios', { name: e.target.name.value });
          pid = r.id; store.set('pid', pid);
          fillSelect(await api.get('/api/portfolios'));
          m.close(); reload();
        } catch (err) { toast(err.message, 'err'); }
      });
    });
    q('#pf-del').addEventListener('click', async () => {
      if (!confirm('Bu portföy ve tüm işlemleri silinsin mi?')) return;
      try {
        await api.del(`/api/portfolios/${pid}`);
        const list = await api.get('/api/portfolios');
        pid = list[0].id; store.set('pid', pid); fillSelect(list); reload();
      } catch (err) { toast(err.message, 'err'); }
    });
    q('#pf-import').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const rows = parseCsv(await f.text());
        const r = await api.post(`/api/portfolios/${pid}/import`, { rows });
        toast(`${r.imported} işlem içe aktarıldı`, 'ok');
        reload();
      } catch (err) { toast(err.message, 'err', 8000); }
      e.target.value = '';
    });
    q('#fill').addEventListener('click', async () => {
      const s = q('#tx').symbol.value.trim();
      if (!s) return toast('Önce sembol girin', 'err', 2000);
      try { q('#tx').price.value = (await api.get(`/api/stock/${enc(s)}/quote`)).price; } catch (err) { toast(err.message, 'err'); }
    });
    q('#tx').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        await api.post(`/api/portfolios/${pid}/transactions`, { ...f, quantity: +f.quantity, price: +f.price, fee: +f.fee });
        toast('İşlem kaydedildi', 'ok');
        e.target.quantity.value = ''; e.target.price.value = ''; e.target.note.value = '';
        reload();
      } catch (err) { toast(err.message, 'err', 7000); }
    });
    q('#txs').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del]');
      if (!b || !confirm('İşlem silinsin mi?')) return;
      try { await api.del(`/api/transactions/${b.closest('tr').dataset.id}`); reload(); } catch (err) { toast(err.message, 'err', 7000); }
    });

    await reload();
    ctx.poll(() => loadSummary().catch(() => {}), 30000);
  },
};
