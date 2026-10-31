(async () => {
'use strict';
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const $ = s => document.querySelector(s);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd = mulberry32(20261021);

const S = {simT:Date.now(), playing:true, speeds:[1,10,60,300,1800,3600], speedIdx:2, mode:'3d', tilt:true,
  wind:true, night:true, labels:true, big:true, sel:null, tour:false, tourIdx:0, tourNext:0, zen:false, sound:false};
const SPD_LBL = ['1×','10×','60×','300×',tr('30 分/秒'),tr('1 時/秒')];

/* ---------- 底圖（MapLibre + OpenFreeMap） ---------- */
const STYLE_URL={light:'https://tiles.openfreemap.org/styles/liberty',dark:'https://tiles.openfreemap.org/styles/fiord'};
const DEM_TILES=['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'];
const THEMES=['auto','dark','light'], THEME_LBL={auto:tr('自動'),dark:tr('深色'),light:tr('淺色')};
// 台灣範圍可疊上內政部國土測繪中心的 WMTS 圖磚（政府資料開放授權條款－第 1 版），其他地方照樣用 OpenFreeMap
const NLSC={emap:{layer:'EMAP',fmt:'jpeg',name:tr('臺灣通用電子地圖')},photo:{layer:'PHOTO2',fmt:'jpeg',name:tr('正射影像')}};
// 地圖風格：auto＝跟著畫面亮暗（明／暗）、sat＝衛星（全世界 Sentinel-2，台灣換成內政部正射影像）、land＝地景（森林、農田、草地上色＋咖啡色 3D 建築）
// 衛星搭深色畫面、地景搭淺色畫面，地圖上的風線、風車顏色才看得清楚
const S2_TILES=['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg'];
let mapStyle='auto'; try{ const m=localStorage.getItem('windglobe-mapstyle'); if(['auto','sat','land'].includes(m)) mapStyle=m; }catch(e){}
let twEmap=false; try{ twEmap=localStorage.getItem('windglobe-base')==='emap'; }catch(e){}
S.bld=true; try{ if(localStorage.getItem('windglobe-bld')==='0') S.bld=false; }catch(e){}
let theme='auto'; try{theme=localStorage.getItem('windglobe-theme')||'auto';}catch(e){}
const darkMQ=matchMedia('(prefers-color-scheme: dark)');
const effTheme=()=>mapStyle==='sat'?'dark':mapStyle==='land'?'light':theme;
const isDark=()=>effTheme()==='dark'||(effTheme()==='auto'&&darkMQ.matches);
let styleKey=isDark()?'dark':'light';
/* ---------- 語言選單（標題右邊）：換語言會重新載入網頁 ---------- */
{ const sel=document.getElementById('langSel');
  for(const [k,n] of I18N.LANGS){ const o=document.createElement('option'); o.value=k; o.textContent=n; if(k===I18N.LANG) o.selected=true; sel.append(o); }
  sel.onchange=()=>I18N.setLang(sel.value); }
/* ---------- 畫質：依每秒畫面張數自動調高調低（觀看設定裡也可以固定成高、中、低） ---------- */
// 等級 2 高、1 中、0 低：影響地圖解析度、風線數量、3D 的解析度與房子樹木數量
const QUAL={mode:'auto',lvl:2,acc:0,n:0,good:0,fps:0,fail:[0,0,0]};
try{ const m=localStorage.getItem('windglobe-quality'); if(m==='0'||m==='1'||m==='2') QUAL.mode=m; }catch(e){}
// 第一次先猜：處理器核心少或記憶體小的裝置先用中畫質，之後再看實際順不順
QUAL.lvl=QUAL.mode!=='auto'?+QUAL.mode:((navigator.hardwareConcurrency||8)<=4||(navigator.deviceMemory||8)<=4)?1:2;
const qPR=()=>Math.min(window.devicePixelRatio||1,[1,1.5,2][QUAL.lvl]);
const map=new maplibregl.Map({
  container:'gl', pixelRatio:qPR(), style:STYLE_URL[styleKey], center:[121,23.5], zoom:1.3, minZoom:0, maxZoom:17.5, maxPitch:60,
  keyboard:false, attributionControl:false, fadeDuration:150,
  localIdeographFontFamily:{ja:'"Hiragino Sans","Yu Gothic","Meiryo",sans-serif',ko:'"Apple SD Gothic Neo","Malgun Gothic",sans-serif','zh-Hans':'"PingFang SC","Microsoft YaHei",sans-serif'}[I18N.LANG]||'"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif'
});
map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:tr('風機位置 © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap 貢獻者</a>・<a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>・內政部國土測繪中心・風是程式模擬的')}),'bottom-right');
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-left');
map.addControl(new maplibregl.ScaleControl({maxWidth:120,unit:'metric'}),'bottom-left');
let styleReady=false, appReady=false;
map.on('style.load',()=>{ styleReady=true; if(appReady) onStyle(); });

/* ---------- 載入資料 ---------- */
// 資料檔每次都向伺服器確認有沒有新版（沒變的話伺服器只回「沒變」，很快）
async function getJSON(u,o={cache:'no-cache'}){ const r=await fetch(u,o); if(!r.ok) throw new Error(u+'（'+r.status+'）'); return r.json(); }
async function getTurbines(u,o={cache:'no-cache'}){
  const r=await fetch(u,o); if(!r.ok) throw new Error(u+'（'+r.status+'）');
  let ab=await r.arrayBuffer(); const h=new Uint8Array(ab,0,2);
  if(h[0]===0x1f&&h[1]===0x8b){ // 伺服器沒有自動解壓縮時，用瀏覽器內建的 gzip 解壓
    if(!('DecompressionStream' in window)) throw new Error(tr('瀏覽器版本太舊，無法解開風機資料'));
    ab=await new Response(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return ab;
}
const [FD, TWA, TOPO50, TWTOPO, TYD, WMETA, PLD, WBUF] = await Promise.all([
  getJSON('data/farms.json'), getJSON('data/tw-farm-turbines.json'), getJSON('data/countries-50m.json'),
  getJSON('data/taiwan-counties.json'), getJSON('data/typhoons.json',{cache:'no-cache'}).catch(()=>({storms:[]})),
  getJSON('data/turbines-meta.json').catch(()=>null), getJSON('data/music.json').catch(()=>null), getTurbines('data/turbines.bin.gz').catch(e=>{console.error(e);return e;})
]);

/* ---------- 風場資料（約略值，data/farms.json） ---------- */
// k: on 陸上 / off 離岸 / float 浮動式 ; st: ret 已退役, build 建置中或分期
const FARMS = FD.farms;
// 其他語言：風場名稱、地點、說明換成翻譯；原文留在 n0（音樂區名稱用原文對照），ns 是去掉括號說明的短名稱
FARMS.forEach(f=>{ f.n0=f.n; f.ns=trName(f.n.replace(/（.*?）/,'')); f.n=trName(f.n); f.c=trName(f.c); if(f.note) f.note=trName(f.note); if(f.layout&&f.layout.unit) f.layout.unit=trName(f.layout.unit); });
const TOUR = FD.tour;
FARMS.forEach(f=>{f.ph=rnd()*TAU;f.ang=rnd()*TAU;f.pulse=rnd();f.ws=0;f.frac=0;f.rpm=0;f.px=null;});
const byId = Object.fromEntries(FARMS.map(f=>[f.id,f]));
const kindName = {on:tr('陸上'),off:tr('離岸'),float:tr('浮動式')};
/* 台灣風場：機型、葉輪直徑 D(m)、輪轂高 hh(m, 約略)、間距 sp(km)、排列方位 hd(度, 由北順時針) */
const TWLAY=Object.fromEntries(FARMS.filter(f=>f.layout).map(f=>[f.id,f.layout]));
function buildLayout(f){
  const L=TWLAY[f.id]; if(!L) return;
  Object.assign(f,{unit:L.unit,D:L.D,hh:L.hh,sp:L.sp,hd:L.hd,lon0:f.lon,lat0:f.lat});
  const n=f.t, cols=Math.ceil(Math.sqrt(n*1.6)), rows=Math.ceil(n/cols), h=L.hd*D2R;
  const ax=[Math.sin(h),Math.cos(h)], ay=[Math.cos(h),-Math.sin(h)], cl=Math.cos(f.lat*D2R);
  const tur=[]; let k=0;
  for(let r=0;r<rows&&k<n;r++) for(let c=0;c<cols&&k<n;c++,k++){
    const u=(c-(cols-1)/2+(r%2?0.5:0))*L.sp, v=(r-(rows-1)/2)*L.sp;
    const e=u*ax[0]+v*ay[0], nn=u*ax[1]+v*ay[1];
    tur.push({lon:f.lon+e/(111.32*cl),lat:f.lat+nn/110.574,ang:rnd()*TAU,real:false});
  }
  f.schem=tur; f.tur=tur; f.extKm0=f.extKm=Math.max(cols,rows)*L.sp+1; f.realN=0;
}
FARMS.forEach(buildLayout);
/* ---------- 全球風機（OpenStreetMap，data/turbines.bin.gz） ---------- */
const DCL=[0,50,77,90,130,154,167,174,222];
// 格式說明見 tools/build_turbines.py
function decodeTurbines(ab){
  const dv=new DataView(ab);
  if(dv.getUint32(0,true)!==0x31425457||dv.getUint32(4,true)!==1) throw new Error(tr('風機資料格式不符'));
  const n=dv.getUint32(8,true), nc=dv.getUint32(12,true), na=dv.getUint32(16,true);
  let o=20; const cells=[], agg=[];
  for(let i=0;i<nc;i++,o+=12) cells.push({cx:dv.getInt16(o,true)+0.5,cy:dv.getInt16(o+2,true)+0.5,start:dv.getUint32(o+4,true),n:dv.getUint32(o+8,true),ang:rnd()*TAU,frac:0,rpm:0});
  for(let i=0;i<na;i++,o+=8) agg.push({cx:(dv.getInt16(o,true)+0.5)/5,cy:(dv.getInt16(o+2,true)+0.5)/5,n:dv.getUint32(o+4,true),frac:0});
  const u=new Uint8Array(ab), xy=new Int32Array(2*n);
  for(let k=0;k<2;k++){
    const b=o+k*4*n; let acc=0;
    for(let i=0;i<n;i++){ acc=(acc+(u[b+i]|u[b+n+i]<<8|u[b+2*n+i]<<16|u[b+3*n+i]<<24))|0; xy[2*i+k]=acc; }
  }
  return {n, xy, cl:u.subarray(o+8*n,o+9*n), own:new Uint8Array(n), cells, agg};
}
let WT={n:0,xy:new Int32Array(0),cl:new Uint8Array(0),own:new Uint8Array(0),cells:[],agg:[]}, wtErr=null;
if(WBUF instanceof Error) wtErr=WBUF; else try{ WT=decodeTurbines(WBUF); }catch(e){ wtErr=e; console.error(e); }
const WCELLS=WT.cells, WAGG=WT.agg;
// 已經歸到台灣風場的風機，畫在風場裡，不在全球圖層重複畫
{ const keys=new Set(); for(const arr of Object.values(TWA.farms)) for(const r of arr) keys.add(Math.round(r[0]*1e5)+','+Math.round(r[1]*1e5));
  for(const c of WCELLS){ if(c.cx<117||c.cx>124||c.cy<20||c.cy>27) continue;
    for(let i=c.start;i<c.start+c.n;i++) if(keys.has(WT.xy[2*i]+','+WT.xy[2*i+1])) WT.own[i]=1; } }
let wtLast=0;
function wHue(fr,a){return `hsla(${195-fr*150},95%,${C.dark?62:44}%,${a})`;}
// 畫面範圍（經緯度，含一點邊界）；拉得很遠時為 null，表示不裁切
let BB=null;
function updViewBox(){
  terrZ=Math.max(0,Math.min(12,Math.floor(map.getZoom())));
  BB=null; if(kmPx<0.05) return;
  // map.getBounds() 在地球模式下會回報比實際畫面窄很多的範圍，所以自己在畫面上取 5×5 個點換算經緯度
  const Rkm=2.5*Math.max(W,H)/kmPx, dy=Rkm/110.6, dx=Rkm/(111.3*Math.max(0.05,Math.cos(cLat*D2R)));
  let w=1e9,e=-1e9,s=1e9,n=-1e9,bad=false;
  for(let gy=0;gy<=4;gy++) for(let gx=0;gx<=4;gx++){
    const x=W*gx/4, y=H*gy/4, ll=unprojFlat(x,y), q=ll&&projFlatRaw(ll[0],ll[1]);
    if(!q||Math.abs(q[0]-x)>2||Math.abs(q[1]-y)>2||!vis(ll[0],ll[1])){ bad=true; continue; } // 落在地球外或天空
    const lon=cLon+(((ll[0]-cLon)%360+540)%360-180);
    w=Math.min(w,lon); e=Math.max(e,lon); s=Math.min(s,ll[1]); n=Math.max(n,ll[1]);
  }
  // 有點落在天空（傾斜看到地平線）時，地平線會把幾百公里外擠進畫面上緣，只保留離中心約 2.5 個畫面寬的範圍
  if(bad){ w=cLon-dx; e=cLon+dx; s=cLat-dy; n=cLat+dy; }
  if(e-w>=300||n-s>=150) return;
  const mx=(e-w)*0.1+0.02, my=(n-s)*0.1+0.02;
  BB=[w-mx,s-my,e+mx,n+my];
}
// 某一點附近的比例尺（像素／公里）：傾斜時近處大、遠處小，風機大小依這個值
function localKm(lon,lat){
  const a=projFlatRaw(lon,lat), b=projFlatRaw(lon+0.001/Math.max(0.05,Math.cos(lat*D2R)),lat);
  return a&&b?Math.hypot(b[0]-a[0],b[1]-a[1])/0.11132:kmPx;
}
function inBox(lon,lat,m){
  if(!BB) return true;
  if(lat<BB[1]-m||lat>BB[3]+m) return false;
  if(lon<BB[0]-m) lon+=360; else if(lon>BB[2]+m) lon-=360;
  return lon>=BB[0]-m&&lon<=BB[2]+m;
}
// 地圖沒動時沿用上一幀算好的螢幕位置（vv 在地圖移動、地形載入時遞增）
// 每支風機的地形高度查一次就存起來（MapLibre 每次換算都重查，幾千支會卡）；地形圖磚更新時清掉
let ELEV=new Float32Array(WT.n).fill(NaN), terrZ=0;
const FT={e:0,getElevationForLngLat(){return this.e},getElevationForLngLatZoom(){return this.e}};
function projectElev(i,lon,lat){
  if(!vis(lon,lat)) return null;
  LLF.lng=wrapLon(lon); LLF.lat=lat;
  let e=ELEV[i]; if(e!==e) e=ELEV[i]=map.terrain?map.terrain.getElevationForLngLatZoom(LLF,terrZ):0;
  FT.e=e; const p=map.transform.locationToScreenPoint(LLF,FT);
  return isFinite(p.x)&&p.x>=-40&&p.y>=-40&&p.x<=W+40&&p.y<=H+40?[p.x,p.y]:null;
}
let vv=0; const WC={vv:-1,mode:-1,list:[]}, DOTB=Array.from({length:16},()=>[]), WT_MAX=2500, ICON_MAX=400;
function drawWorld(g,dtR,occ){
  const now=performance.now(), lvl=kmPx<0.25?0:kmPx<2?1:2;
  if(now-wtLast>300){
    wtLast=now;
    for(const c of WCELLS){const w=windAt(c.cx,c.cy,simSec);c.ws=hubWs(Math.hypot(w[0],w[1]),false);c.frac=powerFrac(c.ws);c.rpm=c.ws>=VCO?0:c.ws<VCI?0.6:Math.min(14,3+c.ws*0.95);c.fill=wHue(c.frac,0.95);}
    // 只更新目前快取裡的亮點；剛換縮放層級時快取還是上一層的格式，要等重建後再更新
    if(WC.mode===1&&lvl===1) for(let k=2;k<WC.list.length;k+=3){const a=WC.list[k],w=windAt(a.cx,a.cy,simSec);a.frac=powerFrac(hubWs(Math.hypot(w[0],w[1]),false));}
  }
  if(S.playing) for(const c of WCELLS) c.ang+=c.rpm/60*TAU*dtR/1000*1.6;
  if(WC.vv!==vv||WC.mode!==lvl){
    const fresh=WC.mode!==lvl; WC.vv=vv; WC.mode=lvl; const L=WC.list=[];
    if(lvl<2){
      // 拉遠時的亮點不需要地形高度，用比較快的平面換算
      for(const c of lvl?WAGG:WCELLS){ if(!inBox(c.cx,c.cy,0.6)) continue; const p=projectFlat(c.cx,c.cy); if(p) L.push(p[0],p[1],c); }
      if(fresh&&lvl===1) for(let k=2;k<L.length;k+=3){const a=L[k],w=windAt(a.cx,a.cy,simSec);a.frac=powerFrac(hubWs(Math.hypot(w[0],w[1]),false));}
    }else{
      // 先用經緯度挑出畫面裡的風機；太多時（例如德國北部）固定取其中一部分，不然拖曳會卡
      // 傾斜時畫面上半部是很遠的地方，那裡的風機只是小點：離中心越遠抽樣越稀（1、1/2、1/4、1/8）
      const m=111*kmPx, ci=[], cc=[], scr=Math.max(W,H)/kmPx, kx=111.3*Math.cos(cLat*D2R), tilted=map.getPitch()>8;
      for(const c of WCELLS){
        if(!inBox(c.cx,c.cy,0.6)||!vis(c.cx,c.cy)) continue;
        const q=projRaw(c.cx,c.cy); if(!q||q[0]<-m||q[0]>W+m||q[1]<-m||q[1]>H+m) continue;
        for(let i=c.start;i<c.start+c.n;i++){
          if(WT.own[i]) continue;
          const lon=WT.xy[2*i]/1e5, lat=WT.xy[2*i+1]/1e5;
          if(!inBox(lon,lat,0)) continue;
          if(tilted){ const r=Math.hypot((lon-cLon)*kx,(lat-cLat)*110.6)/scr, kf=r<0.5?1:r<1?2:r<1.6?4:8; if(kf>1&&i%kf) continue; }
          ci.push(i); cc.push(c);
        }
      }
      const useT=S.tilt&&map.getPitch()>8, step=Math.max(1,Math.ceil(ci.length/(useT?WT_MAX*0.6:WT_MAX))); // 俯視時地形高度看不出差別；算地形比較慢，上限再低一點
      for(let k=0;k<ci.length;k++){
        const i=ci[k]; if(step>1&&i%step) continue;
        const lon=WT.xy[2*i]/1e5, lat=WT.xy[2*i+1]/1e5, pp=useT?projectElev(i,lon,lat):projectFlat(lon,lat);
        if(pp) L.push(pp[0],pp[1],i,cc[k]);
      }
    }
  }
  const L=WC.list;
  if(lvl<2){
    const sc=lvl?Math.min(2.2,0.6+kmPx*1.2):1, NBK=16;
    // 依發電比例分成 16 種顏色，同色的亮點一次畫完（逐一 fill 幾千次會卡）
    for(const b of DOTB) b.length=0;
    for(let k=0;k<L.length;k+=3){ const c=L[k+2]; DOTB[Math.min(NBK-1,Math.floor(c.frac*NBK))].push(L[k],L[k+1],(lvl?0.9:1.2)+Math.log2(c.n+1)*(lvl?0.32:0.75)*sc); }
    g.globalCompositeOperation=C.dark?'lighter':'source-over';
    for(let q=0;q<NBK;q++){
      const B=DOTB[q]; if(!B.length) continue;
      g.beginPath(); for(let k=0;k<B.length;k+=3){ g.moveTo(B[k]+B[k+2],B[k+1]); g.arc(B[k],B[k+1],B[k+2],0,TAU); }
      g.fillStyle=wHue((q+0.5)/NBK,lvl?0.5:0.55); g.fill();
    }
    g.globalCompositeOperation='source-over';
    return;
  }
  const col=C.dark?'#f2f7fb':'#ffffff'; let icons=0, lastC=null;
  // 先畫所有小點（同一格同一個顏色，只設定一次），再畫風機圖示
  for(let k=0;k<L.length;k+=4){
    const c=L[k+3]; if(c!==lastC){ lastC=c; g.fillStyle=c.fill||wHue(c.frac,0.95); }
    g.fillRect(L[k]-1.5,L[k+1]-1.5,3,3);
  }
  for(let k=0;k<L.length&&icons<ICON_MAX;k+=4){
    const x=L[k], y=L[k+1], i=L[k+2], c=L[k+3];
    const lk=localKm(WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5), far=Math.min(1,lk/kmPx); if(far<0.3) continue;
    const kk=WT.cl[i]&15, off=(WT.cl[i]>>4)&1, D=DCL[kk]||(off?150:90), hh=Math.max(45,D*0.65+15), trueH=hh/1000*lk;
    const Hp=S.big?Math.max(trueH,BIG_MIN*far):trueH; if(!S.big&&Hp<6) continue;
    const cs=Hp*1.1, key=Math.floor(x/cs)+','+Math.floor(y/cs); if(occ.has(key)) continue; occ.add(key);
    drawTurbineTrue(g,x,y,Hp,Hp*(D/2)/hh,c.ang+i*2.399,col,farAlpha(far),turbStyle(WT.cl[i],WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5,i),!!(WT.skin&&WT.skin[i])); icons++;
  }
}

/* ---------- 地圖視角與投影 ---------- */
const mapEl=$('#map');
const cTrail=document.createElement('canvas'), cFx=document.createElement('canvas');
cTrail.className=cFx.className='ov';
map.getCanvasContainer().append(cTrail,cFx);
const gTrail=cTrail.getContext('2d'), gFx=cFx.getContext('2d');
let W=300,H=300,DPR=1,cLon=121,cLat=23.5,kmPx=0.06,Z=1;
// Z：相當於舊版 d3 地球的縮放倍率（1＝整顆地球佔畫面約 88%），各種顯示門檻沿用舊版數值
function applyView(){
  const c=map.getCenter(); cLon=c.lng; cLat=c.lat;
  const a=map.project([cLon,cLat]), dl=0.05/Math.max(0.05,Math.cos(cLat*D2R)), b=map.project([cLon+dl,cLat]);
  kmPx=Math.max(1e-4,Math.hypot(b.x-a.x,b.y-a.y)/(0.05*111.2));
  Z=kmPx*6371/(Math.min(W,H)*0.44);
}
const LL={lng:0,lat:0};
function vis(lon,lat){
  if(S.mode!=='3d') return true;
  LL.lng=lon; LL.lat=lat; return !map.transform.isLocationOccluded(LL);
}
// 平面地圖會有好幾份世界，把經度換到離畫面中心最近的那一份
function wrapLon(lon){ return S.mode==='3d'?lon:cLon+(((lon-cLon)%360+540)%360-180); }
function projRaw(lon,lat){ const p=map.project([wrapLon(lon),lat]); return isFinite(p.x)&&isFinite(p.y)?[p.x,p.y]:null; }
function project(lon,lat){
  if(!vis(lon,lat)) return null;
  const p=projRaw(lon,lat); if(!p) return null;
  if(p[0]<-40||p[1]<-40||p[0]>W+40||p[1]>H+40) return null;
  return p;
}
// 風的粒子很多，換算時不考慮地形高度（地形的射線計算一次要 0.3 ms，太慢）
const PT=new maplibregl.Point(0,0), LLF=new maplibregl.LngLat(0,0);
function projFlatRaw(lon,lat){ LLF.lng=wrapLon(lon); LLF.lat=lat; const p=map.transform.locationToScreenPoint(LLF); return isFinite(p.x)&&isFinite(p.y)?[p.x,p.y]:null; }
function projectFlat(lon,lat){
  if(!vis(lon,lat)) return null;
  const p=projFlatRaw(lon,lat); if(!p||p[0]<-40||p[1]<-40||p[0]>W+40||p[1]>H+40) return null;
  return p;
}
function unprojFlat(x,y){ PT.x=x; PT.y=y; const l=map.transform.screenPointToLocation(PT); let lon=l.lng; if(lon>180||lon<-180) lon=((lon+540)%360)-180; return [lon,l.lat]; }
function unproj(x,y){ const l=map.unproject([x,y]); let lon=l.lng; if(lon>180||lon<-180) lon=((lon+540)%360)-180; return [lon,l.lat]; }
function resize(){
  const r=mapEl.getBoundingClientRect();
  W=Math.max(200,r.width); H=Math.max(200,r.height); DPR=qPR();
  // 風線畫布每幀都要整張淡出，用 1 倍解析度就好（細線本來就柔和，看不出差別）
  const sz=(c,d)=>{c.width=Math.round(W*d);c.height=Math.round(H*d);c.style.width=W+'px';c.style.height=H+'px';};
  sz(cTrail,1); sz(cFx,DPR); gTrail.setTransform(1,0,0,1,0,0); gFx.setTransform(DPR,0,0,DPR,0,0);
  map.resize(); applyView(); initParticles(); vv++;
}
// 讓畫面中心的比例尺變成 k（像素／公里）需要的 MapLibre 縮放等級
function zoomForKm(k,lat){ return map.getZoom()+Math.log2(k/kmPx)+Math.log2(Math.max(0.02,Math.cos(lat*D2R))/Math.max(0.02,Math.cos(cLat*D2R))); }
function zoomForZ(z,lat){ return zoomForKm(z*Math.min(W,H)*0.44/6371,lat); }
/* ---------- 底圖加工：中文地名、地形陰影、立體地形、晝夜 ---------- */
// 地名用介面語言（assets/i18n.js）：中文優先用繁體／簡體名，其他語言用該語言的名字，沒有就用當地名字
const ZH_NAME=I18N.nameExpr();
let placeLayers=[];
function onStyle(){
  const dark=styleKey==='dark', layers=map.getStyle().layers;
  map.setProjection({type:S.mode==='3d'?'globe':'mercator'});
  placeLayers=[];
  for(const l of layers){
    if(l.type!=='symbol') continue;
    const tf=map.getLayoutProperty(l.id,'text-field');
    if(tf&&JSON.stringify(tf).includes('name')) map.setLayoutProperty(l.id,'text-field',ZH_NAME);
    if(l['source-layer']==='place'||l['source-layer']==='water_name') placeLayers.push(l.id);
  }
  const firstSym=(layers.find(l=>l.type==='symbol')||{}).id;
  const below=(layers.find(l=>/^(waterway|water|road|tunnel|bridge|building)/.test(l.id)&&l.type!=='background')||{}).id||firstSym;
  if(!map.getSource('dem-hs')) map.addSource('dem-hs',{type:'raster-dem',tiles:DEM_TILES,tileSize:512,encoding:'terrarium',maxzoom:12,attribution:'<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>'});
  if(!map.getSource('dem-tr')) map.addSource('dem-tr',{type:'raster-dem',tiles:DEM_TILES,tileSize:512,encoding:'terrarium',maxzoom:12});
  map.addLayer({id:'hillshade',type:'hillshade',source:'dem-hs',minzoom:4,paint:{
    'hillshade-exaggeration':['interpolate',['linear'],['zoom'],4,0.15,9,0.35,13,0.25],
    'hillshade-shadow-color':dark?'#000814':'#56634f','hillshade-highlight-color':dark?'#2c4a66':'#ffffff','hillshade-accent-color':dark?'#06131f':'#6f7a5c'}},below);
  // 3D 建築一律用自己的圖層：暗色＝半透明藍色全像（越高越亮）、明＝米白、地景＝咖啡色；zoom 13～14 慢慢浮現
  for(const l of layers) if(l.type==='fill-extrusion') map.removeLayer(l.id);
  const holo=dark, fade=v=>['interpolate',['linear'],['zoom'],13,0,14.2,v];
  map.addLayer({id:'building-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:13,layout:{visibility:S.bld?'visible':'none'},paint:{
    'fill-extrusion-color':holo?['interpolate',['linear'],['coalesce',['get','render_height'],5],0,'#1b3a6b',25,'#2f6fd6',80,'#58b4ff',200,'#b6ecff']:mapStyle==='land'?'#9c6f4b':'#e8dccb',
    'fill-extrusion-height':['get','render_height'],'fill-extrusion-base':['get','render_min_height'],
    'fill-extrusion-opacity':fade(holo?0.55:mapStyle==='land'?0.92:0.85),'fill-extrusion-vertical-gradient':true}},firstSym);
  styleExtras(layers);
  map.addSource('night',{type:'geojson',data:nightGeo(0)});
  map.addSource('night2',{type:'geojson',data:nightGeo(-8)});
  for(const id of ['night','night2']) map.addLayer({id,type:'fill',source:id,paint:{'fill-color':dark?'#000410':'#101e40','fill-opacity':dark?0.42:0.16,'fill-antialias':false}},firstSym);
  map.setSky(dark?{'sky-color':'#06131f','horizon-color':'#14304a','fog-color':'#0b1d2d','sky-horizon-blend':0.6,'horizon-fog-blend':0.5,'fog-ground-blend':0.6,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,6,1,9,0]}
                 :{'sky-color':'#8fcbf2','horizon-color':'#e6f4fb','fog-color':'#e6f4fb','sky-horizon-blend':0.6,'horizon-fog-blend':0.5,'fog-ground-blend':0.6,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,6,1,9,0]});
  applyBase(); addMusicBorders();
  applyTilt(false); applyNightVis(); applyLabelVis(); lastNightT=S.simT;
  $('#loading').hidden=true;
  // 手機上資料來源預設收合成 ⓘ（點一下就展開，頁尾也有完整來源）
  if(innerWidth<760) setTimeout(()=>{ const a=document.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show'); if(a) a.classList.remove('maplibregl-compact-show'); },100);
}
// 3D 地形要先把整張地圖畫到暫存畫面再貼到地面上，放大到街道時（圖層、建築很多）會很卡；
// 街道等級的起伏也看不太出來，所以 zoom 13.5 以上自動暫停地形，拉遠再恢復（前後留一點緩衝避免來回切）
let terrOn=null;
function autoTerrain(){
  if(!styleReady||!map.getSource('dem-tr')) return;
  const z=map.getZoom(), want=S.tilt&&(terrOn?z<13.8:z<13.2);
  if(want===terrOn) return;
  terrOn=want; map.setTerrain(want?{source:'dem-tr',exaggeration:1.4}:null); vv++; ELEV.fill(NaN);
}
map.on('zoom',autoTerrain);
function applyTilt(move){
  if(!styleReady) return;
  terrOn=null; autoTerrain();
  if(move) map.easeTo(S.tilt?{pitch:kmPx>=0.3?55:kmPx>=0.05?35:0,duration:900}:{pitch:0,bearing:0,duration:900});
}
// 衛星：最底下鋪 Sentinel-2 衛星圖，把陸地、水、綠地色塊藏起來，只留道路和地名；地景：森林、農田、草地重新上色，地形陰影加深
const LAND_COL=['match',['get','class'],['wood','forest'],'#8fbf7a',['grass','scrub'],'#c3dd9f',['farmland'],'#e8dcae',['wetland'],'#a9d6c4',['sand','beach'],'#efdfb0',['ice','glacier'],'#f2f7fb',['rock','bare_rock'],'#d8d1c3','#cfe2b4'];
function styleExtras(layers){
  const bg=layers.find(l=>l.type==='background');
  if(mapStyle==='sat'){
    map.addSource('s2',{type:'raster',tiles:S2_TILES,tileSize:256,maxzoom:14,
      attribution:'<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH</a>（Contains modified Copernicus Sentinel data 2023）'});
    for(const l of layers) if(l.type==='fill'&&map.getLayer(l.id)) map.setLayoutProperty(l.id,'visibility','none');
    const after=layers.find(l=>l.type!=='background'&&map.getLayer(l.id));
    map.addLayer({id:'s2',type:'raster',source:'s2',paint:{'raster-fade-duration':200}},after&&after.id);
    if(bg) map.setPaintProperty(bg.id,'background-color','#0b1a12');
  }else if(mapStyle==='land'){
    for(const l of layers){ if(l.type!=='fill'||!map.getLayer(l.id)) continue;
      if(l['source-layer']==='landcover'){ map.setPaintProperty(l.id,'fill-color',LAND_COL); map.setPaintProperty(l.id,'fill-opacity',0.85); }
      else if(l['source-layer']==='park') map.setPaintProperty(l.id,'fill-color','#b7d79a'); }
    if(bg) map.setPaintProperty(bg.id,'background-color','#f2ecdd');
    if(map.getLayer('hillshade')) map.setPaintProperty('hillshade','hillshade-exaggeration',['interpolate',['linear'],['zoom'],4,0.3,9,0.55,13,0.4]);
  }
}
function applyBase(){
  if(!styleReady) return;
  if(map.getLayer('tw-base')) map.removeLayer('tw-base');
  if(map.getSource('tw-base')) map.removeSource('tw-base');
  const base=mapStyle==='sat'?'photo':twEmap?'emap':'vector';
  const B=NLSC[base]; if(!B) return;
  map.addSource('tw-base',{type:'raster',tileSize:256,minzoom:7,maxzoom:18,bounds:[116.2,20.4,123.6,26.8],
    tiles:[`https://wmts.nlsc.gov.tw/wmts/${B.layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`],
    attribution:`<a href="https://maps.nlsc.gov.tw/" target="_blank">${tr('內政部國土測繪中心')} ${B.name}</a>`});
  // 電子地圖本身有文字，蓋在所有底圖圖層上面；空照沒有文字，放在 3D 建築與地名下面
  const layers=map.getStyle().layers, before=base==='emap'?'night':(layers.find(l=>l.type==='fill-extrusion')||layers.find(l=>l.type==='symbol')||{}).id;
  map.addLayer({id:'tw-base',type:'raster',source:'tw-base',minzoom:7,paint:{'raster-fade-duration':200,'raster-opacity':['interpolate',['linear'],['zoom'],7,0,8,1]}},map.getLayer(before)?before:undefined);
}
function applyNightVis(){ if(!map.getLayer('night')) return; for(const id of ['night','night2']) map.setLayoutProperty(id,'visibility',S.night?'visible':'none'); }
function applyLabelVis(){ let dOn=false; try{ dOn=DOT.on; }catch(e){} const v=S.labels&&!G.on&&!dOn?'visible':'none'; for(const id of placeLayers) if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',v); }
// 太陽高度角低於 h0 的區域：每一個緯度帶，夜晚是以「背對太陽的經線」為中心、半寬 w 的一段經度
function nightGeo(h0){
  const s=sunPos(S.simT), dec=s[1]*D2R, anti=s[0]+180, sh=Math.sin(h0*D2R), rows=[];
  for(let lat=-89.5;lat<=89.5;lat+=1){
    const la=lat*D2R, q=(sh-Math.sin(la)*Math.sin(dec))/(Math.cos(la)*Math.cos(dec));
    rows.push([lat, q>=1?0:q<=-1?180:180-Math.acos(q)/D2R]);
  }
  const polys=[]; let run=[];
  const flush=()=>{ if(run.length){ const ring=[...run.map(r=>[r[1],r[0]]),...run.slice().reverse().map(r=>[-r[1],r[0]])]; polys.push(ring); run=[]; } };
  for(const r of rows){ if(r[1]>0) run.push(r); else flush(); }
  flush();
  const out=[];
  for(const ring of polys) for(const sh of [-360,0,360]){
    const moved=ring.map(p=>[p[0]+anti+sh,p[1]]);
    const cut=clipLon(clipLon(moved,-180,1),180,-1);
    if(cut.length>=3){ cut.push(cut[0]); out.push([cut]); }
  }
  return {type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:out}};
}
function clipLon(pts,x0,dir){ // 保留 dir*(x-x0)>=0 的一側
  const out=[], ins=p=>dir*(p[0]-x0)>=0, cut=(a,b)=>{const t=(x0-a[0])/(b[0]-a[0]);return [x0,a[1]+t*(b[1]-a[1])];};
  if(!pts.length) return out; let s=pts[pts.length-1];
  for(const e of pts){ if(ins(e)){ if(!ins(s)) out.push(cut(s,e)); out.push(e); } else if(ins(s)) out.push(cut(s,e)); s=e; }
  return out;
}
let lastNightT=0;
// 每次 setData 都會讓 MapLibre 重切圖磚、整張地圖（含 3D 建築與地形）重畫，所以限制更新頻率
let lastNightR=0;
function updNight(){
  if(!S.night||!map.getSource('night')||Math.abs(S.simT-lastNightT)<120000) return;
  const now=performance.now(); if(now-lastNightR<(kmPx>5?15000:4000)) return;
  lastNightR=now; lastNightT=S.simT; map.getSource('night').setData(nightGeo(0)); map.getSource('night2').setData(nightGeo(-8));
}
/* ---------- 顏色 ---------- */
let C={};
function readColors(){
  const cs=getComputedStyle(document.documentElement), v=n=>cs.getPropertyValue(n).trim();
  C={cname:v('--cname'),oceantxt:v('--oceantxt'),ocean:v('--ocean'),land:v('--land'),border:v('--border'),grat:v('--grat'),rim:v('--rim'),night:v('--night'),halo:v('--halo'),label:v('--label'),
     pl:+v('--pl')||60, dark:(+v('--pl')||60)>50, muted:v('--muted'), accent:v('--accent'), warm:v('--warm')};
  partColors = Array.from({length:NB},(_,i)=>{const h=200-i*(185/(NB-1));return `hsla(${h},${C.dark?80:75}%,${C.pl}%,${C.dark?0.6:0.55})`;});
}
/* ---------- 風場模擬 ---------- */
const VORT=[];
function newVort(v,init){
  v.lon=rnd()*360-180; const hem=rnd()<0.55?1:-1; v.lat=hem*(12+rnd()*55);
  v.R=5+rnd()*9; v.S=5+rnd()*11; v.cyc=rnd()<0.65?1:-1;
  v.life=(2+rnd()*6)*86400; v.age=init?rnd()*v.life:0; v.amp=0; v.cl=Math.cos(v.lat*D2R);
  return v;
}
for(let i=0;i<18;i++) VORT.push(newVort({},true));
let simSec=S.simT/1000;
function baseWind(lon,lat,t){
  const la=Math.abs(lat);
  const A=(la>30&&la<62)?8.5:5.5;
  let u=A*Math.sin((la-30)*Math.PI/30);
  if(la>84) u*=(90-la)/6;
  const td=t/86400;
  u+=2.2*Math.sin(lat*D2R*6+lon*D2R*2-td*0.9);
  const v=2.0*Math.sin(lon*D2R*3+td*0.6)*Math.cos(lat*D2R)+1.2*Math.cos(lon*D2R*5-lat*D2R*4+td*1.3);
  return [u,v];
}
/* ---------- 即時風場（NOAA GFS 預報，data/wind.bin.gz，GitHub Actions 每 6 小時更新） ---------- */
// 讀得到就用真實的 10 公尺高風場（空間雙線性、時間線性內插）；讀不到就用下面的程式模擬
let WG=null;
async function loadWind(){
  try{
    const ab=await getTurbines('data/wind.bin.gz',{cache:'no-cache'}), dv=new DataView(ab);
    if(dv.getUint32(0,true)!==0x31444e57||dv.getUint32(4,true)!==2) throw new Error(tr('風場檔格式不符'));
    const ni=dv.getUint16(8,true), nj=dv.getUint16(10,true), nt=dv.getUint16(12,true);
    const lat1=dv.getFloat32(16,true), lon1=dv.getFloat32(20,true), dlat=dv.getFloat32(24,true), dlon=dv.getFloat32(28,true), sc=dv.getFloat32(32,true);
    const times=[]; for(let k=0;k<nt;k++) times.push(dv.getUint32(36+4*k,true));
    const raw=new Int8Array(ab,36+4*nt,nt*2*ni*nj), d=new Float32Array(raw.length);
    for(let r=0;r<nt*2*nj;r++){ let x=0; for(let i=0;i<ni;i++){ const k=r*ni+i; x=((x+raw[k])<<24)>>24; d[k]=x*sc; } } // 還原經度方向的差分
    WG={ni,nj,nt,lat1,lon1,dlat,dlon,times,d};
    const meta=await getJSON('data/wind-meta.json',{cache:'no-cache'}).catch(()=>null);
    const run=meta&&new Date(meta.run), lbl=document.querySelector('.live');
    if(lbl&&windLive(simSec)){ lbl.innerHTML='<i></i>'+tr('即時風場'); lbl.title=tr('NOAA GFS 全球預報{run}，每 6 小時更新',{run:run?tr('（{m}/{d} {h}:00 起報）',{m:run.getMonth()+1,d:run.getDate(),h:String(run.getHours()).padStart(2,'0')}):''}); }
    clearTrails();
  }catch(e){ console.warn('即時風場讀取失敗，改用模擬風場',e); }
}
function windGrid(lon,lat,t){
  const G=WG, T=G.times, n=G.ni*G.nj; let k=0, f=0;
  if(t>=T[G.nt-1]){ k=G.nt-2; f=1; } else if(t>T[0]){ while(k<G.nt-2&&T[k+1]<t) k++; f=(t-T[k])/(T[k+1]-T[k]); }
  const x=((((lon-G.lon1)/G.dlon)%G.ni)+G.ni)%G.ni, y=Math.max(0,Math.min(G.nj-1.001,(lat-G.lat1)/G.dlat));
  const i0=Math.floor(x), i1=(i0+1)%G.ni, fx=x-i0, j0=Math.floor(y), j1=j0+1, fy=y-j0;
  const s=(base)=>{ const d=G.d, a=d[base+j0*G.ni+i0], b=d[base+j0*G.ni+i1], c=d[base+j1*G.ni+i0], e=d[base+j1*G.ni+i1];
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+e*fx)*fy; };
  const b0=k*2*n, b1=(k+1)*2*n;
  return [s(b0)*(1-f)+s(b1)*f, s(b0+n)*(1-f)+s(b1+n)*f];
}
// 10 公尺高的風換算成輪轂高度的風（真實風場：陸上約 ×1.3、離岸約 ×1.15；模擬風場沿用原本的經驗式）
// 風場檔太舊（最後一個預報時間過了 12 小時以上，例如自動更新停了）：改用模擬風場，不要一直停在舊的颱風風場
const windLive=t=>!!WG&&t<=WG.times[WG.nt-1]+43200;
function hubWs(s,off){ return windLive(simSec)?s*(off?1.15:1.3):s*(off?1.2:1.05)+(off?3.2:2.2); }
function windAt(lon,lat,t){
  if(windLive(t)) return windGrid(lon,lat,t);
  const b=baseWind(lon,lat,t); let u=b[0], v=b[1];
  for(let i=0;i<VORT.length;i++){
    const o=VORT[i]; if(o.amp<0.05) continue;
    let dx=lon-o.lon; if(dx>180)dx-=360; else if(dx<-180)dx+=360;
    dx*=o.cl; const dy=lat-o.lat; const d2=dx*dx+dy*dy; const R2=o.R*o.R;
    if(d2>9*R2) continue;
    const d=Math.sqrt(d2)+1e-6, q=d/o.R, s=o.amp*q*Math.exp(0.5*(1-q*q));
    const hs=(o.lat>=0?1:-1)*o.cyc;
    u+=-dy/d*s*hs; v+=dx/d*s*hs;
  }
  for(let i=0;i<TYS.length;i++){
    const o=TYS[i];
    let dx=lon-o.lon; if(dx>180)dx-=360; else if(dx<-180)dx+=360;
    dx*=o.cl; const dy=lat-o.lat; const d2=dx*dx+dy*dy;
    if(d2>144) continue;
    const d=Math.sqrt(d2)+1e-6, q=d/o.R;
    let s=q<1?o.v*q:o.v*Math.pow(q,-0.6); s*=Math.max(0,1-d/12);
    u+=-dy/d*s-dx/d*s*0.25; v+=dx/d*s-dy/d*s*0.25;
  }
  return [u,v];
}
function stepVort(dt){
  for(const o of VORT){
    const b=baseWind(o.lon,o.lat,simSec), cl=Math.max(0.2,Math.cos(o.lat*D2R));
    o.lon+=b[0]*dt/(111000*cl)*0.9;
    o.lat+=b[1]*dt/111000*0.4+Math.sign(o.lat)*dt/86400*0.6;
    if(o.lon>180)o.lon-=360; else if(o.lon<-180)o.lon+=360;
    o.age+=dt; o.cl=Math.cos(o.lat*D2R);
    if(o.age>o.life||Math.abs(o.lat)>78) newVort(o,false);
    o.amp=o.S*Math.sin(Math.PI*Math.min(1,o.age/o.life));
  }
}
stepVort(0);

