"""產生多國語言字典 assets/i18n/<語言>.js（簡體中文、英文、日文、韓文；繁體中文是原文，不需要字典）。

用法：
    pip install opencc-python-reimplemented pyshp
    python tools/build_i18n.py            # 產生字典，列出還沒翻譯的句子
    python tools/build_i18n.py --keys     # 只把所有要翻譯的原文寫到 tools/i18n/_keys.json（給翻譯用）

要翻譯的原文從這些地方自動抓：
    index.html       跟 assets/i18n.js 的 trDom() 同一套規則（只含粗體、連結等的區塊整段，其餘一段一段文字，加上 title 等屬性）
    assets/*.js      程式裡所有含中文的字串（tr('…') 裡的、陣列裡的）
    data/farms.json  風場名稱、地點、說明、機型
    台灣縣市名、音樂區名稱、語音名稱、颱風等級
翻譯放在 tools/i18n/<語言>.json（{原文: 翻譯}）；簡體中文全部由 OpenCC 自動轉換。
音樂區名稱（Natural Earth 行政區）直接用 Natural Earth 裡的英、日、韓文名稱，不必翻譯。
"""
import argparse, html, json, re, sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGS = ['zh-Hans', 'en', 'ja', 'ko']
CJK = re.compile(r'[㐀-鿿]')
norm = lambda s: re.sub(r'\s+', ' ', s).strip()

# ---------- index.html：模仿 assets/i18n.js 的 walk() ----------
INL = {'a', 'b', 'kbd', 'sub', 'sup', 'br', 'i', 'em', 'strong'}
VOID = {'br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'wbr'}
ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'content']

class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.kids = tag, attrs, parent, []

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.root = Node('#root', [], None); self.cur = self.root
    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.cur); self.cur.kids.append(n)
        if tag not in VOID: self.cur = n
    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, attrs, self.cur))
    def handle_endtag(self, tag):
        c = self.cur
        while c is not self.root and c.tag != tag: c = c.parent
        if c is not self.root: self.cur = c.parent
    def handle_data(self, d):
        self.cur.kids.append(d)

