# Webtoon Translator — Adım 2.5: OCR metin gruplama

Chrome / Edge 116+ (Chromium) için Manifest V3 eklentisi. Ana sayfa DOM'undaki büyük `img` elementlerini bulur ve en fazla 3 yüklenmiş adayda Tesseract.js 7 ile İngilizce OCR çalıştırır. Çeviri, harici AI servisi ve backend içermez. Görselin gerçek dosyasını veya yazılarını değiştirmez.

Gruplama single-linkage/connected-component kullanmaz. Her yeni OCR satırı, mevcut block'un tamamıyla karşılaştırılır; oluşacak bounding box, X merkez yayılımı, ortalama merkez uzaklığı, satır yüksekliği, dikey boşluk düzeni, metin yoğunluğu ve doğal image oranları limitleri aşarsa ayrı block olarak başlatılır. Son aşamada büyük iç dikey boşluklar bölünür ve geçersiz/çok büyük block'lar elenir.

Adım 2.5.1'de ilk geometric block'lar ayrıca metin uzunluğu, alfasayısal/symbol oranı, kısa metne göre confidence, child confidence ve yakın anlamlı block bağlamıyla doğrulanır. Ardından yalnızca aynı sütundaki dikey komşular `mergeTextBlocks` ile birleştirilir; aynı yakınlıktaki rakip üçüncü block varsa merge yapılmaz. Popup ilk ve final block sayılarını ayrı gösterir.

Adım 2.5.2 final pass, aynı sütundaki dikey block merge toleransını doğal image sınırları içinde genişletir ve her birleşmeyi teşhis kaydı olarak üretir. Merge sonrası sözlüksüz sanity score; confidence, alfabetik/izinli karakter oranı, kelime şekli, casing, uzunluk ve beklenmeyen sembolleri birlikte değerlendirir. Uzun typo içeren cümleleri ve özel isimleri korurken düşük güvenli kısa garbage sonuçlarını final listeden çıkarır.

## Detect Text kullanımı

1. Build alın, tarayıcıda eklentiyi reload edin ve web sayfasını yenileyin. Popup'ı webtoon sekmesindeyken **araç çubuğundaki eklenti simgesine tıklayarak** açın. Bu, ekran yakalama için gereken geçici `activeTab` iznini verir.
2. Sayfayı kaydırarak görselleri yükleyin; **Scan Images** ile adayları kontrol edin.
3. **Detect Text** düğmesine bir kez basın. Başlangıçta DOM sırasındaki ilk N candidate alınır; görünür olma filtresi yoktur. Varsayılan N=3, `src/ocr/config.ts` içinden değişir. Orijinal piksel/fetch yolları çalışıyorsa gereksiz scroll yapılmaz; viewport fallback tüm candidate'ı otomatik kaydırarak işler.
4. Popup `Processing image 1 / 3`, `Capture 1 / 2` ve otomatik scroll bilgisini gösterir. Sonunda `Images processed: 3 / 3`, `Errors: 0`, `OCR regions: N`, `Filtered regions: N`, `Initial text blocks: N`, `Final text blocks: N` özeti görünür. Bir candidate hata verirse sonraki işlenir.
5. Ham OCR satırları ince mavi, gruplanmış metin blokları kalın pembe kutularla gösterilir. Her metin bloğunda **BLOCK N** etiketi vardır. Kutular kaydırma/boyut değişiminde izlenir, yeniden Detect Text çalışınca temizlenir.
6. Popup kapanabilir; işlemi tekrar açarak izleyebilirsiniz. Sayfa yenilenirse o sayfanın işlem takibi ve kutuları sıfırlanır.
7. İş sonunda `try/finally` ile başlangıçtaki X/Y scroll konumuna dönülür. OCR sırasında sayfaya wheel/touch/scroll tuşu veya tıklama gibi manuel giriş gelirse çalışma güvenli bir kontrol noktasında kesilir ve konum geri yüklenir. Sayfa kilitlenmez; screenshot sırasında sekmeyi aktif tutun.

