import { api, enc } from '../api.js';
import { buildChart, OVERLAY_LABELS } from '../charts.js';
import { big, chg, cls, curSym, errorBox, esc, flash, gauge, modal, num, pct, px, rangeBar, short, signalClass, skeleton, store, toast, today } from '../util.js';

const RANGES = [['1d', '1G'], ['5d', '5G'], ['1mo', '1A'], ['3mo', '3A'], ['6mo', '6A'], ['1y', '1Y'], ['2y', '2Y'], ['5y', '5Y'], ['max', 'Tümü']];
const PANES = [['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stokastik'], ['adx', 'ADX']];
const OVERLAYS = ['sma20', 'sma50', 'sma100', 'sma200', 'ema9', 'ema21', 'ema50', 'bb'];
const TABS = [['chart', 'Grafik'], ['tech', 'Teknik Analiz'], ['fund', 'Temel Analiz'], ['fin', 'Finansallar'], ['news', 'Haberler']];

const kv = (rows) => `<table class="tbl kv"><tbody>${rows.filter((r) => r[1] != null && r[1] !== '—').map(([k, v]) => `<tr><td>${k}</td><td class="r mono">${v}</td></tr>`).join('')}</tbody></table>`;

export default {
  async mount(root, { id }, ctx) {
    let sym = id;
    const state = {
      range: store.get('range', '6mo'),
      overlays: new Set(store.get('overlays', ['sma50', 'sma200'])),
      panes: new Set(store.get('panes', ['rsi', 'macd'])),
      tab: 'chart',
    };
    let quote, chartData, ctl, inWatch = false;
    const loaded = {};

    root.innerHTML = skeleton(2);
    try {
      quote = await api.get(`/api/stock/${enc(sym)}/quote`);
    } catch (e) {
      root.innerHTML = `<h2 class="page-title">${esc(sym)}</h2>${errorBox(e)}<p class="muted">Sembol bulunamadı. BIST için <code>THYAO</code>, ABD için <code>US:AAPL</code>, endeks için <code>^GSPC</code>, kur için <code>USDTRY=X</code> yazın.</p>`;
      return;
    }
    if (!ctx.alive()) return;
    sym = quote.symbol;
    if (decodeURIComponent(location.hash.split('/stock/')[1] || '') !== sym) history.replaceState(null, '', `#/stock/${enc(sym)}`);
    try { inWatch = (await api.get('/api/watchlist')).some((w) => w.symbol === sym); } catch { /* yoksay */ }

    root.innerHTML = `
      <div class="stock-head card">
        <div class="sh-left">
          <h1><span id="s-sym">${esc(short(sym))}</span></h1>
          <div class="sh-name" id="s-name">${esc(quote.name)}</div>
          <div class="muted small" id="s-sub">${esc(sym)} · ${esc(quote.currency)}</div>
        </div>
        <div class="sh-price">
          <div class="big-price mono" id="s-px"></div>
          <div id="s-chg" class="sh-chg"></div>
          <div class="muted small" id="s-upd"></div>
        </div>
        <div class="sh-actions">
          <button class="btn" id="b-star" aria-pressed="${inWatch}">${inWatch ? '★ Takipte' : '☆ Takibe Al'}</button>
          <button class="btn" id="b-pf">＋ Portföye İşle</button>
          <button class="btn" id="b-alert">🔔 Alarm Kur</button>
        </div>
      </div>
      <div class="statrow card" id="stats"></div>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab ${k === 'chart' ? 'active' : ''}" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tabbody"></div>`;

    const $$el = (s) => root.querySelector(s);

    // ------------------------------------------------------------ başlık ve fiyat
    const paintQuote = () => {
      const q = quote;
      flash($$el('#s-px'), `${px(q.price)} ${curSym(q.currency)}`, q.price);
      $$el('#s-chg').innerHTML = `<span class="${cls(q.change)}">${q.change > 0 ? '+' : ''}${px(q.change)} (${chg(q.change_pct)})</span>`;
      $$el('#s-upd').textContent = `Güncelleme: ${q.updated} · veri ~15 dk gecikmeli`;
      $$el('#stats').innerHTML = [
        ['Önceki Kapanış', px(q.prev_close)], ['Açılış', px(q.open)], ['Gün Aralığı', rangeBar(q.low, q.high, q.price)],
        ['52 Hafta', rangeBar(q.year_low, q.year_high, q.price)], ['Hacim', big(q.volume)], ['Piyasa Değeri', q.market_cap ? big(q.market_cap) : '—'],
      ].map(([k, v]) => `<div class="stat"><div class="label">${k}</div><div class="v">${v}</div></div>`).join('');
    };
    paintQuote();

    ctx.poll(async () => {
      try {
        quote = await api.get(`/api/stock/${enc(sym)}/quote`);
        paintQuote();
        if (state.tab === 'chart' && chartData) {
          if (['1d', '5d'].includes(state.range)) await loadChart();
          else if (!['5y', 'max'].includes(state.range)) ctl?.updateLast(quote.price);
        }
      } catch { /* geçici hata */ }
    }, 15000);

    // ------------------------------------------------------------ butonlar
    $$el('#b-star').addEventListener('click', async (e) => {
      try {
        if (inWatch) await api.del(`/api/watchlist/${enc(sym)}`); else await api.post('/api/watchlist', { symbol: sym });
        inWatch = !inWatch;
        e.target.textContent = inWatch ? '★ Takipte' : '☆ Takibe Al';
        toast(inWatch ? 'Takip listesine eklendi' : 'Listeden çıkarıldı', 'ok', 2000);
      } catch (err) { toast(err.message, 'err'); }
    });

    $$el('#b-pf').addEventListener('click', async () => {
      const pfs = await api.get('/api/portfolios');
      const m = modal(`${short(sym)} — Portföye İşle`, `
        <form class="form-grid one" id="mf">
          <label>Portföy<select name="pid">${pfs.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
          <label>İşlem<select name="type"><option value="BUY">Alış</option><option value="SELL">Satış</option><option value="DIVIDEND">Temettü (fiyat = hisse başı)</option></select></label>
          <label>Adet<input name="quantity" type="number" step="any" min="0" required></label>
          <label>Fiyat<input name="price" type="number" step="any" min="0" required value="${quote.price}"></label>
          <label>Komisyon / Masraf<input name="fee" type="number" step="any" min="0" value="0"></label>
          <label>Tarih<input name="date" type="date" required value="${today()}"></label>
          <button class="btn primary">Kaydet</button>
        </form>`);
      m.el.querySelector('#mf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await api.post(`/api/portfolios/${f.pid}/transactions`, { symbol: sym, type: f.type, quantity: +f.quantity, price: +f.price, fee: +f.fee, date: f.date });
          toast('İşlem kaydedildi', 'ok');
          m.close();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    $$el('#b-alert').addEventListener('click', () => {
      const m = modal(`${short(sym)} — Alarm Kur`, `
        <form class="form-grid one" id="mf">
          <label>Koşul<select name="condition"><option value="above">Fiyat ≥ değer</option><option value="below">Fiyat ≤ değer</option><option value="chg_up">Günlük yükseliş ≥ %</option><option value="chg_down">Günlük düşüş ≥ %</option></select></label>
          <label>Değer<input name="value" type="number" step="any" min="0" required value="${quote.price}"></label>
          <label>Not<input name="note" maxlength="200"></label>
          <button class="btn primary">Alarmı Kur</button>
        </form>`);
      m.el.querySelector('#mf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try { await api.post('/api/alerts', { symbol: sym, condition: f.condition, value: +f.value, note: f.note }); toast('Alarm kuruldu', 'ok'); m.close(); }
        catch (err) { toast(err.message, 'err'); }
      });
    });

    // ------------------------------------------------------------ sekmeler
    const body = $$el('#tabbody');
    const showTab = async (t) => {
      state.tab = t;
      ctl?.destroy(); ctl = null;
      body.onclick = null;
      root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
      body.innerHTML = skeleton(2);
      try { await tabs[t](); } catch (e) { if (ctx.alive()) body.innerHTML = errorBox(e); }
    };
    root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    ctx.onCleanup(() => ctl?.destroy());

    const drawChart = () => {
      ctl?.destroy();
      ctl = buildChart($$el('#chart'), chartData, { overlays: [...state.overlays], panes: [...state.panes], legendEl: $$el('#legend') });
    };
    const loadChart = async () => {
      chartData = await api.get(`/api/stock/${enc(sym)}/chart?range=${state.range}`);
      if (!ctx.alive() || state.tab !== 'chart') return;
      drawChart();
    };

    const chip = (group, key, label, on) => `<button class="chip ${on ? 'on' : ''}" data-g="${group}" data-k="${key}" aria-pressed="${on}">${label}</button>`;

    const tabs = {
      // -------------------------------------------------------- GRAFİK
      chart: async () => {
        body.innerHTML = `
          <div class="card chart-card">
            <div class="chart-toolbar">
              <div class="seg">${RANGES.map(([k, l]) => `<button class="${k === state.range ? 'on' : ''}" data-range="${k}">${l}</button>`).join('')}</div>
              <div class="chips"><span class="muted small">Üst göstergeler:</span>${OVERLAYS.map((k) => chip('ov', k, OVERLAY_LABELS[k][0], state.overlays.has(k))).join('')}</div>
              <div class="chips"><span class="muted small">Alt paneller:</span>${PANES.map(([k, l]) => chip('pn', k, l, state.panes.has(k))).join('')}</div>
            </div>
            <div class="chart-wrap"><div id="legend" class="legend"></div><div id="chart" class="chart"></div></div>
          </div>`;
        body.querySelector('.chart-toolbar').addEventListener('click', async (e) => {
          const r = e.target.closest('[data-range]');
          if (r) {
            state.range = r.dataset.range; store.set('range', state.range);
            body.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('on', b === r));
            try { await loadChart(); } catch (err) { toast(err.message, 'err'); }
            return;
          }
          const c = e.target.closest('.chip');
          if (c) {
            const set = c.dataset.g === 'ov' ? state.overlays : state.panes;
            set.has(c.dataset.k) ? set.delete(c.dataset.k) : set.add(c.dataset.k);
            c.classList.toggle('on', set.has(c.dataset.k));
            c.setAttribute('aria-pressed', set.has(c.dataset.k));
            store.set(c.dataset.g === 'ov' ? 'overlays' : 'panes', [...set]);
            drawChart();
          }
        });
        await loadChart();
      },

      // -------------------------------------------------------- TEKNİK
      tech: async () => {
        const t = loaded.tech ??= await api.get(`/api/stock/${enc(sym)}/technical`);
        if (!ctx.alive()) return;
        const s = t.summary;
        if (s.error) { body.innerHTML = `<div class="empty">${esc(s.error)}</div>`; return; }
        const verdictCard = (title, v) => `<div class="card gauge-card"><h4>${title}</h4>${gauge(v.score, v.label)}
          <div class="vcount"><span class="down">SAT ${v.sell}</span><span class="flat">NÖTR ${v.neutral}</span><span class="up">AL ${v.buy}</span></div></div>`;
        const sigTable = (rows, fmtv = (x) => num(x, 2)) => `<table class="tbl compact"><thead><tr><th>Gösterge</th><th class="r">Değer</th><th class="r">Sinyal</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}</td><td class="r mono">${fmtv(r.value)}</td><td class="r"><span class="pill ${signalClass(r.signal)}">${r.signal}</span></td></tr>`).join('')}</tbody></table>`;
        const lv = (o) => ['S3', 'S2', 'S1', 'P', 'R1', 'R2', 'R3'].map((k) => `<td class="r mono ${k.startsWith('S') ? 'down' : k.startsWith('R') ? 'up' : ''}">${px(o[k])}</td>`).join('');
        const p = t.pivots, perf = t.performance;
        body.innerHTML = `
          <p class="muted small">Zaman dilimi: ${esc(t.timeframe)} · Sinyaller kural tabanlıdır, yatırım tavsiyesi değildir.</p>
          <div class="grid cols-3">${verdictCard('Osilatörler', s.verdict_osc)}${verdictCard('Genel Özet', s.verdict_all)}${verdictCard('Hareketli Ortalamalar', s.verdict_ma)}</div>
          ${s.trend ? `<div class="card trend-line"><b>Trend:</b> ${esc(s.trend)} · <b>ATR (14):</b> ${px(s.atr)}</div>` : ''}
          <div class="grid cols-2">
            <section class="card"><h3>Osilatörler</h3>${sigTable(s.oscillators)}</section>
            <section class="card"><h3>Hareketli Ortalamalar</h3>${sigTable(s.moving_averages, px)}</section>
          </div>
          <div class="grid cols-2">
            <section class="card"><h3>Pivot / Destek–Direnç</h3><div class="table-wrap"><table class="tbl compact"><thead><tr><th></th><th class="r">S3</th><th class="r">S2</th><th class="r">S1</th><th class="r">Pivot</th><th class="r">R1</th><th class="r">R2</th><th class="r">R3</th></tr></thead>
              <tbody><tr><td>Klasik</td>${lv(p.classic || {})}</tr><tr><td>Fibonacci</td>${lv(p.fibonacci || {})}</tr></tbody></table></div>
              <div class="muted small">Önceki tamamlanmış günlük muma göre hesaplanır.</div></section>
            <section class="card"><h3>Getiri ve Risk</h3>
              <div class="perf">${Object.entries(perf.returns || {}).map(([k, v]) => `<div><div class="label">${k}</div><div class="${cls(v)} mono">${pct(v)}</div></div>`).join('')}</div>
              ${kv([['Yıllık volatilite', pct(perf.volatility_annual, 1, false)], ['Maks. düşüş (1Y)', pct(perf.max_drawdown_1y, 1)], ['52H zirveye uzaklık', pct(perf.from_high_pct, 1)], ['52H dipten uzaklık', pct(perf.from_low_pct, 1)], ['Ort. hacim (20G)', big(perf.avg_volume_20)], ['Bugünkü hacim / ort.', perf.volume_ratio != null ? num(perf.volume_ratio, 2) + '×' : '—']])}</section>
          </div>
          <section class="card"><h3>Mum Formasyonları (son mum)</h3>${t.patterns.length ? t.patterns.map((x) => `<div class="pattern"><b>${esc(x.name)}</b> <span class="pill ${x.bias === 'Yükseliş' ? 'up' : x.bias === 'Düşüş' ? 'down' : 'flat'}">${esc(x.bias)}</span> <span class="muted">${esc(x.desc)}</span></div>`).join('') : '<div class="muted">Belirgin bir formasyon yok.</div>'}</section>`;
      },

      // -------------------------------------------------------- TEMEL
      fund: async () => {
        const f = loaded.fund ??= await api.get(`/api/stock/${enc(sym)}/fundamentals`);
        if (!ctx.alive()) return;
        if (f.profile.name) $$el('#s-name').textContent = f.profile.name;
        const v = f.valuation, pr = f.profitability, h = f.financial_health, tr = f.trading, a = f.analysts;
        const fmtc = (c) => (c.fmt === 'pct' ? pct(c.value, 1, false) : num(c.value, 2));
        const recMap = { strong_buy: 'Güçlü Al', buy: 'Al', hold: 'Tut', sell: 'Sat', strong_sell: 'Güçlü Sat', underperform: 'Düşük Performans' };
        body.innerHTML = `
          <div class="grid cols-3">
            <section class="card score-card"><h3>Temel Skor</h3>
              ${f.score.pct == null ? '<div class="muted">Skor için yeterli veri yok</div>' : `<div class="score-num ${f.score.pct >= 70 ? 'up' : f.score.pct >= 40 ? 'flat' : 'down'}">${f.score.pct}<small>/100</small></div><div class="pill ${f.score.pct >= 70 ? 'up' : f.score.pct >= 40 ? 'flat' : 'down'}">${f.score.label}</div><div class="score-bar"><i style="width:${f.score.pct}%"></i></div>`}
              <div class="muted small">Kural tabanlı basit puanlama; sektör ve enflasyon etkisini hesaba katmaz.</div></section>
            <section class="card span-2"><h3>${esc(f.profile.name || '')}</h3>
              <div class="muted small">${[f.profile.sector, f.profile.industry, f.profile.country].filter(Boolean).map(esc).join(' · ')}${f.profile.employees ? ` · ${num(f.profile.employees, 0)} çalışan` : ''}</div>
              <p class="summary">${esc(f.profile.summary || 'Şirket özeti bulunamadı.')}</p>
              ${f.profile.website ? `<a href="${esc(f.profile.website)}" target="_blank" rel="noopener noreferrer" class="small">${esc(f.profile.website)}</a>` : ''}</section>
          </div>
          <section class="card"><h3>Skor Kartı</h3><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Ölçüt</th><th class="r">Değer</th><th>Değerlendirme</th><th>Açıklama</th></tr></thead><tbody>
            ${f.scorecard.map((c) => `<tr><td>${esc(c.name)}</td><td class="r mono">${fmtc(c)}</td><td><span class="pill ${c.verdict === 'iyi' ? 'up' : c.verdict === 'zayıf' ? 'down' : 'flat'}">${c.verdict}</span></td><td class="muted small">${esc(c.note)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Veri yok</td></tr>'}</tbody></table></div></section>
          <div class="grid cols-3">
            <section class="card"><h3>Değerleme</h3>${kv([['Piyasa değeri', big(v.market_cap)], ['F/K (son 12 ay)', num(v.pe)], ['İleriye dönük F/K', num(v.fwd_pe)], ['PD/DD', num(v.pb)], ['F/S (Fiyat/Satış)', num(v.ps)], ['FD/FAVÖK', num(v.ev_ebitda)], ['Hisse başı kâr (EPS)', num(v.eps)], ['Beklenen EPS', num(v.fwd_eps)], ['Defter değeri / hisse', num(v.book_value)], ['Temettü verimi', pct(v.div_yield, 2, false)], ['Dağıtım oranı', pct(v.payout, 1, false)]])}</section>
            <section class="card"><h3>Kârlılık ve Büyüme</h3>${kv([['ROE', pct(pr.roe, 1, false)], ['ROA', pct(pr.roa, 1, false)], ['Net kâr marjı', pct(pr.profit_margin, 1, false)], ['Faaliyet marjı', pct(pr.op_margin, 1, false)], ['Brüt marj', pct(pr.gross_margin, 1, false)], ['Gelir (12 ay)', big(h.revenue)], ['Gelir büyümesi', pct(h.rev_growth, 1)], ['Kâr büyümesi', pct(h.earn_growth, 1)], ['FAVÖK', big(h.ebitda)]])}</section>
            <section class="card"><h3>Finansal Sağlık</h3>${kv([['Borç / Özkaynak', pct(h.debt_equity, 1, false)], ['Cari oran', num(h.current_ratio)], ['Asit-test oranı', num(h.quick_ratio)], ['Toplam borç', big(h.total_debt)], ['Nakit', big(h.total_cash)], ['Serbest nakit akışı', big(h.fcf)], ['Beta', num(tr.beta)], ['Dolaşımdaki hisse', big(tr.shares)], ['52H aralık', `${px(tr.low52)} – ${px(tr.high52)}`]])}</section>
          </div>
          <div class="grid cols-2">
            <section class="card"><h3>Analist Görüşü</h3>${a && (a.rec || a.target) ? kv([['Ortalama öneri', recMap[a.rec] || a.rec || '—'], ['Ortalama hedef fiyat', px(a.target)], ['Hedefe potansiyel', pct(a.upside, 1)], ['Analist sayısı', a.n ?? '—']]) : '<div class="muted">Analist verisi yok.</div>'}</section>
            <section class="card"><h3>Temettü Geçmişi</h3>${f.dividends.length ? `<table class="tbl compact"><thead><tr><th>Tarih</th><th class="r">Hisse başı</th></tr></thead><tbody>${f.dividends.map((d) => `<tr><td>${esc(d.date)}</td><td class="r mono">${px(d.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">Temettü kaydı yok.</div>'}</section>
          </div>`;
      },

      // -------------------------------------------------------- FİNANSALLAR
      fin: async () => {
        const render = (d) => {
          const tbl = (title, blk) => `<section class="card"><h3>${title}</h3>${blk.rows.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th></th>${blk.columns.map((c) => `<th class="r">${esc(c)}</th>`).join('')}</tr></thead><tbody>
            ${blk.rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.values.map((x, i) => {
              const nxt = r.values[i + 1];
              const g = x != null && nxt ? ((x - nxt) / Math.abs(nxt)) * 100 : null;
              const eps = r.key === 'Basic EPS';
              return `<td class="r mono">${eps ? num(x, 2) : big(x)}${g != null ? `<div class="small ${cls(g)}">${pct(g, 0)}</div>` : ''}</td>`;
            }).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="muted">Veri bulunamadı.</div>'}</section>`;
          body.innerHTML = `<div class="toolbar"><div class="seg"><button data-p="annual" class="${d.period === 'annual' ? 'on' : ''}">Yıllık</button><button data-p="quarterly" class="${d.period === 'quarterly' ? 'on' : ''}">Çeyreklik</button></div><span class="muted small">Tutarlar şirketin raporlama para biriminde; küçük yüzdeler bir önceki döneme göre değişimdir.</span></div>
            ${tbl('Gelir Tablosu', d.income)}${tbl('Bilanço', d.balance)}${tbl('Nakit Akış Tablosu', d.cashflow)}`;
        };
        const get = async (p) => (loaded['fin' + p] ??= await api.get(`/api/stock/${enc(sym)}/financials?period=${p}`));
        render(await get('annual'));
        body.onclick = async (e) => {
          const b = e.target.closest('[data-p]');
          if (b) { body.innerHTML = skeleton(2); render(await get(b.dataset.p)); }
        };
      },

      // -------------------------------------------------------- HABERLER
      news: async () => {
        const n = loaded.news ??= await api.get(`/api/stock/${enc(sym)}/news`);
        if (!ctx.alive()) return;
        body.innerHTML = `<section class="card">${n.length ? n.map((x) => `<article class="news"><a href="${esc(x.url || '#')}" target="_blank" rel="noopener noreferrer"><b>${esc(x.title)}</b></a><div class="muted small">${esc(x.source)} · ${esc((x.published || '').replace('T', ' ').slice(0, 16))}</div>${x.summary ? `<p>${esc(x.summary)}</p>` : ''}</article>`).join('') : '<div class="empty">Bu sembol için haber bulunamadı.</div>'}</section>`;
      },
    };

    await showTab('chart');
  },
};
