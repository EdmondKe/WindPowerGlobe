# 風車地球

給小朋友看的全球風力發電療癒網站：風在地球上流動，世界各地四十多萬支真實位置的風車跟著轉。

- 底圖：MapLibre GL JS 5.24 ＋ OpenFreeMap 向量圖磚（道路、建築、地名）＋ Mapterhorn 地形（陰影、立體地形）
- 功能：模擬風場流線、颱風、風場面板與圖鑑、3D 吹風發電（three.js）、找找看、貼紙簿、背景音樂、風聲、環遊世界導覽、放空模式

## 檔案

```
index.html               頁面
assets/style.css         樣式
assets/app.js            主程式
data/farms.json          風場圖鑑（位置、容量、介紹文字）
data/turbines.bin.gz     全球風機座標（壓縮二進位，格式見 tools/build_turbines.py）
data/turbines-meta.json  風機筆數與下載時間
data/tw-farm-turbines.json  台灣離岸風場與風機的對應
data/typhoons.json       颱風路徑
data/countries-50m.json  國界（找找看、3D 海岸線）
data/taiwan-counties.json  台灣縣市界（3D 海岸線）
tools/build_turbines.py  把 Overpass 下載的 GeoJSON 轉成 turbines.bin.gz
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
python tools/build_turbines.py "WindGlobe_data/raw/*.geojson"
```

會重新產生 `data/turbines.bin.gz` 和 `data/turbines-meta.json`。原始檔很大，已在 `.gitignore` 排除，不會推上 GitHub。

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
3. 回到 GitHub 的 repo 頁面 → **Settings** → 左邊 **Pages** → **Build and deployment** 的 Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 **Save**。
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
