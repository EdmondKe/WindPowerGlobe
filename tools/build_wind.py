"""下載 NOAA GFS 全球風場預報（地面 10 公尺高的風，1° 網格），轉成網站用的 data/wind.bin.gz。

用法：
    python tools/build_wind.py            # 抓最新一次可用的預報
    python tools/build_wind.py --hours 0,3,6,9,12

不需要任何套件：GRIB2 用的是「complex packing＋空間差分」（data representation template 5.3），這裡自己解碼。
資料來源：NOAA NCEP GFS（美國政府公有領域），經 NOMADS grib filter 只下載 10 m 的 U、V 兩個變數。

輸出格式（little endian）：
    b'WND1', u32 版本=2, u16 經度格數 ni, u16 緯度格數 nj, u16 時間數 nt, u16 保留,
    f32 起始緯度（北）, f32 起始經度, f32 緯度間距（往南為負）, f32 經度間距, f32 風速比例（存的整數 × 比例 = m/s）,
    nt 個 u32：每一筆的有效時間（Unix 秒）,
    資料：依時間、再依 U（往東）／V（往北）、再依緯度列、經度欄，int8；
          每一列存的是「跟同一列前一格的差」（第一格是絕對值），gzip 壓得比較小
"""
import argparse, gzip, json, struct, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl'
SCALE = 0.5   # int8 × 0.5 m/s，可表示 ±63.5 m/s

