// KV'deki tek belge: takip listesi, portföyler, işlemler, alarmlar. İyimser eşzamanlılık (rev) ile.
import { call } from './data.js';

let state = null, rev = 0;
const now = () => new Date().toISOString().slice(0, 19);
const fresh = () => ({ watchlist: [], portfolios: [{ id: 1, name: 'Ana Portföy', created_at: now() }], transactions: [], alerts: [], seq: { pf: 1, tx: 0, al: 0 } });

export async function load(force = false) {
  if (state && !force) return state;
  const r = await call('/api/store');
  rev = r.rev;
  state = r.data || fresh();
  return state;
}

export const get = () => state;

/** fn(draft) taslağı değiştirir (hata fırlatırsa hiçbir şey kaydedilmez), sonuç KV'ye yazılır. */
export async function mutate(fn) {
  await load();
  const draft = structuredClone(state);
  const result = await fn(draft);
  try {
    const r = await call('/api/store', { method: 'PUT', body: { rev, data: draft } });
    rev = r.rev;
    state = draft;
  } catch (e) {
    if (e.status === 409) { await load(true); throw new Error('Veri başka bir cihazda değişmiş; yenilendi. Lütfen işlemi tekrarlayın.'); }
    throw e;
  }
  return result;
}

export const stamp = now;
export const reset = () => { state = null; rev = 0; };
