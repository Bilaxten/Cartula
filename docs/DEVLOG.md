# DEVLOG

## 2026-10-05 — Kulübeler gitti, rüzgâr kenardan çıkar, bulutların tipi var

**Ne yapıldı:** Uğur canlı sürüme baktı: kulübeleri beğenmedi; rüzgâr
çizgileri birden sönmesin, haritadan çıkana kadar yaşasın; yağmur bulutları
da öbürleri gibi (daha yavaş) gezsin; bulutlar daha çeşitli olsun: farklı
yükseklik, pofuduk, küçük bulut kümeleri. Dört commit: kulübeler ve pencere
ışığı kaldırıldı (`0937cba`), rüzgâr kenara kadar (`450a87b`), bulut tipleri
ve doku gölge (`da0b8b7`), hava bulutları geçiyor (`6f1c1e2`).

**Neden bu yaklaşım:** Rüzgârda "durumsuz" kalmak şarttı (ekran görüntüsü
tekrarlanabilsin). Değişken ömürlü nesiller durumsuz hesaplanamaz, çünkü
hangi neslin sürdüğünü bilmek öncekilerin hepsini toplamayı gerektirir. Çözüm
harita başına önceden hesap: her çizgiye 6 yol, her biri doğuştan kenara
kadar; nesil süresi yolun süresi, 6 yol bir döngü. Yan kazanç: kare başına
entegrasyon bitti. Çizgi kenarda "sönmüyor", nokta nokta kenarın ötesinde
kayboluyor; nesil ancak son noktası da gidince bitiyor (`--wind` 300 sn'de
bunu ve başı haritadayken alfanın hiç düşmediğini ölçüyor).

Bulut çeşitliliği lob sayısını artırdı (küme 7 lob). Bir önceki turda 7 fazla
lob gölge döngüsünde ~25-30 ms yemişti; o yüzden gölge önce dokuya taşındı:
JS her bulut hareketinde lobları yarım çözünürlüklü bir dokuya çiziyor, shader
tek okuma yapıyor. Sonuç tersine döndü: gündüz kare SwiftShader'da ~50 ms
hızlandı. Tipler tam voxel: lob artık bir katman tavanı (`top`) taşıyor, yüksek
bir kubbe alçaktan kesilince stratus levhası çıkıyor; kümülüs kuleleri dar
tutuldu ki 4-6 katman yukarıdan bakınca da uzun okunsun.

Hava bulutları gezince altlarındaki biyom değişiyor; zaten tile başına doku
vardı (ne yağar + zemin seviyesi), yani bulutu serbest bırakmak yetti. Ayrıca
harita dışına yağış ve sönen buluttan yağış kapatıldı.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz; `--wind`,
`--sky` (dört tip, doku = analitik elips ≤ 1/255), `--weather` (hız aralığı,
dönüş, sönme), `--night` (yalnız lav) yeni kontrollerle; her biri bilerek
bozulup kırmızı görüldü. Headless Edge: genel görünüm, küme ve kümülüs yakın
çekimi, hava bulutu 8 sn aralıklı dizi, kenardan çıkan çizgi dizisi, gece lav.
Önce/sonra perf dönüşümlü.

**Açık:** gerçek GPU; bulut tiplerinin ve küçülen bulut örtüsünün Uğur'un
gözüne uyması; uzun ömürlü çizgilerin yoğunluk hissi.

## 2026-10-05 — Kulübeler, lavın ışığı, bulutlardan yağan yağmur, akan rüzgâr

**Ne yapıldı:** Uğur yeni özelliklere kendi PC'sinde baktı ve dört şey
istedi, sonra bir beşinci: lav neden parlamıyor; yağmur ve kar yarı saydam
bulutlardan yağsın; rüzgâr hızlıysa uzun, yavaşsa kısa çizgi olsun, ani
dönmesin, animasyonu bir tık sıklaşsın; ve "ev koymuyoruz ki niye
parlamalar var": yerleşim tile'larındaki pencere ışıkları gitsin, yerine
voxellerden yapılmış sabit bir kulübe gelsin, onun penceresi parlasın.
Commit'ler: rüzgâr (`b63070b`), kulübeler (`7bc509d`), gece ışıkları
(`d959a4c`), bulutlu yağmur/kar (`38aa281`), hava bulutu gölgesi kalktı
(`e0355b6`).

**Neden bu yaklaşım:** Rüzgârda "ani dönüş" bir ölçüye çevrildi: çizilen
her çizginin ardışık iki parçası arasındaki açı bölü uzunluk. Eski kodda bu
1100°/tile'ı geçiyordu; çoğu harita kenarında kenar boyunca kayan
çizgilerden ve alanın tek hücrelik kırıklarından. Çözüm üç katman: alan
daha geniş yumuşatıldı, entegrasyon tile başına en çok 14° dönebiliyor
(alan ne yaparsa yapsın) ve çizilen noktalar iki kez yumuşatılıyor; kenarda
yol bitiyor. Uzunluk zaten hıza bağlıydı ama hız alanı dardı (çoğu 0.5-0.7);
şimdi çizgi yolunun sabit bir zaman penceresini kaplıyor ve hız alanı vadi
tabanı, yamaç ve seed'li geniş esinti bölgeleriyle 0.32-1.35 arası. "Bir tık
fazla kare" için baş artık tam adım atlamıyor: zaman 1/12 s'ye kuantize,
çizgi entegrasyon noktaları arasında kesirli kayıyor (4.8 → 12 güncelleme/s),
hâlâ zamanın saf fonksiyonu.

Lav gece aslında ışıyordu ama ışıması gece renk düzeltmesinin İÇİNDE
kalıyordu; düzeltme onu karartıyordu, bloom ise yalnız yerleşimi görüyordu.
Gece varyantında lav ışığı düzeltmeden sonra ekleniyor ve bloom'a giriyor.
Bloom kaynağının kamera durunca yeniden kullanılması korunmak istendi; lav
nabzı zamanla değiştiği için kaynak renk yerine miktar yazıyor: R pencere,
G lav, B/A lav × nabız fazının cos/sin'i. Bulanıklaştırma doğrusal olduğundan
birleştirme sin(wt+φ) = sin wt·cos φ + cos wt·sin φ ile her tile'ın nabzını
bulanık kanallardan geri kuruyor; 8 bit saklamayla hata 0.002.

Kulübe tek bir sabit model (3×3, 5 kat, kazıklı); her parçası bir harita
voxel'i. Yerleşim üretim hattının son pass'i: son kademeler belli olduktan
sonra, düz, kuru, yaşanabilir, suya yakın yerler; seed'li. Mesh'e yalnız dış
kabuk giriyor; pencere voksellerinin dış yüzü ışık bayrağını taşıyor, yani
gece pencere varyantı yalnız 12 üçgen çiziyor.

Yağmur bulutunda asıl soru bulut hareket edince ne olacağıydı. Açık hava
bulutları haritayı geçiyor; bir kar bulutu aynı şeyi yapsa çöle giderdi.
Hava bulutları yerinde, yavaşça salınıyor; parçacıklar buluta göre
konumlanıyor ve altlarındaki zemini ve ne yağacağını küçük bir dokudan
okuyorlar, böylece bulut nereye kayarsa yağmur oradan, doğru zemine düşüyor.
Bulut, gölgesi ve yağmuru tek bir `cloudsAt` çağrısından besleniyor.

**Dikkat çeken:** Hava bulutuna açık bir gölge verildi, sonra sayfa içinde
aç/kapa ile ölçüldü: SwiftShader'da kare başına ~25-30 ms. Sebep arazi
shader'ının bulut lob döngüsü: her fragmanda koşuyor ve lob sayısı ~12'den
~19'a çıkmıştı. Bulut zaten saydam ve altını tonluyor; gölge kaldırıldı.
Ölçümler gürültülü (aynı makinede başka işler de vardı); bu yüzden önce/sonra
sayfaları dönüşümlü ve birden çok tur ölçüldü, maliyet kararları sayfa içi
aç/kapa ile verildi.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz. `--wind`'e
büküm, uzunluk-hız ilişkisi ve güncelleme hızı; yeni `--huts`; `--night`
(bayrak yalnız kulübe pencerelerinde, hiçbir yerleşim tile'ında değil, lav
ışıması yalnız lavda, fazör geri kurma hatası); `--weather` yeniden yazıldı.
Her yeni kontrol bilerek bozulup kırmızı görüldü. Headless Edge (SwiftShader,
CDP, elle adımlanan saat): önce/sonra kare dizileri, gece/gündüz yakın
çekimler, üstten kulübe, telefon düzeni.

**Açık:** gerçek GPU ve telefon; rüzgârın 12 Hz'te gözle hissi; hava
bulutlarının yoğunluğu/opaklığı ve kulübe renkleri Uğur'un gözüne kalmış.

## 2026-10-05 — Telefon: harita önce, iki parmak zoom, ☰ panel

**Ne yapıldı:** Uğur telefonda canlı siteye baktı: kötü görünüyor, zoom
kötü çalışıyor, panel küçülebilsin. Üç commit: ☰ ile küçülen panel
(`7b76615`), telefon düzeni (`e5c1fc4`), dokunmatik gezinme (`bb2caae`).