def fetch(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:
            err = e; time.sleep(3 + 5 * k)
    raise err

def grib_url(day, cyc, fh):
    return (f'{BASE}?dir=%2Fgfs.{day}%2F{cyc:02d}%2Fatmos&file=gfs.t{cyc:02d}z.pgrb2.1p00.f{fh:03d}'
            '&var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on')

def sm(v, bits):  # sign-magnitude 整數
    return -(v & ((1 << (bits - 1)) - 1)) if v >> (bits - 1) else v

class Bits:
    def __init__(self, b, pos=0): self.b = b; self.p = pos * 8
    def read(self, n):
        if n == 0: return 0
        s = self.p >> 3; e = (self.p + n + 7) >> 3
        v = int.from_bytes(self.b[s:e], 'big'); v >>= (e - s) * 8 - (self.p - s * 8) - n
        self.p += n; return v & ((1 << n) - 1)
    def align(self): self.p = (self.p + 7) & ~7

def decode_53(s5, s7):
    """GRIB2 template 5.3：complex packing＋空間差分（GFS 的 pgrb2 用這種）。回傳浮點數列表。"""
    npts = struct.unpack('>I', s5[5:9])[0]
    R = struct.unpack('>f', s5[11:15])[0]
    E = sm(struct.unpack('>H', s5[15:17])[0], 16); D = sm(struct.unpack('>H', s5[17:19])[0], 16)
    nbits = s5[19]; miss = s5[22]
    NG = struct.unpack('>I', s5[31:35])[0]; refW = s5[35]; bitsW = s5[36]
    refL = struct.unpack('>I', s5[37:41])[0]; incL = s5[41]; lastL = struct.unpack('>I', s5[42:46])[0]; bitsL = s5[46]
    order = s5[47]; nd = s5[48]
    if miss != 0: raise ValueError('不支援有缺值的 GRIB')
    br = Bits(s7, 5)
    h = [sm(br.read(nd * 8), nd * 8) for _ in range(order)]
    gmin = sm(br.read(nd * 8), nd * 8)
    gref = [br.read(nbits) for _ in range(NG)]; br.align()
    gw = [refW + br.read(bitsW) for _ in range(NG)]; br.align()
    gl = [refL + incL * br.read(bitsL) for _ in range(NG)]; br.align()
    gl[-1] = lastL
    X = []
    for r, w, n in zip(gref, gw, gl):
        if w == 0: X.extend([r] * n)
        else: X.extend(r + br.read(w) for _ in range(n))
    X = X[:npts]
    # 空間差分還原
    if order == 1:
        X[0] = h[0]
        for i in range(1, npts): X[i] += gmin + X[i - 1]
    elif order == 2:
        X[0], X[1] = h[0], h[1]
        for i in range(2, npts): X[i] += gmin + 2 * X[i - 1] - X[i - 2]
    k2 = 2.0 ** E; k10 = 10.0 ** -D
    return [(R + x * k2) * k10 for x in X]

def parse_grib(b):
    """回傳 {('u'|'v'): (ni, nj, lat1, lon1, dlat, dlon, values)}"""
    out = {}; o = 0
    while o < len(b):
        if b[o:o + 4] != b'GRIB': raise ValueError('不是 GRIB2 檔')
        tot = struct.unpack('>Q', b[o + 8:o + 16])[0]; p = o + 16; grid = s5 = None; num = None
        while p < o + tot - 4:
            L = struct.unpack('>I', b[p:p + 4])[0]; sec = b[p + 4]; S = b[p:p + L]
            if sec == 3:
                if struct.unpack('>H', S[12:14])[0] != 0: raise ValueError('只支援經緯度網格')
                ni, nj = struct.unpack('>II', S[30:38])
                lat1 = sm(struct.unpack('>I', S[46:50])[0], 32) / 1e6; lon1 = struct.unpack('>I', S[50:54])[0] / 1e6
                lat2 = sm(struct.unpack('>I', S[55:59])[0], 32) / 1e6; lon2 = struct.unpack('>I', S[59:63])[0] / 1e6
                grid = (ni, nj, lat1, lon1, (lat2 - lat1) / (nj - 1), (lon2 - lon1) / (ni - 1))
            elif sec == 4: num = S[10]
            elif sec == 5:
                if struct.unpack('>H', S[9:11])[0] != 3: raise ValueError('只支援 template 5.3')
                s5 = S
            elif sec == 7:
                out['u' if num == 2 else 'v'] = grid + (decode_53(s5, S),)
            p += L
        o += tot
    return out

def latest_run():
    now = datetime.now(timezone.utc)
    for back in range(0, 36, 6):
        t = now - timedelta(hours=back + 4)   # 預報約在整點後 3.5–4 小時才出齊
        cyc = t.hour // 6 * 6; day = t.strftime('%Y%m%d')
        try:
            b = fetch(grib_url(day, cyc, 24), tries=1)
            if b[:4] == b'GRIB': return day, cyc
        except Exception:
            pass
    raise SystemExit('找不到可用的 GFS 預報')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', default='0,6,12,18,24')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    hours = [int(x) for x in a.hours.split(',')]
    day, cyc = latest_run()
    run = datetime.strptime(day, '%Y%m%d').replace(tzinfo=timezone.utc) + timedelta(hours=cyc)
    print(f'GFS {day} {cyc:02d}Z，預報時數 {hours}')
    times, planes, grid = [], [], None
    for fh in hours:
        g = parse_grib(fetch(grib_url(day, cyc, fh)))
        ni, nj, lat1, lon1, dlat, dlon, u = g['u']; v = g['v'][6]
        grid = (ni, nj, lat1, lon1, dlat, dlon)
        def q(arr):  # 量化成 int8，再沿經度方向做差分
            out = bytearray(len(arr))
            for j in range(nj):
                prev = 0
                for i in range(ni):
                    k = j * ni + i; x = max(-127, min(127, round(arr[k] / SCALE))); out[k] = (x - prev) & 0xFF; prev = x
            return bytes(out)
        planes.append(q(u) + q(v)); times.append(int((run + timedelta(hours=fh)).timestamp()))
        print(f'  f{fh:03d}：最大風速 {max((uu * uu + vv * vv) ** 0.5 for uu, vv in zip(u, v)):.1f} m/s')
    ni, nj, lat1, lon1, dlat, dlon = grid
    head = b'WND1' + struct.pack('<IHHHHfffff', 2, ni, nj, len(times), 0, lat1, lon1, dlat, dlon, SCALE)
    head += struct.pack(f'<{len(times)}I', *times)
    (ROOT / 'data' / 'wind.bin.gz').write_bytes(gzip.compress(head + b''.join(planes), 9, mtime=0))
    meta = {'source': 'NOAA NCEP GFS 1°（10 公尺高風場預報，公有領域）', 'run': run.isoformat().replace('+00:00', 'Z'),
            'hours': hours, 'built': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')}
    (ROOT / 'data' / 'wind-meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'完成 → data/wind.bin.gz（{(ROOT / "data" / "wind.bin.gz").stat().st_size / 1e3:.0f} KB）')

if __name__ == '__main__':
    main()
