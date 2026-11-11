// Temel analiz skor kartı (fundamentals.py karşılığı)
import { getInfo, getQuote, displayName, getDividends, num } from './data.js';

const g = (info, k) => num(info[k]);
const pct = (x) => (x === null ? null : x * 100);
function rate(v, good, bad, higher = true) {
  if (v === null) return null;
  if (higher) return v >= good ? 'iyi' : v < bad ? 'zayıf' : 'orta';
  return v <= good ? 'iyi' : v > bad ? 'zayıf' : 'orta';
}

export async function build(symbol) {
  const [info, q] = await Promise.all([getInfo(symbol), getQuote(symbol)]);
  const price = q.price;
  const divRate = g(info, 'dividendRate');
  const divYield = divRate && price ? (divRate / price) * 100 : null;
  const target = g(info, 'targetMeanPrice');
  const upside = target && price ? (target / price - 1) * 100 : null;
  const pe = g(info, 'trailingPE'), pb = g(info, 'priceToBook');
  const roe = pct(g(info, 'returnOnEquity')), margin = pct(g(info, 'profitMargins'));
  const de = g(info, 'debtToEquity'), cr = g(info, 'currentRatio');
  const revG = pct(g(info, 'revenueGrowth'));

  const card = [];
  const add = (name, value, verdict, note, fmt = 'x') => { if (value !== null) card.push({ name, value, verdict, note, fmt }); };
  if (pe !== null) add('F/K (Fiyat/Kazanç)', pe, pe <= 0 ? 'zayıf' : rate(pe, 10, 20, false), 'Düşük = ucuz; negatif = şirket zararda');
  add('PD/DD (Piyasa/Defter)', pb, rate(pb, 1, 3, false), '1 altı defter değerinin altında işlem görüyor demektir');
  add('Özkaynak Kârlılığı (ROE)', roe, rate(roe, 20, 10), 'Yüksek = sermayeyi verimli kullanıyor', 'pct');
  add('Net Kâr Marjı', margin, rate(margin, 15, 5), 'Satışların ne kadarı net kâra dönüşüyor', 'pct');
  add('Borç / Özkaynak', de, rate(de, 50, 150, false), 'Düşük = daha az kaldıraç (bankalarda yorumlanmaz)', 'pct');
  add('Cari Oran', cr, rate(cr, 1.5, 1), '1 üstü: kısa vadeli borçlar karşılanabiliyor');
  add('Gelir Büyümesi (yıllık)', revG, rate(revG, 25, 0), 'Yüksek enflasyonda nominal büyüme yanıltıcı olabilir', 'pct');
  add('Temettü Verimi', divYield, rate(divYield, 3, 1), 'Fiyata göre yıllık temettü', 'pct');
  add('Analist Hedef Potansiyeli', upside, rate(upside, 15, 0), 'Ortalama hedef fiyata göre yükseliş payı', 'pct');

  const pts = card.reduce((s, c) => s + (c.verdict ? { iyi: 2, orta: 1, 'zayıf': 0 }[c.verdict] : 0), 0);
  const mx = 2 * card.filter((c) => c.verdict).length;
  const p = mx ? Math.round((pts / mx) * 100) : null;
  const label = p === null ? null : p >= 70 ? 'Güçlü' : p >= 40 ? 'Orta' : 'Zayıf';
  let dividends = [];
  try { dividends = await getDividends(symbol); } catch { /* temettü yoksa boş */ }

  return {
    profile: { name: info.longName || info.shortName || displayName(symbol), sector: info.sector, industry: info.industry, summary: info.longBusinessSummary, website: info.website, employees: info.fullTimeEmployees, country: info.country, currency: info.currency || q.currency },
    valuation: { market_cap: g(info, 'marketCap') ?? q.market_cap, pe, fwd_pe: g(info, 'forwardPE'), pb, ps: g(info, 'priceToSalesTrailing12Months'), ev_ebitda: g(info, 'enterpriseToEbitda'), eps: g(info, 'trailingEps'), fwd_eps: g(info, 'forwardEps'), book_value: g(info, 'bookValue'), div_rate: divRate, div_yield: divYield, payout: pct(g(info, 'payoutRatio')) },
    profitability: { roe, roa: pct(g(info, 'returnOnAssets')), profit_margin: margin, op_margin: pct(g(info, 'operatingMargins')), gross_margin: pct(g(info, 'grossMargins')) },
    financial_health: { debt_equity: de, current_ratio: cr, quick_ratio: g(info, 'quickRatio'), total_debt: g(info, 'totalDebt'), total_cash: g(info, 'totalCash'), fcf: g(info, 'freeCashflow'), ebitda: g(info, 'ebitda'), revenue: g(info, 'totalRevenue'), rev_growth: revG, earn_growth: pct(g(info, 'earningsGrowth')) },
    trading: { beta: g(info, 'beta'), shares: g(info, 'sharesOutstanding'), high52: q.year_high, low52: q.year_low },
    analysts: { rec: info.recommendationKey, target, n: info.numberOfAnalystOpinions, upside },
    scorecard: card, score: { points: pts, max: mx, pct: p, label }, dividends,
  };
}