**Neden bu yaklaşım:** Önce ölçüldü (headless Edge, cihaz öykünmesi, CDP
dokunmatik olayları). Sorun "kötü görünüm" değil yokluktu: hiç telefon
düzeni yoktu, 312 px panel 390 px ekranda haritaya 78 px bırakıyordu; hiç
dokunmatik dinleyici yoktu, iki parmak haritayı değil sayfayı büyütüyordu.
Panel telefonda çekmeceye döndü, harita tam ekran oldu; `#stage`'e
`touch-action: none` verilip pointer olayları bağlandı, ama panelde sayfa
zoom'u erişilebilirlik için bırakıldı. ☰ düğmesi tek eleman ve hep aynı
yerde (`position: fixed`), çünkü "yerinde ve boyutu sabit" istendi; sayfa
zoom'u bile onu büyütmesin diye `visualViewport` ile geri ölçekleniyor.
Kıstırma matematiği DOM'suz bir dosyada (`src/touch.js`): iki parmağın
ortası ve aralığı karelere bölünür, her kare arasında parmak altındaki nokta
parmak altında tutulur. İzometrik kamera ortografik ve `zoom` yarı genişlik;
çözüm mevcut `panVector`'dan geçiyor, doğrulaması ise ondan bağımsız bir
izdüşümle yapılıyor ki ikisinde aynı işaret hatası birbirini örtmesin.

**Dikkat çeken:** Panel kayarken WebGL tuvalinin boyutu her karede
değişiyor; tuvali yeniden boyutlamak onu siler, çizim bir sonraki kareye
kalırsa bir boş kare görünür. Bu yüzden yeniden boyutlama ve çizim
`ResizeObserver` içinde, düzen ile boyama arasında. Masaüstünün aynı
kaldığını göstermek için piksel farkı alındı: başlıktaki ☰ sütunu başlığı
0.25 px kısaltmıştı ve altındaki her şey alt piksele kayıyordu (yalnız
dönmüş ok işareti farklı çıktı); yükseklik 88.75 px'e sabitlendi.
CDP'de bir tuzak: `touchEnd` yalnız listelediği parmağı kaldırır, bir
`touchMove`'dan parmak çıkarmak onu kaldırmaz.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz; yeni
`--layout` harness'i (panel, kompakt düzen, 200 rastgele kıstırma), her
kontrol bilerek bozulup kırmızı görüldü. Önce/sonra ekran görüntüleri ve
CDP dokunmatik kayıtları 390×844, 360×740, 844×390, 1376×808.

**Açık:** gerçek telefon ve iOS Safari; zoom'lu sayfada görsel viewport
kaydırması; gerçek GPU'da kayma akıcılığı.

## 2026-10-05 — Ölç, sonra ekle: performans paneli, gece ışıkları, köpük, rüzgâr, hava, araziye uyan dalga

**Ne yapıldı:** Önce ölçüm aracı, sonra yedi görsel/davranış işi, her biri
tek commit: performans paneli (`e8da874`), yerleşimlerde gece ışıkları +
bloom (`127a590`), kıyı köpüğü (`7265a2a`), araziyi izleyen rüzgâr
çizgileri (`a2f542a`), biyoma göre yağmur ve kar (`385e9e3`), varsayılan
harita 320² (`ae4e264`), bilaxten.art gibi davranan tema ve dil
(`d64982c`), kıyıya doğru halkalanan dalgalar (`95c08a5`). İlk plandaki
ağaç sallanması Uğur'un kararıyla rüzgâr çizgilerine döndü.

**Neden bu yaklaşım:** Panel önce geldi, çünkü sonraki her işin bedeli
onunla söylenecekti. Sayım kaynakta: renderer her çizim ve ayırmayı bir
sayaçtan geçiriyor, harness sayaçsız çağrıyı kırmızı yapıyor; yani yeni bir
geçiş sayılardan sessizce düşemiyor. Gece ışıklarında asıl iş görünür
olmalarıydı: gece rengi CSS ile WebGL'in ÜSTÜNE uygulanıyordu ve her ışığı
gri-kahveye boyuyordu. Düzeltme, aynı formülü ışıklar yanarken shader'a
almak ve ışığı düzeltmeden sonra eklemek oldu; formülün CSS'le aynı olduğu
harness'te, ekranın aynı kaldığı piksel farkıyla (≤4/255) gösterildi.
Bloom'un parlak geçişi bir eşik değil, yalnız yerleşimi yazan bir shader
varyantı: kar ya da güneşli kum yanlışlıkla parlamıyor. Dalgalarda tek
kural ortak kenarları birlikte oynatmaktı; değerler bu yüzden tile'da
değil grid köşesinde.

**Dikkat çeken:** SwiftShader'da gündüz çerçevesi önce ~20 ms yavaşladı ve
sebep hiç çalışmayan gece koduydu. Yazılımsal rasterizer dallanmanın iki
yanını da maskeyle çalıştırıyor; deney kopyalarıyla bölerek bulundu (gece
bloğu ~18 ms, renk düzeltmesi ~4 ms). Çözüm derlenmiş varyantlar ve
yerleşim üçgenlerini index buffer'ın sonunda kendi aralığına almak; sonra
gece de gündüz de eski hızına döndü. Rüzgâr alanında iki hata görüntüyle
yakalandı: normalleştirilmemiş curl noise hâkim rüzgârı boğuyordu, vadi
yönü seçimi rüzgâra dik vadilerde işaret değiştirip çizgileri bir noktada
durduruyordu.

**Doğrulama:** her commit'te `bash scripts/checks.sh` → temiz; yeni
harness'ler `--perf`, `--night`, `--wind`, `--weather`, `--mesh`'e köpük ve
dalga kontrolleri; her biri önce bilerek bozulup kırmızı görüldü. Headless
Edge'de (SwiftShader) önce/sonra ve gece/gündüz ekran görüntüleri, aynı
sayfada dönüşümlü A/B ile kare süresi.

**Açık:** gerçek GPU, telefon, Firefox/Safari; animasyonlar yalnız sabit
karelerle görüldü; bloom bulutların önünde de parlıyor (kaynak geçişi
bulut çizmiyor).

## 2026-10-05 — Unity kapalı, Boşluk+sürükle, ortala, çeşitli bulutlar

**Ne yapıldı:** Uğur'un dört isteği, dört commit. Unity export düğmesi
şimdilik gizli, kod ve testi yerinde (`b7fd80e`). Boşluk basılıyken
sürükleme iki görünümde de kaydırıyor (`8c0c60b`). Açı çipine "ortala"
düğmesi (`527f137`). Bulutlar artık birbirine benzemiyor ve gölgeleri
kendi şekillerinde (`e456dcf`).

**Neden bu yaklaşım:** Unity'yi silmek yerine bayrak: geri gelmesi tek
satır, `--export` bağın kopmadığını da denetliyor. Boşluk için global
dinleyici, ama metin alanı ve select'e dokunmadan; düğmenin tıklaması
keyup'ta tetiklendiği için keydown ile birlikte keyup da engelleniyor.
Ortala yeni bir kadraj hesaplamıyor, yeni haritanın kullandığı
`fitCamera`'yı çağırıyor — gökyüzü dahil, her açıda geçerli olan çerçeve;
açı korunuyor. Bulutlar için en ucuz ama en çok fark yaratan şey
çeşitliliği tesadüfe bırakmamak oldu: boyut ve yükseklik tabakalı
dağıtılıyor, yani her gökyüzü küçük ve büyük bulutu birlikte taşıyor.
Şekil, bulutu 1-3 elipsoit lobun birleşimi yapmaktan geliyor; aynı loblar
gölgeye de veriliyor (lob başına bir elips), böylece gövde ve gölge tek
kaynaktan. Bedeli lob döngüsü (6 yerine en çok 18 adım); buna karşılık
mesh'ten iç yüzler atıldı ve bulut üçgeni üçte bire indi.

**Dikkat çeken:** Eski bulut seed'i her haritada sabit 1337'ydi — "bulutlar
benziyor" kısmen buydu: farklı haritalar aynı gökyüzünü taşıyordu. İkinci
sebep hash'ti: `seed ^ salt` üstüne çıplak LCG, ardışık tuzlar ilişkili
değerler veriyordu. Bulutlar büyüyünce eski solma aralığı (iki yarıçap
öteye) haritanın yanında gri bir hayalet bıraktı; ekran görüntüsünde
görüldü, solma bulutun kendi erimine indirildi.

**Doğrulama:** `checks.sh` temiz; `--sky` yeni kontroller (8 seed: hacim,
şekil, kalınlık, yükseklik çeşitliliği; seed başına farklı gökyüzü; gölge
ve gövde aynı şekil; tavan; iç yüz yok; üçgen bütçesi). Headless Edge'de
CDP girdi olaylarıyla etkileşim ve ekran görüntüleri.

**Açık:** gerçek GPU ve gerçek klavye; bulutların akarken hissi.

## 2026-10-05 — Su dalgası: siyah yarıklar kapandı, dalga okunur oldu

**Ne yapıldı:** Uğur iso görünümde suyun yalıyar dibinde inip çıktığını
ve inerken aradaki boşluğun siyah göründüğünü bildirdi. Kök neden geometri:
yüzey dinlenme kademesi etrafında oynuyor, komşu her yüz o kademede
bitiyordu; çukurda sütunun boş içine yarık açılıyor, arka plan rengi
görünüyordu. Ayrıca tile başına kıyı sönümü iki komşu su tile'ının ortak
kenarını farklı oynatıp aralarında da ince siyah çizgi açıyordu
(`073cf21`). Ardından dalga daha görünür yapıldı (`92c546f`).

**Neden bu yaklaşım:** Üç seçenek vardı: derinlik/temizleme hilesi (yarığı
gizler, nedenini değil), suya her yöne etek, ya da yüzeyi yalnız aşağı
oynatıp suya bakan duvarları çukura kadar uzatmak. Sonuncusu seçildi: tepe
dinlenme kademesi olunca suyun üstündeki hiçbir yüz değişmiyor, yalnız
alttaki duvarlar `WAVE_DIP` kadar uzuyor — yeni quad yalnız suyla aynı
kademedeki kara ve kenar halkası için (457 quad, %0.7). Boşluğu dolduran
renk, Uğur'un istediği gibi üstteki bloğun kendi yan rengi. Sönüm kalktı
çünkü artık gerekmiyor ve ortak kenarı bozan oydu. Dalganın okunurluğu
için tile başına gürültü yerine aynı dalga fonksiyonunun tile merkezindeki
değeri parlaklık oldu: ışık ve yükseklik aynı şeyi söylüyor, titreme yok.