/* ---------- 真實颱風（全球，GitHub Actions 每 6 小時從 GDACS 更新） ---------- */
// 颱風路徑來自 data/typhoons.json（obs＝實測位置，其餘為預報），由 tools/build_typhoons.py 產生
// 中央氣象署颱風分級（近中心最大風速，10 分鐘平均）：熱帶性低氣壓 <17.2、輕度 17.2–32.6、中度 32.7–50.9、強烈 ≥51.0 m/s
const TY_CLS=[17.2,32.7,51.0];
const tyClass=v=>v<TY_CLS[0]?0:v<TY_CLS[1]?1:v<TY_CLS[2]?2:3;
// 颱風名稱：中文介面用中文名，其他語言用英文名（字首大寫）
const tyName=ty=>I18N.zh||!ty.en?trName(ty.name):ty.en.charAt(0)+ty.en.slice(1).toLowerCase();
const tyClassName=(c,kind='颱風')=>tr(c===0?'熱帶性低氣壓':['','輕度','中度','強烈'][c]+kind);
// 每一級的顏色：雲帶、臉、標籤
const TY_PAL=[
  {band:'200,232,246', face:'#bfe8f5', pill:'rgba(110,160,190,.94)', dot:'#8fbcd4'},
  {band:'255,238,150', face:'#ffe27a', pill:'rgba(222,170,20,.95)',  dot:'#e6b800'},
  {band:'255,198,135', face:'#ffad55', pill:'rgba(250,120,30,.95)',  dot:'#ff8c2a'},
  {band:'255,160,175', face:'#ff6f86', pill:'rgba(225,45,85,.95)',   dot:'#e8305a'}];
const TYPHOONS=(TYD.storms||[]).map(s=>({name:s.name,en:s.en,kind:s.kind||'颱風',track:s.track.map(a=>({t:Date.parse(a.t),lat:a.lat,lon:a.lon,v:a.v,obs:!!(a.obs||a.observed)}))})).filter(s=>s.track.length>=2);
function tyNow(ty,ms){
  const tr=ty.track, H6=6*3600e3, H12=12*3600e3;
  if(ms<tr[0].t-H6||ms>tr[tr.length-1].t+H12) return null;
  let i=0; while(i<tr.length-2&&ms>tr[i+1].t) i++;
  const a=tr[i], b=tr[i+1];
  const fade=ms<a.t?Math.max(0,1-(a.t-ms)/H6):ms>b.t?Math.max(0,1-(ms-b.t)/H12):1;
  const k=Math.max(0,Math.min(1,(ms-a.t)/(b.t-a.t)));
  return {lat:a.lat+(b.lat-a.lat)*k, lon:a.lon+(b.lon-a.lon)*k, v:(a.v+(b.v-a.v)*k)*fade};
}
const TYS=[];
// 有即時風場時，把颱風圖示對到 GFS 風場裡真正的颱風眼：在官方路徑位置 ±3° 內，找風「繞著轉」最強的中心
//   （北半球逆時針、南半球順時針；只看風速大小的話，台灣山區的地面風比較弱，會被誤認成颱風眼）
let eyeCache={t:-1e15,pos:new Map()};
function gfsEye(s){
  const key=s.ty.name;
  if(Math.abs(S.simT-eyeCache.t)<20*60000&&eyeCache.pos.has(key)) return eyeCache.pos.get(key);
  if(Math.abs(S.simT-eyeCache.t)>=20*60000){ eyeCache={t:S.simT,pos:new Map()}; }
  const hs=s.lat>=0?1:-1;
  let best=null, bs=-1e9;
  for(let dy=-3;dy<=3;dy+=0.25) for(let dx=-3;dx<=3;dx+=0.25){
    const lat=s.lat+dy, lon=s.lon+dx, cl=Math.cos(lat*D2R); let circ=0;
    for(const rr of [0.8,1.6]) for(let k=0;k<12;k++){
      const a=k/12*TAU, w=windGrid(lon+Math.cos(a)*rr/cl,lat+Math.sin(a)*rr,simSec);
      circ+=hs*(-Math.sin(a)*w[0]+Math.cos(a)*w[1]);   // 繞中心旋轉的分量
    }
    const score=circ/24-0.02*(dx*dx+dy*dy);   // 差不多強時，選靠近官方位置的
    if(score>bs){ bs=score; best=[lon,lat]; }
  }
  eyeCache.pos.set(key,best); return best;
}
function updTyphoons(){
  TYS.length=0;
  for(const ty of TYPHOONS){
    const s=tyNow(ty,S.simT); if(!s||s.v<=1) continue;
    s.ty=ty; s.cl=Math.cos(s.lat*D2R); s.R=1.2;
    s.c=tyClass(s.v);
    // GFS 看得到颱風時對到風場的颱風眼；離官方位置太遠（GFS 已經抓不到這個颱風）就用官方位置
    if(windLive(simSec)&&s.v>=20){ const e=gfsEye(s); if(e&&Math.hypot((e[0]-s.lon)*s.cl,e[1]-s.lat)<=1.0){ s.lon=e[0]; s.lat=e[1]; s.cl=Math.cos(s.lat*D2R); } }
    TYS.push(s);
  }
}
let tyAng=0;
// 可愛的颱風寶寶：顏色和表情跟著中央氣象署的分級變
//   熱帶性低氣壓＝淡藍色、睡覺（zZ）；輕度＝黃色、開心笑；中度＝橘色、鼓起臉頰用力吹；強烈＝紅色、生氣大叫（轉得最快）
function drawCuteTyphoon(g,x,y,r,ang,now,c=1){
  const P=TY_PAL[c], ink='#24324a';
  for(let arm=0;arm<3;arm++){
    for(let t=0;t<=1.0001;t+=0.055){
      const a=ang+arm*TAU/3-t*3.6, rr=r*(0.55+t*1.05), sz=r*(0.2-0.13*t);
      g.fillStyle=t*18%2<1?`rgba(255,255,255,${0.9-0.65*t})`:`rgba(${P.band},${0.95-0.65*t})`;
      g.beginPath(); g.arc(x+Math.cos(a)*rr,y+Math.sin(a)*rr,Math.max(1.5,sz),0,TAU); g.fill();
    }
  }
  // 雲朵身體（強颱會微微發抖）
  const sh=c===3?Math.sin(now/45)*r*0.02:0; x+=sh;
  g.fillStyle='#ffffff';
  for(const [dx,dy,k] of [[0,0,0.62],[-0.42,0.1,0.42],[0.42,0.1,0.42],[-0.22,-0.35,0.4],[0.22,-0.35,0.4]]){ g.beginPath(); g.arc(x+dx*r,y+dy*r,k*r,0,TAU); g.fill(); }
  g.fillStyle=P.face; g.beginPath(); g.arc(x,y+r*0.05,r*0.5,0,TAU); g.fill();
  const ey=y-r*0.05, ex=r*0.2, lw=Math.max(1.2,r*0.045);
  g.strokeStyle=ink; g.fillStyle=ink; g.lineWidth=lw; g.lineCap='round';
  const dotEyes=()=>{ const blink=(now%3600)<140;
    for(const sx of [-1,1]){
      if(blink){ g.beginPath(); g.moveTo(x+sx*ex-r*0.07,ey); g.lineTo(x+sx*ex+r*0.07,ey); g.stroke(); }
      else{ g.fillStyle=ink; g.beginPath(); g.arc(x+sx*ex,ey,r*0.075,0,TAU); g.fill(); g.fillStyle='#ffffff'; g.beginPath(); g.arc(x+sx*ex+r*0.025,ey-r*0.03,r*0.028,0,TAU); g.fill(); }
    } g.fillStyle=ink; };
  const cheeks=(a)=>{ g.fillStyle=`rgba(255,110,150,${a})`; for(const sx of [-1,1]){ g.beginPath(); g.ellipse(x+sx*r*0.34,ey+r*0.13,r*0.09,r*0.055,0,0,TAU); g.fill(); } g.fillStyle=ink; };
  if(c===0){ // 睡覺：閉眼的弧線、小小的嘴、飄出 zZ
    for(const sx of [-1,1]){ g.beginPath(); g.arc(x+sx*ex,ey-r*0.02,r*0.07,0.15*Math.PI,0.85*Math.PI); g.stroke(); }
    cheeks(.45);
    g.beginPath(); g.arc(x,ey+r*0.2,r*0.035,0,TAU); g.stroke();
    const k=(now%2400)/2400; g.globalAlpha=1-k; g.font=`700 ${Math.round(r*0.26)}px sans-serif`; g.textAlign='center'; g.textBaseline='middle';
    g.fillText('z',x+r*(0.45+0.15*k),y-r*(0.55+0.3*k)); g.font=`700 ${Math.round(r*0.18)}px sans-serif`; g.fillText('z',x+r*(0.32+0.1*k),y-r*(0.38+0.2*k));
    g.globalAlpha=1; g.textAlign='start';
  }else if(c===1){ // 開心：亮晶晶的眼睛＋大大的笑
    dotEyes(); cheeks(.7);
    g.beginPath(); g.arc(x,ey+r*0.1,r*0.13,0.15*Math.PI,0.85*Math.PI); g.stroke();
  }else if(c===2){ // 用力吹：眉毛往上、鼓臉頰、嘟嘴，嘴邊吹出風
    dotEyes(); cheeks(.9);
    for(const sx of [-1,1]){ g.beginPath(); g.moveTo(x+sx*(ex-r*0.08),ey-r*0.15); g.lineTo(x+sx*(ex+r*0.07),ey-r*0.19); g.stroke(); }
    g.beginPath(); g.ellipse(x,ey+r*0.21,r*0.055,r*0.07,0,0,TAU); g.stroke();
    const k=(now%900)/900; g.globalAlpha=0.85*(1-k); g.strokeStyle='#ffffff'; g.lineWidth=lw*0.9;
    for(const o of [-0.07,0.07]){ g.beginPath(); g.moveTo(x+r*(0.1+0.25*k),ey+r*(0.21+o)); g.lineTo(x+r*(0.3+0.3*k),ey+r*(0.21+o*1.6)); g.stroke(); }
    g.globalAlpha=1; g.strokeStyle=ink; g.lineWidth=lw;
  }else{ // 生氣：倒八字眉、張大嘴、頭上冒青筋
    dotEyes(); cheeks(.6);
    g.lineWidth=lw*1.3;
    for(const sx of [-1,1]){ g.beginPath(); g.moveTo(x+sx*(ex+r*0.09),ey-r*0.2); g.lineTo(x+sx*(ex-r*0.07),ey-r*0.12); g.stroke(); }
    g.lineWidth=lw;
    g.beginPath(); g.moveTo(x-r*0.12,ey+r*0.15); g.quadraticCurveTo(x,ey+r*0.1,x+r*0.12,ey+r*0.15); g.quadraticCurveTo(x+r*0.1,ey+r*0.34,x,ey+r*0.34); g.quadraticCurveTo(x-r*0.1,ey+r*0.34,x-r*0.12,ey+r*0.15); g.fill();
    g.fillStyle='#ff8fa3'; g.beginPath(); g.ellipse(x,ey+r*0.29,r*0.06,r*0.035,0,0,TAU); g.fill();
    const pulse=1+0.12*Math.sin(now/120), mx=x+r*0.42, my=y-r*0.45, m=r*0.11*pulse;
    g.strokeStyle='#e8203f'; g.lineWidth=lw*1.1;
    for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){ g.beginPath(); g.moveTo(mx+sx*m*0.35,my+sy*m); g.quadraticCurveTo(mx+sx*m*0.35,my+sy*m*0.35,mx+sx*m,my+sy*m*0.35); g.stroke(); }
    g.strokeStyle=ink;
  }
  g.lineCap='butt';
}
function drawTyphoons(g,dtR){
  if(S.playing) tyAng-=dtR*0.004;
  for(const ty of TYPHOONS){
    g.setLineDash([5,5]); g.strokeStyle=C.warm; g.lineWidth=1.5; g.beginPath(); let on=false;
    for(const p of ty.track){const q=project(p.lon,p.lat); if(!q){on=false;continue;} if(!on){g.moveTo(q[0],q[1]);on=true;} else g.lineTo(q[0],q[1]);}
    g.stroke(); g.setLineDash([]);
    // 路徑上的點依當時的分級上色：實心＝實測，空心＝預報
    for(const p of ty.track){const q=project(p.lon,p.lat); if(!q) continue; const col=TY_PAL[tyClass(p.v)].dot; g.beginPath(); g.arc(q[0],q[1],p.obs?3:3.2,0,TAU);
      if(p.obs){ g.fillStyle=col; g.fill(); } else { g.fillStyle='rgba(255,255,255,.85)'; g.fill(); g.strokeStyle=col; g.lineWidth=1.6; g.stroke(); } }
  }
  const now=performance.now();
  for(const s of TYS){
    const q=project(s.lon,s.lat); if(!q) continue;
    const q2=projRaw(s.lon+1,s.lat)||q;
    const r=Math.min(110,Math.max(22,Math.hypot(q2[0]-q[0],q2[1]-q[1])*1.4));
    drawCuteTyphoon(g,q[0],q[1],r,tyAng*(0.6+0.35*s.c),now,s.c);
    const txt=`${s.ty.name}・${tyClassName(s.c,s.ty.kind)} ${Math.round(s.v)} m/s`;
    g.font='700 13px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.textBaseline='middle'; g.textAlign='center'; g.lineJoin='round';
    const tw=g.measureText(txt).width, ly=q[1]+r*1.75+10;
    g.fillStyle=TY_PAL[s.c].pill; g.beginPath(); g.roundRect?g.roundRect(q[0]-tw/2-9,ly-11,tw+18,22,11):g.rect(q[0]-tw/2-9,ly-11,tw+18,22); g.fill();
    g.fillStyle='#ffffff'; g.fillText(txt,q[0],ly); g.textAlign='start';
  }
}

