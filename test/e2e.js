const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  const step = (s) => console.log('•', s);
  await p.goto('http://127.0.0.1:8793/');
  await p.waitForSelector('#login:not([hidden])'); step('giriş ekranı geldi');
  await p.fill('#login-pw', 'yanlis-sifre-1'); await p.click('#login-go'); await p.waitForTimeout(1200);
  step('yanlış şifre mesajı: ' + (await p.textContent('#login-msg')));
  await p.fill('#login-pw', 'test-sifre-12345'); await p.check('#login-remember'); await p.click('#login-go');
  await p.waitForSelector('#login', { state: 'hidden' }); await p.waitForTimeout(2500);
  step('panel kartları: ' + (await p.locator('.tile').count()) + ' ; şerit: ' + (await p.locator('.tape-item').count()));
  await p.screenshot({ path: 'dash.png' });
  // hisse sayfası
  await p.goto('http://127.0.0.1:8793/#/stock/THYAO'); await p.waitForTimeout(3500);
  step('hisse başlık: ' + (await p.locator('h1').first().textContent()).trim().slice(0, 60));
  await p.screenshot({ path: 'stock.png' });
  for (const tab of ['Teknik', 'Temel', 'Finansal', 'Haber']) { const t = p.locator('.tabs button, .tab', { hasText: tab }).first(); if (await t.count()) { await t.click(); await p.waitForTimeout(1800); step(tab + ' sekmesi: ' + ((await p.locator('#view').innerText()).length) + ' karakter'); } else step(tab + ' sekmesi bulunamadı'); }
  await p.screenshot({ path: 'stock_fund.png' });
  // takip listesi
  await p.goto('http://127.0.0.1:8793/#/watchlist'); await p.waitForTimeout(1500);
  await p.fill('input[name=symbol], #wl-add input, form input', 'GARAN'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
  step('takip satırı: ' + (await p.locator('tbody tr').count()));
  // portföy
  await p.goto('http://127.0.0.1:8793/#/portfolio'); await p.waitForTimeout(1500);
  const tx = p.locator('#tx'); await tx.locator('[name=symbol]').fill('THYAO'); await tx.locator('[name=quantity]').fill('100'); await tx.locator('[name=price]').fill('90'); await tx.locator('button[type=submit], button').last().click(); await p.waitForTimeout(3500);
  step('portföy metni: ' + ((await p.locator('#view').innerText()).includes('THYAO') ? 'THYAO var' : 'THYAO YOK'));
  await p.screenshot({ path: 'pf.png' });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#pf-export')]); step('csv indirme: ' + (dl ? dl.suggestedFilename() : 'YOK'));
  // kalıcılık: yeni sayfa (hatırlanan şifre ile)
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push('PAGEERR2 ' + e.message));
  await p2.goto('http://127.0.0.1:8793/#/portfolio'); await p2.waitForTimeout(3500);
  step('yeni sekmede (KV) portföy: ' + ((await p2.locator('#view').innerText()).includes('THYAO') ? 'kalıcı' : 'KAYIP') + ', giriş ekranı gizli: ' + (await p2.locator('#login').isHidden()));
  // tarayıcı, karşılaştır, alarm
  await p.goto('http://127.0.0.1:8793/#/screener'); await p.waitForTimeout(6000); step('tarayıcı satır: ' + (await p.locator('tbody tr').count()));
  await p.goto('http://127.0.0.1:8793/#/compare'); await p.waitForTimeout(800);
  await p.screenshot({ path: 'screener.png' });
  const r = await p.evaluate(async () => { const { api } = await import('/js/api.js'); const c = await api.get('/api/compare?symbols=THYAO,GARAN,AKBNK&range=1y'); const a = await api.post('/api/alerts', { symbol: 'THYAO', condition: 'above', value: 1 }); const chk = await api.post('/api/alerts/check'); const pend = await api.get('/api/alerts/pending'); return { series: c.series.length, corr: c.correlation.matrix.length, alertId: a.id, fired: chk.length, pending: pend.length, fin: Object.keys(await api.get('/api/stock/THYAO/financials?period=annual')), news: (await api.get('/api/stock/THYAO/news')).length, search: (await api.get('/api/search?q=apple')).length }; });
  step('API: ' + JSON.stringify(r));
  // çıkış
  await p.goto('http://127.0.0.1:8793/'); await p.waitForTimeout(1500); await p.click('#logout'); await p.waitForSelector('#login:not([hidden])'); step('çıkış sonrası giriş ekranı');
  console.log('HATALAR:', errs.length ? errs : 'yok');
  await b.close();
})();