**Doğrulama:** `checks.sh` temiz; `--mesh`'te yeni "çukur yarık açmaz"
kontrolü (eski renderer'da 3842 delik + 398 çıplak kenar ile kırmızı).
Headless Edge (SwiftShader): aynı kamera ve sabit anlarda önce/sonra —
arka plan renkli piksel 21-907 → 0.

**Açık:** gerçek GPU'da ve akan animasyonda gözle bakılmadı.

## 2026-10-05 — Arayüz iki dilli: TR / EN

**Ne yapıldı:** Uğur'un kararı — bilaxten.art'ta görünen her şey Türkçe ve
İngilizce, sağ üstte küçük bir *TR / EN* ile. Cartula'nın paneli yalnız
İngilizceydi. Şimdi tek bir sözlükten (`src/i18n.js`, 158 anahtar) iki
dilde geliyor; panel başlığında sitedekiyle aynı görünüşte TR / EN
(`ab8e83b`). Yeni `--i18n` harness'i (`8f41d15`) iki dili eşit tutuyor.

**Neden bu yaklaşım:** Sitenin kendi sayfaları her metni iki `<span
lang>` ile çift yazıyor; burada bu işlemezdi çünkü metnin yarısı JS'te
kuruluyor (slider değer kelimeleri, istatistik, aşama metinleri, biyom
adları). Bu yüzden anahtar sözlüğü: statik metin `data-i18n*` kancasıyla,
dinamik metin `T(key)` ile. Dil değişince `apply` kancalıları, main.js'in
dinleyicisi kendi yazdıklarını yeniden yazar — yalnız metin; `SM.generate`
çağrılmaz, harita/kamera/fırça geçmişi yerinde kalır (CDP ile sayıldı: 0).
İstatistik satırı eskiden bir İngilizce dizgeyi regex'le yamıyordu
(`land \d+%`); artık sayılar saklanıp her dilde baştan kuruluyor.
Seçim bilaxten.art'la ortak `bx-lang` anahtarında; ilk boyamadan önce
`<html lang>` doğru, çünkü Türkçe büyük harf (`text-transform: uppercase`)
`i`'yi `İ` yapıyor — grup başlıkları DÜNYA / İKLİM / BİYOMLAR olarak doğru,
İngilizce modda `lang="en"` olduğundan PIPELINE bozulmuyor.

**Dikkat çeken:** Türkçe metinler çoğu yerde daha uzun. İzometrik
ipucu ekranın altında yaw denetimiyle aynı satırda; ilk çeviri 1280 px'te
ona çarptı (ölçüldü: sağ kenar 657, denetim 654). "sürükle: döndür ·
shift+sürükle: kaydır · tekerlek: yakınlaş · Q/E: 90°" ile 647'ye indi.
İngilizce ipucu da daha dar pencerelerde aynı çarpışmayı yaşıyor (eskiden
beri).

**Doğrulama:** `checks.sh` temiz; `--i18n` önce kırmızı (silinmiş TR
anahtarı, kancasız `<p>` ve `title`; eski İngilizce `index.html`'de ~95
bulgu), sonra yeşil. Headless Edge (CDP), `tr` ve `en-US` tarayıcı dili,
koyu + açık tema: konsol hatası yok, panelin dört kaydırma konumu iki dilde
ekran görüntüsüyle bakıldı.

**Açık:** gerçek tıklama ve telefon genişliği denenmedi; birkaç terim
(Hillshade, AO, Seed…) `TODO.md`'de Uğur'un gözüne bırakıldı. Dışa
aktarılan dosyalar bilerek İngilizce.

**Sonraki adım:** gözden geçirme → `scripts/publish-site.sh`.

## 2026-10-05 — Yeniden adlandırma: StilizedMaps artık Cartula

Proje adı StilizedMaps iken Cartula oldu (kod, belgeler, scriptler). Canlı demo https://bilaxten.art/cartula/ adresine taşınıyor. localStorage anahtarları (`sm-*`) değişmedi.

## 2026-10-05 — Derin kod incelemesi: bayat yükseklik, export hizası, ters gölge bulgusu

**Ne yapıldı:** Yeni özellik yok; terrain, mesh, export ve gökyüzü kodu
eleştirel okundu. Dört düzeltme (`5383f75`, `4c2830b`, `f195513` + checks.sh),
üç bulgu karar için `TODO.md`'ye yazıldı.

**En öğretici bulgu — iki doğru:** `generate` yüksekliği özel bir kopyada
(`e`) işliyor ve pass pass `grid.elevation`'a geri yazıyor. 7c (iç su
temizliği) toplu geri yazmadan SONRA çalışıyor ve kendi yazmasını unutmuş.
Kademe `e`'den hesaplandığı için voxel görünüm kusursuzdu; bayat değeri
yalnız `grid.elevation` okuyanlar gördü (üstten hillshade, hover rakımı,
fırçalar, Unity yükseklik haritası). Varsayılan haritada karanın %11'i.
Bunu mevcut hiçbir test yakalayamazdı çünkü hepsi `level`/`biome`/`water`
üzerinden bakıyordu. Yakalayan şey, export için "su düzleminin altında kaç
kara hücresi var" diye saymak oldu — bir tüketicinin gözünden bakınca çıktı.

