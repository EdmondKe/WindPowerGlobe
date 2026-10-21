"""產生「音樂區」：把距離很近的風機連成一群（30 支以上才算），畫成圓滑的區塊，再沿行政區（省、州、台灣縣市）切開。

用法（先跑過 tools/build_turbines.py）：
    python tools/build_music_zones.py WindGlobe_data/ne_admin1/ne_10m_admin_1_states_provinces.shp

需要 pyshp 與 shapely（pip install pyshp shapely）。行政區：Natural Earth 1:10m Admin 1（台灣改用內政部縣市界）。

做法：
    1. 以約 2.8 公里的格子把風機分格，相鄰（含斜角）有風機的格子連成一群；30 支以上的群才保留。
    2. 每群把有風機的格子中心各畫一個 2.5 公里的圓，合併後再「膨脹 2 公里、收縮 2 公里」把縫補起來、邊緣變圓。
    3. 跟行政區取交集切成幾塊；海上的部分併到這群風機最多的那一塊，完全在海上的群用最近的行政區命名。
       切完不到 30 支的小塊併回同一群最大的那塊。

輸出 data/music-zones.json：
    {"q":1000, "zones":[{"n":名稱, "tw":1(台灣), "w":風機數, "b":[西,南,東,北], "r":[[x0,y0,dx,dy,...], ...]}]}
    座標乘上 q 取整數（0.001°，約 100 公尺）；每個環第一點是絕對值，之後是與前一點的差。網頁用它判斷音樂區，也用它畫霓虹邊界。
"""
import gzip, json, math, struct, sys
from collections import defaultdict
from pathlib import Path
import shapefile
import numpy as np
import shapely
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import unary_union

MIN_N = 30        # 一個音樂區至少要有幾支風機
CELL = 2.8        # 分群格子（公里）
R_DOT = 2.5       # 每格畫的圓半徑（公里）
CLOSE = 2.0       # 補縫、修圓（公里）
SIMP = 0.3        # 外框簡化（公里）
Q = 1000
root = Path(__file__).resolve().parent.parent

def load_turbines():
    b = gzip.decompress((root / 'data' / 'turbines.bin.gz').read_bytes())
    n, nc, na = struct.unpack_from('<III', b, 8)
    o = 20 + 12 * nc + 8 * na
    def plane(off):
        raw = b[off:off + 4 * n]; out = []; acc = 0
        for i in range(n):
            v = raw[i] | raw[n + i] << 8 | raw[2 * n + i] << 16 | raw[3 * n + i] << 24
            if v >= 1 << 31: v -= 1 << 32
            acc += v; out.append(acc / 1e5)
        return out
    return plane(o), plane(o + 4 * n)

def topo_features(path, obj):
    t = json.loads(Path(path).read_text(encoding='utf-8'))
    sx, sy = t['transform']['scale']; tx, ty = t['transform']['translate']
    arcs = []
    for a in t['arcs']:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    def ring(ids):
        pts = []
        for i in ids:
            seg = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts += seg[1:] if pts else seg
        return pts
    out = []
    for g in t['objects'][obj]['geometries']:
        polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
        out.append((g['properties'], MultiPolygon([Polygon(ring(p[0]), [ring(h) for h in p[1:]]) for p in polys]).buffer(0)))
    return out

