// lightweight-charts (v5) sarmalayıcıları: ana fiyat grafiği (çoklu panel), çizgi grafikleri.
const LW = window.LightweightCharts;

const css = () => {
  const s = getComputedStyle(document.documentElement);
  const g = (n) => s.getPropertyValue(n).trim();
  return { panel: g('--panel'), text: g('--muted'), border: g('--border'), grid: g('--grid'), up: g('--up'), down: g('--down'), accent: g('--accent') };
};

function baseOptions(c, intraday) {
  return {
    autoSize: true,
    layout: { background: { type: 'solid', color: c.panel }, textColor: c.text, fontSize: 12, panes: { separatorColor: c.border, separatorHoverColor: c.grid } },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    crosshair: { mode: LW.CrosshairMode.Normal },
    rightPriceScale: { borderColor: c.border },
    timeScale: { borderColor: c.border, timeVisible: !!intraday, secondsVisible: false },
    localization: { locale: 'tr-TR' },
  };
}

const OVERLAYS = {
  sma20: ['SMA 20', '#f5a623'], sma50: ['SMA 50', '#4c8dff'], sma100: ['SMA 100', '#9b59b6'], sma200: ['SMA 200', '#e84393'],
  ema9: ['EMA 9', '#00cec9'], ema21: ['EMA 21', '#fdcb6e'], ema50: ['EMA 50', '#a29bfe'],
};

export const OVERLAY_LABELS = { ...OVERLAYS, bb: ['Bollinger', '#7f8ea3'] };

const lineOpts = (color, extra = {}) => ({ color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...extra });

/**
 * d: /chart yanıtı. opt: {overlays:[...], panes:['rsi','macd','stoch','adx'], legendEl}
 * Dönüş: {chart, candle, destroy, updateLast(price)}
 */