/* 簡化功率曲線：切入 3、額定 12、切出 25 m/s；P ∝ v³（P = ½ρAC_p v³） */
const VCI=3, VR=12, VCO=25;
function powerFrac(v){ if(v<VCI||v>=VCO) return 0; if(v>=VR) return 1; return (v**3-VCI**3)/(VR**3-VCI**3); }
function farmWind(f){
  const w=windAt(f.lon,f.lat,simSec); let s=Math.hypot(w[0],w[1]);
  s = hubWs(s,f.k!=='on')+(windLive(simSec)?0.6:1.3)*Math.sin(simSec/1800+f.ph);
  return Math.max(0,s);
}
function updateFarms(dtR){
  for(const f of FARMS){
    f.ws=farmWind(f);
    if(f.st==='ret'){f.frac=0;f.rpm=0;continue;}
    f.frac=powerFrac(f.ws);
    f.rpm = f.ws>=VCO ? 0 : f.ws<VCI ? 0.6 : Math.min(14,3+f.ws*0.95);
    if(S.playing) f.ang+=f.rpm/60*TAU*dtR/1000*1.6;
  }
}
const BF=[0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
const BFN=['無風','軟風','輕風','微風','和風','清風','強風','疾風','大風','烈風','狂風','暴風','颶風'].map(x=>tr(x));
function beaufort(v){let i=0;while(i<BF.length&&v>=BF[i])i++;return i;}

/* ---------- 風的粒子 ---------- */
const NB=8; let partColors=[]; const buckets=Array.from({length:NB},()=>[]);
let parts=[];
function spawn(p,init){
  for(let k=0;k<8;k++){
    const x=Math.random()*W, y=Math.random()*H, ll=unprojFlat(x,y);
    if(!ll||!isFinite(ll[0])||!isFinite(ll[1])||Math.abs(ll[1])>88) continue;
    if(!vis(ll[0],ll[1])) continue;
    const q=projFlatRaw(ll[0],ll[1]); if(!q||Math.abs(q[0]-x)>1||Math.abs(q[1]-y)>1) continue;
    p.lon=ll[0]; p.lat=ll[1]; p.age=init?Math.floor(Math.random()*80):0; p.max=45+Math.random()*75; return;
  }
  p.lon=cLon+(Math.random()-0.5)*30; p.lat=Math.max(-80,Math.min(80,cLat+(Math.random()-0.5)*30)); p.age=0; p.max=30;
}
// 放大到看得見一支支風機時（kmPx≥2），風線減半：這時的風幾乎是同一個方向，不需要那麼多
function partCount(){ return Math.round(Math.min(2600,Math.max(600,W*H/480))*(kmPx>=2?0.5:1)*[0.45,0.75,1][QUAL.lvl]); }
function initParticles(){
  const n=partCount();
  parts=new Array(n); for(let i=0;i<n;i++){parts[i]={lon:0,lat:0,age:0,max:0};spawn(parts[i],true);}
  clearTrails();
}
function fitParticles(){
  const n=partCount();
  if(parts.length>n) parts.length=n;
  else while(parts.length<n){ const p={lon:0,lat:0,age:0,max:0}; spawn(p,true); parts.push(p); }
}
function clearTrails(){ gTrail.clearRect(0,0,W,H); }
function stepParticles(){
  for(const b of buckets) b.length=0;
  const k=0.02/Z*(S.mode==='3d'?1:1.3);
  for(const p of parts){
    if(++p.age>p.max){spawn(p,false);continue;}
    const w=windAt(p.lon,p.lat,simSec), sp=Math.hypot(w[0],w[1]);
    const cl=Math.max(0.15,Math.cos(p.lat*D2R)), sc=sp>22?22/sp:1;
    let nl=p.lon+w[0]*k*sc/cl; const nt=p.lat+w[1]*k*sc;
    if(nt>88||nt<-88){spawn(p,false);continue;}
    if(nl>180)nl-=360; else if(nl<-180)nl+=360;
    const a=projectFlat(p.lon,p.lat), b=projectFlat(nl,nt);
    p.lon=nl; p.lat=nt;
    if(!a||!b){p.age=p.max+1;continue;}
    const dx=b[0]-a[0], dy=b[1]-a[1]; if(dx*dx+dy*dy>900) continue;
    buckets[Math.min(NB-1,Math.floor(sp/2.4))].push(a[0],a[1],b[0],b[1]);
  }
  const g=gTrail;
  g.globalCompositeOperation='destination-in'; g.fillStyle='rgba(0,0,0,0.9)'; g.fillRect(0,0,W,H);
  g.globalCompositeOperation='source-over'; g.lineWidth=1.1; g.lineCap='round';
  for(let i=0;i<NB;i++){
    const arr=buckets[i]; if(!arr.length) continue;
    g.beginPath(); for(let j=0;j<arr.length;j+=4){g.moveTo(arr[j],arr[j+1]);g.lineTo(arr[j+2],arr[j+3]);}
    g.strokeStyle=partColors[i]; g.stroke();
  }
}

/* ---------- 繪圖 ---------- */
function sunPos(ms){
  const d=new Date(ms), start=Date.UTC(d.getUTCFullYear(),0,1), n=Math.floor((ms-start)/86400000)+1;
  const dec=23.45*Math.sin(TAU*(284+n)/365);
  const h=d.getUTCHours()+d.getUTCMinutes()/60+d.getUTCSeconds()/3600;
  return [-(h-12)*15,dec];
}

// 白天：風機維持白色，外面描一圈深色框線才看得清楚（晚上不用）
const TB_OL='rgba(24,42,56,.9)';
function olStroke(g,lw){ if(!C.dark){ const s0=g.strokeStyle; g.strokeStyle=TB_OL; g.lineWidth=lw+2; g.stroke(); g.strokeStyle=s0; } g.lineWidth=lw; g.stroke(); }
function olFill(g,lw){ g.fill(); if(!C.dark){ g.strokeStyle=TB_OL; g.lineWidth=lw; g.lineJoin='round'; g.stroke(); } }
function drawTurbine(g,x,y,s,ang,col){
  g.strokeStyle=C.dark?C.muted:'#f4f7f9';
  g.beginPath(); g.moveTo(x,y); g.lineTo(x,y-s); olStroke(g,Math.max(1,s*0.07));
  const hx=x, hy=y-s, L=s*0.78, w=s*0.075;
  g.fillStyle=col; g.beginPath();
  for(let k=0;k<3;k++){
    const a=ang+k*TAU/3, ca=Math.cos(a), sa=Math.sin(a);
    g.moveTo(hx-sa*w,hy+ca*w); g.lineTo(hx+ca*L,hy+sa*L); g.lineTo(hx+sa*w,hy-ca*w); g.closePath();
  }
  olFill(g,1);
  g.beginPath(); g.arc(hx,hy,Math.max(1.5,s*0.08),0,TAU); g.fillStyle=C.warm; g.fill();
}
const OFFS=[[0,0],[-1.15,0.45],[1.15,0.45],[-0.6,-0.55],[0.6,-0.55]];
function farmColor(f,a){
  if(f.st==='ret') return `rgba(140,150,160,${a})`;
  if(f.ws>=VCO) return `hsla(0,90%,60%,${a})`;
  const h=195-f.frac*150;
  return `hsla(${h},95%,${C.dark?62:44}%,${a})`;
}
let labelBoxes=[], tPick=[], EXTRA=[];
// 「風機放大」時的最小高度（像素）；遠處依比例縮小、變淡
const BIG_MIN=20;
function farAlpha(far){ return Math.min(1,(far-0.3)/0.3); }
// 風機造型，依真實資料決定（data/turbines.bin.gz 的 cl 位元＋位置）：
//   一般三葉片依額定容量分 5 個年代（era 0 約 1990 年代小型 … 4 離岸巨型），葉片粗細、機艙大小、塔身比例不同
//   兩葉片、垂直軸（H 型／螺旋型）、傳統風車（荷蘭風車造型）
//   台灣陸上的塔底綠色漸層；德國、日本的大型風機葉尖紅白相間；離岸塔底黃色基座
//   打卡過的音樂區：同樣的造型，換成七彩
const DE_BOX=[5.8,47.2,15.1,55.1], JP_BOX=[128.5,30,146,46], TWL_BOX=[119.9,21.8,122.1,25.35];
const inB=(b,lon,lat)=>lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3];
function turbStyle(cl,lon,lat,i){
  const k=cl&15, off=(cl>>4)&1, kind=(cl>>5)&3;
  const era=k===0?(off?3:1):k<=2?0:k===3?1:k===4?2:k<=6?3:4;
  return {kind, era, off:!!off, helix:kind===2&&(i&1)===1,
    green:!off&&kind===0&&inB(TWL_BOX,lon,lat), red:kind===0&&era>=2&&(inB(DE_BOX,lon,lat)||inB(JP_BOX,lon,lat))};
}
const ERA_BLADE=[0.13,0.095,0.078,0.066,0.058], ERA_TOWER=[0.06,0.05,0.045,0.04,0.038], ERA_NAC=[0.16,0.2,0.23,0.26,0.3];
function bladesPath(g,hx,hy,R,w,ang,n){
  for(let k=0;k<n;k++){ const a=ang+k*TAU/n, ca=Math.cos(a), sa=Math.sin(a);
    g.moveTo(hx-sa*w,hy+ca*w); g.lineTo(hx+ca*R,hy+sa*R); g.lineTo(hx+sa*w,hy-ca*w); g.closePath(); }
}
const rainbowAt=(k,off=0)=>`hsl(${((performance.now()/10)+k*120+off)%360},100%,60%)`;
function drawTurbineTrue(g,x,y,Hp,R,ang,col,alpha=1,st=null,rainbow=false){
  if(alpha<=0.02) return;
  st=st||{kind:0,era:1};
  g.globalAlpha=alpha;
  const hx=x, hy=y-Hp, tc=C.dark?C.muted:'#f4f7f9', ow=Math.max(0.8,Math.min(1.4,Hp*0.012)); // ow：白天框線粗細
  const towerGrad=(x0,y0,x1,y1)=>{ const gr=g.createLinearGradient(x0,y0,x1,y1); gr.addColorStop(0,'#ff5a5a'); gr.addColorStop(0.5,'#ffd23f'); gr.addColorStop(1,'#4dff88'); return gr; };
  if(st.kind===3){ // 傳統風車：木造塔身＋圓頂，四片格子帆
    const bw=Hp*0.42, tw=Hp*0.22, bh=Hp*0.8;
    g.fillStyle=rainbow?towerGrad(x,y,x,y-bh):'#9a6440';
    g.beginPath(); g.moveTo(x-bw/2,y); g.lineTo(x+bw/2,y); g.lineTo(x+tw/2,y-bh); g.lineTo(x-tw/2,y-bh); g.closePath(); g.fill();
    g.fillStyle=rainbow?'#ffd23f':'#5a3a26'; g.beginPath(); g.arc(x,y-bh,tw*0.62,Math.PI,0); g.fill();
    g.fillStyle='#ffe9a8'; g.fillRect(x-bw*0.12,y-bh*0.45,bw*0.24,bh*0.18);
    const sy=y-bh-tw*0.15, L=Math.max(R,Hp*0.75);
    for(let k=0;k<4;k++){ const a=ang+k*TAU/4, ca=Math.cos(a), sa=Math.sin(a), nx=-sa, ny=ca, s0=L*0.18, sw=L*0.2;
      g.strokeStyle='#6b4a32'; g.lineWidth=Math.max(1,Hp*0.03); g.beginPath(); g.moveTo(x,sy); g.lineTo(x+ca*L,sy+sa*L); g.stroke();
      g.fillStyle=rainbow?rainbowAt(k,k*-30):'rgba(250,245,235,.92)';
      g.beginPath(); g.moveTo(x+ca*s0,sy+sa*s0); g.lineTo(x+ca*L,sy+sa*L); g.lineTo(x+ca*L+nx*sw,sy+sa*L+ny*sw); g.lineTo(x+ca*s0+nx*sw,sy+sa*s0+ny*sw); g.closePath(); g.fill(); }
    g.beginPath(); g.arc(x,sy,Math.max(1.5,Hp*0.04),0,TAU); g.fillStyle='#3a2a1e'; g.fill();
    g.globalAlpha=1; return;
  }
  if(st.kind===2){ // 垂直軸：H 型（白色管狀葉片＋橫臂）或螺旋型（扭轉的葉片繞著藍色發電機）
    const cy=y-Hp*0.62, hh=Hp*0.3, rr=Math.max(3,R*0.6);
    g.strokeStyle=rainbow?towerGrad(x,y,x,cy):tc; g.beginPath(); g.moveTo(x,y); g.lineTo(x,cy+hh); olStroke(g,Math.max(1.2,Hp*0.05));
    if(st.helix){
      g.fillStyle='#3d6fd6'; g.fillRect(x-Hp*0.03,cy-hh*0.6,Hp*0.06,hh*1.2);
      for(let k=0;k<3;k++){ g.strokeStyle=rainbow?rainbowAt(k):col; g.beginPath();
        for(let s=0;s<=16;s++){ const t=s/16, a=ang*0.5+k*TAU/3+t*Math.PI*0.9, px=x+Math.sin(a)*rr*Math.sin(Math.PI*t), py=cy-hh+t*2*hh; s?g.lineTo(px,py):g.moveTo(px,py); }
        olStroke(g,Math.max(1.2,Hp*0.035)); }
    }else{
      const top=cy-hh*0.7, bot=cy+hh*0.7;
      for(let k=0;k<3;k++){ const a=ang*0.5+k*TAU/3, bx=x+Math.cos(a)*rr, front=Math.sin(a)>0;
        g.globalAlpha=alpha*(front?1:0.45);
        g.strokeStyle=rainbow?rainbowAt(k):col;
        g.beginPath(); g.moveTo(x,top); g.lineTo(bx,top); g.moveTo(x,bot); g.lineTo(bx,bot); olStroke(g,Math.max(0.8,Hp*0.025));
        g.lineCap='round'; g.beginPath(); g.moveTo(bx,cy-hh); g.lineTo(bx,cy+hh); olStroke(g,Math.max(2,Hp*0.07)); g.lineCap='butt'; }
      g.globalAlpha=alpha;
    }
    g.globalAlpha=1; return;
  }
  // 水平軸：塔身（台灣陸上綠色漸層、離岸黃色基座）→ 機艙 → 葉片（德國、日本大型的葉尖紅白）
  const lw=Math.max(1,Hp*ERA_TOWER[st.era]);
  if(rainbow) g.strokeStyle=towerGrad(x,y,x,hy);
  else if(st.green){ const gr=g.createLinearGradient(x,y,x,hy); gr.addColorStop(0,'#1f8a45'); gr.addColorStop(0.3,'#3fa862'); gr.addColorStop(0.6,'#a9d9b4'); gr.addColorStop(0.75,tc); gr.addColorStop(1,tc); g.strokeStyle=gr; }
  else g.strokeStyle=tc;
  g.beginPath(); g.moveTo(x,y); g.lineTo(x,hy); olStroke(g,lw);
  if(st.off&&!rainbow){ g.strokeStyle='#f2c200'; g.lineWidth=lw*1.6; g.beginPath(); g.moveTo(x,y); g.lineTo(x,y-Hp*0.14); g.stroke(); }
  const nl=R*ERA_NAC[st.era], nh=nl*0.42;
  g.fillStyle=rainbow?'#ffd23f':col; g.beginPath(); g.rect(hx-nl*0.3,hy-nh/2,nl,nh); rainbow?g.fill():olFill(g,ow);
  const n=st.kind===1?2:3, w=Math.max(0.8,R*ERA_BLADE[st.era]*(n===2?1.25:1));
  if(rainbow){ for(let k=0;k<n;k++){ g.fillStyle=rainbowAt(k); g.beginPath(); bladesPath(g,hx,hy,R,w,ang+k*TAU/n,1); g.fill(); } }
  else{
    g.fillStyle=col; g.beginPath(); bladesPath(g,hx,hy,R,w,ang,n); olFill(g,ow);
    if(st.red){
      g.fillStyle='#e8302a'; g.beginPath();
      for(let k=0;k<n;k++){ const a=ang+k*TAU/n, ca=Math.cos(a), sa=Math.sin(a), r0=R*0.6, r1=R*0.9, ww=w*0.5;
        g.moveTo(hx+ca*r0-sa*ww,hy+sa*r0+ca*ww); g.lineTo(hx+ca*r1-sa*ww*0.6,hy+sa*r1+ca*ww*0.6); g.lineTo(hx+ca*r1+sa*ww*0.6,hy+sa*r1-ca*ww*0.6); g.lineTo(hx+ca*r0+sa*ww,hy+sa*r0-ca*ww); }
      g.fill();
    }
  }
  g.beginPath(); g.arc(hx,hy,Math.max(1.2,R*0.06),0,TAU); g.fillStyle=rainbow?'#ff7cf0':C.warm; g.fill();
  g.globalAlpha=1;
}
function drawTrueSet(g,list,D,hh,ang0,colFn,farm,spKm,occ){
  const col=C.dark?'#f2f7fb':'#ffffff';
  for(const t of list){
    if(!inBox(t.lon,t.lat,0)) continue;
    const p=project(t.lon,t.lat); if(!p) continue;
    const pk=[p[0],p[1],farm,t]; tPick.push(pk);
    const lk=localKm(t.lon,t.lat), far=Math.min(1,lk/kmPx);
    const D_=t.D||D, h_=t.hh||hh, trueH=h_/1000*lk;
    g.fillStyle=colFn(t); g.beginPath(); g.arc(p[0],p[1],Math.max(1.6,Math.min(5,D_/1000*lk*0.05)),0,TAU); g.fill();
    if(far<0.3) continue;
    const Hp=S.big?Math.max(trueH,BIG_MIN*far):trueH;
    if(!S.big&&Hp<6) continue;
    if(S.big&&Hp>trueH*1.05){ const cs=Hp*0.8, key=Math.floor(p[0]/cs)+','+Math.floor(p[1]/cs); if(occ.has(key)) continue; occ.add(key); }
    const off=farm?farm.k!=='on':false, era=D_<=77?0:D_<=90?1:D_<=130?2:D_<=167?3:4;
    pk[4]=Hp; pk[5]=Hp*(D_/2)/h_; // 畫出來的塔高、葉片長（點的時候整支風車都算）
    drawTurbineTrue(g,p[0],p[1],Hp,Hp*(D_/2)/h_,ang0+t.ang,col,farAlpha(far),{kind:0,era,off,green:!off&&inB(TWL_BOX,t.lon,t.lat)},!!t.skin);
  }
}

function drawFarms(dtR){
  const g=gFx; g.clearRect(0,0,W,H);
  if(S.ty) drawTyphoons(g,dtR);
  const zf=Math.min(2.4,0.75+Z*0.16);
  const icons=Z>=2.8, detailed=kmPx>=0.8;
  tPick=[]; const occ=new Set();
  drawWorld(g,dtR,occ);
  g.globalCompositeOperation=C.dark?'lighter':'source-over';
  for(const f of FARMS){
    const p=inBox(f.lon,f.lat,0.3)?project(f.lon,f.lat):null; f.px=p; if(!p) continue;
    const r=(3+Math.min(16,Math.sqrt(f.mw)*0.22))*zf;
    f.r=r;
    if(f.tur&&detailed){f.r=10;continue;}
    if(S.playing) f.pulse=(f.pulse+dtR/1000*(0.25+f.frac*1.1))%1;
    const grd=g.createRadialGradient(p[0],p[1],0,p[0],p[1],r*2.6);
    grd.addColorStop(0,farmColor(f,0.5)); grd.addColorStop(1,farmColor(f,0));
    g.fillStyle=grd; g.beginPath(); g.arc(p[0],p[1],r*2.6,0,TAU); g.fill();
    if(f.st!=='ret'){
      g.strokeStyle=farmColor(f,(1-f.pulse)*(0.25+0.5*f.frac)); g.lineWidth=1.5;
      g.beginPath(); g.arc(p[0],p[1],r*(0.8+f.pulse*2.2),0,TAU); g.stroke();
    }
  }
  g.globalCompositeOperation='source-over';
  for(const f of FARMS){
    const p=f.px;
    if(f.tur&&detailed){ drawTrueSet(g,f.tur,f.D,f.hh,f.ang,()=>farmColor(f,0.95),f,f.realN?Math.min(f.sp,0.8):f.sp,occ); continue; }
    if(!p) continue;
    if(icons||f===S.sel){
      const s=Math.min(28,9+Z*1.4);
      const n=f===S.sel||icons?Math.min(5,Math.max(1,Math.round(Math.log2((f.t||1)+1)/1.6))):1;
      for(let i=n-1;i>=0;i--){const o=OFFS[i];drawTurbine(g,p[0]+o[0]*s*0.9,p[1]+o[1]*s*0.9+s*0.35,s,f.ang+i*0.9,C.dark?'#f2f7fb':'#ffffff');}
    }else{
      g.fillStyle=farmColor(f,1); g.beginPath(); g.arc(p[0],p[1],Math.max(1.8,f.r*0.38),0,TAU); g.fill();
    }
    if(f===S.sel){
      g.strokeStyle=C.warm; g.lineWidth=2; g.beginPath(); g.arc(p[0],p[1],f.r*2.1+4,0,TAU); g.stroke();
    }
  }
  if(detailed&&EXTRA.length){
    drawTrueSet(g,EXTRA,100,80,performance.now()/1000*1.2,t=>{const w=windAt(t.lon,t.lat,simSec);return `hsla(${195-powerFrac(hubWs(Math.hypot(w[0],w[1]),false))*150},90%,${C.dark?62:44}%,.95)`;},null,0.4,occ);
  }
  drawMe(g); drawGameMark(g); drawDots(g);
  if(S.big&&detailed&&!DOT.on){ const t=tr('風機圖示已放大，大小非等比例（按 B 切換）'); g.font='500 12px "Noto Sans TC",sans-serif'; g.textAlign='center'; g.textBaseline='bottom'; g.lineWidth=3; g.strokeStyle=C.halo; g.strokeText(t,W/2,H-12); g.fillStyle=C.warm; g.fillText(t,W/2,H-12); g.textAlign='start'; }
  if(S.labels&&!DOT.on){
    labelBoxes=[];
    g.font='500 12px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.textBaseline='middle'; g.lineJoin='round';
    const order=FARMS.filter(f=>f.px).sort((a,b)=>(b===S.sel)-(a===S.sel)||(b.tw?1:0)-(a.tw?1:0)||b.mw-a.mw);
    for(const f of order){
      const show = f===S.sel || Z>=2.4 || f.mw>=1200 || (f.tw&&Z>=1.8) || f.id==='rossisland'||f.id==='formosa1';
      if(!show) continue;
      const txt=f.ns, w=g.measureText(txt).width;
      const x=f.px[0]+f.r+6, y=f.px[1]-(icons&&!(f.tur&&detailed)?Math.min(18,Z*0.8):0);
      const box=[x-2,y-9,x+w+2,y+9];
      if(labelBoxes.some(b=>!(box[2]<b[0]||box[0]>b[2]||box[3]<b[1]||box[1]>b[3]))) continue;
      labelBoxes.push(box);
      g.lineWidth=3.5; g.strokeStyle=C.halo; g.strokeText(txt,x,y);
      g.fillStyle=f===S.sel?C.warm:C.label; g.fillText(txt,x,y);
    }
  }
}

/* ---------- 互動 ---------- */
let fly=false, zenMove=false;
function userTook(){ if(S.tour) setTour(false); fly=false; }
function pick(x,y){
  let best=null,bd=1e9;
  for(const t of tPick){ if(!t[2]) continue; const d=Math.hypot(t[0]-x,t[1]-y); if(d<12&&d<bd){bd=d;best=t[2];}}
  if(best) return best;
  for(const f of FARMS){ if(!f.px) continue; const d=Math.hypot(f.px[0]-x,f.px[1]-y); const lim=Math.max(14,(f.r||6)+6); if(d<lim&&d<bd){bd=d;best=f;} }
  return best;
}
for(const ev of ['dragstart','zoomstart','rotatestart','pitchstart']) map.on(ev,e=>{ if(e.originalEvent) userTook(); });
map.on('move',()=>{ vv++; if(!zenMove) clearTrails(); });
map.on('sourcedata',e=>{ if(e.sourceId==='dem-tr'&&e.tile){ vv++; ELEV.fill(NaN); } });
map.on('moveend',()=>{ fly=false; });
// 點一支風機：跳出小卡片，可以開 Google 街景或 Google 地圖（官方網址連結，開新分頁）
// 點風車：看不見的大點點——底下那個小點點附近（手機 30 像素、電腦 20 像素），加上整支塔身和葉片轉的圓
const TAP_R=matchMedia('(pointer:coarse)').matches?30:20;
function tapDist(t,x,y){
  let d=Math.hypot(t[0]-x,t[1]-y); if(!t[4]) return d;
  const hy=t[1]-t[4], u=Math.max(0,Math.min(1,(t[1]-y)/Math.max(1,t[4]))); // 塔身這一段
  d=Math.min(d,Math.hypot(t[0]-x,t[1]-u*t[4]-y), Math.max(0,Math.hypot(t[0]-x,hy-y)-t[5]*0.9)); return d;
}
function pickTurbine(x,y){
  let best=null,bd=TAP_R;
  for(const t of tPick){ const d=tapDist(t,x,y); if(d<bd){ bd=d; best={lon:t[3].lon,lat:t[3].lat,D:t[3].D||(t[2]&&t[2].D),farm:t[2],off:t[2]?t[2].k!=='on':false}; } }
  if(WC.mode===2){ const L=WC.list; for(let k=0;k<L.length;k+=4){ const d=Math.hypot(L[k]-x,L[k+1]-y); if(d<bd){ bd=d; const i=L[k+2], kk=WT.cl[i]&15;
    best={lon:WT.xy[2*i]/1e5,lat:WT.xy[2*i+1]/1e5,D:DCL[kk]||0,farm:null,off:!!((WT.cl[i]>>4)&1),kind:WT.cl[i]>>5}; } } }
  return best;
}
// 地圖上這個位置是不是水面（看底圖畫出來的水域；底圖還沒載入時當作是）
function onWater(t){
  try{ if(!map.isSourceLoaded('openmaptiles')) return true;
    const p=map.project([t.lon,t.lat]), fs=map.queryRenderedFeatures([[p.x-2,p.y-2],[p.x+2,p.y+2]]);
    return fs.some(f=>f.sourceLayer==='water'&&f.layer.type==='fill'); }catch(e){ return true; }
}
/* ---------- 風機卡片：所在地區、唸出來、自訂名稱 ---------- */
// 國家：地圖國界的 ISO 數字代碼 → 兩碼國碼 → 瀏覽器內建的中文國名
const ISO2=Object.fromEntries('4:AF,8:AL,10:AQ,12:DZ,16:AS,20:AD,24:AO,28:AG,31:AZ,32:AR,36:AU,40:AT,44:BS,48:BH,50:BD,51:AM,52:BB,56:BE,60:BM,64:BT,68:BO,70:BA,72:BW,76:BR,84:BZ,86:IO,90:SB,92:VG,96:BN,100:BG,104:MM,108:BI,112:BY,116:KH,120:CM,124:CA,132:CV,136:KY,140:CF,144:LK,148:TD,152:CL,156:CN,158:TW,170:CO,174:KM,178:CG,180:CD,184:CK,188:CR,191:HR,192:CU,196:CY,203:CZ,204:BJ,208:DK,212:DM,214:DO,218:EC,222:SV,226:GQ,231:ET,232:ER,233:EE,234:FO,238:FK,239:GS,242:FJ,246:FI,248:AX,250:FR,258:PF,260:TF,262:DJ,266:GA,268:GE,270:GM,275:PS,276:DE,288:GH,296:KI,300:GR,304:GL,308:GD,316:GU,320:GT,324:GN,328:GY,332:HT,334:HM,336:VA,340:HN,344:HK,348:HU,352:IS,356:IN,360:ID,364:IR,368:IQ,372:IE,376:IL,380:IT,384:CI,388:JM,392:JP,398:KZ,400:JO,404:KE,408:KP,410:KR,414:KW,417:KG,418:LA,422:LB,426:LS,428:LV,430:LR,434:LY,438:LI,440:LT,442:LU,446:MO,450:MG,454:MW,458:MY,462:MV,466:ML,470:MT,478:MR,480:MU,484:MX,492:MC,496:MN,498:MD,499:ME,500:MS,504:MA,508:MZ,512:OM,516:NA,520:NR,524:NP,528:NL,531:CW,533:AW,534:SX,540:NC,548:VU,554:NZ,558:NI,562:NE,566:NG,570:NU,574:NF,578:NO,580:MP,583:FM,584:MH,585:PW,586:PK,591:PA,598:PG,600:PY,604:PE,608:PH,612:PN,616:PL,620:PT,624:GW,626:TL,630:PR,634:QA,642:RO,643:RU,646:RW,652:BL,654:SH,659:KN,660:AI,662:LC,663:MF,666:PM,670:VC,674:SM,678:ST,682:SA,686:SN,688:RS,690:SC,694:SL,702:SG,703:SK,704:VN,705:SI,706:SO,710:ZA,716:ZW,724:ES,728:SS,729:SD,732:EH,740:SR,748:SZ,752:SE,756:CH,760:SY,762:TJ,764:TH,768:TG,776:TO,780:TT,784:AE,788:TN,792:TR,795:TM,796:TC,800:UG,804:UA,807:MK,818:EG,826:GB,831:GG,832:JE,833:IM,834:TZ,840:US,850:VI,854:BF,858:UY,860:UZ,862:VE,876:WF,882:WS,887:YE,894:ZM'.split(',').map(s=>s.split(':')));
const countryZh=f=>I18N.regionName(ISO2[Number(f.id)],f.properties.name); // 用介面語言的國名
// 點在海上時，往外一圈一圈找最近的陸地（離岸風機要知道是哪個國家、哪個縣市外海）
function nearestHit(feats,lon,lat){
  for(const f of feats) if(d3.geoContains(f,[lon,lat])) return f;
  for(const km of [8,20,40,70]) for(let k=0;k<12;k++){ const a=k/12*TAU, p=[lon+Math.cos(a)*km/(111.32*Math.cos(lat*D2R)),lat+Math.sin(a)*km/110.6];
    for(const f of feats) if(d3.geoContains(f,p)) return f; }
  return null;
}
function turbineRegion(t){
  const parts=[], land=nearestHit(TWC.concat(C50F),t.lon,t.lat); // 台灣各縣市（含金門、馬祖）放前面，跟其他國家一起找
  if(land&&land.properties.COUNTYNAME) parts.push(tr('台灣'),trName(land.properties.COUNTYNAME));
  else{ if(land) parts.push(countryZh(land)); const r=ZONES&&regionAtLL(t.lon,t.lat), rn=r&&trName(r.name); if(rn&&!parts.includes(rn)) parts.push(rn); }
  if(t.farm) parts.push(t.farm.ns); // 風場（有分期的名稱裡就有「一期」「二期」）
  return parts;
}
let TNAMES={}; try{ TNAMES=JSON.parse(localStorage.getItem('windglobe-tnames')||'{}'); }catch(e){}
const tKey=t=>t.lat.toFixed(5)+','+t.lon.toFixed(5);
function saveTName(t,name){ const k=tKey(t); if(name) TNAMES[k]=name; else delete TNAMES[k]; try{ localStorage.setItem('windglobe-tnames',JSON.stringify(TNAMES)); }catch(e){} }
// 自訂名稱的小鍵盤：上面數字、中間符號、下面英文字母；每按一下彈一個音
const KB_ROWS=['1234567890','!?-_.★♥#&@','QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];
let kbEl=null, kbDone=null, kbVal='';
function openKeyboard(init,onDone){
  if(!kbEl){
    kbEl=document.createElement('div'); kbEl.className='kbd'; kbEl.hidden=true;
    kbEl.innerHTML='<div class="kbd-box"><div class="kbd-h">'+tr('幫這支風車取名字')+'</div><div class="kbd-out" aria-live="polite"></div>'+
      KB_ROWS.map((r,ri)=>'<div class="kbd-row'+(ri<2?' top':'')+'">'+[...r].map(c=>'<button type="button" data-k="'+c+'">'+c+'</button>').join('')+'</div>').join('')+
      '<div class="kbd-row act"><button type="button" data-a="sp">'+tr('空格')+'</button><button type="button" data-a="bs">⌫</button><button type="button" data-a="clr">'+tr('清除')+'</button><button type="button" data-a="no">'+tr('取消')+'</button><button type="button" data-a="ok" class="ok">'+tr('完成')+'</button></div></div>';
    $('#stage').append(kbEl);
    let n=0;
    kbEl.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; e.stopPropagation();
      const k=b.dataset.k, a=b.dataset.a;
      if(k&&kbVal.length<16){ kbVal+=k; try{ dotNote(n++%8,0.35); }catch(err){} }
      else if(a==='sp'&&kbVal.length<16&&kbVal&&!kbVal.endsWith(' ')) kbVal+=' ';
      else if(a==='bs') kbVal=kbVal.slice(0,-1);
      else if(a==='clr') kbVal='';
      else if(a==='no'){ kbEl.hidden=true; return; }
      else if(a==='ok'){ kbEl.hidden=true; kbDone&&kbDone(kbVal.trim()); return; }
      kbOut(); });
    kbEl.addEventListener('pointerdown',e=>e.stopPropagation());
  }
  kbVal=init||''; kbDone=onDone; kbOut(); kbEl.hidden=false;
}
function kbOut(){ const o=kbEl.querySelector('.kbd-out'); o.textContent=kbVal||'　'; o.classList.toggle('empty',!kbVal); }
let tPopup=null;
function showTurbinePopup(t){
  if(tPopup) tPopup.remove();
  const ll=`${t.lat.toFixed(6)},${t.lon.toFixed(6)}`, el=document.createElement('div'); el.className='tpop';
  el.innerHTML='<b></b><p></p><div class="tpop-b"><a target="_blank" rel="noopener">'+tr('Google 街景')+'</a><a target="_blank" rel="noopener">'+tr('Google 地圖')+'</a></div><small></small>';
  el.querySelector('b').textContent=t.farm?tr('{f}的風機',{f:t.farm.ns}):tr(t.kind===3?'傳統風車（磨坊）':t.kind===2?'垂直軸風機':t.kind===1?'兩葉片風機':(t.off?'離岸風機':'陸上風機'));
  el.querySelector('p').textContent=(t.D?tr('葉輪直徑約 {d} 公尺（推估）・',{d:t.D}):'')+`${Math.abs(t.lat).toFixed(4)}°${t.lat>=0?'N':'S'}${tr('，')}${Math.abs(t.lon).toFixed(4)}°${t.lon>=0?'E':'W'}`;
  const [aSv,aMap]=el.querySelectorAll('a');
  // api=1&map_action=pano 的網址有時打開是全黑、要拖一下才出現，改用 layer=c&cbll= 的街景網址
  aSv.href=`https://www.google.com/maps?layer=c&cbll=${ll}&cbp=12,0,0,0,0`;
  if(t.off) aSv.remove(); // 海上沒有街景
  aMap.href=`https://www.google.com/maps?q=${ll}&t=k&z=17`; // q＝在風機位置插紅色大頭針，t=k＝衛星圖
  el.querySelector('small').textContent=tr(t.off?'在海上沒有街景，可以看空照':'街景會找最近的拍攝點，轉一轉就能找到風車');
  // 此刻的狀態：風場圖鑑裡的用風場的風速，其他的跟畫面上一樣用所在 1° 格子中心的風（同一格的風機一起轉、一起停）
  let ws; if(t.farm) ws=t.farm.ws; else { const w=windAt(Math.floor(t.lon)+0.5,Math.floor(t.lat)+0.5,simSec); ws=hubWs(Math.hypot(w[0],w[1]),false); }
  const st=document.createElement('p'); st.className='tpop-st';
  st.textContent=t.kind===3?tr('傳統風車：以前用來磨麵粉、抽水，現在大多當作古蹟展示'):
    tr('此刻風速約 {v} m/s・',{v:ws.toFixed(1)})+tr(t.farm&&t.farm.st==='ret'?'已退役，不再轉動':ws>=VCO?'風太強，葉片轉成順風方向「保護停機」，等風變小再轉':ws<VCI?'風太小，慢慢空轉':'正在發電');
  el.querySelector('p').after(st);
  // 所在地區（國家・縣市或省州・風場）＋唸出來的按鈕；自訂名稱（彩色按鈕打開小鍵盤）
  const reg=turbineRegion(t), nm=document.createElement('div'); nm.className='tpop-nm';
  const rg=document.createElement('div'); rg.className='tpop-reg';
  rg.innerHTML='<span></span><button type="button" class="tpop-say">🔊</button>'; rg.querySelector('button').setAttribute('aria-label',tr('唸出來')); rg.querySelector('span').textContent=reg.join('・')||tr('地區不明');
  const rn=document.createElement('button'); rn.type='button'; rn.className='tpop-rename';
  const showName=()=>{ const n=TNAMES[tKey(t)]; nm.textContent=n?'⭐ '+n:''; nm.hidden=!n; rn.textContent=n?tr('✏️ 改名字'):tr('✏️ 幫它取名字'); };
  showName();
  rg.querySelector('button').onclick=()=>{ const n=TNAMES[tKey(t)]; const v=S.voice; S.voice=true; say((n?n+tr('，'):'')+(reg.join(tr('，'))||tr('這支風車'))); S.voice=v; };
  rn.onclick=()=>openKeyboard(TNAMES[tKey(t)]||'',v=>{ saveTName(t,v); showName(); if(v) addStar(); });
  const bw=document.createElement('button'); bw.type='button'; bw.className='tpop-bw'; bw.textContent=tr('⛏ 進入方塊世界');
  bw.onclick=()=>{ if(tPopup) tPopup.remove(); openBlocks(t); };
  el.querySelector('b').after(nm); st.after(rg,rn,bw);
  // 視窗放在風機下方，才不會蓋住轉動的葉片
  tPopup=new maplibregl.Popup({closeButton:true,maxWidth:'260px',offset:12,anchor:'top'}).setLngLat([t.lon,t.lat]).setDOMContent(el).addTo(map);
}
map.on('click',e=>{
  const x=e.point.x, y=e.point.y;
  if(S.zen){setZen(false);}
  else if(G.on){ const ll=unproj(x,y); if(ll&&isFinite(ll[0])&&vis(ll[0],ll[1])) gameClick(ll[0],ll[1]); }
  else if(DOT.on) dotClick(x,y);
  else{
    const t=kmPx>=0.8?pickTurbine(x,y):null;
    if(t&&t.off&&!t.farm&&!onWater(t)) t.off=false; // OSM 有些海堤、填海地上的風機標成離岸：地圖上那裡是陸地就當陸上風機（有街景）
    if(t){ tapNote(t,y); showTurbinePopup(t); if(t.farm&&S.sel!==t.farm) select(t.farm,false); return; }
    const f=pick(x,y); if(f){userTook();select(f,true);} else select(null);
  }
});
map.on('mousemove',e=>{ map.getCanvas().style.cursor=!G.on&&(pick(e.point.x,e.point.y)||(kmPx>=0.8&&pickTurbine(e.point.x,e.point.y)))?'pointer':''; });

