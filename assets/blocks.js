/* 風車地球 方塊世界：把 3D 實景照真實位置變成 1 公尺的方塊（地形高低、空照圖顏色、建築、道路、橋、樹、風機），
 * 可以走、跳、飛、拆方塊、放方塊。範圍是街景位置附近 192～320 公尺見方（依畫質），更遠的地方用空照圖當背景。
 * 由 game3d.js 按「⛏ 方塊世界」時載入，呼叫 BlockWorld.create(o)：
 *   o：{T, R3, cv, G（game3d 的場景：G.h 地形高度、G.shots 空照圖、G.pos 風機、G.sv 街景位置、G.spec.ground 建築道路樹）, QL 畫質, ctx, touch}
 * 回傳 {step(dt), resize(w,h), key(e,down), dispose()}；跟 3D 風場共用同一個 WebGL renderer。
 * 方塊的材質都是程式畫的像素圖，不用任何遊戲的圖。
 */
(function(){
'use strict';
const $=s=>document.querySelector(s);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* ---------- 方塊種類與材質 ---------- */
const TILES=['grassTop','grassSide','dirt','stone','sand','water','asphalt','paint','concrete','wall','window','roof','logTop','logSide','leaves','metal','plank','brick','glass','bomb','bombTop',
  'ice','snow','snowSide','rock','gold','diamond','woolRed','woolBlue','woolGreen','cactusTop','cactusSide','lava','birchTop','birchSide','leavesOrange','woodRed','brickGrey','gravel','redsand','woolYellow','woolPurple','woolOrange'];
const TI=Object.fromEntries(TILES.map((t,i)=>[t,i]));
// [名稱, 上面, 側面, 下面, 看得穿（後面的面要畫）, 上面染成空照圖的顏色]
const BT=[null,
  ['草地','grassTop','grassSide','dirt',0,1],   // 1
  ['泥土','dirt','dirt','dirt',0,1],            // 2
  ['石頭','stone','stone','stone',0,0],         // 3
  ['沙子','sand','sand','sand',0,1],            // 4
  ['水','water','water','water',1,0],           // 5
  ['柏油路','asphalt','asphalt','asphalt',0,0], // 6
  ['白線','paint','asphalt','asphalt',0,0],     // 7
  ['水泥','concrete','concrete','concrete',0,1],// 8
  ['白牆','wall','wall','wall',0,0],            // 9
  ['窗戶','window','window','window',0,0],      // 10
  ['屋頂','roof','wall','wall',0,1],            // 11
  ['樹幹','logTop','logSide','logTop',0,0],     // 12
  ['樹葉','leaves','leaves','leaves',1,0],      // 13
  ['風機白鋼','metal','metal','metal',0,0],     // 14
  ['木板','plank','plank','plank',0,0],         // 15
  ['磚塊','brick','brick','brick',0,0],         // 16
  ['玻璃','glass','glass','glass',1,0],         // 17
  ['炸彈','bombTop','bomb','bombTop',0,0],     // 18
  ['冰塊','ice','ice','ice',0,0],               // 19
  ['雪','snow','snowSide','dirt',0,0],          // 20
  ['鵝卵石','rock','rock','rock',0,0],          // 21
  ['金礦','gold','gold','gold',0,0],            // 22
  ['鑽石礦','diamond','diamond','diamond',0,0], // 23
  ['紅色羊毛','woolRed','woolRed','woolRed',0,0],       // 24
  ['橘色羊毛','woolOrange','woolOrange','woolOrange',0,0], // 25
  ['黃色羊毛','woolYellow','woolYellow','woolYellow',0,0], // 26
  ['綠色羊毛','woolGreen','woolGreen','woolGreen',0,0],   // 27
  ['藍色羊毛','woolBlue','woolBlue','woolBlue',0,0],      // 28
  ['紫色羊毛','woolPurple','woolPurple','woolPurple',0,0], // 29
  ['仙人掌','cactusTop','cactusSide','cactusTop',0,0],   // 30
  ['岩漿','lava','lava','lava',0,0],            // 31
  ['白樺木','birchTop','birchSide','birchTop',0,0],      // 32
  ['秋天的樹葉','leavesOrange','leavesOrange','leavesOrange',1,0], // 33
  ['紅木板','woodRed','woodRed','woodRed',0,0], // 34
  ['灰磚','brickGrey','brickGrey','brickGrey',0,0],     // 35
  ['礫石','gravel','gravel','gravel',0,0],      // 36
  ['紅沙','redsand','redsand','redsand',0,0],   // 37
];
const BOMB=18, ICE=19, ROCK=21, LAVA=31, BIRCH=32, LEAVES2=33, WOOL=[24,25,26,27,28,29], AIR=0, GRASS=1, DIRT=2, STONE=3, SAND=4, WATER=5, ASPHALT=6, PAINT=7, CONCRETE=8, WALL=9, WINDOW=10, ROOF=11, LOG=12, LEAVES=13, METAL=14, PLANK=15;
const HOTBAR=[1,2,3,15,16,17,9,13,14];
// 物品欄（E）裡可以拿的方塊（白線、炸彈不放進來）
const INV=[1,2,3,4,21,36,37,20,19,8,6,9,10,11,12,32,15,34,16,35,17,13,33,30,14,22,23,24,25,26,27,28,29,31,5];
const SEE=new Uint8Array(BT.length); BT.forEach((b,i)=>{ if(b&&b[4]) SEE[i]=1; });
const FT=[[],[],[]]; BT.forEach((b,i)=>{ if(b){ FT[0][i]=TI[b[1]]; FT[1][i]=TI[b[2]]; FT[2][i]=TI[b[3]]; } }); // 上、側、下 用哪一格材質

// 材質圖：8×8 格，每格 16×16 像素，全部用程式畫
function drawAtlas(){
  const W=128, H=128, im=new ImageData(W,H), d=im.data, R=mulberry32(20261027), avg=[];
  const C=(r,g,b,k)=>[r*k,g*k,b*k,255];
  const F={
    grassTop:(x,y,n)=>C(98,158,62,0.82+0.3*n),
    grassSide:(x,y,n)=>y<3+((x*7)%3===0?1:0)?C(98,158,62,0.82+0.3*n):C(134,96,67,0.8+0.35*n),
    dirt:(x,y,n)=>C(134,96,67,n<0.08?0.6:0.8+0.35*n),
    stone:(x,y,n)=>C(128,128,128,n<0.1?0.65:0.82+0.3*n),
    sand:(x,y,n)=>C(219,206,160,0.9+0.15*n),
    water:(x,y,n)=>(x+y*3)%11===0?C(88,140,214,1):C(56,108,196,0.88+0.14*n),
    asphalt:(x,y,n)=>C(78,80,84,0.82+0.35*n),
    paint:(x,y,n)=>C(238,238,232,0.92+0.1*n),
    concrete:(x,y,n)=>C(172,172,166,(x===0||y===0)?0.85:0.9+0.15*n),
    wall:(x,y,n)=>C(238,234,224,0.93+0.08*n),
    window:(x,y,n)=>(x<1||y<1||x>14||y>14||x===7||x===8||y===7||y===8)?C(205,205,210,1):(x-y>2&&x-y<6)?C(170,210,240,1):C(70,120,175,0.9+0.15*n),
    roof:(x,y,n)=>C(205,200,196,(y%4===3||(x+(y>>2)%2*4)%8===0)?0.72:0.92+0.12*n),
    logTop:(x,y,n)=>{ const r=Math.hypot(x-7.5,y-7.5); return r>6.6?C(100,74,46,0.9+0.2*n):C(176,140,90,((r|0)%2?0.85:1)*(0.95+0.1*n)); },
    logSide:(x,y,n)=>C(104,78,50,(x%4===0?0.7:0.9)+0.2*n),
    leaves:(x,y,n)=>{ const c=C(58,128,48,0.7+0.5*n); if(R()<0.16) c[3]=0; return c; },
    metal:(x,y,n)=>C(234,238,242,(y%8===0?0.9:0.97)+0.04*n),
    plank:(x,y,n)=>C(178,138,84,(y%4===3||x===((y>>2)%2?3:11))?0.68:0.88+0.16*n),
    brick:(x,y,n)=>(y%4===3||(x+(y>>2)%2*4)%8===7)?C(196,190,180,1):C(165,72,56,0.85+0.25*n),
    bomb:(x,y,n)=>(y>=6&&y<=9)?C(245,210,70,1):(x===7||x===8)&&y<6?C(40,40,40,1):C(205,50,45,0.85+0.2*n),
    bombTop:(x,y,n)=>Math.hypot(x-7.5,y-7.5)<2.2?C(40,40,40,1):C(205,50,45,0.85+0.2*n),
    ice:(x,y,n)=>C(170,215,245,(x+y)%9===0?1.08:0.92+0.1*n),
    snow:(x,y,n)=>C(244,248,252,0.95+0.05*n),
    snowSide:(x,y,n)=>y<4+((x*5)%3===0?1:0)?C(244,248,252,0.95+0.05*n):C(134,96,67,0.8+0.35*n),
    rock:(x,y,n)=>C(122,122,118,((x>>2)+(y>>2)*3)%4===0?0.7:0.85+0.3*n),
    gold:(x,y,n)=>((x*7+y*3)%11<2)?C(250,205,60,1):C(128,128,128,0.82+0.3*n),
    diamond:(x,y,n)=>((x*5+y*7)%13<2)?C(110,230,235,1):C(128,128,128,0.82+0.3*n),
    woolRed:(x,y,n)=>C(200,58,52,0.88+0.2*n), woolOrange:(x,y,n)=>C(236,132,40,0.88+0.2*n), woolYellow:(x,y,n)=>C(246,212,56,0.88+0.2*n),
    woolGreen:(x,y,n)=>C(92,170,62,0.88+0.2*n), woolBlue:(x,y,n)=>C(56,104,206,0.88+0.2*n), woolPurple:(x,y,n)=>C(140,72,190,0.88+0.2*n),
    cactusTop:(x,y,n)=>C(80,150,60,(x===0||y===0||x===15||y===15)?0.7:0.9+0.15*n),
    cactusSide:(x,y,n)=>C(72,142,56,x%4===1?0.7:0.9+0.15*n),
    lava:(x,y,n)=>C(240,110+60*n,30,0.95+0.1*n),
    birchTop:(x,y,n)=>{ const r=Math.hypot(x-7.5,y-7.5); return r>6.6?C(228,226,214,1):C(200,170,120,((r|0)%2?0.85:1)); },
    birchSide:(x,y,n)=>((x*3+y*5)%7===0)?C(40,40,40,1):C(228,226,214,0.92+0.1*n),
    leavesOrange:(x,y,n)=>{ const c=C(222,128,40,0.7+0.5*n); if(R()<0.16) c[3]=0; return c; },
    woodRed:(x,y,n)=>C(160,70,52,(y%4===3)?0.7:0.88+0.16*n),
    brickGrey:(x,y,n)=>(y%4===3||(x+(y>>2)%2*4)%8===7)?C(90,90,90,1):C(150,150,152,0.85+0.25*n),
    gravel:(x,y,n)=>C(140,134,130,n<0.3?0.7:0.9+0.2*n),
    redsand:(x,y,n)=>C(196,110,62,0.9+0.15*n),
    glass:(x,y,n)=>(x<1||y<1||x>14||y>14)?[222,236,246,255]:(x+y===10||x+y===11)&&x>3&&x<9?[255,255,255,210]:[0,0,0,0],
  };
  TILES.forEach((t,ti)=>{
    const ox=ti%8*16, oy=(ti>>3)*16; let sr=0,sg=0,sb=0,sn=0;
    for(let y=0;y<16;y++) for(let x=0;x<16;x++){
      const c=F[t](x,y,R()), p=((oy+y)*W+ox+x)*4;
      d[p]=Math.min(255,c[0]); d[p+1]=Math.min(255,c[1]); d[p+2]=Math.min(255,c[2]); d[p+3]=c[3];
      if(c[3]>128){ sr+=d[p]; sg+=d[p+1]; sb+=d[p+2]; sn++; }
    }
    avg[ti]=[sr/sn/255,sg/sn/255,sb/sn/255];
  });
  const small=document.createElement('canvas'); small.width=W; small.height=H; small.getContext('2d').putImageData(im,0,0);
  // 放大成每格 32 像素（Kenney 材質是 32 像素），保持像素風不模糊
  const cv=document.createElement('canvas'); cv.width=W*2; cv.height=H*2; const g=cv.getContext('2d'); g.imageSmoothingEnabled=false; g.drawImage(small,0,0,W*2,H*2);
  return {cv,avg};
}
// 每一格材質的平均顏色（染空照圖顏色時用）
function tileAvg(cv){
  const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data, S=cv.width/8;
  return TILES.map((t,ti)=>{ const ox=ti%8*S, oy=(ti>>3)*S; let r=0,g=0,b=0,n=0;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const p=((oy+y)*cv.width+ox+x)*4; if(d[p+3]>128){ r+=d[p]; g+=d[p+1]; b+=d[p+2]; n++; } }
    return n?[r/n/255,g/n/255,b/n/255]:[1,1,1]; });
}
// Kenney Voxel Pack（CC0，www.kenney.nl）的材質：assets/blocks/kenney-tiles.png 一排 32×32，順序跟這裡一樣；
// 柏油、白線、白牆、窗戶、屋頂、風機白鋼、炸彈這些 Kenney 沒有的，繼續用程式畫的
const KENNEY=['grassTop','grassSide','dirt','stone','sand','water','concrete','logTop','logSide','leaves','plank','brick','glass',
  'ice','snow','snowSide','rock','gold','diamond','woolRed','woolBlue','woolGreen','cactusTop','cactusSide','lava','birchTop','birchSide','leavesOrange','woodRed','brickGrey','gravel','redsand'];
const VER=(document.currentScript&&document.currentScript.src.split('?')[1])||'';
function loadKenney(A,done){
  const img=new Image();
  img.onload=()=>{ const g=A.cv.getContext('2d');
    KENNEY.forEach((t,q)=>{ const ti=TI[t], x=ti%8*32, y=(ti>>3)*32; g.clearRect(x,y,32,32); g.drawImage(img,q*32,0,32,32,x,y,32,32); });
    A.avg=tileAvg(A.cv); done(); };
  img.src='assets/blocks/kenney-tiles.png'+(VER?'?'+VER:''); // 載不到就繼續用程式畫的材質
}
// 方塊的小圖示（工具列用）
function iconURL(atlas,b){
  const t=FT[1][b], c=document.createElement('canvas'); c.width=c.height=32;
  c.getContext('2d').drawImage(atlas,t%8*32,(t>>3)*32,32,32,0,0,32,32); return c.toDataURL();
}

// 空照圖顏色 → 地面種類
function classify(r,g,b){
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(r+g+b)/3;
  if(b>=r+10&&g>=r-4&&l<165) return WATER;
  if(g>=r&&g>=b-6&&mx-mn>10) return GRASS;
  if(r>=g&&g>=b&&l>150&&mx-mn>18) return SAND;
  if(mx-mn<=22) return l>105?CONCRETE:STONE;
  return DIRT;
}

// 每一面：方向、從外面看的左下、右下、右上、左上四個角（逆時針），亮度
const FACES=[
  {n:[1,0,0], c:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]], s:0.8, t:1},
  {n:[-1,0,0],c:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]], s:0.8, t:1},
  {n:[0,0,1], c:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]], s:0.66,t:1},
  {n:[0,0,-1],c:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]], s:0.66,t:1},
  {n:[0,1,0], c:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]], s:1,   t:0},
  {n:[0,-1,0],c:[[1,0,1],[0,0,1],[0,0,0],[1,0,0]], s:0.5, t:2},
];
const ROAD_W={motorway:22,trunk:18,primary:13,secondary:10,tertiary:8,minor:6.5,service:4.5,track:3.5,path:2.2};

