// Ortak yardımcılar: biçimlendirme, DOM, toast, modal, depolama.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmts = {};
const nf = (d) => (fmts[d] ??= new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const ok = (x) => x != null && x !== '' && Number.isFinite(Number(x));

export const num = (x, d = 2) => (ok(x) ? nf(d).format(Number(x)) : '—');
export const px = (x) => {
  if (!ok(x)) return '—';
  const a = Math.abs(x);
  return nf(a >= 1 ? 2 : a >= 0.1 ? 3 : 4).format(Number(x));
};
export const pct = (x, d = 2, sign = true) => (ok(x) ? `${sign && x > 0 ? '+' : ''}${nf(d).format(Number(x))}%` : '—');
export const big = (x, d = 2) => {
  if (!ok(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e12) return `${num(x / 1e12, d)} Tr`;
  if (a >= 1e9) return `${num(x / 1e9, d)} Mr`;
  if (a >= 1e6) return `${num(x / 1e6, d)} Mn`;
  if (a >= 1e3) return `${num(x / 1e3, d)} B`;
  return num(x, 0);
};
export const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
export const arrow = (x) => (x > 0 ? '▲' : x < 0 ? '▼' : '■');
export const chg = (x, d = 2) => (ok(x) ? `<span class="${cls(x)}">${arrow(x)} ${pct(x, d)}</span>` : '<span class="flat">—</span>');
export const money = (x, cur = 'TRY', d = 2) => (ok(x) ? `${num(x, d)} ${curSym(cur)}` : '—');
export const curSym = (c) => ({ TRY: '₺', USD: '$', EUR: '€', GBP: '£' }[c] || c || '');
export const short = (s) => (s || '').replace(/\.IS$/, '');
export const today = () => new Date().toISOString().slice(0, 10);

export function rangeBar(low, high, val) {
  if (!ok(low) || !ok(high) || high <= low || !ok(val)) return '<span class="muted">—</span>';
  const p = Math.min(100, Math.max(0, ((val - low) / (high - low)) * 100));
  return `<div class="rangebar" title="${px(low)} – ${px(high)}"><span class="lo">${px(low)}</span><div class="track"><i style="left:${p}%"></i></div><span class="hi">${px(high)}</span></div>`;
}

// Fiyat değişiminde hücreyi kısa süre yeşil/kırmızı yakar
export function flash(el, text, value) {
  if (!el) return;
  const prev = el._v;
  el.textContent = text;
  el._v = value;
  if (prev != null && value != null && prev !== value) {
    const c = value > prev ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(c);
  }
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('borsa.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('borsa.' + k, JSON.stringify(v));
    } catch { /* depolama kapalı olabilir */ }
  },
};

export function toast(msg, type = 'info', ms = 4500) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function modal(title, bodyHtml) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(title)}</h3><button class="btn ghost sm" data-close aria-label="Kapat">✕</button></div><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) close();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  return { el: back.querySelector('.modal'), close };
}

export function sortRows(rows, key, dir = 1) {
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, 'tr') : x - y) * dir;
  });
}

export const skeleton = (n = 3) => `<div class="skeleton-wrap">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
export const errorBox = (e) => `<div class="err">⚠ ${esc(e.message || e)}</div>`;

// SVG yarım daire gösterge: score -1 (güçlü sat) … +1 (güçlü al)
export function gauge(score, label) {
  const R = 80, cx = 100, cy = 96;
  const pt = (deg, r = R) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  const colors = ['#ea3943', '#f08a8f', '#8b94a7', '#6fd6a8', '#16c784'];
  const arcs = colors.map((c, i) => {
    const [x0, y0] = pt(180 - i * 36 + (i ? -1.5 : 0)), [x1, y1] = pt(180 - (i + 1) * 36 + (i < 4 ? 1.5 : 0));
    return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${c}" stroke-width="12" fill="none"/>`;
  }).join('');
  const s = Math.max(-1, Math.min(1, score ?? 0));
  const [nx, ny] = pt(180 - ((s + 1) / 2) * 180, 62);
  return `<svg viewBox="0 0 200 118" class="gauge" role="img" aria-label="${esc(label)}">${arcs}<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="currentColor"/><text x="${cx}" y="116" text-anchor="middle" class="gauge-label">${esc(label)}</text></svg>`;
}

export const signalClass = (s) => (s === 'AL' || s === 'GÜÇLÜ AL' ? 'up' : s === 'SAT' || s === 'GÜÇLÜ SAT' ? 'down' : 'flat');
