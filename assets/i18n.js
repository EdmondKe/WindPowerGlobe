/* 多國語言：繁體中文是原文，其他語言（简体中文、English、日本語、한국어）查 assets/i18n/<語言>.js 的字典。
 * 語言：先看有沒有手動選過（localStorage windglobe-lang），再看瀏覽器語言，最後看時區（地區）。
 * 字典以繁體中文原文當鍵；句子裡會變的部分寫成 {名稱}，例如 tr('第 {n} 題',{n:3})。
 * 字典由 tools/build_i18n.py 產生（翻譯放在 tools/i18n/<語言>.json，簡體由 OpenCC 自動轉換）。
 * 這個檔要在 <head> 裡同步載入，app.js 開始跑之前字典就要準備好。 */
(function(){
const LANGS=[['zh-Hant','繁體中文'],['zh-Hans','简体中文'],['en','English'],['ja','日本語'],['ko','한국어']];
const ok=l=>LANGS.some(x=>x[0]===l);
function detect(){
  try{ const s=localStorage.getItem('windglobe-lang'); if(ok(s)) return s; }catch(e){}
  let tz=''; try{ tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''; }catch(e){}
  const twTz=/Taipei|Hong_Kong|Macau/.test(tz);
  for(const raw of (navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||''])){
    const l=String(raw).toLowerCase();
    if(l.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(l)?'zh-Hant':/hans|-cn|-sg|-my/.test(l)?'zh-Hans':twTz?'zh-Hant':'zh-Hans';
    if(l.startsWith('ja')) return 'ja';
    if(l.startsWith('ko')) return 'ko';
    if(l.startsWith('en')) return 'en';
  }
  // 瀏覽器語言不是這五種：用時區判斷在哪個地區
  if(twTz) return 'zh-Hant';
  if(/Shanghai|Chongqing|Harbin|Urumqi|Singapore/.test(tz)) return 'zh-Hans';
  if(/Tokyo/.test(tz)) return 'ja';
  if(/Seoul/.test(tz)) return 'ko';
  return 'en';
}
const LANG=detect();
document.documentElement.lang=LANG;
// 字典：同步載入，app.js 執行時就有
if(LANG!=='zh-Hant') document.write(`<script src="assets/i18n/${LANG}.js?v=20261028v"><\/script>`);

const CJK=/[㐀-鿿]/;
const REV=new Map(); // 翻譯後的句子 → 原文（中文語音檔用原文找）
function fill(s,v){ return v?s.replace(/\{(\w+)\}/g,(m,k)=>k in v?v[k]:m):s; }
// 英文標籤開頭大寫（靜態 HTML 用；tr() 不改，語音檔的句子才會跟 tools/build_voice.py 一致）
const cap=s=>LANG==='en'&&/^[a-z]/.test(s)?s[0].toUpperCase()+s.slice(1):s;
// 翻譯一句；找不到就用原文
function tr(s,v){
  const D=window.I18N_DICT; let o=D&&D[s]; if(o==null) o=s;
  const out=fill(o,v);
  if(LANG!=='zh-Hant'&&out!==s){ const src=fill(s,v); REV.set(out,src); if(REV.size>400) REV.delete(REV.keys().next().value); }
  return out;
}
// 名稱（風場、國家、縣市、地區）：字典裡有就換，沒有就用原文
function trName(s){ const D=window.I18N_DICT; return (D&&s&&D[s])||s; }

// 靜態 HTML：只含粗體、連結、鍵盤鍵、換行等的區塊整段翻（保留裡面的標籤），其他的一段一段文字翻
const INL=new Set(['A','B','KBD','SUB','SUP','BR','I','EM','STRONG']);
const ATTRS=['title','aria-label','placeholder','alt','content'];
const norm=s=>s.replace(/\s+/g,' ').trim();
function walk(e,f){
  if(e.nodeType===3){ const s=norm(e.nodeValue); if(s&&CJK.test(s)) f.text(e,s); return; }
  if(e.nodeType!==1||e.tagName==='SCRIPT'||e.tagName==='STYLE') return;
  for(const a of ATTRS){ const v=e.getAttribute(a); if(v&&CJK.test(v)&&(a!=='content'||e.tagName==='META')) f.attr(e,a,norm(v)); }
  const kids=[...e.children];
  if(kids.length&&kids.every(c=>INL.has(c.tagName))&&CJK.test(e.textContent)){ if(f.block(e,norm(e.innerHTML))) return; }
  for(const c of [...e.childNodes]) walk(c,f);
}
function trDom(root){
  const D=window.I18N_DICT; if(!D) return;
  walk(root||document.documentElement,{
    text(n,s){ const o=D[s]; if(o!=null) n.nodeValue=n.nodeValue.replace(/\S[\s\S]*\S|\S/,cap(o)); },
    attr(e,a,s){ const o=D[s]; if(o!=null) e.setAttribute(a,o); },
    block(e,k){ const o=D[k]; if(o==null) return false; e.innerHTML=o; return true; }
  });
}
// 開發用：列出畫面上所有要翻譯的字（tools/build_i18n.py 用同一套規則從 index.html 抓，這個用來對照）
function collect(root){ const S=new Set(); walk(root||document.documentElement,{text:(n,s)=>S.add(s),attr:(e,a,s)=>S.add(s),block:(e,k)=>{ S.add(k); return true; }}); return [...S]; }

// 地圖上的地名：用這個語言的名字，沒有就用當地的名字
function nameExpr(){
  const zh=['let','z',['get','name:zh'],['case',
    ['>=',['index-of',';',['var','z']],0],['slice',['var','z'],LANG==='zh-Hans'?0:['+',['index-of',';',['var','z']],1],...(LANG==='zh-Hans'?[['index-of',';',['var','z']]]:[])],
    ['>=',['index-of','/',['var','z']],0],LANG==='zh-Hans'?['slice',['var','z'],['+',['index-of','/',['var','z']],1]]:['slice',['var','z'],0,['index-of','/',['var','z']]],
    ['var','z']]];
  if(LANG==='zh-Hant') return ['coalesce',['get','name:zh-Hant'],['case',['has','name:zh'],zh,['get','name']]];
  if(LANG==='zh-Hans') return ['coalesce',['get','name:zh-Hans'],['case',['has','name:zh'],zh,['get','name']]];
  return ['coalesce',['get','name:'+LANG],LANG==='en'?['get','name_en']:['get','name:en'],['get','name']];
}
function setLang(l){ if(!ok(l)) return; try{ localStorage.setItem('windglobe-lang',l); }catch(e){} location.reload(); }
// 國家、地區名稱：用瀏覽器內建的翻譯（兩碼國碼）
let DN=null; try{ DN=new Intl.DisplayNames([LANG==='zh-Hant'?'zh-Hant-TW':LANG==='zh-Hans'?'zh-Hans-CN':LANG],{type:'region'}); }catch(e){}
const regionName=(a2,fb)=>{ try{ return (a2&&DN&&DN.of(a2))||fb; }catch(e){ return fb; } };

window.I18N={LANG,LANGS,tr,trName,trDom,collect,nameExpr,setLang,regionName,REV,
  zh:LANG==='zh-Hant'||LANG==='zh-Hans', // 中文介面：唸數字用「一、二、三」，語音用中文錄音
  locale:{'zh-Hant':'zh-TW','zh-Hans':'zh-CN',en:'en-US',ja:'ja-JP',ko:'ko-KR'}[LANG]};
window.tr=tr; window.trName=trName;
// 靜態 HTML 由 index.html 在載入 app.js 前呼叫 I18N.trDom() 翻譯
})();