### Otomatik scroll ve segmentler

Her candidate'ın ancestor zinciri incelenir. `overflow-y: auto|scroll|overlay` olan ve `scrollHeight > clientHeight` koşulunu sağlayan elementler iç scroll container olarak kabul edilir; document/window ayrıca desteklenir. En iç container'dan dışa doğru `scrollTop`, ardından gerekiyorsa `window.scrollTo({ behavior: 'instant' })` kullanılır. `scrollIntoView` sonucuna körlemesine güvenilmez; gerçek rect ve görünür kesişim her segmentte yeniden hesaplanır. Görsel, tüm container scroll değerleri ve window konumu en az 120 ms stabil olana kadar frame bazında izlenir; 8 saniye deadline vardır.

Oturum başında window X/Y ile kullanılabilecek tüm container'ların `scrollTop/scrollLeft` değerleri kaydedilir. Scroll snap, smooth scroll ve anchoring ayarları yalnızca işlem boyunca devre dışıdır. `finally` içinde inner container'lar ve window iki frame doğrulamasıyla başlangıç değerlerine döndürülür, stiller eski halleriyle geri yüklenir.

Viewport'tan uzun candidate yukarıdan aşağıya işlenir. Sonraki parça öncekinin görünür yüksekliğinin %12'si kadar overlap bırakır. Her capture'ın gerçek rect'i ve ekran boyutları ayrı hesaplanır; koordinatlar doğal görsele çevrildikten sonra sonuçlar birleştirilir. Kaplanan alanın ilerlediği ve arada boşluk kalmadığı kontrol edilir. Aynı metne benzeyen, kutuları ciddi örtüşen ve merkezleri yakın olan capture sonuçlarında yüksek confidence korunur. Ardından her image kendi içinde hafif gürültü filtresinden ve geometrik metin gruplamasından geçer.

Capture sırasında adayı örten fixed/sticky öğelerin ve kendi test overlay'lerimizin yalnızca görünürlüğü geçici kapatılır; layout değiştirilmez ve hemen geri yüklenir. Effective capture alanı browser viewport ∩ tüm overflow container client alanları ∩ candidate olarak hesaplanır. Bir candidate scroll edilemezse mevcut görünür kesit denenir; gerçekten görünür kesit yoksa `Candidate scroll failed`/candidate hatası loglanır ve sıradaki candidate'a geçilir. Yatay segmentleme henüz yoktur; görsel genişliği effective viewport'a sığmalıdır.

### OCR mimarisi / CORS

Content script → service worker → offscreen extension belgesi → Tesseract Web Worker.

Görsel edinme OCR'dan ayrıdır. Sıra: `loaded-image` (mevcut img → canvas, yeniden indirme yok) → `extension-fetch` → `page-fetch` → `viewport-capture`. Canvas `SecurityError` yakalanır. HTTP(S) izinleri değişmedi. Fetch, normal img'nin credentials davranışını kullanır (`crossorigin="anonymous"` için same-origin, diğerleri için include); cookie/header değerlerini okumaz veya kopyalamaz. `force-cache` kullanılabilir önbelleği tercih eder; farklı cache partition'ları nedeniyle önbellek garantisi yoktur. Her URL'nin başarısız fetch yöntemi aynı OCR çalışmasında tekrar denenmez.

Gerçek MV3 testinde eklenti origin'inden `referrer: pageUrl` verilse de Request değeri `about:client` oldu ve Network isteğinde Referer gönderilmedi. Bu nedenle sayfa Referer'ı yalnızca sayfa bağlamındaki CORS uyumlu fetch'te kullanılır. Referer/Origin/Sec-Fetch başlıkları taklit edilmez. Sunucu reddi veya CORS devam ederse, `activeTab` ile aktif sekmenin render edilmiş pikselleri alınır; **sadece candidate'ın görünür kısmı** offscreen belgede kırpılıp OCR'a aktarılır. Tam ekran görüntüsü kaydedilmez veya dış servise gönderilmez.

