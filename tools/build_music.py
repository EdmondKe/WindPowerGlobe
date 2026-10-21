"""掃描 Music/ 資料夾，產生網頁用的歌單 data/music.json。

用法（在專案根目錄執行）：
    python tools/build_music.py

新增或刪除 mp3 後重跑一次就好。台灣區域固定播放的曲目寫在下面的 TAIWAN，
如果 data/music.json 已經有 taiwan 清單，會沿用那份。
"""
import json
from pathlib import Path

TAIWAN = ['00001.mp3', '00005.mp3', '00020.mp3', '00027.mp3', '00030.mp3', '00031.mp3']
EXT = {'.mp3', '.m4a', '.ogg', '.opus', '.wav'}

root = Path(__file__).resolve().parent.parent
out = root / 'data' / 'music.json'
files = sorted(p.name for p in (root / 'Music').iterdir() if p.suffix.lower() in EXT)
taiwan = TAIWAN
if out.exists():
    taiwan = json.loads(out.read_text(encoding='utf-8')).get('taiwan', TAIWAN)
missing = [t for t in taiwan if t not in files]
if missing:
    print('注意：台灣清單裡有找不到的檔案：', missing)
data = {'_note': '背景音樂歌單。地圖中心在台灣一帶時依序輪播 taiwan，其他地方從其餘曲目隨機播放。由 tools/build_music.py 產生。',
        'dir': 'Music/', 'taiwan': [t for t in taiwan if t in files], 'files': files}
out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'共 {len(files)} 首，台灣 {len(data["taiwan"])} 首 → {out.relative_to(root)}')