def polys_of(g):
    return [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']

def encode(g):
    out = []
    for p in polys_of(g):
        for r in [p.exterior.coords] + [h.coords for h in p.interiors]:
            pts = [(round(x * Q), round(y * Q)) for x, y in r]
            if len(pts) < 4: continue
            flat = [pts[0][0], pts[0][1]]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                if (x1, y1) != (x0, y0): flat += [x1 - x0, y1 - y0]
            out.append(flat)
    return out

def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    src = sys.argv[1] if len(sys.argv) > 1 else 'WindGlobe_data/ne_admin1/ne_10m_admin_1_states_provinces.shp'
    lon, lat = load_turbines(); n = len(lon)

    # 行政區（台灣用內政部縣市界）
    adm_names, adm_geoms, adm_tw = [], [], []
    for sr in shapefile.Reader(src, encoding='utf-8').iterShapeRecords():
        d = sr.record.as_dict()
        if d['adm0_a3'] == 'TWN': continue
        g = shape(sr.shape.__geo_interface__)
        if g.is_empty: continue
        if not g.is_valid: g = g.buffer(0)
        adm_names.append(d.get('name_zht') or d.get('name_zh') or d.get('name') or ''); adm_geoms.append(g); adm_tw.append(False)
    for p, g in topo_features(root / 'data' / 'taiwan-counties.json', 'counties'):
        adm_names.append(p['COUNTYNAME']); adm_geoms.append(g); adm_tw.append(True)
    tree = shapely.STRtree(adm_geoms)
    # 圖鑑裡的風場：區塊附近（一般 5 公里，大區塊放寬）有的話，用風場名稱命名（例如「海龍風場」比「澎湖縣」貼切）
    farms = [(f['n'].split('（')[0], f['lon'], f['lat']) for f in json.loads((root / 'data' / 'farms.json').read_text(encoding='utf-8'))['farms']]

    # 1. 分格、連成群
    kx = lambda la: 111.32 * math.cos(math.radians(la))
    cells = defaultdict(list)
    for i in range(n):
        cells[(math.floor(lon[i] * kx(lat[i]) / CELL), math.floor(lat[i] * 110.57 / CELL))].append(i)
    parent = {c: c for c in cells}
    def find(c):
        while parent[c] != c:
            parent[c] = parent[parent[c]]; c = parent[c]
        return c
    for (cx, cy) in cells:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nb = (cx + dx, cy + dy)
                if nb in cells:
                    a, b = find((cx, cy)), find(nb)
                    if a != b: parent[a] = b
    groups = defaultdict(list)
    for c in cells: groups[find(c)].append(c)
    clusters = [g for g in groups.values() if sum(len(cells[c]) for c in g) >= MIN_N]
    smalls = [g for g in groups.values() if sum(len(cells[c]) for c in g) < MIN_N]
    print(f'風機 {n} 支，{len(cells)} 格，{len(clusters)} 群（≥{MIN_N} 支）')

    zones = []
    for cl in clusters:
        idx = [i for c in cl for i in cells[c]]
        lon0 = sum(lon[i] for i in idx) / len(idx); lat0 = sum(lat[i] for i in idx) / len(idx)
        k = kx(lat0)
        to_km = lambda x, y: ((x - lon0) * k, (y - lat0) * 110.57)
        to_ll = lambda x, y: (x / k + lon0, y / 110.57 + lat0)
        # 2. 圓滑的區塊（在以這群中心為準的公里座標上做）
        centers = {}
        for i in idx:
            x, y = to_km(lon[i], lat[i]); key = (math.floor(x / CELL), math.floor(y / CELL))
            centers.setdefault(key, (x, y))
        blob = unary_union([shapely.Point(p).buffer(R_DOT, 12) for p in centers.values()]).buffer(CLOSE, 12).buffer(-CLOSE, 12)
        # 3. 換回經緯度，跟行政區切開
        blob = shapely.transform(blob.simplify(SIMP), lambda a: np.column_stack([a[:, 0] / k + lon0, a[:, 1] / 110.57 + lat0]))
        pts_km = shapely.points([(lon[i], lat[i]) for i in idx])
        pieces = []
        for ai in tree.query(blob):
            part = blob.intersection(adm_geoms[ai])
            if part.is_empty or part.area < 2e-5: continue
            pieces.append([ai, part])
        rest = blob.difference(unary_union([p for _, p in pieces])) if pieces else blob
        cnt = lambda g: int(shapely.contains(g, pts_km).sum()) + int(shapely.touches(g, pts_km).sum())
        if pieces:
            for pc in pieces: pc.append(cnt(pc[1]))
            pieces.sort(key=lambda pc: -pc[2])
            if not rest.is_empty: pieces[0][1] = unary_union([pieces[0][1], rest]); pieces[0][2] = cnt(pieces[0][1])
            big = [pc for pc in pieces if pc[2] >= MIN_N] or [pieces[0]]
            small = [pc for pc in pieces if pc not in big]
            if small: big[0][1] = unary_union([big[0][1]] + [pc[1] for pc in small]); big[0][2] = cnt(big[0][1])
        else:
            # 完全在海上：用最近的行政區命名；台灣縣市只有在台灣這一側的海峽才算（不然福建外海的風場會被算成馬祖）
            c_ll = shapely.Point(lon0, lat0); tw_side = 119.3 <= lon0 <= 122.6 and 21.5 <= lat0 <= 25.5
            cand = [int(j) for j in tree.query(c_ll.buffer(3))] or [int(tree.nearest(c_ll))]
            cand = [j for j in cand if tw_side or not adm_tw[j]] or cand
            ai = min(cand, key=lambda j: adm_geoms[j].distance(c_ll))
            big = [[ai, blob, len(idx)]]
        for ai, g_ll, c in big:
            g_ll = g_ll.simplify(SIMP / 111)
            if g_ll.is_empty: continue
            w, s, e, nn = g_ll.bounds
            # 找風場名稱的範圍：一般 5 公里，大區塊依大小放寬（最多 30 公里）
            size_km = math.sqrt(max(g_ll.area, 0) * 111 * 111 * math.cos(math.radians(lat0)))
            name = adm_names[ai]; best = max(5, min(30, size_km * 0.3)) / 111
            for fn, fx, fy in farms:
                d = g_ll.distance(shapely.Point(fx, fy))
                if d < best: best, name = d, fn
            zones.append({'n': name, 'tw': 1 if adm_tw[ai] else 0, 'w': c,
                          'b': [round(w * Q), round(s * Q), round(e * Q), round(nn * Q)], 'r': encode(g_ll)})

    zones = [z for z in zones if z['r']]

    # 4. 不到 30 支的小群（包括只有 1 支）：用一個圓圈住，靠得近的風機會在同一群、同一個圈
    names, name_idx, circles = [], {}, []
    def nid(nm):
        if nm not in name_idx: name_idx[nm] = len(names); names.append(nm)
        return name_idx[nm]
    for g in smalls:
        idx = [i for c in g for i in cells[c]]
        lon0 = sum(lon[i] for i in idx) / len(idx); lat0 = sum(lat[i] for i in idx) / len(idx); k = kx(lat0)
        r_km = max(1.2, max(math.hypot((lon[i] - lon0) * k, (lat[i] - lat0) * 110.57) for i in idx) + 1.0)
        c_ll = shapely.Point(lon0, lat0); tw_side = 119.3 <= lon0 <= 122.6 and 21.5 <= lat0 <= 25.5
        cand = [int(j) for j in tree.query(c_ll.buffer(1))] or [int(tree.nearest(c_ll))]
        cand = [j for j in cand if tw_side or not adm_tw[j]] or cand
        ai = min(cand, key=lambda j: adm_geoms[j].distance(c_ll))
        circles.append([round(lon0 * Q), round(lat0 * Q), round(r_km * 1000), len(idx), nid(adm_names[ai]), 1 if adm_tw[ai] else 0])

    dst = root / 'data' / 'music-zones.json'
    dst.write_text(json.dumps({'_note': f'音樂區：{MIN_N} 支以上相鄰風機圍成的圓滑區塊（zones，沿行政區切開），不到 {MIN_N} 支的小群用圓圈（circles：[經度×q, 緯度×q, 半徑公尺, 風機數, 名稱編號, 台灣]）。由 tools/build_music_zones.py 產生。',
                               'q': Q, 'zones': zones, 'names': names, 'circles': circles}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tw = [z['n'] for z in zones if z['tw']]
    print(f'{len(zones)} 個音樂區、{len(circles)} 個小圓圈（台灣 {sum(c[5] for c in circles)} 個）→ {dst.relative_to(root)}（{dst.stat().st_size / 1e6:.2f} MB）；台灣大區 {len(tw)} 個：', ' '.join(tw))

if __name__ == '__main__':
    main()
