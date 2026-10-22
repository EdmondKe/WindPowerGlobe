"""從 GDACS（聯合國與歐盟的全球災害警報系統）下載全球正在活動的熱帶氣旋（颱風、颶風、氣旋），存成 data/typhoons.json。

用法：
    python tools/build_typhoons.py

不需要任何套件。每個熱帶氣旋取最近一報的路徑：過去的實測位置（obs=true）＋未來約 5 天的預報。
GDACS 的風速來自美國聯合颱風警報中心 JTWC／美國颶風中心 NHC，是「1 分鐘平均風」；
中央氣象署的颱風分級用「10 分鐘平均風」，所以這裡乘上 0.88 換算（世界氣象組織建議的海上換算係數），
網站再依中央氣象署的標準分成熱帶性低氣壓、輕度、中度、強烈颱風。

中文名稱：西北太平洋的颱風名稱寫在 data/typhoon-names.json（英文 → 中文），沒有的就顯示英文名。
"""
import json, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH'
GEO = 'https://www.gdacs.org/datareport/resources/TC/{eid}/geojson_{eid}_{ep}.geojson'
TEN_MIN = 0.88          # 1 分鐘平均風 → 10 分鐘平均風
KEEP_PAST = timedelta(days=3)   # 過去路徑只留 3 天，線才不會拉得太長
STALE = timedelta(hours=36)     # 最近一報超過這麼久就當作已經消散

def fetch(url, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'WindGlobe/1.0 (kids wind map)'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            err = e; time.sleep(3 + 5 * k)
    raise err

def kind(lon, lat):
    """依海域決定叫法：西北太平洋叫颱風，大西洋與東太平洋叫颶風，其他叫氣旋。"""
    lon = (lon + 180) % 360 - 180
    if lat >= 0 and (lon >= 100 or lon <= -180 + 0.01): return '颱風'
    if lat >= 0 and (lon < -20 and lon > -180): return '颶風'
    return '氣旋'

def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    now = datetime.now(timezone.utc)
    names = {}
    try: names = json.loads((ROOT / 'data' / 'typhoon-names.json').read_text(encoding='utf-8'))
    except FileNotFoundError: pass
    url = (f'{API}?eventlist=TC&fromdate={(now - timedelta(days=20)):%Y-%m-%d}'
           f'&todate={(now + timedelta(days=1)):%Y-%m-%d}&alertlevel=green;orange;red')
    events = json.loads(fetch(url)).get('features', [])
    storms = []
    for ev in events:
        p = ev['properties']
        last = datetime.fromisoformat(p['todate']).replace(tzinfo=timezone.utc)
        if now - last > STALE: continue
        try:
            gj = json.loads(fetch(GEO.format(eid=p['eventid'], ep=p['episodeid'])))
        except Exception as e:
            print(f'  {p.get("name")}：讀不到路徑（{e}），略過'); continue
        track = []
        for f in gj.get('features', []):
            q = f['properties']
            if f['geometry']['type'] != 'Point' or not q.get('trackdate'): continue
            t = datetime.strptime(q['trackdate'], '%d/%m/%Y %H:%M:%S').replace(tzinfo=timezone.utc)
            if t < last - KEEP_PAST: continue
            lon, lat = f['geometry']['coordinates'][:2]
            track.append({'t': t.isoformat().replace('+00:00', 'Z'), 'lat': round(lat, 2), 'lon': round(lon, 2),
                          'v': round(float(q['windspeed']) / 3.6 * TEN_MIN, 1),
                          **({'obs': True} if q.get('polygonlabel') == 'previous position' else {})})
        track.sort(key=lambda a: a['t'])
        if len(track) < 2: continue
        en = gj['metadata'].get('eventname', p.get('name', '')).rsplit('-', 1)[0].upper()
        k = kind(track[-1]['lon'], track[-1]['lat'])
        zh = names.get(en)
        storms.append({'name': f'{zh}{k}' if zh else f'{k} {en.title()}', 'en': en, 'kind': k,
                       'source': gj['metadata'].get('source', ''), 'track': track})
        cur = max((a for a in track if a.get('obs')), key=lambda a: a['t'], default=track[0])
        print(f'  {storms[-1]["name"]}（{en}）：{len(track)} 點，最新 {cur["t"]} 近中心 {cur["v"]} m/s')
    out = {'_note': '全球正在活動的熱帶氣旋。obs=true 為實測位置，其餘為預報；v 為近中心最大風速（m/s，已換算成 10 分鐘平均風）。由 tools/build_typhoons.py 自動產生。',
           'updated': now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
           'source': 'GDACS（聯合國／歐盟全球災害警報系統），路徑來自 JTWC／NHC',
           'storms': storms}
    (ROOT / 'data' / 'typhoons.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(f'完成 → data/typhoons.json（{len(storms)} 個熱帶氣旋）')

if __name__ == '__main__':
    main()
