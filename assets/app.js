(async () => {
'use strict';
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const $ = s => document.querySelector(s);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd = mulberry32(20261021);

const S = {simT:Date.now(), playing:true, speeds:[1,10,60,300,1800,3600], speedIdx:2, mode:'3d', tilt:true,
  wind:true, night:true, labels:true, big:true, sel:null, tour:false, tourIdx:0, tourNext:0, zen:false, sound:false};
const SPD_LBL = ['1×','10×','60×','300×','30 分/秒','1 時/秒'];

/* ---------- 底圖（MapLibre + OpenFreeMap） ---------- */
const STYLE_URL={light:'https://tiles.openfreemap.org/styles/liberty',dark:'https://tiles.openfreemap.org/styles/fiord'};
const DEM_TILES=['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'];
const THEMES=['auto','dark','light'], THEME_LBL={auto:'自動',dark:'深色',light:'淺色'};
// 台灣範圍可疊上內政部國土測繪中心的 WMTS 圖磚（政府資料開放授權條款－第 1 版），其他地方照樣用 OpenFreeMap
const BASES=['vector','emap','photo'], BASE_LBL={vector:'向量',emap:'電子地圖',photo:'空照'};
const NLSC={emap:{layer:'EMAP',fmt:'jpeg',name:'臺灣通用電子地圖'},photo:{layer:'PHOTO2',fmt:'jpeg',name:'正射影像'}};
let base='vector'; try{ const b=localStorage.getItem('windglobe-base'); if(BASES.includes(b)) base=b; }catch(e){}
let theme='auto'; try{theme=localStorage.getItem('windglobe-theme')||'auto';}catch(e){}
const darkMQ=matchMedia('(prefers-color-scheme: dark)');
const isDark=()=>theme==='dark'||(theme==='auto'&&darkMQ.matches);
let styleKey=isDark()?'dark':'light';
const map=new maplibregl.Map({
  container:'gl', style:STYLE_URL[styleKey], center:[121,23.5], zoom:1.3, minZoom:0, maxZoom:17.5, maxPitch:60,
  keyboard:false, attributionControl:false, fadeDuration:150,
  localIdeographFontFamily:'"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif'
});
map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'風機位置 © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap 貢獻者</a>・<a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>・內政部國土測繪中心・風是程式模擬的'}),'bottom-right');
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-left');
map.addControl(new maplibregl.ScaleControl({maxWidth:120,unit:'metric'}),'bottom-left');
let styleReady=false, appReady=false;
map.on('style.load',()=>{ styleReady=true; if(appReady) onStyle(); });