// z 沿用舊版的縮放倍率；放大到看得見一支支風機時，依「地形」開關決定要不要傾斜
function flyTo(lon,lat,z,dur=1800,km){
  const kT=km||z*Math.min(W,H)*0.44/6371, zoom=Math.min(17,zoomForKm(kT,lat));
  fly=true;
  map.flyTo({center:[lon,lat],zoom,duration:dur,pitch:S.tilt?(kT>=0.5?55:kT>=0.08?35:0):0,bearing:kT>=0.5?map.getBearing():0,essential:true});
}

/* ---------- 面板 ---------- */
const panel=$('#panel'), rotor=$('#rotor');
function select(f,go,auto){ // auto：導覽或重畫面板自己選的，不是小朋友點的，不給貼紙
  S.sel=f;
  if(!f){panel.hidden=true;return;}
  hideHint(); if(!auto) addSticker(f);
  panel.hidden=false;
  const kd=$('#pKind'); kd.className='p-kind '+(f.st==='ret'?'ret':f.k);
  kd.textContent=tr('{k}風場',{k:kindName[f.k]||''})+(f.st==='ret'?tr('・已退役'):f.st==='build'?tr('・建置／分期運轉中'):'');
  $('#pName').textContent=f.n; $('#pEn').textContent=f.e===f.n?'':f.e; $('#pLoc').textContent=f.c+'　'+tr('{y} 年啟用',{y:f.y});
  $('#pCap').textContent=fmtMW(f.mw); $('#pT').textContent=tr('約 {n} 支',{n:f.t.toLocaleString()});
  $('#pNote').textContent=f.note;
  let meta=`${Math.abs(f.lat).toFixed(2)}°${f.lat>=0?'N':'S'}${tr('，')}${Math.abs(f.lon).toFixed(2)}°${f.lon>=0?'E':'W'}`+tr('（約略中心）');
  if(f.tur) meta+=tr('。機型 {u}，葉輪直徑 {d} m，輪轂高約 {h} m。',{u:f.unit,d:f.D,h:f.hh})+(f.realN?tr('風機位置：{src} {n} 支{rest}。',{src:tr(f.osm?'OpenStreetMap 標註的實際位置':'匯入的實測座標'),n:f.realN,rest:f.realN<f.t*0.9?tr('（全場約 {t} 支，其餘尚未被標註）',{t:f.t}):''}):tr('風機位置：依間距約 {sp} km 等比例示意排列，非實測座標。',{sp:f.sp}));
  $('#pMeta').textContent=meta;
  updPanel();
  if(go){
    if(f.tur) flyTo(f.lon,f.lat,0,2400,0.55*Math.min(W,H)/f.extKm);
    else flyTo(f.lon,f.lat,Math.max(Z,S.mode==='3d'?4.5:6));
  }
}
function fmtMW(mw){return mw>=1000?(mw/1000).toFixed(mw>=10000?0:1)+' GW':(mw<10?mw.toFixed(1):Math.round(mw))+' MW';}
function updPanel(){
  const f=S.sel; if(!f) return;
  const bf=beaufort(f.ws);
  $('#pWs').textContent=f.ws.toFixed(1)+' m/s'; $('#pBf').textContent=tr('{n} 級 {name}',{n:bf,name:BFN[bf]});
  const out=f.mw*f.frac;
  $('#pOut').textContent=fmtMW(out); $('#pPct').textContent=Math.round(f.frac*100)+'%';
  $('#pRpm').textContent=f.rpm.toFixed(1)+' rpm';
  $('#pState').textContent=tr(f.st==='ret'?'已退役':f.ws>=VCO?'風太強，保護停機':f.ws<VCI?'風太小，慢慢空轉':f.frac>=1?'全力發電':'發電中');
  const homes=out*1000/0.42;
  $('#pHome').textContent=I18N.zh&&homes>=10000?(homes/10000).toFixed(homes>=1e5?0:1)+tr(' 萬'):Math.round(homes).toLocaleString(I18N.locale);
}
$('#pClose').onclick=()=>select(null);

/* ---------- 控制列 ---------- */
const bPlay=$('#bPlay'), spd=$('#spd'), tl=$('#tl');
function setPlaying(p){S.playing=p;bPlay.textContent=p?'❚❚':'▶';bPlay.setAttribute('aria-label',tr(p?'暫停':'播放'));}
bPlay.onclick=()=>setPlaying(!S.playing);
function setSpeed(i){S.speedIdx=Math.max(0,Math.min(5,i));spd.value=S.speedIdx;$('#spdV').textContent=SPD_LBL[S.speedIdx];}
spd.oninput=()=>setSpeed(+spd.value);
let tlDrag=false;
tl.addEventListener('pointerdown',()=>tlDrag=true); window.addEventListener('pointerup',()=>tlDrag=false);
tl.oninput=()=>{const d0=twDayStart(S.simT);S.simT=d0+(+tl.value)*60000;};
function twDayStart(ms){const t=ms+8*3600000;return t-(t%86400000)-8*3600000;}
$('#bNow').onclick=()=>{S.simT=Date.now();};
function toggleBtn(id,key,after){const b=$(id);b.onclick=()=>{S[key]=!S[key];b.setAttribute('aria-pressed',S[key]);after&&after();};}
// 風線鈕打開小選單：風的流線、颱風（圖示＋路徑）分別開關；W 鍵直接開關風線
S.ty=true; try{ if(localStorage.getItem('windglobe-ty')==='0') S.ty=false; }catch(e){}
const wmenu=$('#wmenu');
function updWindMenu(){ $('#wmWind').setAttribute('aria-pressed',S.wind); $('#wmTy').setAttribute('aria-pressed',S.ty); $('#bWind').setAttribute('aria-pressed',S.wind||S.ty); }
function setWind(on){ S.wind=on; clearTrails(); updWindMenu(); }
$('#bWind').onclick=e=>{ e.stopPropagation(); updWindMenu(); wmenu.hidden=!wmenu.hidden; };
$('#wmWind').onclick=()=>setWind(!S.wind);
$('#wmTy').onclick=()=>{ S.ty=!S.ty; try{localStorage.setItem('windglobe-ty',S.ty?'1':'0');}catch(e){} updWindMenu(); };
document.addEventListener('click',e=>{ if(e.isTrusted&&!wmenu.hidden&&!wmenu.contains(e.target)&&!e.target.closest('#bWind')) wmenu.hidden=true; });
updWindMenu();
toggleBtn('#bNight','night',()=>{lastNightT=0;lastNightR=0;updNight();applyNightVis();});
toggleBtn('#bLabel','labels',()=>{ applyLabelVis(); if(typeof updShowMenu==='function') updShowMenu(); });
toggleBtn('#bBig','big',()=>{$('#bigLbl').textContent=tr(S.big?'放大':'等比例'); if(typeof updShowMenu==='function') updShowMenu();});
toggleBtn('#bTilt','tilt',()=>{$('#tiltLbl').textContent=tr(S.tilt?'立體':'平坦');applyTilt(true);});
$('#bView').onclick=()=>{
  S.mode=S.mode==='3d'?'2d':'3d'; $('#viewLbl').textContent=tr(S.mode==='3d'?'地球':'平面'); $('#bView').setAttribute('aria-pressed',S.mode==='3d');
  if(styleReady) map.setProjection({type:S.mode==='3d'?'globe':'mercator'});
  clearTrails(); setTimeout(()=>{applyView();initParticles();vv++;},50);
};
function applyTheme(force=false){
  const et=effTheme(); if(et==='auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',et);
  $('#themeLbl').textContent=THEME_LBL[theme]; readColors(); clearTrails();
  const k=isDark()?'dark':'light'; document.documentElement.setAttribute('data-dark',k==='dark'?'1':'0');
  if(k!==styleKey||force){ styleKey=k; styleReady=false; map.setStyle(STYLE_URL[k]); }
  updMset();
}
/* ---------- 觀看設定面板（地圖鈕）：地圖風格、台灣電子地圖、地形、3D 建築、日夜光影 ---------- */
const mset=$('#mset');
const curStyle=()=>mapStyle==='auto'?(isDark()?'dark':'light'):mapStyle;
function updMset(){
  const cs=curStyle(); $('#mapLbl').textContent=tr({light:'明',dark:'暗',sat:'衛星',land:'地景'}[cs]);
  for(const b of $('#msStyle').children) b.setAttribute('aria-pressed',b.dataset.v===cs);
  for(const b of $('#msTilt').children) b.setAttribute('aria-pressed',(b.dataset.v==='1')===S.tilt);
  const sw=(id,on,dis)=>{ const b=$(id); b.setAttribute('aria-checked',on); b.disabled=!!dis; };
  sw('#msEmap',twEmap&&mapStyle!=='sat',mapStyle==='sat'); sw('#msBld',S.bld); sw('#msNight',S.night);
  sw('#msAuto',mapStyle==='auto'&&theme==='auto',mapStyle!=='auto');
  for(const b of $('#msQual').children) b.setAttribute('aria-pressed',b.dataset.v===QUAL.mode);
  $('#msQualNow').textContent=QUAL.mode==='auto'?tr('目前：{q}',{q:tr(['低','中','高'][QUAL.lvl])}):'';
}
function closeMset(){ mset.hidden=true; $('#bMapSet').setAttribute('aria-pressed',false); }
$('#bMapSet').onclick=e=>{ e.stopPropagation(); updMset(); mset.hidden=!mset.hidden; $('#bMapSet').setAttribute('aria-pressed',!mset.hidden); };
$('#msClose').onclick=closeMset;
document.addEventListener('click',e=>{ if(e.isTrusted&&!mset.hidden&&!mset.contains(e.target)&&!e.target.closest('#bMapSet')) closeMset(); });
$('#msStyle').onclick=e=>{ const v=e.target.closest('button')?.dataset.v; if(!v) return;
  const was=mapStyle;
  if(v==='light'||v==='dark'){ mapStyle='auto'; theme=v; try{localStorage.setItem('windglobe-theme',theme);}catch(err){} } else mapStyle=v;
  try{localStorage.setItem('windglobe-mapstyle',mapStyle);}catch(err){}
  applyTheme(was!==mapStyle); // 換衛星、地景（或換回來）要重新載入地圖樣式
  if(v==='sat'&&was!=='sat') toast(tr('衛星圖：全世界用 Sentinel-2（約 10 公尺解析度），台灣放大後換成內政部高解析正射影像'),4000); };
$('#msEmap').onclick=()=>{ twEmap=!twEmap; try{localStorage.setItem('windglobe-base',twEmap?'emap':'vector');}catch(e){} applyBase(); updMset();
  if(twEmap&&(kmPx<0.1||Math.abs(cLon-120.9)>4||Math.abs(cLat-23.7)>4)) toast(tr('電子地圖只有台灣範圍，放大到台灣就看得到')); };
$('#msTilt').onclick=e=>{ const v=e.target.closest('button')?.dataset.v; if(v&&(v==='1')!==S.tilt){ $('#bTilt').click(); updMset(); } };
$('#msBld').onclick=()=>{ S.bld=!S.bld; try{localStorage.setItem('windglobe-bld',S.bld?'1':'0');}catch(e){} if(map.getLayer('building-3d')) map.setLayoutProperty('building-3d','visibility',S.bld?'visible':'none'); updMset(); };
$('#msNight').onclick=()=>{ $('#bNight').click(); updMset(); };
$('#msQual').onclick=e=>{ const v=e.target.closest('button')?.dataset.v; if(!v) return;
  QUAL.mode=v; QUAL.fail=[0,0,0]; QUAL.good=0; try{localStorage.setItem('windglobe-quality',v);}catch(err){}
  if(v!=='auto') setQual(+v); updMset(); };
$('#msAuto').onclick=()=>{ if(mapStyle!=='auto') return; theme=theme==='auto'?(isDark()?'dark':'light'):'auto'; try{localStorage.setItem('windglobe-theme',theme);}catch(e){} applyTheme(); };
// 標示鈕：風場名稱、風機圖示大小兩個開關放在同一個小選單
const lmenu=$('#lmenu');
function updShowMenu(){ $('#lmLabel').setAttribute('aria-pressed',S.labels); $('#lmBig').setAttribute('aria-pressed',S.big); $('#bShow').setAttribute('aria-pressed',S.labels||S.big); }
$('#bShow').onclick=e=>{ e.stopPropagation(); updShowMenu(); lmenu.hidden=!lmenu.hidden; };
$('#lmLabel').onclick=()=>{ $('#bLabel').click(); updShowMenu(); };
$('#lmBig').onclick=()=>{ $('#bBig').click(); updShowMenu(); };
document.addEventListener('click',e=>{ if(e.isTrusted&&!lmenu.hidden&&!lmenu.contains(e.target)&&!e.target.closest('#bShow')) lmenu.hidden=true; });
updShowMenu();
$('#bTheme').onclick=()=>{ const f=mapStyle!=='auto'; if(f){ mapStyle='auto'; try{localStorage.setItem('windglobe-mapstyle','auto');}catch(e){} } // 衛星、地景時按畫面鈕，先回到明／暗
  theme=THEMES[(THEMES.indexOf(theme)+1)%3];try{localStorage.setItem('windglobe-theme',theme);}catch(e){}applyTheme(f);};
darkMQ.addEventListener('change',()=>applyTheme());

function setTour(on){
  S.tour=on; $('#bTour').setAttribute('aria-pressed',on);
  if(on){S.tourIdx=0;tourGo();}
}
function tourGo(){
  const f=byId[TOUR[S.tourIdx%TOUR.length]]; S.tourIdx++;
  select(f,false,true); flyTo(f.lon,f.lat,S.mode==='3d'?4.2:6,2600); S.tourNext=performance.now()+10000;
}
$('#bTour').onclick=()=>setTour(!S.tour);
const hintEl=$('#hint');
// 放空模式：看畫面中心在哪個國家，就一區一區慢慢導覽那個國家的行政區（台灣用縣市；其他國家用有風機的省、州）；
//   每區停約 14 秒、地圖慢慢轉，音樂在這段時間隨機播放、不跟著音樂區換歌。找不到國家（例如在海上）就像以前一樣讓地球慢慢轉
const TWC=topojson.feature(TWTOPO,TWTOPO.objects.counties).features;
const ZEN={stops:[],i:0,next:0,country:''};
const bboxStop=(name,b)=>({name,lon:(b[0][0]+b[1][0])/2,lat:(b[0][1]+b[1][1])/2,km:Math.max((b[1][0]-b[0][0])*111.32*Math.cos((b[0][1]+b[1][1])/2*D2R),(b[1][1]-b[0][1])*110.6,25)});
function nnOrder(list,lon,lat){ // 從最近的一區開始，每次走到最近的下一區
  const out=[], rest=list.slice(); let x=lon,y=lat;
  while(rest.length){ let bi=0,bd=1e9; rest.forEach((s,k)=>{ const d=Math.hypot((s.lon-x)*Math.cos(y*D2R),s.lat-y); if(d<bd){bd=d;bi=k;} }); const s=rest.splice(bi,1)[0]; out.push(s); x=s.lon; y=s.lat; }
  return out;
}
async function zenPlan(){
  const p=[cLon,cLat];
  if(d3.geoContains(twLand,p)||(cLon>119.2&&cLon<122.3&&cLat>21.8&&cLat<25.5)){
    ZEN.country=tr('台灣');
    return nnOrder(TWC.map(f=>bboxStop(f.properties.COUNTYNAME,d3.geoBounds(f))),cLon,cLat);
  }
  const c=C50.find(f=>d3.geoContains(f,p)); if(!c) return [];
  ZEN.country=countryZh(c);
  loadZones(); await zonesReady(); if(!ZONES) return [];
  const cb=d3.geoBounds(c), by=new Map();
  for(const z of ZONES){
    const lon=(z.b[0]+z.b[2])/2, lat=(z.b[1]+z.b[3])/2;
    if(lon<cb[0][0]||lon>cb[1][0]||lat<cb[0][1]||lat>cb[1][1]||!d3.geoContains(c,[lon,lat])) continue;
    const g=by.get(z.n)||[180,90,-180,-90]; by.set(z.n,[Math.min(g[0],z.b[0]),Math.min(g[1],z.b[1]),Math.max(g[2],z.b[2]),Math.max(g[3],z.b[3])]);
  }
  return nnOrder([...by].map(([n,b])=>bboxStop(n,[[b[0],b[1]],[b[2],b[3]]])),cLon,cLat);
}
function zenGo(){
  if(!S.zen||!ZEN.stops.length) return;
  const s=ZEN.stops[ZEN.i%ZEN.stops.length]; ZEN.i++;
  flyTo(s.lon,s.lat,0,4500,Math.min(W,H)*0.8/s.km);
  toast(`🌬 ${ZEN.country}・${trName(s.name)}（${(ZEN.i-1)%ZEN.stops.length+1}/${ZEN.stops.length}）`,4000);
  ZEN.next=performance.now()+4500+14000;
}
function setZen(on){
  const was=S.zen; S.zen=on; document.body.classList.toggle('zen',on); $('#bZen').setAttribute('aria-pressed',on);
  ZEN.stops=[]; ZEN.i=0; if(was&&!on){ try{ map.stop(); }catch(e){} fly=false; }
  if(on){
    if(S.tour) setTour(false); select(null);
    hintEl.textContent=tr('放空中⋯點一下地圖就回來'); hintEl.classList.remove('gone'); setTimeout(hideHint,3500);
    zenPlan().then(st=>{ if(!S.zen) return; ZEN.stops=st; if(st.length) zenGo(); else flyTo(cLon,cLat,1.1,2000); });
  }
  if(MUS.on&&!PL.synth){ PL.want=on?'zen':musRegion(); PL.wantT=-1e9; } // 換成隨機歌單（關掉放空就換回音樂區的歌）
}
function hideHint(){hintEl.classList.add('gone');}
setTimeout(hideHint,9000);
$('#bZen').onclick=()=>setZen(!S.zen);
const IOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(!document.fullscreenEnabled||!$('#stage').requestFullscreen) $('#bFs').hidden=true;
$('#bFs').onclick=()=>{const st=$('#stage');try{if(document.fullscreenElement)document.exitFullscreen();else st.requestFullscreen();}catch(e){}};
document.addEventListener('fullscreenchange',()=>setTimeout(resize,60));

/* ---------- 風聲・白噪音（Web Audio 即時合成） ---------- */
const SND_TYPES=[['breeze','原野微風','跟著地圖上的風速變大變小'],['sea','海邊風浪','低低的風聲，加上一波一波的浪'],['valley','山谷呼嘯','高高低低的呼呼聲'],['storm','颱風暴風','又強又急的陣風'],['white','白噪音','平穩的沙沙聲，適合專心或睡覺']].map(([k,a,b])=>[k,tr(a),tr(b)]);
let sndType='breeze'; try{ const t=localStorage.getItem('windglobe-sound'); if(SND_TYPES.some(x=>x[0]===t)) sndType=t; }catch(e){}
let AC=null, sndOut=null, SND=null, lastSnd=0; const NBUF={};
function makeNoise(kind){
  const len=AC.sampleRate*4, buf=AC.createBuffer(1,len,AC.sampleRate), d=buf.getChannelData(0);
  let b0=0,b1=0,b2=0,br=0;
  for(let i=0;i<len;i++){
    const w=Math.random()*2-1;
    if(kind==='white') d[i]=w*0.25;
    else if(kind==='brown'){ br=(br+0.02*w)/1.02; d[i]=br*3.2; }
    else { b0=0.99765*b0+w*0.099046; b1=0.963*b1+w*0.2965164; b2=0.57*b2+w*1.0526913; d[i]=(b0+b1+b2+w*0.1848)*0.12; }
  }
  return buf;
}
// 一條聲音：噪音 → 濾波器 → 音量
function sndPart(kind,ftype,f,q){
  const s=AC.createBufferSource(); s.buffer=NBUF[kind]; s.loop=true; s.start(0,Math.random()*3);
  const fl=AC.createBiquadFilter(); fl.type=ftype; fl.frequency.value=f; fl.Q.value=q||0.7;
  const g=AC.createGain(); g.gain.value=0; s.connect(fl).connect(g).connect(sndOut);
  return {s,f:fl,g};
}
function buildSound(type){
  if(SND){ const old=SND; for(const p of old.parts) p.g.gain.setTargetAtTime(0,AC.currentTime,0.3); setTimeout(()=>{ for(const p of old.parts) try{p.s.stop();}catch(e){} },1500); }
  const P=[];
  if(type==='sea'){ P.push(sndPart('brown','lowpass',600)); P.push(sndPart('pink','bandpass',1400,0.6)); }
  else if(type==='valley'){ P.push(sndPart('white','bandpass',800,14)); P.push(sndPart('pink','lowpass',300)); }
  else if(type==='storm'){ P.push(sndPart('pink','lowpass',1200,0.9)); P.push(sndPart('brown','lowpass',160)); }
  else if(type==='white') P.push(sndPart('white','lowpass',7000));
  else P.push(sndPart('pink','lowpass',400,0.8));
  SND={type,parts:P,vf:800}; lastSnd=0;
}
function startSound(){
  try{
    if(!AC){
      AC=new (window.AudioContext||window.webkitAudioContext)();
      for(const k of ['white','pink','brown']) NBUF[k]=makeNoise(k);
      sndOut=AC.createGain(); sndOut.connect(AC.destination);
    }
    AC.resume();
    if(!SND||SND.type!==sndType) buildSound(sndType);
  }catch(e){S.sound=false;}
}
function setSound(on,type){
  if(type){ sndType=type; try{localStorage.setItem('windglobe-sound',type);}catch(e){} }
  S.sound=on; $('#bSnd').setAttribute('aria-pressed',on);
  if(MUS.on&&PL.target>0) PL.target=MP3_VOL*duck();
  if(on){ startSound(); toast('≋ '+SND_TYPES.find(x=>x[0]===sndType)[1]+(MUS.on?tr('（背景音樂自動變小聲）'):''),2200); }
  updSoundMenu();
}
function toggleSound(){ setSound(!S.sound); }
const smenu=$('#smenu');
function updSoundMenu(){ for(const b of smenu.querySelectorAll('[data-t]')) b.setAttribute('aria-pressed',S.sound&&b.dataset.t===sndType); }
for(const [t,nm,desc] of SND_TYPES){
  const b=document.createElement('button'); b.className='big'; b.dataset.t=t; b.innerHTML='<b></b><small></small>';
  b.querySelector('b').textContent=nm; b.querySelector('small').textContent=desc;
  b.onclick=()=>{ smenu.hidden=true; setSound(true,t); };
  $('#smOff').before(b);
}
$('#smOff').onclick=()=>{ smenu.hidden=true; setSound(false); };
$('#bSnd').onclick=e=>{ e.stopPropagation(); updSoundMenu(); $('#gmenu').hidden=true; smenu.hidden=!smenu.hidden; };
document.addEventListener('click',e=>{ if(!smenu.hidden&&!smenu.contains(e.target)&&e.target.id!=='bSnd') smenu.hidden=true; });
function updSound(now){
  if(!AC||!SND||now-lastSnd<350) return; lastSnd=now;
  const T=AC.currentTime, on=S.sound, [a,b]=SND.parts, set=(p,v,tc=0.45)=>p.g.gain.setTargetAtTime(on?v:0,T,tc);
  if(SND.type==='breeze'){
    let w; if(S.sel) w=S.sel.ws; else {const v=windAt(cLon,cLat,simSec);w=Math.hypot(v[0],v[1])+3;}
    const gust=0.75+Math.random()*0.5;
    set(a,S.playing?Math.min(0.5,0.05+w*0.018)*gust:0); a.f.frequency.setTargetAtTime(220+w*60*gust,T,0.6);
  }else if(SND.type==='sea'){
    const wave=Math.pow(Math.max(0,Math.sin(T*TAU/9)),2); // 約 9 秒一道浪
    set(a,0.16+0.06*Math.random()); set(b,0.03+0.22*wave,0.8); b.f.frequency.setTargetAtTime(900+900*wave,T,0.8);
  }else if(SND.type==='valley'){
    SND.vf=Math.max(450,Math.min(1300,SND.vf+(Math.random()-0.5)*220));
    a.f.frequency.setTargetAtTime(SND.vf,T,1.2); set(a,0.22+0.12*Math.random(),0.8); set(b,0.1);
  }else if(SND.type==='storm'){
    const g=0.5+Math.random()*0.7;
    set(a,0.1+0.22*g,0.25); a.f.frequency.setTargetAtTime(700+g*1300,T,0.3); set(b,0.28);
  }else set(a,0.06,0.6);
}
// 開著風聲時，背景音樂降到 4 成
const duck=()=>S.sound?0.4:1;