Yakalama sırasında sekmenin ve görünümün değişmediği kontrol edilir. Her parça yalnızca görünür pikselleri içerir; kalan kısma otomatik kaydırılır. Screenshot dosyaları birbirine dikilmez; her parçaya ayrı OCR uygulanır ve sonuçlar doğal koordinatlarda birleştirilir. Gerçek site URL'si olmadan CDN'ye özgü 403 nedeninin kesinleştirilemeyeceği unutulmamalıdır.

Tesseract worker, WASM çekirdekleri ve `eng.traineddata.gz` build sırasında `dist/vendor` altına kopyalanır. Çalışırken OCR kodu/dil verisi CDN'den indirilmez; OCR için görseller dış bir servise gönderilmez. CSP'deki `wasm-unsafe-eval` yerel WASM çalıştırmak içindir. `offscreen` izni DOM/Web Worker ortamını sağlar. Her görsel sonrasında worker ve offscreen belgesi kapatılır.

### Koordinatlar ve loglar

Tesseract'ın mevcut satır çıktısı korunur. Her bölge `{ text, confidence, x, y, width, height }` içerir. Başlangıç noktası görselin **sol üstü**, birim **doğal görsel pikselidir**. Orijinal bitmap tam görsele ölçeklenir. Ekran kırpmasında `screenshotWidth / innerWidth` ve `screenshotHeight / innerHeight` oranları kullanılır; DPR tekrar çarpılmaz. Kırpmanın doğal görseldeki x/y ofseti OCR koordinatlarına eklenir. Ekran overlay'i ayrıca görüntülenen boyuta ölçeklenir.

Web sayfasının F12 → Console bölümünde:

```text
[Webtoon Translator] OCR text { text: "HELLO WORLD", confidence: ..., x: ..., y: ..., width: ..., height: ... }
[Webtoon Translator] Text block { id: "image-1-block-1", text: "HELLO WORLD!", confidence: ..., x: ..., y: ..., width: ..., height: ..., lineCount: ... }
[Webtoon Translator] Text grouping complete { image: 1, rawRegions: ..., filteredRegions: ..., textBlocks: ... }
[Webtoon Translator] OCR completed for image { src: ..., regions: ..., naturalWidth: ..., naturalHeight: ... }
[Webtoon Translator] Image acquisition failed { method: "extension-fetch", imageUrl: ..., pageUrl: ..., hostname: ..., status: 403, statusText: "Forbidden", ... }
[Webtoon Translator] Image acquired { method: "viewport-capture", ... }
```

### Sınırlar / doğrulama

