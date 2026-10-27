# 風車地球 WindPowerGlobe

網址：https://windpowerglobe.com

給小朋友看的全球風力發電療癒網站：風在地球上流動，世界各地四十多萬支真實位置的風車跟著轉。

- 底圖：MapLibre GL JS 5.24 ＋ OpenFreeMap 向量圖磚（道路、建築、地名）＋ Mapterhorn 地形（陰影、立體地形）
- 功能：模擬風場流線、颱風、風場面板與圖鑑、3D 風場任務（three.js，依地點換成台灣海峽／海上／北海／沙漠／草原／山區／雪地場景，三關：點亮村莊、對準風向、暴風來襲；地面用跟平面地圖一樣的底圖，附近有建築就蓋成立體房子；街景視角可以走動，電腦用 W A S D、手機用搖桿；「⛏ 方塊世界」把那裡的地形、房子、道路、樹和風機照真實位置變成 1 公尺的方塊，可以走、跳、飛；工具有拆、放、大安裝、種風機、上一步、全部復原，「武器」裡有大槌子、方塊槍、雷射槍、光劍、炸彈、火箭筒、龍捲風（炸彈、火箭筒、龍捲風要輸入驗證碼才能開））、風車點點樂（點風車彈 Do Re Mi、照順序連線練習數字和 ABC，可選 1–10／1–50／1–100、A–Z）、定位我的位置、📍 GPS 打卡（手機走到風車 2 公里內打卡，那一區的風車變成七彩版，紀錄在貼紙簿；打卡紀錄只存在這台裝置的瀏覽器裡）、找找看、貼紙簿、背景音樂（一直循環播放）、風聲、環遊世界導覽、放空模式（依畫面所在的國家一區一區導覽：台灣是縣市、其他國家是有風機的省州，音樂隨機播放）、點風機看所在地區並唸出來、幫風機取名字（小鍵盤：數字、符號、英文字母；名字存在這台裝置的瀏覽器）、風線選單可以分別關掉風線和颱風、「地圖」鈕的觀看設定（地圖風格：明／暗／衛星／地景，台灣電子地圖、地形平坦／立體、3D 建築、日夜光影、畫質自動／高／中／低）、多國語言（英文、繁體中文、簡體中文、日文、韓文，依瀏覽器語言和時區自動選，標題右邊可以換）

## 檔案

```
index.html               頁面
assets/style.css         樣式
assets/app.js            主程式
assets/game3d.js         3D 風場場景與任務（第一次進 3D 才載入）
assets/blocks.js         方塊世界（3D 實景裡按「⛏ 方塊世界」或風機卡片的「⛏ 進入方塊世界」才載入）
functions/api/visits.js  瀏覽人數（Cloudflare Pages Functions＋D1，今日／累計不同 IP 數）
assets/i18n.js           多國語言：判斷語言、tr() 翻譯、翻譯靜態 HTML
assets/i18n/<語言>.js    字典（tools/build_i18n.py 產生，不要直接改）
tools/i18n/<語言>.json   英、日、韓文翻譯（{繁體原文: 翻譯}）；_keys.json 是所有要翻譯的原文
tools/build_i18n.py      產生字典（簡體中文用 OpenCC 自動轉換）
data/farms.json          風場圖鑑（位置、容量、介紹文字）
data/turbines.bin.gz     全球風機座標（壓縮二進位，格式見 tools/build_turbines.py）
data/turbines-meta.json  風機筆數與下載時間
data/tw-farm-turbines.json  台灣離岸風場與風機的對應
data/typhoons.json       全球颱風路徑（tools/build_typhoons.py 產生）
data/typhoon-names.json  颱風英文名 → 中文名
data/countries-50m.json  國界（找找看、3D 海岸線）
data/taiwan-counties.json  台灣縣市界（3D 海岸線）
tools/build_turbines.py  把 Overpass 下載的 GeoJSON 轉成 turbines.bin.gz
tools/build_wind.py      下載 NOAA GFS 即時風場，轉成 data/wind.bin.gz（GitHub Actions 每 6 小時執行）
tools/build_voice.py     把小幫手要唸的句子錄成 voice/*.mp3（GitHub Actions 發布前執行）
data/voices.json         小幫手可以選的聲音
tools/build_typhoons.py  從 GDACS 下載全球正在活動的颱風、颶風、氣旋（GitHub Actions 每 6 小時執行）
.github/workflows/pages.yml  發布網站到 GitHub Pages，並先下載最新風場
```

