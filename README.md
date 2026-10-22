# 風車地球

給小朋友看的全球風力發電療癒網站：風在地球上流動，世界各地四十多萬支真實位置的風車跟著轉。

- 底圖：MapLibre GL JS 5.24 ＋ OpenFreeMap 向量圖磚（道路、建築、地名）＋ Mapterhorn 地形（陰影、立體地形）
- 功能：模擬風場流線、颱風、風場面板與圖鑑、3D 風場任務（three.js，依地點換成台灣海峽／海上／北海／沙漠／草原／山區／雪地場景，三關：點亮村莊、對準風向、暴風來襲；地面用跟平面地圖一樣的底圖，附近有建築就蓋成立體房子）、風車點點樂（點風車彈 Do Re Mi、照順序連線練習數字和 ABC）、📍 GPS 打卡（手機走到風車 2 公里內打卡，那一區的風車變成七彩版，紀錄在貼紙簿；打卡紀錄只存在這台裝置的瀏覽器裡）、找找看、貼紙簿、背景音樂、風聲、環遊世界導覽、放空模式

## 檔案

```
index.html               頁面
assets/style.css         樣式
assets/app.js            主程式
assets/game3d.js         3D 風場場景與任務（第一次進 3D 才載入）
data/farms.json          風場圖鑑（位置、容量、介紹文字）
data/turbines.bin.gz     全球風機座標（壓縮二進位，格式見 tools/build_turbines.py）
data/turbines-meta.json  風機筆數與下載時間
data/tw-farm-turbines.json  台灣離岸風場與風機的對應
data/typhoons.json       颱風路徑
data/countries-50m.json  國界（找找看、3D 海岸線）
data/taiwan-counties.json  台灣縣市界（3D 海岸線）
tools/build_turbines.py  把 Overpass 下載的 GeoJSON 轉成 turbines.bin.gz
tools/build_wind.py      下載 NOAA GFS 即時風場，轉成 data/wind.bin.gz（GitHub Actions 每 6 小時執行）
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

## 手機與平板

iPhone、iPad（Safari 16.4 以上）與 Android 都能用。iPhone 的 Safari 不支援網頁全畫面，所以那裡會隱藏「⛶」鈕；
可以從 Safari 的分享選單選「加入主畫面」，之後從主畫面打開就像 App 一樣全螢幕（圖示在 `assets/icon-*.png`，設定在 `manifest.webmanifest`）。
打卡需要允許網頁使用位置；背景音樂要先點一下畫面才能播放，螢幕鎖定時會停止。

## 發布到 GitHub Pages

1. 到 https://github.com/new 建立新的 repo，例如取名 `wind-globe`，選 **Public**，其他選項都不要勾（不要加 README），按 **Create repository**。
2. 在這個資料夾打開終端機，依序執行（把 `你的帳號` 換成你的 GitHub 帳號）：

   ```bash
   git init -b main
   git add .
   git commit -m "風車地球第一版"
   git remote add origin https://github.com/你的帳號/wind-globe.git
   git push -u origin main
   ```

   第一次推送時會跳出 GitHub 登入視窗，登入即可。
3. 回到 GitHub 的 repo 頁面 → **Settings** → 左邊 **Pages** → **Build and deployment** 的 Source 選 **GitHub Actions**。
   之後每次 push、以及每 6 小時，`.github/workflows/pages.yml` 會自動下載最新風場並發布網站；進度可以在 repo 的 **Actions** 分頁看到，也可以在那裡按 **Run workflow** 手動更新。
4. 等一兩分鐘，網址會出現在同一頁上方：`https://你的帳號.github.io/wind-globe/`

之後修改檔案，只要再執行：

```bash
git add .
git commit -m "說明這次改了什麼"
git push
```

GitHub Pages 會自動重新發布。

## 資料來源與授權

- 地圖：© [OpenFreeMap](https://openfreemap.org/) © [OpenMapTiles](https://www.openmaptiles.org/)，資料 © [OpenStreetMap 貢獻者](https://www.openstreetmap.org/copyright)（ODbL 1.0）
- 風機位置：© [OpenStreetMap 貢獻者](https://www.openstreetmap.org/copyright)（ODbL 1.0），經 Overpass API 取得。`data/turbines.bin.gz` 是由 OSM 資料衍生的資料庫，同樣適用 ODbL。
- 地形：© [Mapterhorn](https://mapterhorn.com/attribution)
- 國界：[Natural Earth](https://www.naturalearthdata.com/)（公有領域）
- 台灣縣市界：[內政部國土測繪中心](https://whgis-nlsc.moi.gov.tw/)，依[政府資料開放授權條款－第 1 版](https://data.gov.tw/license)
- 颱風路徑：交通部中央氣象署、中國中央氣象台
- 風場是程式模擬的，不是即時氣象觀測。
