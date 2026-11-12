import { api, enc } from '../api.js';
import { chg, big, esc, flash, money, px, short, signalClass, skeleton, num, pct, cls } from '../util.js';

const GROUPS = ['TR', 'Döviz', 'Emtia', 'Global', 'Kripto'];
const GROUP_TITLES = { TR: 'Türkiye', Döviz: 'Döviz', Emtia: 'Emtia', Global: 'Global Endeksler', Kripto: 'Kripto' };

const href = (s) => (s === 'GRAM-ALTIN' ? '#/stock/GC=F' : `#/stock/${enc(s)}`);

function moverTable(title, rows, kind) {
  return `<section class="card"><h3>${title}</h3><table class="tbl compact"><tbody>${rows.map((r) => `
    <tr onclick="location.hash='#/stock/${enc(r.symbol)}'" class="clickable">
      <td><b>${esc(short(r.symbol))}</b><div class="muted small">${esc(r.name)}</div></td>
      <td class="r mono">${px(r.price)}</td>
      <td class="r">${kind === 'active' ? `<span class="mono">${big(r.turnover)}</span><div class="small">${chg(r.change_pct)}</div>` : chg(r.change_pct)}</td>
    </tr>`).join('') || '<tr><td class="muted">Veri yok</td></tr>'}</tbody></table></section>`;
}

export default {
  async mount(root, _p, ctx) {
    root.innerHTML = `
      <h2 class="page-title">Piyasa Paneli</h2>
      <div id="overview">${skeleton(2)}</div>
      <div class="grid cols-3" id="movers">${skeleton(1)}</div>
      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h3>Takip Listem</h3><a href="#/watchlist" class="small">Tümü →</a></div><div id="wl-mini">${skeleton(1)}</div></section>
        <section class="card"><div class="card-head"><h3>Portföyüm</h3><a href="#/portfolio" class="small">Detay →</a></div><div id="pf-mini">${skeleton(1)}</div></section>
      </div>`;

    let built = false;
    const loadOverview = async () => {
      const items = await api.get('/api/market/overview');
      if (!ctx.alive()) return;
      const el = root.querySelector('#overview');
      if (!built) {
        el.innerHTML = GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g);
          return list.length ? `<h4 class="group-title">${GROUP_TITLES[g]}</h4><div class="tiles">${list.map((i) => `
            <a class="tile" href="${href(i.symbol)}" data-sym="${esc(i.symbol)}">
              <div class="tile-name">${esc(i.name)}</div>
              <div class="tile-px mono"></div><div class="tile-chg"></div>
            </a>`).join('')}</div>` : '';
        }).join('');
        built = true;
      }
      for (const i of items) {
        const t = el.querySelector(`[data-sym="${CSS.escape(i.symbol)}"]`);
        if (!t) continue;
        flash(t.querySelector('.tile-px'), px(i.price), i.price);
        t.querySelector('.tile-chg').innerHTML = chg(i.change_pct);
      }
    };

    const loadMovers = async () => {
      const m = await api.get('/api/market/movers?universe=bist30');
      if (!ctx.alive()) return;
      const total = m.breadth.up + m.breadth.down + m.breadth.flat || 1;
      root.querySelector('#movers').innerHTML =
        moverTable('▲ BIST 30 — En Çok Yükselen', m.gainers) + moverTable('▼ BIST 30 — En Çok Düşen', m.losers) +
        moverTable('◆ BIST 30 — Hacim Liderleri (₺)', m.active, 'active') +
        `<section class="card span-all"><h3>Piyasa Genişliği (BIST 30)</h3>
          <div class="breadth"><i class="up-bg" style="width:${(m.breadth.up / total) * 100}%"></i><i class="flat-bg" style="width:${(m.breadth.flat / total) * 100}%"></i><i class="down-bg" style="width:${(m.breadth.down / total) * 100}%"></i></div>
          <div class="breadth-legend"><span class="up">${m.breadth.up} yükselen</span><span class="flat">${m.breadth.flat} yatay</span><span class="down">${m.breadth.down} düşen</span></div></section>`;
    };

    const loadMini = async () => {
      const wl = await api.get('/api/watchlist');
      if (!ctx.alive()) return;
      root.querySelector('#wl-mini').innerHTML = wl.length
        ? `<table class="tbl compact"><tbody>${wl.slice(0, 8).map((w) => `<tr class="clickable" onclick="location.hash='#/stock/${enc(w.symbol)}'"><td><b>${esc(short(w.symbol))}</b></td><td class="r mono">${px(w.price)}</td><td class="r">${chg(w.change_pct)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty small">Listeniz boş. Bir hissenin sayfasında ★ ile ekleyin.</div>';
      const pfs = await api.get('/api/portfolios');
      const s = await api.get(`/api/portfolios/${pfs[0].id}/summary`);
      if (!ctx.alive()) return;
      const t = s.totals;
      root.querySelector('#pf-mini').innerHTML = s.positions.length
        ? `<div class="kpis"><div class="kpi"><div class="label">Toplam Değer</div><div class="value">${money(t.value_try, 'TRY', 0)}</div></div>
           <div class="kpi"><div class="label">Toplam K/Z</div><div class="value ${cls(t.pnl_try)}">${money(t.pnl_try, 'TRY', 0)}</div><div class="sub">${chg(t.pnl_pct)}</div></div>
           <div class="kpi"><div class="label">Bugün</div><div class="value ${cls(t.day_pnl_try)}">${money(t.day_pnl_try, 'TRY', 0)}</div><div class="sub">${chg(t.day_pnl_pct)}</div></div></div>`
        : '<div class="empty small">Henüz işlem yok. Portföy sayfasından alım ekleyin.</div>';
    };

    const safe = (fn) => fn().catch((e) => console.warn(e));
    await Promise.all([safe(loadOverview), safe(loadMovers), safe(loadMini)]);
    ctx.poll(() => safe(loadOverview), 15000);
    ctx.poll(() => safe(loadMovers), 60000);
    ctx.poll(() => safe(loadMini), 60000);
  },
};
