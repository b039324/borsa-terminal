// Tarayıcı satırları (screener.py karşılığı)
import { technicalSummary, performance } from './analysis.js';
import { getDailyBatch, displayName } from './data.js';
import { UNIVERSES } from './universe.js';

export async function scan(universe = 'bist30') {
  const symbols = UNIVERSES[universe] || UNIVERSES.bist30;
  const frames = await getDailyBatch(symbols, '1y');
  const rows = [];
  for (const sym of symbols) {
    const df = frames[sym];
    if (!df || df.c.length < 30) continue;
    try {
      const summ = technicalSummary(df), perf = performance(df);
      const osc = Object.fromEntries(summ.oscillators.map((o) => [o.name, o.value]));
      const ma = Object.fromEntries(summ.moving_averages.map((m) => [m.name, m.value]));
      const n = df.c.length, close = df.c[n - 1], prev = df.c[n - 2], vol = df.v[n - 1];
      rows.push({
        symbol: sym, name: displayName(sym), price: close, change_pct: (close / prev - 1) * 100, volume: vol, turnover: close * vol,
        volume_ratio: perf.volume_ratio ?? null, rsi: osc['RSI (14)'] ?? null, macd_up: (osc['MACD (12,26,9)'] || 0) > 0,
        above_sma50: 'SMA 50' in ma ? close > ma['SMA 50'] : null, above_sma200: 'SMA 200' in ma ? close > ma['SMA 200'] : null,
        ret_1a: perf.returns?.['1A'] ?? null, ret_3a: perf.returns?.['3A'] ?? null, from_high_pct: perf.from_high_pct ?? null,
        signal: summ.verdict_all.label, score: summ.verdict_all.score, trend: summ.trend ?? null,
      });
    } catch (e) { console.warn('tarama', sym, e); }
  }
  return rows;
}