def esc_text(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\xa0', '&nbsp;')
def esc_attr(s): return s.replace('&', '&amp;').replace('"', '&quot;').replace('\xa0', '&nbsp;')
def outer(n):
    if isinstance(n, str): return esc_text(n)
    a = ''.join(f' {k}' if v is None else f' {k}="{esc_attr(v)}"' for k, v in n.attrs)
    if n.tag in VOID: return f'<{n.tag}{a}>'
    return f'<{n.tag}{a}>' + ''.join(outer(k) for k in n.kids) + f'</{n.tag}>'
def text(n): return n if isinstance(n, str) else ''.join(text(k) for k in n.kids)

def html_keys():
    t = Tree(); t.feed((ROOT / 'index.html').read_text(encoding='utf-8')); keys = []
    def walk(n):
        if isinstance(n, str):
            s = norm(n)
            if s and CJK.search(s): keys.append(s)
            return
        if n.tag in ('script', 'style'): return
        for k, v in n.attrs:
            if k in ATTRS and v and CJK.search(v) and (k != 'content' or n.tag == 'meta'): keys.append(norm(v))
        els = [k for k in n.kids if not isinstance(k, str)]
        if els and all(k.tag in INL for k in els) and CJK.search(text(n)):
            keys.append(norm(''.join(outer(k) for k in n.kids))); return
        for k in n.kids: walk(k)
    walk(t.root)
    return keys

# ---------- 程式裡的中文字串 ----------
SKIP_LINE = re.compile(r'console\.|const XK=|const YK=|const WK=|const CN_NUM=|const cnNum=')
def js_keys():
    keys = []
    for f in ['assets/app.js', 'assets/game3d.js', 'assets/blocks.js']:
        for line in (ROOT / f).read_text(encoding='utf-8').splitlines():
            st = line.strip()
            if st.startswith(('//', '/*', '*')) or SKIP_LINE.search(line): continue
            code = re.sub(r'//[^\'"`]*$', '', line)
            for m in re.finditer(r"'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`", code):
                s = m.group(1) if m.group(1) is not None else m.group(2)
                if s is None or not CJK.search(s) or '${' in s: continue
                keys.append(s.replace("\\'", "'"))
    return keys

def strip_paren(n): return re.sub(r'（.*?）', '', n, count=1)

def data_keys():
    keys, farms = [], json.loads((ROOT / 'data' / 'farms.json').read_text(encoding='utf-8'))['farms']
    for f in farms:
        keys += [f['n'], strip_paren(f['n']), f['c']] + f['c'].split('・')
        if f.get('note'): keys.append(f['note'])
        if f.get('layout', {}).get('unit') and CJK.search(f['layout']['unit']): keys.append(f['layout']['unit'])
    keys += counties()
    for v in json.loads((ROOT / 'data' / 'voices.json').read_text(encoding='utf-8'))['voices']:
        if CJK.search(v['name']): keys.append(v['name'])
        if CJK.search(v.get('desc', '')): keys.append(v['desc'])
    keys += [lv + k for lv in ['輕度', '中度', '強烈'] for k in ['颱風', '颶風', '氣旋']]
    return keys

def counties():
    d = json.loads((ROOT / 'data' / 'taiwan-counties.json').read_text(encoding='utf-8'))
    return [g['properties']['COUNTYNAME'] for g in d['objects']['counties']['geometries']]

def all_keys():
    seen = {}
    for k in html_keys() + js_keys() + data_keys():
        if k and CJK.search(k): seen.setdefault(k, None)
    return list(seen)

# ---------- 音樂區名稱：Natural Earth 自帶各語言名稱 ----------
def zone_names(names):
    out = {l: {} for l in LANGS}
    try:
        import shapefile
        shp = ROOT / 'WindGlobe_data' / 'ne_admin1' / 'ne_10m_admin_1_states_provinces.shp'
        for r in shapefile.Reader(str(shp), encoding='utf-8').iterRecords():
            d = r.as_dict(); zh = d.get('name_zht') or d.get('name_zh') or d.get('name') or ''
            if zh not in names: continue
            for l, k in [('en', 'name_en'), ('ja', 'name_ja'), ('ko', 'name_ko')]:
                v = d.get(k) or d.get('name_en') or d.get('name')
                if v: out[l].setdefault(zh, v)
            if d.get('name_zh'): out['zh-Hans'].setdefault(zh, d['name_zh'])
    except Exception as e:
        print('（讀不到 Natural Earth 行政區，音樂區名稱沿用上次的字典）', e)
        return None
    return out

# 檢查翻譯：每句都有、{變數} 一樣、HTML 標籤一樣
def check(lang, keys):
    T = json.loads((ROOT / 'tools' / 'i18n' / f'{lang}.json').read_text(encoding='utf-8'))
    tags = lambda s: re.findall(r'</?\w+[^>]*>', s)
    bad = 0
    for k in keys:
        if k not in T:
            print('缺：', k[:80]); bad += 1; continue
        v = T[k]
        if sorted(re.findall(r'\{\w+\}', k)) != sorted(re.findall(r'\{\w+\}', v)): print('變數不同：', k[:60], '→', v[:60]); bad += 1
        if tags(k) != tags(v): print('標籤不同：', k[:60]); bad += 1
    extra = [k for k in T if k not in keys and not k.startswith('_')]
    print(f'{lang}：{len(keys)} 句，問題 {bad} 個，多出來的 {len(extra)} 個')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--keys', action='store_true'); ap.add_argument('--check', metavar='語言')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    keys = all_keys()
    if a.check: return check(a.check, keys)
    tdir = ROOT / 'tools' / 'i18n'; tdir.mkdir(exist_ok=True)
    (tdir / '_keys.json').write_text(json.dumps(keys, ensure_ascii=False, indent=0), encoding='utf-8')
    print(f'要翻譯的原文：{len(keys)} 句（tools/i18n/_keys.json）')
    if a.keys: return
    zn = json.loads((ROOT / 'data' / 'music-zones.json').read_text(encoding='utf-8'))['names']
    zn = [n for n in zn if CJK.search(n)]
    zones = zone_names(set(zn))
    farms = json.loads((ROOT / 'data' / 'farms.json').read_text(encoding='utf-8'))['farms']
    cty = json.loads((ROOT / 'data' / 'taiwan-counties.json').read_text(encoding='utf-8'))
    cty_en = {g['properties']['COUNTYNAME']: g['properties']['COUNTYENG'] for g in cty['objects']['counties']['geometries']}
    from opencc import OpenCC
    t2s = OpenCC('tw2s')  # 只換字形，不換用語（tw2sp 會把「模擬」換成「仿真」）
    out_dir = ROOT / 'assets' / 'i18n'; out_dir.mkdir(exist_ok=True)
    for lang in LANGS:
        D = {}
        if lang == 'zh-Hans':
            for k in keys + zn: D[k] = t2s.convert(k)
        else:
            src = tdir / f'{lang}.json'
            T = json.loads(src.read_text(encoding='utf-8')) if src.exists() else {}
            if lang == 'en':   # 英文風場名稱、縣市名直接用資料裡的英文
                for f in farms: D[f['n']] = D[strip_paren(f['n'])] = f['e']
                D.update(cty_en)
            D.update({k: v for k, v in T.items() if not k.startswith('_')})
            D.setdefault('，', {'en': ', ', 'ja': '、', 'ko': ', '}[lang])   # 串接名稱用的逗號（全形符號，不會被當成中文抓到）
            miss = [k for k in keys if k not in D]
            if miss:
                print(f'{lang}：還有 {len(miss)} 句沒翻譯（網頁會顯示原文），例如：')
                for k in miss[:8]: print('   ', k[:70])
        if zones:
            for k, v in zones[lang].items(): D.setdefault(k, v)
        old = out_dir / f'{lang}.js'
        if not zones and old.exists():   # 沒有 Natural Earth 檔：音樂區名稱沿用舊字典
            prev = json.loads(old.read_text(encoding='utf-8').split('=', 1)[1].rstrip().rstrip(';'))
            for k in zn:
                if k in prev: D.setdefault(k, prev[k])
        D = {k: v for k, v in D.items() if v and v != k}
        old.write_text('/* 由 tools/build_i18n.py 產生，不要直接修改 */\nwindow.I18N_DICT=' +
                       json.dumps(D, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
        print(f'{lang}：{len(D)} 筆 → assets/i18n/{lang}.js')

if __name__ == '__main__':
    main()
