"""把網站會唸的每一句話，用微軟線上神經語音（Edge「大聲朗讀」用的同一套）錄成 mp3，存在 voice/<聲音代號>/。

用法：
    pip install edge-tts
    python tools/build_voice.py              # 錄 data/voices.json 裡的所有聲音（已經錄過的會跳過）
    python tools/build_voice.py --list       # 只列出所有句子

聲音清單在 data/voices.json；句子由下面的 lines() 依網站的程式組出來（風場名稱、找找看的國家、連連看的數字字母、3D 任務），
要跟 assets/app.js、assets/game3d.js 裡 say() 唸的字一模一樣，網站才找得到檔案；找不到的句子網站會改用裝置內建語音。
檔名是句子的 FNV-1a 雜湊（UTF-16），跟 assets/app.js 的 textKey() 相同。
voice/ 由 GitHub Actions 在發布前產生（有快取，只補錄新句子），不放進 git。
"""
import argparse, asyncio, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def text_key(s):
    h = 0x811c9dc5
    b = s.encode('utf-16-le')
    for i in range(0, len(b), 2):
        h ^= b[i] | b[i + 1] << 8
        h = (h * 0x01000193) & 0xffffffff
    return f'{h:08x}'

def strip_paren(n):
    return re.sub(r'（.*?）', '', n, count=1)

def lines():
    app = (ROOT / 'assets' / 'app.js').read_text(encoding='utf-8')
    g3d = (ROOT / 'assets' / 'game3d.js').read_text(encoding='utf-8')
    farms = json.loads((ROOT / 'data' / 'farms.json').read_text(encoding='utf-8'))['farms']
    places = re.findall(r"\[\d+,'([^']+)'\]", re.search(r'const GT=\[(.*?)\];', app).group(1))
    L = ['你好，我是風車地球的小幫手！一起來看風車吧！']
    # 貼紙簿
    L += [f'得到新貼紙，{strip_paren(f["n"])}' for f in farms]
    # 找找看
    for p in places:
        L.append(f'找找看，{p}在哪裡？')
        fs = [f for f in farms if f['c'].startswith(p)]
        L.append(f'答對了！{p}有「{strip_paren(fs[0]["n"])}」{f"等 {len(fs)} 座風場" if len(fs) > 1 else ""}。' if fs else f'答對了！這裡是{p}。')
        L.append(f'{p}在這裡！我們一起看看。')
    L += [f'完成了！你找到了 {n} 個地方，好厲害！' for n in range(9)]
    L += [f'不是這裡喔，再往{d}邊找找' for d in ['北', '東北', '東', '東南', '南', '西南', '西', '西北']]
    # 打卡（地名、距離每次不同，唸的是通用的說法）
    L += ['你附近 2 公里內沒有風車，走近一點再打卡！', '你附近沒有風車資料，到有風車的地方再打卡吧！', '打卡成功！這裡的風車全部變成七彩版了！']
    # 風車點點樂（最多 10 個點）
    num = '一二三四五六七八九十'
    L += ['連連看，從 A 開始，照順序點風車！', '連連看，從一開始，照順序點風車！']
    for i in range(10):
        a = chr(65 + i)
        L += [a, num[i], f'不是這個喔，找找「{a}」在哪裡', f'不是這個喔，找找「{num[i]}」在哪裡']
    for n in range(5, 11):
        L += [f'太棒了！A 到 {chr(64 + n)} 全部連起來了！', f'太棒了！一到{num[n - 1]}全部連起來了！']
    # 3D 風場任務
    storms = list(dict.fromkeys(re.findall(r"storm:'([^']+)'", g3d)))
    mis = re.findall(r"\{t:'([^']*)',d:'([^']*)'\}", g3d)
    tpl3 = re.search(r'const d=i===2\?`\$\{G\.B\.storm\}(.*?)`:M\.d;', g3d).group(1)
    clean = lambda s: re.sub('[「」\U0001F6E1◀▶]', '', s)
    for i, (t, d) in enumerate(mis[:2]):
        L.append(f'任務{i + 1}，{t}。{clean(d)}')
    for s in storms:
        L.append(f'任務3，{s}來襲。{clean(s + tpl3)}')
        L.append(f'{s}過去了，風機平安無事！')
    L += ['全村的燈都亮了！', '風向對準了，電一直送出去！', '三個任務都完成了，你是風之小勇者！', '風機受損了，再試一次！']
    return list(dict.fromkeys(L))

async def record(voices, L, conc=6):
    import edge_tts
    sem = asyncio.Semaphore(conc); done = fail = 0
    async def one(v, text, path):
        nonlocal done, fail
        async with sem:
            for k in range(3):
                try:
                    tmp = path.with_suffix('.part')
                    await edge_tts.Communicate(text, v['edge'], rate=v.get('rate', '+0%'), pitch=v.get('pitch', '+0Hz')).save(str(tmp))
                    tmp.replace(path); done += 1; return
                except Exception as e:
                    err = e; await asyncio.sleep(2 + 3 * k)
            fail += 1; print(f'  失敗：{v["id"]}「{text}」（{err}）')
    jobs = []
    for v in voices:
        d = ROOT / 'voice' / v['id']; d.mkdir(parents=True, exist_ok=True)
        want = {text_key(t) + '.mp3' for t in L}
        for f in d.glob('*.mp3'):
            if f.name not in want: f.unlink()   # 刪掉已經不用的句子
        jobs += [one(v, t, d / (text_key(t) + '.mp3')) for t in L if not (d / (text_key(t) + '.mp3')).exists()]
    print(f'{len(voices)} 個聲音 × {len(L)} 句，要新錄 {len(jobs)} 個檔')
    await asyncio.gather(*jobs)
    print(f'完成：新錄 {done} 個，失敗 {fail} 個')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    L = lines()
    if a.list:
        for t in L: print(text_key(t), t)
        print(len(L), '句'); return
    voices = json.loads((ROOT / 'data' / 'voices.json').read_text(encoding='utf-8'))['voices']
    asyncio.run(record(voices, L))

if __name__ == '__main__':
    main()