- `src/ocr/config.ts`: `MAX_OCR_IMAGES = 3`, %12 overlap, en fazla 40 segment/görsel, stabilizasyon süreleri ve duplicate eşikleri. `types.ts` içinde en fazla 32 megapiksel ve 20 MB/görsel sınırı vardır. Görseller ve parçalar sırayla işlenir.
- Her fetch en fazla 15 saniye, her parçanın OCR worker işlemi en fazla 120 saniye beklenir. Uzun görseller daha fazla capture gerektirir.
- Tesseract İngilizce ve `SPARSE_TEXT` modundadır. El yazısı, stilize font, döndürülmüş yazı ve düşük kontrastta hatalar olabilir. Gruplama yalnızca geometri kullanır; konuşma balonu segmentasyonu yapmaz.
- Overlay normal ölçekleme, padding/border ve yaygın `object-fit/object-position` kullanımlarını destekler. CSS döndürme/skew, karmaşık object-position calc ifadeleri ve ataların kırpma/maskeleri için hizalama garantisi yoktur.
- Lazy-load ile henüz yüklenmeyenler OCR'a alınmaz; kaydırıp tekrar deneyin. Yeniden Detect Text OCR'ı yeniden çalıştırır, kalıcı OCR önbelleği yoktur.
- Kontrollü test: `tests/ocr-smoke.cjs`. Microsoft Edge ve Playwright gerekir (`npm install --no-save playwright`); build sonrası `node tests/ocr-smoke.cjs`. İzole `.test-profile` kullanır. Test HTTP sunucusu yalnızca test süresince çalışır, eklenti backend'i değildir.
- Test 800×400 İngilizce yazılı PNG'ler sunar, sayfa canvas'ının cross-origin erişimde engellendiğini doğrular; gerçek eklenti mesajlaşması, yerel WASM/OCR, 3 görsel sınırı, koordinat ölçeği, popup, tekrar tarama ve HTTP 403 hatasını kontrol eder. Gerçek webtoon içeriklerinde doğruluk ayrıca gözle değerlendirilmelidir.
- `node tests/acquisition-smoke.cjs`: Normal img için 200, fetch için 403 dönen kontrollü sunucu ile gerçek Edge/MV3 screenshot fallback testi. İzole test tarayıcında DevTools extension action çağrısıyla gerçek `activeTab` grant'i oluşturur. Üretim manifestine test izni eklemez.
- `node --test tests/captureMapping.test.mjs` (Node 24): Kısmi görünür alan, farklı ekran ölçekleri, kırpma ofseti, içe yuvarlama ve geçersiz viewport kontrolleri.
- `node --test tests/deduplicate.test.mjs`: Yakın/benzer sonuçları birleştirme, yüksek confidence seçimi, farklı konum ve metinlerin korunması.
- `node tests/auto-scroll-smoke.cjs`: Sayfanın ortasından başlar, 3 candidate için 2/1/2 capture ile 9 bölgeyi doğrular; fixed header, overlap, üç görselde kalıcı kutular, hata sonrası devam ve başarı/hata/manuel müdahalede scroll restorasyonunu sınar.
- `node tests/inner-scroll-smoke.cjs`: `overflow-y:auto` reader içinde kısmen görünür kısa candidate ve başlangıçta görünmeyen iki uzun candidate'ı sınar. Gerçek Edge/MV3 sonucunda capture sayıları 1/2/3, text region sayısı 9'dur; container max-scroll son segmenti, fixed UI gizleme ve `scrollTop/scrollLeft` restorasyonu doğrulanır.

## Dosyalar