/* ---------- 鍵盤 ---------- */
document.addEventListener('keydown',e=>{
  if(e.target.matches('input[type=search],input[type=text]')) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const k=e.key;
  if(k===' '){e.preventDefault();setPlaying(!S.playing);}
  else if(k>='1'&&k<='6') setSpeed(+k-1);
  else if(k==='ArrowLeft'){S.simT-=3600000;e.preventDefault();}
  else if(k==='ArrowRight'){S.simT+=3600000;e.preventDefault();}
  else if(k==='t'||k==='T') setTour(!S.tour);
  else if(k==='z'||k==='Z') setZen(!S.zen);
  else if(k==='s'||k==='S') toggleSound();
  else if(k==='m'||k==='M') $('#bMus').click();
  else if(k==='f'||k==='F') $('#bFs').click();
  else if(k==='w'||k==='W') setWind(!S.wind);
  else if(k==='n'||k==='N') $('#bNight').click();
  else if(k==='l'||k==='L') $('#bLabel').click();
  else if(k==='b'||k==='B') $('#bBig').click();
  else if(k==='g'||k==='G') $('#bView').click();
  else if(k==='p'||k==='P') $('#bTilt').click();
  else if(k==='Escape'){ if(S.zen) setZen(false); else select(null); }
});

/* ---------- 風場圖鑑 ---------- */
const grid=$('#grid'); let filt0='all', query='';
FARMS.forEach(f=>{
  const b=document.createElement('button'); b.className='card'; f.card=b;
  const kk=f.st==='ret'?'ret':f.k;
  b.innerHTML=`<span class="nm"><i class="dotk ${kk}"></i></span><span class="ct"></span><span class="row"><span class="o">--</span><b>${fmtMW(f.mw)}</b></span><span class="bar"><i></i></span>`;
  b.querySelector('.nm').append(f.n); b.querySelector('.ct').textContent=`${f.c}・${kindName[f.k]}・${f.y}`;
  b.onclick=()=>{userTook();select(f,true);$('#stage').scrollIntoView({behavior:'smooth',block:'start'});};
  grid.append(b);
});
function filterCards(){
  const q=query.trim().toLowerCase();
  for(const f of FARMS){
    let ok = filt0==='all' || (filt0==='tw'&&f.tw) || (filt0===f.k);
    if(ok&&q) ok=(f.n+f.e+f.c+f.n0).toLowerCase().includes(q);
    f.card.hidden=!ok;
  }
}
$('#chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;filt0=b.dataset.f;for(const x of $('#chips').children)x.setAttribute('aria-pressed',x===b);filterCards();};
$('#q').oninput=e=>{query=e.target.value;filterCards();};
function updCards(){
  for(const f of FARMS){
    if(f.card.hidden) continue;
    f.card.querySelector('.o').textContent=f.st==='ret'?tr('已退役'):f.ws>=VCO?tr('保護停機'):tr('風速 {v} m/s・輸出 {p}%',{v:f.ws.toFixed(1),p:Math.round(f.frac*100)});
    f.card.querySelector('.bar i').style.width=(f.frac*100)+'%';
  }
}

/* ---------- 匯入實測風機座標 ---------- */
// TWD97 TM2（GRS80、中央經線 121°E、k0=0.9999、東偏 250000 m）反算，公式依 Snyder (1987)
function twd97ToWgs(x,y,lon0=121){
  const a=6378137, f=1/298.257222101, e2=f*(2-f), k0=0.9999;
  x-=250000; const M=y/k0;
  const mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const fp=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const ep2=e2/(1-e2), C1=ep2*Math.cos(fp)**2, T1=Math.tan(fp)**2, sf=Math.sin(fp);
  const R1=a*(1-e2)/Math.pow(1-e2*sf*sf,1.5), N1=a/Math.sqrt(1-e2*sf*sf), Dd=x/(N1*k0);
  const lat=fp-(N1*Math.tan(fp)/R1)*(Dd*Dd/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*Dd**4/24+(61+90*T1+298*C1+45*T1*T1-3*C1*C1-252*ep2)*Dd**6/720);
  const lon=lon0*D2R+(Dd-(1+2*T1+C1)*Dd**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*Dd**5/120)/Math.cos(fp);
  return [lon/D2R,lat/D2R];
}
const XK=['lon','lng','long','longitude','x','e','經度','東距','twd97_x','x座標','x_twd97'];
const YK=['lat','latitude','y','n','緯度','北距','twd97_y','y座標','y_twd97'];
function parseImport(text){
  const pts=[], t=text.replace(/^\uFEFF/,'').trim();
  if(t.startsWith('{')||t.startsWith('[')){
    const j=JSON.parse(t);
    if(j.elements) for(const el of j.elements){ const c=el.lat!=null?el:el.center; if(c&&c.lat!=null) pts.push([c.lon,c.lat,(el.tags&&(el.tags.ref||el.tags.name))||'']); }
    const feats=j.type==='FeatureCollection'?j.features:j.type==='Feature'?[j]:[];
    for(const ft of feats){
      const g=ft.geometry; if(!g) continue; const nm=(ft.properties&&(ft.properties.ref||ft.properties.name))||'';
      if(g.type==='Point') pts.push([g.coordinates[0],g.coordinates[1],nm]);
      else if(g.type==='MultiPoint') g.coordinates.forEach(c=>pts.push([c[0],c[1],nm]));
      else { const c=d3.geoCentroid(ft); pts.push([c[0],c[1],nm]); }
    }
  }else{
    const lines=t.split(/\r?\n/).filter(l=>l.trim()); if(!lines.length) return pts;
    let ix=0,iy=1,start=0;
    const head=lines[0].split(/[,\t;]/).map(s=>s.trim().replace(/"/g,'').toLowerCase());
    if(head.some(s=>s&&isNaN(parseFloat(s)))){ start=1; const fx=head.findIndex(s=>XK.includes(s)), fy=head.findIndex(s=>YK.includes(s)); if(fx>=0)ix=fx; if(fy>=0)iy=fy; }
    for(let i=start;i<lines.length;i++){
      const c=lines[i].split(/[,\t;]/), x=parseFloat(c[ix]), y=parseFloat(c[iy]);
      if(!isFinite(x)||!isFinite(y)) continue;
      const ll=(x>1000&&y>1000)?twd97ToWgs(x,y):[x,y];
      pts.push([ll[0],ll[1],'']);
    }
  }
  return pts.filter(p=>isFinite(p[0])&&isFinite(p[1])&&Math.abs(p[1])<=90&&Math.abs(p[0])<=180);
}
function applyImport(pts){
  for(const f of FARMS) if(f.schem){f.tur=f.schem;f.realN=0;f.lon=f.lon0;f.lat=f.lat0;f.extKm=f.extKm0;}
  EXTRA=[]; const groups=new Map();
  for(const p of pts){
    let best=null,bd=1e9;
    for(const f of FARMS){ if(!f.schem) continue; const d=d3.geoDistance([p[0],p[1]],[f.lon0,f.lat0])*6371-(f.extKm0/2+4); if(d<bd){bd=d;best=f;} }
    const t={lon:p[0],lat:p[1],ang:rnd()*TAU,real:true};
    if(best&&bd<0){ if(!groups.has(best)) groups.set(best,[]); groups.get(best).push(t); } else EXTRA.push(t);
  }
  for(const [f,arr] of groups){
    f.tur=arr; f.realN=arr.length; f.osm=false;
    f.lon=d3.mean(arr,t=>t.lon); f.lat=d3.mean(arr,t=>t.lat);
    let m=0; for(const t of arr) m=Math.max(m,d3.geoDistance([t.lon,t.lat],[f.lon,f.lat])*6371); f.extKm=Math.max(2,m*2+1);
  }
  return groups;
}
function importMsg(pts,groups){
  const inF=[...groups.values()].reduce((s,a)=>s+a.length,0);
  $('#impMsg').textContent=tr('已匯入 {n} 支風機的實測座標：{a} 支對應到 {g} 座台灣離岸風場（取代示意排列），其餘 {b} 支以一般風機（葉輪約 100 m）顯示在原位置。放大到看得見比例尺 1 km 左右就會出現。',{n:pts.length,a:inF,g:groups.size,b:pts.length-inF});
  $('#bImpClr').hidden=false;
}
$('#bImp').onclick=()=>$('#fImp').click();
$('#fImp').onchange=async e=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const pts=parseImport(await file.text());
    if(!pts.length){$('#impMsg').textContent=tr('檔案裡沒有讀到任何座標點。GeoJSON 請用 Point；CSV 第一列請放欄位名稱（例如 lon,lat 或 X,Y）。');return;}
    const groups=applyImport(pts); importMsg(pts,groups);
    try{localStorage.setItem('windglobe-turbines',JSON.stringify(pts));}catch(err){}
    if(S.sel) select(S.sel,false,true);
  }catch(err){ $('#impMsg').textContent=tr('讀取失敗：{e}。請確認檔案是 GeoJSON、Overpass JSON 或 CSV。',{e:err.message}); }
  e.target.value='';
};
$('#bImpClr').onclick=()=>{
  applyBuiltin(); try{localStorage.removeItem('windglobe-turbines');}catch(err){}
  $('#bImpClr').hidden=true; $('#impMsg').textContent=tr('已清除匯入的座標，回到 OpenStreetMap 的風機位置。');
  if(S.sel) select(S.sel,false,true);
};
function dFromMW(mw){return mw<=0?90:mw<1?50:mw<1.6?77:mw<2.6?90:mw<4.5?130:mw<7?154:mw<9?167:mw<11?174:222;}
// 台灣離岸風場：用 data/tw-farm-turbines.json 對應好的 OpenStreetMap 風機取代示意排列
function applyBuiltin(){
  for(const f of FARMS) if(f.schem){f.tur=f.schem;f.realN=0;f.osm=false;f.lon=f.lon0;f.lat=f.lat0;f.extKm=f.extKm0;}
  EXTRA=[];
  for(const [id,rows] of Object.entries(TWA.farms)){
    const f=byId[id]; if(!f||!f.schem||!rows.length) continue;
    const arr=rows.map(r=>{const t={lon:r[0],lat:r[1],ang:rnd()*TAU,real:true}; if(r[2]>0){t.D=dFromMW(r[2]);t.hh=Math.max(45,t.D*0.65+15);} return t;});
    f.tur=arr; f.realN=arr.length; f.osm=true;
    f.lon=d3.mean(arr,t=>t.lon); f.lat=d3.mean(arr,t=>t.lat);
    let m=0; for(const t of arr) m=Math.max(m,d3.geoDistance([t.lon,t.lat],[f.lon,f.lat])*6371); f.extKm=Math.max(2,m*2+1);
  }
}
applyBuiltin();
try{ const saved=JSON.parse(localStorage.getItem('windglobe-turbines')||'null'); if(saved&&saved.length){ importMsg(saved,applyImport(saved)); } }catch(err){}

/* ---------- HUD ---------- */
const WK='日一二三四五六';
const capTotal=FARMS.filter(f=>f.st!=='ret').reduce((s,f)=>s+f.mw,0);
$('#capGW').textContent=(capTotal/1000).toFixed(1);
let lastHud=0, lastCards=0;
function pad(n){return String(n).padStart(2,'0');}
function updHud(now){
  const t=new Date(S.simT+8*3600000), hh=t.getUTCHours(), mm=t.getUTCMinutes();
  const hm=pad(hh)+':'+pad(mm);
  $('#clock').textContent=hm; $('#tlTime').textContent=hm;
  $('#tlDay').textContent=I18N.LANG==='zh-Hant'?`${t.getUTCMonth()+1}/${t.getUTCDate()} 週${WK[t.getUTCDay()]}`:t.toLocaleDateString(I18N.locale,{timeZone:'UTC',month:'numeric',day:'numeric',weekday:'short'});
  if(!tlDrag) tl.value=hh*60+mm;
  let out=0,run=0; for(const f of FARMS){out+=f.mw*f.frac; if(f.frac>0) run++;}
  $('#outGW').textContent=(out/1000).toFixed(1);
  $('#outBar').style.width=(out/capTotal*100).toFixed(1)+'%';
  $('#hudCount').textContent=tr('{n} 座風場發電中',{n:run});
  const tyEl=$('#tyRow');
  // 顯示離台灣最近的一個；全球還有其他的就加註「全球共 N 個」
  if(S.ty&&TYS.length){const dist=s=>d3.geoDistance([s.lon,s.lat],[121,23.7])*6371, s=TYS.reduce((a,b)=>dist(b)<dist(a)?b:a), dTW=dist(s); tyEl.hidden=false;
    tyEl.textContent='🌀 '+tr('{name}（{cls}）近中心約 {v} m/s・距台灣約 {d} 公里',{name:tyName(s.ty),cls:tyClassName(s.c,s.ty.kind),v:Math.round(s.v),d:Math.round(dTW/10)*10})+(TYS.length>1?tr('・全球共 {n} 個',{n:TYS.length}):'');}
  else tyEl.hidden=true;
  updPanel();
  if(now-lastCards>1000){lastCards=now;updCards();}
}

/* ---------- 主迴圈 ---------- */
let last=performance.now(), windWas=true;
// 每幀先排好下一幀；就算某一段出錯，動畫也不會整個停掉（錯誤只記到主控台，同樣的錯誤只記一次）
let frameErr='';
function frame(now){
  requestAnimationFrame(frame);
  try{ frameBody(now); }catch(e){ const m=String(e&&e.stack||e); if(m!==frameErr){ frameErr=m; console.error('frame',e); } }
}
function setQual(l){ if(l===QUAL.lvl) return; QUAL.lvl=l; try{ map.setPixelRatio(qPR()); }catch(e){} resize(); window.WindGame3D&&WindGame3D.quality(l); if(!mset.hidden) updMset(); }
// 每 3 秒算一次每秒張數：低於 38 張降一級；連續 15 秒都超過 55 張升一級（同一級掉下來兩次就不再升上去）
function qualTick(dt){
  if(QUAL.mode!=='auto'||document.hidden||dt<=0||dt>250){ QUAL.acc=QUAL.n=0; return; }
  QUAL.acc+=dt; QUAL.n++; if(QUAL.acc<3000) return;
  const fps=QUAL.fps=1000*QUAL.n/QUAL.acc; QUAL.acc=QUAL.n=0;
  if(fps<38&&QUAL.lvl>0){ QUAL.fail[QUAL.lvl]++; QUAL.good=0; setQual(QUAL.lvl-1); }
  else if(fps>55&&QUAL.lvl<2&&QUAL.fail[QUAL.lvl+1]<2){ if(++QUAL.good>=5){ QUAL.good=0; setQual(QUAL.lvl+1); } }
  else QUAL.good=0;
}
function frameBody(now){
  qualTick(now-last);
  const dtR=Math.max(0,Math.min(100,now-last)); last=Math.max(last,now);
  if(S.playing){ const dts=dtR/1000*S.speeds[S.speedIdx]; S.simT+=dts*1000; stepVort(dts); }
  simSec=S.simT/1000; // 暫停時拖時間軸也要跟著換風場時間
  updTyphoons();
  if(S.zen&&!fly&&!map.isMoving()){ zenMove=true;
    if(ZEN.stops.length){ map.jumpTo({bearing:map.getBearing()+dtR*0.0025}); if(now>ZEN.next) zenGo(); } // 在這一區慢慢轉，時間到換下一區
    else map.jumpTo({center:[cLon+dtR*0.0028,cLat]});
    zenMove=false; }
  if(S.tour&&!fly&&now>S.tourNext) tourGo();
  updateFarms(dtR);
  updMusic(now,dtR); updNeon(now);
  if(V3.open){ updSound(now); return; }
  applyView(); updViewBox();
  updNight();
  // 放大到街道等級時風線幾乎不動，只剩雜點，不畫（也省下整張畫布的淡出運算）
  const windOn=S.wind&&kmPx<300;
  if(windOn){ fitParticles(); if(S.playing) stepParticles(); } else if(windWas) clearTrails();
  windWas=windOn;
  drawFarms(dtR);
  if(S.sel) rotor.setAttribute('transform',`rotate(${(S.sel.ang*180/Math.PI)%360} 55 46)`);
  if(now-lastHud>250){lastHud=now;updHud(now);}
  updSound(now);
}

/* ================= 國界（找找看判斷答案、3D 風場海岸線用） ================= */
const C50=topojson.feature(TOPO50,TOPO50.objects.countries).features;
const C50F=C50.filter(f=>f.id!=='158');
const twLand = topojson.feature(TWTOPO, TWTOPO.objects.nation);
const CF={};
function mainPart(f){
  const g=f.geometry; if(g.type==='Polygon') return g;
  let best=null,ba=-1; for(const c of g.coordinates){const p={type:'Polygon',coordinates:c};const a=d3.geoArea(p);if(a>ba){ba=a;best=p;}}
  return best;
}
for(const f of C50){const m=mainPart(f);f.anchor=d3.geoCentroid(m);f.area=d3.geoArea(m);CF[Number(f.id)]=f;}

/* ================= 共用：提示、語音、星星、彩帶 ================= */
const toastEl=$('#toast'); let toastT=0;
function toast(msg,ms=2800){ toastEl.textContent=msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.remove('on'),ms); }
S.voice=true;
// 語音：先播 voice/<聲音>/ 裡事先錄好的 mp3（微軟線上神經語音，tools/build_voice.py 產生，清單在 data/voices.json）；
//   找不到檔案（例如沒有網路、還沒錄的句子）才改用裝置內建語音
// 檔名是句子的 FNV-1a 雜湊（UTF-16），跟 tools/build_voice.py 的 text_key() 相同
const textKey=s=>{ let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h.toString(16).padStart(8,'0'); };
let VOICES=[], voiceId=''; try{ voiceId=localStorage.getItem('windglobe-voice3')||''; }catch(e){}
// 這個語言可以用的聲音（data/voices.json 的 lang；簡體中文也用中文聲音）
const VLANG=I18N.zh?'zh':I18N.LANG, langVoices=()=>VOICES.filter(v=>(v.lang||'zh')===VLANG);
const curVoice=()=>{ const vs=langVoices(); return vs.find(v=>v.id===voiceId)||vs[0]||null; };
let sayAC=null, saySrc=null, sayTok=0; const clipCache=new Map();
function sayCtx(){ if(!sayAC){ try{ sayAC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; } } if(sayAC.state==='suspended') sayAC.resume().catch(()=>{}); return sayAC; }
// iPhone 要在使用者點一下時先叫醒聲音，之後計時器觸發的語音才播得出來
addEventListener('pointerdown',()=>{ if(S.voice) sayCtx(); },{passive:true});
async function clipBuf(v,text){
  const k=v.id+'/'+textKey(text); if(clipCache.has(k)) return clipCache.get(k);
  const p=fetch(`voice/${k}.mp3`).then(r=>r.ok?r.arrayBuffer():null).then(ab=>ab&&new Promise((ok,no)=>sayCtx().decodeAudioData(ab,ok,no))).catch(()=>null);
  clipCache.set(k,p); if(clipCache.size>80) clipCache.delete(clipCache.keys().next().value); return p;
}
// 裝置內建語音（備用）：挑台灣女生的聲音，音調調高一點
const VOICE_PREF=I18N.zh?[/HsiaoYu/i,/HsiaoChen/i,/Yating/i,/Hanhan/i,/Mei-?Jia/i,/Tingting|Ting-Ting/i,/Xiaoxiao/i]:[/Ana|Aria|Jenny|Samantha/i,/Nanami|Kyoko/i,/SunHi|Yuna/i];
let TTSV=null;
function pickTTS(){ const pre=I18N.zh?/^(zh|cmn)/i:new RegExp('^'+I18N.LANG,'i'), vs=('speechSynthesis' in window)?speechSynthesis.getVoices().filter(v=>pre.test(v.lang)&&!/^Google/i.test(v.name)):[];
  TTSV=null; for(const re of VOICE_PREF){ TTSV=vs.find(v=>re.test(v.name)&&(!I18N.zh||/TW|Hant/i.test(v.lang)))||vs.find(v=>re.test(v.name)); if(TTSV) break; } if(!TTSV) TTSV=vs.find(v=>v.lang.replace('_','-').toLowerCase()===I18N.locale.toLowerCase())||vs[0]||null; }
if('speechSynthesis' in window){ pickTTS(); speechSynthesis.addEventListener('voiceschanged',pickTTS); }
function sayTTS(text){ if(!('speechSynthesis' in window)) return; try{ const u=new SpeechSynthesisUtterance(text); u.lang=TTSV?TTSV.lang:I18N.locale; if(TTSV) u.voice=TTSV; u.pitch=1.6; u.rate=1.05; speechSynthesis.speak(u); }catch(e){} }
function sayStop(){ sayTok++; if(saySrc){ try{ saySrc.stop(); }catch(e){} saySrc=null; } if('speechSynthesis' in window) speechSynthesis.cancel(); }
async function say(text){
  if(!S.voice) return; sayStop(); const tok=sayTok, v=curVoice(), ac=v&&sayCtx();
  // 中文聲音的錄音檔是用繁體原文錄的：簡體介面唸的句子換回原文找檔案
  const buf=ac?await clipBuf(v,(v.lang||'zh')==='zh'?I18N.REV.get(text)||text:text):null; if(tok!==sayTok) return;
  if(!buf){ if(v) console.info('沒有錄好的語音，改用內建語音：',text); sayTTS(text); return; }
  const s=ac.createBufferSource(); s.buffer=buf; s.connect(ac.destination); s.start(); saySrc=s; s.onended=()=>{ if(saySrc===s) saySrc=null; };
}
function fillVoiceSel(){ const sel=$('#gmVoiceSel'); if(!sel) return; sel.innerHTML='';
  // 分成女生、男生兩組（data/voices.json 的 g）
  for(const [g,lbl] of [['girl',tr('女生')],['boy',tr('男生')]]){ const vs=langVoices().filter(v=>(v.g||'girl')===g); if(!vs.length) continue;
    const og=document.createElement('optgroup'); og.label=lbl;
    for(const v of vs){ const o=document.createElement('option'); o.value=v.id; o.textContent=`${trName(v.name)}・${tr(v.desc)}`; if(v===curVoice()) o.selected=true; og.append(o); }
    sel.append(og); }
  sel.hidden=!langVoices().length; }
getJSON('data/voices.json').then(d=>{ VOICES=d.voices||[]; fillVoiceSel(); }).catch(()=>{});
let STARS=0; try{STARS=+localStorage.getItem('windglobe-stars')||0;}catch(e){}
function addStar(n=1){ STARS+=n; try{localStorage.setItem('windglobe-stars',STARS);}catch(e){} updStars(); }
function updStars(){ $('#starN').textContent='⭐ '+STARS; $('#gmStars').textContent=STARS; }
function confetti(host){
  const cols=['#ffb83d','#45d6c9','#ff6f61','#8a5cd6','#2f7ad6','#7bd36a'];
  for(let i=0;i<40;i++){ const s=document.createElement('i'); s.className='cf'; s.style.left=(Math.random()*100)+'%'; s.style.background=cols[i%cols.length]; s.style.animationDelay=(Math.random()*0.5)+'s'; s.style.animationDuration=(1.6+Math.random()*1.2)+'s'; host.appendChild(s); setTimeout(()=>s.remove(),3500); }
}