export function buildChart(el, d, opt = {}) {
  const c = css();
  el.innerHTML = '';
  const chart = LW.createChart(el, baseOptions(c, d.intraday));
  const ind = d.indicators;
  const withAlpha = (hex, a) => hex + a;

  const candle = chart.addSeries(LW.CandlestickSeries, {
    upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
    priceLineVisible: true,
  }, 0);
  candle.setData(d.candles);

  const vol = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false }, 0);
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(d.volume.map((v) => ({ time: v.time, value: v.value, color: withAlpha(v.up ? c.up : c.down, '55') })));

  const legendItems = [];
  for (const key of opt.overlays || []) {
    if (key === 'bb') {
      const col = OVERLAY_LABELS.bb[1];
      chart.addSeries(LW.LineSeries, lineOpts(col, { lineStyle: 2 }), 0).setData(ind.bb_upper || []);
      chart.addSeries(LW.LineSeries, lineOpts(col, { lineStyle: 2 }), 0).setData(ind.bb_lower || []);
      chart.addSeries(LW.LineSeries, lineOpts(col, { lineStyle: 3 }), 0).setData(ind.bb_mid || []);
      legendItems.push(['Bollinger (20,2)', col]);
    } else if (OVERLAYS[key] && ind[key]) {
      chart.addSeries(LW.LineSeries, lineOpts(OVERLAYS[key][1]), 0).setData(ind[key]);
      legendItems.push([OVERLAYS[key][0], OVERLAYS[key][1]]);
    }
  }

  let pane = 1;
  const guide = (series, price, color) => series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
  for (const key of opt.panes || []) {
    if (key === 'rsi' && ind.rsi) {
      const s = chart.addSeries(LW.LineSeries, lineOpts('#9b59b6', { title: 'RSI 14', lastValueVisible: true, priceLineVisible: false }), pane);
      s.setData(ind.rsi);
      guide(s, 70, c.down); guide(s, 30, c.up);
    } else if (key === 'macd' && ind.macd) {
      const h = chart.addSeries(LW.HistogramSeries, { lastValueVisible: false, priceLineVisible: false, title: 'MACD' }, pane);
      h.setData((ind.macd_hist || []).map((p) => ({ ...p, color: withAlpha(p.value >= 0 ? c.up : c.down, '99') })));
      chart.addSeries(LW.LineSeries, lineOpts('#4c8dff', { lastValueVisible: false }), pane).setData(ind.macd);
      chart.addSeries(LW.LineSeries, lineOpts('#f5a623', { lastValueVisible: false }), pane).setData(ind.macd_signal || []);
    } else if (key === 'stoch' && ind.stoch_k) {
      const k = chart.addSeries(LW.LineSeries, lineOpts('#4c8dff', { title: 'Stoch %K', lastValueVisible: true }), pane);
      k.setData(ind.stoch_k);
      chart.addSeries(LW.LineSeries, lineOpts('#f5a623'), pane).setData(ind.stoch_d || []);
      guide(k, 80, c.down); guide(k, 20, c.up);
    } else if (key === 'adx' && ind.adx) {
      chart.addSeries(LW.LineSeries, lineOpts('#e6e9ef', { title: 'ADX 14', lastValueVisible: true }), pane).setData(ind.adx);
      chart.addSeries(LW.LineSeries, lineOpts(c.up), pane).setData(ind.plus_di || []);
      chart.addSeries(LW.LineSeries, lineOpts(c.down), pane).setData(ind.minus_di || []);
    } else continue;
    pane += 1;
  }
  const panes = chart.panes();
  panes[0].setStretchFactor(4);
  for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1.2);
  chart.timeScale().fitContent();

  // Lejant: imleç altındaki mumun OHLC değerleri
  const legend = opt.legendEl;
  const byTime = new Map(d.candles.map((k, i) => [k.time, i]));
  const fmt = (x) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2 });
  const paintLegend = (k, i) => {
    if (!legend || !k) return;
    const prev = i > 0 ? d.candles[i - 1].close : k.open;
    const ch = ((k.close / prev - 1) * 100);
    const col = k.close >= prev ? c.up : c.down;
    const v = d.volume[i]?.value;
    legend.innerHTML = `<span class="lg-ohlc" style="color:${col}">A ${fmt(k.open)} &nbsp;Y ${fmt(k.high)} &nbsp;D ${fmt(k.low)} &nbsp;K ${fmt(k.close)} &nbsp;${ch >= 0 ? '+' : ''}${ch.toFixed(2).replace('.', ',')}%</span>` +
      (v ? ` <span class="lg-vol">Hacim ${v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + ' Mn' : Math.round(v).toLocaleString('tr-TR')}</span>` : '') +
      legendItems.map(([n, col2]) => `<span class="lg-item"><i style="background:${col2}"></i>${n}</span>`).join('');
  };
  paintLegend(d.candles.at(-1), d.candles.length - 1);
  chart.subscribeCrosshairMove((p) => {
    const i = p.time != null ? byTime.get(p.time) : undefined;
    if (i == null) paintLegend(d.candles.at(-1), d.candles.length - 1);
    else paintLegend(d.candles[i], i);
  });

  return {
    chart, candle,
    destroy: () => chart.remove(),
    updateLast(price) {
      const k = d.candles.at(-1);
      if (!k || price == null) return;
      k.close = price;
      k.high = Math.max(k.high, price);
      k.low = Math.min(k.low, price);
      candle.update(k);
      paintLegend(k, d.candles.length - 1);
    },
  };
}

/** Basit çizgi/alan grafiği. series: [{name,color,points,type:'line'|'area'}] */
export function buildLines(el, series, { percent = false, intraday = false, fmt = null } = {}) {
  const c = css();
  el.innerHTML = '';
  const chart = LW.createChart(el, baseOptions(c, intraday));
  const palette = ['#4c8dff', '#f5a623', '#16c784', '#e84393', '#9b59b6', '#00cec9'];
  series.forEach((s, i) => {
    const color = s.color || palette[i % palette.length];
    const common = { color, lineWidth: 2, title: s.name, priceLineVisible: false, lastValueVisible: true };
    const pf = percent ? { type: 'custom', formatter: (v) => `${v.toFixed(1).replace('.', ',')}%` } : fmt ? { type: 'custom', formatter: fmt } : null;
    if (pf) common.priceFormat = pf;
    const ser = s.type === 'area'
      ? chart.addSeries(LW.AreaSeries, { lineColor: color, topColor: color + '55', bottomColor: color + '05', lineWidth: 2, title: s.name, priceLineVisible: false, ...(pf ? { priceFormat: pf } : {}) })
      : chart.addSeries(LW.LineSeries, common);
    ser.setData(s.points);
  });
  chart.timeScale().fitContent();
  return { chart, destroy: () => chart.remove() };
}