**Neden bu yaklaşım:** Her düzeltme önce kırmızı görülen bir kontrolle
geldi (P8 beş seed'de kırmızı; hiza kontrolü eski eşlemede 61503@23,23;
CRLF kontrolü sahte blob'la). `snapYaw`'da test hatayı KİLİTLEMİŞTİ
(`snapYaw(316) === 270`) — yeşil test doğru davranışın kanıtı değil.

**İkinci tur (Uğur: "önerdiğin gibi düzelt, geri alınabilir olsun"):**
ışık/gölge yönü uyuşmazlığında gölge yürüyüşü çevrildi (`1cd3abb`) — Lambert,
bulut gölgesi ve arazi gölgesinden ikisi zaten aynı yöndeydi, tek olanı
değiştirmek en küçük görsel değişiklikti. Dikey pan (`8dcc9c6`), iç deniz
dolgusunun biyomu (`e9cf0dc`), ışıksız albedo (`9d69dce`), tek hücre
boyayıcı (`6ee275d`), ölü kod (`1ec1911`). Her biri tek commit; alternatifler
`CURRENT.md`'de. Canvas kodu için tarayıcı yerine Node'da sahte canvas'la
çizim çağrısı günlüğü karşılaştırıldı — refactor'ün piksel değiştirmediğini
tarayıcısız kanıtlamanın yolu bu oldu.

**Değişen dosyalar:** `src/generate.js`, `src/export.js`, `src/main.js`,
`src/render/voxel3d.js`, `src/render/topdown.js`, `tools/headless.js`,
`scripts/checks.sh`, `README.md`, `AGENTS.md`, `CURRENT.md`, `TODO.md`.

**Doğrulama:** `bash scripts/checks.sh` temiz; headless Edge'de iki görünüm
hatasız açıldı, ekran görüntüsüne bakıldı. Etkileşim denenmedi.

**Sonraki adım:** `TODO.md` NOW — gece kararlarına gözle bakıp onayla ya da
ilgili commit'i `git revert` et.

## 2026-09-06 — Eski 2D izometrik yol tamamen kaldırıldı (+ PNG export düzeldi)

**Ne yapıldı:** Uğur "önerdiğin çözümleri yapalım... 4 yönlü 2D image'ı tamamen
kaldıralım, 2D olarak sadece top view kalsın" dedi. Denetim turunda rapor edilen
ölü ağırlık silindi: **-917 satır, +124.**

**Silinenler:**
- `src/render/iso.js` (371 satır) — canvas izometrik renderer.
- `main.js`'te 18 fonksiyon (~460 satır): `rotateGridView`, `makeCloudCells`,
  `makeWeather`, `makeSmokeState`, `makeFlocks`, `prism`, `drawFoam`,
  `stepWeather`, `drawCloudShadows`, `drawClouds`, `smokeParticle`,
  `drawSmokeGroup`, `drawBirds`, `tickIso`, `isoOpts`, `clearRotCache`,
  `scheduleRotBakes`, `revealIso` + `camRot`/`rotCache`/`isoJustBaked`/
  `wantReveal`/`animHash` durumu.
- `?renderer=iso` kaçış kapısı ve dört yönlü (N/E/S/W) bake önbelleği.

**Neden şimdi:** "Faz 5" olarak planlanmış ama hiç yapılmamıştı. Voxel yolu onu
her açıdan ikame etmişti (360° kamera, AO, cast shadow) ve M4 ile kendi bulut/
kuş katmanını da kazandı — yani depo İKİ paralel bulut sistemi taşıyordu.
Üstelik eski yolun hiçbir testi yoktu (`headless.js` `iso.js`'i yüklüyordu ama
`renderIso`'yu hiç çağırmıyordu), yani sessizce bozulabilirdi.

**Korunanlar (dikkatle ayrıldı):** `#riverfx` overlay, `tick`, `tickTop`,
`startRiverAnim` — bunlar ÜSTTEN görünümün nehir parıltısı ve lav nabzı için de
kullanılıyor; yalnız iso dalları çıkarıldı.

**WebGL2 yoksa ne olur:** artık geri düşülecek bir yol yok. `refresh()` görünümü
üstten görünüme alıyor, `Isometric` sekmesini devre dışı bırakıp sebebini
yazıyor. Sessizce üstten görünüm çizmek yanlış olurdu — kullanıcı "Isometric"e
basmışken üstten harita görür ve nedenini bilmez.

**YOL BOYUNCA BULUNAN GERÇEK BUG:** `exportPng` izometrik görünümde
`console.warn('not available yet (Faz 5)')` deyip geri dönüyordu — ve izometrik
VARSAYILAN görünüm olduğu için **"Export PNG" düğmesi çoğu kullanıcı için
sessizce hiçbir şey yapmıyordu.** Voxel renderer'a `capture()` eklendi.
⚠️ `glCanvas.toDataURL()` burada ÇALIŞMAZ: bağlam `preserveDrawingBuffer`
olmadan kuruluyor, dışarıdan piksel istendiğinde tampon çoktan gitmiş oluyor ve
sonuç boş çıkıyor. O bayrağı açmak bir kez basılan düğme için her kareye maliyet
bindirirdi; onun yerine `capture()` AYNI tick içinde render edip `readPixels`
ile okuyor (GL alttan üste okur, satırlar çevriliyor).

**Doğrulama:** `checks.sh` temiz, headless beş mod da temiz. Tarayıcıda:
varsayılan görünüm izometrik (WebGL), `SM.renderIso` yok, üstten görünüm ve
riverfx overlay sağlam, iki yönde geçiş çalışıyor, konsol temiz. PNG export
ÖLÇÜLEREK doğrulandı — izometrik 1873×1319 gerçek içerikli PNG (eskiden hiçbir
şey), üstten 1152×1152 bozulmadan.

## 2026-09-06 — M4 bitti: voxel bulutlar, bulut gölgesi, uçan kuşlar

**Ne yapıldı:** M4'ün kalan iki maddesi (uçan kuşlar, bulut gölgesi) WebGL voxel
görünümüne eklendi. Yeni saf katman `src/render/sky.js` + `--sky` headless modu
(20 kontrol). Bulutlar eski iso yolunda boyanmış sprite'lardı; burada dünya
uzayında gerçek voxel geometri, yani orbit kamera etraflarında dönüyor.

**Tasarım kararları:**

- *Bulut gölgesini ARAZİ shader'ı çiziyor.* Gölge yere düşer, yani onu çizmesi
  gereken arazi. Arazi shader'ının dünya konumu yok ama `vCellUV`'si var
  (haritada 0..1), o yüzden gölge o uzayda ifade ediliyor — ekstra bir gölge
  haritası ya da ikinci geçiş gerekmedi.
- *Tek kaynak kuralı.* Bulut GÖVDESİ gökyüzü programında, GÖLGESİ arazi
  programında çiziliyor. İkisi sürüklenmeyi ayrı hesaplasaydı zamanla
  ayrışırlardı ve sonuç "kendi bulutunun altından kayan gölge" olurdu — tek
  ekran görüntüsünde görünmeyen, yalnız harekette fark edilen bir bug.
  Sürüklenme JS'te bir kez hesaplanıp ikisine de uniform veriliyor.
- *Kuşların JS tarafı yok.* Buluttan farklı olarak kuşun nerede olduğunu sahnede
  başka hiçbir şey bilmek zorunda değil, o yüzden yörünge/yön/kanat çırpma
  tamamen vertex shader'da, vertex'in taşıdığı kuş indeksinden türüyor. Tek
  buffer, tek draw call, JS'te sıfır iş.
- *Kare başına ayırma yok.* `driftClouds` ve `cloudShadowUniforms` çağıranın
  tamponuna yazıyor; sözleşme testle kilitli.

**ÜÇ TUZAK — hepsi "hiçbir şey görünmüyor, hata da yok" ile başladı:**

1. **Cache.** `index.html?cb=N` YALNIZ HTML'i tazeliyor. `src/*.js` ayrı
   URL'ler ve `python -m http.server` cache header'ı göndermediği için Chrome
   onları saklıyor — tarayıcıda eski kod koşuyordu. Bu tuzak bu projede
   2026-09-02'de de saatler yemişti. Kalıcı çözüm bu turda geldi:
   **`scripts/serve.py`**, `Cache-Control: no-store` gönderiyor. Bundan sonra
   yerel test bununla açılmalı, `python -m http.server` ile değil.
2. **Frustum kırpması.** Gökyüzü kuruldu, yüklendi, çizildi — ve ortho frustum
   onu tamamen kırptı, çünkü `fitCamera` yalnız ARAZİYİ çerçeveliyordu. GL
   hatası yok, konsol temiz, sonuç boş gökyüzü: "özellik hiç yazılmamış" gibi
   görünen bir başarısızlık. `SM.Sky.ceiling` artık gökyüzünün ne kadar
   yükseldiğini bilen tek yer ve `fitCamera` onu okuyor.
3. **Sessiz shader link hatası.** `uMode` uniform'u iki shader'da tanımlıydı ama
   `int`in varsayılan hassasiyeti vertex'te `highp`, fragment'te `mediump` —
   GLSL ES'te bu bir LINK HATASI. `makeSkyProgram` null dönüyor, `buildSky`
   sessizce çıkıyor, hiçbir şey olmuyordu. ⚠️ **Depoda bunun tam aynısı daha
   önce yaşanmış:** `fix(render): uTime precision mismatch broke WebGL2 link on
   Firefox`. İki kez ısırdığı için artık shader derleme/link hataları
   `console.warn` YANINDA `window.__glShaderErrors`'a da yazılıyor — sayfa
   yüklenirken olan bir hata, konsol okuyucusu bağlanana kadar kaybolur.

**Doğrulama:** `scripts/checks.sh` temiz (12 JS), `node tools/headless.js`
normal/`--sky`/`--river`/`--mesh` dördü de temiz. Tarayıcıda gözle ve ölçerek:
bulutlar sürükleniyor, kuşlar kanat çırparak dönüyor, ve bulut anahtarı
kapatılıp açılarak gölgenin gerçekten araziyi karartığı iki ekran görüntüsü
karşılaştırılarak doğrulandı.

## 2026-09-06 — M3 kapandı: nehir fırçası + belge sürüklenmesinin düzeltilmesi

**Ne oldu:** Uğur "M3 fırçayı falan da yapmış olmamız lazım, kontrol eder misin"
dedi. Kontrol ettim: **fırça editleme zaten yapılmıştı** — commit `aa3b1cf`
"Codex: M3 fırça editleme" (2026-09-02). Ama HİÇBİR belge bunu kaydetmemişti:
`README.md` hâlâ `- [ ] M3`, `CURRENT.md` "başlamadı", `TODO.md` NOW M3'ü hâlâ
üç adaydan biri olarak listeliyor, bu dosyada kayıt yok, vault tarafındaki
thread + otomatik hafıza notu da "sırada M3" diyordu. Kod dört gün önce
ilerlemiş, anlatı yerinde saymış.

**Eksik olan tek parça nehir aracıydı.** README'nin M3 tanımında "nehir çiz"
geçiyordu ama kodda `tool === 'river'` diye bir dal yoktu; diğer altı araç
(Raise/Lower/Smooth/Water/Land/Paint biome) + Undo/Redo/Reset tamdı. Uğur
"nehir aracını yaz, M3'ü kapat" dedi.

**Nehir aracı — tasarım kararları:**

- *Nehir bir KANAL, havuz değil.* Diğer fırçaların ağırlıklı diski bilerek
  kullanılmıyor: fırça boyu 12'de disk 25 hücre genişliğinde bir su kütlesi
  boyardı, ki o zaten `water` aracının işi. Kanal genişliği fırça boyundan
  türüyor ama dar kalıyor — 1, 3, 5, 7 hücre.
- *Yatak banklarının ALTINA oyuluyor.* Düz mavi bir şerit boya gibi okunuyor;
  kesilmiş bir kanal voxel görünümünde nehir gibi okunuyor. Derinliği `strength`
  belirliyor (hafif dokunuş dere, ağır dokunuş boğaz).
- *Bank referansı kanalın DIŞINDAKİ halka.* Hücrenin kendisi alınsaydı tekrar
  eden fırça darbeleri kendi kendini aşağı yürütüp dipsiz bir hendek kazardı.
  `--river` testi tam olarak bunu ölçüyor: 8 darbeden sonra toplam sürüklenme
  2.1e-8 (yatak derinliği 0.040) — yani ilk darbeden sonra sabitleniyor.
- *Nehir deniz seviyesinin ÜSTÜNDE tatlı su.* Yatak `seaThresh`in hemen üstüne
  kırpılıyor; altına inseydi `deriveTile` hücreyi kıyı olarak yeniden
  sınıflandırıp nehir kimliğini sessizce silerdi.
- *Lava söndürülüyor* — üretecin kendi kuralının aynısı (`generate.js` adım 7a).

**Yol boyunca bulunan gerçek bug:** geri alma kaydı (`makeEditRecord`) `lava`
alanını TUTMUYORDU. Nehir aracı lavayı söndürdüğü için undo lavayı geri
getiremezdi — geri alınan volkan yüzeyi altında parlamaya devam ederdi. Kayda
`lava` eklendi.

**Testin yakaladığı ikinci şey:** ilk genişlik eğrisi `round(radius/3) - 1` idi
ve fırça boyu 1-4'ün hepsini tek hücreye eşleyip doğrudan beşe atlıyordu — yani
slider'ın ilk üçte biri ölü yol, 3 hücrelik genişlik ise ulaşılamaz. `--river`
genişlik eğrisini bastığı için görüldü; `floor((radius - 1) / 3)` ile dördü de
erişilebilir oldu.

**Doğrulama:** `node tools/headless.js --river` (9 kontrol: darlık, monotonluk,
tüm genişliklerin erişilebilirliği, yatağın banklardan aşağıda olması, deniz
seviyesinin altına inmemesi, tekrarlı darbelerde yakınsama, determinism, harita
kenarı), `--mesh` ve normal mod değişmedi, `scripts/checks.sh` temiz.
**Tarayıcıda gözle ve ölçerek doğrulandı** (localhost + cache-buster): araç
listede, 21/21 örnek nokta nehir rengine döndü (#3f7fa6), undo tam geri aldı ve
redo birebir geri getirdi, konsol temiz, WebGL2 bağlamı hatasız, çizilen kanal
voxel görünümünde oyulmuş bir su yolu olarak okunuyor.

**Not:** `CURRENT.md` 2026-09-02'de donmuştu ve 2026-09-03'teki beş commit
(WebGL2 voxel orbit/auto-rotate/Firefox düzeltmesi) hiçbir yerde kayıtlı
değildi. Bu tur onları da kayda geçirdi.

## 2026-09-02 — Konik yanardağ + anim layer fix + gün-döngüsü slider'ı

**Yanardağ:** silindir → konik. `coneDrop = vRad·(landSpan/levels)·0.9`
(~1 kademe/tile), `pow(vt, 0.8)` profil, tepeden tabana iniyor, araziye
karışıyor. Krater rim'in 1.6 kademe altında (içine göllenmiş).

**Animasyon layer sıkıntısı:** per-tile `clearRect` overlap yüzünden kümeli
tile'lar (krater lav gölü) birbirini kırpıyordu. Artık tüm animasyonlu
tile'ları kapsayan tek bounding-box temizlik + painter's order (gx+gy)
yeniden çizim. Ortak `prism()` helper'ı. Lav voxel'leri hareketsiz, sadece
glow nabzı.

**Gün-döngüsü slider'ı (`#sun`, 0-24, vars. 14:00):**
- `sunModel(hour)` → iso gölge yönü/uzunluğu/gücü + ekran rengi wash + canvas
  filtresi. Gündüz 6:00-18:00.
- İso gölge ön-geçişi artık `sun.dx/dy/rise/strength` alıyor: alçak güneş =
  uzun koyu gölge, güneş doğu→batı süpürüyor. `change`'de yeniden bake.
- `#daynight` div (`mix-blend-mode: multiply`) + `#map` CSS filtresi:
  gece koyu mavi, şafak/gün batımı sıcak turuncu, öğlen nötr. `input`'ta
  canlı (yeniden render yok), `change`'de gölge yeniden bake.
- Volkan lav'ı gece dramatik parlıyor.

**Doğrulama:** headless determinism OK, 0 kule; tarayıcıda gece/şafak/öğlen
denendi, overlay+filter+shadow doğru, konsol temiz. Volkan konisi seed 12'de
net (rim→taban 8→0). Animasyon hareketi otomasyonda gözlenemez.

## 2026-09-02 — UI makeover (rafine cila) + PNG export + paylaşım linki

Uğur: "ui makeover yapacağız bir de güzel gözüksün" + border/lav/krater
düzeltmeleri (ayrı commit).

**UI:** `index.html` + `css/style.css` baştan yazıldı. Aynı layout, rafine:
- Tasarım token'ları (`:root` — bg/panel/line/accent...). Vurgu: sıcak amber
  `#eba14a` (lav/güneş çağrışımı, koyu zeminde güçlü).
- Header (amber mark + tagline), segment kontrol (Top-down / Isometric).
- Parametre grupları `<details>` — katlanabilir, chevron'lu.
- Özel range slider: accent dolgu (`--fill` %'si JS'te `input` olayında
  boyanıyor, webkit gradient track), büyüyen thumb, focus ring.
- Legend 2 sütun grid. Alt bar: stats + **Export PNG** + **Copy link**.
- `#stage` radial gradient zemin, hover kartı blur'lu.

**Export PNG:** `map` (+ iso'da `riverfx`) geçici canvas'a kompoze → `toDataURL`
→ `<a download>`. **Copy link:** tüm parametreler querystring'e, `navigator.
clipboard`; sayfa açılışında `location.search` okunup input'lara uygulanıyor
(seed'li harita paylaşımı).

**Not:** `python -m http.server` cache header'ı göndermiyor, Chrome agresif
cache'liyor — bu oturumdaki "stale screenshot" sorununun kaynağı buydu.
Tarayıcı testi cache-buster query (`?cb=N`) ile yapıldı.

**Doğrulama:** yeni UI render'landı, segment aktif durumu amber, slider
dolguları doğru, export toDataURL 304KB PNG üretiyor, share URL 167 char,
konsol hatasız.

## 2026-09-02 — Voxel border, daha büyük yanardağlar, voxel lav akışı

Uğur: "lav akışını da border'ı da voxel yapman lazım. yanardağları da daha
yüksek ya da daha geniş yapabilirsin gerçek dünyadaki gibi."

- **Voxel border:** iso'daki plinth+rim stroke kaldırıldı. Ana döngü artık
  `-MB..W+MB` (MB=1); harita dışındaki halka için koyu kömür (`[32,36,44]`,
  üst `×1.4` okunur) voxel prizmalar çiziliyor — üstü kenar reliefine yaslanıyor
  (min level 2), yan yüzler zemine kadar. Painter's order'da terrain ile
  çizildiği için doğru occlude oluyor. Canvas + origin 1 tile pay büyütüldü.
- **Yanardağlar gerçek-dünya ölçeği:** vRad 5-8 → 8-15 (geniş taban), rim
  lift 0.055 → 0.13 (yüksek), koni profili `rimE - (t²)*coneDrop` (dik üst
  koni), krater 0.055 çökük. Lav akışı 3-8 → 6-14 tile + yana 1 tile genişleme
  (akıntı gibi okusun). Kule yok, determinism OK.
- **Voxel lav animasyonu:** LAMP 3→6, LSPEED 1.4→2.4, ayrı `lslab` (lh·0.5),
  crest lavadan beyaz-sıcağa lerp, kabuk yan yüzlerinde hafif iç glow.

**Doğrulama:** headless determinism OK, 0 kule, her tohumda lav+volkanik
(volkanik footprint 135→337). Tarayıcı canvas örneklemesi: iso render tam,
border ~69k kömür piksel (ön kenarlarda zemin-plinth), lav ~2k turuncu
piksel. Otomasyon screenshot'ları büyük canvas + animasyonda bazen stale
geliyor — canvas `getImageData` ile doğrulandı.

**Sonraki:** M3 fırça editleme; border kontrastı isteğe göre ayarlanabilir.

## 2026-09-01 — Coğrafi kurallar tur 2 (Codex delegasyonu), lav, iso gölge + border, takımada konsolidasyonu

**Ne yapıldı:** Uğur: sıradaki coğrafi kurallar turu + "kodlama işini codexe
devret" + iso'da border görünmüyor + nehir animasyonunda occlusion (kameraya
görünmeyeni render etme) + lav + iso gölge + "su artınca minik minik adalar
oluşmasın, önce ada sayısı azalsın sonra tek adaya insin" + shell'leri arka
planda aç.

**Codex'e devredildi** (`.claude/scripts/codex-delegate.sh --write`,
`generate.js` + `biome.js`), sonra satır satır doğrulandı ve elle ayarlandı:
- **Takımada konsolidasyonu (6d):** deniz yükseldikçe minimum ada boyutu
  eşiği boyut dağılımı içinde yukarı süpürüyor — önce serpinti, sonra küçük
  adalar, sınıra gelince yalnız ana kara kalıyor. Codex'in sabit sayı
  tavanı (`maxIslands`) 0.45→0.55 arası kara %64→%19 uçurumu yaratmıştı;
  yumuşak boyut eşiğine çevrildi (`minKeep`, `consT*consT` eğrisi). En büyük
  gövde daima korunuyor. Sweep: 9→8→5→2→3→1→1 ada.
- **7e invaryant:** hidrolojiden sonra nehir/fiyort'un kestiği parçalar
  eşiğin altındaysa batırılıyor (sabit sayı değil). Batan parçalar
  komşusuna göre deep/shallow.
- **Kıta sahanlığı (hidroloji) düzeltmesi:** BFS artık harita kenarını
  "kıyı" saymıyor → dikdörtgen shelf hattı gitti, derin su kenara ulaşıyor.
- **Plato (3c), karasallık (5c, BFS ile okyanus uzaklığı → iç bölge sıcaklık
  daha uçlu + nem -0.15), fiyort (6e), kıyı oku+lagün (6f), delta/haliç
  (7b, tohum bitine göre biri), riparian yeşillik (7d, nehir/göl 2 kare
  tamponu +nem yeniden sınıflandırma).**
- **Lav:** `biome.js`'e `lava` + `volcanic` eklendi (son sıraya, index'ler
  sabit). Volkanik koniler (0-2 tohumlu, sıradağ+sıcak+kurak; her haritada
  ≥1'e ayarlandı), krater lav gölü, kısa lav akışı. `grid.lava` Uint8Array
  `generate()` içinde.

**Nano (render/animasyon):**
- **İso border:** floor-düzlemi görünmez çizgi yerine — iki ön kenarda koyu
  plinth (zemine kadar) + dört kenarda reliefe yaslanan kalın koyu rim.
- **İso gölge:** yönlü gölge ön-geçişi (güneş ekran sol-üst); occluded
  kareler üst yüz ~%34, yan ~%18 kararıyor.
- **Nehir occlusion culling:** `iso.js`'te geometrik test —
  `L_ön >= L + (TH2/LH)(2k-1)` ise üst yüz gizli → animasyon listesinden
  düşür. Lav için de.
- **Lav animasyonu:** `#riverfx` overlay'de — koyu kabuk yan yüzleri, glow
  ile parlak sarıya lerp'lenen erimiş üst, yavaş şişme.
- **Üstten görünüm nehir animasyonu:** `#riverfx` artık top view'da da
  görünür; nehir karelerinde akıntı yönünde kayan parıltı, lav turuncu nabız.

**Hangi dosyalar:** `src/generate.js` (+~430 satır), `src/biome.js`,
`src/render/iso.js`, `src/render/topdown.js`, `src/main.js`, `css/style.css`,
`tools/headless.js` (yeni test harness).

**Doğrulama:** headless — determinism OK, 0 kule, ada sayısı monoton
düşüyor (1'e), her tohumda lav+volkanik, gen 60-185ms (192²), 325ms (320²).
Tarayıcıda — top+iso temiz, konsol hatasız, dikdörtgen shelf gitti, derin su
kenara ulaşıyor, border+plinth görünür, gölge var, volkan+lav akışı görünür.
Batan adalardan kalan sığ shoal lekeleri var (deniz bankları — kabul
edilebilir). Animasyon otomasyonda gözlenemedi (bg-tab rAF throttle).

**Açık işler / sonraki:** shoal lekelerini tam derine çevirmek; 320²+ perf
(~325ms); kıstak/takımada belirgin özellik değil (emergent). Fırça editleme
(M3) hâlâ bekliyor.

**Sonraki tur seçenekleri:** M3 fırça editleme, veya lav akışı animasyonunu
nehir gibi voxel-küp yapmak, veya shoal temizliği + perf.

## 2026-09-01 — Voxel nehir animasyonu, daha az su, vadiler, göl taşması, İngilizce UI

**Ne yapıldı:** Uğur: su kuralı daha strict (daha az su), nehir animasyonu
"küpler halinde, yüksekten alçağa akan", UI İngilizce, "deniz seviyesi" →
deniz-kara oranı, harita kenarına siyah border, + sıradaki kurallar.

- **Daha az su:** seaLevel 0.42→0.38. İç su artık YALNIZCA nehir-bağlantılı
  gövde olarak yaşıyor (BIG_LAKE eşiği kaldırıldı) — açıklanamayan iç deniz
  yok. Bir nehir kapalı havzaya akarsa orada **göl** oluşuyor (pit→lake
  flood, ≤60 kare). Sonuç: water% ~38→~30, göller 100-450 kare (gerçek
  nehir-beslemeli göller).
- **Voxel nehir animasyonu:** nehir kareleri artık küçük su küpleri.
  `#riverfx` overlay canvas'ında (terrain canvas'ına dokunulmuyor) her kare
  bir prizma (üst + 2 yan yüz); yükseklik `sin(t*SPEED - elev*K)` ile
  salınıyor — dalga tepesi düşük rakıma doğru ilerliyor = yüksekten alçağa
  akış. Küp tabanı sabit, üstü inip kalkıyor. 30fps, dirty-rect.
- **Vadi oyma:** nehir izleri `e`'ye V-vadi kazıyor (yarıçap 2, nehir ve
  yakın kıyı aşağı çekiliyor) — su yüzeyde durmuyor, vadiden akıyor.
- **Göl taşması:** her göl en alçak kıyı noktasından bir çıkış nehriyle
  boşalıyor (steepest descent).
- **UI İngilizce:** tüm etiketler, biyom adları, hover ("+818 m · moist
  0.53 · 22°C"), stats ("land 62%"). `lang="en"`.
- **Deniz-kara oranı:** "Deniz seviyesi" → "Sea ↔ land — X% land".
- **Siyah border:** iso'da haritanın floor düzlemi hattı tek koyu çizgiyle
  çiziliyor.

**Hangi dosyalar:** `src/generate.js`, `src/main.js`, `src/render/iso.js`,
`src/biome.js`, `index.html`, `css/style.css`.

**Doğrulama:** headless — determinism 0, 0 kule, water% 29-36, göller
100-450, gen ~55-106ms. Tarayıcıda — 192² temiz harita, İngilizce UI,
vadilerde nehirler, siyah border, pan 300 güncelleme 0.6ms (overlay
izolasyonu çalışıyor), konsol temiz. Animasyon otomasyonda bg-tab rAF
throttle yüzünden gözlenemedi (kod yolu sağlam, tick atıyor).

**Sonraki tur:** deltalar, fiyortlar, kıyı okları/lagünler, platolar,
kıstaklar, takımadalar, haliçler, karasallık, riparian yeşillik, üstten
görünüm nehir animasyonu.


## 2026-09-01 — Perf + iç su temizliği + dendritik nehirler

**Ne yapıldı:** Uğur "kasmaya başladı kontrol edemiyorum" + "deniz/ada
çevresi değilse çok su olmasın, iç kısımda nehir/göl olsun ama 500 su
birikintisi olmasın" dedi + "sonraki tura başla".

- **Perf:** 256²→192² varsayılan (slider max 448). **Nehir animasyonu ayrı
  bir overlay canvas'a** (`#riverfx`) taşındı — büyük terrain canvas'ı bake
  sonrası hiç dokunulmuyor, compositor onu statik texture olarak tutuyor,
  pan/zoom bedava. Overlay'de her frame sadece nehir karelerinin küçük
  dirty-rect'leri temizlenip yeniden çiziliyor. 30fps sınırı. >600 nehir
  ya da >16MP haritada kapalı.
- **İç su temizliği (7b pass):** hydrology sonrası — okyanus olmayan, nehir
  olmayan her su gövdesi flood-fill'le ölçülüyor; `< MIN_LAKE (10)` VE
  nehre değmiyorsa karaya dolduruluyor (elevation deniz üstüne, biome
  classify'dan). Sonuç: <10 kareli iç su gövdesi ~onlarca → ~1 (o da
  nehir bağlantılı). Land artık lekesiz.
- **Dendritik nehirler:** iz sürme artık merge'de KIRILMIYOR — kaynaklar
  denize kadar iniyor (steepest descent zaten birleşen kanalı takip eder),
  her tile'da `accum` (kaç kaynak geçti) sayılıyor. Genişletme accum'a göre:
  headwater 1 kare, `accum>=3` → 2, `accum>=6` → 3 kare geniş. Nehir mansaba
  doğru büyüyor.

**Hangi dosyalar:** `src/generate.js`, `src/main.js`, `index.html`,
`css/style.css`.

**Doğrulama:** headless — determinism 0, 0 kule, <10 kareli iç su ~1,
192² gen ~80ms (256²'de ~200ms'di), 448² ~360ms. Tarayıcıda — 192² temiz
harita, dendritik nehirler (mansapta geniş trunk), overlay canvas kurulu +
transform eşleşiyor, konsol temiz.

**Sonraki tur (devam):** deltalar, V/U vadiler, göl taşması (outlet nehir),
fiyortlar, kıyı okları/lagünler, platolar, kıstaklar, takımadalar, haliçler,
voxel-yükseklik nehir dalgası, üstten görünüm nehir animasyonu.


## 2026-09-01 — Kalın nehirler, büyük harita, zirve baskınlığı

**Ne yapıldı:** Uğur "nehirleri daha kalın, harita fantasy map gibi büyük,
yüksek dağ varsa yanında dağ olma olasılığı düşük" dedi.

- **Kalın nehirler:** iz sürme sonrası genişletme pass'i — nehir karesinin
  kıyı komşuları da nehir olur (elevation'ı fazla yüksek değilse), `flowStep
  > 26` olan aşağı-akış kareleri 2 kare genişler. River tile ~30 → ~130,
  görünür şekilde kalın.
- **Büyük varsayılan harita:** 160²→256², slider adımı 16→32. Gen ~130-260ms,
  iso canvas budget otomatik tile küçültüyor. Epic fantasy dünya ölçeği.
- **Zirve baskınlığı (prominence):** repair sonrası pass — elevation yerel
  maksimumları bulunur, en yükseğinden başlanır, her biri `DOM_R=13` yarıçapta
  bir "baskınlık kuyusu" açar: `cap = pkElev - 0.045 - dist*0.0135`, üstündeki
  rakip yükseltiler `e*0.18 + cap*0.82` ile aşağı çekilir → omuz/boyun olurlar.
  `claimed` dizisiyle bir zirvenin kapsadığı alandaki başka zirveler atlanır.
  Sonuç: kümelenmiş benzer-yükseklik zirve %20 → %8, dağlar yalnız duruyor.
- Deniz seviyesi (referans örneklemesi) sample loop'undan önceye alındı,
  prominence pass'i `seaThresh`'i biliyor.

**Hangi dosyalar:** `src/generate.js`, `index.html`.

**Doğrulama:** headless — determinism 0, 0 kule, kümelenmiş zirve %6-11,
256² gen ~130ms, 512² ~350ms, river tile ~130. Tarayıcıda — 256² fantasy
harita ölçeği, kalın nehirler, sıra dağlar dominant zirvelerle, konsol temiz.

**Not:** prominence bazı yüksek terrain'i alçalttığı için snow %1.5-2'ye
düştü — dominant zirveler hâlâ karlı, ama genel kar azaldı. Gerekirse
snowLine/RIDGE_H ile geri çekilir.

**Sonraki tur:** dendritik nehir kolları, deltalar, vadiler, fiyortlar,
platolar, voxel-yükseklik nehir dalgası.


## 2026-09-01 — Coğrafi kurallar tur 1: sıra dağlar, kıta sahanlığı, yağmur gölgesi, gerçek rakım, nehir akışı

**Ne yapıldı:** Uğur "hepsini yapalım" (menüdeki coğrafi kurallar) + "rakımı
gerçek metrelerle göster" + "nehirleri denize dökülene kadar animasyonlu" dedi.
Aşamalı — bu tur yapısal + iklim kuralları, sonraki tur dendritik nehirler/
deltalar/fiyortlar/platolar.

- **Dağlar SIRA halinde** (`makeRidgeField`): 2-4 gezinen polyline (fay hattı),
  bir mesafe alanına (128²) pişirilir, `heightAt` içinde `pow(rb,1.5) * RIDGE_H`
  ile arazi yükseltilir. Blob değil, zincir dağlar. Referans örneklemesi de
  ridge'leri hesaba katıyor.
- **Kıta sahanlığı:** su kıyıdan ~9 kare boyunca deniz düzleminde (level 0,
  shelf), sonra shelf kırığında derinleşir. Derin deniz artık istisna —
  shelf denizleri sığ okur (Uğur'un isteği), açık okyanus derin.
- **Yağmur gölgesi + orografik:** tohumlanmış hâkim rüzgâr yönü; her kara
  karesi 20 adım rüzgâr yukarı taranır, dağ varsa nem düşer (lee tarafı kurak),
  windward yamaç nem alır. Ayrı bir climate pass'i (moisture → rain shadow →
  temp + classify).
- **Ağaç/kar sınırı** (`classify`): snowLine sıcaklığa göre — kutuplara doğru
  alçalır, ekvatora doğru yükselir. treeLine = snowLine - 0.15; arası
  tundra/çıplak.
- **Gerçek rakım:** `SM.elevationMeters` — deniz seviyesi 0, kara +4200m'ye,
  okyanus tabanı -5500m'ye. Hover: "Ova · +818 m · nem 0.53 · sıc 22°".
  Sıcaklık da °C.
- **Nehir akış animasyonu** (izo): nehir kareleri statik bake'e çizilir, ayrıca
  main.js bir rAF döngüsünde her kareyi küçük bob (±2px, sinüs) + akıntı yönünde
  ilerleyen shimmer ile yeniden çizer. Smear'ı önlemek için önce snapshot'tan
  restore. `grid.flow` (yön 1-8) + `grid.flowStep` (kaynaktan adım) üretimde
  saklanıyor. Büyük haritalarda (>12MP) kapalı.
- **Daha az yumuşatma:** 3x3 blur kaldırıldı, SPIKE 0.05.
- **Yeniden dengeleme:** RIDGE_H, yağmur gölgesi, sıcaklık, cliff eşikleri
  ayarlandı — dünya artık ılıman/çeşitli (forest/grassland/plains baskın,
  snow %3-6, cliff seyrek).

**Hangi dosyalar değişti:** `src/generate.js` (ridge alanı, climate yeniden
yapılandırma, shelf, flow), `src/biome.js` (snowLine/treeLine), `src/render/
iso.js` (nehir listesi), `src/main.js` (rAF nehir animasyonu, metre hover).

**Doğrulama:** `node --check` temiz, headless — determinism 0, 0 kule,
metre değerleri makul, 512² gen 362ms. Tarayıcıda — sıra dağlar + yağmur
gölgesi kuru bölgeler + çoğunlukla sığ deniz + nehirler görünüyor, hover
metre/°C, iso nehir animasyonu tick atıyor (otomasyonda bg-tab rAF throttle
yüzünden tam görülemedi ama kod yolu sağlam), konsol temiz.

**Açık işler (sonraki tur):** dendritik nehir ağı (kollar birleşir, aşağı
genişler), deltalar, V/U vadiler, fiyortlar, kıyı okları/lagünler, platolar,
kıstaklar, takımadalar, göl taşması, haliçler, karasallık, riparian yeşillik,
üstten görünümde de nehir animasyonu, voxel-yükseklik nehir dalgası (şu an
sadece küçük bob + shimmer).

**Sonraki adım:** Uğur'un geri bildirimi.


## 2026-09-01 — Kurallı üretim: dünya-uzayı, erozyon, hidroloji, nehirler

**Ne yapıldı:** Uğur "sistem tamamen rastgele olmasın, gerçek coğrafya gibi
kurallı olsun; tek karelik kuleler oluşmasın; boyut büyüyünce özellikler
sabit kalıp harita kenardan büyüsün; su bu kadar düzensiz alçalamaz; 2D
görüntüleme bozuk; boyut max 512" dedi. Üretim hattı adlandırılmış pass'lere
bölünüp kurallı hale getirildi.

- **Dünya-uzayı noise + domain warp.** `nx = x/w` normalize yerine
  `wx = (x - merkez) / REF` — özellikler sabit boyutta, harita büyüyünce
  kenardan yeni dünya açılır (ada aynı kalır, okyanus büyür — data'da
  doğrulandı: island 128²→18%, 192²→8%, 288²→4% kara, ada ~sabit tile).
  Domain warp (düşük frekans, `warp` slider'ı) organik kıyılar için.
- **Sabit kontrast eğrisi** (per-map min/max normalize yok) — boyuttan
  bağımsız, fBm'in orta yığılmasını açar, net kıtalar.
- **Deniz seviyesi: sabit referanstan mutlak eşik.** REF bölge (falloff'suz)
  örneklenip percentile → eşik. Harita büyüse de kıyı sabit (`seaThresh`
  0.443, tüm boyutlarda aynı).
- **repair pass'i (erozyon):** SPIKE=0.028 (bir kademenin altında) ile
  tek-tile diken/çukur klamp + 3x3 hafif yumuşatma. Ayrıca voxelize sonrası
  5 pass "hiçbir kare komşusundan >1 kademe yüksek olamaz". **Sonuç: 0 kule**
  (rug 0.35–1.0, tüm seed'lerde).
- **de-speckle:** 1-tile adalar batar, 1-tile göletler dolar (koşullu).
- **Su hidrolojisi.** `grid.level` işaretli; su seviyesi kıyıda 0 (deniz
  düzlemi), kıyıdan uzaklık BFS'iyle dışa doğru kademeli alçalır
  (komşu su kareleri arası max fark = 1, düzgün). Kıyı land (level 1)
  artık sadece 1 kademe yukarıda → kule değil.
- **Nehirler.** Yerel yükseklik maksimumlarından steepest-descent ile
  denize/göle/kenara iz sürülür, vadilerden akar, `river` biyomu. Sayı
  harita alanı × `rivers` slider'ıyla ölçekli.
- **Göller.** Kenardan ocean flood-fill; ulaşılamayan su = `lake` biyomu.
- **2D bug:** `renderTopDown` canvas boyutu döndürmüyordu → `fitCam` NaN →
  transform uygulanmıyordu. Düzeltildi.
- **Boyut:** slider 128–512 (varsayılan 160). Büyük haritalarda top-down
  tile ve iso canvas budget otomatik küçülür.

**Hangi dosyalar değişti:** `src/generate.js` (yeniden yazıldı),
`src/biome.js` (+river/+lake), `src/grid.js`, `src/render/topdown.js`,
`src/render/iso.js`, `src/main.js`, `index.html`.

**Doğrulama:** `node --check` temiz. Headless — determinism 0, 0 kule,
su fark 1, ada büyüme davranışı, 512² gen ~340ms. Tarayıcıda (Chrome):
2D fit doğru, iso'da su baseni + nehirler + kademeli derinlik + kuleler
yok, ada modu 240²'de küçük ada + büyük okyanus (ekran görüntüsü), konsol
temiz, iso regen ~125ms, pan/zoom 0ms (CSS transform).

**Açık işler:** yakın tepe birleştirme (2 zirveyi tek dağa), nehir
genişliği/delta, iso hover, kamera döndürme, M3 fırça.

**Sonraki adım:** Uğur'un geri bildirimi.


## 2026-09-01 — M2 cila turu: perf, çeşitlilik, su derinliği, kamera

**Ne yapıldı:** Uğur'un M2 geri bildirimi — iso "kasıyor", 2D'ye de pan/zoom
gelsin, harita daha çeşitli olsun, iso yükseltileri çok düz, su da dağlar
gibi zeminin altına insin, harita boyutu değişsin (piksel sabit).

- **Perf: kamera artık CSS transform.** Eskiden her mousemove'da ~19MP canvas
  drawImage ile blit ediliyordu → jank. Şimdi harita bir kez tam çözünürlükte
  `#map`'e çiziliyor, pan/zoom = `map.style.transform = translate() scale()`
  (compositor, sıfır redraw — 200 yazım 0.2ms). Redraw sadece regenerate/
  view-switch/exag-değişimi. **Chrome GPU-accel eşiği** (~9-10MP) keşfedildi;
  iso canvas budget'ı `MAX_CANVAS_PX = 8e6` ile sınırlı, aşarsa tile küçülüyor.
  160² regen ~90-115ms.
- **2D + iso ortak kamera.** İkisi de sürükle-pan + tekerlek-zoom. Hover
  ekran→tile dönüşümü kamera transform'undan geçiyor (top view).
- **Su derinliği (Uğur'un isteği).** `grid.level` artık Int8 (işaretli):
  kara +1..+11, su -1..-3 (kıyıdan uzaklaştıkça derin). Iso'da su zeminin
  ALTINA oturuyor, kıyıda uçurum + deniz basen görünümü.
- **Yükseklik abartısı.** `levels` 8→10, `level = round(pow(landFrac,0.85)*
  levels)+1` (orta yükseklikler yayılıyor), iso `levelHeight = 13 * exag`.
  Yeni "Yükseklik abartısı (izo)" slider'ı (0.6–3, vars. 1.6).
- **Harita çeşitliliği.** 11→18 biyom (yalıyar/bataklık/çayır/çalılık/tayga/
  kızıl kaya/çıplak eklendi), classify yeniden yazıldı (daha çok dal).
  Eğim tabanlı yalıyar (dik kıyı = kaya). Sıcaklık modeline noise wobble +
  taban ısı (kutuplar daha az donuk). `SM.biomeShade` — nem/yükseklik/hash
  ile biyom-içi renk varyasyonu (büyük bölgeler düz görünmüyor).
- **Boyut.** Varsayılan 96²→160², slider 128–176 (piksel sabit, harita
  büyüyor). Iso `#map` tam iso extent'inde tek büyük canvas, offscreen yok.

**Hangi dosyalar değişti:** `src/biome.js`, `src/generate.js`, `src/grid.js`,
`src/render/topdown.js`, `src/render/iso.js`, `src/main.js`, `index.html`,
`css/style.css`.

**Doğrulama:** `node --check` temiz, headless — determinism 0, 18 biyom,
level -3..11, aralık dışı yok. Tarayıcıda (Chrome, localhost): perf ölçüldü
(pan 0ms, regen ~90ms, GPU eşiği doğrulandı), su basen görünümü + abartılı
yükseklikler + çeşitli biyomlar ekran görüntüsüyle onaylandı, konsol temiz
(eski koddan bir onHover NaN bug'ı çıktı, `!(a && b)` bounds check + `!b`
guard ile düzeltildi).

**Açık işler:** iso'da hover, kamera döndürme, M3 fırça, M4 animasyon.

**Sonraki adım:** Uğur'un geri bildirimi — sonra M3 (fırça) ya da iso cilası.


## 2026-09-01 — M2: izometrik voxel projeksiyon

**Ne yapıldı:** İzometrik görünüm eklendi. Panel'e Üstten/İzometrik toggle,
sürükle-pan, tekerlek-zoom (imlece doğru yakınlaşma). Grid aynı kaldı —
iso yalnızca ikinci bir projeksiyon.

**Hangi dosyalar değişti:** `src/render/iso.js` (yeni), `index.html`
(toggle + iso.js + isohint), `src/main.js` (view mode state, iso pan/zoom,
render routing), `css/style.css` (viewtoggle, `body.iso` modu).

**Neden bu yaklaşım:** Her tile 3 dörtgen (üst diamond 2:1 iso + W ve E yan
yüzleri, `1-|noise|` değil sabit gölge çarpanı 0.70/0.52 — low-poly ışık
hissi). Painter's algorithm = satır-major (y sonra x) döngü, standart iso
oryantasyonda arkadan öne doğru sıralıyor. Yükseklik = `grid.level + 1`
(su 0'da, kara en az 1 kademe yukarıda → her kıyıda 1 basamak uçurum).
**Statik bake:** tüm arazi bir kez offscreen `<canvas>`'a çizilir (~96²'de
tek seferlik maliyet), ekran `drawImage` ile pan/scale uygulayıp blit eder
— pan/zoom sırasında yeniden çizim yok, sadece blit. `regenerate` bake'i
geçersiz kılıyor (`iso = null`). Zoom drawImage ölçeğiyle (yeniden bake
yok); 64px tile'da bake, çoğunlukla downscale → keskin kalıyor.

**Doğrulama:** `node --check` tüm dosyalarda temiz. Tarayıcıda (Chrome,
localhost): top→iso toggle, iso render (voxel diorama, kar tepeleri, yan
yüz gölgeleri), sürükle-pan, tekerlek-zoom, top'a dönüş, iso'dayken random
seed → yeni harita re-bake — hepsi çalışıyor, konsol hatasız. Ekran
görüntüleriyle doğrulandı.

**Açık işler:** iso'da hover ile biyom okuma (ters projeksiyon gerekir),
kamera döndürme (4 yön), M3 fırça düzenleme, M4 animasyon.

**Sonraki adım:** M3 (fırça düzenleme) ya da iso görünümüne cila
(hover/döndürme) — Uğur seçecek.


## 2026-09-01 — M1 playtest geri bildirimi: kategorili panel + hover + dağlılık/deniz düzeltmesi

**Ne yapıldı:** Uğur M1'i denedi, üç istek geldi: paneli kategorilere ayır +
daha fazla parametre ekle, mouse map üzerindeyken biyomu göster, dağlılık ve
deniz seviyesi birbirinden ayırt edilemiyor — düzelt. Panel dört gruba ayrıldı
(Dünya/Yükseklik/İklim/Görünüm), beş yeni slider eklendi (Detay/octaves,
Sıcaklık eğilimi, Nem eğilimi — Dağlılık ve Deniz seviyesi zaten vardı ama
davranışları değişti). Canvas üzerinde mouse hover ile biyom/koordinat/
yükseklik/nem/sıcaklık okuma eklendi.

**Hangi dosyalar değişti:** `src/generate.js` (üretim hattı yeniden yazıldı),
`src/biome.js` (classify imzası landFrac'e geçti), `src/noise.js` (+`fbmRidged`),
`index.html`, `css/style.css`, `src/main.js`.

**Neden bu yaklaşım — asıl düzeltme iki gerçek bug'dı:**
1. **Deniz seviyesi artık yüzde tabanlı (percentile threshold).** Eskiden
   ham (min-max normalize) yükseklik değeriyle karşılaştırılıyordu; fBm
   toplamının dağılımı ortada yığılan bir çan eğrisi olduğu için slider'ın
   uçlarında (çok düşük/yüksek deniz seviyesi) görünür etkisi azdı. Artık
   slider DOĞRUDAN "haritanın yüzde kaçı su olsun" — üretilen haritada
   ölçülen kara% her zaman slider'la birebir eşleşiyor (test: sea=0.20 →
   %80 kara, sea=0.60 → %40 kara, tam isabet).
2. **Dağlılık artık ridged-noise karışımı, üstel değil.** Eski `mountainy`
   üssü normalize edilmiş yüksekliğe uygulanıyordu — deniz seviyesiyle aynı
   eksende çakışıyordu, ayırt edilemiyordu. Yeni `ruggedness` parametresi
   ikinci bir ridged fBm katmanını (`1-|noise|` katlanmış, sivri sırt
   görünümü) taban araziyle karıştırıyor. **Bulunan ikinci bug:** landFrac
   (dağ/kaya/kar eşiği) teorik maksimum 1'e göre normalize ediliyordu, ama
   ridge karışımı arttıkça haritanın GERÇEK tepe noktası hiç 1'e ulaşmıyordu
   (rugged=1.0'da gerçek max ~0.86) — yani dağlılık arttıkça kar/kaya sınıfı
   sessizce geriliyordu, tam tersi beklenenin. Düzeltme: landFrac artık
   haritanın gerçek ölçülen tepe noktasına göre normalize ediliyor.

**Doğrulama:** Node'da headless — sea level yüzdesi tam isabetli (3 değer
test edildi), determinism ve aralık kontrolü geçti. Tarayıcıda (Chrome,
localhost sunucu üzerinden): kategoriler render oluyor, hover okuması
doğru biyom/koordinat basıyor, dağlılığı 0.35→1.00 çekince harita görünür
biçimde parçalanıp sivrileşiyor (ekran görüntüsüyle doğrulandı), konsol
hatasız.

**Açık işler:** M2 (izometrik voxel), M3 (fırça düzenleme), M4 (animasyon).

**Sonraki adım:** M2 — izometrik voxel projeksiyon.


## 2026-09-01 — Proje başlangıcı + M1: üretim + üstten görünüm

**Ne yapıldı:** Repo sıfırdan kuruldu. Vanilla HTML/CSS/JS, framework/build yok.
Grid veri modeli (`elevation`/`moisture`/`temperature`/`biome`/`water`/`level`),
seedable simplex noise (bağımlılıksız), fBm tabanlı yükseklik + nem üretimi,
enlem+rakım tabanlı sıcaklık, 11 biyomluk sınıflandırma tablosu, Canvas 2D
top-down render (eğim tabanlı ucuz hillshade), canlı parametre paneli
(seed/boyut/deniz seviyesi/arazi ölçeği/dağlılık/nem ölçeği/ada falloff).

**Hangi dosyalar değişti:** `index.html`, `css/style.css`, `src/noise.js`,
`src/biome.js`, `src/grid.js`, `src/generate.js`, `src/render/topdown.js`,
`src/main.js`.

**Neden bu yaklaşım:** Render için Canvas 2D seçildi (saf DOM/CSS değil) —
sonraki milestone'daki izometrik voxel çizimi + su/kuş animasyonu bu ölçekte
(96²) DOM'da performans duvarına çarpar. Grid, iki görünümün (üstten/iso) ortak
kaynağı olacak şekilde tasarlandı — ayrı harita değil, aynı verinin projeksiyonu.
Modüller `window.SM` namespace'i altında classic `<script>` ile yükleniyor
(ES module değil) ki proje çift tıkla `index.html` ile açılabilsin, sunucu
gerekmesin.

**Doğrulama:** Tüm JS dosyaları `node --check` ile sözdizimi kontrolünden geçti.
Üretim hattı Node içinde `window`/`document` stub'ıyla headless çalıştırıldı:
96² haritada determinism doğrulandı (aynı seed → aynı elevation dizisi), 11
biyomun tamamı bir örnek haritada üretildi, elevation/moisture aralık dışı
değer kalmadı (bir sınır-hassasiyeti bulgusu clamp ile düzeltildi).

**Açık işler:** M2 (izometrik voxel projeksiyon), M3 (fırça düzenleme), M4
(nehir dalgası + kuş animasyonu).

**Sonraki adım:** M2 — grid'i prizma/voxel olarak iso açıda çizen renderer,
painter's algorithm ile arkadan öne sıralama, statik terrain bake.
