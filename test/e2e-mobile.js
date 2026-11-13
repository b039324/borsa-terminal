// Mobil görünüm testi (390×844, dokunmatik). e2e.js ile aynı kurulum: harness.mjs 8793'te çalışmalı.
// Çalıştırma: node test/e2e-mobile.js   (playwright gerekir)
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8793';
let failed = 0;
const check = (ok, msg) => { console.log(ok ? '✔' : '✘', msg); if (!ok) failed++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const noHScroll = async () => (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  await p.goto(BASE + '/');
  await p.waitForSelector('#login:not([hidden])');
  await p.fill('#login-pw', 'test-sifre-12345'); await p.check('#login-remember'); await p.click('#login-go');
  await p.waitForSelector('#login', { state: 'hidden' }); await p.waitForTimeout(2000);

  // alt sekme çubuğu
  const nav = await p.evaluate(() => {
    const s = document.querySelector('#side').getBoundingClientRect();
    const links = [...document.querySelectorAll('#side a')].map((a) => ({ r: a.getBoundingClientRect(), t: a.querySelector('span').getBoundingClientRect().height }));
    return { bottom: Math.round(s.bottom), vh: innerHeight, n: links.length, labelsShown: links.every((l) => l.t > 0), inside: links.every((l) => l.r.left >= 0 && l.r.right <= innerWidth + 1) };
  });
  check(nav.bottom === nav.vh, `sekme çubuğu ekranın altında (${nav.bottom}/${nav.vh})`);
  check(nav.n === 9 && nav.labelsShown, `9 sekme, yazılar görünür (yatay kaydırmalı)`);
  check(await noHScroll(), 'panel: yatay kaydırma yok');
  await p.screenshot({ path: 'm_dash.png' });

  // takip listesi: satır kartı
  await p.goto(BASE + '/#/watchlist'); await p.waitForTimeout(1200);
  for (const s of ['GARAN', 'THYAO']) { await p.fill('#add input[name=symbol]', s); await p.keyboard.press('Enter'); await p.waitForTimeout(1800); }
  const wl = await p.evaluate(() => {
    const tr = document.querySelector('#wl tbody tr');
    const cs = (el) => getComputedStyle(el).display;
    return { rows: document.querySelectorAll('#wl tbody tr').length, trDisplay: cs(tr), theadHidden: cs(document.querySelector('#wl thead')) === 'none', volHidden: cs(tr.children[5]) === 'none', ordHidden: cs(tr.children[0]) === 'none', delHidden: cs(tr.children[9]) === 'none', h: Math.round(tr.getBoundingClientRect().height) };
  });
  check(wl.rows === 2, `takip satırı: ${wl.rows}`);
  check(wl.trDisplay === 'grid' && wl.theadHidden && wl.volHidden, 'satır kartı: grid, başlık ve hacim gizli');
  check(wl.ordHidden && wl.delHidden, 'düzenle kapalıyken sıralama/sil gizli');
  check(wl.h >= 56, `satır yüksekliği dokunmaya uygun (${wl.h}px)`);
  check(await noHScroll(), 'takip listesi: yatay kaydırma yok');
  await p.screenshot({ path: 'm_watch.png' });
  // düzenle modu: sırala
  const first = async () => p.evaluate(() => document.querySelector('#wl tbody tr').dataset.sym);
  const before = await first();
  await p.tap('#edit'); await p.waitForTimeout(300);
  check(await p.isVisible('#wl tbody tr [data-down]'), 'düzenle modu: ▼ görünür');
  await p.tap('#wl tbody tr:first-child [data-down]'); await p.waitForTimeout(1200);
  const after = await first();
  check(after !== before, `sıra değişti (${before} → ${after})`);
  await p.screenshot({ path: 'm_watch_edit.png' });
  await p.tap('#edit'); await p.waitForTimeout(200);
  check(!(await p.isVisible('#wl tbody tr [data-down]')), 'bitti: kontroller yine gizli');

  // portföy: sabit buton + alttan panel
  await p.goto(BASE + '/#/portfolio'); await p.waitForTimeout(1500);
  check(await p.isVisible('#tx-fab'), 'portföy: sabit buton görünür');
  check(!(await p.isVisible('#tx-sheet')), 'portföy: işlem paneli başta kapalı');
  await p.tap('#tx-fab'); await p.waitForTimeout(300);
  const sh = await p.evaluate(() => { const r = document.querySelector('#tx-sheet').getBoundingClientRect(); return { pos: getComputedStyle(document.querySelector('#tx-sheet')).position, bottom: Math.round(r.bottom), vh: innerHeight }; });
  check(await p.isVisible('#tx-sheet') && sh.pos === 'fixed' && sh.bottom === sh.vh, 'panel alttan açıldı');
  await p.screenshot({ path: 'm_sheet.png' });
  const tx = p.locator('#tx');
  await tx.locator('[name=symbol]').fill('THYAO'); await tx.locator('[name=quantity]').fill('100'); await tx.locator('[name=price]').fill('90');
  await tx.locator('button').last().tap(); await p.waitForTimeout(3000);
  check(!(await p.isVisible('#tx-sheet')), 'kayıttan sonra panel kapandı');
  const pos = await p.evaluate(() => { const tr = document.querySelector('#positions tbody tr'); return tr ? { d: getComputedStyle(tr).display, txt: tr.innerText.replace(/\s+/g, ' ') } : null; });
  check(pos && pos.d === 'grid' && pos.txt.includes('THYAO'), 'pozisyon kart olarak göründü: ' + (pos && pos.txt.slice(0, 60)));
  check(await noHScroll(), 'portföy: yatay kaydırma yok');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: 'm_pf.png' });
  // panel arka plana dokununca kapanır
  await p.tap('#tx-fab'); await p.waitForTimeout(200); await p.tap('#tx-back', { position: { x: 195, y: 40 } }); await p.waitForTimeout(200);
  check(!(await p.isVisible('#tx-sheet')), 'arka plana dokununca panel kapandı');

  // hisse sayfası taşma kontrolü
  await p.goto(BASE + '/#/stock/THYAO'); await p.waitForTimeout(3000);
  check(await noHScroll(), 'hisse sayfası: yatay kaydırma yok');
  await p.screenshot({ path: 'm_stock.png' });

  // Piyasalar / Harita / Sinyaller / not+hedef
  await p.goto(BASE + '/#/markets'); await p.waitForSelector('.mrow', { timeout: 15000 });
  const nrow = await p.locator('.mrow').count();
  check(nrow >= 25, `piyasalar: ${nrow} satır`);
  check(await noHScroll(), 'piyasalar: yatay kaydırma yok');
  await p.locator('.star[data-sym="THYAO.IS"]').tap(); await p.waitForTimeout(800);
  check(await p.locator('.mrow .star.on').count() >= 1, 'piyasalar: yıldız ile takibe alındı');
  await p.fill('#q', 'garanti'); await p.waitForTimeout(1200);
  check((await p.locator('.mrow').count()) >= 1, 'piyasalar: arama (BIST 100 içinde) sonuç verdi');
  await p.screenshot({ path: 'm_markets.png' });
  await p.goto(BASE + '/#/heatmap'); await p.waitForSelector('.hmt', { timeout: 15000 });
  const ntile = await p.locator('.hmt').count();
  check(ntile >= 25, `harita: ${ntile} kutu`);
  check(await noHScroll(), 'harita: yatay kaydırma yok');
  await p.tap('#mode button[data-v=sector]'); await p.waitForTimeout(400);
  check(await p.locator('.hmgl').count() >= 3, 'harita: sektör grupları çizildi');
  await p.screenshot({ path: 'm_heat.png' });
  await p.goto(BASE + '/#/signals'); await p.waitForSelector('.srow', { timeout: 30000 });
  const nsig = await p.locator('.srow').count();
  check(nsig >= 25, `sinyaller: ${nsig} satır`);
  check(await noHScroll(), 'sinyaller: yatay kaydırma yok');
  await p.tap('.chip[data-f=AL]'); await p.waitForTimeout(200);
  check((await p.locator('.srow .sgb:not(.AL)').count()) === 0, 'sinyaller: AL filtresi');
  await p.screenshot({ path: 'm_signals.png' });
  await p.goto(BASE + '/#/stock/THYAO'); await p.waitForSelector('#b-star', { timeout: 15000 }); await p.waitForTimeout(800);
  if (!(await p.locator('#note-form').count())) { await p.tap('#b-star'); await p.waitForTimeout(800); }
  await p.waitForSelector('#note-form', { timeout: 15000 });
  await p.fill('#note-form [name=target]', '123.5'); await p.fill('#note-form textarea', 'deneme notu');
  await p.tap('#note-form button'); await p.waitForTimeout(800);
  await p.goto(BASE + '/#/watchlist'); await p.goto(BASE + '/#/stock/THYAO'); await p.waitForSelector('#note-form', { timeout: 15000 });
  check((await p.inputValue('#note-form [name=target]')) === '123.5' && (await p.inputValue('#note-form textarea')) === 'deneme notu', 'not + hedef fiyat kaydedildi');

  check(errs.length === 0, 'JS hatası yok' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(failed ? `\n${failed} KONTROL BAŞARISIZ` : '\nTÜMÜ GEÇTİ');
  process.exit(failed ? 1 : 0);
})();
