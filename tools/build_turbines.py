"""把 OpenStreetMap 風機點位（Overpass 匯出的 GeoJSON 或 Overpass JSON）轉成網站用的壓縮資料檔。

用法：
    python tools/build_turbines.py "WindGlobe_data/raw/*.geojson" --mills WindGlobe_data/raw_windmills/windmills.json
（--mills 是 Overpass 匯出的傳統風車 man_made=windmill，可省略）

輸出：
    data/turbines.bin.gz    全部風機（依 1° 格子排序、座標差分編碼後 gzip）
    data/turbines-meta.json 筆數、下載時間、來源

二進位格式（little endian）：
    header  b'WTB1', u32 版本=1, u32 n, u32 格子數, u32 細格數
    cells   每格 i16 經度格, i16 緯度格, u32 起始索引, u32 數量      （1° 格，拉遠時的亮點）
    agg     每格 i16 經度格, i16 緯度格, u32 數量                    （0.2° 格，中等縮放的亮點）
    dlon    n 個 i32：經度×1e5 與前一支的差（第一支為絕對值），位元組分層存放
            （先放 n 個最低位元組，再放 n 個次低位元組⋯），gzip 壓得比較小
    dlat    n 個 i32：緯度×1e5 與前一支的差，同樣分層存放
    cl      n 個 u8：低 4 位元＝葉輪直徑等級（見 DCL），第 4 位元＝離岸，
            第 5–6 位元＝類型（0 一般三葉片、1 兩葉片、2 垂直軸、3 傳統風車〔不發電，不算進風機數量〕）
"""
import argparse, glob, gzip, json, math, re, struct, sys
from datetime import datetime, timezone
from pathlib import Path

# 網頁端 DCL=[0,50,77,90,130,154,167,174,222]：依額定容量推估的葉輪直徑（m），0＝未標註
def d_class(mw):
    if mw <= 0: return 0
    for i, lim in enumerate((1, 1.6, 2.6, 4.5, 7, 9, 11)):
        if mw < lim: return i + 1
    return 8

NUM = re.compile(r'([\d.]+)\s*(gw|mw|kw|w)?', re.I)
def parse_mw(v):
    """'2000 kW'、'2.3 MW'、'8.0MW'、'yes' → MW；讀不懂回傳 0。"""
    if not v: return 0.0
    best = 0.0
    for part in str(v).replace(',', '.').split(';'):
        m = NUM.search(part)
        if not m: continue
        try: x = float(m.group(1))
        except ValueError: continue
        unit = (m.group(2) or '').lower()
        x = x * {'gw': 1000, 'mw': 1, 'kw': 1e-3, 'w': 1e-6}.get(unit, 1e-3 if x >= 50 else 1)
        best = max(best, x)
    return best if 0 < best < 30 else 0.0

def is_offshore(t):
    return t.get('offshore') == 'yes' or 'seamark:type' in t or t.get('location') in ('offshore', 'sea')

def kind_of(t):
    if t.get('man_made') == 'windmill': return 3
    if 'vertical' in str(t.get('generator:type', '')).lower(): return 2
    if str(t.get('rotor:blades', '')).strip() == '2': return 1
    return 0

def first_point(g):
    """非點的幾何（少數風機被畫成面）取第一個座標。"""
    c = g.get('coordinates')
    while isinstance(c, list) and c and isinstance(c[0], list): c = c[0]
    return c

def read_file(path):
    d = json.loads(Path(path).read_text(encoding='utf-8'))
    ts = d.get('timestamp') or (d.get('osm3s') or {}).get('timestamp_osm_base')
    out = []
    if 'elements' in d:  # Overpass JSON（out center;）
        for el in d['elements']:
            c = el if 'lat' in el else el.get('center')
            if not c: continue
            out.append((f"{el['type']}/{el['id']}", c['lon'], c['lat'], el.get('tags') or {}))
    else:
        for f in d.get('features', []):
            g = f.get('geometry') or {}
            c = g.get('coordinates') if g.get('type') == 'Point' else first_point(g)
            if not c: continue
            p = f.get('properties') or {}
            out.append((f.get('id') or p.get('@id'), c[0], c[1], p))
    return out, ts

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--out', default='data')
    ap.add_argument('--mills', help='傳統風車（Overpass JSON）')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    files = sorted({f for pat in a.inputs for f in glob.glob(pat)}) + ([a.mills] if a.mills else [])
    if not files: sys.exit('找不到輸入檔')

    seen, pts, stamps = set(), [], []
    for fn in files:
        rows, ts = read_file(fn)
        if ts: stamps.append(ts)
        for oid, lon, lat, tags in rows:
            if oid in seen or not (-180 <= lon <= 180 and -90 <= lat <= 90): continue
            seen.add(oid)
            mw = parse_mw(tags.get('generator:output:electricity'))
            qx, qy = round(lon * 1e5), round(lat * 1e5)
            k = 3 if fn == a.mills else kind_of(tags)
            pts.append((math.floor(lat), math.floor(lon), qx, qy, (0 if k == 3 else d_class(mw)) | (16 if is_offshore(tags) else 0) | (k << 5)))
        print(f'{Path(fn).name}: {len(rows)} 筆，累計不重複 {len(pts)}')

    pts.sort()
    n = len(pts)
    cells, agg = [], {}
    for i, (cy, cx, qx, qy, _) in enumerate(pts):
        if cells and cells[-1][0] == cx and cells[-1][1] == cy: cells[-1][3] += 1
        else: cells.append([cx, cy, i, 1])
        k = (math.floor(qx / 2e4), math.floor(qy / 2e4))
        agg[k] = agg.get(k, 0) + 1

    buf = bytearray(b'WTB1')
    buf += struct.pack('<IIII', 1, n, len(cells), len(agg))
    for c in cells: buf += struct.pack('<hhII', *c)
    for (ax, ay), cnt in sorted(agg.items()): buf += struct.pack('<hhI', ax, ay, cnt)
    px = py = 0
    dx, dy = [], []
    for p in pts:
        dx.append(p[2] - px); dy.append(p[3] - py); px, py = p[2], p[3]
    shuffle = lambda b: b''.join(b[i::4] for i in range(4))
    buf += shuffle(struct.pack(f'<{n}i', *dx)) + shuffle(struct.pack(f'<{n}i', *dy)) + bytes(p[4] for p in pts)

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    (out / 'turbines.bin.gz').write_bytes(gzip.compress(bytes(buf), 9, mtime=0))
    stamp = min(stamps) if stamps else datetime.now(timezone.utc).isoformat(timespec='seconds')
    mills = sum(1 for p in pts if p[4] >> 5 == 3)
    meta = {'count': n - mills, 'windmills': mills, 'vertical_axis': sum(1 for p in pts if (p[4] >> 5) == 2),
            'two_blade': sum(1 for p in pts if (p[4] >> 5) == 1), 'osm_timestamp': stamp,
            'built': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'offshore': sum(1 for p in pts if p[4] & 16),
            'source': '© OpenStreetMap contributors, ODbL 1.0 (Overpass API: generator:source=wind)'}
    (out / 'turbines-meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'完成：{n} 支、{len(cells)} 格，原始 {len(buf)/1e6:.2f} MB → gzip {(out/"turbines.bin.gz").stat().st_size/1e6:.2f} MB')

if __name__ == '__main__':
    main()