/* ---------- 載入資料 ---------- */
async function getJSON(u){ const r=await fetch(u); if(!r.ok) throw new Error(u+'（'+r.status+'）'); return r.json(); }
async function getTurbines(u){
  const r=await fetch(u); if(!r.ok) throw new Error(u+'（'+r.status+'）');
  let ab=await r.arrayBuffer(); const h=new Uint8Array(ab,0,2);
  if(h[0]===0x1f&&h[1]===0x8b){ // 伺服器沒有自動解壓縮時，用瀏覽器內建的 gzip 解壓
    if(!('DecompressionStream' in window)) throw new Error('瀏覽器版本太舊，無法解開風機資料');
    ab=await new Response(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return ab;
}
const [FD, TWA, TOPO50, TWTOPO, TYD, WMETA, PLD, WBUF] = await Promise.all([
  getJSON('data/farms.json'), getJSON('data/tw-farm-turbines.json'), getJSON('data/countries-50m.json'),
  getJSON('data/taiwan-counties.json'), getJSON('data/typhoons.json').catch(()=>({storms:[]})),
  getJSON('data/turbines-meta.json').catch(()=>null), getJSON('data/music.json').catch(()=>null), getTurbines('data/turbines.bin.gz').catch(e=>{console.error(e);return e;})
]);

/* ---------- 風場資料（約略值，data/farms.json） ---------- */
// k: on 陸上 / off 離岸 / float 浮動式 ; st: ret 已退役, build 建置中或分期
const FARMS = FD.farms;
const TOUR = FD.tour;
FARMS.forEach(f=>{f.ph=rnd()*TAU;f.ang=rnd()*TAU;f.pulse=rnd();f.ws=0;f.frac=0;f.rpm=0;f.px=null;});
const byId = Object.fromEntries(FARMS.map(f=>[f.id,f]));
const kindName = {on:'陸上',off:'離岸',float:'浮動式'};
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
  if(dv.getUint32(0,true)!==0x31425457||dv.getUint32(4,true)!==1) throw new Error('風機資料格式不符');
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
  const b=map.getBounds(); let w=b.getWest(), e=b.getEast(), s=b.getSouth(), n=b.getNorth();
  // 傾斜時地平線會把幾百公里外都擠進畫面上緣，只保留離中心約 2.5 個畫面寬的範圍
  const Rkm=2.5*Math.max(W,H)/kmPx, dy=Rkm/110.6, dx=Rkm/(111.3*Math.max(0.05,Math.cos(cLat*D2R)));
  if(e-w>=300||n-s>=150||e-w>2*dx||n-s>2*dy){ w=Math.max(w,cLon-dx); e=Math.min(e,cLon+dx); s=Math.max(s,cLat-dy); n=Math.min(n,cLat+dy); if(e-w>=300) return; }
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
let vv=0; const WC={vv:-1,mode:-1,list:[]}, DOTB=Array.from({length:16},()=>[]), WT_MAX=5000;
function drawWorld(g,dtR,occ){
  const now=performance.now(), lvl=kmPx<0.25?0:kmPx<2?1:2;
  if(now-wtLast>300){
    wtLast=now;
    for(const c of WCELLS){const w=windAt(c.cx,c.cy,simSec);c.ws=Math.hypot(w[0],w[1])*1.05+2.2;c.frac=powerFrac(c.ws);c.rpm=c.ws>=VCO?0:c.ws<VCI?0.6:Math.min(14,3+c.ws*0.95);c.fill=wHue(c.frac,0.95);}
    if(lvl===1) for(let k=2;k<WC.list.length;k+=3){const a=WC.list[k],w=windAt(a.cx,a.cy,simSec);a.frac=powerFrac(Math.hypot(w[0],w[1])*1.05+2.2);}
  }
  if(S.playing) for(const c of WCELLS) c.ang+=c.rpm/60*TAU*dtR/1000*1.6;
  if(WC.vv!==vv||WC.mode!==lvl){
    const fresh=WC.mode!==lvl; WC.vv=vv; WC.mode=lvl; const L=WC.list=[];
    if(lvl<2){
      // 拉遠時的亮點不需要地形高度，用比較快的平面換算
      for(const c of lvl?WAGG:WCELLS){ if(!inBox(c.cx,c.cy,0.6)) continue; const p=projectFlat(c.cx,c.cy); if(p) L.push(p[0],p[1],c); }
      if(fresh&&lvl===1) for(let k=2;k<L.length;k+=3){const a=L[k],w=windAt(a.cx,a.cy,simSec);a.frac=powerFrac(Math.hypot(w[0],w[1])*1.05+2.2);}
    }else{
      // 先用經緯度挑出畫面裡的風機；太多時（例如德國北部）固定取其中一部分，不然拖曳會卡
      const m=111*kmPx, ci=[], cc=[];
      for(const c of WCELLS){
        if(!inBox(c.cx,c.cy,0.6)||!vis(c.cx,c.cy)) continue;
        const q=projRaw(c.cx,c.cy); if(!q||q[0]<-m||q[0]>W+m||q[1]<-m||q[1]>H+m) continue;
        for(let i=c.start;i<c.start+c.n;i++){
          if(WT.own[i]) continue;
          if(inBox(WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5,0)){ ci.push(i); cc.push(c); }
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
  const col=C.dark?'#f2f7fb':'#1b3446'; let icons=0;
  for(let k=0;k<L.length;k+=4){
    const x=L[k], y=L[k+1], i=L[k+2], c=L[k+3];
    g.fillStyle=c.fill||wHue(c.frac,0.95); g.fillRect(x-1.5,y-1.5,3,3);
    if(icons>=700) continue;
    const lk=localKm(WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5), far=Math.min(1,lk/kmPx); if(far<0.3) continue;
    const kk=WT.cl[i]&15, off=WT.cl[i]>>4, D=DCL[kk]||(off?150:90), hh=Math.max(45,D*0.65+15), trueH=hh/1000*lk;
    const Hp=S.big?Math.max(trueH,BIG_MIN*far):trueH; if(!S.big&&Hp<6) continue;
    const cs=Hp*1.1, key=Math.floor(x/cs)+','+Math.floor(y/cs); if(occ.has(key)) continue; occ.add(key);
    drawTurbineTrue(g,x,y,Hp,Hp*(D/2)/hh,c.ang+i*2.399,col,farAlpha(far)); icons++;
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
  W=Math.max(200,r.width); H=Math.max(200,r.height); DPR=Math.min(2,window.devicePixelRatio||1);
  // 風線畫布每幀都要整張淡出，用 1 倍解析度就好（細線本來就柔和，看不出差別）
  const sz=(c,d)=>{c.width=Math.round(W*d);c.height=Math.round(H*d);c.style.width=W+'px';c.style.height=H+'px';};
  sz(cTrail,1); sz(cFx,DPR); gTrail.setTransform(1,0,0,1,0,0); gFx.setTransform(DPR,0,0,DPR,0,0);
  map.resize(); applyView(); initParticles(); vv++;
}
// 讓畫面中心的比例尺變成 k（像素／公里）需要的 MapLibre 縮放等級
function zoomForKm(k,lat){ return map.getZoom()+Math.log2(k/kmPx)+Math.log2(Math.max(0.02,Math.cos(lat*D2R))/Math.max(0.02,Math.cos(cLat*D2R))); }
function zoomForZ(z,lat){ return zoomForKm(z*Math.min(W,H)*0.44/6371,lat); }
/* ---------- 底圖加工：中文地名、地形陰影、立體地形、晝夜 ---------- */
// 優先用繁體中文名；name:zh 有時寫成「简;繁」或「繁/简」，各取繁體那一半
const ZH_NAME=['coalesce',['get','name:zh-Hant'],['case',['has','name:zh'],['let','z',['get','name:zh'],['case',
  ['>=',['index-of',';',['var','z']],0],['slice',['var','z'],['+',['index-of',';',['var','z']],1]],
  ['>=',['index-of','/',['var','z']],0],['slice',['var','z'],0,['index-of','/',['var','z']]],
  ['var','z']]],['get','name']]];
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
  if(!layers.some(l=>l.type==='fill-extrusion')) map.addLayer({id:'building-3d',type:'fill-extrusion',source:'openmaptiles','source-layer':'building',minzoom:14,paint:{
    'fill-extrusion-color':dark?'#5b6b8c':'#e8dccb','fill-extrusion-height':['get','render_height'],'fill-extrusion-base':['get','render_min_height'],'fill-extrusion-opacity':0.85}},firstSym);
  map.addSource('night',{type:'geojson',data:nightGeo(0)});
  map.addSource('night2',{type:'geojson',data:nightGeo(-8)});
  for(const id of ['night','night2']) map.addLayer({id,type:'fill',source:id,paint:{'fill-color':dark?'#000410':'#101e40','fill-opacity':dark?0.42:0.16,'fill-antialias':false}},firstSym);
  map.setSky(dark?{'sky-color':'#06131f','horizon-color':'#14304a','fog-color':'#0b1d2d','sky-horizon-blend':0.6,'horizon-fog-blend':0.5,'fog-ground-blend':0.6,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,6,1,9,0]}
                 :{'sky-color':'#8fcbf2','horizon-color':'#e6f4fb','fog-color':'#e6f4fb','sky-horizon-blend':0.6,'horizon-fog-blend':0.5,'fog-ground-blend':0.6,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,6,1,9,0]});
  applyBase();
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
function applyBase(){
  if(!styleReady) return;
  if(map.getLayer('tw-base')) map.removeLayer('tw-base');
  if(map.getSource('tw-base')) map.removeSource('tw-base');
  $('#baseLbl').textContent=BASE_LBL[base]; $('#bBase').setAttribute('aria-pressed',base!=='vector');
  const B=NLSC[base]; if(!B) return;
  map.addSource('tw-base',{type:'raster',tileSize:256,minzoom:7,maxzoom:18,bounds:[116.2,20.4,123.6,26.8],
    tiles:[`https://wmts.nlsc.gov.tw/wmts/${B.layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`],
    attribution:`<a href="https://maps.nlsc.gov.tw/" target="_blank">內政部國土測繪中心 ${B.name}</a>`});
  // 電子地圖本身有文字，蓋在所有底圖圖層上面；空照沒有文字，放在 3D 建築與地名下面
  const layers=map.getStyle().layers, before=base==='emap'?'night':(layers.find(l=>l.type==='fill-extrusion')||layers.find(l=>l.type==='symbol')||{}).id;
  map.addLayer({id:'tw-base',type:'raster',source:'tw-base',minzoom:7,paint:{'raster-fade-duration':200,'raster-opacity':['interpolate',['linear'],['zoom'],7,0,8,1]}},map.getLayer(before)?before:undefined);
}
function applyNightVis(){ if(!map.getLayer('night')) return; for(const id of ['night','night2']) map.setLayoutProperty(id,'visibility',S.night?'visible':'none'); }
function applyLabelVis(){ const v=S.labels&&!G.on?'visible':'none'; for(const id of placeLayers) if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',v); }
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
function windAt(lon,lat,t){
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

/* ---------- 真實颱風（手動輸入路徑） ---------- */
// 颱風路徑來自 data/typhoons.json（observed＝官方實測位置，其餘為依預報約略描繪）
const TYPHOONS=(TYD.storms||[]).map(s=>({name:s.name,en:s.en,track:s.track.map(a=>({t:Date.parse(a.t),lat:a.lat,lon:a.lon,v:a.v}))})).filter(s=>s.track.length>=2);
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
function updTyphoons(){
  TYS.length=0;
  for(const ty of TYPHOONS){const s=tyNow(ty,S.simT); if(s&&s.v>1){s.ty=ty;s.cl=Math.cos(s.lat*D2R);s.R=1.2;TYS.push(s);}}
}
let tyAng=0;
function drawTyphoons(g,dtR){
  if(S.playing) tyAng-=dtR*0.004;
  for(const ty of TYPHOONS){
    g.setLineDash([5,5]); g.strokeStyle=C.warm; g.lineWidth=1.5; g.beginPath(); let on=false;
    for(const p of ty.track){const q=project(p.lon,p.lat); if(!q){on=false;continue;} if(!on){g.moveTo(q[0],q[1]);on=true;} else g.lineTo(q[0],q[1]);}
    g.stroke(); g.setLineDash([]);
    for(const p of ty.track){const q=project(p.lon,p.lat); if(!q) continue; g.fillStyle=C.warm; g.beginPath(); g.arc(q[0],q[1],2.5,0,TAU); g.fill();}
  }
  for(const s of TYS){
    const q=project(s.lon,s.lat); if(!q) continue;
    const q2=projRaw(s.lon+1,s.lat)||q;
    const rpx=Math.min(160,Math.max(16,Math.hypot(q2[0]-q[0],q2[1]-q[1])*2.2));
    g.lineCap='round'; g.strokeStyle='rgba(255,90,60,.85)'; g.lineWidth=3.5;
    for(let arm=0;arm<2;arm++){
      g.beginPath();
      for(let t=0;t<=1.0001;t+=0.05){const a=tyAng+arm*Math.PI-t*3.2, r=rpx*(0.3+t*0.9); const x=q[0]+Math.cos(a)*r, y=q[1]+Math.sin(a)*r; t===0?g.moveTo(x,y):g.lineTo(x,y);}
      g.stroke();
    }
    g.fillStyle='rgba(255,90,60,.9)'; g.beginPath(); g.arc(q[0],q[1],Math.max(3,rpx*0.18),0,TAU); g.fill();
    g.fillStyle=C.dark?'#06131f':'#ffffff'; g.beginPath(); g.arc(q[0],q[1],Math.max(1.5,rpx*0.08),0,TAU); g.fill();
    const txt=`${s.ty.name} ${Math.round(s.v)} m/s`;
    g.font='700 13px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.textBaseline='middle'; g.lineJoin='round';
    g.lineWidth=3.5; g.strokeStyle=C.halo; g.strokeText(txt,q[0]+rpx*1.3,q[1]);
    g.fillStyle='rgb(255,110,70)'; g.fillText(txt,q[0]+rpx*1.3,q[1]);
  }
}

/* 簡化功率曲線：切入 3、額定 12、切出 25 m/s；P ∝ v³（P = ½ρAC_p v³） */
const VCI=3, VR=12, VCO=25;
function powerFrac(v){ if(v<VCI||v>=VCO) return 0; if(v>=VR) return 1; return (v**3-VCI**3)/(VR**3-VCI**3); }
function farmWind(f){
  const w=windAt(f.lon,f.lat,simSec); let s=Math.hypot(w[0],w[1]);
  s = s*(f.k==='on'?1.05:1.2)+(f.k==='on'?2.2:3.2)+1.3*Math.sin(simSec/1800+f.ph);
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
const BFN=['無風','軟風','輕風','微風','和風','清風','強風','疾風','大風','烈風','狂風','暴風','颶風'];
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
function partCount(){ return Math.round(Math.min(2600,Math.max(600,W*H/480))*(kmPx>=2?0.5:1)); }
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

function drawTurbine(g,x,y,s,ang,col){
  g.strokeStyle=C.muted; g.lineWidth=Math.max(1,s*0.07);
  g.beginPath(); g.moveTo(x,y); g.lineTo(x,y-s); g.stroke();
  const hx=x, hy=y-s, L=s*0.78, w=s*0.075;
  g.fillStyle=col; g.beginPath();
  for(let k=0;k<3;k++){
    const a=ang+k*TAU/3, ca=Math.cos(a), sa=Math.sin(a);
    g.moveTo(hx-sa*w,hy+ca*w); g.lineTo(hx+ca*L,hy+sa*L); g.lineTo(hx+sa*w,hy-ca*w);
  }
  g.fill();
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
function drawTurbineTrue(g,x,y,Hp,R,ang,col,alpha=1){
  if(alpha<=0.02) return;
  g.globalAlpha=alpha;
  g.strokeStyle=C.muted; g.lineWidth=Math.max(1,Hp*0.045);
  g.beginPath(); g.moveTo(x,y); g.lineTo(x,y-Hp); g.stroke();
  const hx=x, hy=y-Hp, w=Math.max(0.8,R*0.07);
  g.fillStyle=col; g.beginPath();
  for(let k=0;k<3;k++){const a=ang+k*TAU/3, ca=Math.cos(a), sa=Math.sin(a);
    g.moveTo(hx-sa*w,hy+ca*w); g.lineTo(hx+ca*R,hy+sa*R); g.lineTo(hx+sa*w,hy-ca*w);}
  g.fill();
  g.beginPath(); g.arc(hx,hy,Math.max(1.2,R*0.06),0,TAU); g.fillStyle=C.warm; g.fill();
  g.globalAlpha=1;
}
function drawTrueSet(g,list,D,hh,ang0,colFn,farm,spKm,occ){
  const col=C.dark?'#f2f7fb':'#1b3446';
  for(const t of list){
    if(!inBox(t.lon,t.lat,0)) continue;
    const p=project(t.lon,t.lat); if(!p) continue;
    if(farm) tPick.push([p[0],p[1],farm]);
    const lk=localKm(t.lon,t.lat), far=Math.min(1,lk/kmPx);
    const D_=t.D||D, h_=t.hh||hh, trueH=h_/1000*lk;
    g.fillStyle=colFn(t); g.beginPath(); g.arc(p[0],p[1],Math.max(1.6,Math.min(5,D_/1000*lk*0.05)),0,TAU); g.fill();
    if(far<0.3) continue;
    const Hp=S.big?Math.max(trueH,BIG_MIN*far):trueH;
    if(!S.big&&Hp<6) continue;
    if(S.big&&Hp>trueH*1.05){ const cs=Hp*0.8, key=Math.floor(p[0]/cs)+','+Math.floor(p[1]/cs); if(occ.has(key)) continue; occ.add(key); }
    drawTurbineTrue(g,p[0],p[1],Hp,Hp*(D_/2)/h_,ang0+t.ang,col,farAlpha(far));
  }
}

function drawFarms(dtR){
  const g=gFx; g.clearRect(0,0,W,H);
  drawTyphoons(g,dtR);
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
      for(let i=n-1;i>=0;i--){const o=OFFS[i];drawTurbine(g,p[0]+o[0]*s*0.9,p[1]+o[1]*s*0.9+s*0.35,s,f.ang+i*0.9,C.dark?'#f2f7fb':'#1b3446');}
    }else{
      g.fillStyle=farmColor(f,1); g.beginPath(); g.arc(p[0],p[1],Math.max(1.8,f.r*0.38),0,TAU); g.fill();
    }
    if(f===S.sel){
      g.strokeStyle=C.warm; g.lineWidth=2; g.beginPath(); g.arc(p[0],p[1],f.r*2.1+4,0,TAU); g.stroke();
    }
  }
  if(detailed&&EXTRA.length){
    drawTrueSet(g,EXTRA,100,80,performance.now()/1000*1.2,t=>{const w=windAt(t.lon,t.lat,simSec);return `hsla(${195-powerFrac(Math.hypot(w[0],w[1])*1.05+2.2)*150},90%,${C.dark?62:44}%,.95)`;},null,0.4,occ);
  }
  drawGameMark(g);
  if(S.big&&detailed){ const t='風機圖示已放大，大小非等比例（按 B 切換）'; g.font='500 12px "Noto Sans TC",sans-serif'; g.textAlign='center'; g.textBaseline='bottom'; g.lineWidth=3; g.strokeStyle=C.halo; g.strokeText(t,W/2,H-12); g.fillStyle=C.warm; g.fillText(t,W/2,H-12); g.textAlign='start'; }
  if(S.labels){
    labelBoxes=[];
    g.font='500 12px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.textBaseline='middle'; g.lineJoin='round';
    const order=FARMS.filter(f=>f.px).sort((a,b)=>(b===S.sel)-(a===S.sel)||(b.tw?1:0)-(a.tw?1:0)||b.mw-a.mw);
    for(const f of order){
      const show = f===S.sel || Z>=2.4 || f.mw>=1200 || (f.tw&&Z>=1.8) || f.id==='rossisland'||f.id==='formosa1';
      if(!show) continue;
      const txt=f.n.replace(/（.*?）/,''), w=g.measureText(txt).width;
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
  for(const t of tPick){const d=Math.hypot(t[0]-x,t[1]-y); if(d<12&&d<bd){bd=d;best=t[2];}}
  if(best) return best;
  for(const f of FARMS){ if(!f.px) continue; const d=Math.hypot(f.px[0]-x,f.px[1]-y); const lim=Math.max(14,(f.r||6)+6); if(d<lim&&d<bd){bd=d;best=f;} }
  return best;
}
for(const ev of ['dragstart','zoomstart','rotatestart','pitchstart']) map.on(ev,e=>{ if(e.originalEvent) userTook(); });
map.on('move',()=>{ vv++; if(!zenMove) clearTrails(); });
map.on('sourcedata',e=>{ if(e.sourceId==='dem-tr'&&e.tile){ vv++; ELEV.fill(NaN); } });
map.on('moveend',()=>{ fly=false; });
map.on('click',e=>{
  const x=e.point.x, y=e.point.y;
  if(S.zen){setZen(false);}
  else if(G.on){ const ll=unproj(x,y); if(ll&&isFinite(ll[0])&&vis(ll[0],ll[1])) gameClick(ll[0],ll[1]); }
  else{const f=pick(x,y); if(f){userTook();select(f,true);} else select(null);}
});
map.on('mousemove',e=>{ map.getCanvas().style.cursor=!G.on&&pick(e.point.x,e.point.y)?'pointer':''; });

// z 沿用舊版的縮放倍率；放大到看得見一支支風機時，依「地形」開關決定要不要傾斜
function flyTo(lon,lat,z,dur=1800,km){
  const kT=km||z*Math.min(W,H)*0.44/6371, zoom=Math.min(17,zoomForKm(kT,lat));
  fly=true;
  map.flyTo({center:[lon,lat],zoom,duration:dur,pitch:S.tilt?(kT>=0.5?55:kT>=0.08?35:0):0,bearing:kT>=0.5?map.getBearing():0,essential:true});
}

/* ---------- 面板 ---------- */
const panel=$('#panel'), rotor=$('#rotor');
function select(f,go){
  S.sel=f;
  if(!f){panel.hidden=true;return;}
  hideHint(); addSticker(f);
  panel.hidden=false;
  const kd=$('#pKind'); kd.className='p-kind '+(f.st==='ret'?'ret':f.k);
  kd.textContent=(kindName[f.k]||'')+'風場'+(f.st==='ret'?'・已退役':f.st==='build'?'・建置／分期運轉中':'');
  $('#pName').textContent=f.n; $('#pEn').textContent=f.e; $('#pLoc').textContent=f.c+'　'+f.y+' 年啟用';
  $('#pCap').textContent=fmtMW(f.mw); $('#pT').textContent='約 '+f.t.toLocaleString()+' 支';
  $('#pNote').textContent=f.note;
  let meta=`${Math.abs(f.lat).toFixed(2)}°${f.lat>=0?'N':'S'}，${Math.abs(f.lon).toFixed(2)}°${f.lon>=0?'E':'W'}（約略中心）`;
  if(f.tur) meta+=`。機型 ${f.unit}，葉輪直徑 ${f.D} m，輪轂高約 ${f.hh} m。`+(f.realN?`風機位置：${f.osm?'OpenStreetMap 標註的實際位置':'匯入的實測座標'} ${f.realN} 支${f.realN<f.t*0.9?`（全場約 ${f.t} 支，其餘尚未被標註）`:''}。`:`風機位置：依間距約 ${f.sp} km 等比例示意排列，非實測座標。`);
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
  $('#pWs').textContent=f.ws.toFixed(1)+' m/s'; $('#pBf').textContent=`${bf} 級 ${BFN[bf]}`;
  const out=f.mw*f.frac;
  $('#pOut').textContent=fmtMW(out); $('#pPct').textContent=Math.round(f.frac*100)+'%';
  $('#pRpm').textContent=f.rpm.toFixed(1)+' rpm';
  $('#pState').textContent=f.st==='ret'?'已退役':f.ws>=VCO?'風太強，保護停機':f.ws<VCI?'風太小，慢慢空轉':f.frac>=1?'全力發電':'發電中';
  const homes=out*1000/0.42;
  $('#pHome').textContent=homes>=10000?(homes/10000).toFixed(homes>=1e5?0:1)+' 萬':Math.round(homes).toLocaleString();
}
$('#pClose').onclick=()=>select(null);

/* ---------- 控制列 ---------- */
const bPlay=$('#bPlay'), spd=$('#spd'), tl=$('#tl');
function setPlaying(p){S.playing=p;bPlay.textContent=p?'❚❚':'▶';bPlay.setAttribute('aria-label',p?'暫停':'播放');}
bPlay.onclick=()=>setPlaying(!S.playing);
function setSpeed(i){S.speedIdx=Math.max(0,Math.min(5,i));spd.value=S.speedIdx;$('#spdV').textContent=SPD_LBL[S.speedIdx];}
spd.oninput=()=>setSpeed(+spd.value);
let tlDrag=false;
tl.addEventListener('pointerdown',()=>tlDrag=true); window.addEventListener('pointerup',()=>tlDrag=false);
tl.oninput=()=>{const d0=twDayStart(S.simT);S.simT=d0+(+tl.value)*60000;};
function twDayStart(ms){const t=ms+8*3600000;return t-(t%86400000)-8*3600000;}
$('#bNow').onclick=()=>{S.simT=Date.now();};
function toggleBtn(id,key,after){const b=$(id);b.onclick=()=>{S[key]=!S[key];b.setAttribute('aria-pressed',S[key]);after&&after();};}
toggleBtn('#bWind','wind',()=>clearTrails());
toggleBtn('#bNight','night',()=>{lastNightT=0;lastNightR=0;updNight();applyNightVis();});
toggleBtn('#bLabel','labels',()=>applyLabelVis());
toggleBtn('#bBig','big',()=>{$('#bigLbl').textContent=S.big?'放大':'等比例';});
toggleBtn('#bTilt','tilt',()=>{$('#tiltLbl').textContent=S.tilt?'立體':'平坦';applyTilt(true);});
$('#bView').onclick=()=>{
  S.mode=S.mode==='3d'?'2d':'3d'; $('#viewLbl').textContent=S.mode==='3d'?'地球':'平面'; $('#bView').setAttribute('aria-pressed',S.mode==='3d');
  if(styleReady) map.setProjection({type:S.mode==='3d'?'globe':'mercator'});
  clearTrails(); setTimeout(()=>{applyView();initParticles();vv++;},50);
};
function applyTheme(){
  if(theme==='auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',theme);
  $('#themeLbl').textContent=THEME_LBL[theme]; readColors(); clearTrails();
  const k=isDark()?'dark':'light'; document.documentElement.setAttribute('data-dark',k==='dark'?'1':'0');
  if(k!==styleKey){ styleKey=k; styleReady=false; map.setStyle(STYLE_URL[k]); }
}
$('#bBase').onclick=()=>{ base=BASES[(BASES.indexOf(base)+1)%BASES.length]; try{localStorage.setItem('windglobe-base',base);}catch(e){} applyBase();
  if(base!=='vector'&&(kmPx<0.1||Math.abs(cLon-120.9)>4||Math.abs(cLat-23.7)>4)) toast(`${BASE_LBL[base]}只有台灣範圍，放大到台灣就看得到`); };
$('#bTheme').onclick=()=>{theme=THEMES[(THEMES.indexOf(theme)+1)%3];try{localStorage.setItem('windglobe-theme',theme);}catch(e){}applyTheme();};
darkMQ.addEventListener('change',()=>applyTheme());

function setTour(on){
  S.tour=on; $('#bTour').setAttribute('aria-pressed',on);
  if(on){S.tourIdx=0;tourGo();}
}
function tourGo(){
  const f=byId[TOUR[S.tourIdx%TOUR.length]]; S.tourIdx++;
  select(f,false); flyTo(f.lon,f.lat,S.mode==='3d'?4.2:6,2600); S.tourNext=performance.now()+10000;
}
$('#bTour').onclick=()=>setTour(!S.tour);
const hintEl=$('#hint');
function setZen(on){
  S.zen=on; document.body.classList.toggle('zen',on); $('#bZen').setAttribute('aria-pressed',on);
  if(on){ if(!S.tour){flyTo(cLon,cLat,1.1,2000);} hintEl.textContent='放空中⋯點一下地圖就回來'; hintEl.classList.remove('gone'); setTimeout(hideHint,3500); }
}
function hideHint(){hintEl.classList.add('gone');}
setTimeout(hideHint,9000);
$('#bZen').onclick=()=>setZen(!S.zen);
$('#bFs').onclick=()=>{const st=$('#stage');try{if(document.fullscreenElement)document.exitFullscreen();else st.requestFullscreen();}catch(e){}};
document.addEventListener('fullscreenchange',()=>setTimeout(resize,60));

/* ---------- 風聲・白噪音（Web Audio 即時合成） ---------- */
const SND_TYPES=[['breeze','原野微風','跟著地圖上的風速變大變小'],['sea','海邊風浪','低低的風聲，加上一波一波的浪'],['valley','山谷呼嘯','高高低低的呼呼聲'],['storm','颱風暴風','又強又急的陣風'],['white','白噪音','平穩的沙沙聲，適合專心或睡覺']];
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
  if(on){ startSound(); toast('≋ '+SND_TYPES.find(x=>x[0]===sndType)[1]+(MUS.on?'（背景音樂自動變小聲）':''),2200); }
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
  else if(k==='w'||k==='W') $('#bWind').click();
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
    if(ok&&q) ok=(f.n+f.e+f.c).toLowerCase().includes(q);
    f.card.hidden=!ok;
  }
}
$('#chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;filt0=b.dataset.f;for(const x of $('#chips').children)x.setAttribute('aria-pressed',x===b);filterCards();};
$('#q').oninput=e=>{query=e.target.value;filterCards();};
function updCards(){
  for(const f of FARMS){
    if(f.card.hidden) continue;
    f.card.querySelector('.o').textContent=f.st==='ret'?'已退役':f.ws>=VCO?'保護停機':`風速 ${f.ws.toFixed(1)} m/s・輸出 ${Math.round(f.frac*100)}%`;
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
  $('#impMsg').textContent=`已匯入 ${pts.length} 支風機的實測座標：${inF} 支對應到 ${groups.size} 座台灣離岸風場（取代示意排列），其餘 ${pts.length-inF} 支以一般風機（葉輪約 100 m）顯示在原位置。放大到看得見比例尺 1 km 左右就會出現。`;
  $('#bImpClr').hidden=false;
}
$('#bImp').onclick=()=>$('#fImp').click();
$('#fImp').onchange=async e=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const pts=parseImport(await file.text());
    if(!pts.length){$('#impMsg').textContent='檔案裡沒有讀到任何座標點。GeoJSON 請用 Point；CSV 第一列請放欄位名稱（例如 lon,lat 或 X,Y）。';return;}
    const groups=applyImport(pts); importMsg(pts,groups);
    try{localStorage.setItem('windglobe-turbines',JSON.stringify(pts));}catch(err){}
    if(S.sel) select(S.sel,false);
  }catch(err){ $('#impMsg').textContent='讀取失敗：'+err.message+'。請確認檔案是 GeoJSON、Overpass JSON 或 CSV。'; }
  e.target.value='';
};
$('#bImpClr').onclick=()=>{
  applyBuiltin(); try{localStorage.removeItem('windglobe-turbines');}catch(err){}
  $('#bImpClr').hidden=true; $('#impMsg').textContent='已清除匯入的座標，回到 OpenStreetMap 的風機位置。';
  if(S.sel) select(S.sel,false);
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
  $('#tlDay').textContent=`${t.getUTCMonth()+1}/${t.getUTCDate()} 週${WK[t.getUTCDay()]}`;
  if(!tlDrag) tl.value=hh*60+mm;
  let out=0,run=0; for(const f of FARMS){out+=f.mw*f.frac; if(f.frac>0) run++;}
  $('#outGW').textContent=(out/1000).toFixed(1);
  $('#outBar').style.width=(out/capTotal*100).toFixed(1)+'%';
  $('#hudCount').textContent=`${run} 座風場發電中`;
  const tr=$('#tyRow');
  if(TYS.length){const s=TYS[0], dTW=d3.geoDistance([s.lon,s.lat],[121,23.7])*6371; tr.hidden=false; tr.textContent=`🌀 ${s.ty.name}（${s.ty.en}）近中心約 ${Math.round(s.v)} m/s・距台灣約 ${Math.round(dTW/10)*10} 公里`;}
  else tr.hidden=true;
  updPanel();
  if(now-lastCards>1000){lastCards=now;updCards();}
}

/* ---------- 主迴圈 ---------- */
let last=performance.now(), windWas=true;
function frame(now){
  const dtR=Math.min(100,now-last); last=now;
  if(S.playing){ const dts=dtR/1000*S.speeds[S.speedIdx]; S.simT+=dts*1000; simSec=S.simT/1000; stepVort(dts); }
  updTyphoons();
  if(S.zen&&!fly&&!map.isMoving()){ zenMove=true; map.jumpTo({center:[cLon+dtR*0.0028,cLat]}); zenMove=false; }
  if(S.tour&&!fly&&now>S.tourNext) tourGo();
  updateFarms(dtR);
  updMusic(now,dtR);
  if(V3.open){ updSound(now); requestAnimationFrame(frame); return; }
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
  requestAnimationFrame(frame);
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
function say(text){ if(!S.voice||!('speechSynthesis' in window)) return; try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang='zh-TW'; u.rate=0.95; u.pitch=1.1; speechSynthesis.speak(u);}catch(e){} }
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
  toast(`得到新貼紙：${f.n.replace(/（.*?）/,'')}！（${STICK.size}/${FARMS.length}）`); say(`得到新貼紙，${f.n.replace(/（.*?）/,'')}`);
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
    b.querySelector('span').textContent=got?f.n.replace(/（.*?）/,''):f.c.split('・')[0];
    if(got) b.onclick=()=>{ $('#book').hidden=true; userTook(); select(f,true); };
    grid.appendChild(b);
  }
}
$('#bkClose').onclick=()=>$('#book').hidden=true;

/* ================= 小遊戲選單 ================= */
const gmenu=$('#gmenu');
$('#bGames').onclick=e=>{ e.stopPropagation(); gmenu.hidden=!gmenu.hidden; };
document.addEventListener('click',e=>{ if(!gmenu.hidden&&!gmenu.contains(e.target)&&e.target.id!=='bGames') gmenu.hidden=true; });
$('#gmFind').onclick=()=>{ gmenu.hidden=true; startFind(); };
$('#gmBlow').onclick=()=>{ gmenu.hidden=true; const f=S.sel&&S.sel.tur?S.sel:byId.gch; userTook(); select(f,true); setTimeout(()=>open3D(specForFarm(f)),600); };
$('#gmBook').onclick=()=>{ gmenu.hidden=true; updBook(); $('#book').hidden=false; };
$('#gmVoice').onclick=()=>{ S.voice=!S.voice; $('#gmVoice').setAttribute('aria-pressed',S.voice); $('#gmVoice').textContent=S.voice?'語音朗讀：開':'語音朗讀：關'; };

/* ================= 遊戲一：找找看 ================= */
const GT=[[158,'台灣'],[392,'日本'],[156,'中國'],[840,'美國'],[36,'澳洲'],[826,'英國'],[76,'巴西'],[356,'印度'],[10,'南極洲'],[124,'加拿大'],[276,'德國'],[818,'埃及'],[404,'肯亞'],[710,'南非'],[643,'俄羅斯'],[484,'墨西哥'],[208,'丹麥'],[578,'挪威'],[32,'阿根廷'],[410,'韓國'],[608,'菲律賓'],[724,'西班牙'],[250,'法國'],[554,'紐西蘭']];
const G={on:false,list:[],i:0,tries:0,score:0,mark:null,wait:false};
function startFind(){
  select(null); if(S.tour) setTour(false); if(S.zen) setZen(false);
  G.on=true; G.list=d3.shuffle(GT.slice()).slice(0,8); G.i=0; G.score=0; applyLabelVis();
  $('#gbar').hidden=false; flyTo(cLon,Math.max(-40,Math.min(40,cLat)),1,1400);
  showRound();
}
function showRound(){
  G.tries=0; G.wait=false; const t=G.list[G.i];
  $('#gq').textContent=`第 ${G.i+1}/${G.list.length} 題：${t[1]}在哪裡？點點看！`; $('#gs').textContent='⭐ '+G.score; $('#ghint').textContent='轉動地球，找到後點一下。（地名先藏起來囉）';
  say(`找找看，${t[1]}在哪裡？`);
}
function endFind(){ G.on=false; G.mark=null; $('#gbar').hidden=true; applyLabelVis(); }
function bearingName(a,b){
  const p1=a[1]*D2R,p2=b[1]*D2R,dl=(b[0]-a[0])*D2R;
  const th=Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))/D2R;
  return ['北','東北','東','東南','南','西南','西','西北'][Math.round(((th+360)%360)/45)%8];
}
function nextRound(){
  G.i++;
  if(G.i>=G.list.length){
    $('#gq').textContent=`完成！你找到了 ${G.score} 個地方`; $('#ghint').textContent='按「結束」回到地球，或從小遊戲再玩一次。';
    say(`完成了！你找到了 ${G.score} 個地方，好厲害！`); confetti($('#map')); G.wait=true; return;
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
    const msg=farms.length?`答對了！${t[1]}有「${farms[0].n.replace(/（.*?）/,'')}」${farms.length>1?`等 ${farms.length} 座風場`:''}。`:`答對了！這裡是${t[1]}。`;
    $('#ghint').textContent=msg; say(msg); confetti($('#map'));
    G.wait=true; flyTo(f.anchor[0],Math.max(-70,Math.min(70,f.anchor[1])),t[0]===158?6:2.2,1600);
    setTimeout(nextRound,4200);
  }else{
    G.tries++;
    if(G.tries>=3){
      const m=`${t[1]}在這裡！我們一起看看。`; $('#ghint').textContent=m; say(m); G.wait=true;
      flyTo(f.anchor[0],Math.max(-70,Math.min(70,f.anchor[1])),t[0]===158?6:2.2,1600); setTimeout(nextRound,4200);
    }else{
      const dir=bearingName([lon,lat],f.anchor), d=Math.round(d3.geoDistance([lon,lat],f.anchor)*6371/100)*100;
      const m=`不是這裡喔！${t[1]}在你點的地方的${dir}邊，大約 ${d.toLocaleString()} 公里。`; $('#ghint').textContent=m; say(`不是這裡喔，再往${dir}邊找找`);
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
// 地圖中心在台灣一帶時依序輪播 taiwan 清單，其他地方從其餘曲目隨機播放；換地區時等 3 秒再淡出換歌，飛過去不會一直切
const PL={dir:'Music/',tw:[],rest:[],el:null,region:null,want:null,wantT:0,twIdx:-1,recent:[],v:0,target:0,failed:0,synth:false};
if(PLD&&Array.isArray(PLD.files)){ PL.dir=PLD.dir||PL.dir; PL.tw=(PLD.taiwan||[]).filter(f=>PLD.files.includes(f)); PL.rest=PLD.files.filter(f=>!PL.tw.includes(f)); }
const MP3_VOL=0.55;
function inTaiwan(){ return Z>=2.5&&cLon>=119.0&&cLon<=122.3&&cLat>=21.7&&cLat<=25.6; }
function nextTrack(region){
  if(region==='tw'&&PL.tw.length){ PL.twIdx=(PL.twIdx+1)%PL.tw.length; return PL.tw[PL.twIdx]; }
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
      if(++PL.failed>=3){ PL.synth=true; toast('音樂檔讀取失敗，改用電腦合成的音樂'); setSynth(true); } else playTrack(PL.region); });
  }
  const f=nextTrack(region); PL.region=region; PL.want=null;
  PL.el.src=PL.dir+encodeURIComponent(f); PL.v=0; PL.el.volume=0; PL.target=MP3_VOL*duck();
  PL.el.play().catch(()=>{});
  const nm=f.replace(/\.[^.]+$/,''); if(!/^\d+$/.test(nm)) toast('♫ '+nm,2500);
}
let lastDuck=0;
function updMusic(now,dtR){
  if(MUS.ac&&MUS.on&&now-lastDuck>500){ lastDuck=now; MUS.out.gain.setTargetAtTime(0.32*MUS.vol*duck(),MUS.ac.currentTime,0.6); }
  if(!PL.el||PL.synth) return;
  if(MUS.on){
    const want=inTaiwan()?'tw':'world';
    if(want===PL.region) PL.want=null;
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
function setMusic(on){
  MUS.on=on; $('#bMus').setAttribute('aria-pressed',on);
  if(PL.synth||!(PL.tw.length+PL.rest.length)){ setSynth(on); return; }
  if(on){ if(!PL.el||!PL.region) playTrack(inTaiwan()?'tw':'world'); else { PL.el.play().catch(()=>{}); PL.target=MP3_VOL*duck(); } }
  else PL.target=0;
}
$('#bMus').onclick=()=>setMusic(!MUS.on);

/* ================= 3D 風場（three.js）＋ 吹風發電遊戲 ================= */
let THREE_P=null;
function loadThree(){
  if(window.THREE) return Promise.resolve();
  if(THREE_P) return THREE_P;
  THREE_P=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';s.onload=()=>res();s.onerror=()=>{THREE_P=null;rej(new Error('3D 元件載入失敗，請檢查網路後再試一次'));};document.head.appendChild(s);});
  return THREE_P;
}
const V3={open:false,r:null,scene:null,cam:null,turbs:[],houses:[],lights:[],az:0.35,el:0.32,dist:1000,R:500,boost:0,blowing:false,spin:0,full:0,done:false,last:0,idle:0,water:null,wbase:null,streak:null,spec:null,night:false};
function nearPts(lon,lat,km){
  const out=[], cosl=Math.cos(lat*D2R);
  const add=(plon,plat,D,hh,off)=>{const dx=(plon-lon)*111.32*cosl, dy=(plat-lat)*110.57, d=Math.hypot(dx,dy); if(d<km) out.push({lon:plon,lat:plat,D,hh,off,d});};
  for(const t of EXTRA) add(t.lon,t.lat,t.D||90,t.hh||Math.max(45,(t.D||90)*0.65+15),0);
  for(const f of FARMS) if(f.tur) for(const t of f.tur) add(t.lon,t.lat,t.D||f.D,t.hh||f.hh,f.k!=='on'?1:0);
  const dl=km/(111.32*Math.max(0.15,cosl))+1, dt=km/110.57+1;
  for(const c of WCELLS){
    if(Math.abs(c.cx-lon)>dl||Math.abs(c.cy-lat)>dt) continue;
    for(let i=c.start;i<c.start+c.n;i++){if(WT.own[i]) continue; const k=WT.cl[i]&15,off=WT.cl[i]>>4,D=DCL[k]||(off?150:90); add(WT.xy[2*i]/1e5,WT.xy[2*i+1]/1e5,D,Math.max(45,D*0.65+15),off);}
  }
  out.sort((a,b)=>a.d-b.d); return out.slice(0,160);
}
function specForFarm(f){
  let pts;
  if(f.tur) pts=f.tur.map(t=>({lon:t.lon,lat:t.lat,D:t.D||f.D,hh:t.hh||f.hh}));
  else pts=nearPts(f.lon,f.lat,15);
  return {title:f.n.replace(/（.*?）/,''),off:f.k!=='on',lon:f.lon,lat:f.lat,pts,farm:f};
}
function specHere(){
  const pts=nearPts(cLon,cLat,12);
  const off=pts.filter(p=>p.off).length>pts.length/2;
  return {title:'這附近的風機',off,lon:cLon,lat:cLat,pts,farm:null};
}
function v3Wind(){
  const sp=V3.spec; if(sp.farm) return sp.farm.ws;
  const w=windAt(sp.lon,sp.lat,simSec); return Math.max(0,Math.hypot(w[0],w[1])*(sp.off?1.2:1.05)+(sp.off?3.2:2.2));
}
function disposeScene(sc){ sc.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose()); } }); }
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
async function open3D(spec){
  if(!spec.pts||!spec.pts.length){ toast('這附近沒有風機資料，換個地方試試看'); return; }
  toast('正在準備 3D 風場…',1500);
  try{ await loadThree(); }catch(e){ toast(e.message); return; }
  const T=THREE, el=$('#v3d'); el.hidden=false; document.body.classList.add('v3on');
  V3.spec=spec; V3.open=true; V3.boost=0; V3.done=false; V3.full=0; V3.spin=0.5; V3.idle=0;
  if(!V3.r){ V3.r=new T.WebGLRenderer({canvas:$('#c3d'),antialias:true}); V3.r.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); }
  if(V3.scene) disposeScene(V3.scene);
  const sc=new T.Scene(); V3.scene=sc; V3.turbs=[]; V3.houses=[]; V3.lights=[];
  const lon0=d3.mean(spec.pts,p=>p.lon), lat0=d3.mean(spec.pts,p=>p.lat), cl=Math.cos(lat0*D2R);
  const pos=spec.pts.map(p=>({x:(p.lon-lon0)*111320*cl, z:-(p.lat-lat0)*110574, D:p.D, hh:p.hh}));
  let R=300; for(const p of pos) R=Math.max(R,Math.hypot(p.x,p.z)); V3.R=R;
  const sun=sunPos(S.simT), sunAlt=90-d3.geoDistance([sun[0],sun[1]],[lon0,lat0])/D2R;
  V3.night=V3.nightOverride!=null?V3.nightOverride:sunAlt<-4;
  const sky=V3.night?0x1b2f63:(sunAlt<8?0xf3b59a:0x9fd4ff);
  sc.background=new T.Color(sky); sc.fog=new T.Fog(sky,R*1.2+1500,R*7+9000);
  sc.add(new T.HemisphereLight(V3.night?0x6f86c8:0xffffff,V3.night?0x18233a:0x557755,V3.night?0.8:0.65));
  const dl=new T.DirectionalLight(V3.night?0xaec0ff:0xfff2dd,V3.night?0.5:0.75); dl.position.set(-0.6,1,0.5); sc.add(dl);
  const size=R*8+16000, LANDY=6, Rv=size/2;
  const rings=landRings(lon0,lat0,cl,Rv);
  const pip=(x,z)=>{const y=-z; for(const r of rings){ let ins=false; for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins;} if(ins) return true; } return false;};
  const gg=new T.PlaneGeometry(size,size,90,90); gg.rotateX(-Math.PI/2);
  sc.add(new T.Mesh(gg,new T.MeshPhongMaterial({color:V3.night?0x1a4677:0x2f78b8,shininess:70,flatShading:true})));
  V3.water=gg; V3.wbase=Float32Array.from(gg.attributes.position.array);
  const landM=new T.MeshLambertMaterial({color:V3.night?0x2c4a2e:0x5f8a3f,side:T.DoubleSide});
  for(const r of rings){ if(r.length<3) continue; const sg=new T.ShapeGeometry(new T.Shape(r.map(p=>new T.Vector2(p[0],p[1])))); sg.rotateX(-Math.PI/2); const m=new T.Mesh(sg,landM); m.position.y=LANDY; sc.add(m); }
  for(const p of pos) p.land=pip(p.x,p.z);
  { const tg=new T.ConeGeometry(14,40,6); tg.translate(0,20,0); const tm=new T.MeshLambertMaterial({color:V3.night?0x1e3d22:0x3f8a3a});
    const rr=mulberry32(99); let nt=0;
    for(let i=0;i<1200&&nt<260;i++){ const x=(rr()-0.5)*R*5-0, z=(rr()-0.5)*R*5; if(!pip(x,z)) continue; if(pos.some(p=>Math.abs(p.x-x)<70&&Math.abs(p.z-z)<70)) continue;
      const t=new T.Mesh(tg,tm); t.position.set(x,LANDY,z); const s=0.7+rr()*0.9; t.scale.set(s,s,s); sc.add(t); nt++; } }
  // 村莊：優先放在真實陸地上，陸地太遠時才用示意小島
  let fr=pos[0]; for(const p of pos) if(p.z>fr.z) fr=p;
  let vx=fr.x, vz=fr.z+650, onLand=false;
  if(fr.land){ for(const k of [650,400,250]){ if(pip(fr.x,fr.z+k)){ vz=fr.z+k; onLand=true; break; } } }
  if(!onLand){
    let best=null,bd=5000; for(const r of rings) for(const q of r){ const d=Math.hypot(q[0]-fr.x,-q[1]-fr.z); if(d<bd){bd=d;best=q;} }
    if(best){ const bx=best[0], bz=-best[1], dx=bx-fr.x, dz=bz-fr.z, dn=Math.hypot(dx,dz)||1;
      for(const k of [200,400,650,1000]){ const x=bx+dx/dn*k, z=bz+dz/dn*k; if(pip(x,z)){ vx=x; vz=z; onLand=true; break; } } }
  }
  const island=!onLand, hy=island?4:LANDY;
  if(island){ const isl=new T.Mesh(new T.CylinderGeometry(520,620,8,40),new T.MeshLambertMaterial({color:V3.night?0x24402a:0x7cbf63})); isl.position.set(vx,0,vz); sc.add(isl);
    const sand=new T.Mesh(new T.CylinderGeometry(660,700,4,40),new T.MeshLambertMaterial({color:V3.night?0x5c5440:0xf1dfa8})); sand.position.set(vx,0,vz); sc.add(sand); }
  const hb=new T.BoxGeometry(46,30,40); hb.translate(0,15,0); const hr=new T.ConeGeometry(36,22,4); hr.rotateY(Math.PI/4); hr.translate(0,41,0);
  const roofCols=[0xd9534f,0x2f7ad6,0xf0a830,0x8a5cd6,0x3cae6b];
  const cand=[]; for(let row=0;row<5;row++) for(let col=0;col<5;col++) cand.push([vx+(col-2)*110+(row%2?40:0), vz-200+row*120]);
  let spots=island?cand.slice(0,12):cand.filter(c=>pip(c[0],c[1])).slice(0,12);
  if(spots.length<6) spots=cand.slice(0,12);
  spots.forEach((c,i)=>{
    const m=new T.MeshLambertMaterial({color:0xf3ead8,emissive:0x000000});
    const hs=new T.Mesh(hb,m); hs.position.set(c[0],hy,c[1]); hs.rotation.y=(rnd()-0.5)*0.4; sc.add(hs);
    const roof=new T.Mesh(hr,new T.MeshLambertMaterial({color:roofCols[i%roofCols.length]})); roof.position.copy(hs.position); roof.rotation.y=hs.rotation.y; sc.add(roof);
    V3.houses.push(m);
  });
  const cdx=vx-fr.x, cdz=vz-fr.z, cdn=Math.hypot(cdx,cdz)||1;
  V3.camAz=Math.atan2(cdx,cdz); V3.camDist=Math.max(1100,fr.hh*13,cdn*0.9+900); V3.island=island; V3.tgt=[fr.x+cdx*0.35,fr.hh*0.5,fr.z+cdz*0.35];
  // 風機
  const w=windAt(lon0,lat0,simSec); const yaw=Math.atan2(-w[0],w[1]);
  const towerG=new T.CylinderGeometry(0.6,1,1,14); towerG.translate(0,0.5,0);
  const nacG=new T.BoxGeometry(1,1,1); const hubG=new T.SphereGeometry(1,14,10);
  const bladeG=new T.BoxGeometry(0.075,1,0.02,1,8,1); bladeG.translate(0,0.5,0);
  { const a=bladeG.attributes.position; for(let i=0;i<a.count;i++){const y=a.getY(i); a.setX(i,a.getX(i)*(1-0.75*y)+ (y<0.15?0:0.012*(1-y))); } a.needsUpdate=true; bladeG.computeVertexNormals(); }
  const white=new T.MeshLambertMaterial({color:0xf4f6f8,emissive:V3.night?0x2a3346:0x000000}), yellow=new T.MeshLambertMaterial({color:0xf2c200}), red=new T.MeshBasicMaterial({color:0xff3030});
  const redG=new T.SphereGeometry(1,8,6);
  for(const p of pos){
    const hh=p.hh, rad=p.D/2, g=new T.Group(); g.position.set(p.x,p.land?LANDY:0,p.z);
    if(!p.land){ const tp=new T.Mesh(towerG,yellow); tp.scale.set(hh*0.05,hh*0.13,hh*0.05); g.add(tp); }
    const tw=new T.Mesh(towerG,white); tw.position.y=!p.land?hh*0.13:0; tw.scale.set(hh*0.032,hh-(!p.land?hh*0.13:0),hh*0.032); g.add(tw);
    const nac=new T.Mesh(nacG,white); nac.scale.set(hh*0.07,hh*0.07,hh*0.17); nac.position.set(0,hh,-hh*0.03); g.add(nac);
    const rotor=new T.Group(); rotor.position.set(0,hh,hh*0.07);
    const hub=new T.Mesh(hubG,white); hub.scale.set(hh*0.04,hh*0.04,hh*0.05); rotor.add(hub);
    for(let k=0;k<3;k++){ const b=new T.Mesh(bladeG,white); b.scale.set(rad,rad,rad); b.rotation.z=k*TAU/3; rotor.add(b); }
    rotor.rotation.z=rnd()*TAU; g.add(rotor);
    const lt=new T.Mesh(redG,red); lt.scale.setScalar(hh*0.02); lt.position.set(0,hh+hh*0.045,-hh*0.06); lt.visible=V3.night; g.add(lt); V3.lights.push(lt);
    g.rotation.y=yaw+(rnd()-0.5)*0.06; sc.add(g); V3.turbs.push({rotor,k:167/Math.max(40,p.D)});
  }
  // 風的線條
  const N=140, sg=new T.BufferGeometry(), sp=new Float32Array(N*6); sg.setAttribute('position',new T.BufferAttribute(sp,3));
  const sm=new T.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.5});
  V3.streak={g:sg,m:sm,p:[],dir:[w[0],-w[1]]}; const dn=Math.hypot(w[0],w[1])||1; V3.streak.dir=[w[0]/dn,-w[1]/dn];
  for(let i=0;i<N;i++) V3.streak.p.push({x:(rnd()-0.5)*R*3,y:30+rnd()*Math.max(150,R*0.12),z:(rnd()-0.5)*R*3});
  sc.add(new T.LineSegments(sg,sm));
  V3.cam=new T.PerspectiveCamera(50,1,5,size*1.2);
  V3.az=V3.camAz; V3.el=0.24; V3.dist=V3.camDist; V3.target=new T.Vector3(V3.tgt[0],V3.tgt[1],V3.tgt[2]);
  $('#v3title').textContent=spec.title; $('#v3info').textContent=`${pos.length} 支風機・海岸線依真實地圖${V3.island?'（陸地太遠，村莊小島為示意）':''}・拖曳可轉動視角，滾輪可縮放`; $('#v3dn').textContent=V3.night?'☀ 換成白天':'☾ 換成晚上';
  $('#v3msg').textContent='今天風很小。按住「吹風」幫風車轉起來，讓村莊的燈全部亮起來！';
  say('按住吹風按鈕，幫風車轉起來，讓村莊的燈全部亮起來！');
  resize3D(); V3.last=performance.now(); requestAnimationFrame(loop3D);
}
function resize3D(){ if(!V3.r) return; const c=$('#c3d'), w=c.clientWidth||innerWidth, h=c.clientHeight||innerHeight; V3.r.setSize(w,h,false); if(V3.cam){V3.cam.aspect=w/h;V3.cam.updateProjectionMatrix();} }
window.addEventListener('resize',()=>{ if(V3.open) resize3D(); });
function close3D(){ V3.open=false; V3.blowing=false; $('#v3d').hidden=true; document.body.classList.remove('v3on'); map.triggerRepaint(); }
function loop3D(now){
  if(!V3.open) return;
  const dt=Math.min(0.1,(now-V3.last)/1000); V3.last=now;
  const base=2.5+0.6*Math.sin(now/1700);
  V3.boost=V3.blowing?Math.min(21,V3.boost+dt*5.5):Math.max(0,V3.boost-dt*3);
  const ws=base+V3.boost, cut=ws>=VCO, frac=cut?0:powerFrac(ws);
  const rpm=cut?0:ws<VCI?0.8:Math.min(16,3+ws*0.95), target=rpm/60*TAU*1.7;
  V3.spin+=(target-V3.spin)*Math.min(1,dt*(cut?0.9:1.6));
  for(const t of V3.turbs) t.rotor.rotation.z-=V3.spin*t.k*dt;
  const lit=Math.round(frac*V3.houses.length);
  V3.houses.forEach((m,i)=>{ const on=i<lit; m.emissive.setHex(on?(V3.night?0xffb84a:0x9a6a12):0x000000); });
  $('#v3ws').textContent=ws.toFixed(1); $('#v3pw').style.width=(frac*100)+'%'; $('#v3lit').textContent=`${lit} / ${V3.houses.length}`;
  let msg;
  if(cut) msg='哇！風太強了（超過每秒 25 公尺），風機自動停下來保護自己。放開按鈕，讓風小一點～';
  else if(ws<VCI) msg='風太小了，風車只能慢慢轉。按住「吹風」幫幫它！';
  else if(frac>=0.999) msg=ws>19?'全力發電中！風很強囉～真實的風機在風速超過每秒 25 公尺時，會自動停下來保護自己。':'全力發電中！村莊的燈全部亮了！繼續按住吹風喔～';
  else msg=V3.blowing?`風車越轉越快了！已經點亮 ${lit} 間房子。`:`風變小了，燈一間一間暗下來…再按住吹風！`;
  if(msg!==V3.lastMsg){ $('#v3msg').textContent=msg; V3.lastMsg=msg; }
  if(frac>=0.999){ V3.full+=dt; if(V3.full>1.5&&!V3.done){ V3.done=true; addStar(); confetti($('#v3d')); say('太棒了！全村的燈都亮了，你是風之小勇者！'); toast('⭐ 全村都亮了！你是風之小勇者！',3500); } } else V3.full=0;
  const t=now/1000;
  if(V3.water){ const a=V3.water.attributes.position, b=V3.wbase; for(let i=0;i<a.count;i++){const x=b[3*i],z=b[3*i+2]; a.array[3*i+1]=Math.sin(x*0.004+t*1.2)*3+Math.cos(z*0.005+t)*2.5;} a.needsUpdate=true; }
  if(V3.night){ const on=(t%1.5)<0.4; for(const l of V3.lights) l.visible=on; }
  const s=V3.streak, arr=s.g.attributes.position.array, sp=ws*18*dt*3, L=12+ws*4, Rr=V3.R*1.5;
  s.m.opacity=Math.min(0.75,0.08+ws/30);
  s.p.forEach((q,i)=>{ q.x+=s.dir[0]*sp; q.z+=s.dir[1]*sp; if(Math.abs(q.x)>Rr||Math.abs(q.z)>Rr){ q.x=-s.dir[0]*Rr*0.95+(rnd()-0.5)*Rr*2*Math.abs(s.dir[1]); q.z=-s.dir[1]*Rr*0.95+(rnd()-0.5)*Rr*2*Math.abs(s.dir[0]); }
    arr.set([q.x,q.y,q.z,q.x-s.dir[0]*L,q.y,q.z-s.dir[1]*L],i*6); });
  s.g.attributes.position.needsUpdate=true;
  V3.idle+=dt; if(V3.idle>5) V3.az+=dt*0.04;
  const c=V3.cam, T=V3.target, ce=Math.cos(V3.el);
  c.position.set(T.x+V3.dist*Math.sin(V3.az)*ce, T.y+V3.dist*Math.sin(V3.el), T.z+V3.dist*Math.cos(V3.az)*ce); c.lookAt(T);
  V3.r.render(V3.scene,c);
  requestAnimationFrame(loop3D);
}
{ const cv=$('#c3d'), pts=new Map(); let st=null, pinch0=null;
  cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);V3.idle=0;
    if(pts.size===1) st={x:e.clientX,y:e.clientY,az:V3.az,el:V3.el}; else if(pts.size===2){const [a,b]=[...pts.values()];pinch0={d:Math.hypot(a[0]-b[0],a[1]-b[1]),dist:V3.dist};st=null;}});
  cv.addEventListener('pointermove',e=>{ if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,[e.clientX,e.clientY]); V3.idle=0;
    if(pinch0&&pts.size===2){const [a,b]=[...pts.values()];V3.dist=Math.max(150,Math.min(V3.R*6+6000,pinch0.dist*pinch0.d/Math.hypot(a[0]-b[0],a[1]-b[1])));return;}
    if(st){V3.az=st.az-(e.clientX-st.x)*0.006;V3.el=Math.max(0.03,Math.min(1.4,st.el+(e.clientY-st.y)*0.004));}});
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch0=null;st=null;};
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{e.preventDefault();V3.idle=0;V3.dist=Math.max(150,Math.min(V3.R*6+6000,V3.dist*Math.exp(e.deltaY*0.0012)));},{passive:false});
  const blow=$('#v3blow');
  const on=e=>{e.preventDefault();V3.blowing=true;blow.classList.add('on');}, off=()=>{V3.blowing=false;blow.classList.remove('on');};
  blow.addEventListener('pointerdown',on); blow.addEventListener('pointerup',off); blow.addEventListener('pointerleave',off); blow.addEventListener('pointercancel',off);
  document.addEventListener('keydown',e=>{ if(!V3.open) return; if(e.key===' '){e.preventDefault();e.stopImmediatePropagation();on(e);} else if(e.key==='Escape'){e.stopImmediatePropagation();close3D();} },true);
  document.addEventListener('keyup',e=>{ if(V3.open&&e.key===' ') off(); },true);
  $('#v3close').onclick=close3D;
  $('#v3dn').onclick=()=>{ V3.nightOverride=!V3.night; open3D(V3.spec); };
}
$('#p3d').onclick=()=>{ if(S.sel) open3D(specForFarm(S.sel)); };
$('#b3d').onclick=()=>{ if(kmPx<0.15){ toast('先把地圖放大到有風機的地方，再按「3D」'); return; } open3D(specHere()); };
updStars(); updBook();