- `manifest.json`: Eklenti bilgileri, otomatik content script ve popup tanımı.
- `src/content.ts`: İlk tarama, MutationObserver, yüklemeyi bekleyen manuel tarama ve geçici aday işaretleri.
- `src/popup.ts`: Aktif sekmeyi taratır; aday sayısını, bekleyen görselleri ve hataları popup'ta gösterir.
- `src/popup.html`: Başlık, Scan Images butonu ve sonuç alanı.
- `src/popup.css`: Basit popup stili.
- `tsconfig.json`: TypeScript derleyici ayarları.
- `package.json`: Geliştirme bağımlılıkları ve build komutları.
- `scripts/copy-static.mjs`: Manifest, HTML ve CSS dosyalarını dist'e kopyalar.
- `.gitignore`: Üretilen dosyaları ve bağımlılıkları Git dışında bırakır.
- `pnpm-lock.yaml`: Bu ortamda kullanılan pnpm bağımlılık sürümleri.
- `pnpm-workspace.yaml`: pnpm build script izinleri (esbuild açık; Tesseract'ın bağış bildirimi postinstall script'i kapalı).
- `scripts/build.mjs`: esbuild ile modülleri paketler, yerel OCR kaynaklarını kopyalar.
- `src/background.ts`: Content script isteklerini offscreen belgeye yönlendirir ve belge ömrünü yönetir.
- `src/offscreen.html`, `src/offscreen.ts`: Gizli OCR ortamı ve mesaj alıcısı.
- `src/ocr/ocrService.ts`: Yalnızca alınmış Blob üzerinde Tesseract ve satır sonuçları.
- `src/image/imageAcquisition.ts`: Fetch/Blob okuma, ekran kırpma, edinme teşhisleri.
- `src/image/contentAcquisition.ts`: Yüklü img, fallback sırası, sayfa fetch ve capture doğrulaması.
- `src/image/captureGeometry.ts`, `captureMapping.ts`: Görünür alan ve screenshot → doğal koordinat dönüşümü.
- `src/image/types.ts`: Edinme istek/sonuç ve log tipleri.
- `src/image/autoScroll.ts`: Stabilizasyon, deterministik scroll, kullanıcı müdahalesi ve başlangıç konumu restorasyonu.
- `src/ocr/config.ts`, `deduplicate.ts`: Ortak capture, filtreleme ve gruplama eşikleri ile overlap tekrar temizliği.
- `src/ocr/textFiltering.ts`: Saf, muhafazakâr OCR gürültü filtresi ve ret nedenleri.
- `src/ocr/textGrouping.ts`: Saf geometrik gruplama, okuma sırası, metin birleştirme ve block confidence hesabı.
- `src/ocr/textBlockValidation.ts`: Uzunluk ve bağlama duyarlı block kalite doğrulaması.
- `src/ocr/textBlockMerge.ts`: Dikey komşuluk ve competing-block kontrollü final block birleştirmesi.
- `src/ocr/textSanity.ts`: Merge sonrası sözlüksüz final metin kalite puanı ve ret nedenleri.
- `src/ocr/contentOcr.ts`: İlk 3 adayın sıralı OCR, filtreleme ve gruplama akışı; durum ve console logları.
- `src/ocr/types.ts`: Koordinat tipleri ve performans sınırları.
- `src/ocr/overlay.ts`: Mavi OCR bölgeleri, pembe TextBlock kutuları ve ekran koordinatı dönüşümü.
- `tests/textGrouping.test.mjs`: Filtreleme, okuma sırası, balon ayrımı, tire/noktalama ve candidate yalıtımı testleri.
- `tests/textBlockCleanup.test.mjs`: Kısa garbage temizliği, punctuation koruması ve kontrollü block merge testleri.
- `tests/ocr-smoke.cjs`: Gerçek MV3/Edge OCR entegrasyon testi.

## Build (Windows 11 / PowerShell)

Node.js LTS ve npm kurulu olmalı. Proje klasöründe:

```powershell
npm install
npm run build
```

Alternatif olarak pnpm ile `pnpm install --frozen-lockfile` ve `pnpm run build` kullanılabilir.

Çıktı `dist/`: Manifest, content/popup/background/offscreen dosyaları ve `vendor/` OCR kaynakları. Tarayıcıya **dist klasörünün tamamını** yükleyin.
Yalnızca tip kontrolü: `npm run typecheck`.

## Tarayıcıya yükleme

1. Chrome'da `chrome://extensions`, Edge'de `edge://extensions` adresini açın.
2. Geliştirici modunu (Developer mode) açın.
3. Paketlenmemiş öğe yükle / Load unpacked düğmesine basın.
4. Bu projenin **dist** klasörünü seçin; proje kökünü seçmeyin.
5. Önceden açık olan test sayfanızı yenileyin. Eklentiyi araç çubuğuna sabitleyebilirsiniz.

Kod değişikliğinden sonra yeniden build alın, eklenti kartındaki yenile düğmesine basın ve test sayfasını yenileyin.

## Console ve başarı kontrolü

Görsellerin bulunduğu **web sayfasında** F12 → Console açın. Eklenti yönetim sayfasının console'u kullanılmaz. Console'un Info/Log seviyesi açık olsun; `[Webtoon Translator]` ile filtreleyebilirsiniz.

