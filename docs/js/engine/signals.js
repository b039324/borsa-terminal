// AL / TUT / SAT sinyali: bist-terminal/mobil'deki skorun aynısı (50 puandan başlar; RSI, trend, MACD, yıllık momentum).
// Fark: analist ortalaması katılmaz (tarama başına ek istek gerektirir); skor yalnız teknik göstergelerle hesaplanır.
// Girdi: engine/screener.js satırı.
export function signalOf(r) {
  let s = 50;
  const f = []; // [açıklama, puan]
  const add = (txt, pts) => { s += pts; f.push([txt, pts]); };
  if (r.rsi != null) {
    if (r.rsi < 30) r.trend_down ? add('RSI aşırı satım (düşüş trendinde, sınırlı)', 3) : add('RSI aşırı satım', 10);
    else if (r.rsi < 45) add('RSI zayıf', 4);
    else if (r.rsi <= 55) f.push(['RSI nötr', 0]);
    else if (r.rsi <= 70) add('RSI güçlü', -4);
    else r.trend_up ? add('RSI aşırı alım (yükseliş trendinde, sınırlı)', -3) : add('RSI aşırı alım', -10);
  }
  if (r.trend_up != null && r.trend_down != null) {
    if (r.trend_up) add('Trend yükseliş', 18);
    else if (r.trend_down) add('Trend düşüş', -18);
    else f.push(['Trend karışık', 0]);
  }
  if (r.macd_above_signal != null) r.macd_above_signal ? add('MACD pozitif', 12) : add('MACD negatif', -12);
  if (r.ret_1y != null) { if (r.ret_1y > 25) add('Yıllık momentum', 8); else if (r.ret_1y < -25) add('Yıllık momentum', -8); }
  s = Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : 50;
  const top = f.filter((x) => x[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2).map((x) => x[0]);
  return { score: Math.round(s), key: s >= 60 ? 'AL' : s >= 40 ? 'TUT' : 'SAT', strong: s >= 80 || s < 20, reason: top.length ? top.join(', ') : 'Göstergeler nötr' };
}