## 在自己電腦上看

網頁要從伺服器開（直接雙擊 index.html 會讀不到資料檔）：

```bash
python -m http.server 8000
```

然後用瀏覽器開 http://localhost:8000

## 更新風機資料

把 Overpass 匯出的 GeoJSON 放進 `WindGlobe_data/raw/`，再執行：

```bash
python tools/build_turbines.py "WindGlobe_data/raw/*.geojson" --mills WindGlobe_data/raw_windmills/windmills.json
```

`--mills` 是 Overpass 匯出的傳統風車（查詢 `nwr["man_made"="windmill"]; out center tags;`），地圖上用荷蘭風車造型顯示。
風機造型依資料決定：額定容量推估年代（越大越新）、OSM 標了兩葉片或垂直軸的照樣畫，台灣陸上塔底綠色漸層、德國與日本大型風機葉尖紅白；打卡後整區變成七彩版。

會重新產生 `data/turbines.bin.gz` 和 `data/turbines-meta.json`。原始檔很大，已在 `.gitignore` 排除，不會推上 GitHub。

## 背景音樂

`Music/` 裡的 mp3 由 ♫ 鈕播放：地圖中心在台灣一帶時依序輪播台灣歌單，其他地方從其餘曲目隨機播放。新增或刪除音樂後執行：

```bash
python tools/build_music.py
```

會重新產生 `data/music.json`。台灣歌單寫在 `tools/build_music.py` 的 `TAIWAN`（或直接改 `data/music.json` 的 `taiwan`）。

音樂區是風機群：30 支以上相鄰的風機圍成圓滑的區塊，跨省（州、縣市）時沿行政界線切開，附近有圖鑑裡的風場就用風場名稱命名。地圖中心進入一個音樂區就換歌（台灣的音樂區依序播台灣歌單），在區外維持原本的歌；播音樂時這些區塊的外框會像霓虹燈一樣發光閃爍。資料 `data/music-zones.json` 由風機資料和 Natural Earth 1:10m Admin 1 產生（更新風機資料後也要重跑）：

```bash
python tools/build_music_zones.py WindGlobe_data/ne_admin1/ne_10m_admin_1_states_provinces.shp
```

（需要 `pip install pyshp shapely`；行政區原始檔請從 https://www.naturalearthdata.com/ 下載。）

≋ 鈕是風聲・白噪音選單（原野微風、海邊風浪、山谷呼嘯、颱風暴風、白噪音），都是網頁即時合成；開著時背景音樂會自動降到約 4 成音量。

## 即時風場

網站的風（風線、各風場的風速與發電量）來自 NOAA NCEP GFS 全球預報（1° 網格、地面 10 公尺高的風，公有領域）。
`tools/build_wind.py` 從 NOMADS 下載最新一次預報的 0、6、12、18、24 小時，自己解碼 GRIB2（不需要安裝套件），存成 `data/wind.bin.gz`（約 300 KB）。
這個檔案由 GitHub Actions 在發布網站前產生，不放進 git（已列在 `.gitignore`）。本機想測試時執行：

```bash
python tools/build_wind.py
```

讀不到風場檔時，網站會自動改用原本的程式模擬風場，HUD 會顯示「模擬風場」。

## 颱風