- Her img için `image` kaydında `src`, `width`, `height`, `naturalWidth`, `naturalHeight` görünür.
- `naturalWidth >= 300 || naturalHeight >= 300` ise ayrıca `candidate image` kaydı görünür. Bu yalnızca boyut filtresidir; büyük avatar da aday sayılabilir.
- Popup'taki **Scan Images** butonu yüklemeleri bekledikten sonra **Candidate images: N** gösterir. Sayı sayfa ve popup console'una da yazılır.
- Tarama, butona basıldığı anda mevcut img'leri kapsar; bu sırada kaldırılanlar sonuçtan çıkarılır. Sonradan eklenenler MutationObserver ile loglanır, sonraki manuel taramada sayılır.
- Yüklenmekte olan görseller için `load/error` beklenir (paralel, en fazla 8 saniye). Hâlâ bekleyen varsa sonuç kısmi olarak işaretlenir; popup'ta bekleyen görsel sayısı ve yeniden tarama önerisi gösterilir. Kaydırma gerektiren lazy-load görselleri zorla yüklenmez.
- Adayların çevresinde kırmızı outline ve sol üstte **WT Candidate** etiketi görünür. Ayrı overlay görselin boyutlarını veya mevcut stillerini değiştirmez; kaydırma sırasında konumu güncellenir. İşaretler 15 saniye sonra veya sonraki taramanın başında kaldırılır.
- Değişmeyen görseller tekrar loglanmaz; yeniden taramada yine toplam adaya dahil edilir.
- Sayfayı kaydırın: sonradan eklenen görseller ve yüklenen lazy-load görselleri loglanmalıdır.
- İlk otomatik tarama beklemeden mevcut durumu `Initial scan (loaded images)` olarak loglar. Doğal boyutlar ilk anda 0 olabilir; `load` sonrası güncel kayıt ve gerekiyorsa aday kaydı yazılır. Manuel tarama bundan ayrı olarak yüklemeyi bekler.
- Kaynak ya da ölçüleri değişen aynı element tekrar değerlendirilir. Aynı URL'yi kullanan farklı img elementleri ayrı sayılır.
- `src` alanında tarayıcının seçtiği `currentSrc`, yoksa `src` kullanılır; böylece srcset ile seçilen gerçek kaynak raporlanır.

Kontrollü test için normal bir web sayfasının Console'unda aşağıdakini çalıştırabilirsiniz. Bunu yalnızca test etmek istediğiniz sayfada kullanın; üç geçici görsel ekler:

```javascript
(() => {
  const makeSource = (w, h) => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="orange"/></svg>`
  );
  const small = new Image();
  small.src = makeSource(40, 40);
  const large = new Image();
  large.src = makeSource(400, 600);
  const lazy = new Image();
  lazy.src = makeSource(1, 1);
  document.body.append(small, large, lazy);
  setTimeout(() => { lazy.src = makeSource(600, 800); }, 2000);
})();
```

İki saniye sonra Scan Images'a basınca önceki aday sayısı **2 artmalıdır**. 40×40 görsel aday olmaz. Tekrar basınca aynı sayı görünür, aynı görsel kayıtları tekrar yazılmaz. Sayfayı yenilemek test görsellerini kaldırır. Sitenin CSP kuralları data görsellerini engelliyorsa başka bir normal sayfa kullanın.

## Kapsam sınırları

Tarayıcı güvenliği nedeniyle `chrome://`, `edge://` gibi iç sayfalarda ve eklenti mağazalarında content script çalışmaz. Yerel HTML dosyası için eklenti ayrıntılarında dosya URL'lerine erişime izin verin. Bu sürüm ana belgeyi tarar; iframe içeriği, Shadow DOM, CSS arka planları ve canvas kapsam dışıdır. Görseller indirilmez veya değiştirilmez.

Resmî kaynaklar: [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