/* ================= 貼紙簿 ================= */
let STICK=new Set(); try{STICK=new Set(JSON.parse(localStorage.getItem('windglobe-stickers')||'[]'));}catch(e){}
function addSticker(f){
  if(STICK.has(f.id)) return;
  STICK.add(f.id); try{localStorage.setItem('windglobe-stickers',JSON.stringify([...STICK]));}catch(e){}
  toast(tr('得到新貼紙：{f}！（{a}/{b}）',{f:f.ns,a:STICK.size,b:FARMS.length})); say(tr('得到新貼紙，{f}',{f:f.ns}));
  updBook();
}
function stickerSVG(k){ const c=k==='off'?'#2f7ad6':k==='float'?'#8a5cd6':k==='ret'?'#8a96a3':'#0b8a9a';
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="${c}" opacity=".15"/><path d="M23 19 L22 44 L26 44 L25 19Z" fill="${c}"/><g><path d="M24 19 L22.6 4 Q24 2.5 25.4 4Z" fill="${c}"/><path d="M24 19 L22.6 4 Q24 2.5 25.4 4Z" fill="${c}" transform="rotate(120 24 19)"/><path d="M24 19 L22.6 4 Q24 2.5 25.4 4Z" fill="${c}" transform="rotate(240 24 19)"/></g><circle cx="24" cy="19" r="2.6" fill="#ffb83d"/></svg>`; }
function updBook(){
  $('#bkCount').textContent=`${STICK.size} / ${FARMS.length}`;
  const grid=$('#bkGrid'); grid.innerHTML='';
  for(const f of FARMS){
    const got=STICK.has(f.id), b=document.createElement('button'); b.className='stk'+(got?'':' locked');
    b.innerHTML=got?stickerSVG(f.st==='ret'?'ret':f.k)+'<span></span>':'<div class="q">？</div><span></span>';
    b.querySelector('span').textContent=got?f.ns:f.c.split('・')[0];
    if(got) b.onclick=()=>{ $('#book').hidden=true; userTook(); select(f,true); };
    grid.appendChild(b);
  }
  updChecks();
}
$('#bkClose').onclick=()=>$('#book').hidden=true;

/* ================= 小遊戲選單 ================= */
const gmenu=$('#gmenu');
// 放空模式或環遊導覽中點小遊戲：先關掉它們，遊戲才開得起來
gmenu.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b||/^gmVoice/.test(b.id)) return; if(S.zen) setZen(false); if(S.tour) setTour(false); },true);
$('#bGames').onclick=e=>{ e.stopPropagation(); gmenu.hidden=!gmenu.hidden; };
document.addEventListener('click',e=>{ if(!gmenu.hidden&&!gmenu.contains(e.target)&&e.target.id!=='bGames') gmenu.hidden=true; });
$('#gmFind').onclick=()=>{ gmenu.hidden=true; startFind(); };
$('#gmBlow').onclick=()=>{ gmenu.hidden=true; const f=S.sel&&S.sel.tur?S.sel:byId.gch; userTook(); select(f,true); setTimeout(()=>open3D(specForFarm(f)),600); };
$('#gmBook').onclick=()=>{ gmenu.hidden=true; updBook(); $('#book').hidden=false; };
$('#gmVoice').onclick=()=>{ S.voice=!S.voice; if(!S.voice) sayStop(); $('#gmVoice').setAttribute('aria-pressed',S.voice); $('#gmVoice').textContent=tr(S.voice?'語音朗讀：開':'語音朗讀：關'); };
$('#gmVoiceSel').onchange=e=>{ voiceId=e.target.value; try{localStorage.setItem('windglobe-voice3',voiceId);}catch(err){} $('#gmVoiceTry').click(); };
$('#gmVoiceTry').onclick=()=>{ const v=S.voice; S.voice=true; say(tr('你好，我是風車地球的小幫手！一起來看風車吧！')); S.voice=v; };

/* ================= 遊戲一：找找看 ================= */
const GT=[[158,'台灣'],[392,'日本'],[156,'中國'],[840,'美國'],[36,'澳洲'],[826,'英國'],[76,'巴西'],[356,'印度'],[10,'南極洲'],[124,'加拿大'],[276,'德國'],[818,'埃及'],[404,'肯亞'],[710,'南非'],[643,'俄羅斯'],[484,'墨西哥'],[208,'丹麥'],[578,'挪威'],[32,'阿根廷'],[410,'韓國'],[608,'菲律賓'],[724,'西班牙'],[250,'法國'],[554,'紐西蘭']];
const G={on:false,list:[],i:0,tries:0,score:0,mark:null,wait:false};
function startFind(){
  select(null); if(S.tour) setTour(false); if(S.zen) setZen(false); if(DOT.on) endDots(); gamePause();
  G.on=true; G.list=d3.shuffle(GT.slice()).slice(0,8); G.i=0; G.score=0; applyLabelVis();
  $('#gbar').hidden=false; flyTo(cLon,Math.max(-40,Math.min(40,cLat)),1,1400);
  showRound();
}
function showRound(){
  G.tries=0; G.wait=false; const t=G.list[G.i];
  $('#gq').textContent=tr('第 {i}/{n} 題：{p}在哪裡？點點看！',{i:G.i+1,n:G.list.length,p:trName(t[1])}); $('#gs').textContent='⭐ '+G.score; $('#ghint').textContent=tr('轉動地球，找到後點一下。（地名先藏起來囉）');
  say(tr('找找看，{p}在哪裡？',{p:trName(t[1])}));
}
function endFind(){ G.on=false; G.mark=null; $('#gbar').hidden=true; applyLabelVis(); gameResume(); }
// 玩遊戲時先關掉背景音樂和白噪音，遊戲結束再恢復原本的狀態
let pausedAV=null;
function gamePause(){ if(pausedAV) return; pausedAV={mus:MUS.on,snd:S.sound}; if(MUS.on) setMusic(false); if(S.sound) setSound(false); }
function gameResume(){ if(!pausedAV) return; const p=pausedAV; pausedAV=null; if(G.on||DOT.on||V3.open) { pausedAV=p; return; } if(p.mus) setMusic(true); if(p.snd) setSound(true); }
function bearingName(a,b){
  const p1=a[1]*D2R,p2=b[1]*D2R,dl=(b[0]-a[0])*D2R;
  const th=Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))/D2R;
  return ['北','東北','東','東南','南','西南','西','西北'][Math.round(((th+360)%360)/45)%8]; // 原文，顯示時再翻譯
}
function nextRound(){
  G.i++;
  if(G.i>=G.list.length){
    $('#gq').textContent=tr('完成！你找到了 {n} 個地方',{n:G.score}); $('#ghint').textContent=tr('按「結束」回到地球，或從小遊戲再玩一次。');
    say(tr('完成了！你找到了 {n} 個地方，好厲害！',{n:G.score})); confetti($('#map')); G.wait=true; return;
  }
  showRound();
}
function gameClick(lon,lat){
  if(G.wait) return;
  const t=G.list[G.i], f=CF[t[0]];
  const ok=d3.geoContains(f,[lon,lat])||d3.geoDistance([lon,lat],f.anchor)*6371<250;
  G.mark={lon,lat,ok,t:performance.now()};
  if(ok){
    G.score++; addStar(); $('#gs').textContent='⭐ '+G.score;
    const farms=FARMS.filter(x=>x.c.startsWith(t[1]));
    const msg=farms.length?tr('答對了！{p}有「{f}」{more}。',{p:trName(t[1]),f:farms[0].ns,more:farms.length>1?tr('等 {n} 座風場',{n:farms.length}):''}):tr('答對了！這裡是{p}。',{p:trName(t[1])});
    $('#ghint').textContent=msg; say(msg); confetti($('#map'));
    G.wait=true; flyTo(f.anchor[0],Math.max(-70,Math.min(70,f.anchor[1])),t[0]===158?6:2.2,1600);
    setTimeout(nextRound,4200);
  }else{
    G.tries++;
    if(G.tries>=3){
      const m=tr('{p}在這裡！我們一起看看。',{p:trName(t[1])}); $('#ghint').textContent=m; say(m); G.wait=true;
      flyTo(f.anchor[0],Math.max(-70,Math.min(70,f.anchor[1])),t[0]===158?6:2.2,1600); setTimeout(nextRound,4200);
    }else{
      const dir=bearingName([lon,lat],f.anchor), d=Math.round(d3.geoDistance([lon,lat],f.anchor)*6371/100)*100;
      const m=tr('不是這裡喔！{p}在你點的地方的{d}邊，大約 {km} 公里。',{p:trName(t[1]),d:tr(dir),km:d.toLocaleString(I18N.locale)}); $('#ghint').textContent=m; say(tr('不是這裡喔，再往{d}邊找找',{d:tr(dir)}));
    }
  }
}
$('#gskip').onclick=()=>{ if(G.i<G.list.length){ G.wait=false; nextRound(); } };
$('#gend').onclick=endFind;
function drawGameMark(g){
  if(!G.mark) return; const age=(performance.now()-G.mark.t)/1000; if(age>2){G.mark=null;return;}
  const p=project(G.mark.lon,G.mark.lat); if(!p) return;
  g.globalAlpha=Math.max(0,1-age/2); g.lineWidth=3; g.strokeStyle=G.mark.ok?'#3cc46a':'#ff5a4e';
  g.beginPath(); g.arc(p[0],p[1],10+age*20,0,TAU); g.stroke();
  g.beginPath(); if(G.mark.ok){g.moveTo(p[0]-7,p[1]);g.lineTo(p[0]-2,p[1]+6);g.lineTo(p[0]+8,p[1]-6);}else{g.moveTo(p[0]-6,p[1]-6);g.lineTo(p[0]+6,p[1]+6);g.moveTo(p[0]+6,p[1]-6);g.lineTo(p[0]-6,p[1]+6);} g.stroke();
  g.globalAlpha=1;
}

/* ================= 打卡：用手機 GPS 走到風車附近（2 公里內）打卡，這一整個音樂區的風車變成七彩版 ================= */
let CHECKS=[]; try{ CHECKS=JSON.parse(localStorage.getItem('windglobe-checkins')||'[]'); }catch(e){}
function saveChecks(){ try{ localStorage.setItem('windglobe-checkins',JSON.stringify(CHECKS)); }catch(e){} }
function inZoneKey(key,lon,lat){ // 只測這一個音樂區（key 由 regionAtLL 產生）
  const m=/(z|c)(\d+)$/.exec(key); if(!m) return false;
  if(m[1]==='z'){ const z=ZONES&&ZONES[+m[2]]; if(!z) return false; const b=z.b; return lat>=b[1]&&lat<=b[3]&&lon>=b[0]&&lon<=b[2]&&inRings(z.r,lon,lat); }
  const c=CIRC[+m[2]]; return !!c&&inEllipse(c,lon,lat);
}
function zoneBox(key){
  const m=/(z|c)(\d+)$/.exec(key); if(!m) return null;
  if(m[1]==='z'){ const z=ZONES&&ZONES[+m[2]]; return z?z.b:null; }
  const c=CIRC[+m[2]]; if(!c) return null; const dx=c.a/(111.32*Math.cos(c.lat*D2R)), dy=c.a/110.57;
  return [c.lon-dx,c.lat-dy,c.lon+dx,c.lat+dy];
}
// 依打卡紀錄把要畫成七彩版的風機記在 WT.skin（全球）與 t.skin（台灣風場）；音樂區資料更新後也會用打卡座標重新對應
function applySkins(){
  if(!ZONES) return;
  WT.skin=new Uint8Array(WT.n);
  for(const f of FARMS) if(f.tur) for(const t of f.tur) t.skin=0;
  for(const rec of CHECKS){
    const r=regionAtLL(rec.lon,rec.lat); if(!r) continue;
    rec.key=r.key; const m=1, b=zoneBox(r.key); if(!b) continue;
    for(const c of WCELLS){ if(c.cx+0.5<b[0]||c.cx-0.5>b[2]||c.cy+0.5<b[1]||c.cy-0.5>b[3]) continue;
      for(let i=c.start;i<c.start+c.n;i++){ const lon=WT.xy[2*i]/1e5, lat=WT.xy[2*i+1]/1e5; if(lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3]&&inZoneKey(r.key,lon,lat)) WT.skin[i]=m; } }
    for(const f of FARMS) if(f.tur) for(const t of f.tur) if(inZoneKey(r.key,t.lon,t.lat)) t.skin=m;
  }
  saveChecks(); vv++;
}
async function doCheckIn(lon,lat,acc){
  loadZones(); await zonesReady();
  const near=nearPts(lon,lat,2);
  if(!near.length){
    const far=nearPts(lon,lat,80);
    const msg=far.length?tr('你附近 2 公里內沒有風車，最近的一支在 {d} 公里外，走近一點再打卡！',{d:far[0].d.toFixed(1)}):tr('你附近沒有風車資料，到有風車的地方再打卡吧！');
    toast('📍 '+msg,5000); say(far.length?tr('你附近 2 公里內沒有風車，走近一點再打卡！'):msg); return;
  }
  const t=near[0], r=regionAtLL(t.lon,t.lat);
  const key=r?r.key:`p${t.lon.toFixed(3)},${t.lat.toFixed(3)}`, name=r?r.name:'這裡的風車';
  const done=CHECKS.find(c=>c.key===key||(Math.abs(c.lon-t.lon)<0.002&&Math.abs(c.lat-t.lat)<0.002));
  flyTo(t.lon,t.lat,0,2200,0.5*Math.min(W,H)/3);
  if(done){ toast('📍 '+tr('{n}已經打過卡囉！這裡的風車已經是七彩版了',{n:trName(name)}),4000); return; }
  const m=1;
  CHECKS.push({key,name,lon:t.lon,lat:t.lat,t:Date.now(),m,acc:Math.round(acc||0)});
  applySkins(); addStar(); confetti($('#map')); updBook();
  const msg=tr('打卡成功！{n}的風車全部變成七彩版了！',{n:trName(name)});
  toast('📍 '+msg,5000); say(tr('打卡成功！這裡的風車全部變成七彩版了！'));
}

/* ---------- 右側欄收起／打開（記在這台裝置） ---------- */
function setSide(on){ $('#stage').classList.toggle('side-off',!on); $('#sideShow').hidden=on; try{localStorage.setItem('windglobe-side',on?'1':'0');}catch(e){} }
$('#sideHide').onclick=()=>setSide(false);
$('#sideShow').onclick=()=>setSide(true);
try{ if(localStorage.getItem('windglobe-side')==='0') setSide(false); }catch(e){}

/* ---------- 定位我的位置：飛過去，畫一個會呼吸的藍點「你在這裡」＋誤差範圍圈 ---------- */
let ME=null;
function locateMe(){
  const b=$('#bLocate');
  if(!navigator.geolocation){ toast(tr('這個瀏覽器沒辦法定位，換手機的瀏覽器試試看')); return; }
  b.classList.remove('found'); b.classList.add('busy');
  navigator.geolocation.getCurrentPosition(p=>{
    b.classList.remove('busy'); void b.offsetWidth; b.classList.add('found');
    const lon=p.coords.longitude, lat=p.coords.latitude, acc=p.coords.accuracy||0;
    ME={lon,lat,acc,t:performance.now()};
    userTook(); if(S.zen) setZen(false);
    flyTo(lon,lat,0,1800,Math.min(W,H)/Math.max(8,acc/1000*6));
    const near=nearPts(lon,lat,80);
    const msg=near.length?(near[0].d<2?tr('你在這裡！附近 2 公里內有 {n} 支風車，可以按「打卡」喔',{n:near.filter(x=>x.d<2).length}):tr('你在這裡！離你最近的風車在 {d} 公里外',{d:near[0].d.toFixed(1)})):tr('你在這裡！附近 80 公里內沒有風車');
    toast('📍 '+msg+(acc>3000?tr('（定位誤差約 {d} 公里）',{d:Math.round(acc/1000)}):''),5000);
  },e=>{
    b.classList.remove('busy');
    toast(tr(e.code===1?'沒有允許使用位置（可以在瀏覽器的網站設定裡打開）':'定位失敗，到空曠一點的地方再試一次'),5000);
  },{enableHighAccuracy:true,timeout:20000,maximumAge:30000});
}
$('#bLocate').onclick=locateMe;
function drawMe(g){
  if(!ME) return; const q=project(ME.lon,ME.lat); if(!q) return;
  const now=performance.now(), blue='#4A8FF5';
  const ar=ME.acc/1000*kmPx; // 誤差範圍（公尺換成畫面像素）
  if(ar>14&&ar<Math.max(W,H)){ g.fillStyle='rgba(74,143,245,.12)'; g.strokeStyle='rgba(74,143,245,.45)'; g.lineWidth=1.5; g.beginPath(); g.arc(q[0],q[1],ar,0,TAU); g.fill(); g.stroke(); }
  for(let k=0;k<2;k++){ const ph=((now/1600)+k*0.5)%1; g.strokeStyle=`rgba(74,143,245,${0.55*(1-ph)})`; g.lineWidth=3; g.beginPath(); g.arc(q[0],q[1],10+ph*30,0,TAU); g.stroke(); }
  g.fillStyle='#fff'; g.beginPath(); g.arc(q[0],q[1],11,0,TAU); g.fill();
  g.fillStyle=blue; g.beginPath(); g.arc(q[0],q[1],7.5,0,TAU); g.fill();
  g.font='800 12px "Noto Sans TC",sans-serif'; g.textAlign='center'; g.textBaseline='middle';
  const meT=tr('你在這裡'), tw=g.measureText(meT).width+16, ly=q[1]-26;
  g.fillStyle=blue; g.beginPath(); g.roundRect?g.roundRect(q[0]-tw/2,ly-10,tw,20,10):g.rect(q[0]-tw/2,ly-10,tw,20); g.fill();
  g.beginPath(); g.moveTo(q[0]-5,ly+9); g.lineTo(q[0]+5,ly+9); g.lineTo(q[0],ly+15); g.fill();
  g.fillStyle='#fff'; g.fillText(meT,q[0],ly+0.5); g.textAlign='start';
}
$('#bCheck').onclick=()=>{
  if(!navigator.geolocation){ toast(tr('這個瀏覽器沒辦法定位，換手機的瀏覽器試試看')); return; }
  toast(tr('📍 定位中⋯（請允許網頁使用你的位置）'),4000);
  navigator.geolocation.getCurrentPosition(
    p=>{ if(p.coords.accuracy>3000) toast(tr('定位誤差約 {d} 公里，可能不夠準，到戶外再試一次會比較好',{d:Math.round(p.coords.accuracy/1000)}),4000);
      doCheckIn(p.coords.longitude,p.coords.latitude,p.coords.accuracy); },
    e=>toast(tr(e.code===1?'沒有允許使用位置，所以沒辦法打卡（可以在瀏覽器的網站設定裡打開）':'定位失敗，到空曠一點的地方再試一次'),5000),
    {enableHighAccuracy:true,timeout:20000,maximumAge:60000});
};
function updChecks(){
  const el=$('#bkChecks'); if(!el) return; el.innerHTML='';
  $('#bkCheckN').textContent=CHECKS.length?tr('（{n} 個地方）',{n:CHECKS.length}):'';
  if(!CHECKS.length){ el.innerHTML='<p class="bk-none"></p>'; el.firstChild.textContent=tr('還沒有打卡紀錄。到有風車的地方，按地圖右邊的「📍 打卡」，那裡的風車就會變成七彩版！'); return; }
  for(const c of CHECKS.slice().reverse()){
    const b=document.createElement('button'), d=new Date(c.t); b.className='ck';
    b.innerHTML='<b></b><span></span><small></small>';
    b.querySelector('b').textContent='📍 '+trName(c.name); b.querySelector('span').textContent=tr('七彩版');
    b.querySelector('small').textContent=`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
    b.onclick=()=>{ $('#book').hidden=true; userTook(); flyTo(c.lon,c.lat,0,2200,0.5*Math.min(W,H)/3); };
    el.append(b);
  }
}

/* ================= 遊戲三：風車點點樂（點風車彈兒歌、照順序連線數數字或 ABC） ================= */
const DOT={seq:0,on:false,mode:'num',n:10,pts:[],next:0,done:false,glows:[],hintT:0,ac:null,r:16};
try{ const d=JSON.parse(localStorage.getItem('windglobe-dots')||'null'); if(d&&['num','abc'].includes(d.m)&&[10,26,50,100].includes(d.n)){ DOT.mode=d.m; DOT.n=d.m==='abc'?26:d.n; } }catch(e){} // A–J 已取消，存過的 A–J 改成 A–Z
const NOTE_HZ=[261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25,587.33,659.25,698.46,783.99];
const SOLFA=['Do','Re','Mi','Fa','So','La','Si','Do','Re','Mi','Fa','So'];
const CN_NUM='一二三四五六七八九十';
// 中文數字（1～100），唸數字用；tools/build_voice.py 的 cn_num() 要一模一樣
const cnNum=n=>{ const d='一二三四五六七八九'; if(n===100) return '一百'; if(n<=10) return CN_NUM[n-1]; const t=Math.floor(n/10), o=n%10; return (t===1?'':d[t-1])+'十'+(o?d[o-1]:''); };
const dotSay=i=>DOT.mode==='abc'?String.fromCharCode(65+i):I18N.zh?cnNum(i+1):String(i+1); // 外語直接唸阿拉伯數字
function dotNote(i,dur=0.9){
  try{
    if(!DOT.ac) DOT.ac=new (window.AudioContext||window.webkitAudioContext)();
    const ac=DOT.ac, t=ac.currentTime, f=NOTE_HZ[Math.max(0,Math.min(NOTE_HZ.length-1,i))];
    ac.resume();
    // 像音樂盒：三角波＋高八度正弦，快速起音、慢慢消失
    for(const [type,mul,vol] of [['triangle',1,0.22],['sine',2,0.07]]){
      const o=ac.createOscillator(), g=ac.createGain(); o.type=type; o.frequency.value=f*mul;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t+dur+0.05);
    }
  }catch(e){}
}
// 公版兒歌（都是作者過世很久的傳統歌曲）：音名＋八度（預設 4），冒號後面是拍數（預設 1 拍）
const SONGS=[
  {n:'小星星',m:'C C G G A A G:2 F F E E D D C:2 G G F F E E D:2 G G F F E E D:2 C C G G A A G:2 F F E E D D C:2'},
  {n:'生日快樂',m:'G3:.75 G3:.25 A3 G3 C B3:2 G3:.75 G3:.25 A3 G3 D C:2 G3:.75 G3:.25 G E C B3 A3:2 F:.75 F:.25 E C D C:2'},
  {n:'兩隻老虎',m:'C D E C C D E C E F G:2 E F G:2 G:.5 A:.5 G:.5 F:.5 E C G:.5 A:.5 G:.5 F:.5 E C C G3 C:2 C G3 C:2'},
  {n:'瑪莉有隻小綿羊',m:'E D C D E E E:2 D D D:2 E G G:2 E D C D E E E E D D E D C:3'},
  {n:'小蜜蜂',m:'G E E:2 F D D:2 C D E F G G G:2 G E E:2 F D D:2 C E G G E:3'},
  {n:'倫敦鐵橋',m:'G:1.5 A:.5 G F E F G:2 D E F:2 E F G:2 G:1.5 A:.5 G F E F G:2 D:2 G:2 E C:3'},
  {n:'歡樂頌',m:'E E F G G F E D C C D E E:1.5 D:.5 D:2 E E F G G F E D C C D E D:1.5 C:.5 C:2'},
  {n:'王老先生有塊地',m:'C C C G3 A3 A3 G3:2 E E D D C:3 G3 C C C G3 A3 A3 G3:2 E E D D C:3'},
  {n:'划船歌',m:'C:1.5 C:1.5 C D:.5 E:1.5 E D:.5 E F:.5 G:3 C5:.5 C5:.5 C5:.5 G:.5 G:.5 G:.5 E:.5 E:.5 E:.5 C:.5 C:.5 C:.5 G F:.5 E D:.5 C:3'},
].map(x=>({n:x.n,notes:x.m.split(' ').map(tk=>{ const [a,b]=tk.split(':'), m=/^([A-G])(#?)(\d?)$/.exec(a);
  return [12*((+m[3]||4)+1)+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]?1:0), b?+b:1]; })}));
const SONG={i:0,pos:0,told:-1,auto:0};
try{ SONG.i=(+localStorage.getItem('windglobe-song')||0)%SONGS.length; }catch(e){}
function playMidi(m,dur=0.9,delay=0){
  try{
    if(!DOT.ac) DOT.ac=new (window.AudioContext||window.webkitAudioContext)();
    const ac=DOT.ac, t=ac.currentTime+delay, f=440*Math.pow(2,(m-69)/12); ac.resume();
    for(const [type,mul,vol] of [['triangle',1,0.22],['sine',2,0.07]]){
      const o=ac.createOscillator(), g=ac.createGain(); o.type=type; o.frequency.value=f*mul;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t+dur+0.05);
    }
  }catch(e){}
}
const songName=()=>tr(SONGS[SONG.i].n);
// 彈下一個音；整首彈完回傳 true（換下一首）
function songStep(){
  const S_=SONGS[SONG.i]; if(SONG.told!==SONG.i&&SONG.pos===0){ SONG.told=SONG.i; toast(tr('🎵 點風車，一個音一個音彈出《{s}》',{s:songName()}),3000); }
  const [m,b]=S_.notes[SONG.pos]; playMidi(m,Math.min(1.6,0.5+b*0.4)); SONG.pos++;
  if(SONG.pos<S_.notes.length) return m;
  toast(tr('🎉 《{s}》彈完了！再聽一次完整的',{s:songName()}),3000); songAuto(SONG.i,0.9);
  SONG.pos=0; SONG.i=(SONG.i+1)%SONGS.length; try{ localStorage.setItem('windglobe-song',SONG.i); }catch(e){}
  return m;
}
// 自動彈整首（照拍子）
function songAuto(i,wait=0){
  const tok=++SONG.auto, beat=0.42; let t=wait;
  for(const [m,b] of SONGS[i].notes){ const d=t; setTimeout(()=>{ if(tok===SONG.auto) playMidi(m,Math.min(1.4,0.35+b*beat)); },d*1000); t+=b*beat; }
  return t;
}
function dotBuzz(){
  try{
    if(!DOT.ac) DOT.ac=new (window.AudioContext||window.webkitAudioContext)();
    const ac=DOT.ac, t=ac.currentTime, o=ac.createOscillator(), g=ac.createGain();
    o.type='square'; o.frequency.setValueAtTime(180,t); o.frequency.linearRampToValueAtTime(120,t+0.2);
    g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.25); o.connect(g).connect(ac.destination); o.start(t); o.stop(t+0.3);
  }catch(e){}
}
// 連連看用的飛行：k＝每公里幾個畫面像素（MapLibre 一格 512 像素），停穩後才挑點；新的飛行會取消舊的
function dotFly(lon,lat,k,dur){
  const seq=++DOT.seq, z=Math.log2(k*40075.016686*Math.cos(lat*D2R)/512);
  fly=true; map.flyTo({center:[lon,lat],zoom:Math.max(1,Math.min(16,z)),pitch:0,bearing:0,duration:dur,essential:true});
  const go=()=>{ if(seq!==DOT.seq||!DOT.on||DOT.pts.length) return; if(map.isMoving()){ setTimeout(go,300); return; } vv++; setTimeout(()=>{ if(seq===DOT.seq&&DOT.on&&!DOT.pts.length) pickDots(); },350); };
  map.once('moveend',()=>setTimeout(go,250)); setTimeout(go,dur+2500);
}
const dotLabel=i=>DOT.mode==='abc'?String.fromCharCode(65+i):String(i+1);
function startDots(mode,n){
  select(null); if(S.tour) setTour(false); if(S.zen) setZen(false); if(G.on) endFind(); gamePause();
  DOT.on=true; DOT.tries=0; DOT.zoomTries=0; DOT.waits=0; DOT.mode=mode||DOT.mode; DOT.n=n||DOT.n; if(DOT.mode==='abc') DOT.n=Math.min(26,DOT.n); DOT.pts=[]; DOT.next=0; DOT.done=false; DOT.glows=[];
  try{localStorage.setItem('windglobe-dots',JSON.stringify({m:DOT.mode,n:DOT.n}));}catch(e){}
  applyLabelVis();
  $('#dbar').hidden=false; for(const b of $('#dmodes').children) b.setAttribute('aria-pressed',b.dataset.m===DOT.mode&&+b.dataset.n===DOT.n);
  $('#dq').textContent=tr('找風車中⋯'); $('#dhint').textContent='';
  const enough=kmPx>=0.8&&WC.mode===2&&WC.list.length/4+tPick.length>=Math.max(12,DOT.n*1.5);
  if(enough){ const seq=++DOT.seq; setTimeout(()=>{ if(seq===DOT.seq) pickDots(); },60); }
  else{ // 畫面上的風車不夠：飛到選中的風場，沒有就飛到大彰化
    const f=(S.sel&&S.sel.tur)?S.sel:byId.gch;
    dotFly(f.lon,f.lat,Math.max(2.4,0.5*Math.min(W,H)/(f.extKm*(DOT.n>=100?3.2:DOT.n>=50?2.2:1))),2000);
  }
}
function pickDots(){
  if(!DOT.on) return;
  // 拉太遠時風機是一團一團的點，不是一支一支：先放大到看得到每一支風機再挑
  if(kmPx<2.2&&(DOT.zoomTries||0)<2){ DOT.zoomTries=(DOT.zoomTries||0)+1; dotFly(cLon,cLat,2.6,1200); return; }
  if(WC.mode!==2&&(DOT.waits||0)<10){ DOT.waits=(DOT.waits||0)+1; vv++; const seq=DOT.seq; setTimeout(()=>{ if(seq===DOT.seq) pickDots(); },200); return; } // 畫面還沒換成一支一支的風機，等一下下
  // 候選：畫面中間區域、目前畫得出來的風車（風場的與全球的）
  const cand=[];
  for(const t of tPick) cand.push([t[0],t[1],t[3].lon,t[3].lat]);
  if(WC.mode===2) for(let k=0;k<WC.list.length;k+=4){ const i=WC.list[k+2]; cand.push([WC.list[k],WC.list[k+1],WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5]); }
  const mr=$('#map').getBoundingClientRect(), br=$('#dbar').getBoundingClientRect(), top=Math.max(H*0.12,br.bottom-mr.top+18);
  // 避開側邊欄、定位鈕、全畫面鈕底下的位置（被蓋住的號碼點不到）
  const blocks=['.side','#bLocate','#bFs','#sideShow'].map(q=>$(q)).filter(el=>el&&!el.hidden&&getComputedStyle(el).opacity>0.1).map(el=>{ const r=el.getBoundingClientRect(); return [r.left-mr.left-18,r.top-mr.top-18,r.right-mr.left+18,r.bottom-mr.top+18]; });
  const inner=cand.filter(c=>c[0]>W*0.06&&c[0]<W*0.94&&c[1]>top&&c[1]<H*0.9&&!blocks.some(b=>c[0]>b[0]&&c[0]<b[2]&&c[1]>b[1]&&c[1]<b[3]));
  d3.shuffle(inner);
  const n=DOT.n; let pick=[], gap=Math.max(26,Math.min(Math.max(46,Math.min(W,H)*0.09),Math.sqrt(W*H*0.5/n)*0.8));
  while(true){ pick=[]; for(const c of inner){ if(pick.length>=n) break; if(pick.every(p=>Math.hypot(p[0]-c[0],p[1]-c[1])>=gap)) pick.push(c); }
    if(pick.length>=n||gap<=22) break; gap=Math.max(22,gap*0.85); }
  if(pick.length<n*0.9&&!DOT.tries){
    DOT.tries=1; $('#dq').textContent=tr('這裡的風車不夠分散，帶你去德國北部的大風場⋯');
    dotFly(9.3,53.55,Math.max(2.6,Math.min(W,H)/(n>=100?150:110)),2200); return;
  }
  if(pick.length<5){ $('#dq').textContent=tr('這裡的風車太少了，換到風車多一點的地方再按一次'); return; }
  if(pick.length<n) toast(tr('這裡只找到 {n} 支分得開的風車，這次就連 {n} 個',{n:pick.length}),3500);
  DOT.r=Math.max(10,Math.min(16,gap*0.4));
  if(pick.length<=12){ // 依繞著中心的角度排序，連起來會是一個圈圈或星星的形狀
    const cx=d3.mean(pick,p=>p[0]), cy=d3.mean(pick,p=>p[1]);
    pick.sort((a,b)=>Math.atan2(a[1]-cy,a[0]-cx)-Math.atan2(b[1]-cy,b[0]-cx));
  }else{ // 點很多：從左上角開始，每次走到最近的下一個，路線不會跳來跳去
    const rest=pick.slice(), path=[]; let cur=rest.reduce((a,b)=>a[0]+a[1]<b[0]+b[1]?a:b);
    while(rest.length){ rest.splice(rest.indexOf(cur),1); path.push(cur); if(!rest.length) break; cur=rest.reduce((a,b)=>Math.hypot(a[0]-cur[0],a[1]-cur[1])<Math.hypot(b[0]-cur[0],b[1]-cur[1])?a:b); }
    pick=path;
  }
  DOT.pts=pick.map((p,i)=>({lon:p[2],lat:p[3],label:dotLabel(i),lit:false,flash:0}));
  DOT.hintT=performance.now();
  updDotBar();
  say(tr(DOT.mode==='abc'?'連連看，從 A 開始，照順序點風車！':'連連看，從一開始，照順序點風車！'));
}
function updDotBar(){
  if(DOT.done){ $('#dq').textContent=tr('完成了！🎉'); $('#dhint').textContent=tr('換個玩法，或拖曳地圖到別的風場再玩一次。'); return; }
  const n=DOT.pts.length, l=DOT.pts[DOT.next]?DOT.pts[DOT.next].label:'';
  $('#dq').textContent=tr('連連看：{a} → {b}，下一個是「{l}」',{a:dotLabel(0),b:dotLabel(n-1),l});
  $('#dhint').textContent=tr('每點對一支，就會彈出《{s}》的下一個音（{i}/{n}）',{s:songName(),i:DOT.next,n});
}
// 平常點任何一支風車都會發出一個音（畫面越上面越高），並閃一下霓虹光
function tapNote(t,y){
  const m=songStep(), i=Math.max(0,Math.min(9,Math.round((m-60)/2))); // 光的顏色跟音高

  DOT.glows.push({lon:t.lon,lat:t.lat,t:performance.now(),i}); if(DOT.glows.length>40) DOT.glows.shift();
}
function dotClick(x,y){
  const now=performance.now();
  if(DOT.done||!DOT.pts.length) return;
  let best=-1,bd=TAP_R>20?52:36; // 連連看也放大一點
  DOT.pts.forEach((p,k)=>{ const q=project(p.lon,p.lat); if(!q) return; const d=Math.hypot(q[0]-x,q[1]-6-y); if(d<bd){bd=d;best=k;} });
  if(best<0) return;
  if(best===DOT.next){
    const p=DOT.pts[best]; p.lit=true; p.flash=now; { const nt=SONGS[SONG.i].notes; playMidi(nt[best%nt.length][0]); }
    say(dotSay(best));
    DOT.next++; DOT.hintT=now;
    if(DOT.next>=DOT.pts.length){
      DOT.done=true; addStar(); confetti($('#map'));
      const step=Math.min(140,2800/DOT.pts.length);
      const song=SONG.i, len=songAuto(song,0.7); SONG.i=(SONG.i+1)%SONGS.length; SONG.pos=0; // 全部連起來：自動彈完整首，下一局換一首
      DOT.pts.forEach((q,k)=>setTimeout(()=>{ q.flash=performance.now(); },700+k*Math.min(140,len*1000/DOT.pts.length)));
      toast(tr('🎉 送你一首《{s}》',{s:tr(SONGS[song].n)}),3500);
      const N=DOT.pts.length;
      setTimeout(()=>say(N>10?tr('太棒了！全部連起來了！'):DOT.mode==='abc'?tr('太棒了！A 到 {x} 全部連起來了！',{x:DOT.pts[N-1].label}):tr('太棒了！一到{x}全部連起來了！',{x:dotSay(N-1)})),700+N*step);
    }
    updDotBar();
  }else if(!DOT.pts[best].lit){
    dotBuzz(); DOT.pts[DOT.next].flash=now;
    say(tr('不是這個喔，找找「{x}」在哪裡',{x:dotSay(DOT.next)}));
  }
}
function endDots(){ DOT.seq++; DOT.on=false; DOT.pts=[]; $('#dbar').hidden=true; applyLabelVis(); gameResume(); }
function drawDots(g){
  if(!DOT.on&&!DOT.glows.length) return;
  const now=performance.now(), neon=(col,blur)=>{ g.shadowColor=col; g.shadowBlur=blur; };
  if(DOT.on&&DOT.pts.length){ g.fillStyle=C.dark?'rgba(4,10,22,.62)':'rgba(236,242,248,.68)'; g.fillRect(0,0,W,H); }
  g.save(); g.lineCap='round'; g.lineJoin='round';
  const pp=DOT.pts.map(p=>project(p.lon,p.lat));
  // 已經連好的霓虹線
  if(DOT.next>1){
    g.beginPath(); let on=false;
    for(let k=0;k<DOT.next;k++){ const q=pp[k]; if(!q){on=false;continue;} if(on) g.lineTo(q[0],q[1]-6); else g.moveTo(q[0],q[1]-6); on=true; }
    if(DOT.done&&pp[0]&&pp[DOT.pts.length-1]) g.lineTo(pp[0][0],pp[0][1]-6);
    neon('#ff4fd8',16); g.strokeStyle='rgba(255,90,220,.9)'; g.lineWidth=4; g.stroke();
    g.shadowBlur=0; g.strokeStyle='#ffe6fb'; g.lineWidth=1.5; g.stroke();
  }
  // 風車上的霓虹圈與號碼：已點亮青色、下一個黃色（太久沒點會閃）、其他紫色
  const R0=DOT.r; g.font=`800 ${Math.round(R0*0.9)}px Sora,"Noto Sans TC",sans-serif`; g.textAlign='center'; g.textBaseline='middle';
  DOT.pts.forEach((p,k)=>{
    const q=pp[k]; if(!q) return;
    const fl=Math.max(0,1-(now-p.flash)/700), isNext=k===DOT.next&&!DOT.done, hint=isNext&&now-DOT.hintT>6000;
    const r=R0+fl*10+(isNext?Math.sin(now/220)*2:0);
    neon(p.lit?'#4ff7ff':isNext?'#ffd84f':'#c48bff',p.lit?22:hint?26:12);
    g.beginPath(); g.arc(q[0],q[1]-6,r,0,TAU);
    g.strokeStyle=p.lit?'rgba(79,247,255,.95)':isNext?`rgba(255,216,79,${hint?0.6+0.4*Math.sin(now/120):0.95})`:'rgba(196,139,255,.7)';
    g.lineWidth=p.lit?4:3; g.stroke();
    g.shadowBlur=0; g.fillStyle=p.lit?'rgba(10,40,60,.75)':'rgba(30,10,50,.65)'; g.beginPath(); g.arc(q[0],q[1]-6,r-4,0,TAU); g.fill();
    g.fillStyle=p.lit?'#bdfcff':'#ffffff'; g.fillText(p.label,q[0],q[1]-5);
  });
  // 點過的風車閃一下霓虹光（每個音不同顏色）
  for(const gl of DOT.glows){
    const a=1-(now-gl.t)/900; if(a<=0) continue; const q=project(gl.lon,gl.lat); if(!q) continue;
    const hue=200+gl.i*16; neon(`hsl(${hue},100%,65%)`,24*a);
    g.beginPath(); g.arc(q[0],q[1]-10,14+(1-a)*26,0,TAU); g.strokeStyle=`hsla(${hue},100%,70%,${a})`; g.lineWidth=4; g.stroke();
  }
  g.restore(); g.textAlign='start';
}
$('#gmDots').onclick=()=>{ gmenu.hidden=true; startDots(DOT.mode); };
$('#dmodes').onclick=e=>{ const b=e.target.closest('button'); if(b&&b.dataset.m) startDots(b.dataset.m,+b.dataset.n); };
$('#dend').onclick=endDots;