`tools/build_typhoons.py` 從 GDACS 下載全球正在活動的熱帶氣旋（實測路徑＋約 5 天預報），GitHub Actions 每 6 小時跟風場一起更新。
風速換算成 10 分鐘平均風後，依中央氣象署標準分級，颱風寶寶跟著換顏色和表情：熱帶性低氣壓（淡藍、睡覺）、輕度（黃、開心）、中度（橘、用力吹）、強烈（紅、生氣）。
西北太平洋颱風的中文名寫在 `data/typhoon-names.json`，有新颱風時可以自己加一行（例如 `"CHAMPI": "薔琵"`），沒有的就顯示英文名。

## 小幫手的語音

遊戲裡唸的話用微軟線上神經語音（Edge「大聲朗讀」的同一套）事先錄好：聲音清單在 `data/voices.json`（女生：曉臻、曉伊、曉曉、雲夏、曉妮，都是可愛版；男生：雲夏、雲希、雲哲、雲健是原聲，雲龍是廣東話可愛版；曉臻是預設），
`tools/build_voice.py` 依網站的程式列出所有句子（約 230 句）並錄成 `voice/<聲音>/<雜湊>.mp3`。這個資料夾由 GitHub Actions 在發布前產生（有快取，只補錄新句子），不放進 git。本機想測試時：

```bash
pip install edge-tts
python tools/build_voice.py
```

找不到錄好的句子時，網站會改用裝置內建的語音。新增要唸的句子時，記得也加進 `tools/build_voice.py` 的 `lines()`。

英文、日文、韓文各有一個女生、一個男生聲音（`data/voices.json` 的 `lang`）：`build_voice.py` 會用 `assets/i18n/<語言>.js` 把中文句子翻好再錄，所以要先跑 `tools/build_i18n.py`。
簡體中文介面沿用中文聲音的錄音（網頁會把簡體句子換回繁體原文找檔案）。

## 多國語言

網頁的原文是繁體中文，程式裡要顯示的字都包在 `tr('原文')` 裡（會變的部分寫成 `{名稱}`，例如 `tr('第 {n} 題',{n:3})`），`index.html` 的文字在載入時自動翻譯。
語言的判斷順序：手動選過的（存在這台裝置）→ 瀏覽器語言 → 時區（地區）→ 英文。新增或修改文字後：

```bash
pip install opencc-python-reimplemented pyshp
python tools/build_i18n.py --keys      # 更新 tools/i18n/_keys.json，看有哪些新句子
# 把新句子的翻譯加進 tools/i18n/en.json、ja.json、ko.json
python tools/build_i18n.py --check en  # 檢查：每句都有、{變數} 和 HTML 標籤一樣
python tools/build_i18n.py             # 產生 assets/i18n/*.js（簡體中文自動轉換）
```

音樂區的地區名稱直接用 Natural Earth 行政區資料裡的英、日、韓文名稱（需要 `WindGlobe_data/ne_admin1`，沒有的話沿用上次的字典）。

## 手機與平板

iPhone、iPad（Safari 16.4 以上）與 Android 都能用。iPhone 的 Safari 不支援網頁全畫面，所以那裡會隱藏「⛶」鈕；
可以從 Safari 的分享選單選「加入主畫面」，之後從主畫面打開就像 App 一樣全螢幕（圖示在 `assets/icon-*.png`，設定在 `manifest.webmanifest`）。
打卡需要允許網頁使用位置；背景音樂要先點一下畫面才能播放，螢幕鎖定時會停止。

## 發布到 GitHub Pages

1. 到 https://github.com/new 建立新的 repo，例如取名 `WindPowerGlobe`，選 **Public**，其他選項都不要勾（不要加 README），按 **Create repository**。
2. 在這個資料夾打開終端機，依序執行（把 `你的帳號` 換成你的 GitHub 帳號）：

   ```bash
   git init -b main
   git add .
   git commit -m "風車地球第一版"
   git remote add origin https://github.com/你的帳號/WindPowerGlobe.git
   git push -u origin main
   ```

   第一次推送時會跳出 GitHub 登入視窗，登入即可。
3. 回到 GitHub 的 repo 頁面 → **Settings** → 左邊 **Pages** → **Build and deployment** 的 Source 選 **GitHub Actions**。
   之後每次 push、以及每 6 小時，`.github/workflows/pages.yml` 會自動下載最新風場並發布網站；進度可以在 repo 的 **Actions** 分頁看到，也可以在那裡按 **Run workflow** 手動更新。
