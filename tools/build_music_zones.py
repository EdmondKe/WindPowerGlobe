"""產生「音樂區」：把距離很近的風機連成一群（30 支以上才算），畫成圓滑的區塊，再沿行政區（省、州、台灣縣市）切開。

用法（先跑過 tools/build_turbines.py）：
    python tools/build_music_zones.py WindGlobe_data/ne_admin1/ne_10m_admin_1_states_provinces.shp

需要 pyshp 與 shapely（pip install pyshp shapely）。行政區：Natural Earth 1:10m Admin 1（台灣改用內政部縣市界）。

做法：
    1. 以約 2.8 公里的格子把風機分格，相鄰（含斜角）有風機的格子連成一群；30 支以上的群才保留。
    2. 每群把有風機的格子中心各畫一個 2.5 公里的圓，合併後再「膨脹 2 公里、收縮 2 公里」把縫補起來、邊緣變圓。
    3. 跟行政區取交集切成幾塊；海上的部分併到這群風機最多的那一塊，完全在海上的群用最近的行政區命名。
       切完不到 30 支的小塊併回同一群最大的那塊。
    4. 不到 30 支的小群用橢圓圈起來。
    5. 有重疊的圈（區塊、橢圓）合併成一個區塊；所有區塊當成一張拼圖一起簡化，相鄰區塊的共用邊界才不會交錯。
    6. 最後檢查每支風機都在某個圈裡，漏掉的補一個 1 公里的小圓（重疊的再合併一次）。

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
DOT_GRID = 1.0    # 畫圓用的小格（公里）：每格一個圓心，風機離圓心最多約 1.4 公里，一定在圈內
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
    lon, lat = plane(o), plane(o + 4 * n); cl = b[o + 8 * n:o + 9 * n]
    keep = [i for i in range(n) if cl[i] >> 5 != 3]  # 傳統風車不算音樂區
    return [lon[i] for i in keep], [lat[i] for i in keep]

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

def ellipse(lon0, lat0, a_km, b_km, ang):
    """橢圓的多邊形（經緯度），跟網頁判斷橢圓的方式一樣：長軸方向由東往北逆時針"""
    k = 111.32 * math.cos(math.radians(lat0)); ca, sa = math.cos(ang), math.sin(ang)
    return Polygon([((a_km * math.cos(t) * ca - b_km * math.sin(t) * sa) / k + lon0, (a_km * math.cos(t) * sa + b_km * math.sin(t) * ca) / 110.57 + lat0)
                    for t in (j / 48 * 2 * math.pi for j in range(48))])

def merge_overlaps(zones, circles):
    """有重疊（面積大於約 0.001 平方公里）的圈連成一組，每組合併成一個區塊，名稱用風機最多的那個；沒有重疊的橢圓保持橢圓"""
    items = [('z', z['g'], z) for z in zones] + [('c', e, r) for r, e in circles]
    geoms = [it[1] for it in items]; t = shapely.STRtree(geoms)
    par = list(range(len(items)))
    def fnd(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i, g in enumerate(geoms):
        for j in t.query(g, predicate='intersects'):
            j = int(j)
            if j > i and g.intersection(geoms[j]).area > 1e-7: par[fnd(i)] = fnd(j)
    grp = defaultdict(list)
    for i in range(len(items)): grp[fnd(i)].append(i)
    zs, cs, merged = [], [], 0
    for ids in grp.values():
        if len(ids) == 1 and items[ids[0]][0] == 'c':
            cs.append((items[ids[0]][2], geoms[ids[0]])); continue
        ws = [(items[i][2]['w'] if items[i][0] == 'z' else items[i][2][5]) for i in ids]
        top = items[ids[ws.index(max(ws))]]
        name = top[2]['n'] if top[0] == 'z' else top[2][6]
        tw = any((items[i][2]['tw'] if items[i][0] == 'z' else items[i][2][7]) for i in ids)
        g = unary_union([geoms[i] for i in ids]) if len(ids) > 1 else geoms[ids[0]]
        merged += len(ids) - 1
        zs.append({'n': name, 'tw': 1 if tw else 0, 'w': sum(ws), 'g': shapely.make_valid(g)})
    return zs, cs, merged

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
    def adm_of(x, y):
        """點所在（或最近）的行政區；台灣縣市只有在台灣這一側才算"""
        c_ll = shapely.Point(x, y); tw_side = 119.3 <= x <= 122.6 and 21.5 <= y <= 25.5
        cand = [int(j) for j in tree.query(c_ll.buffer(1))] or [int(tree.nearest(c_ll))]
        cand = [j for j in cand if tw_side or not adm_tw[j]] or cand
        return min(cand, key=lambda j: adm_geoms[j].distance(c_ll))
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
        # 每 1 公里的小格取一支風機當圓心（用分群的大格會漏掉格子角落的風機，讓它跑到圈外）
        centers = {}
        for i in idx:
            x, y = to_km(lon[i], lat[i]); key = (math.floor(x / DOT_GRID), math.floor(y / DOT_GRID))
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
            if g_ll.is_empty: continue
            w, s, e, nn = g_ll.bounds
            # 找風場名稱的範圍：一般 5 公里，大區塊依大小放寬（最多 30 公里）
            size_km = math.sqrt(max(g_ll.area, 0) * 111 * 111 * math.cos(math.radians(lat0)))
            name = adm_names[ai]; best = max(5, min(30, size_km * 0.3)) / 111
            for fn, fx, fy in farms:
                d = g_ll.distance(shapely.Point(fx, fy))
                if d < best: best, name = d, fn
            zones.append({'n': name, 'tw': 1 if adm_tw[ai] else 0, 'w': c, 'g': g_ll})

    # 4. 不到 30 支的小群（包括只有 1 支）：沿著風機排列的方向圈一個橢圓（只有 1 支時是圓），靠得近的風機會在同一群、同一個圈
    names, name_idx, circles = [], {}, []
    def nid(nm):
        if nm not in name_idx: name_idx[nm] = len(names); names.append(nm)
        return name_idx[nm]
    for g in smalls:
        idx = [i for c in g for i in cells[c]]
        lon0 = sum(lon[i] for i in idx) / len(idx); lat0 = sum(lat[i] for i in idx) / len(idx); k = kx(lat0)
        xs = [(lon[i] - lon0) * k for i in idx]; ys = [(lat[i] - lat0) * 110.57 for i in idx]
        # 主軸方向：座標的共變異數矩陣的主特徵向量
        sxx = sum(x * x for x in xs); syy = sum(y * y for y in ys); sxy = sum(x * y for x, y in zip(xs, ys))
        ang = 0.5 * math.atan2(2 * sxy, sxx - syy) if len(idx) > 1 else 0.0
        ca, sa = math.cos(ang), math.sin(ang)
        u = [x * ca + y * sa for x, y in zip(xs, ys)]; v = [-x * sa + y * ca for x, y in zip(xs, ys)]
        a_km = max(abs(t) for t in u) * 1.12 + 0.8; b_km = max(abs(t) for t in v) * 1.12 + 0.8
        if len(idx) == 1: a_km = b_km = 1.0
        b_km = max(b_km, 0.8, a_km * 0.22)  # 太扁的橢圓不好點，最扁到 1：4.5
        c_ll = shapely.Point(lon0, lat0); tw_side = 119.3 <= lon0 <= 122.6 and 21.5 <= lat0 <= 25.5
        cand = [int(j) for j in tree.query(c_ll.buffer(1))] or [int(tree.nearest(c_ll))]
        cand = [j for j in cand if tw_side or not adm_tw[j]] or cand
        ai = min(cand, key=lambda j: adm_geoms[j].distance(c_ll))
        rec = [round(lon0 * Q), round(lat0 * Q), round(a_km * 1000), round(b_km * 1000), round(math.degrees(ang) * 10), len(idx), adm_names[ai], 1 if adm_tw[ai] else 0]
        circles.append((rec, ellipse(lon0, lat0, a_km, b_km, ang)))

    # 5. 有重疊的圈（區塊和區塊、區塊和橢圓、橢圓和橢圓）合併成一個區塊
    zones, circles, m1 = merge_overlaps(zones, circles)
    # 6. 所有區塊一起簡化（相鄰區塊的共用邊界會簡化成同一條線，不會交錯）。
    #    先把相鄰區塊之間極小的重疊切掉，變成剛好拼在一起的拼圖，簡化才不會把重疊放大
    gs = [shapely.set_precision(z['g'], 1e-6) for z in zones]; t3 = shapely.STRtree(gs)
    for i in range(len(gs)):
        for j in t3.query(gs[i], predicate='intersects'):
            j = int(j)
            if j < i and gs[i].intersection(gs[j]).area > 0: gs[i] = shapely.make_valid(gs[i].difference(gs[j]))
    simp = shapely.coverage_simplify(np.array(gs, dtype=object), SIMP / 111)
    for z, g in zip(zones, simp): z['g'] = shapely.make_valid(g)
    zones = [z for z in zones if not z['g'].is_empty]
    # 7. 保險：每支風機都要在某個圈裡（切行政區、簡化邊緣都可能漏掉少數幾支）；沒圈到的補一個 1 公里的小圓
    cover = unary_union([z['g'] for z in zones] + [e for _, e in circles]); shapely.prepare(cover)
    X, Y = np.array(lon), np.array(lat)
    lost = [int(i) for i in np.nonzero(~(shapely.contains_xy(cover, X, Y) | shapely.intersects_xy(cover, X, Y)))[0]]
    for i in lost:
        ai = adm_of(lon[i], lat[i])
        circles.append(([round(lon[i] * Q), round(lat[i] * Q), 1000, 1000, 0, 1, adm_names[ai], 1 if adm_tw[ai] else 0], ellipse(lon[i], lat[i], 1, 1, 0)))
    # 8. 補的小圓如果跟別的圈重疊，再合併一次（這次不再簡化）
    zones, circles, m2 = merge_overlaps(zones, circles)
    print(f'重疊的圈合併了 {m1 + m2} 次；沒被圈到、補了小圓的風機 {len(lost)} 支')
    for z in zones:
        w, s_, e, nn = z['g'].bounds; z['b'] = [round(w * Q), round(s_ * Q), round(e * Q), round(nn * Q)]; z['r'] = encode(z['g'])
    zones = [{k2: v for k2, v in z.items() if k2 != 'g'} for z in zones if z['r']]
    circles = [r[:6] + [nid(r[6]), r[7]] for r, _ in circles]

    dst = root / 'data' / 'music-zones.json'
    dst.write_text(json.dumps({'_note': f'音樂區：{MIN_N} 支以上相鄰風機圍成的圓滑區塊（zones，沿行政區切開），不到 {MIN_N} 支的小群用橢圓（circles：[經度×q, 緯度×q, 長半軸公尺, 短半軸公尺, 長軸方向（由東往北逆時針，0.1 度）, 風機數, 名稱編號, 台灣]）。由 tools/build_music_zones.py 產生。',
                               'q': Q, 'zones': zones, 'names': names, 'circles': circles}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tw = [z['n'] for z in zones if z['tw']]
    print(f'{len(zones)} 個音樂區、{len(circles)} 個小橢圓（台灣 {sum(c[7] for c in circles)} 個）→ {dst.relative_to(root)}（{dst.stat().st_size / 1e6:.2f} MB）；台灣大區 {len(tw)} 個：', ' '.join(tw))

if __name__ == '__main__':
    main()