/* ================= 背景音樂（原創，程式即時演奏） ================= */
// D 大調，16 小節循環；豎琴分解和弦＋長笛旋律＋弦樂墊音＋鐘聲，旋律每 32 小節依種子重新生成
const MUS={on:false,ac:null,out:null,rev:null,timer:0,step:0,next:0,bar:0,mel:[],seed:7,vol:0.6};
const CHORDS=[[50,57,62,66],[49,57,61,64],[47,54,59,62],[43,55,59,62],[40,55,59,64],[43,55,62,67],[45,57,62,64],[45,57,61,64],
              [50,57,62,66],[54,57,61,66],[43,55,59,62],[42,57,62,66],[40,55,59,64],[45,57,61,64],[47,54,59,62],[45,57,61,64]];
const PENTA=[2,4,6,9,11];
const mtof=m=>440*Math.pow(2,(m-69)/12);
function musBuild(){
  const ac=new (window.AudioContext||window.webkitAudioContext)(); MUS.ac=ac;
  MUS.out=ac.createGain(); MUS.out.gain.value=0; MUS.out.connect(ac.destination);
  const len=ac.sampleRate*3.2, ir=ac.createBuffer(2,len,ac.sampleRate);
  for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);}
  MUS.rev=ac.createConvolver(); MUS.rev.buffer=ir; const rg=ac.createGain(); rg.gain.value=0.55; MUS.rev.connect(rg).connect(MUS.out);
}
function voice(type,freq,t,dur,vol,{a=0.01,r=0.4,vib=0,det=0,lp=0,send=0.5}={}){
  const ac=MUS.ac, o=ac.createOscillator(), g=ac.createGain();
  o.type=type; o.frequency.value=freq; if(det) o.detune.value=det;
  if(vib){const l=ac.createOscillator(),lg=ac.createGain();l.frequency.value=5.2;lg.gain.value=freq*vib;l.connect(lg).connect(o.frequency);l.start(t);l.stop(t+dur+r+0.1);}
  let node=o; if(lp){const f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=lp;o.connect(f);node=f;}
  node.connect(g);
  g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol,t+a); g.gain.setValueAtTime(vol,t+Math.max(a,dur-0.02)); g.gain.exponentialRampToValueAtTime(0.0001,t+dur+r);
  g.connect(MUS.out); if(send){const s=ac.createGain();s.gain.value=send;g.connect(s).connect(MUS.rev);}
  o.start(t); o.stop(t+dur+r+0.05);
}
function genMelody(seed){
  const r=mulberry32(seed), rhythms=[[2,1,1],[1,1,2],[3,1],[1,0.5,0.5,2],[4],[2,2],[1.5,0.5,2]], bars=[];
  let prev=74;
  const motif=[]; for(let b=0;b<4;b++) motif.push(rhythms[Math.floor(r()*rhythms.length)]);
  for(let b=0;b<16;b++){
    const rh=(b%8<4)?motif[b%4]:(b%8===7?[4]:rhythms[Math.floor(r()*rhythms.length)]);
    const ch=CHORDS[b], notes=[]; let beat=0;
    for(let k=0;k<rh.length;k++){
      let m;
      if(k===0){ const cand=[]; for(const c of ch) for(let o=-12;o<=24;o+=12){const v=c+o; if(v>=69&&v<=88) cand.push(v);} cand.sort((x,y)=>Math.abs(x-prev)-Math.abs(y-prev)); m=cand[Math.floor(r()*Math.min(2,cand.length))]; }
      else { const step=[-2,-1,1,2][Math.floor(r()*4)]; const pcs=[]; for(let v=67;v<=90;v++) if(PENTA.includes(v%12)) pcs.push(v); let idx=pcs.findIndex(v=>v>=prev); if(idx<0) idx=pcs.length-1; m=pcs[Math.max(0,Math.min(pcs.length-1,idx+step))]; }
      if(r()<0.12&&k>0){ beat+=rh[k]; continue; }
      notes.push([beat,rh[k],m]); prev=m; beat+=rh[k];
    }
    bars.push(notes);
  }
  return bars;
}
const BPM=78, SPB=60/BPM;
function musSchedule(){
  const ac=MUS.ac;
  while(MUS.next<ac.currentTime+0.4){
    const t=MUS.next, st=MUS.step, bar=Math.floor(st/8)%16, e=st%8;
    if(bar===0&&e===0&&st>0&&Math.floor(st/8)%32===0){ MUS.seed++; MUS.mel=genMelody(MUS.seed); }
    const ch=CHORDS[bar];
    if(e===0){
      for(const m of ch.slice(1)) voice('sawtooth',mtof(m),t,SPB*4-0.1,0.018,{a:1.0,r:1.4,det:(Math.random()-0.5)*14,lp:1000,send:0.7});
      voice('sine',mtof(ch[0]-12),t,SPB*4-0.2,0.10,{a:0.2,r:0.8,send:0.2});
      for(const n of MUS.mel[bar]||[]) voice('sine',mtof(n[2]),t+n[0]*SPB,n[1]*SPB*0.92,0.055,{a:0.06,r:0.35,vib:0.004,send:0.6});
      if(bar%2===1) voice('triangle',mtof(ch[2]+24),t+SPB*2.5,0.15,0.03,{a:0.005,r:2.2,send:0.9});
    }
    const arp=[0,1,2,3,2,3,1,2], m=ch[arp[e]]+(e>=3&&e<=5?12:0)+12;
    voice('triangle',mtof(m),t,0.08,0.04,{a:0.004,r:1.3,send:0.6});
    voice('sine',mtof(m+12),t,0.05,0.012,{a:0.004,r:0.9,send:0.5});
    MUS.step++; MUS.next+=SPB/2;
  }
}
function setSynth(on){
  try{
    if(on){
      if(!MUS.ac){ musBuild(); MUS.mel=genMelody(MUS.seed); }
      MUS.ac.resume(); MUS.next=MUS.ac.currentTime+0.1;
      MUS.out.gain.cancelScheduledValues(MUS.ac.currentTime); MUS.out.gain.setTargetAtTime(0.32*MUS.vol,MUS.ac.currentTime,0.6);
      clearInterval(MUS.timer); MUS.timer=setInterval(musSchedule,60);
    }else if(MUS.ac){
      MUS.out.gain.setTargetAtTime(0,MUS.ac.currentTime,0.4);
      setTimeout(()=>{ if(!MUS.on) clearInterval(MUS.timer); },1500);
    }
  }catch(e){ MUS.on=false; $('#bMus').setAttribute('aria-pressed',false); }
}

/* ================= 背景音樂：Music/ 資料夾的 mp3，依地區輪播（歌單 data/music.json） ================= */
// 地圖中心在台灣時依序輪播 taiwan 清單（每跨一個縣市換下一首）；其他地方每到一個新的省／州，就從其餘曲目隨機換一首。
// 換地區時等 3 秒再淡出換歌，飛過去不會一直切；拉遠看整顆地球時不換
const PL={dir:'Music/',tw:[],rest:[],el:null,region:null,want:null,wantT:0,twIdx:-1,recent:[],v:0,target:0,failed:0,synth:false,names:{}};
if(PLD&&Array.isArray(PLD.files)){ PL.dir=PLD.dir||PL.dir; PL.tw=(PLD.taiwan||[]).filter(f=>PLD.files.includes(f)); PL.rest=PLD.files.filter(f=>!PL.tw.includes(f)); }
const MP3_VOL=0.55;
// 音樂區＝30 支以上相鄰風機圍成的圓滑區塊，沿行政區切開；不到 30 支的小群（包括只有 1 支）各用一個圓圈住（data/music-zones.json，由 tools/build_music_zones.py 產生，
// 第一次播音樂時才下載）。地圖中心進入一個音樂區就換歌，在區外維持原本的歌；台灣的音樂區依序播台灣歌單
let ZONES=null, CIRC=[], zonesLoading=false;
let ZP=null;
const zonesReady=()=>ZP||Promise.resolve();
function loadZones(){
  if(ZONES||zonesLoading) return ZP; zonesLoading=true;
  ZP=getJSON('data/music-zones.json').then(d=>{
    const q=d.q||1000;
    ZONES=d.zones.map(z=>({n:z.n,tw:!!z.tw,w:z.w,b:z.b.map(v=>v/q),r:z.r.map(a=>{ const o=new Float32Array(a.length); let x=0,y=0;
      for(let k=0;k<a.length;k+=2){ x+=a[k]; y+=a[k+1]; o[k]=x/q; o[k+1]=y/q; } return o; })}));
    // 不到 30 支的小群：[經度×q, 緯度×q, 半徑公尺, 風機數, 名稱編號, 台灣]
    // 不到 30 支的小群：[經度×q, 緯度×q, 長半軸公尺, 短半軸公尺, 長軸方向（0.1 度）, 風機數, 名稱編號, 台灣]
    CIRC=(d.circles||[]).map(c=>({lon:c[0]/q,lat:c[1]/q,a:c[2]/1000,b:c[3]/1000,ang:c[4]/10*D2R,n:(d.names||[])[c[6]]||'',tw:!!c[7]}));
    colorZones(); lastRegT=-1e9; setMusicBorderData(); applySkins();
  }).catch(e=>{ console.error(e); zonesLoading=false; });
}
function inRings(rings,x,y){ // 奇偶規則，內環自然扣掉
  let ins=false;
  for(const a of rings) for(let i=0,j=a.length-2;i<a.length;j=i,i+=2){
    const xi=a[i],yi=a[i+1],xj=a[j],yj=a[j+1];
    if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins;
  }
  return ins;
}
function inEllipse(c,lon,lat,kx=111.32*Math.cos(lat*D2R)){
  const dy=(lat-c.lat)*110.57; if(Math.abs(dy)>c.a) return false;
  const dx=(((lon-c.lon)%360+540)%360-180)*kx; if(Math.abs(dx)>c.a) return false;
  const u=dx*Math.cos(c.ang)+dy*Math.sin(c.ang), v=-dx*Math.sin(c.ang)+dy*Math.cos(c.ang);
  return (u/c.a)**2+(v/c.b)**2<=1;
}
// 回傳 {key, name, tw}；不在任何音樂區裡回傳 null
function regionAtLL(lon,lat){
  if(!ZONES) return null;
  for(let k=0;k<ZONES.length;k++){
    const z=ZONES[k], b=z.b; if(lat<b[1]||lat>b[3]||lon<b[0]||lon>b[2]) continue;
    if(inRings(z.r,lon,lat)) return {key:(z.tw?'tw:':'')+'z'+k,name:z.n,tw:z.tw};
  }
  const kx=111.32*Math.cos(lat*D2R);
  for(let k=0;k<CIRC.length;k++){
    if(inEllipse(CIRC[k],lon,lat,kx)) return {key:(CIRC[k].tw?'tw:':'')+'c'+k,name:CIRC[k].n,tw:CIRC[k].tw};
  }
  return null;
}
let lastReg=null, lastRegT=-1e9;
function musRegion(now=performance.now()){
  if(S.zen) return 'zen'; // 放空模式：一直隨機播放，不跟著音樂區換歌
  if(Z<1.8) return PL.region||'world'; // 看整顆地球時維持原本的歌
  if(Math.abs(now-lastRegT)>400){ lastRegT=now; const r=regionAtLL(cLon,cLat); if(r) lastReg=r; else lastReg=null; }
  if(!lastReg) return PL.region||'world'; // 不在音樂區裡時維持原本的歌
  PL.names[lastReg.key]=lastReg.name;
  return lastReg.key;
}

/* ---------- 音樂邊界線：音樂區的外框，像霓虹燈一樣發光、閃爍（只在播放音樂時顯示） ---------- */
// 霓虹顏色：圖鑑裡有貼紙的風場（音樂區以風場名稱命名）外框是沿著邊緣流動的七彩跑馬燈；
// 其他區域從 10 種霓虹色裡挑，附近的區域盡量不同色
function hsl(h,s,l){ return `hsl(${Math.round(h)},${s}%,${l}%)`; }
const STICKER_NAMES=new Set(FARMS.map(f=>f.n0.replace(/（.*?）/,''))); // 音樂區名稱是原文
const NEON_PAL=[['#ff4fb0','#ffe3f3'],['#b86bff','#efe0ff'],['#3fe0ff','#dffaff'],['#4dff88','#e0ffe9'],['#ffd23f','#fff6d6'],
  ['#ff8a3d','#ffe7d6'],['#5b8cff','#e3ebff'],['#ff5a5a','#ffe0e0'],['#c6ff3f','#f3ffd9'],['#ff7cf0','#ffe6fc']];
// 貪婪著色：依位置排序，每一區挑附近（中心距離小於兩區大小相加＋25 公里）還沒用過的顏色
function colorZones(){
  const items=[];
  if(ZONES) for(const z of ZONES){ if(STICKER_NAMES.has(z.n)) continue; const b=z.b, cl=Math.cos((b[1]+b[3])/2*D2R);
    items.push({o:z,x:(b[0]+b[2])/2,y:(b[1]+b[3])/2,r:Math.hypot((b[2]-b[0])*111.3*cl,(b[3]-b[1])*110.6)/2}); }
  for(const c of CIRC) items.push({o:c,x:c.lon,y:c.lat,r:c.a});
  const cell=0.5, grid=new Map(), key=(i,j)=>i+','+j;
  for(const it of items){ const k=key(Math.floor(it.x/cell),Math.floor(it.y/cell)); if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(it); }
  items.sort((a,b)=>a.x-b.x||a.y-b.y);
  items.forEach((it,n)=>{
    const used=new Set(), i0=Math.floor(it.x/cell), j0=Math.floor(it.y/cell), cl=Math.cos(it.y*D2R);
    for(let i=i0-1;i<=i0+1;i++) for(let j=j0-1;j<=j0+1;j++) for(const o of grid.get(key(i,j))||[]){
      if(o===it||o.o.ci==null) continue;
      if(Math.hypot((o.x-it.x)*111.3*cl,(o.y-it.y)*110.6)<it.r+o.r+25) used.add(o.o.ci);
    }
    let ci=(n*3)%NEON_PAL.length; for(let k=0;k<NEON_PAL.length&&used.has(ci);k++) ci=(ci+1)%NEON_PAL.length;
    it.o.ci=ci;
  });
}
function musicBorderFC(){
  const solid=[], marquee=[];
  const ring2coords=a=>{ const c=[]; for(let k=0;k<a.length;k+=2) c.push([a[k],a[k+1]]); return c; };
  const prop=o=>{ const p=NEON_PAL[o.ci||0]; return {c:p[0],l:p[1]}; };
  if(ZONES) for(const z of ZONES){ const sticker=STICKER_NAMES.has(z.n); for(const a of z.r){
    const f={type:'Feature',properties:sticker?{}:prop(z),geometry:{type:'LineString',coordinates:ring2coords(a)}};
    (sticker?marquee:solid).push(f); } }
  for(const c of CIRC){
    const ring=[], kx=111.32*Math.cos(c.lat*D2R), ca=Math.cos(c.ang), sa=Math.sin(c.ang);
    for(let i=0;i<=48;i++){ const t=i/48*TAU, u=Math.cos(t)*c.a, v=Math.sin(t)*c.b; ring.push([c.lon+(u*ca-v*sa)/kx,c.lat+(u*sa+v*ca)/110.57]); }
    solid.push({type:'Feature',properties:prop(c),geometry:{type:'LineString',coordinates:ring}});
  }
  return {solid:{type:'FeatureCollection',features:solid},marquee:{type:'FeatureCollection',features:marquee}};
}
function setMusicBorderData(){ const fc=musicBorderFC(); const a=map.getSource('musb'), b=map.getSource('musm'); if(a) a.setData(fc.solid); if(b) b.setData(fc.marquee); }
const NEON=['musb-glow2','musb-glow','musb-core','musm-glow2','musm-glow','musm-core'];
// 跑馬燈：沿著外框（line-progress 0→1）重複三輪彩虹，phase 每次更新往前推
function rainbowGradient(phase,light){
  const st=['interpolate',['linear'],['line-progress']];
  for(let i=0;i<=24;i++){ const p=i/24; st.push(p,hsl((p*3*360+phase)%360,100,light)); }
  return st;
}
function addMusicBorders(){
  if(map.getSource('musb')) return;
  const layers=map.getStyle().layers, firstSym=(layers.find(l=>l.type==='symbol')||{}).id, fc=musicBorderFC();
  map.addSource('musb',{type:'geojson',data:fc.solid});
  map.addSource('musm',{type:'geojson',data:fc.marquee,lineMetrics:true});
  const lay={'line-join':'round','line-cap':'round'}, wz=(a,b)=>['interpolate',['linear'],['zoom'],2,a,8,b];
  // 三層疊出霓虹燈管：最外面寬而模糊的光暈、中間的彩色燈管、最裡面接近白色的燈芯
  map.addLayer({id:'musb-glow2',type:'line',source:'musb',layout:lay,paint:{'line-color':['get','c'],'line-width':wz(9,22),'line-blur':wz(7,16),'line-opacity':0.3}},firstSym);
  map.addLayer({id:'musb-glow',type:'line',source:'musb',layout:lay,paint:{'line-color':['get','c'],'line-width':wz(3.5,7),'line-blur':wz(1.5,3),'line-opacity':0.7}},firstSym);
  map.addLayer({id:'musb-core',type:'line',source:'musb',layout:lay,paint:{'line-color':['get','l'],'line-width':wz(1,1.8),'line-opacity':0.9}},firstSym);
  map.addLayer({id:'musm-glow2',type:'line',source:'musm',layout:lay,paint:{'line-gradient':rainbowGradient(0,60),'line-width':wz(10,24),'line-blur':wz(7,16),'line-opacity':0.35}},firstSym);
  map.addLayer({id:'musm-glow',type:'line',source:'musm',layout:lay,paint:{'line-gradient':rainbowGradient(0,62),'line-width':wz(4,8),'line-blur':wz(1.5,3),'line-opacity':0.8}},firstSym);
  map.addLayer({id:'musm-core',type:'line',source:'musm',layout:lay,paint:{'line-gradient':rainbowGradient(0,88),'line-width':wz(1.2,2),'line-opacity':0.95}},firstSym);
  applyMusicBorders();
}
function applyMusicBorders(){
  const v=S.musb?'visible':'none';
  $('#bMusb').setAttribute('aria-pressed',S.musb); $('#musbLbl').textContent=tr(S.musb?'顯示':'隱藏');
  for(const id of NEON) if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',v);
}
// 霓虹燈效果：約 2.6 秒一次的呼吸，偶爾像接觸不良一樣快速閃一下；跑馬燈的彩虹沿著外框流動
// （每 0.1 秒更新一次，避免整張地圖一直重畫）
let neonT=0, neonFlick=0;
function updNeon(now){
  if(!S.musb||now-neonT<100||!map.getLayer('musb-core')) return; neonT=now;
  if(neonFlick<=0&&Math.random()<0.012) neonFlick=3+Math.floor(Math.random()*4);
  let k=0.6+0.4*Math.sin(now/2600*TAU);
  if(neonFlick>0){ neonFlick--; k=neonFlick%2?0.15:1; }
  // 拉遠時（看整個國家）只剩三成亮度，放大到 zoom 6 以上才完整發亮，不然一整片小光點很雜
  const op=v=>['interpolate',['linear'],['zoom'],3,v*0.3,6,v];
  for(const p of ['musb','musm']){
    map.setPaintProperty(p+'-glow2','line-opacity',op(0.12+0.3*k));
    map.setPaintProperty(p+'-glow','line-opacity',op(0.3+0.5*k));
    map.setPaintProperty(p+'-core','line-opacity',op(0.45+0.5*k));
  }
  const ph=(now/12)%360; // 約 4 秒流動一整輪顏色
  map.setPaintProperty('musm-glow2','line-gradient',rainbowGradient(ph,60));
  map.setPaintProperty('musm-glow','line-gradient',rainbowGradient(ph,62));
  map.setPaintProperty('musm-core','line-gradient',rainbowGradient(ph,88));
}
function nextTrack(region){
  if(region==='zen'){ const pool=PL.tw.concat(PL.rest); let f=pool[0]; for(let k=0;k<12;k++){ f=pool[Math.floor(Math.random()*pool.length)]; if(!PL.recent.includes(f)) break; } PL.recent.push(f); if(PL.recent.length>6) PL.recent.shift(); return f; }
  if(String(region).startsWith('tw')&&PL.tw.length){ PL.twIdx=(PL.twIdx+1)%PL.tw.length; return PL.tw[PL.twIdx]; }
  const pool=PL.rest.length?PL.rest:PL.tw; let f=pool[0];
  for(let k=0;k<12;k++){ f=pool[Math.floor(Math.random()*pool.length)]; if(!PL.recent.includes(f)) break; }
  PL.recent.push(f); if(PL.recent.length>Math.min(6,Math.floor(pool.length/2))) PL.recent.shift();
  return f;
}
function playTrack(region){
  if(!PL.el){
    PL.el=new Audio(); PL.el.preload='auto';
    PL.el.addEventListener('ended',()=>{ if(MUS.on&&!PL.synth) playTrack(PL.want||PL.region); });
    PL.el.addEventListener('playing',()=>{ PL.failed=0; });
    PL.el.addEventListener('error',()=>{ if(!MUS.on||PL.synth) return;
      if(++PL.failed>=3){ PL.synth=true; toast(tr('音樂檔讀取失敗，改用電腦合成的音樂')); setSynth(true); } else playTrack(PL.region); });
  }
  const f=nextTrack(region); PL.region=region; PL.want=null;
  PL.el.src=PL.dir+encodeURIComponent(f); PL.v=0; PL.el.volume=0; PL.target=MP3_VOL*duck();
  PL.el.play().catch(()=>{});
  const nm=f.replace(/\.[^.]+$/,''), where=PL.names[region]||'';
  if(where||!/^\d+$/.test(nm)) toast('♫ '+[where,/^\d+$/.test(nm)?'':nm].filter(Boolean).join('・'),2800);
}
let lastDuck=0, musLastT=performance.now();
function updMusic(now,dtR){
  musLastT=now;
  if(MUS.ac&&MUS.on&&now-lastDuck>500){ lastDuck=now; MUS.out.gain.setTargetAtTime(0.32*MUS.vol*duck(),MUS.ac.currentTime,0.6); }
  if(!PL.el||PL.synth) return;
  // 保險：音樂開著卻停下來（播完沒接上、被系統或耳機暫停、讀檔卡住）就接著播下一首
  if(MUS.on&&now-(PL.chkT||0)>2000){ PL.chkT=now;
    if(PL.el.ended) playTrack(PL.want||PL.region);
    else if(PL.el.paused&&PL.target>0) PL.el.play().catch(()=>{}); }
  if(MUS.on){
    const want=musRegion(now);
    if(want===PL.region){ PL.want=null; if(PL.target===0&&!PL.el.ended) PL.target=MP3_VOL*duck(); } // 淡出到一半又回到原本的音樂區：音量拉回來（不然會一直靜音）
    else if(PL.want!==want){ PL.want=want; PL.wantT=now; }
    else if(now-PL.wantT>3000) PL.target=0; // 淡出，音量到 0 時換到新地區的歌單
  }
  if(MUS.on&&PL.target>0) PL.target=MP3_VOL*duck();
  const step=dtR/1500*MP3_VOL;
  PL.v=PL.v<PL.target?Math.min(PL.target,PL.v+step):Math.max(PL.target,PL.v-step);
  try{ PL.el.volume=PL.v; }catch(e){}
  if(PL.v<=0.001&&PL.target===0){
    if(MUS.on&&PL.want) playTrack(PL.want);
    else if(!MUS.on&&!PL.el.paused) PL.el.pause();
  }
}
// 網頁縮小、被別的視窗蓋住或切到別的分頁時畫面不會更新：畫面停了就改由計時器每 0.5 秒照顧音樂（播完接下一首、淡入淡出）
setInterval(()=>{ const now=performance.now(); if(now-musLastT>400) updMusic(now,Math.min(1500,now-musLastT)); },500);
function setMusic(on){
  MUS.on=on; $('#bMus').setAttribute('aria-pressed',on); if(on) loadZones();
  if(PL.synth||!(PL.tw.length+PL.rest.length)) setSynth(on);
  else if(on){ if(!PL.el||!PL.region) playTrack(musRegion()); else { PL.el.play().catch(()=>{}); PL.target=MP3_VOL*duck(); } }
  else PL.target=0;
  if(on&&!setMusic.told){ setMusic.told=true; toast(tr('♫ 霓虹圈是音樂區，有貼紙的風場是七彩跑馬燈；地圖中心移進另一圈就會換歌'),4500); }
}
$('#bMus').onclick=()=>setMusic(!MUS.on);
// 音樂圈預設顯示（右邊的「音樂圈」鈕可以關掉）；資料在網頁開好後才下載
S.musb=true; try{ if(localStorage.getItem('windglobe-musb')==='0') S.musb=false; }catch(e){}
$('#bMusb').onclick=()=>{ S.musb=!S.musb; try{localStorage.setItem('windglobe-musb',S.musb?'1':'0');}catch(e){} if(S.musb) loadZones(); applyMusicBorders(); };
setTimeout(()=>{ if(S.musb) loadZones(); },2500);