4. 等一兩分鐘，網址會出現在同一頁上方：`https://你的帳號.github.io/WindPowerGlobe/`

之後修改檔案，只要再執行：

```bash
git add .
git commit -m "說明這次改了什麼"
git push
```

GitHub Pages 會自動重新發布。

## 也發布到 Cloudflare Pages

同一份網站也會發布到 Cloudflare Pages 的 `windpowerglobe` 專案（`https://windpowerglobe.pages.dev`），網域 `windpowerglobe.com` 在 Cloudflare 購買並接在這個專案上（專案的「自訂網域」）。
需要在 repo 的 **Settings → Secrets and variables → Actions** 設定 `CLOUDFLARE_API_TOKEN`（權限只要「Cloudflare Pages：編輯」）和 `CLOUDFLARE_ACCOUNT_ID`；沒設定的話這一步會自動跳過，只發布到 GitHub Pages。

### 瀏覽人數（今日、累計）

頁面最下面的人數由 `functions/api/visits.js` 計算（Cloudflare Pages Functions，發布時 wrangler 會自動帶上 `functions/` 資料夾）。
依不同網路位址（IP）算人數，但只存「IP＋密語」的 SHA-256 雜湊，不存 IP 本身；每天的名單兩天後自動刪掉。
第一次要在 Cloudflare 後台設定一次：

1. **Workers & Pages → D1 SQL Database → Create**，名稱例如 `windpowerglobe-visits`（資料表會自動建立）。
2. **Workers & Pages → windpowerglobe → Settings → Bindings → Add → D1 database**，變數名稱填 `VISITS_DB`，選剛剛的資料庫（Production）。
3. （可選）**Settings → Variables and Secrets** 加一個 `VISIT_SALT`，值是任意一串亂碼（加密用的密語）。
4. 重新發布一次（push 或在 Actions 手動執行）。

沒設定好時 `/api/visits` 會回錯誤，頁面就不顯示人數，其他功能不受影響。GitHub Pages 版也會連到 windpowerglobe.com 同一份人數；在自己電腦上看時只讀人數、不會算進去。

## 資料來源與授權

- 方塊世界材質：[Kenney Voxel Pack](https://kenney.nl/assets/voxel-pack)（www.kenney.nl，CC0），縮成 32×32 放在 `assets/blocks/kenney-tiles.png`，授權說明在 `assets/blocks/Kenney-License.txt`。
- 地圖：© [OpenFreeMap](https://openfreemap.org/) © [OpenMapTiles](https://www.openmaptiles.org/)，資料 © [OpenStreetMap 貢獻者](https://www.openstreetmap.org/copyright)（ODbL 1.0）
- 風機位置：© [OpenStreetMap 貢獻者](https://www.openstreetmap.org/copyright)（ODbL 1.0），經 Overpass API 取得。`data/turbines.bin.gz` 是由 OSM 資料衍生的資料庫，同樣適用 ODbL。
- 地形：© [Mapterhorn](https://mapterhorn.com/attribution)
- 衛星圖：[Sentinel-2 cloudless](https://s2maps.eu) by EOX IT Services GmbH（Contains modified Copernicus Sentinel data 2023，CC BY-NC-SA 4.0，非商業使用）；台灣放大後用內政部國土測繪中心正射影像
- 國界：[Natural Earth](https://www.naturalearthdata.com/)（公有領域）
- 台灣縣市界：[內政部國土測繪中心](https://whgis-nlsc.moi.gov.tw/)，依[政府資料開放授權條款－第 1 版](https://data.gov.tw/license)
- 颱風路徑：[GDACS](https://www.gdacs.org/)（聯合國與歐盟全球災害警報系統，路徑資料來自美國 JTWC／NHC），GitHub Actions 每 6 小時更新；分級依交通部中央氣象署標準
- 風場是程式模擬的，不是即時氣象觀測。
