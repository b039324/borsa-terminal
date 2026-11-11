// Alarmlar: sekme açıkken periyodik kontrol (alerts.py karşılığı). Tetiklenince kalıcı kayıt yapılır.
import { getQuotes } from './data.js';
import * as store from './store.js';

export const LABELS = { above: 'fiyat ≥', below: 'fiyat ≤', chg_up: 'günlük değişim ≥ %', chg_down: 'günlük düşüş ≥ %' };

export function evaluate(a, q) {
  const { price, change_pct: chg } = q, v = a.value;
  switch (a.condition) {
    case 'above': return price >= v;
    case 'below': return price <= v;
    case 'chg_up': return chg !== null && chg >= v;
    case 'chg_down': return chg !== null && chg <= -v;
    default: return false;
  }
}

export async function checkAlerts() {
  await store.load();
  const active = store.get().alerts.filter((a) => a.active);
  if (!active.length) return [];
  const quotes = await getQuotes([...new Set(active.map((a) => a.symbol))]);
  const hits = active.filter((a) => quotes[a.symbol] && evaluate(a, quotes[a.symbol]));
  if (!hits.length) return [];
  await store.mutate((d) => {
    for (const h of hits) {
      const a = d.alerts.find((x) => x.id === h.id);
      if (a && a.active) Object.assign(a, { active: 0, triggered_at: store.stamp(), triggered_price: quotes[a.symbol].price, seen: 0 });
    }
  });
  return hits.map((h) => ({ ...h, triggered_price: quotes[h.symbol].price }));
}