/* ================= 3D 風場（three.js）＋ 吹風發電遊戲 ================= */
let THREE_P=null;
function loadThree(){
  if(window.THREE) return Promise.resolve();
  if(THREE_P) return THREE_P;
  THREE_P=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';s.onload=()=>res();s.onerror=()=>{THREE_P=null;rej(new Error(tr('3D 元件載入失敗，請檢查網路後再試一次')));};document.head.appendChild(s);});
  return THREE_P;
}
// 3D 場景與遊戲在 assets/game3d.js（第一次進 3D 才載入）；這裡準備風機位置、真實海岸線與地形種類
const V3={open:false,spec:null,nightOverride:null};
let G3_P=null;
function loadGame3D(){
  if(window.WindGame3D) return Promise.resolve();
  if(G3_P) return G3_P;
  G3_P=new Promise((res,rej)=>{const s=document.createElement('script');s.src='assets/game3d.js?v=20261031a';s.onload=()=>res();s.onerror=()=>{G3_P=null;rej(new Error(tr('3D 遊戲載入失敗，請檢查網路後再試一次')));};document.head.appendChild(s);});
  return G3_P;
}
function nearPts(lon,lat,km){
  const out=[], cosl=Math.cos(lat*D2R);
  const add=(plon,plat,D,hh,off)=>{const dx=(plon-lon)*111.32*cosl, dy=(plat-lat)*110.57, d=Math.hypot(dx,dy); if(d<km) out.push({lon:plon,lat:plat,D,hh,off,d});};
  for(const t of EXTRA) add(t.lon,t.lat,t.D||90,t.hh||Math.max(45,(t.D||90)*0.65+15),0);
  for(const f of FARMS) if(f.tur) for(const t of f.tur) add(t.lon,t.lat,t.D||f.D,t.hh||f.hh,f.k!=='on'?1:0);
  const dl=km/(111.32*Math.max(0.15,cosl))+1, dt=km/110.57+1;
  for(const c of WCELLS){
    if(Math.abs(c.cx-lon)>dl||Math.abs(c.cy-lat)>dt) continue;
    for(let i=c.start;i<c.start+c.n;i++){if(WT.own[i]||WT.cl[i]>>5===3) continue; const k=WT.cl[i]&15,off=(WT.cl[i]>>4)&1,D=DCL[k]||(off?150:90); add(WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5,D,Math.max(45,D*0.65+15),off);}
  }
  out.sort((a,b)=>a.d-b.d); return out.slice(0,160);
}
function specForFarm(f){
  let pts;
  if(f.tur) pts=f.tur.map(t=>({lon:t.lon,lat:t.lat,D:t.D||f.D,hh:t.hh||f.hh}));
  else{ // 圖鑑中心點是約略位置：附近找不到時，找遠一點的最近一支，再以它為中心抓周圍的風機
    pts=nearPts(f.lon,f.lat,15);
    if(!pts.length){ const far=nearPts(f.lon,f.lat,40); if(far.length) pts=nearPts(far[0].lon,far[0].lat,8); }
  }
  return {title:f.ns,off:f.k!=='on',lon:f.lon,lat:f.lat,pts,farm:f};
}
function specHere(){
  const pts=nearPts(cLon,cLat,12);
  const off=pts.filter(p=>p.off).length>pts.length/2;
  return {title:tr('這附近的風機'),off,lon:cLon,lat:cLat,pts,farm:null};
}
let LANDSRC=null;
function clipBox(pts,B){
  let out=pts;
  const E=[[p=>p[0]>=-B,(a,b)=>{const t=(-B-a[0])/(b[0]-a[0]);return[-B,a[1]+t*(b[1]-a[1])];}],[p=>p[0]<=B,(a,b)=>{const t=(B-a[0])/(b[0]-a[0]);return[B,a[1]+t*(b[1]-a[1])];}],
           [p=>p[1]>=-B,(a,b)=>{const t=(-B-a[1])/(b[1]-a[1]);return[a[0]+t*(b[0]-a[0]),-B];}],[p=>p[1]<=B,(a,b)=>{const t=(B-a[1])/(b[1]-a[1]);return[a[0]+t*(b[0]-a[0]),B];}]];
  for(const [ins,cut] of E){ const inp=out; out=[]; if(!inp.length) break; let s=inp[inp.length-1];
    for(const e of inp){ if(ins(e)){ if(!ins(s)) out.push(cut(s,e)); out.push(e); } else if(ins(s)) out.push(cut(s,e)); s=e; } }
  return out;
}
function landRings(lon0,lat0,cl,Rv){
  if(!LANDSRC){ const tw=twLand.type==='FeatureCollection'?twLand.features:[twLand]; LANDSRC=[...tw,...C50F].map(f=>({f,b:d3.geoBounds(f)})); }
  const dLat=Rv/110574+0.05, dLon=Rv/(111320*Math.max(0.1,cl))+0.05, out=[];
  for(const {f,b} of LANDSRC){
    if(b[1][1]<lat0-dLat||b[0][1]>lat0+dLat) continue;
    if(b[0][0]<=b[1][0]&&(b[1][0]<lon0-dLon||b[0][0]>lon0+dLon)) continue;
    const g=f.geometry, polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const poly of polys){
      const ring=poly[0].map(c=>{let dl=c[0]-lon0; if(dl>180)dl-=360; else if(dl<-180)dl+=360; return [dl*111320*cl,(c[1]-lat0)*110574];});
      const cr=clipBox(ring,Rv); if(cr.length>=3) out.push(cr);
    }
  }
  return out;
}
// 地形種類：海上（台灣海峽、北海、其他）、沙漠、雪地、山區（海拔 500 公尺以上）、草原農田
const DESERTS=[[75,36,106,46],[-17,14,60,33],[44,12,60,30],[-118,31,-103,37],[-72,-30,-68,-18],[118,-32,140,-22]];
function biomeFor(lon,lat,off){
  if(off){
    if(lon>=118&&lon<=123&&lat>=21&&lat<=26.5) return 'taiwan';
    if(lat>=48&&lat<=66&&lon>=-12&&lon<=32) return 'northsea';
    return 'sea';
  }
  if(lat>=58||lat<=-50) return 'snow';
  if(DESERTS.some(b=>lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3])) return 'desert';
  // 山區看高低落差（附近 3 公里內落差超過 120 公尺），或海拔超過 1500 公尺；高原上的平地（例如德州）算草原
  let e=null, relief=0;
  try{ if(map.getTerrain()){ const q=(dx,dy)=>map.queryTerrainElevation([lon+dx,lat+dy]);
    e=q(0,0); if(e!=null){ const es=[e,q(0.03,0),q(-0.03,0),q(0,0.03),q(0,-0.03)].filter(v=>v!=null); relief=(Math.max(...es)-Math.min(...es))/1.4; } } }catch(err){}
  if(e!=null&&(relief>120||e/1.4>1500)) return 'mountain';
  if(e==null&&lon>=120.55&&lon<=121.5&&lat>=22.4&&lat<=24.9) return 'mountain'; // 沒開地形時，台灣中央山脈一帶
  return 'grass';
}
// 3D 場景的地面：在畫面外開一張跟平面地圖同樣底圖的地圖，截成貼圖（遠景＋風機附近的近景）；
// 近景順便從圖磚取出建築物輪廓與高度，3D 裡蓋成立體房子。海上場景把海面塗成洋紅色再挖空，讓 3D 海浪露出來
let capMap=null, capEl=null, capReady=null;
const CAP_PX=2048, KEY_RGB=[255,0,255];
function capInit(){
  if(capReady) return capReady;
  capEl=document.createElement('div');
  capEl.style.cssText=`position:fixed;left:-${CAP_PX*2}px;top:0;width:${CAP_PX}px;height:${CAP_PX}px;pointer-events:none`;
  document.body.append(capEl);
  capMap=new maplibregl.Map({container:capEl,style:STYLE_URL.light,center:[121,23.5],zoom:10,interactive:false,attributionControl:false,
    fadeDuration:0,pixelRatio:1,canvasContextAttributes:{preserveDrawingBuffer:true},
    localIdeographFontFamily:{ja:'"Hiragino Sans","Yu Gothic","Meiryo",sans-serif',ko:'"Apple SD Gothic Neo","Malgun Gothic",sans-serif','zh-Hans':'"PingFang SC","Microsoft YaHei",sans-serif'}[I18N.LANG]||'"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif'});
  capReady=new Promise(res=>capMap.once('style.load',()=>{
    for(const l of capMap.getStyle().layers){
      if(l.type!=='symbol') continue;
      const tf=capMap.getLayoutProperty(l.id,'text-field');
      if(tf&&JSON.stringify(tf).includes('name')) capMap.setLayoutProperty(l.id,'text-field',ZH_NAME);
    }
    res();
  }));
  return capReady;
}
let capWaterOrig=null;
function capWater(key){
  const layers=capMap.getStyle().layers;
  if(!capWaterOrig){ capWaterOrig={}; for(const l of layers) if(l['source-layer']==='water'&&l.type==='fill') capWaterOrig[l.id]=capMap.getPaintProperty(l.id,'fill-color')||'#a0c8f0'; }
  for(const l of layers){
    if(l.id==='natural_earth') capMap.setLayoutProperty(l.id,'visibility',key?'none':'visible');
    if(capWaterOrig[l.id]!=null) capMap.setPaintProperty(l.id,'fill-color',key?'#ff00ff':capWaterOrig[l.id]);
  }
}
function capIdle(ms=9000){ return new Promise(res=>{ let done=false; const fin=()=>{ if(!done){ done=true; res(); } }; capMap.once('idle',fin); setTimeout(fin,ms); capMap.triggerRepaint(); }); }
// 讓 CAP_PX 像素剛好涵蓋 spanM 公尺的縮放等級（MapLibre 圖磚 512 像素）
const capZoom=(spanM,lat)=>Math.log2(40075016.686*Math.cos(lat*D2R)*CAP_PX/(512*spanM));
function capShot(key,lon0,lat0,cl){
  const src=capMap.getCanvas(), c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
  const g=c.getContext('2d'); g.drawImage(src,0,0);
  if(key){ // 洋紅色（海）挖成透明，邊緣反鋸齒的像素依接近程度給半透明
    const im=g.getImageData(0,0,c.width,c.height), d=im.data;
    for(let i=0;i<d.length;i+=4){ const dr=d[i]-255, dg=d[i+1], db=d[i+2]-255, dist=Math.sqrt(dr*dr+dg*dg+db*db);
      if(dist<150) d[i+3]=dist<60?0:Math.round((dist-60)/90*255); }
    g.putImageData(im,0,0);
  }
  const b=capMap.getBounds();
  return {img:c, x0:(b.getWest()-lon0)*111320*cl, x1:(b.getEast()-lon0)*111320*cl, z0:-(b.getNorth()-lat0)*110574, z1:-(b.getSouth()-lat0)*110574};
}
async function captureGround(lon0,lat0,cl,halfM,sea,near){
  await capInit();
  capWater(sea);
  const span=Math.min(halfM*2,40000);
  capMap.jumpTo({center:[lon0,lat0],zoom:capZoom(span,lat0),bearing:0,pitch:0});
  await capIdle(); const far=capShot(sea,lon0,lat0,cl);
  // 近景：風機最密集處附近約 5 公里見方，看得到道路、地名和建築
  capMap.jumpTo({center:[near[0],near[1]],zoom:capZoom(5000,near[1])});
  await capIdle(); const nearShot=capShot(sea,lon0,lat0,cl);
  const buildings=[], seen=new Set();
  for(const f of capMap.querySourceFeatures('openmaptiles',{sourceLayer:'building'})){
    const id=f.id!=null?f.id:JSON.stringify(f.geometry.coordinates[0]&&f.geometry.coordinates[0][0]);
    if(seen.has(id)) continue; seen.add(id);
    const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
    const h=+f.properties.render_height||+f.properties.height||8, h0=+f.properties.render_min_height||0;
    for(const p of polys){ const ring=p[0]; if(!ring||ring.length<4) continue;
      buildings.push({h:Math.max(3,h-h0),ring:ring.map(c=>[(c[0]-lon0)*111320*cl,-(c[1]-lat0)*110574])}); }
    if(buildings.length>=1500) break;
  }
  return {far,near:nearShot,buildings};
}
/* ---------- 實景重建：空照圖地面、真實地形高度、建築、樹林、道路，以及「街景視角」站的位置 ---------- */
// 台灣用內政部國土測繪中心正射影像（約 0.5 公尺解析度），其他地方用 Sentinel-2 衛星圖（約 10 公尺）
const PHOTO_TW_TILES=['https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'];
const inTW=(lon,lat)=>lon>116.2&&lon<123.6&&lat>20.4&&lat<26.8;
function capPhoto(on,lon,lat){
  if(!capMap.getSource('cap-photo')){
    capMap.addSource('cap-s2',{type:'raster',tiles:S2_TILES,tileSize:256,maxzoom:14});
    capMap.addSource('cap-photo',{type:'raster',tiles:PHOTO_TW_TILES,tileSize:256,minzoom:7,maxzoom:19,bounds:[116.2,20.4,123.6,26.8]});
    capMap.addLayer({id:'cap-s2',type:'raster',source:'cap-s2',layout:{visibility:'none'},paint:{'raster-fade-duration':0}});
    capMap.addLayer({id:'cap-photo',type:'raster',source:'cap-photo',layout:{visibility:'none'},paint:{'raster-fade-duration':0}});
  }
  capMap.setLayoutProperty('cap-s2','visibility',on?'visible':'none');
  capMap.setLayoutProperty('cap-photo','visibility',on&&inTW(lon,lat)?'visible':'none');
  // 截空照圖時把底下的向量地圖換成一片草地綠：空照圖磚沒抓到的地方才不會露出米色的地圖、道路和字
  if(!capPhoto.orig){ capPhoto.orig={}; for(const l of capMap.getStyle().layers) if(l.type!=='raster') capPhoto.orig[l.id]=capMap.getLayoutProperty(l.id,'visibility')||'visible'; }
  for(const l of capMap.getStyle().layers){
    if(l.type==='background') capMap.setPaintProperty(l.id,'background-color',on?'#8cc56c':capPhoto.bg||(capPhoto.bg=capMap.getPaintProperty(l.id,'background-color')));
    else if(l.type!=='raster'&&capPhoto.orig[l.id]) capMap.setLayoutProperty(l.id,'visibility',on?'none':capPhoto.orig[l.id]);
  }
}
// 空照圖調得可愛一點：顏色飽和、亮一點（像繪本），再用海的遮罩把水挖空，露出 3D 的海浪
function cuteShot(img,mask){
  const g=img.getContext('2d'), im=g.getImageData(0,0,img.width,img.height), d=im.data;
  const md=mask?mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data:null;
  for(let i=0;i<d.length;i+=4){
    let r=d[i], gg=d[i+1], b=d[i+2]; const y=0.3*r+0.59*gg+0.11*b;
    r=y+(r-y)*1.35; gg=y+(gg-y)*1.4; b=y+(b-y)*1.3; // 飽和
    d[i]=Math.min(255,r*1.04+10); d[i+1]=Math.min(255,gg*1.06+12); d[i+2]=Math.min(255,b*1.02+8); // 亮一點、偏綠一點
    if(md&&md[i+3]>200){ const dr=md[i]-255, dg=md[i+1], db=md[i+2]-255, dist=Math.sqrt(dr*dr+dg*dg+db*db); // 遮罩上是洋紅色（水）才挖空；遮罩沒畫出來就整張保留
      if(dist<150) d[i+3]=dist<60?0:Math.round((dist-60)/90*255); }
  }
  g.putImageData(im,0,0);
}
// 地形高度格點：Mapterhorn 高程圖磚（terrarium 編碼，512 像素，最細到 z12，約 19 公尺一格）
async function demGrid(lon0,lat0,cl,half,N=161){
  const z=12, n=2**z, toX=lon=>(lon+180)/360*n, toY=lat=>{ const s=Math.sin(lat*D2R); return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n; };
  const dLon=half/(111320*cl), dLat=half/110574;
  const tx0=Math.floor(toX(lon0-dLon)), tx1=Math.floor(toX(lon0+dLon)), ty0=Math.floor(toY(lat0+dLat)), ty1=Math.floor(toY(lat0-dLat));
  const tiles=new Map(), jobs=[];
  for(let tx=tx0;tx<=tx1;tx++) for(let ty=ty0;ty<=ty1;ty++) jobs.push((async()=>{
    try{
      const r=await fetch(DEM_TILES[0].replace('{z}',z).replace('{x}',tx).replace('{y}',ty)); if(!r.ok) return;
      const bm=await createImageBitmap(await r.blob()), c=document.createElement('canvas'); c.width=bm.width; c.height=bm.height;
      const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(bm,0,0); tiles.set(tx+','+ty,{w:bm.width,d:g.getImageData(0,0,bm.width,bm.height).data});
    }catch(e){}
  })());
  await Promise.all(jobs);
  if(!tiles.size) return null;
  const h=new Float32Array(N*N), step=2*half/(N-1);
  for(let j=0;j<N;j++) for(let i=0;i<N;i++){
    const x=-half+i*step, zz=-half+j*step, lon=lon0+x/(111320*cl), lat=lat0-zz/110574, X=toX(lon), Y=toY(lat), t=tiles.get(Math.floor(X)+','+Math.floor(Y));
    let v=0; if(t){ const px=Math.min(t.w-1,Math.floor((X-Math.floor(X))*t.w)), py=Math.min(t.w-1,Math.floor((Y-Math.floor(Y))*t.w)), k=(py*t.w+px)*4; v=t.d[k]*256+t.d[k+1]+t.d[k+2]/256-32768; }
    h[j*N+i]=Math.max(0,v); // 海面以下當成 0
  }
  return {N,half,h};
}
// 多邊形裡均勻撒點（種樹用）
function scatterIn(rings,toXZ,every,max,out){
  const ring=rings[0]; if(!ring||ring.length<4) return;
  const P=ring.map(toXZ); let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9; for(const p of P){ x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]); z0=Math.min(z0,p[1]); z1=Math.max(z1,p[1]); }
  const ins=(x,z)=>{ let c=false; for(let i=0,j=P.length-1;i<P.length;j=i++){ const a=P[i],b=P[j]; if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])) c=!c; } return c; };
  for(let x=x0+rnd()*every;x<x1;x+=every) for(let z=z0+rnd()*every;z<z1;z+=every){ if(out.length>=max) return; const jx=x+(rnd()-0.5)*every*0.8, jz=z+(rnd()-0.5)*every*0.8; if(ins(jx,jz)) out.push([jx,jz,0.7+rnd()*0.7]); }
}
async function captureReal(lon0,lat0,cl,R,dense,pts){
  await capInit(); capWater(false); capPhoto(false,lon0,lat0);
  const toXZ=c=>[(c[0]-lon0)*111320*cl,-(c[1]-lat0)*110574];
  // 1. 向量圖磚：風機最密集處附近 3 公里見方的建築、樹林、道路（離岸風場等一下再抓岸邊站的地方）
  const buildings=[], seen=new Set(), trees=[], roads=[], roadLines=[];
  const grab=async(glon,glat)=>{
    capMap.jumpTo({center:[glon,glat],zoom:capZoom(3000,glat),bearing:0,pitch:0});
    await capIdle();
    // 圖磚還沒載完時查不到東西：最多再等兩次
    for(let k=0;k<2&&!capMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation'}).length;k++) await capIdle(8000);
    for(const f of capMap.querySourceFeatures('openmaptiles',{sourceLayer:'building'})){
      const id=f.id!=null?f.id:JSON.stringify(f.geometry.coordinates[0]&&f.geometry.coordinates[0][0]);
      if(seen.has(id)) continue; seen.add(id);
      const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
      const h=+f.properties.render_height||+f.properties.height||7, h0=+f.properties.render_min_height||0;
      for(const p of polys){ const ring=p[0]; if(ring&&ring.length>=4) buildings.push({h:Math.max(3,h-h0),ring:ring.map(toXZ)}); }
      if(buildings.length>=3000) break;
    }
    for(const f of capMap.querySourceFeatures('openmaptiles',{sourceLayer:'landcover'})){
      if(!/wood|forest|scrub/.test(f.properties.class||'')) continue;
      const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
      for(const p of polys) scatterIn(p,toXZ,f.properties.class==='scrub'?14:9,2500,trees);
    }
    for(const f of capMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation'})){
      const cls=f.properties.class||''; if(/rail|ferry|aerialway|pier/.test(cls)) continue;
      const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
      for(const l of lines) if(roadLines.length<1200&&l.length>=2) roadLines.push({cls,brunnel:f.properties.brunnel||'',pts:l.map(toXZ)}); // 3D 裡鋪成柏油路
      for(const l of lines) for(let k=0;k+1<l.length;k++){ const a=toXZ(l[k]), b=toXZ(l[k+1]), d=Math.hypot(b[0]-a[0],b[1]-a[1]);
        for(let s=0;s<d;s+=15) roads.push([a[0]+(b[0]-a[0])*s/d,a[1]+(b[1]-a[1])*s/d,cls,f.properties.brunnel==='bridge']); }
    }
  };
  await grab(dense.lon,dense.lat);
  // 2. 街景視角：在真實道路上，離最近的風機 120～450 公尺、看得到最多風機的地方，面向那群風機
  const P=pts.map(p=>[(p.lon-lon0)*111320*cl,-(p.lat-lat0)*110574]);
  let cam=null, best=1e9;
  for(const r of roads){
    let dmin=1e9; for(const p of P) dmin=Math.min(dmin,Math.hypot(p[0]-r[0],p[1]-r[1]));
    if(dmin<120||dmin>450) continue;
    const vis=P.filter(p=>Math.hypot(p[0]-r[0],p[1]-r[1])<1500).length;
    const score=Math.abs(dmin-220)/40-vis*1.5+(/path|track/.test(r[2])?6:0);
    if(score<best){ best=score; cam=r; }
  }
  if(!cam){ // 離岸風場：風機附近沒有路，改站在海邊離風機最近的道路上（跟 Google 街景從岸邊看出去一樣）
    capMap.jumpTo({center:[dense.lon,dense.lat],zoom:capZoom(16000,dense.lat),bearing:0,pitch:0}); await capIdle();
    let bd=9000;
    for(const f of capMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation'})){
      const cls=f.properties.class||''; if(!/primary|secondary|tertiary|minor|service|trunk/.test(cls)||f.properties.brunnel) continue;
      const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
      for(const l of lines) for(const c of l){ const q=toXZ(c); let dmin=1e9; for(const p of P) dmin=Math.min(dmin,Math.hypot(p[0]-q[0],p[1]-q[1])); if(dmin<bd){ bd=dmin; cam=[q[0],q[1],cls,false]; } }
    }
    if(cam) await grab(lon0+cam[0]/(111320*cl),lat0-cam[1]/110574); // 岸邊站的地方附近的真實房子、樹、道路
  }
  if(!cam){ // 附近沒有道路資料：站在最密集那支風機南邊 260 公尺
    const dx=(dense.lon-lon0)*111320*cl, dz=-(dense.lat-lat0)*110574; cam=[dx,dz+260,'',false,true]; // 第 5 個值：站在海上
  }
  if(cam){
    const n15=P.filter(p=>Math.hypot(p[0]-cam[0],p[1]-cam[1])<1500), near=n15.length?n15:P, cx=near.reduce((s,p)=>s+p[0],0)/near.length, cz=near.reduce((s,p)=>s+p[1],0)/near.length;
    const head=Math.atan2(cx-cam[0],-(cz-cam[1]))/D2R; // 方位角：北 0°、東 90°
    cam={x:cam[0],z:cam[1],bridge:!!cam[3],sea:!!cam[4],heading:(head+360)%360,lon:lon0+cam[0]/(111320*cl),lat:lat0-cam[1]/110574};
  }
  // 3. 空照圖：遠景、風機附近、街景位置附近三層，越近越清楚
  capPhoto(true,lon0,lat0);
  // 每一層先截一張「哪裡是水」的遮罩（向量圖的水塗成洋紅色），再開空照圖截同一個範圍
  let photoErr=0; const onErr=e=>{ if(e&&/cap-(photo|s2)/.test(e.sourceId||'')) photoErr++; }; capMap.on('error',onErr);
  const shot=async(lon,lat,span)=>{
    capMap.jumpTo({center:[lon,lat],zoom:capZoom(span,lat)});
    capPhoto(false,lon0,lat0); capWater(true); const sym=capMap.getStyle().layers.filter(l=>l.type==='symbol'); for(const l of sym) capMap.setLayoutProperty(l.id,'visibility','none'); // 字和圖示不要蓋在海上
    await capIdle(); const mask=capShot(false,lon0,lat0,cl).img; capWater(false); for(const l of sym) capMap.setLayoutProperty(l.id,'visibility',capPhoto.orig[l.id]||'visible');
    capPhoto(true,lon0,lat0); photoErr=0; await capIdle(15000);
    if(photoErr){ photoErr=0; capMap.triggerRepaint(); await capIdle(8000); } // 有圖磚沒抓到：再等一下讓它重抓
    const s=capShot(false,lon0,lat0,cl); cuteShot(s.img,mask); s.masked=true; return s;
  };
  const farSpan=Math.min(16000,R*2+6000);
  const far=await shot(lon0,lat0,farSpan);
  const mid=await shot(dense.lon,dense.lat,2600);
  const near=cam?await shot(cam.lon,cam.lat,900):null;
  capPhoto(false,lon0,lat0); capMap.off('error',onErr);
  const dem=await demGrid(lon0,lat0,cl,farSpan/2);
  return {photo:true,far,mid,near,buildings,trees,roads:roadLines,cam,dem,tw:inTW(lon0,lat0)};
}
async function open3D(spec){
  if(!spec.pts||!spec.pts.length){ toast(tr('這附近沒有風機資料，換個地方試試看')); return; }
  if(S.zen) setZen(false); if(S.tour) setTour(false);
  gamePause();
  toast(tr('正在準備 3D 風場…'),1500);
  try{ await loadThree(); await loadGame3D(); }catch(e){ toast(e.message); return; }
  V3.spec=spec;
  const lon0=d3.mean(spec.pts,p=>p.lon), lat0=d3.mean(spec.pts,p=>p.lat), cl=Math.cos(lat0*D2R);
  const pts=spec.pts.map(p=>({x:(p.lon-lon0)*111320*cl, z:-(p.lat-lat0)*110574, D:p.D, hh:p.hh, kind:p.kind||0}));
  let R=300; for(const p of pts) R=Math.max(R,Math.hypot(p.x,p.z));
  const biome=biomeFor(lon0,lat0,spec.off);
  const sun=sunPos(S.simT), sunAlt=90-d3.geoDistance([sun[0],sun[1]],[lon0,lat0])/D2R;
  const p1=lat0*D2R, p2=sun[1]*D2R, dl=(sun[0]-lon0)*D2R;
  const sunAz=Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))/D2R;
  const night=V3.nightOverride!=null?V3.nightOverride:sunAlt<-4;
  V3.nightOverride=null;
  const sea=['taiwan','sea','northsea'].includes(biome);
  // 風機最密集處（1.5 公里內鄰居最多），近景地圖與建築物以它為中心
  let dense=spec.pts[0], best=-1;
  for(const p of spec.pts){ let c=0; for(const q of spec.pts) if(Math.abs(q.lon-p.lon)*111.3*cl<1.5&&Math.abs(q.lat-p.lat)*110.6<1.5) c++; if(c>best){ best=c; dense=p; } }
  if(spec.focus!=null) dense=spec.pts[spec.focus]; // 從風機卡片進來：近景照片、建築以那支風機為中心
  let ground=null;
  toast(tr(spec.block?'正在抓這裡的空照圖、地形和房子，等一下就變成方塊⋯（約 10～20 秒）':'正在用空照圖和地形重建真實場景⋯（約 10～20 秒）'),8000);
  // 實景重建：空照圖＋地形＋真實建築、樹林；失敗時退回原本的地圖截圖
  try{ ground=await captureReal(lon0,lat0,cl,R,dense,spec.pts); }catch(e){ console.error(e); ground=null; }
  if(!ground){ try{ ground=await captureGround(lon0,lat0,cl,(R*8+16000)/2,sea,[dense.lon,dense.lat]); }catch(e){ console.error(e); } }
  WindGame3D.open({title:spec.title,biome,night,sunAlt,sunAz,pts,wind:windAt(lon0,lat0,simSec),rings:sea?landRings(lon0,lat0,cl,(R*8+16000)/2):[],ground,
    focus:spec.focus!=null?pts[spec.focus]:null,block:!!spec.block,
    typhoon:lon0>100&&lon0<150&&lat0>5&&lat0<42}, // 西北太平洋（台灣、日本、韓國、中國沿海、菲律賓）：任務 3 的暴風就是颱風
    {toast,say,hush:sayStop,addStar,confetti,powerFrac,VCI,VCO,
     qual:()=>QUAL.lvl,
     onClose:()=>{ V3.open=false; map.triggerRepaint(); gameResume(); },
     onNight:n=>{ V3.nightOverride=n; open3D(V3.spec); }});
  V3.open=true;
  if(spec.block) V3.spec=Object.assign({},spec,{block:false}); // 換白天／晚上重開時留在 3D 風場
}
// 從風機卡片直接進方塊世界：以這支風機（或傳統風車）為中心，附近 3 公里的風機一起蓋
function openBlocks(t){
  const mill=t.kind===3, near=nearPts(t.lon,t.lat,3);
  const same=near.find(p=>p.d<0.01), D=mill?20:(same&&same.D)||t.D||90;
  const me={lon:t.lon,lat:t.lat,D,hh:mill?13:(same&&same.hh)||Math.max(45,D*0.65+15),off:t.off?1:0,kind:mill?3:0};
  open3D({title:TNAMES[tKey(t)]||(t.farm?t.farm.ns:tr(mill?'傳統風車（磨坊）':'這支風車')),off:!!t.off,lon:t.lon,lat:t.lat,
    pts:[me,...near.filter(p=>p!==same)],farm:t.farm||null,focus:0,block:true});
}
function close3D(){ if(window.WindGame3D) WindGame3D.close(); }
$('#p3d').onclick=()=>{ if(S.sel) open3D(specForFarm(S.sel)); };
$('#b3d').onclick=()=>{ if(kmPx<0.15){ toast(tr('先把地圖放大到有風機的地方，再按「3D」')); return; } open3D(specHere()); };
updStars(); updBook();

// 瀏覽人數（今日、累計，依不同網路位址）：Cloudflare Pages 的 /api/visits（functions/api/visits.js）；
// GitHub Pages 版也連到 windpowerglobe.com 同一份；本機開發只看不算；連不上就不顯示
(function(){
  const el=$('#visits'), h=location.hostname; if(!el) return;
  const local=location.protocol==='file:'||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h);
  const url=(/(^|\.)windpowerglobe\.com$|\.pages\.dev$/.test(h)?'':'https://windpowerglobe.com')+'/api/visits';
  fetch(url,{method:local?'GET':'POST'}).then(r=>r.ok?r.json():null).then(d=>{
    if(!d||d.total==null) return; const f=n=>Number(n).toLocaleString(I18N.locale);
    el.querySelector('b').textContent=tr('今日瀏覽 {a} 人・累計 {b} 人',{a:f(d.today),b:f(d.total)}); el.hidden=false;
  }).catch(()=>{});
})();

if(WMETA){
  const d=new Date(WMETA.osm_timestamp), ds=`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  $('#srcTurb').textContent=tr('目前收錄 {n} 支，{d} 下載',{n:WMETA.count.toLocaleString(I18N.locale),d:ds});
  $('#impSrc').textContent=tr('全世界 {n} 支風機的位置來自 OpenStreetMap（{d} 下載）。',{n:WMETA.count.toLocaleString(I18N.locale),d:ds});
}
if(wtErr) toast(tr('全球風機資料載入失敗：')+wtErr.message,6000);
readColors();
applyTheme();
new ResizeObserver(()=>resize()).observe(mapEl);
resize();
map.jumpTo({zoom:zoomForZ(1,cLat)}); applyView();
setSpeed(2);
appReady=true;
loadWind();

/* ---------- 圖例：颱風四種分級、風機造型，用地圖上同一套畫法畫（打開圖例時才會動） ---------- */
const LG_TB={t0:{kind:0,era:2},t1:{kind:0,era:2,green:true},t2:{kind:0,era:3,red:true},t3:{kind:0,era:4,off:true},t4:{kind:2,era:1},t5:{kind:2,era:1,helix:true},t6:{kind:3,era:0},t7:{kind:0,era:2}};
const legendEl=$('#legend');
function drawLegend(now){
  const col=C.dark?'#f2f7fb':'#ffffff';
  for(const cv of legendEl.querySelectorAll('canvas.lg-cv')){
    const d=Math.min(2,devicePixelRatio||1), w=cv.clientWidth||+cv.width, h=cv.clientHeight||+cv.height;
    if(cv.width!==Math.round(w*d)){ cv.width=Math.round(w*d); cv.height=Math.round(h*d); }
    const g=cv.getContext('2d'); g.setTransform(d,0,0,d,0,0); g.clearRect(0,0,w,h);
    if(cv.dataset.ty!=null){ const c=+cv.dataset.ty; drawCuteTyphoon(g,w/2,h/2,w*0.26,-now*0.002*(0.6+0.35*c),now+c*900,c); }
    else{ const k=cv.dataset.tb; drawTurbineTrue(g,w/2,h-8,h*0.62,h*0.34,now*0.004,col,1,LG_TB[k],k==='t7'); }
  }
}
(function lgLoop(now){ if(legendEl.open&&!document.hidden) drawLegend(now); requestAnimationFrame(lgLoop); })(performance.now());
window.windGlobe={pickTurbine,SONG,SONGS,get tPick(){return tPick;},QUAL,setQual,windAt,TYS,TYPHOONS,get WG(){return WG;},drawTurbineTrue,doCheckIn,CHECKS,DOT,frameBody,PL,setMusic,map,S,FARMS,select,flyTo,open3D,specForFarm,startFind,drawFarms,stepParticles,applyView,updViewBox,bump:()=>vv++}; // 方便在瀏覽器主控台除錯
if(styleReady) onStyle();
requestAnimationFrame(frame);
})().catch(e=>{ console.error(e); const el=document.getElementById('loading'); if(el){ el.hidden=false; el.textContent=tr('載入失敗：{e}，請重新整理頁面。',{e:e.message}); } });