if(WMETA){
  const d=new Date(WMETA.osm_timestamp), ds=`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  $('#srcTurb').textContent=`目前收錄 ${WMETA.count.toLocaleString()} 支，${ds} 下載`;
  $('#impMsg').textContent=`全世界 ${WMETA.count.toLocaleString()} 支風機的位置來自 OpenStreetMap（${ds} 下載）。`+$('#impMsg').textContent.replace(/^風機位置來自 OpenStreetMap。/,'');
}
if(wtErr) toast('全球風機資料載入失敗：'+wtErr.message,6000);
readColors();
applyTheme();
new ResizeObserver(()=>resize()).observe(mapEl);
resize();
map.jumpTo({zoom:zoomForZ(1,cLat)}); applyView();
setSpeed(2);
appReady=true;
window.windGlobe={PL,setMusic,map,S,FARMS,select,flyTo,open3D,specForFarm,startFind,drawFarms,stepParticles,applyView,updViewBox,bump:()=>vv++}; // 方便在瀏覽器主控台除錯
if(styleReady) onStyle();
requestAnimationFrame(frame);
})().catch(e=>{ console.error(e); const el=document.getElementById('loading'); if(el){ el.hidden=false; el.textContent='載入失敗：'+e.message+'，請重新整理頁面。'; } });