function create(o){
  const {T,R3,cv,G,ctx}=o, gr=G.spec.ground, night=!!G.night, sv=G.sv;
  const N=[192,256,320][o.QL==null?2:o.QL], CH=16, NC=Math.ceil(N/CH);
  const R=mulberry32(4242);

  // ---------- 範圍：以街景位置為中心；最近的風機不太遠就把中心移到兩者中間，風機也變成方塊 ----------
  let cx=sv.x0, cz=sv.z0, dn=1e9, np=null;
  for(const p of G.pos){ const d=Math.hypot(p.x-cx,p.z-cz); if(d<dn){ dn=d; np=p; } }
  if(np&&dn<N-40){ cx=(cx+np.x)/2; cz=(cz+np.z)/2; }
  const FO=G.spec.focus; if(FO){ cx=FO.x; cz=FO.z; } // 從風機卡片進來：以那支風機為中心
  const X0=Math.round(cx-N/2), Z0=Math.round(cz-N/2);
  const inA=(x,z)=>x>=X0&&x<X0+N&&z>=Z0&&z<Z0+N;

  // ---------- 每一格的地形高度、空照圖顏色 ----------
  const NN=N*N, hgt=new Float32Array(NN), pr=new Uint8Array(NN*3);
  const shotPx=(G.shots||[]).map(s=>{ try{ const im=s.tex.image, d=im.getContext('2d').getImageData(0,0,im.width,im.height); return {s,d:d.data,w:im.width,h:im.height}; }catch(e){ return null; } }).filter(Boolean);
  const photo=(x,z,out,o3)=>{
    for(let q=shotPx.length-1;q>=0;q--){ const P=shotPx[q], s=P.s; if(x<=s.x0||x>=s.x1||z<=s.z0||z>=s.z1) continue;
      const px=Math.floor((x-s.x0)/(s.x1-s.x0)*P.w), py=Math.floor((z-s.z0)/(s.z1-s.z0)*P.h), p=(py*P.w+px)*4;
      out[o3]=P.d[p]; out[o3+1]=P.d[p+1]; out[o3+2]=P.d[p+2]; return true; }
    out[o3]=110; out[o3+1]=150; out[o3+2]=80; return false;
  };
  let hmin=1e9, hmax=-1e9;
  for(let k=0;k<N;k++) for(let i=0;i<N;i++){ const c=k*N+i, x=X0+i+0.5, z=Z0+k+0.5, h=G.h(x,z); hgt[c]=h; if(h<hmin) hmin=h; if(h>hmax) hmax=h; photo(x,z,pr,c*3); }
  const Y0=Math.floor(hmin)-6;
  // 高度上限：地形、建築、風機最高的地方再多一點
  let top=hmax;
  for(const b of gr.buildings||[]){ if(b.cx!=null&&inA(b.cx,b.cz)) top=Math.max(top,G.h(b.cx,b.cz)+Math.min(b.h,80)+2); }
  for(const p of G.pos) if(inA(p.x,p.z)) top=Math.max(top,G.h(p.x,p.z)+p.hh+4);
  const H=Math.min(256,Math.max(Math.ceil(top-Y0)+14,Math.ceil(hmax-Y0)+48)); // 地面上方至少留 48 格，可以蓋高、種風機、飛
  const vox=new Uint8Array(NN*H), colTop=new Int16Array(NN), tintY=new Int16Array(NN).fill(-1);
  const I=(i,y,k)=>i+N*(k+N*y);
  const set=(i,y,k,b)=>{ if(i<0||k<0||i>=N||k>=N||y<0||y>=H) return; vox[I(i,y,k)]=b; const c=k*N+i; if(b&&y>colTop[c]) colTop[c]=y; };
  const get=(i,y,k)=>(i<0||k<0||i>=N||k>=N||y>=H)?AIR:y<0?STONE:vox[I(i,y,k)];
  const ty=wy=>Math.floor(wy-Y0);

  // ---------- 地形：最上面一層照空照圖顏色選草地、沙、水泥、泥土；水（海、池塘）往下挖兩格 ----------
  for(let k=0;k<N;k++) for(let i=0;i<N;i++){
    const c=k*N+i, h=hgt[c], kind=classify(pr[c*3],pr[c*3+1],pr[c*3+2]);
    let t=Math.max(4,ty(h));
    if(kind===WATER&&h<6){
      const bed=t-2; for(let y=0;y<=bed;y++) vox[I(i,y,k)]=y>=bed-1?SAND:STONE;
      for(let y=bed+1;y<=t;y++) vox[I(i,y,k)]=WATER; colTop[c]=t;
    }else{
      for(let y=0;y<t;y++) vox[I(i,y,k)]=y<t-3?STONE:DIRT;
      vox[I(i,t,k)]=kind===WATER?GRASS:kind; colTop[c]=t; tintY[c]=t;
    }
  }

  // ---------- 道路：柏油＋大路中間白色虛線；橋是架高的路面加護欄 ----------
  for(const r of gr.roads||[]){
    if(r.brunnel==='tunnel') continue;
    const w=(ROAD_W[r.cls]||5)/2, bridge=r.brunnel==='bridge', soft=/track|path/.test(r.cls), line=w>=4; let L=0;
    for(let q=0;q+1<r.pts.length;q++){
      const a=r.pts[q], b=r.pts[q+1], dx=b[0]-a[0], dz=b[1]-a[1], d=Math.hypot(dx,dz); if(d<0.3) continue;
      const ya=G.h(a[0],a[1])+2.1, yb=G.h(b[0],b[1])+2.1;
      const i0=Math.max(0,Math.floor(Math.min(a[0],b[0])-w-1-X0)), i1=Math.min(N-1,Math.floor(Math.max(a[0],b[0])+w+1-X0));
      const k0=Math.max(0,Math.floor(Math.min(a[1],b[1])-w-1-Z0)), k1=Math.min(N-1,Math.floor(Math.max(a[1],b[1])+w+1-Z0));
      for(let k=k0;k<=k1;k++) for(let i=i0;i<=i1;i++){
        const x=X0+i+0.5, z=Z0+k+0.5, t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(d*d)));
        const ds=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t); if(ds>w+(bridge?1:0)) continue;
        const c=k*N+i, paint=line&&ds<0.5&&Math.floor((L+t*d)/3)%2===0;
        if(bridge){ const j=ty(ya+(yb-ya)*t)-1;
          if(j>ty(hgt[c])+1){ // 真的架在半空中：路面＋兩邊水泥護欄，路面上方清空
            if(ds<=w){ set(i,j,k,paint?PAINT:ASPHALT); for(let y=j+1;y<j+4;y++) set(i,y,k,AIR); } else { set(i,j,k,CONCRETE); set(i,j+1,k,CONCRETE); }
            continue; }
        }
        if(ds>w) continue;
        const tj=colTop[c];
        for(let y=tj;y>0&&vox[I(i,y,k)]===WATER;y--) vox[I(i,y,k)]=STONE; // 海堤上的路（空照圖看起來是海）：把水填成石頭堤防
        vox[I(i,tj,k)]=soft?DIRT:paint?PAINT:ASPHALT; tintY[c]=soft?tj:-1;
      }
      L+=d;
    }
  }

  // ---------- 建築：照真實輪廓和高度；牆每三層一排窗戶，裡面是空的，地上一層有門，可以走進去 ----------
  const sx=sv.x0-X0, sz=sv.z0-Z0;
  for(const b of gr.buildings||[]){
    const ring=b.ring; let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
    for(const p of ring){ x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]); z0=Math.min(z0,p[1]); z1=Math.max(z1,p[1]); }
    const i0=Math.max(0,Math.floor(x0-X0)), i1=Math.min(N-1,Math.floor(x1-X0)), k0=Math.max(0,Math.floor(z0-Z0)), k1=Math.min(N-1,Math.floor(z1-Z0));
    if(i0>i1||k0>k1||x1-x0>150||z1-z0>150) continue;
    const w=i1-i0+1, mask=new Uint8Array(w*(k1-k0+1)), cells=[];
    for(let k=k0;k<=k1;k++) for(let i=i0;i<=i1;i++){
      const x=X0+i+0.5, z=Z0+k+0.5; let ins=false;
      for(let a=0,c=ring.length-1;a<ring.length;c=a++){ const p=ring[a], q=ring[c]; if((p[1]>z)!==(q[1]>z)&&x<(q[0]-p[0])*(z-p[1])/(q[1]-p[1])+p[0]) ins=!ins; }
      if(ins){ mask[(k-k0)*w+i-i0]=1; cells.push([i,k]); }
    }
    if(cells.length<3) continue;
    let j0=0; for(const [i,k] of cells) j0=Math.max(j0,colTop[k*N+i]);
    const roof=Math.min(H-2,j0+Math.max(3,Math.min(80,Math.round(b.h))));
    const inside=(i,k)=>i>=i0&&i<=i1&&k>=k0&&k<=k1&&mask[(k-k0)*w+i-i0];
    let door=null, dd=1e9;
    for(const [i,k] of cells){
      const edge=!inside(i+1,k)||!inside(i-1,k)||!inside(i,k+1)||!inside(i,k-1), c=k*N+i;
      for(let y=colTop[c]+1;y<j0;y++) vox[I(i,y,k)]=CONCRETE; // 地基
      vox[I(i,j0,k)]=edge?CONCRETE:PLANK;
      for(let y=j0+1;y<roof;y++){ const lv=y-j0-1; vox[I(i,y,k)]=edge?(lv%3===1&&(i+k)%3!==0?WINDOW:WALL):AIR; }
      vox[I(i,roof,k)]=ROOF; colTop[c]=Math.max(colTop[c],roof); tintY[c]=roof;
      if(edge&&(!inside(i+1,k))+(!inside(i-1,k))+(!inside(i,k+1))+(!inside(i,k-1))===1){ const e=Math.hypot(i-sx,k-sz); if(e<dd){ dd=e; door=[i,k]; } } // 門開在離起點最近、不是牆角的地方
    }
    if(door){ // 門兩格寬、兩格高（沿著牆的方向多開一格），小朋友用搖桿也走得進去
      const [i,k]=door, along=!inside(i,k+1)||!inside(i,k-1)?[1,0]:[0,1], nb=[i+along[0],k+along[1]], nb2=[i-along[0],k-along[1]];
      const two=inside(...nb)&&!(inside(nb[0]+1,nb[1])&&inside(nb[0]-1,nb[1])&&inside(nb[0],nb[1]+1)&&inside(nb[0],nb[1]-1))?nb:nb2;
      for(const [a,c] of [[i,k],two]) if(inside(a,c)) for(let y=j0+1;y<=Math.min(j0+2,roof-1);y++) vox[I(a,y,c)]=AIR; }
  }

  // ---------- 樹：樹幹＋一團樹葉，只種在草地、泥土上 ----------
  for(const t of gr.trees||[]){
    if(!inA(t[0],t[1])) continue;
    const i=Math.floor(t[0]-X0), k=Math.floor(t[1]-Z0), c=k*N+i, g=colTop[c], gb=vox[I(i,g,k)];
    if(gb!==GRASS&&gb!==DIRT) continue;
    const s=t[2]||1, th=Math.max(3,Math.round(4*s)), r=Math.max(2,Math.min(4,Math.round(2.6*s))), cy=g+th;
    if(cy+r>=H) continue;
    for(let y=-r;y<=r;y++) for(let dk=-r;dk<=r;dk++) for(let di=-r;di<=r;di++){
      const q=di*di+dk*dk+y*y; if(q>r*r+1||(q>(r-1)*(r-1)&&R()<0.25)) continue;
      if(get(i+di,cy+y,k+dk)===AIR) set(i+di,cy+y,k+dk,LEAVES);
    }
    for(let y=g+1;y<=cy;y++) set(i,y,k,LOG);
  }

  // ---------- 風機：範圍內的用方塊蓋（塔、機艙、輪轂），葉片是另外會轉的模型；拆掉機艙葉片就停 ----------
  const scene=new T.Scene(), sky=new T.Color(night?0x0b1838:0x9fd3ff);
  scene.background=sky; scene.fog=new T.Fog(sky,N*0.7,N*0.7+3200);
  const sh=night?0.45:1;
  const rotorMat=new T.MeshBasicMaterial({vertexColors:true}), towerMat=rotorMat;
  // 方塊風的盒子（可以旋轉）：寫進陣列
  function addBox(P,Cc,x0,y0,z0,x1,y1,z1,rot,col){
    const cs=Math.cos(rot||0), sn=Math.sin(rot||0), tr=(x,y)=>[x*cs-y*sn,x*sn+y*cs];
    for(const f of FACES){ const out=f.c.map(q=>{ const [x,y]=tr(q[0]?x1:x0,q[1]?y1:y0); return [x,y,q[2]?z1:z0]; });
      for(const v of [0,1,2,0,2,3]) P.push(...out[v]);
      const s=f.s*sh; for(let v=0;v<6;v++) Cc.push(col[0]*s,col[1]*s,col[2]*s); }
  }
  // 葉片、帆、輪轂各是一個零件（parts），可以一片一片拆掉；m 是會轉的那一組
  function rotorSet(pieces){
    const grp=new T.Group(), m=new T.Group(), parts=[]; grp.add(m);
    for(const f of pieces){ const P=[], Cc=[]; f(P,Cc); const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(P,3)); g.setAttribute('color',new T.Float32BufferAttribute(Cc,3));
      const pm=new T.Mesh(g,rotorMat); m.add(pm); parts.push(pm); }
    return {grp,m,parts};
  }
  const disRo=ro=>ro.grp.traverse(o=>{ if(o.geometry) o.geometry.dispose(); });
  function rotor(L){ // 三支一階一階的葉片，在 xy 平面，繞 z 轉
    const W=[0.93,0.94,0.95], pc=[];
    for(let bl=0;bl<3;bl++){ const a=bl*Math.PI*2/3;
      pc.push((P,Cc)=>{ for(let s=1;s<L;s++){ const wd=s<L*0.3?1.5:s<L*0.7?1:0.5; addBox(P,Cc,-wd,s,-0.3,wd,s+1,0.3,a,W); } }); }
    pc.push((P,Cc)=>addBox(P,Cc,-1.2,-1.2,-0.8,1.2,1.2,1.2,0,[0.85,0.87,0.9]));
    return rotorSet(pc);
  }
  function sails(L){ // 傳統風車：四支木頭格子框＋米白色帆布
    const wood=[0.55,0.38,0.22], cloth=[0.93,0.9,0.8], pc=[];
    for(let bl=0;bl<4;bl++){ const a=bl*Math.PI/2;
      pc.push((P,Cc)=>{ addBox(P,Cc,-0.3,0,-0.3,0.3,L,0.3,a,wood);
        addBox(P,Cc,0.3,L*0.2,-0.05,2.8,L,0.05,a,cloth);
        for(let s=L*0.2;s<=L+0.01;s+=1.5) addBox(P,Cc,0.3,s,-0.25,3,s+0.25,0.25,a,wood);
        addBox(P,Cc,2.8,L*0.2,-0.25,3.1,L,0.25,a,wood); }); }
    pc.push((P,Cc)=>addBox(P,Cc,-0.8,-0.8,-0.6,0.8,0.8,0.8,0,wood));
    return rotorSet(pc);
  }
  const wa=G.windA||0, sA=Math.sin(wa), cA=Math.cos(wa), F=Math.abs(sA)>Math.abs(cA)?[Math.sign(sA),0]:[0,Math.sign(cA)||1];
  const turbs=[], farP=[], farC=[];
  for(const p of G.pos){
    const L=Math.max(8,Math.round(p.D/2));
    if(inA(p.x,p.z)&&p.x-X0>6&&p.x-X0<N-7&&p.z-Z0>6&&p.z-Z0<N-7){
      const i=Math.floor(p.x-X0), k=Math.floor(p.z-Z0), g=colTop[k*N+i], hh=Math.min(H-g-4,Math.round(p.hh)), nac=new Set();
      if(p.kind===3){ // 傳統風車（磨坊）：石頭底座、白牆圓塔、窗戶、圓錐屋頂，前面木頭輪軸接四片帆
        const cell=(u,v,y)=>[i+F[0]*u-F[1]*v,g+y,k+F[1]*u+F[0]*v];
        for(let y=1;y<=hh;y++){ const r=3.6-1.2*y/hh;
          for(let dk=-4;dk<=4;dk++) for(let di=-4;di<=4;di++){ const d2=di*di+dk*dk; if(d2>r*r) continue;
            const shell=d2>(r-1.1)*(r-1.1); set(i+di,g+y,k+dk,!shell?AIR:y<=2?STONE:y%4===2&&(di===0||dk===0)?WINDOW:WALL); } }
        // 門（背對帆的那一面）
        for(const y of [1,2]) for(let u=-4;u<=-1;u++){ const q=cell(u,0,y); if(get(...q)!==AIR) set(...q,AIR); }
        for(let y=1;y<=3;y++){ const r=3-0.75*y; for(let dk=-3;dk<=3;dk++) for(let di=-3;di<=3;di++) if(di*di+dk*dk<=r*r+0.5){ set(i+di,g+hh+y,k+dk,ROOF); nac.add(I(i+di,g+hh+y,k+dk)); } }
        const hub=cell(3,0,hh); set(...hub,LOG); nac.add(I(...hub));
        const ro=sails(Math.max(8,Math.round(p.D/2))); ro.grp.position.set(X0+hub[0]+0.5+F[0]*0.8,Y0+hub[1]+0.5,Z0+hub[2]+0.5+F[1]*0.8); ro.grp.rotation.y=Math.atan2(F[0],F[1]);
        scene.add(ro.grp); turbs.push({ro,nac,hub:I(...hub),k:0.35,ok:true,x:p.x,z:p.z,ax:{i,k,g,r:5,tr:4}}); continue;
      }
      for(let dk=-3;dk<=3;dk++) for(let di=-3;di<=3;di++) if(di*di+dk*dk<=12) set(i+di,g,k+dk,CONCRETE);
      for(let y=1;y<=hh;y++){ const r=2.4-0.9*y/hh; for(let dk=-3;dk<=3;dk++) for(let di=-3;di<=3;di++) if(di*di+dk*dk<=r*r) set(i+di,g+y,k+dk,METAL); }
      const cell=(u,v,y)=>[i+F[0]*u-F[1]*v,g+y,k+F[1]*u+F[0]*v];
      for(let u=-4;u<=4;u++) for(let v=-1;v<=1;v++) for(let y=hh-1;y<=hh+1;y++){ const q=cell(u,v,y); set(...q,METAL); nac.add(I(...q)); }
      const hub=cell(5,0,hh); set(...hub,METAL); nac.add(I(...hub));
      const ro=rotor(L); ro.grp.position.set(X0+hub[0]+0.5+F[0]*0.8,Y0+hub[1]+0.5,Z0+hub[2]+0.5+F[1]*0.8); ro.grp.rotation.y=Math.atan2(F[0],F[1]);
      scene.add(ro.grp); turbs.push({ro,nac,hub:I(...hub),k:0.8+R()*0.4,ok:true,x:p.x,z:p.z,ax:{i,k,g,r:7,tr:3}});
    }else if(Math.hypot(p.x-cx,p.z-cz)<6000){ // 範圍外：方塊風的模型當背景
      const y=G.h(p.x,p.z), hh=p.hh, W=[0.93,0.94,0.96];
      addBox(farP,farC,p.x-1.5,y,p.z-1.5,p.x+1.5,y+hh,p.z+1.5,0,W);
      const ro=p.kind===3?sails(L):rotor(L); ro.grp.position.set(p.x,y+hh+0.5,p.z); ro.grp.rotation.y=wa; ro.m.position.z=2.5; scene.add(ro.grp);
      const nb=[]; const nc=[]; addBox(nb,nc,-1.6,-1.6,-4,1.6,1.6,2,0,W); const ng=new T.BufferGeometry(); ng.setAttribute('position',new T.Float32BufferAttribute(nb,3)); ng.setAttribute('color',new T.Float32BufferAttribute(nc,3));
      ro.grp.add(new T.Mesh(ng,towerMat));
      turbs.push({ro,nac:null,k:0.8+R()*0.4,ok:true});
    }
  }
  if(farP.length){ const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(farP,3)); g.setAttribute('color',new T.Float32BufferAttribute(farC,3)); scene.add(new T.Mesh(g,towerMat)); }

  // ---------- 遠景：方塊範圍外面鋪空照圖（中間挖空） ----------
  const back=[];
  (G.shots||[]).forEach((s,q)=>{
    if(q>1) return; // 遠景＋風機附近兩層就夠
    const xs=[], zs=[], n=48;
    for(let a=0;a<=n;a++){ xs.push(s.x0+(s.x1-s.x0)*a/n); zs.push(s.z0+(s.z1-s.z0)*a/n); }
    for(const v of [X0,X0+N]) if(v>s.x0&&v<s.x1) xs.push(v);
    for(const v of [Z0,Z0+N]) if(v>s.z0&&v<s.z1) zs.push(v);
    xs.sort((a,b)=>a-b); zs.sort((a,b)=>a-b);
    const P=[], U=[], pt=(x,z)=>{ P.push(x,G.h(x,z)-0.2,z); U.push((x-s.x0)/(s.x1-s.x0),1-(z-s.z0)/(s.z1-s.z0)); };
    for(let b=0;b+1<zs.length;b++) for(let a=0;a+1<xs.length;a++){
      const xa=xs[a], xb=xs[a+1], za=zs[b], zb=zs[b+1]; if(xb-xa<0.01||zb-za<0.01) continue;
      if(inA((xa+xb)/2,(za+zb)/2)) continue;
      pt(xa,za); pt(xa,zb); pt(xb,zb); pt(xa,za); pt(xb,zb); pt(xb,za);
    }
    const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(P,3)); g.setAttribute('uv',new T.Float32BufferAttribute(U,2));
    const m=new T.Mesh(g,new T.MeshBasicMaterial({map:s.tex,color:night?0x5a6788:0xffffff,polygonOffset:true,polygonOffsetFactor:-q,polygonOffsetUnits:-q*4}));
    m.renderOrder=q; scene.add(m); back.push(m);
  });

  // ---------- 方塊變成模型：16×16 一塊，只畫看得到的面 ----------
  const A=drawAtlas(), atlas=new T.CanvasTexture(A.cv);
  atlas.magFilter=T.NearestFilter; atlas.minFilter=T.NearestFilter; atlas.generateMipmaps=false;
  let disposed=false;
  const opMat=new T.MeshBasicMaterial({map:atlas,vertexColors:true,alphaTest:0.5});
  const waMat=new T.MeshBasicMaterial({map:atlas,vertexColors:true,transparent:true,opacity:0.78,depthWrite:false});
  const UVE=0.0006;
  const chunks=[]; for(let q=0;q<NC*NC;q++) chunks.push({op:null,wa:null,dirty:true});
  function meshChunk(ci,ck){
    const ch=chunks[ck*NC+ci], P=[[],[]], U=[[],[]], Cc=[[],[]];
    for(let k=ck*CH;k<Math.min(N,ck*CH+CH);k++) for(let i=ci*CH;i<Math.min(N,ci*CH+CH);i++){
      const c=k*N+i, yt=Math.min(H-1,colTop[c]);
      for(let y=0;y<=yt;y++){
        const b=vox[I(i,y,k)]; if(!b) continue;
        for(const f of FACES){
          const n=get(i+f.n[0],y+f.n[1],k+f.n[2]);
          if(b===WATER){ if(n!==AIR) continue; } else if(n!==AIR&&!(SEE[n]&&n!==b)) continue;
          const L=b===WATER?1:0, t=FT[f.t][b], u0=(t%8)/8+UVE, u1=(t%8+1)/8-UVE, vt=1-(t>>3)/8-UVE, vb=1-((t>>3)+1)/8+UVE;
          let r=f.s*sh, g=r, bl=r;
          if(f.t===0&&BT[b][5]&&tintY[c]===y){ const av=A.avg[t]; // 上面染成空照圖的顏色（讓方塊跟真實地面一樣色）
            const tn=(v,a)=>Math.max(0.45,Math.min(1.5,0.45+0.55*v/255/a)); r*=tn(pr[c*3],av[0]); g*=tn(pr[c*3+1],av[1]); bl*=tn(pr[c*3+2],av[2]); }
          const wy=b===WATER&&f.t===0?-0.12:0, cs=f.c, uv=[[u0,vb],[u1,vb],[u1,vt],[u0,vt]];
          for(const v of [0,1,2,0,2,3]){ const q=cs[v]; P[L].push(X0+i+q[0],Y0+y+q[1]+(q[1]?wy:0),Z0+k+q[2]); U[L].push(uv[v][0],uv[v][1]); Cc[L].push(r,g,bl); }
        }
      }
    }
    for(const L of [0,1]){
      const key=L?'wa':'op'; if(ch[key]){ scene.remove(ch[key]); ch[key].geometry.dispose(); ch[key]=null; }
      if(!P[L].length) continue;
      const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(P[L],3)); g.setAttribute('uv',new T.Float32BufferAttribute(U[L],2)); g.setAttribute('color',new T.Float32BufferAttribute(Cc[L],3));
      const m=new T.Mesh(g,L?waMat:opMat); if(L) m.renderOrder=10; scene.add(m); ch[key]=m;
    }
    ch.dirty=false;
  }
  for(let ck=0;ck<NC;ck++) for(let ci=0;ci<NC;ci++) meshChunk(ci,ck);
  const dirty=(i,k)=>{ const ci=Math.floor(i/CH), ck=Math.floor(k/CH); chunks[ck*NC+ci].dirty=true;
    if(i%CH===0&&ci>0) chunks[ck*NC+ci-1].dirty=true; if(i%CH===CH-1&&ci<NC-1) chunks[ck*NC+ci+1].dirty=true;
    if(k%CH===0&&ck>0) chunks[(ck-1)*NC+ci].dirty=true; if(k%CH===CH-1&&ck<NC-1) chunks[(ck+1)*NC+ci].dirty=true; };

  // ---------- 鏡頭、玩家 ----------
  const cam=new T.PerspectiveCamera(70,1,0.08,9000);
  const hl=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1.004,1.004,1.004)),new T.LineBasicMaterial({color:0x111111,transparent:true,opacity:0.7}));
  hl.visible=false; scene.add(hl);
  const pl={x:sv.x0,z:sv.z0,y:0,vy:0,ground:false,fly:false,floaty:false,fast:false,wet:false,sneak:false,sprint:false,yaw:sv.yaw,pitch:Math.min(0.3,sv.pitch),eye:0};
  if(FO){ // 站在那支風機旁邊、面向它：陸上離 6～16 公尺找不是水的地方；海上就站在基座的水泥平台上
    let ux=sv.x0-FO.x, uz=sv.z0-FO.z, un=Math.hypot(ux,uz); if(un<1){ ux=0; uz=1; un=1; } ux/=un; uz/=un;
    let spot=null; const mill=FO.kind===3;
    for(const d of mill?[14,10,8]:[16,12,9,6]){ const x=FO.x+ux*d, z=FO.z+uz*d, i=Math.floor(x-X0), k=Math.floor(z-Z0); if(i<1||k<1||i>=N-1||k>=N-1) continue;
      const b=vox[I(i,colTop[k*N+i],k)]; if(b!==WATER&&b!==METAL&&b!==LEAVES){ spot=[x,z]; break; } }
    if(!spot){ const i=Math.floor(FO.x-X0)-3*F[0], k=Math.floor(FO.z-Z0)-3*F[1]; spot=[X0+i+0.5,Z0+k+0.5]; }
    pl.x=spot[0]; pl.z=spot[1]; pl.yaw=Math.atan2(FO.x-pl.x,-(FO.z-pl.z)); pl.pitch=mill?0.3:0.55;
  }
  { const i=Math.floor(pl.x-X0), k=Math.floor(pl.z-Z0), t=colTop[k*N+i];
    if(vox[I(i,t,k)]===WATER) for(let dk=-2;dk<=2;dk++) for(let di=-2;di<=2;di++){ set(i+di,t,k+dk,PLANK); dirty(i+di,k+dk); } // 起點在水上：放一個木頭浮台
    pl.y=Y0+t+1; pl.eye=pl.y+1.62; }
  const solid=(i,y,k)=>{ if(i<0||k<0||i>=N||k>=N||y<0) return true; if(y>=H) return false; const b=vox[I(i,y,k)]; return b!==AIR&&b!==WATER; };
  const hit=(x,y,z)=>{ const r=0.3;
    for(let j=Math.floor(y-Y0+0.001);j<=Math.floor(y+1.75-Y0);j++) for(let k=Math.floor(z-r-Z0);k<=Math.floor(z+r-Z0);k++) for(let i=Math.floor(x-r-X0);i<=Math.floor(x+r-X0);i++) if(solid(i,j,k)) return true;
    return false; };
  const keys=new Set(); let jump=false, sel=0, sneakT=false, downT=false, tSpace=0, tW=0, tJump=0;
  function tryMove(nx,nz){
    if(pl.sneak&&pl.ground&&!pl.wet&&!hit(nx,pl.y-0.1,nz)) return; // 蹲著走到邊緣不會掉下去（跟 Minecraft 一樣）
    if(!hit(nx,pl.y,nz)){ pl.x=nx; pl.z=nz; return; }
    if((pl.ground||pl.wet)&&!pl.fly){ const up=Y0+Math.floor(pl.y-Y0+0.001)+1; if(up-pl.y<=(pl.wet?1.45:1.05)&&!hit(nx,up,nz)&&!hit(pl.x,up,pl.z)){ pl.y=up; pl.x=nx; pl.z=nz; } } // 一格高的台階自動走上去
  }
  function move(dt){
    const has=k=>keys.has(k);
    let f=(has('KeyW')||has('ArrowUp')?1:0)-(has('KeyS')||has('ArrowDown')?1:0), s=(has('KeyD')?1:0)-(has('KeyA')?1:0);
    pl.yaw+=((has('ArrowRight')?1:0)-(has('ArrowLeft')?1:0))*1.8*dt;
    // 跟 Minecraft 一樣：Ctrl 或連按兩下 W 跑步，Shift 蹲下（飛行時往下），搖桿推到底往前也會跑
    const down=has('ShiftLeft')||has('ShiftRight')||downT, ix=Math.floor(pl.x-X0), kz=Math.floor(pl.z-Z0);
    pl.sneak=!pl.fly&&(has('ShiftLeft')||has('ShiftRight')||sneakT);
    const wet=pl.wet=get(ix,Math.floor(pl.y+0.4-Y0),kz)===WATER;
    if(G.joy){ f=-G.joy.y; s=G.joy.x; if(Math.hypot(f,s)>0.92&&f>0.5) pl.sprint=true; }
    if(has('ControlLeft')||has('ControlRight')) pl.sprint=true;
    if(f<=0||pl.sneak) pl.sprint=false;
    let spd=pl.fly?(pl.sprint?21.6:10.9):pl.sneak?1.3:pl.sprint?5.6:4.3; if(wet&&!pl.fly) spd*=pl.floaty?0.85:0.6;
    if(pl.fast) spd*=2; // ⚡ 加速：走路、跑步、游泳、飛行都快一倍
    const n=Math.hypot(f,s); if(n>1){ f/=n; s/=n; }
    if(n>0.08){ const fx=Math.sin(pl.yaw), fz=-Math.cos(pl.yaw), d=spd*dt;
      const dx=(fx*f+Math.cos(pl.yaw)*s)*d, dz=(fz*f+Math.sin(pl.yaw)*s)*d;
      tryMove(pl.x+dx,pl.z); tryMove(pl.x,pl.z+dz); }
    const up=jump||has('Space');
    if(pl.fly) pl.vy=((up?1:0)-(down?1:0))*8*(pl.fast?2:1);
    else if(wet&&pl.floaty){ // 🛟 浮力：像穿救生衣，自動浮到水面、頭露出來，輕輕上下晃；按跳可以跳上岸
      let w=Math.floor(pl.y+0.4-Y0); while(get(ix,w+1,kz)===WATER) w++;
      const surf=Y0+w+1-0.45+Math.sin(performance.now()/450)*0.06;
      pl.vy+=((surf-pl.y)*5-pl.vy)*Math.min(1,dt*6);
      if(up&&pl.y>surf-0.35) pl.vy=6.5; }
    else{ pl.vy-=(wet?9:26)*dt; if(wet) pl.vy=Math.max(pl.vy,-3);
      if(up&&(pl.ground||wet)) pl.vy=wet?3.5:8.2; }
    const ny=pl.y+pl.vy*dt;
    if(hit(pl.x,ny,pl.z)){
      if(pl.vy<0){ const land=Y0+Math.floor(ny-Y0)+1; if(!hit(pl.x,land,pl.z)) pl.y=land; pl.ground=true; if(pl.fly) setFly(false); } // 飛到地上就變回走路
      pl.vy=0;
    }else{ pl.y=ny; pl.ground=false; }
    pl.eye+=(pl.y+(pl.sneak?1.27:1.62)-pl.eye)*Math.min(1,dt*18);
  }

  // ---------- 指到哪一格（從鏡頭沿著視線一格一格走） ----------
  const V=new T.Vector3();
  function ray(sx,sy,far,wet){
    const r=cv.getBoundingClientRect(); V.set((sx-r.left)/r.width*2-1,-(sy-r.top)/r.height*2+1,0.5).unproject(cam).sub(cam.position).normalize();
    let x=cam.position.x-X0, y=cam.position.y-Y0, z=cam.position.z-Z0, i=Math.floor(x), j=Math.floor(y), k=Math.floor(z);
    const dx=V.x, dy=V.y, dz=V.z, si=Math.sign(dx), sj=Math.sign(dy), sk=Math.sign(dz);
    const tdx=Math.abs(1/dx), tdy=Math.abs(1/dy), tdz=Math.abs(1/dz);
    let tx=dx?((si>0?i+1-x:x-i)*tdx):Infinity, tyy=dy?((sj>0?j+1-y:y-j)*tdy):Infinity, tz=dz?((sk>0?k+1-z:z-k)*tdz):Infinity, t=0, p=null;
    while(t<=(far||10)){
      const b=get(i,j,k); if(b&&(b!==WATER||wet)&&i>=0&&k>=0&&i<N&&k<N) return {i,j,k,p};
      p=[i,j,k];
      if(tx<tyy&&tx<tz){ i+=si; t=tx; tx+=tdx; } else if(tyy<tz){ j+=sj; t=tyy; tyy+=tdy; } else { k+=sk; t=tz; tz+=tdz; }
    }
    return null;
  }
  // ---------- 工具：拆、大拆除、放、大安裝、種風機、炸彈；每一次動作可以「上一步」，也可以一鍵全部復原 ----------
  const orig=vox.slice(), origTop=colTop.slice(); // 剛蓋好的樣子（一鍵復原用）
  // 道具都只會影響方塊（沒有人物、動物）
  const TOOLS=[['hand','⛏','拆／放'],['wall','🏗','大安裝'],['turbine','🌀','大風機'],['mini','🎐','小風車'],['mill','🏠','磨坊風車'],
    ['hammer','🔨','大槌子'],['blaster','🔫','方塊槍'],['laser','🔦','雷射槍'],['saber','⚔️','光劍'],['ice','❄️','冰凍槍'],['rainbow','🌈','彩虹槍'],['tree','🌳','種樹'],['bomb','💣','炸彈'],['rocket','🚀','火箭筒'],['meteor','☄️','隕石'],['tornado','🌪','龍捲風']];
  let tool='hand', hist=[], grp=null;
  const fuses=[], parts=[]; let shake=0;
  function edit(i,y,k,b){
    if(i<0||k<0||i>=N||k>=N||y<1||y>=H) return false;
    const id=I(i,y,k), o=vox[id]; if(o===b) return false;
    if(grp) grp.c.push(id,o);
    vox[id]=b; const c=k*N+i; if(b&&y>colTop[c]) colTop[c]=y; dirty(i,k); return true;
  }
  const begin=()=>{ grp={c:[],ro:[]}; return grp; };
  const commit=()=>{ if(grp&&(grp.c.length||grp.ro.length||grp.bl)){ hist.push(grp); if(hist.length>60) hist.shift(); } grp=null; };
  // 風機還完整嗎（機艙、輪轂都在才轉；輪轂不見就把葉片拿掉）
  function refreshTurbs(say,g){
    let stopped=false;
    for(const t of turbs){ if(!t.nac) continue; if(t.fallen){ t.ok=false; continue; } let ok=true; for(const id of t.nac) if(vox[id]===AIR){ ok=false; break; }
      if(t.ok&&!ok) stopped=true; t.ok=ok; t.ro.grp.visible=vox[t.hub]!==AIR; }
    if(stopped&&say) ctx.toast(tr('風機的機艙被拆掉了，葉片停下來了！'),2500);
    if(say) checkFalls(g);
  }
  // ---------- 風機倒下：塔被打斷、上半截跟地面連不起來，整支往外倒（離開玩家的方向），倒在地上變回方塊 ----------
  // 從輪轂和塔的中心那一排往外找連在一起的方塊（只找塔附近、地面以上）；碰得到地面或旁邊別的東西就算撐住
  const falls=[], NB=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  // 塔每一層原本有幾格（只算塔身）；某一層被打掉一半以上，就從那一層斷掉倒下
  function layers(a,src){ const L=[]; src=src||vox;
    for(let y=a.g+1;y<H;y++){ let n=0; for(let dk=-a.tr;dk<=a.tr;dk++) for(let di=-a.tr;di<=a.tr;di++){ if(di*di+dk*dk>a.tr*a.tr+0.5) continue; const b=src[I(a.i+di,y,a.k+dk)]; if(b&&b!==WATER) n++; }
      if(!n) break; L.push(n); }
    return L; }
  function checkFalls(g){
    for(const t of turbs){ const a=t.ax; if(!a||t.fallen) continue;
      if(!t.lay) t.lay=layers(a,orig);
      const cur=layers(a); let yw=-1; for(let q=0;q<t.lay.length-3;q++) if((cur[q]||0)*2<=t.lay[q]){ yw=a.g+1+q; break; } // 最低那一層斷掉的地方
      const seeds=[]; if(vox[t.hub]) seeds.push(t.hub);
      for(let y=Math.max(a.g,yw)+1;y<H;y++){ const id=I(a.i,y,a.k); if(vox[id]&&vox[id]!==WATER) seeds.push(id); }
      const seen=new Map(), drop=[]; let nc=0; // seen：每一格屬於第幾團；碰到前面已經撐住的那一團也算撐住
      for(const s0 of seeds){ if(seen.has(s0)) continue;
        const cn=++nc, comp=[], st=[s0]; seen.set(s0,cn); let held=false;
        while(st.length&&!held){ const id=st.pop(); comp.push(id); if(comp.length>8000){ held=true; break; }
          const i=id%N, k=Math.floor(id/N)%N, y=Math.floor(id/NN);
          for(const d of NB){ const ni=i+d[0], ny=y+d[1], nk=k+d[2]; if(ni<0||nk<0||ni>=N||nk>=N||ny>=H) continue;
            if(ny<1){ held=true; break; }
            const nid=I(ni,ny,nk), b=vox[nid]; if(!b||b===WATER) continue;
            if(ny===yw&&(ni-a.i)*(ni-a.i)+(nk-a.k)*(nk-a.k)<=a.tr*a.tr+0.5) continue; // 斷掉的那一層剩下的幾格撐不住
            const sc=seen.get(nid); if(sc===cn) continue; if(sc){ held=true; break; }
            if(ny<=a.g||(ni-a.i)*(ni-a.i)+(nk-a.k)*(nk-a.k)>a.r*a.r){ held=true; break; }
            seen.set(nid,cn); st.push(nid); } }
        if(!held) drop.push(...comp); }
      if(drop.length) topple(drop.includes(t.hub)?t:null,drop,a,g); } // 掉下來的幾團一起倒
  }
  function topple(t,comp,a,g){
    if(!g){ g=hist[hist.length-1]; if(!g){ g={c:[],ro:[]}; hist.push(g); } }
    const blocks=comp.map(id=>[id%N,Math.floor(id/NN),Math.floor(id/N)%N,vox[id]]), inS=new Set(comp);
    const keep=grp; grp=g; for(const q of blocks) edit(q[0],q[1],q[2],AIR); grp=keep;
    let dx=X0+a.i+0.5-pl.x, dz=Z0+a.k+0.5-pl.z; if(Math.abs(dx)>=Math.abs(dz)){ dx=Math.sign(dx)||1; dz=0; } else { dz=Math.sign(dz)||1; dx=0; }
    let ymin=1e9, ymax=0; for(const q of blocks){ if(q[1]<ymin) ymin=q[1]; if(q[1]>ymax) ymax=q[1]; }
    const px=X0+a.i+0.5+dx*1.5, py=Y0+ymin, pz=Z0+a.k+0.5+dz*1.5;
    // 倒下來的那一截：用同一張材質圖畫成一個模型，倒完再變回方塊
    const P=[], U=[], Cc=[];
    for(const [i,y,k,b] of blocks) for(const f of FACES){
      if(inS.has(I(i+f.n[0],y+f.n[1],k+f.n[2]))) continue;
      const t2=FT[f.t][b], u0=(t2%8)/8+UVE, u1=(t2%8+1)/8-UVE, vt=1-(t2>>3)/8-UVE, vb=1-((t2>>3)+1)/8+UVE, uv=[[u0,vb],[u1,vb],[u1,vt],[u0,vt]], s=f.s*sh;
      for(const v of [0,1,2,0,2,3]){ const q=f.c[v]; P.push(X0+i+q[0]-px,Y0+y+q[1]-py,Z0+k+q[2]-pz); U.push(uv[v][0],uv[v][1]); Cc.push(s,s,s); } }
    const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.Float32BufferAttribute(P,3)); geo.setAttribute('uv',new T.Float32BufferAttribute(U,2)); geo.setAttribute('color',new T.Float32BufferAttribute(Cc,3));
    const piv=new T.Group(), body=new T.Mesh(geo,opMat); piv.position.set(px,py,pz); piv.add(body); scene.add(piv);
    let rot=null; if(t){ rot={pos:t.ro.grp.position.clone(),q:t.ro.grp.quaternion.clone()}; piv.attach(t.ro.grp); t.fallen=true; t.ok=false; }
    const f={t,piv,body,blocks,g,axis:new T.Vector3(dz,0,-dx),dx,dz,th:0.03,w:0.3,k:Math.min(3,32/Math.max(3,ymax-ymin)),hgt:ymax-ymin+1,rot,done:false};
    falls.push(f); (g.falls||(g.falls=[])).push(f);
    if(t) ctx.toast(tr('塔被打斷了，風機要倒下來了！'),2500);
  }
  const TV=new T.Vector3();
  function stepFalls(dt){
    for(const f of falls){ if(f.done) continue;
      f.w+=f.k*Math.sin(f.th+0.06)*dt; f.th=Math.min(Math.PI/2,f.th+f.w*dt); f.piv.quaternion.setFromAxisAngle(f.axis,f.th);
      TV.set(-f.dx*1.5,f.hgt,-f.dz*1.5).applyQuaternion(f.piv.quaternion).add(f.piv.position); // 塔頂碰到東西就停
      const b=get(Math.floor(TV.x-X0),Math.floor(TV.y-Y0),Math.floor(TV.z-Z0));
      if(f.th>=Math.PI/2||(f.th>0.35&&b&&b!==WATER)) land(f); }
  }
  function land(f){
    f.done=true; const q=f.piv.quaternion, cells=[];
    for(const [i,y,k,b] of f.blocks){ TV.set(X0+i+0.5,Y0+y+0.5,Z0+k+0.5).sub(f.body.parent.position).applyQuaternion(q).add(f.piv.position);
      cells.push([Math.floor(TV.x-X0),Math.floor(TV.y-Y0),Math.floor(TV.z-Z0),b]); }
    const isFree=(i,y,k)=>{ const b=get(i,y,k); return (b===AIR||b===WATER)&&y>=1; };
    let d=0; // 整截一起往下掉，直到有一格碰到東西
    if(cells.some(c=>isFree(c[0],c[1],c[2]))) for(;d<60;d++){ let stop=false; for(const c of cells){ if(!isFree(c[0],c[1]-d,c[2])) continue; if(!isFree(c[0],c[1]-d-1,c[2])){ stop=true; break; } } if(stop) break; }
    const keep=grp; grp=f.g; let tip=null;
    for(const c of cells){ const y=c[1]-d; if(c[0]<0||c[2]<0||c[0]>=N||c[2]>=N||y>=H) continue; if(isFree(c[0],y,c[2])&&!onMe(c[0],y,c[2])){ edit(c[0],y,c[2],c[3]); tip=[c[0],y,c[2]]; } }
    grp=keep;
    f.piv.position.y-=d; f.piv.remove(f.body); f.body.geometry.dispose(); f.body=null;
    if(!f.t){ scene.remove(f.piv); }
    sfx('boom'); shake=0.6;
    if(tip) for(let n=0;n<24;n++){ const m=new T.Mesh(pbox,n%3?pmatA:pmatB); m.position.set(X0+tip[0]+0.5,Y0+tip[1]+0.5,Z0+tip[2]+0.5); scene.add(m); parts.push({m,t:0.3,v:[(Math.random()-0.5)*10,Math.random()*8+2,(Math.random()-0.5)*10]}); }
  }
  function undoFall(f){
    const q=falls.indexOf(f); if(q>=0) falls.splice(q,1);
    if(f.body){ f.piv.remove(f.body); f.body.geometry.dispose(); f.body=null; }
    if(f.t){ scene.attach(f.t.ro.grp); f.t.ro.grp.position.copy(f.rot.pos); f.t.ro.grp.quaternion.copy(f.rot.q); f.t.fallen=false; }
    scene.remove(f.piv);
  }
  const onMe=(i,y,k)=>{ const bx=X0+i, by=Y0+y, bz=Z0+k; return bx<pl.x+0.3&&bx+1>pl.x-0.3&&bz<pl.z+0.3&&bz+1>pl.z-0.3&&by<pl.y+1.8&&by+1>pl.y; };
  const free=(i,y,k)=>{ const b=get(i,y,k); return (b===AIR||b===WATER)&&i>=0&&k>=0&&i<N&&k<N&&y>=1&&y<H-1&&!onMe(i,y,k); };
  // 小音效（Web Audio 合成，不用音檔）
  let AC=null;
  // ---------- 背景音樂：用 Web Audio 即時彈的安靜鋼琴（像 Minecraft 那種慢慢的、稀稀落落的琴聲，每次都不一樣，不用音檔） ----------
  // 一拍 0.75 秒、一個和弦 8 拍；一首 16 個和弦（約 1.5 分鐘），彈完安靜 10～20 秒再換一首（換調、換和弦進行）
  const mus={on:true,out:null,timer:0,next:0,beat:0,prog:null,key:48,left:0,rest:0};
  try{ mus.on=localStorage.getItem('windglobe-bwmus')!=='0'; }catch(e){}
  const acx=()=>{ try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==='suspended') AC.resume().catch(()=>{}); return AC; }catch(e){ return null; } };
  function musOut(){
    if(mus.out) return mus.out; const a=acx(); if(!a) return null;
    const g=a.createGain(); g.gain.value=0.0001; const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2400;
    const rv=a.createConvolver(), len=a.sampleRate*3, ir=a.createBuffer(2,len,a.sampleRate); // 殘響：衰減的雜訊
    for(let c=0;c<2;c++){ const d=ir.getChannelData(c); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3); }
    rv.buffer=ir; const wet=a.createGain(); wet.gain.value=0.5;
    g.connect(lp); lp.connect(a.destination); lp.connect(rv); rv.connect(wet); wet.connect(a.destination);
    return (mus.out=g);
  }
  // 和弦（從主音算的半音）：大七、小七、四級、五級這類柔和的和弦
  const PROGS=[[[0,4,7,11],[9,12,16,19],[5,9,12,16],[7,11,14,17]],[[0,4,7,14],[5,9,12,16],[9,12,16,19],[4,7,11,14]],[[5,9,12,16],[0,4,7,11],[2,5,9,12],[7,11,14,19]],[[9,12,16,19],[5,9,12,16],[0,4,7,11],[7,11,14,17]]];
  const PENTA=[0,2,4,7,9,12,14,16,19,21];
  function note(t,midi,vel,dur,out){
    const a=AC, f=440*Math.pow(2,(midi-69)/12), g=a.createGain();
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vel,t+0.012); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    const o1=a.createOscillator(), o2=a.createOscillator(), g2=a.createGain(); o1.type='triangle'; o1.frequency.value=f; o2.type='sine'; o2.frequency.value=f*2; g2.gain.value=0.22;
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(out||mus.out); o1.start(t); o2.start(t); o1.stop(t+dur+0.05); o2.stop(t+dur+0.05);
  }
  function musTick(){ // 每 0.25 秒往後排 1 秒內要彈的音
    if(!mus.on||!AC||!mus.out||AC.state!=='running') return;
    const now=AC.currentTime; if(mus.next<now) mus.next=now+0.1;
    while(mus.next<now+1){
      const t=mus.next; mus.next+=0.75;
      if(mus.rest>0){ mus.rest--; continue; }
      if(!mus.prog){ mus.prog=PROGS[Math.floor(Math.random()*PROGS.length)]; mus.key=[48,50,53,55,57][Math.floor(Math.random()*5)]; mus.left=16; mus.beat=0; }
      const ch=mus.prog[Math.floor(mus.beat/8)%4], k=mus.key;
      if(mus.beat%8===0){
        if(mus.left--<=0){ mus.prog=null; mus.rest=14+Math.floor(Math.random()*12); continue; }
        note(t,k+ch[0]-12,0.08,6.5); note(t+0.03,k+ch[1],0.03,5); note(t+0.06,k+ch[2],0.03,5);
      }
      if(Math.random()<0.42){ const pool=Math.random()<0.6?ch.map(x=>x+12):PENTA.map(x=>x+12), m=k+pool[Math.floor(Math.random()*pool.length)];
        note(t+(Math.random()<0.3?0.375:0),m,0.045+Math.random()*0.03,2.8); }
      mus.beat++;
    }
  }
  function setMus(on){
    mus.on=on; try{ localStorage.setItem('windglobe-bwmus',on?'1':'0'); }catch(e){}
    const g=musOut(); if(!g) return; const t=AC.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001,g.gain.value),t); g.gain.exponentialRampToValueAtTime(on?0.9:0.0001,t+(on?2:0.6));
    if(on) mus.next=0;
  }
  function enterChime(){ // 進入方塊世界：輕輕的「叮咚」琶音
    const a=acx(); if(!a) return; const out=a.createGain(); out.gain.value=0.9; out.connect(musOut()||a.destination);
    const t=a.currentTime+0.15; [72,76,79,84].forEach((m,q)=>note(t+q*0.12,m,0.06,1.6,out));
  }
  function sfx(kind){
    try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)(); const t=AC.currentTime, g=AC.createGain(); g.connect(AC.destination);
      if(kind==='boom'){ const n=AC.sampleRate*0.9, b=AC.createBuffer(1,n,AC.sampleRate), d=b.getChannelData(0); for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2.5);
        const s=AC.createBufferSource(), f=AC.createBiquadFilter(); f.type='lowpass'; f.frequency.value=700; s.buffer=b; s.connect(f); f.connect(g); g.gain.setValueAtTime(0.55,t); s.start(t); return; }
      if(kind==='whoosh'){ const n=AC.sampleRate*0.5, b=AC.createBuffer(1,n,AC.sampleRate), d=b.getChannelData(0); for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.sin(Math.PI*i/n);
        const s=AC.createBufferSource(), f=AC.createBiquadFilter(); f.type='bandpass'; f.frequency.setValueAtTime(400,t); f.frequency.exponentialRampToValueAtTime(1800,t+0.5); s.buffer=b; s.connect(f); f.connect(g); g.gain.setValueAtTime(0.35,t); s.start(t); return; }
      if(kind==='zap'){ const o=AC.createOscillator(); o.type='sawtooth'; o.frequency.setValueAtTime(1800,t); o.frequency.exponentialRampToValueAtTime(300,t+0.22);
        g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.24); o.connect(g); o.start(t); o.stop(t+0.25); return; }
      if(kind==='saber'){ const o=AC.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(110,t); o.frequency.linearRampToValueAtTime(260,t+0.18); o.frequency.linearRampToValueAtTime(140,t+0.35);
        g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.38); o.connect(g); o.start(t); o.stop(t+0.4); return; }
      if(kind==='pew'){ const o=AC.createOscillator(); o.type='square'; o.frequency.setValueAtTime(1100,t); o.frequency.exponentialRampToValueAtTime(220,t+0.12);
        g.gain.setValueAtTime(0.05,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.13); o.connect(g); o.start(t); o.stop(t+0.14); return; }
      const o=AC.createOscillator(); o.type=kind==='place'?'triangle':'square'; o.frequency.setValueAtTime(kind==='place'?220:420,t); o.frequency.exponentialRampToValueAtTime(kind==='place'?110:160,t+0.08);
      g.gain.setValueAtTime(0.06,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.1); o.connect(g); o.start(t); o.stop(t+0.11);
    }catch(e){}
  }
  // 種一支小風機：白鋼塔 16 格、機艙、輪轂，葉片會轉
  function plantTurbine(p){
    const [i,y0,k]=p, hh=16; if(y0+hh+2>=H) return false;
    for(let y=y0;y<=y0+hh;y++) if(!free(i,y,k)) return false;
    for(let y=y0;y<=y0+hh;y++) edit(i,y,k,METAL);
    const nac=new Set(), cell=u=>[i+F[0]*u,y0+hh,k+F[1]*u];
    for(let u=-1;u<=2;u++){ const q=cell(u); if(u!==0&&!free(...q)) continue; edit(...q,METAL); nac.add(I(...q)); }
    const hub=cell(2), ro=rotor(7); ro.grp.position.set(X0+hub[0]+0.5+F[0]*0.8,Y0+hub[1]+0.5,Z0+hub[2]+0.5+F[1]*0.8); ro.grp.rotation.y=Math.atan2(F[0],F[1]); scene.add(ro.grp);
    const t={ro,nac,hub:I(...hub),k:1.1,ok:true,mine:true,ax:{i,k,g:y0-1,r:3,tr:0}}; turbs.push(t); grp.ro.push(t); t.lay=layers(t.ax);
    ctx.toast(tr('種好一支風機了！它會跟著風轉'),2200); return true;
  }
  // 小風車：5 格高的白桿＋小葉片（像庭院裡的小風車）
  function plantMini(p){
    const [i,y0,k]=p, hh=5; if(y0+hh+2>=H) return false;
    for(let y=y0;y<=y0+hh;y++) if(!free(i,y,k)) return false;
    const cell=u=>[i+F[0]*u,y0+hh,k+F[1]*u]; if(!free(...cell(1))) return false;
    for(let y=y0;y<=y0+hh;y++) edit(i,y,k,METAL);
    const hub=cell(1); edit(...hub,METAL); const nac=new Set([I(i,y0+hh,k),I(...hub)]);
    const ro=rotor(3); ro.grp.scale.setScalar(0.6); ro.grp.position.set(X0+hub[0]+0.5+F[0]*0.7,Y0+hub[1]+0.5,Z0+hub[2]+0.5+F[1]*0.7); ro.grp.rotation.y=Math.atan2(F[0],F[1]); scene.add(ro.grp);
    const t={ro,nac,hub:I(...hub),k:2.2,ok:true,mine:true,ax:{i,k,g:y0-1,r:2,tr:0}}; turbs.push(t); grp.ro.push(t); t.lay=layers(t.ax);
    ctx.toast(tr('種好一支小風車了！'),2000); return true;
  }
  // 磨坊風車：3×3 的小磨坊（石頭底、木板牆、屋頂），前面四片帆
  function plantMill(p){
    const [i,y0,k]=p, hh=6; if(y0+hh+3>=H) return false;
    for(let y=y0;y<=y0+hh+1;y++) for(let dk=-1;dk<=1;dk++) for(let di=-1;di<=1;di++) if(!free(i+di,y,k+dk)) return false;
    const cell=(u,y)=>[i+F[0]*u,y,k+F[1]*u]; if(!free(...cell(2,y0+hh-1))) return false;
    const nac=new Set();
    for(let y=y0;y<y0+hh;y++) for(let dk=-1;dk<=1;dk++) for(let di=-1;di<=1;di++){ if(!di&&!dk) continue; edit(i+di,y,k+dk,y<y0+2?ROCK:PLANK); }
    for(const y of [y0,y0+1]){ const q=[i-F[0],y,k-F[1]]; edit(...q,AIR); } // 門
    for(let dk=-1;dk<=1;dk++) for(let di=-1;di<=1;di++){ edit(i+di,y0+hh,k+dk,ROOF); nac.add(I(i+di,y0+hh,k+dk)); }
    edit(i,y0+hh+1,k,ROOF); nac.add(I(i,y0+hh+1,k));
    const hub=cell(2,y0+hh-1); edit(...hub,LOG); nac.add(I(...hub));
    const ro=sails(5); ro.grp.position.set(X0+hub[0]+0.5+F[0]*0.7,Y0+hub[1]+0.5,Z0+hub[2]+0.5+F[1]*0.7); ro.grp.rotation.y=Math.atan2(F[0],F[1]); scene.add(ro.grp);
    const t={ro,nac,hub:I(...hub),k:0.5,ok:true,mine:true,ax:{i,k,g:y0-1,r:3,tr:1}}; turbs.push(t); grp.ro.push(t); t.lay=layers(t.ax);
    ctx.toast(tr('蓋好一座磨坊風車了！'),2000); return true;
  }
  // 種樹：樹幹＋一團樹葉（有時候是白樺木、秋天的樹葉）
  function growTree(p){
    const [i,y0,k]=p, th=4+Math.floor(Math.random()*2), r=2, cy=y0+th; if(cy+r>=H) return false;
    for(let y=y0;y<=cy;y++) if(!free(i,y,k)) return false;
    const birch=Math.random()<0.35, leaf=Math.random()<0.35?LEAVES2:LEAVES;
    for(let y=-r;y<=r;y++) for(let dk=-r;dk<=r;dk++) for(let di=-r;di<=r;di++){ const q=di*di+dk*dk+y*y; if(q>r*r+1) continue; if(get(i+di,cy+y,k+dk)===AIR&&!onMe(i+di,cy+y,k+dk)) edit(i+di,cy+y,k+dk,leaf); }
    for(let y=y0;y<=cy;y++) edit(i,y,k,birch?BIRCH:LOG);
    return true;
  }
  const pbox=new T.BoxGeometry(0.35,0.35,0.35), pmatA=new T.MeshBasicMaterial({color:0x8a8070}), pmatB=new T.MeshBasicMaterial({color:0xff7a2a});
  const fuseMat=new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.6,depthWrite:false});
  // ---------- 葉片、帆、輪轂也可以拆：每一片是獨立的零件，打到就掉下碎片消失（上一步可以裝回去） ----------
  const RC=new T.Raycaster(), pmatW=new T.MeshBasicMaterial({color:0xeef0f3}), WV=new T.Vector3();
  const bladeParts=()=>{ const a=[]; for(const t of turbs) if(t.nac&&t.ro.grp.visible) for(const m of t.ro.parts) if(m.visible){ m.updateWorldMatrix(true,false); a.push(m); } return a; };
  function bladeHits(o,d,far){ RC.set(o,d); RC.near=0; RC.far=far; const seen=new Set(); return RC.intersectObjects(bladeParts(),false).filter(h=>!seen.has(h.object)&&seen.add(h.object)); }
  function breakBlade(m,pt,g){
    if(!m.visible) return; m.visible=false; (g.bl||(g.bl=[])).push(m); sfx('break');
    for(let n=0;n<10;n++){ const q=new T.Mesh(pbox,n%3?pmatW:pmatA); q.position.copy(pt); scene.add(q); parts.push({m:q,t:0.3,v:[(Math.random()-0.5)*7,Math.random()*5+1,(Math.random()-0.5)*7]}); }
  }
  // 爆炸、光劍、龍捲風：範圍裡碰到的葉片都拆掉（葉片很長，抽幾個點看有沒有在範圍裡）
  function bladesNear(c,r,g){
    for(const m of bladeParts()){ const pos=m.geometry.attributes.position; m.updateMatrixWorld();
      for(let v=0;v<pos.count;v+=18){ WV.fromBufferAttribute(pos,v).applyMatrix4(m.matrixWorld); if(WV.distanceTo(c)<=r){ breakBlade(m,WV.clone(),g); break; } } }
  }
  // 炸彈：放下去 1.2 秒後爆炸，半徑 3.5 格的方塊都炸掉（水和最底層不會）；算在放炸彈那一步裡，「上一步」可以一起復原
  function explode(f){
    const keep=grp; grp=f.g; edit(f.i,f.j,f.k,AIR);
    const r=f.r||3.5, R0=Math.ceil(r); for(let y=-R0;y<=R0;y++) for(let dk=-R0;dk<=R0;dk++) for(let di=-R0;di<=R0;di++){ if(di*di+dk*dk+y*y>r*r) continue;
      const b=get(f.i+di,f.j+y,f.k+dk); if(b&&b!==WATER) edit(f.i+di,f.j+y,f.k+dk,AIR); }
    grp=keep; refreshTurbs(true,f.g); sfx('boom'); shake=f.r>4?0.9:0.5;
    const wx=X0+f.i+0.5, wy=Y0+f.j+0.5, wz=Z0+f.k+0.5; bladesNear(new T.Vector3(wx,wy,wz),r+0.5,f.g);
    if(Math.hypot(pl.x-wx,pl.y+0.9-wy,pl.z-wz)<(f.r||3.5)+2.5){ pl.vy=7; pl.ground=false; } // 被震得跳起來
    const ball=new T.Mesh(new T.SphereGeometry(1,16,12),new T.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:0.9,depthWrite:false})); ball.position.set(wx,wy,wz); ball.scale.setScalar((f.r||3.5)/3.5); scene.add(ball);
    parts.push({m:ball,t:0,ball:true});
    for(let q=0;q<36;q++){ const m=new T.Mesh(pbox,q%3?pmatA:pmatB); m.position.set(wx,wy,wz); scene.add(m);
      parts.push({m,t:0,v:[(Math.random()-0.5)*14,Math.random()*12+3,(Math.random()-0.5)*14]}); }
  }
  function act(sx,sy,place){
    if(!place&&(tool==='blaster'||tool==='rocket')){ fire(sx,sy); return; }
    if(!place&&tool==='laser'){ laser(sx,sy); return; }
    if(!place&&tool==='saber'){ slashSaber(); return; }
    if(!place&&tool==='tornado'){ const h=ray(sx,sy); if(h) spawnTornado(h); return; }
    if(!place&&(tool==='ice'||tool==='rainbow')){ spray(sx,sy); return; }
    if(!place&&tool==='meteor'){ meteor(sx,sy); return; }
    const h=ray(sx,sy);
    if(!place&&(tool==='hand'||tool==='hammer')){ // 葉片比方塊近：拆葉片
      const r=cv.getBoundingClientRect(), d=DIR.set((sx-r.left)/r.width*2-1,-(sy-r.top)/r.height*2+1,0.5).unproject(cam).sub(cam.position).normalize().clone();
      const o=cam.position, hb=bladeHits(o,d,10)[0];
      if(hb&&(!h||hb.distance<Math.hypot(X0+h.i+0.5-o.x,Y0+h.j+0.5-o.y,Z0+h.k+0.5-o.z)-0.5)){ if(tool==='hammer') swing=1; begin(); breakBlade(hb.object,hb.point,grp); commit(); return; } }
    if(!h){ if(tool==='hammer') swing=1; return; }
    const tl=place?'place':tool, p=h.p, ok=p&&free(...p);
    begin();
    if(tl==='hand'){ if(h.j>0&&edit(h.i,h.j,h.k,AIR)) sfx('break'); }
    else if(tl==='hammer'){ swing=1; for(let y=-1;y<=1;y++) for(let dk=-1;dk<=1;dk++) for(let di=-1;di<=1;di++){ const b=get(h.i+di,h.j+y,h.k+dk); if(b&&b!==WATER) edit(h.i+di,h.j+y,h.k+dk,AIR); } sfx('break'); }
    else if(tl==='place'){ if(ok&&edit(...p,HOTBAR[sel])) sfx('place'); }
    else if(tl==='wall'&&p){ // 在點到的那一面上鋪 3×3
      const n=[p[0]-h.i,p[1]-h.j,p[2]-h.k], u=n[1]?[1,0,0]:[0,1,0], v=n[2]?[1,0,0]:[0,0,1];
      for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++){ const q=[p[0]+u[0]*a+v[0]*b,p[1]+u[1]*a+v[1]*b,p[2]+u[2]*a+v[2]*b]; if(free(...q)) edit(...q,HOTBAR[sel]); }
      sfx('place'); }
    else if((tl==='turbine'||tl==='mini'||tl==='mill')&&ok){ if(!(tl==='mini'?plantMini:tl==='mill'?plantMill:plantTurbine)(p)) ctx.toast(tr('這裡太擠了，換個空曠的地方種風機'),2000); else sfx('place'); }
    else if(tl==='tree'&&ok){ if(growTree(p)) sfx('place'); else ctx.toast(tr('這裡種不下，換個空曠的地方'),1800); }
    else if(tl==='bomb'&&ok){ edit(...p,BOMB); sfx('place');
      const m=new T.Mesh(new T.BoxGeometry(1.06,1.06,1.06),fuseMat); m.position.set(X0+p[0]+0.5,Y0+p[1]+0.5,Z0+p[2]+0.5); scene.add(m);
      fuses.push({i:p[0],j:p[1],k:p[2],t:1.2,m,g:grp}); }
    const g=grp; commit(); if(g.c.length) refreshTurbs(true,g);
  }
  // ---------- 方塊槍、火箭筒：從鏡頭往點的方向飛，撞到方塊才作用（方塊槍打掉一格；火箭筒爆炸） ----------
  const projs=[], DIR=new T.Vector3();
  const pelletGeo=new T.BoxGeometry(0.16,0.16,0.16), pelletMat=new T.MeshBasicMaterial({color:0xffe14a});
  const rocketGeo=new T.BoxGeometry(0.24,0.24,0.8), rocketMat=new T.MeshBasicMaterial({color:0x6f8f4e}), flameGeo=new T.BoxGeometry(0.18,0.18,0.3), flameMat=new T.MeshBasicMaterial({color:0xff8a2a});
  const puffGeo=new T.BoxGeometry(0.3,0.3,0.3), puffMat=new T.MeshBasicMaterial({color:0xcfcfcf,transparent:true,opacity:0.55,depthWrite:false});
  let cool=0, kick=0, swing=0;
  function fire(sx,sy){
    if(cool>0) return; const rk=tool==='rocket'; cool=rk?0.8:0.12;
    const r=cv.getBoundingClientRect(), d=DIR.set((sx-r.left)/r.width*2-1,-(sy-r.top)/r.height*2+1,0.5).unproject(cam).sub(cam.position).normalize().clone();
    const p=cam.position.clone().addScaledVector(d,0.7); p.y-=0.12;
    const m=new T.Mesh(rk?rocketGeo:pelletGeo,rk?rocketMat:pelletMat); m.position.copy(p); m.lookAt(p.clone().add(d));
    if(rk){ const fl=new T.Mesh(flameGeo,flameMat); fl.position.z=-0.5; m.add(fl); }
    scene.add(m); projs.push({m,p,d,v:rk?32:90,rk,left:rk?140:80,puff:0});
    sfx(rk?'whoosh':'pew'); kick=1;
  }
  const pushHist=g=>{ if(g.c.length||g.ro.length||g.bl){ hist.push(g); if(hist.length>60) hist.shift(); } };
  function stepProjs(dt){
    for(let q=projs.length-1;q>=0;q--){
      const s=projs[q]; let dist=s.v*dt, hc=null, gone=false;
      let hb=null;
      while(dist>0&&!hc&&!gone){ const st=Math.min(0.4,dist); hb=bladeHits(s.p,s.d,st)[0]; if(hb){ s.p.copy(hb.point); hc=[Math.floor(s.p.x-X0),Math.floor(s.p.y-Y0),Math.floor(s.p.z-Z0)]; break; }
        dist-=st; s.left-=st; s.p.addScaledVector(s.d,st);
        const i=Math.floor(s.p.x-X0), j=Math.floor(s.p.y-Y0), k=Math.floor(s.p.z-Z0);
        if(i<0||k<0||i>=N||k>=N||j>=H||s.left<=0){ gone=true; break; }
        const b=get(i,j,k); if(b&&b!==WATER) hc=[i,j,k]; }
      s.m.position.copy(s.p);
      if(s.rk&&(s.puff-=dt)<=0&&s.p.distanceTo(cam.position)>7){ if(s.big) s.m.rotation.z+=0.3; // 尾煙離鏡頭 7 公尺以上才畫，不會擋住畫面
        s.puff=0.035; const m=new T.Mesh(puffGeo,puffMat); m.position.copy(s.p).addScaledVector(s.d,-0.6); scene.add(m); parts.push({m,t:0,puff:true}); }
      if(!hc&&!gone) continue;
      scene.remove(s.m); projs.splice(q,1);
      if(!hc) continue;
      if(s.rk){ const g={c:[],ro:[]}; if(hb) breakBlade(hb.object,hb.point,g); explode({i:hc[0],j:hc[1],k:hc[2],g,r:s.big?5.5:3.5}); pushHist(g); }
      else if(hb){ const g={c:[],ro:[]}; breakBlade(hb.object,hb.point,g); pushHist(g); }
      else{ const g={c:[],ro:[]}, keep=grp; grp=g; if(hc[1]>0) edit(...hc,AIR); grp=keep; pushHist(g);
        if(g.c.length){ refreshTurbs(true); sfx('break');
          for(let n=0;n<6;n++){ const m=new T.Mesh(pbox,n%2?pmatA:pmatB); m.position.set(X0+hc[0]+0.5,Y0+hc[1]+0.5,Z0+hc[2]+0.5); scene.add(m); parts.push({m,t:0.6,v:[(Math.random()-0.5)*6,Math.random()*5+2,(Math.random()-0.5)*6]}); } } }
    }
  }
  // 手上拿著的道具（畫在最上層，不會穿進方塊裡）
  const heldMat=new T.MeshBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false});
  function heldModel(boxes){ const P=[], Cc=[]; for(const b of boxes) addBox(P,Cc,b[0],b[1],b[2],b[3],b[4],b[5],0,b[6]);
    const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(P,3)); g.setAttribute('color',new T.Float32BufferAttribute(Cc,3));
    const m=new T.Mesh(g,heldMat); m.renderOrder=999; m.visible=false; return m; }
  const BROWN=[0.55,0.36,0.2], DARK=[0.2,0.2,0.24], GREY=[0.62,0.64,0.68];
  const HELD={
    hammer:heldModel([[-0.03,-0.28,-0.03,0.03,0.16,0.03,BROWN],[-0.14,0.12,-0.07,0.14,0.26,0.07,GREY]]),
    blaster:heldModel([[-0.06,-0.05,-0.3,0.06,0.07,0.05,[1,0.55,0.15]],[-0.035,-0.01,-0.46,0.035,0.05,-0.3,[0.3,0.62,1]],[-0.04,-0.2,-0.02,0.04,-0.05,0.06,DARK],[-0.045,0.07,-0.22,0.045,0.14,-0.06,[0.35,0.85,0.45]]]),
    laser:heldModel([[-0.06,-0.05,-0.32,0.06,0.07,0.04,[0.92,0.94,0.98]],[-0.03,-0.01,-0.46,0.03,0.05,-0.32,[1,0.25,0.45]],[-0.04,-0.2,-0.02,0.04,-0.05,0.06,DARK],[-0.07,0.0,-0.2,0.07,0.03,-0.08,[0.4,0.85,1]]]),
    saber:heldModel([[-0.03,-0.22,-0.03,0.03,0.0,0.03,GREY],[-0.04,-0.02,-0.04,0.04,0.02,0.04,DARK],[-0.018,0.02,-0.018,0.018,0.95,0.018,[0.55,1,1]],[-0.035,0.02,-0.035,0.035,0.9,0.035,[0.2,0.75,1]]]),
    ice:heldModel([[-0.06,-0.05,-0.3,0.06,0.07,0.05,[0.75,0.92,1]],[-0.035,-0.01,-0.46,0.035,0.05,-0.3,[0.35,0.75,1]],[-0.04,-0.2,-0.02,0.04,-0.05,0.06,DARK],[-0.07,0.07,-0.2,0.07,0.12,-0.08,[1,1,1]]]),
    rainbow:heldModel([[-0.06,-0.05,-0.3,0.06,0.07,0.05,[1,0.35,0.6]],[-0.035,-0.01,-0.46,0.035,0.05,-0.3,[1,0.85,0.2]],[-0.04,-0.2,-0.02,0.04,-0.05,0.06,DARK],[-0.07,0.07,-0.2,0.07,0.12,-0.08,[0.35,0.8,1]]]),
    tree:heldModel([[-0.02,-0.22,-0.02,0.02,0.05,0.02,BROWN],[-0.09,0.03,-0.09,0.09,0.2,0.09,[0.3,0.7,0.3]]]),
    meteor:heldModel([[-0.08,-0.2,-0.05,0.08,0.02,0.05,DARK],[-0.03,0.02,-0.03,0.03,0.07,0.03,[1,0.25,0.2]]]),
    rocket:heldModel([[-0.08,-0.06,-0.62,0.08,0.1,0.26,[0.35,0.55,0.3]],[-0.1,-0.08,-0.66,0.1,0.12,-0.58,DARK],[-0.03,-0.24,-0.05,0.03,-0.06,0.03,DARK],[-0.02,0.1,-0.22,0.02,0.17,-0.1,DARK]]),
  };
  const held=new T.Group(); held.position.set(0.3,-0.28,-0.6); for(const m of Object.values(HELD)) held.add(m); cam.add(held); scene.add(cam);
  function showHeld(){ for(const [k,m] of Object.entries(HELD)) m.visible=k===tool; }
  function stepHeld(dt){
    cool=Math.max(0,cool-dt); kick=Math.max(0,kick-dt*6); swing=Math.max(0,swing-dt*4);
    slash=Math.max(0,slash-dt*3.5);
    if(tool==='saber') held.rotation.set(-0.5+0.3*Math.sin(slash*Math.PI),slash?(slash-0.5)*2.6:-0.2,slash?-0.9:-0.3); // 光劍由右往左揮
    else held.rotation.set(kick*0.35-Math.sin(swing*Math.PI)*1.1,-0.15,swing?-0.3*Math.sin(swing*Math.PI):0);
    held.position.z=-0.6+kick*0.08;
  }
  // ---------- 雷射槍：一道光束穿過去，路上最多 12 格方塊一起消失（最遠 40 公尺） ----------
  const beamGeo=new T.BoxGeometry(0.07,0.07,1);
  function laser(sx,sy){
    if(cool>0) return; cool=0.25; kick=0.6; sfx('zap');
    const r=cv.getBoundingClientRect(), d=DIR.set((sx-r.left)/r.width*2-1,-(sy-r.top)/r.height*2+1,0.5).unproject(cam).sub(cam.position).normalize().clone();
    const o=cam.position.clone(), p=o.clone(), g={c:[],ro:[]}, keep=grp; grp=g; let n=0, len=40;
    hist.push(g); if(hist.length>60) hist.shift(); // 先放進紀錄，風機倒下時才記得到同一步
    for(let t=0;t<40&&n<12;t+=0.25){ p.copy(o).addScaledVector(d,t); const i=Math.floor(p.x-X0), j=Math.floor(p.y-Y0), k=Math.floor(p.z-Z0);
      if(i<0||k<0||i>=N||k>=N||j<1||j>=H){ len=t; break; }
      const b=get(i,j,k); if(b&&b!==WATER&&edit(i,j,k,AIR)){ n++; len=t; } }
    grp=keep; for(const h of bladeHits(o,d,len)) breakBlade(h.object,h.point,g);
    if(!g.c.length&&!g.bl) hist.pop(); if(n) refreshTurbs(true,g);
    beam(o,d,len,0xff2f6e);
  }
  function beam(o,d,len,color){
    const from=o.clone().addScaledVector(d,0.6); from.y-=0.12; const to=o.clone().addScaledVector(d,Math.max(len,2)), L=from.distanceTo(to);
    const m=new T.Mesh(beamGeo,new T.MeshBasicMaterial({color,transparent:true,opacity:0.95,depthWrite:false}));
    m.position.copy(from).add(to).multiplyScalar(0.5); m.lookAt(to); m.scale.z=L; scene.add(m); parts.push({m,t:0,beam:true});
  }
  // ---------- 光劍：往前揮一刀，前方 3.5 公尺、左右各 60°、腳下一層到頭上的方塊都切掉 ----------
  let slash=0;
  function slashSaber(){
    if(cool>0) return; cool=0.35; slash=1; sfx('saber');
    const g={c:[],ro:[]}, keep=grp; grp=g;
    const fx=Math.sin(pl.yaw), fz=-Math.cos(pl.yaw), j0=Math.floor(pl.y-Y0), i0=Math.floor(pl.x-X0), k0=Math.floor(pl.z-Z0);
    for(let dk=-4;dk<=4;dk++) for(let di=-4;di<=4;di++){ const cx=X0+i0+di+0.5-pl.x, cz=Z0+k0+dk+0.5-pl.z, d=Math.hypot(cx,cz);
      if(d<0.6||d>3.6||(cx*fx+cz*fz)/d<0.5) continue;
      for(let j=j0-1;j<=j0+2;j++){ const b=get(i0+di,j,k0+dk); if(b&&b!==WATER) edit(i0+di,j,k0+dk,AIR); } } // 連腳下那層地面也切出一道溝，揮了一定看得到
    grp=keep; bladesNear(new T.Vector3(pl.x+fx*2,pl.eye,pl.z+fz*2),2.2,g); pushHist(g); if(g.c.length) refreshTurbs(true,g);
  }
  // ---------- 龍捲風：從點到的地方往前走 4 秒，半徑 2 格、高 8 格的方塊都被捲上天 ----------
  const tornados=[], twMat=new T.MeshBasicMaterial({color:0xdfe6ee,transparent:true,opacity:0.45,depthWrite:false,side:T.DoubleSide});
  function spawnTornado(h){
    const grpT=new T.Group(); for(let q=0;q<5;q++){ const c=new T.Mesh(new T.CylinderGeometry(0.9+q*0.9,0.5+q*0.9,2.2,14,1,true),twMat); c.position.y=1.1+q*2; grpT.add(c); }
    const x=X0+h.i+0.5, z=Z0+h.k+0.5; grpT.position.set(x,Y0+h.j+1,z); scene.add(grpT);
    const g={c:[],ro:[]}; hist.push(g); if(hist.length>60) hist.shift();
    tornados.push({m:grpT,x,z,dx:Math.sin(pl.yaw)*4,dz:-Math.cos(pl.yaw)*4,t:4,tick:0,g}); sfx('whoosh'); shake=0.2;
  }
  function stepTornados(dt){
    for(let q=tornados.length-1;q>=0;q--){ const w=tornados[q]; w.t-=dt; w.x+=w.dx*dt; w.z+=w.dz*dt;
      const i=Math.floor(w.x-X0), k=Math.floor(w.z-Z0); let top=-1;
      if(i>=0&&k>=0&&i<N&&k<N) for(let y=colTop[k*N+i];y>0;y--){ const b=vox[I(i,y,k)]; if(b&&b!==WATER){ top=y; break; } }
      w.m.position.set(w.x,Y0+(top<0?w.m.position.y-Y0:top+1),w.z); w.m.children.forEach((c,n)=>{ c.rotation.y+=dt*(6+n); });
      if((w.tick-=dt)<=0&&top>=0){ w.tick=0.1; const keep=grp; grp=w.g; let n=0;
        for(let y=top-1;y<=top+7;y++) for(let dk=-2;dk<=2;dk++) for(let di=-2;di<=2;di++){ if(di*di+dk*dk>5) continue; const b=get(i+di,y,k+dk);
          if(b&&b!==WATER&&edit(i+di,y,k+dk,AIR)&&n++<4){ const m=new T.Mesh(pbox,n%2?pmatA:pmatB); m.position.set(X0+i+di+0.5,Y0+y+0.5,Z0+k+dk+0.5); scene.add(m); parts.push({m,t:0,swirl:true,cx:w.x,cz:w.z,a:Math.random()*6.3,r:1+Math.random()*2}); } }
        grp=keep; if(n) refreshTurbs(true,w.g); bladesNear(new T.Vector3(w.x,Y0+top+4,w.z),3.5,w.g); }
      if(w.t<=0||i<0||k<0||i>=N||k>=N){ scene.remove(w.m); w.m.children.forEach(c=>c.geometry.dispose()); tornados.splice(q,1); }
    }
  }
  // ---------- 冰凍槍、彩虹槍：射到的地方半徑 2 格變成冰（水也結冰，可以走在上面）或彩虹羊毛 ----------
  function spray(sx,sy){
    if(cool>0) return; cool=0.2; kick=0.5; const ic=tool==='ice'; sfx(ic?'zap':'pew');
    const r=cv.getBoundingClientRect(), d=DIR.set((sx-r.left)/r.width*2-1,-(sy-r.top)/r.height*2+1,0.5).unproject(cam).sub(cam.position).normalize().clone();
    const h=ray(sx,sy,60,ic), o=cam.position.clone();
    beam(o,d,h?Math.hypot(X0+h.i+0.5-o.x,Y0+h.j+0.5-o.y,Z0+h.k+0.5-o.z):40,ic?0x9fe8ff:[0xff4a4a,0xffa63a,0xffe14a,0x5ccf5c,0x4a8cff,0xb06aff][Math.floor(Math.random()*6)]);
    if(!h) return; const g={c:[],ro:[]}, keep=grp; grp=g;
    for(let y=-2;y<=2;y++) for(let dk=-2;dk<=2;dk++) for(let di=-2;di<=2;di++){ if(di*di+dk*dk+y*y>5) continue;
      const i=h.i+di, j=h.j+y, k=h.k+dk, b=get(i,j,k); if(!b||j<1) continue;
      if(ic){ if(b===LAVA) edit(i,j,k,ROCK); else if(b!==ICE&&(b!==WATER||get(i,j+1,k)===AIR)) edit(i,j,k,ICE); } // 水只凍最上面一層
      else if(b!==WATER) edit(i,j,k,WOOL[((i+j+k)%6+6)%6]); }
    grp=keep; pushHist(g); if(g.c.length) refreshTurbs(true,g);
  }
  // ---------- 隕石：點哪裡，天上就掉一顆隕石下來，撞到方塊炸出半徑 5.5 格的大洞 ----------
  const meteorGeo=new T.BoxGeometry(1.6,1.6,1.6), meteorMat=new T.MeshBasicMaterial({color:0x6b4a3a}), fireMat=new T.MeshBasicMaterial({color:0xff7a2a});
  function meteor(sx,sy){
    if(cool>0) return; const h=ray(sx,sy,90); if(!h) return; cool=1;
    const tx=X0+h.i+0.5, ty=Y0+h.j+0.5, tz=Z0+h.k+0.5, p=new T.Vector3(tx-Math.sin(pl.yaw)*12,ty+45,tz+Math.cos(pl.yaw)*12), d=new T.Vector3(tx,ty,tz).sub(p).normalize();
    const m=new T.Mesh(meteorGeo,meteorMat), fl=new T.Mesh(meteorGeo,fireMat); fl.scale.setScalar(0.7); fl.position.z=-1; m.add(fl); m.position.copy(p); m.lookAt(p.clone().add(d)); scene.add(m);
    projs.push({m,p,d,v:30,rk:true,big:true,left:120,puff:0}); sfx('whoosh');
  }
  function undo(){
    const g=hist.pop(); if(!g){ ctx.toast(tr('沒有可以復原的動作了'),1500); return; }
    for(let q=tornados.length-1;q>=0;q--) if(tornados[q].g===g){ scene.remove(tornados[q].m); tornados[q].m.children.forEach(c=>c.geometry.dispose()); tornados.splice(q,1); }
    for(let q=fuses.length-1;q>=0;q--) if(fuses[q].g===g){ scene.remove(fuses[q].m); fuses[q].m.geometry.dispose(); fuses.splice(q,1); } // 還沒爆的炸彈也拿掉
    if(g.falls) for(const f of g.falls.slice().reverse()) undoFall(f);
    if(g.bl) for(const m of g.bl) m.visible=true; // 拆掉的葉片裝回去
    for(let q=g.c.length-2;q>=0;q-=2){ const id=g.c[q]; vox[id]=g.c[q+1]; const i=id%N, k=Math.floor(id/N)%N, y=Math.floor(id/(N*N)); if(vox[id]&&y>colTop[k*N+i]) colTop[k*N+i]=y; dirty(i,k); }
    for(const t of g.ro){ if(t.ro.grp.parent) t.ro.grp.parent.remove(t.ro.grp); disRo(t.ro); turbs.splice(turbs.indexOf(t),1); }
    refreshTurbs(false); unstick();
  }
  let resetAsk=0;
  function resetAll(){
    if(performance.now()-resetAsk>3000){ resetAsk=performance.now(); ctx.toast(tr('再按一次「全部復原」，就會回到一開始的樣子'),3000); return; }
    resetAsk=0; for(const f of falls.slice()) undoFall(f); vox.set(orig); colTop.set(origTop); hist=[];
    for(const f of fuses){ scene.remove(f.m); f.m.geometry.dispose(); } fuses.length=0;
    for(const w of tornados){ scene.remove(w.m); w.m.children.forEach(c=>c.geometry.dispose()); } tornados.length=0;
    for(let q=turbs.length-1;q>=0;q--) if(turbs[q].mine){ if(turbs[q].ro.grp.parent) turbs[q].ro.grp.parent.remove(turbs[q].ro.grp); disRo(turbs[q].ro); turbs.splice(q,1); }
    for(const t of turbs) for(const m of t.ro.parts) m.visible=true;
    for(let ck=0;ck<NC;ck++) for(let ci=0;ci<NC;ci++) meshChunk(ci,ck);
    refreshTurbs(false); unstick(); ctx.toast(tr('全部復原了！'),2000);
  }
  function unstick(){ while(hit(pl.x,pl.y,pl.z)&&pl.y<Y0+H) pl.y+=1; } // 復原後被方塊卡住：往上移

  // ---------- 操作：跟 Minecraft 一樣 ----------
  // 電腦（Java 版）：點一下畫面鎖住滑鼠，移動滑鼠轉頭、看準心；左鍵拆（按住一直拆）、右鍵放（按住一直放）、中鍵選那種方塊；Esc 叫出滑鼠
  // 平板、手機（基岩版）：拖曳轉頭、點一下放方塊、按住拆方塊；拿武器時點一下就發射。右下角「拆／放」可以切換成點一下就拆
  // 瀏覽器不讓鎖滑鼠時，電腦改用拖曳轉頭、左鍵用工具、右鍵放
  let locked=false, noLock=!cv.requestPointerLock, pd=null, hold=null, brk=false; // brk：平板「拆方塊」模式
  const REP=new Set(['hand','hammer','blaster','laser','ice','rainbow']); // 按住可以一直用的工具
  const mid=()=>{ const r=cv.getBoundingClientRect(); return [r.left+r.width/2,r.top+r.height/2]; };
  const lockNow=()=>{ try{ const q=cv.requestPointerLock(); if(q&&q.catch) q.catch(()=>{ noLock=true; showLock(); }); }catch(e){ noLock=true; showLock(); } };
  const unlock=()=>{ if(locked) try{ document.exitPointerLock(); }catch(e){} };
  const onLock=()=>{ locked=document.pointerLockElement===cv; hold=null; if(!locked) keys.clear(); showLock(); };
  const onLockErr=()=>{ noLock=true; showLock(); };
  const startHold=(x,y,place)=>{ hold=(place||REP.has(tool))?{x,y,place,t:place?0.2:0.25}:null; };
  function pickBlock(x,y){ // 中鍵：拿手上指到的那種方塊（不在下面那排就換掉目前這格）
    const h=ray(x,y); if(!h) return; const b=get(h.i,h.j,h.k); if(!b||b===BOMB) return;
    let q=HOTBAR.indexOf(b);
    if(q<0){ q=sel; HOTBAR[q]=b; slots[q].title=tr(BT[b][0]); slots[q].querySelector('i').style.backgroundImage=`url(${iconURL(A.cv,b)})`; }
    pickSlot(q); if(tool!=='wall') pickTool('hand');
  }
  const onDown=e=>{
    if(e.pointerType==='mouse'){
      if(locked){ const [x,y]=mid();
        if(e.button===1){ e.preventDefault(); pickBlock(x,y); return; }
        if(e.button!==0&&e.button!==2) return;
        act(x,y,e.button===2); startHold(x,y,e.button===2); return; }
      if(!noLock){ if(e.button===0) lockNow(); return; }
      if(e.button===2){ act(e.clientX,e.clientY,true); return; }
      if(e.button===1){ e.preventDefault(); pickBlock(e.clientX,e.clientY); return; }
    }
    if(pd) return; pd={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:pl.yaw,pitch:pl.pitch,moved:false,held:false,touch:e.pointerType!=='mouse',t0:performance.now()};
    if(pd.touch&&tool==='hand'){ ring.style.left=e.clientX+'px'; ring.style.top=e.clientY+'px'; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); }
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
  };
  const onMove=e=>{
    if(locked&&e.pointerType==='mouse'){ pl.yaw+=(e.movementX||0)*0.0025; pl.pitch=Math.max(-1.55,Math.min(1.55,pl.pitch-(e.movementY||0)*0.0025)); return; }
    if(pd&&e.pointerId===pd.id){ const dx=e.clientX-pd.x, dy=e.clientY-pd.y;
      if(pd.held){ if(hold){ hold.x=e.clientX; hold.y=e.clientY; } return; } // 按住拆的時候移動手指：跟著拆手指下面的方塊
      if(Math.hypot(dx,dy)>8&&!pd.moved){ pd.moved=true; ring.classList.remove('go'); }
      if(pd.moved){ pl.yaw=pd.yaw-dx*0.005; pl.pitch=Math.max(-1.45,Math.min(1.45,pd.pitch+dy*0.005)); } return; }
    if(e.pointerType==='mouse'){ const h=ray(e.clientX,e.clientY); hl.visible=!!h; if(h) hl.position.set(X0+h.i+0.5,Y0+h.j+0.5,Z0+h.k+0.5); }
  };
  const onUp=e=>{
    if(e.pointerType==='mouse'&&locked){ hold=null; return; }
    if(!pd||e.pointerId!==pd.id) return; const tap=!pd.moved&&!pd.held, touch=pd.touch; pd=null; hold=null; ring.classList.remove('go');
    if(tap) act(e.clientX,e.clientY,touch&&tool==='hand'&&!brk); // 平板點一下＝放方塊（拆方塊模式＝拆）；拿別的工具＝用那個工具
  };
  const onCancel=e=>{ if(pd&&e.pointerId===pd.id){ pd=null; hold=null; ring.classList.remove('go'); } };
  function stepHold(dt){
    if(pd&&pd.touch&&!pd.moved&&!pd.held&&performance.now()-pd.t0>350){ // 平板按住不動＝拆
      pd.held=true; ring.classList.remove('go'); act(pd.x,pd.y,false); startHold(pd.x,pd.y,false); }
    if(hold&&(hold.t-=dt)<=0){ hold.t=hold.place?0.2:0.25; act(hold.x,hold.y,hold.place); }
    if(locked){ const [x,y]=mid(), h=ray(x,y); hl.visible=!!h; if(h) hl.position.set(X0+h.i+0.5,Y0+h.j+0.5,Z0+h.k+0.5); }
  }
  const onWheel=e=>{ e.preventDefault(); pickSlot((sel+(e.deltaY>0?1:-1)+HOTBAR.length)%HOTBAR.length); };
  const noMenu=e=>e.preventDefault();
  // 正版按 Ctrl 跑步，但瀏覽器的 Ctrl+W 會關掉分頁：在方塊世界裡關分頁前先問一下
  const onLeave=e=>{ e.preventDefault(); e.returnValue=''; };
  window.addEventListener('beforeunload',onLeave);
  document.addEventListener('pointerlockchange',onLock); document.addEventListener('pointerlockerror',onLockErr);
  cv.addEventListener('pointerdown',onDown); cv.addEventListener('pointermove',onMove); cv.addEventListener('pointerup',onUp); cv.addEventListener('pointercancel',onCancel);
  cv.addEventListener('wheel',onWheel,{passive:false}); cv.addEventListener('contextmenu',noMenu);

  // ---------- 畫面上的按鈕：下面一排方塊、上面一排工具、右下角由上而下 拆／放、浮力、加速、蹲下、跳；音樂在上面「回到風場」左邊 ----------
  const ui=document.createElement('div'), undoTx=tr('上一步'), resetTx=tr('全部復原'), lockTx=tr('點一下畫面開始玩（移動滑鼠轉頭，按 Esc 叫出滑鼠）'); ui.id='bwui';
  // 武器、風車各收在一個按鈕裡，按了在上面跳出選單切換；🎒（或 E）打開所有方塊
  const WEAP=new Set(['hammer','blaster','laser','saber','ice','rainbow','tree','bomb','rocket','meteor','tornado']), MILL=new Set(['turbine','mini','mill']);
  const weapTx=tr('武器'), millTx=tr('風車'), invTx=tr('方塊'), invTitle=tr('🎒 所有方塊：點一下放進下面選中的那一格'), tb=t=>`<button type="button" data-t="${t[0]}"><b>${t[1]}</b><small>${tr(t[2])}</small></button>`;
  ui.innerHTML='<div class="bw-tools">'+TOOLS.filter(t=>!WEAP.has(t[0])&&!MILL.has(t[0])).map(tb).join('')+
    `<button type="button" data-a="mill" class="weap mill"><b>🌀</b><small>${millTx}</small></button>`+
    `<button type="button" data-a="weap" class="weap"><b>⚔️</b><small>${weapTx}</small></button>`+
    `<button type="button" data-a="inv" class="weap inv"><b>🎒</b><small>${invTx}</small></button>`+
    `<button type="button" data-a="undo" class="act"><b>↩</b><small>${undoTx}</small></button><button type="button" data-a="reset" class="act"><b>🔄</b><small>${resetTx}</small></button></div>`+
    '<div class="bw-bar">'+HOTBAR.map((b,q)=>`<button type="button" data-s="${q}" title="${tr(BT[b][0])}"><i style="background-image:url(${iconURL(A.cv,b)})"></i><small>${q+1}</small></button>`).join('')+'</div>'+
    `<div class="bw-btns">${matchMedia('(pointer:coarse)').matches?'<button type="button" data-a="brk"></button>':''}<button type="button" data-a="float"></button><button type="button" data-a="fast"></button><button type="button" data-a="sneak"></button><button type="button" data-a="jump"></button></div>`+
    '<div class="bw-wmenu" data-m="weap" hidden>'+TOOLS.filter(t=>WEAP.has(t[0])).map(tb).join('')+'</div>'+
    '<div class="bw-wmenu" data-m="mill" hidden>'+TOOLS.filter(t=>MILL.has(t[0])).map(tb).join('')+'</div>'+
    `<div class="bw-inv" hidden><b>${invTitle}</b><div></div></div>`+
    `<div class="bw-cross" hidden></div><div class="bw-ring"></div><div class="bw-lockhint" hidden>${lockTx}</div>`;
  $('#v3d').appendChild(ui);
  const MENUS={weap:{set:WEAP,icon:'⚔️',tx:weapTx},mill:{set:MILL,icon:'🌀',tx:millTx}};
  for(const [key,m] of Object.entries(MENUS)){ m.btn=ui.querySelector(`[data-a=${key}]`); m.el=ui.querySelector(`[data-m=${key}]`); m.btn.addEventListener('click',()=>openMenu(m.el.hidden?key:null)); }
  const inv=ui.querySelector('.bw-inv'), bInv=ui.querySelector('[data-a=inv]');
  function openMenu(name){
    for(const [key,m] of Object.entries(MENUS)){ const open=key===name; m.el.hidden=!open; m.btn.classList.toggle('open',open); if(!open) continue;
      const b=m.btn.getBoundingClientRect(), t=ui.querySelector('.bw-tools').getBoundingClientRect(), w=m.el.offsetWidth;
      m.el.style.left=Math.max(8,Math.min(innerWidth-w-8,b.left+b.width/2-w/2))+'px'; m.el.style.bottom=(innerHeight-t.top+8)+'px'; }
    if(name) invOpen(false);
  }
  function invOpen(open){
    inv.hidden=!open; bInv.classList.toggle('open',open); if(!open) return; openMenu(null); unlock();
    const box=inv.querySelector('div'); box.innerHTML=INV.map(b=>`<button type="button" data-b="${b}" title="${tr(BT[b][0])}"><i style="background-image:url(${iconURL(A.cv,b)})"></i><small>${tr(BT[b][0])}</small></button>`).join('');
    box.querySelectorAll('button').forEach(e=>e.addEventListener('click',()=>{ const b=+e.dataset.b; HOTBAR[sel]=b; slots[sel].title=tr(BT[b][0]); slots[sel].querySelector('i').style.backgroundImage=`url(${iconURL(A.cv,b)})`;
      if(tool!=='hand'&&tool!=='wall') pickTool('hand'); invOpen(false); }));
  }
  bInv.addEventListener('click',()=>invOpen(inv.hidden));
  cv.addEventListener('pointerdown',()=>{ openMenu(null); invOpen(false); acx(); });
  const slots=[...ui.querySelectorAll('.bw-bar button')], tbtn=[...ui.querySelectorAll('[data-t]')], bJump=ui.querySelector('[data-a=jump]'), bSneak=ui.querySelector('[data-a=sneak]');
  const ring=ui.querySelector('.bw-ring'), cross=ui.querySelector('.bw-cross'), lockHint=ui.querySelector('.bw-lockhint');
  const showLock=()=>{ cross.hidden=!locked; lockHint.hidden=locked||noLock||!matchMedia('(pointer:fine)').matches; };
  function pickSlot(q){ sel=q; slots.forEach((s,i)=>s.classList.toggle('on',i===q)); }
  function pickTool(t){
    tool=t; tbtn.forEach(b=>b.classList.toggle('on',b.dataset.t===t)); showHeld(); openMenu(null);
    const w=TOOLS.find(x=>x[0]===t);
    for(const m of Object.values(MENUS)){ const isW=m.set.has(t); // 「武器」「風車」按鈕顯示目前拿的那一個
      m.btn.classList.toggle('on',isW); m.btn.querySelector('b').textContent=isW?w[1]:m.icon; m.btn.querySelector('small').textContent=isW?tr(w[2]):m.tx; }
    if(t==='bomb') ctx.toast(tr('炸彈模式：點一下放炸彈，1 秒後爆炸！炸錯了可以按「上一步」'),3000);
    if(t==='rocket') ctx.toast(tr('火箭筒：點哪裡就往哪裡發射，撞到方塊就爆炸！炸錯了可以按「上一步」'),3000);
    if(t==='blaster') ctx.toast(tr('方塊槍：點哪裡就射哪裡，可以打掉遠處的方塊'),2500);
    if(t==='laser') ctx.toast(tr('雷射槍：一道光束射過去，路上的方塊一次消失好幾格'),2500);
    if(t==='saber') ctx.toast(tr('光劍：點一下往前揮，前面的方塊都切掉'),2500);
    if(t==='ice') ctx.toast(tr('冰凍槍：射到的地方變成冰，水也會結冰，可以走在上面'),2500);
    if(t==='rainbow') ctx.toast(tr('彩虹槍：把方塊塗成彩虹顏色的羊毛'),2500);
    if(t==='tree') ctx.toast(tr('種樹：點地面種一棵樹'),2000);
    if(t==='meteor') ctx.toast(tr('隕石：點哪裡，天上就掉一顆隕石下來，炸出大洞！炸錯了可以按「上一步」'),3000);
    if(t==='mini') ctx.toast(tr('小風車：點地面種一支小風車'),2000);
    if(t==='mill') ctx.toast(tr('磨坊風車：點地面蓋一座小磨坊，帆會轉'),2000);
    if(t==='tornado') ctx.toast(tr('龍捲風：點地面放一個龍捲風，它會往前走，把方塊捲上天！炸錯了可以按「上一步」'),3000);
  }
  const showFly=()=>{ bJump.textContent=tr(pl.fly?'⤒ 上升':'⤒ 跳'); bSneak.textContent=tr(pl.fly?'⤓ 下降':'🧎 蹲下'); bSneak.classList.toggle('on',!pl.fly&&sneakT); bJump.classList.toggle('on',pl.fly); };
  function setFly(v,say){ pl.fly=v; pl.vy=0; sneakT=false; downT=false; showFly(); if(say) ctx.toast(tr(v?'🕊 飛起來了！跳往上、蹲下往下；再連按兩下跳就落地':'🚶 回到地上走路'),2200); }
  const twice=t=>{ const n=performance.now(), ok=n-t<300; return [ok,ok?0:n]; }; // 連按兩下
  const bFloat=ui.querySelector('[data-a=float]'), bFast=ui.querySelector('[data-a=fast]');
  const showOpt=()=>{ bFloat.textContent=tr(pl.floaty?'🛟 浮力 開':'🛟 浮力 關'); bFloat.classList.toggle('on',pl.floaty); bFast.textContent=tr(pl.fast?'⚡ 加速 開':'⚡ 加速'); bFast.classList.toggle('on',pl.fast); };
  const toggleFloat=()=>{ pl.floaty=!pl.floaty; showOpt(); ctx.toast(tr(pl.floaty?'浮力打開了：掉進水裡會自動浮起來':'浮力關掉了：在水裡會慢慢沉下去，按跳可以往上游'),2200); };
  const toggleFast=()=>{ pl.fast=!pl.fast; showOpt(); };
  bFloat.addEventListener('click',toggleFloat); bFast.addEventListener('click',toggleFast);
  const bMus=document.createElement('button'); bMus.type='button'; bMus.id='bwmus'; $('#v3bw').before(bMus);
  const showMus=()=>{ bMus.textContent=tr(mus.on?'🎵 音樂 開':'🎵 音樂 關'); bMus.classList.toggle('on',mus.on); }, toggleMus=()=>{ setMus(!mus.on); showMus(); };
  bMus.addEventListener('click',toggleMus);
  const bBrk=ui.querySelector('[data-a=brk]'), showBrk=()=>{ if(!bBrk) return; bBrk.textContent=tr(brk?'⛏ 拆方塊':'🧱 放方塊'); bBrk.classList.toggle('on',brk); };
  if(bBrk) bBrk.addEventListener('click',()=>{ brk=!brk; if(tool!=='hand') pickTool('hand'); showBrk();
    ctx.toast(tr(brk?'拆方塊模式：點一下就拆掉方塊（再按一次換回放方塊）':'放方塊模式：點一下放方塊，按住拆方塊'),2500); });
  slots.forEach((s,q)=>s.addEventListener('click',()=>{ pickSlot(q); if(tool!=='hand'&&tool!=='wall') pickTool('hand'); }));
  tbtn.forEach(b=>b.addEventListener('click',()=>pickTool(b.dataset.t)));
  ui.querySelector('[data-a=undo]').addEventListener('click',undo);
  ui.querySelector('[data-a=reset]').addEventListener('click',resetAll);
  bJump.addEventListener('pointerdown',e=>{ e.preventDefault(); jump=true; const [ok,t]=twice(tJump); tJump=t; if(ok) setFly(!pl.fly,true); });
  for(const ev of ['pointerup','pointerleave','pointercancel']) bJump.addEventListener(ev,()=>{ jump=false; });
  bSneak.addEventListener('pointerdown',e=>{ e.preventDefault(); if(pl.fly) downT=true; else{ sneakT=!sneakT; showFly(); } }); // 平板的蹲下是按一下切換，飛行時按住往下
  for(const ev of ['pointerup','pointerleave','pointercancel']) bSneak.addEventListener(ev,()=>{ downT=false; });
  pickSlot(0); pickTool('hand'); showFly(); showOpt(); showLock(); showMus(); showBrk();
  musOut(); enterChime(); if(mus.on) setMus(true); mus.timer=setInterval(musTick,250);
  loadKenney(A,()=>{ if(disposed) return; atlas.needsUpdate=true; for(const c of chunks) c.dirty=true; // 換成 Kenney 材質，所有方塊重畫（顏色平均值變了）
    slots.forEach((s,q)=>{ s.querySelector('i').style.backgroundImage=`url(${iconURL(A.cv,HOTBAR[q])})`; }); });
  ctx.toast(tr(matchMedia('(pointer:coarse)').matches?'方塊世界是照這裡的真實地圖做的！操作跟 Minecraft 一樣：搖桿走路、拖曳轉頭、點一下放方塊、按住拆方塊，連按兩下跳可以飛':'方塊世界是照這裡的真實地圖做的！操作跟 Minecraft 一樣：W A S D 走、Ctrl 跑、Shift 蹲、空白鍵跳（連按兩下飛）；左鍵拆、右鍵放、中鍵選方塊，E 打開所有方塊，Esc 叫出滑鼠'),7000);

  // ---------- 鍵盤（由 game3d.js 轉過來） ----------
  const MOVE=/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Space)$/;
  function key(e,down){
    const c=e.code;
    if(down&&!e.repeat&&c==='Space'){ const [ok,t]=twice(tSpace); tSpace=t; if(ok) setFly(!pl.fly,true); } // 連按兩下空白鍵：飛／落地
    if(down&&!e.repeat&&c==='KeyW'){ const [ok,t]=twice(tW); tW=t; if(ok) pl.sprint=true; }      // 連按兩下 W：跑步
    if(MOVE.test(c)){ if(down) keys.add(c); else keys.delete(c); return true; }
    if(!down) return false;
    if(c==='KeyZ'&&(e.ctrlKey||e.metaKey)){ undo(); return true; }
    if(c==='KeyE'){ invOpen(inv.hidden); return true; } // E：物品欄（所有方塊），跟正版一樣
    if(c==='KeyR'){ toggleFast(); return true; }
    if(c==='KeyB'){ toggleFloat(); return true; }
    if(c==='KeyM'){ toggleMus(); return true; }
    const m=/^Digit([1-9])$/.exec(c); if(m){ pickSlot(+m[1]-1); return true; }
    return c==='Escape'; // 方塊世界裡 Esc 不離開（避免不小心關掉），按上面的按鈕回去
  }
  const onBlur=()=>keys.clear(); window.addEventListener('blur',onBlur);

  // ---------- 每一幀 ----------
  let spin=0;
  function step(dt){
    move(dt);
    for(let q=fuses.length-1;q>=0;q--){ const f=fuses[q]; f.t-=dt; f.m.visible=Math.floor(f.t*8)%2===0; if(f.t<=0){ scene.remove(f.m); f.m.geometry.dispose(); fuses.splice(q,1); explode(f); } }
    // 每幀最多重做 6 塊，拆很快也不會卡
    let n=0; for(let q=0;q<chunks.length&&n<6;q++) if(chunks[q].dirty){ meshChunk(q%NC,Math.floor(q/NC)); n++; }
    stepHold(dt); stepFalls(dt); stepProjs(dt); stepHeld(dt); stepTornados(dt);
    for(let q=parts.length-1;q>=0;q--){ const p=parts[q]; p.t+=dt;
      if(p.beam){ p.m.material.opacity=Math.max(0,0.95-p.t*4); p.m.scale.x=p.m.scale.y=1+p.t*3; if(p.t>0.25){ scene.remove(p.m); p.m.material.dispose(); parts.splice(q,1); } continue; }
      if(p.swirl){ p.a+=dt*7; p.r+=dt*0.8; p.m.position.set(p.cx+Math.cos(p.a)*p.r,p.m.position.y+dt*9,p.cz+Math.sin(p.a)*p.r); p.m.rotation.y+=dt*8; if(p.t>1.4){ scene.remove(p.m); parts.splice(q,1); } continue; }
      if(p.puff){ p.m.scale.setScalar(1+p.t*3); p.m.position.y+=dt*0.8; if(p.t>0.6){ scene.remove(p.m); parts.splice(q,1); } continue; }
      if(p.ball){ p.m.scale.setScalar(1+p.t*14); p.m.material.opacity=Math.max(0,0.9-p.t*2.4); }
      else{ p.v[1]-=20*dt; p.m.position.x+=p.v[0]*dt; p.m.position.y+=p.v[1]*dt; p.m.position.z+=p.v[2]*dt; p.m.rotation.x+=dt*6; }
      if(p.t>1.1){ scene.remove(p.m); if(p.ball){ p.m.geometry.dispose(); p.m.material.dispose(); } parts.splice(q,1); } }
    spin+=(G.spin||1.2)*dt;
    for(const t of turbs) if(t.ok) t.ro.m.rotation.z=-spin*t.k;
    const cp=Math.cos(pl.pitch); let sx=0, sy=0; if(shake>0){ shake-=dt; sx=(Math.random()-0.5)*shake; sy=(Math.random()-0.5)*shake; }
    cam.position.set(pl.x+sx,pl.eye+sy,pl.z);
    cam.lookAt(pl.x+sx+Math.sin(pl.yaw)*cp,pl.eye+sy+Math.sin(pl.pitch),pl.z-Math.cos(pl.yaw)*cp);
    R3.render(scene,cam);
  }
  function resize(w,h){ cam.aspect=w/h; cam.updateProjectionMatrix(); }
  function dispose(){
    disposed=true;
    cv.removeEventListener('pointerdown',onDown); cv.removeEventListener('pointermove',onMove); cv.removeEventListener('pointerup',onUp); cv.removeEventListener('pointercancel',onCancel);
    cv.removeEventListener('wheel',onWheel); cv.removeEventListener('contextmenu',noMenu); window.removeEventListener('blur',onBlur);
    unlock(); window.removeEventListener('beforeunload',onLeave); document.removeEventListener('pointerlockchange',onLock); document.removeEventListener('pointerlockerror',onLockErr);
    ui.remove(); bMus.remove();
    scene.traverse(m=>{ if(m.geometry) m.geometry.dispose(); });
    atlas.dispose(); opMat.dispose(); waMat.dispose(); rotorMat.dispose(); for(const m of back) m.material.dispose();
    pmatA.dispose(); pmatB.dispose(); pmatW.dispose(); fuseMat.dispose(); pbox.dispose(); heldMat.dispose();
    for(const x of [pelletGeo,pelletMat,rocketGeo,rocketMat,flameGeo,flameMat,puffGeo,puffMat,beamGeo,twMat,meteorGeo,meteorMat,fireMat]) x.dispose(); clearInterval(mus.timer); try{ AC&&AC.close(); }catch(e){}
  }
  { const r=cv.getBoundingClientRect(); resize(r.width||innerWidth,r.height||innerHeight); }
  return {step,resize,key,dispose,_:{mus,falls,checkFalls,vox,colTop,N,H,X0,Y0,Z0,pl,get,act,ray,cam,keyDown:c=>key({code:c,repeat:false},true),keyUp:c=>key({code:c},false),pickBlock,HOTBAR,tool:()=>tool,undo,resetAll,pickTool,turbs,hist:()=>hist}}; // _ 方便除錯
}

window.BlockWorld={create};
})();
