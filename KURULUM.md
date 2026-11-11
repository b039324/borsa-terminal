# Borsa Terminal — GitHub Pages + Cloudflare Worker kurulumu

Sunucu, Docker ve aylık ücret yok. İki parça var:

| Parça | Nerede | Ne yapar |
|---|---|---|
| `docs/` | GitHub Pages | Arayüz ve tüm hesaplamalar (teknik/temel analiz, portföy K/Z, tarayıcı). Hepsi tarayıcınızda çalışır. |
| `worker/worker.js` | Cloudflare Worker | Yahoo Finance'ten veri çeker, şifreyi kontrol eder, takip listesi/portföy/alarmları KV'de saklar. |

Şifre Worker'dadır. Sayfayı açan biri şifreyi bilmeden hiçbir veri göremez ve portföyünüze erişemez.

---

## 1) Cloudflare Worker (10 dk)

1. https://dash.cloudflare.com → ücretsiz hesap açın (kart istemez).
2. **Storage & Databases → KV → Create** → ad: `borsa-store`.
3. **Workers & Pages → Create → Create Worker** → ad: `borsa-terminal` → **Deploy**.
4. **Edit code** → editördeki her şeyi silin → bu projedeki `worker/worker.js` içeriğini yapıştırın → **Deploy**.
5. Worker'ın **Settings → Bindings → Add → KV namespace**:
   - Variable name: `STORE`  (aynen böyle)
   - KV namespace: `borsa-store`
6. **Settings → Variables and Secrets → Add**:
   - Tip **Secret**, ad `AUTH_PASSWORD`, değer: **en az 10 karakterlik** güçlü şifreniz.
   - (Önerilir) Tip **Text**, ad `ALLOWED_ORIGIN`, değer: `https://KULLANICIADI.github.io` — Worker'ı yalnızca sizin sitenizden çağrılabilir yapar.
7. Worker adresini not edin: `https://borsa-terminal.KULLANICIADI.workers.dev`.
   Tarayıcıda `…/api/health` açın: `{"ok":true,"kv":true,"password_set":true}` görmelisiniz.

## 2) Adresi arayüze yazın

`docs/js/config.js` dosyasında `WORKER_URL` değerini Worker adresinizle değiştirin.

## 3) GitHub Pages

1. GitHub'da yeni repo açın (private olabilir; Pages ücretsiz planda private repoyu da yayınlar).
2. Bu klasörün içeriğini yükleyin (`docs/`, `worker/`, `KURULUM.md`…).
3. Repo **Settings → Pages → Source: Deploy from a branch → Branch: `main`, klasör: `/docs`** → Save.
4. 1-2 dk sonra `https://KULLANICIADI.github.io/REPO-ADI/` açılır. Şifrenizi girin.
   "Bu cihazda hatırla" işaretlerseniz şifre yalnızca o tarayıcıda saklanır.

> Not: GitHub Pages sitesi herkese açık adrestir (içinde veri yoktur, sadece arayüz kodu). Veriler Worker'dadır ve şifre ister.

---

## Bilmeniz gerekenler

- **Alarmlar** yalnızca sayfa açıkken kontrol edilir (60 sn'de bir). Kapalıyken bildirim gelmez. Telefona anlık bildirim istenirse Worker'a zamanlanmış görev + Telegram/ntfy eklenebilir.
- **Ücretsiz Worker sınırları:** günde 100.000 istek, istek başına kısa CPU süresi. Tarayıcı sayfası (30 hisse) birkaç istek yapar; normal kullanımda yeter. "Error 1102" benzeri bir hata görürseniz Workers Paid ($5/ay) ya da tarama evrenini küçültmek çözer.
- **Yahoo verisi** ~15 dk gecikmelidir, kişisel kullanım içindir. Yahoo zaman zaman arayüzünü değiştirir; temel veri/finansal tablolar bundan etkilenebilir, fiyat ve grafik en dayanıklı kısımdır.
- **İki cihazdan aynı anda değişiklik** yaparsanız, ikinci kayıt "başka cihazda değişmiş" uyarısıyla yenilenir ve işlemi tekrarlamanız istenir (veri ezilmez).
- **Yedek:** Portföy sayfasındaki ⬇ CSV ile ara sıra dışa aktarın.
- Şifreyi değiştirmek için Worker'daki `AUTH_PASSWORD` secret'ını güncelleyin; cihazlar yeniden şifre ister.

## Yerelde deneme / geliştirme

`test/` klasörü Yahoo'yu taklit eden bir test sunucusu içerir (`node test/harness.mjs`, sonra `node test/e2e.js`; Playwright gerekir). Bu sürümdeki teknik göstergeler, ilk sürümdeki Python/pandas hesaplarıyla karşılaştırılmış ve birebir aynı çıkmıştır.
