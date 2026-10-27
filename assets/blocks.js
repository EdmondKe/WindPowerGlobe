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
const TILES=['grassTop','grassSide','dirt','stone','sand','water','asphalt','paint','concrete','wall','window','roof','logTop','logSide','leaves','metal','plank','brick','glass','bomb','bombTop'];
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
];
const BOMB=18, AIR=0, GRASS=1, DIRT=2, STONE=3, SAND=4, WATER=5, ASPHALT=6, PAINT=7, CONCRETE=8, WALL=9, WINDOW=10, ROOF=11, LOG=12, LEAVES=13, METAL=14, PLANK=15;
const HOTBAR=[1,2,3,15,16,17,9,13,14];
const SEE=new Uint8Array(BT.length); BT.forEach((b,i)=>{ if(b&&b[4]) SEE[i]=1; });
const FT=[[],[],[]]; BT.forEach((b,i)=>{ if(b){ FT[0][i]=TI[b[1]]; FT[1][i]=TI[b[2]]; FT[2][i]=TI[b[3]]; } }); // 上、側、下 用哪一格材質

// 材質圖：8×4 格，每格 16×16 像素，全部用程式畫
function drawAtlas(){
  const W=128, H=64, im=new ImageData(W,H), d=im.data, R=mulberry32(20261027), avg=[];
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
const KENNEY=['grassTop','grassSide','dirt','stone','sand','water','concrete','logTop','logSide','leaves','plank','brick','glass'];
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
  function rotor(L){ // 三支一階一階的葉片，在 xy 平面，繞 z 轉
    const P=[], Cc=[], W=[0.93,0.94,0.95];
    for(let bl=0;bl<3;bl++){ const a=bl*Math.PI*2/3;
      for(let s=1;s<L;s++){ const wd=s<L*0.3?1.5:s<L*0.7?1:0.5; addBox(P,Cc,-wd,s,-0.3,wd,s+1,0.3,a,W); } }
    addBox(P,Cc,-1.2,-1.2,-0.8,1.2,1.2,1.2,0,[0.85,0.87,0.9]);
    const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(P,3)); g.setAttribute('color',new T.Float32BufferAttribute(Cc,3));
    const grp=new T.Group(), m=new T.Mesh(g,rotorMat); grp.add(m); return {grp,m};
  }
  function sails(L){ // 傳統風車：四支木頭格子框＋米白色帆布
    const P=[], Cc=[], wood=[0.55,0.38,0.22], cloth=[0.93,0.9,0.8];
    for(let bl=0;bl<4;bl++){ const a=bl*Math.PI/2;
      addBox(P,Cc,-0.3,0,-0.3,0.3,L,0.3,a,wood);
      addBox(P,Cc,0.3,L*0.2,-0.05,2.8,L,0.05,a,cloth);
      for(let s=L*0.2;s<=L+0.01;s+=1.5) addBox(P,Cc,0.3,s,-0.25,3,s+0.25,0.25,a,wood);
      addBox(P,Cc,2.8,L*0.2,-0.25,3.1,L,0.25,a,wood); }
    addBox(P,Cc,-0.8,-0.8,-0.6,0.8,0.8,0.8,0,wood);
    const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(P,3)); g.setAttribute('color',new T.Float32BufferAttribute(Cc,3));
    const grp=new T.Group(), m=new T.Mesh(g,rotorMat); grp.add(m); return {grp,m};
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
        scene.add(ro.grp); turbs.push({ro,nac,hub:I(...hub),k:0.35,ok:true,x:p.x,z:p.z}); continue;
      }
      for(let dk=-3;dk<=3;dk++) for(let di=-3;di<=3;di++) if(di*di+dk*dk<=12) set(i+di,g,k+dk,CONCRETE);
      for(let y=1;y<=hh;y++){ const r=2.4-0.9*y/hh; for(let dk=-3;dk<=3;dk++) for(let di=-3;di<=3;di++) if(di*di+dk*dk<=r*r) set(i+di,g+y,k+dk,METAL); }
      const cell=(u,v,y)=>[i+F[0]*u-F[1]*v,g+y,k+F[1]*u+F[0]*v];
      for(let u=-4;u<=4;u++) for(let v=-1;v<=1;v++) for(let y=hh-1;y<=hh+1;y++){ const q=cell(u,v,y); set(...q,METAL); nac.add(I(...q)); }
      const hub=cell(5,0,hh); set(...hub,METAL); nac.add(I(...hub));
      const ro=rotor(L); ro.grp.position.set(X0+hub[0]+0.5+F[0]*0.8,Y0+hub[1]+0.5,Z0+hub[2]+0.5+F[1]*0.8); ro.grp.rotation.y=Math.atan2(F[0],F[1]);
      scene.add(ro.grp); turbs.push({ro,nac,hub:I(...hub),k:0.8+R()*0.4,ok:true,x:p.x,z:p.z});
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
          const L=b===WATER?1:0, t=FT[f.t][b], u0=(t%8)/8+UVE, u1=(t%8+1)/8-UVE, vt=1-(t>>3)/4-UVE, vb=1-((t>>3)+1)/4+UVE;
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
  const pl={x:sv.x0,z:sv.z0,y:0,vy:0,ground:false,fly:false,floaty:true,fast:false,wet:false,yaw:sv.yaw,pitch:Math.min(0.3,sv.pitch),eye:0};
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
  const keys=new Set(); let jump=false, sel=0;
  function tryMove(nx,nz){
    if(!hit(nx,pl.y,nz)){ pl.x=nx; pl.z=nz; return; }
    if((pl.ground||pl.wet)&&!pl.fly){ const up=Y0+Math.floor(pl.y-Y0+0.001)+1; if(up-pl.y<=(pl.wet?1.45:1.05)&&!hit(nx,up,nz)&&!hit(pl.x,up,pl.z)){ pl.y=up; pl.x=nx; pl.z=nz; } } // 一格高的台階自動走上去
  }
  function move(dt){
    const has=k=>keys.has(k);
    let f=(has('KeyW')||has('ArrowUp')?1:0)-(has('KeyS')||has('ArrowDown')?1:0), s=(has('KeyD')?1:0)-(has('KeyA')?1:0);
    pl.yaw+=((has('ArrowRight')?1:0)-(has('ArrowLeft')?1:0))*1.8*dt;
    const run=has('ShiftLeft')||has('ShiftRight'), ix=Math.floor(pl.x-X0), kz=Math.floor(pl.z-Z0);
    const wet=pl.wet=get(ix,Math.floor(pl.y+0.4-Y0),kz)===WATER;
    let spd=pl.fly?11:run?7:4.3; if(wet&&!pl.fly) spd*=pl.floaty?0.85:0.6;
    if(G.joy){ f=-G.joy.y; s=G.joy.x; if(Math.hypot(f,s)>0.92&&!pl.fly) spd=7; }
    if(pl.fast) spd*=2; // ⚡ 加速：走路、跑步、游泳、飛行都快一倍
    const n=Math.hypot(f,s); if(n>1){ f/=n; s/=n; }
    if(n>0.08){ const fx=Math.sin(pl.yaw), fz=-Math.cos(pl.yaw), d=spd*dt;
      const dx=(fx*f+Math.cos(pl.yaw)*s)*d, dz=(fz*f+Math.sin(pl.yaw)*s)*d;
      tryMove(pl.x+dx,pl.z); tryMove(pl.x,pl.z+dz); }
    const up=jump||has('Space');
    if(pl.fly) pl.vy=((up?1:0)-(run?1:0))*8*(pl.fast?2:1);
    else if(wet&&pl.floaty){ // 🛟 浮力：像穿救生衣，自動浮到水面、頭露出來，輕輕上下晃；按跳可以跳上岸
      let w=Math.floor(pl.y+0.4-Y0); while(get(ix,w+1,kz)===WATER) w++;
      const surf=Y0+w+1-0.45+Math.sin(performance.now()/450)*0.06;
      pl.vy+=((surf-pl.y)*5-pl.vy)*Math.min(1,dt*6);
      if(up&&pl.y>surf-0.35) pl.vy=6.5; }
    else{ pl.vy-=(wet?9:26)*dt; if(wet) pl.vy=Math.max(pl.vy,-3);
      if(up&&(pl.ground||wet)) pl.vy=wet?3.5:8.2; }
    const ny=pl.y+pl.vy*dt;
    if(hit(pl.x,ny,pl.z)){
      if(pl.vy<0){ const land=Y0+Math.floor(ny-Y0)+1; if(!hit(pl.x,land,pl.z)) pl.y=land; pl.ground=true; }
      pl.vy=0;
    }else{ pl.y=ny; pl.ground=false; }
    pl.eye+=(pl.y+1.62-pl.eye)*Math.min(1,dt*18);
  }

  // ---------- 指到哪一格（從鏡頭沿著視線一格一格走） ----------
  const V=new T.Vector3();
  function ray(sx,sy){
    const r=cv.getBoundingClientRect(); V.set((sx-r.left)/r.width*2-1,-(sy-r.top)/r.height*2+1,0.5).unproject(cam).sub(cam.position).normalize();
    let x=cam.position.x-X0, y=cam.position.y-Y0, z=cam.position.z-Z0, i=Math.floor(x), j=Math.floor(y), k=Math.floor(z);
    const dx=V.x, dy=V.y, dz=V.z, si=Math.sign(dx), sj=Math.sign(dy), sk=Math.sign(dz);
    const tdx=Math.abs(1/dx), tdy=Math.abs(1/dy), tdz=Math.abs(1/dz);
    let tx=dx?((si>0?i+1-x:x-i)*tdx):Infinity, tyy=dy?((sj>0?j+1-y:y-j)*tdy):Infinity, tz=dz?((sk>0?k+1-z:z-k)*tdz):Infinity, t=0, p=null;
    while(t<=10){
      const b=get(i,j,k); if(b&&b!==WATER&&i>=0&&k>=0&&i<N&&k<N) return {i,j,k,p};
      p=[i,j,k];
      if(tx<tyy&&tx<tz){ i+=si; t=tx; tx+=tdx; } else if(tyy<tz){ j+=sj; t=tyy; tyy+=tdy; } else { k+=sk; t=tz; tz+=tdz; }
    }
    return null;
  }
  // ---------- 工具：拆、大拆除、放、大安裝、種風機、炸彈；每一次動作可以「上一步」，也可以一鍵全部復原 ----------
  const orig=vox.slice(), origTop=colTop.slice(); // 剛蓋好的樣子（一鍵復原用）
  // 道具都只會影響方塊（沒有人物、動物），火箭筒和炸彈要輸入驗證碼才能用
  const TOOLS=[['break','⛏','拆'],['hammer','🔨','大槌子'],['place','🧱','放'],['wall','🏗','大安裝'],['turbine','🌀','種風機'],['blaster','🔫','方塊槍'],['laser','🔦','雷射槍'],['saber','⚔️','光劍'],['bomb','💣','炸彈'],['rocket','🚀','火箭筒'],['tornado','🌪','龍捲風']];
  const LOCKED=new Set(['bomb','rocket','tornado']);
  let tool='break', bombOK=false, hist=[], grp=null;
  const fuses=[], parts=[]; let shake=0;
  function edit(i,y,k,b){
    if(i<0||k<0||i>=N||k>=N||y<1||y>=H) return false;
    const id=I(i,y,k), o=vox[id]; if(o===b) return false;
    if(grp) grp.c.push(id,o);
    vox[id]=b; const c=k*N+i; if(b&&y>colTop[c]) colTop[c]=y; dirty(i,k); return true;
  }
  const begin=()=>{ grp={c:[],ro:[]}; return grp; };
  const commit=()=>{ if(grp&&(grp.c.length||grp.ro.length)){ hist.push(grp); if(hist.length>60) hist.shift(); } grp=null; };
  // 風機還完整嗎（機艙、輪轂都在才轉；輪轂不見就把葉片拿掉）
  function refreshTurbs(say){
    let stopped=false;
    for(const t of turbs){ if(!t.nac) continue; let ok=true; for(const id of t.nac) if(vox[id]===AIR){ ok=false; break; }
      if(t.ok&&!ok) stopped=true; t.ok=ok; t.ro.grp.visible=vox[t.hub]!==AIR; }
    if(stopped&&say) ctx.toast(tr('風機的機艙被拆掉了，葉片停下來了！'),2500);
  }
  const onMe=(i,y,k)=>{ const bx=X0+i, by=Y0+y, bz=Z0+k; return bx<pl.x+0.3&&bx+1>pl.x-0.3&&bz<pl.z+0.3&&bz+1>pl.z-0.3&&by<pl.y+1.8&&by+1>pl.y; };
  const free=(i,y,k)=>{ const b=get(i,y,k); return (b===AIR||b===WATER)&&i>=0&&k>=0&&i<N&&k<N&&y>=1&&y<H-1&&!onMe(i,y,k); };
  // 小音效（Web Audio 合成，不用音檔）
  let AC=null;
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
    const t={ro,nac,hub:I(...hub),k:1.1,ok:true,mine:true}; turbs.push(t); grp.ro.push(t);
    ctx.toast(tr('種好一支風機了！它會跟著風轉'),2200); return true;
  }
  const pbox=new T.BoxGeometry(0.35,0.35,0.35), pmatA=new T.MeshBasicMaterial({color:0x8a8070}), pmatB=new T.MeshBasicMaterial({color:0xff7a2a});
  const fuseMat=new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.6,depthWrite:false});
  // 炸彈：放下去 1.2 秒後爆炸，半徑 3.5 格的方塊都炸掉（水和最底層不會）；算在放炸彈那一步裡，「上一步」可以一起復原
  function explode(f){
    const keep=grp; grp=f.g; edit(f.i,f.j,f.k,AIR);
    const r=3.5; for(let y=-4;y<=4;y++) for(let dk=-4;dk<=4;dk++) for(let di=-4;di<=4;di++){ if(di*di+dk*dk+y*y>r*r) continue;
      const b=get(f.i+di,f.j+y,f.k+dk); if(b&&b!==WATER) edit(f.i+di,f.j+y,f.k+dk,AIR); }
    grp=keep; refreshTurbs(true); sfx('boom'); shake=0.5;
    const wx=X0+f.i+0.5, wy=Y0+f.j+0.5, wz=Z0+f.k+0.5;
    if(Math.hypot(pl.x-wx,pl.y+0.9-wy,pl.z-wz)<6){ pl.vy=7; pl.ground=false; } // 被震得跳起來
    const ball=new T.Mesh(new T.SphereGeometry(1,16,12),new T.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:0.9,depthWrite:false})); ball.position.set(wx,wy,wz); scene.add(ball);
    parts.push({m:ball,t:0,ball:true});
    for(let q=0;q<36;q++){ const m=new T.Mesh(pbox,q%3?pmatA:pmatB); m.position.set(wx,wy,wz); scene.add(m);
      parts.push({m,t:0,v:[(Math.random()-0.5)*14,Math.random()*12+3,(Math.random()-0.5)*14]}); }
  }
  function act(sx,sy,place){
    if(!place&&(tool==='blaster'||tool==='rocket')){ fire(sx,sy); return; }
    if(!place&&tool==='laser'){ laser(sx,sy); return; }
    if(!place&&tool==='saber'){ slashSaber(); return; }
    if(!place&&tool==='tornado'){ const h=ray(sx,sy); if(h) spawnTornado(h); return; }
    const h=ray(sx,sy); if(!h){ if(tool==='hammer') swing=1; return; }
    const tl=place?'place':tool, p=h.p, ok=p&&free(...p);
    begin();
    if(tl==='break'){ if(h.j>0&&edit(h.i,h.j,h.k,AIR)) sfx('break'); }
    else if(tl==='hammer'){ swing=1; for(let y=-1;y<=1;y++) for(let dk=-1;dk<=1;dk++) for(let di=-1;di<=1;di++){ const b=get(h.i+di,h.j+y,h.k+dk); if(b&&b!==WATER) edit(h.i+di,h.j+y,h.k+dk,AIR); } sfx('break'); }
    else if(tl==='place'){ if(ok&&edit(...p,HOTBAR[sel])) sfx('place'); }
    else if(tl==='wall'&&p){ // 在點到的那一面上鋪 3×3
      const n=[p[0]-h.i,p[1]-h.j,p[2]-h.k], u=n[1]?[1,0,0]:[0,1,0], v=n[2]?[1,0,0]:[0,0,1];
      for(let a=-1;a<=1;a++) for(let b=-1;b<=1;b++){ const q=[p[0]+u[0]*a+v[0]*b,p[1]+u[1]*a+v[1]*b,p[2]+u[2]*a+v[2]*b]; if(free(...q)) edit(...q,HOTBAR[sel]); }
      sfx('place'); }
    else if(tl==='turbine'&&ok){ if(!plantTurbine(p)) ctx.toast(tr('這裡太擠了，換個空曠的地方種風機'),2000); else sfx('place'); }
    else if(tl==='bomb'&&ok){ edit(...p,BOMB); sfx('place');
      const m=new T.Mesh(new T.BoxGeometry(1.06,1.06,1.06),fuseMat); m.position.set(X0+p[0]+0.5,Y0+p[1]+0.5,Z0+p[2]+0.5); scene.add(m);
      fuses.push({i:p[0],j:p[1],k:p[2],t:1.2,m,g:grp}); }
    const g=grp; commit(); if(g.c.length) refreshTurbs(true);
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
  const pushHist=g=>{ if(g.c.length||g.ro.length){ hist.push(g); if(hist.length>60) hist.shift(); } };
  function stepProjs(dt){
    for(let q=projs.length-1;q>=0;q--){
      const s=projs[q]; let dist=s.v*dt, hc=null, gone=false;
      while(dist>0&&!hc&&!gone){ const st=Math.min(0.4,dist); dist-=st; s.left-=st; s.p.addScaledVector(s.d,st);
        const i=Math.floor(s.p.x-X0), j=Math.floor(s.p.y-Y0), k=Math.floor(s.p.z-Z0);
        if(i<0||k<0||i>=N||k>=N||j>=H||s.left<=0){ gone=true; break; }
        const b=get(i,j,k); if(b&&b!==WATER) hc=[i,j,k]; }
      s.m.position.copy(s.p);
      if(s.rk&&(s.puff-=dt)<=0&&s.p.distanceTo(cam.position)>7){ // 尾煙離鏡頭 7 公尺以上才畫，不會擋住畫面
        s.puff=0.035; const m=new T.Mesh(puffGeo,puffMat); m.position.copy(s.p).addScaledVector(s.d,-0.6); scene.add(m); parts.push({m,t:0,puff:true}); }
      if(!hc&&!gone) continue;
      scene.remove(s.m); projs.splice(q,1);
      if(!hc) continue;
      if(s.rk){ const g={c:[],ro:[]}; explode({i:hc[0],j:hc[1],k:hc[2],g}); pushHist(g); }
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
    for(let t=0;t<40&&n<12;t+=0.25){ p.copy(o).addScaledVector(d,t); const i=Math.floor(p.x-X0), j=Math.floor(p.y-Y0), k=Math.floor(p.z-Z0);
      if(i<0||k<0||i>=N||k>=N||j<1||j>=H){ len=t; break; }
      const b=get(i,j,k); if(b&&b!==WATER&&edit(i,j,k,AIR)){ n++; len=t; } }
    grp=keep; pushHist(g); if(n) refreshTurbs(true);
    const from=o.clone().addScaledVector(d,0.6); from.y-=0.12; const to=o.clone().addScaledVector(d,Math.max(len,2)), L=from.distanceTo(to);
    const m=new T.Mesh(beamGeo,new T.MeshBasicMaterial({color:0xff2f6e,transparent:true,opacity:0.95,depthWrite:false}));
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
    grp=keep; pushHist(g); if(g.c.length) refreshTurbs(true);
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
        grp=keep; if(n) refreshTurbs(true); }
      if(w.t<=0||i<0||k<0||i>=N||k>=N){ scene.remove(w.m); w.m.children.forEach(c=>c.geometry.dispose()); tornados.splice(q,1); }
    }
  }
  function undo(){
    const g=hist.pop(); if(!g){ ctx.toast(tr('沒有可以復原的動作了'),1500); return; }
    for(let q=tornados.length-1;q>=0;q--) if(tornados[q].g===g){ scene.remove(tornados[q].m); tornados[q].m.children.forEach(c=>c.geometry.dispose()); tornados.splice(q,1); }
    for(let q=fuses.length-1;q>=0;q--) if(fuses[q].g===g){ scene.remove(fuses[q].m); fuses[q].m.geometry.dispose(); fuses.splice(q,1); } // 還沒爆的炸彈也拿掉
    for(let q=g.c.length-2;q>=0;q-=2){ const id=g.c[q]; vox[id]=g.c[q+1]; const i=id%N, k=Math.floor(id/N)%N, y=Math.floor(id/(N*N)); if(vox[id]&&y>colTop[k*N+i]) colTop[k*N+i]=y; dirty(i,k); }
    for(const t of g.ro){ scene.remove(t.ro.grp); t.ro.m.geometry.dispose(); turbs.splice(turbs.indexOf(t),1); }
    refreshTurbs(false); unstick();
  }
  let resetAsk=0;
  function resetAll(){
    if(performance.now()-resetAsk>3000){ resetAsk=performance.now(); ctx.toast(tr('再按一次「全部復原」，就會回到一開始的樣子'),3000); return; }
    resetAsk=0; vox.set(orig); colTop.set(origTop); hist=[];
    for(const f of fuses){ scene.remove(f.m); f.m.geometry.dispose(); } fuses.length=0;
    for(const w of tornados){ scene.remove(w.m); w.m.children.forEach(c=>c.geometry.dispose()); } tornados.length=0;
    for(let q=turbs.length-1;q>=0;q--) if(turbs[q].mine){ scene.remove(turbs[q].ro.grp); turbs[q].ro.m.geometry.dispose(); turbs.splice(q,1); }
    for(let ck=0;ck<NC;ck++) for(let ci=0;ci<NC;ci++) meshChunk(ci,ck);
    refreshTurbs(false); unstick(); ctx.toast(tr('全部復原了！'),2000);
  }
  function unstick(){ while(hit(pl.x,pl.y,pl.z)&&pl.y<Y0+H) pl.y+=1; } // 復原後被方塊卡住：往上移

  // ---------- 操作：拖曳轉頭、點一下用目前的工具（右鍵一定是放一格）、滾輪換方塊 ----------
  let pd=null;
  const onDown=e=>{ if(e.pointerType==='mouse'&&e.button===2){ act(e.clientX,e.clientY,true); return; }
    if(pd) return; pd={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:pl.yaw,pitch:pl.pitch,moved:false}; try{ cv.setPointerCapture(e.pointerId); }catch(err){} };
  const onMove=e=>{
    if(pd&&e.pointerId===pd.id){ const dx=e.clientX-pd.x, dy=e.clientY-pd.y; if(Math.hypot(dx,dy)>6) pd.moved=true;
      if(pd.moved){ pl.yaw=pd.yaw-dx*0.005; pl.pitch=Math.max(-1.45,Math.min(1.45,pd.pitch+dy*0.005)); } return; }
    if(e.pointerType==='mouse'){ const h=ray(e.clientX,e.clientY); hl.visible=!!h; if(h) hl.position.set(X0+h.i+0.5,Y0+h.j+0.5,Z0+h.k+0.5); }
  };
  const onUp=e=>{ if(!pd||e.pointerId!==pd.id) return; const tap=!pd.moved; pd=null; if(tap) act(e.clientX,e.clientY,false); };
  const onCancel=e=>{ if(pd&&e.pointerId===pd.id) pd=null; };
  const onWheel=e=>{ e.preventDefault(); pickSlot((sel+(e.deltaY>0?1:-1)+HOTBAR.length)%HOTBAR.length); };
  const noMenu=e=>e.preventDefault();
  cv.addEventListener('pointerdown',onDown); cv.addEventListener('pointermove',onMove); cv.addEventListener('pointerup',onUp); cv.addEventListener('pointercancel',onCancel);
  cv.addEventListener('wheel',onWheel,{passive:false}); cv.addEventListener('contextmenu',noMenu);

  // ---------- 畫面上的按鈕：下面一排方塊、上面一排工具、右邊跳和飛 ----------
  const ui=document.createElement('div'), jumpTx=tr('⤒ 跳'), undoTx=tr('上一步'), resetTx=tr('全部復原'); ui.id='bwui';
  // 武器（大槌子、方塊槍、炸彈、火箭筒）收在一個「武器」按鈕裡，按了在上面跳出選單切換
  const WEAP=new Set(['hammer','blaster','laser','saber','bomb','rocket','tornado']), weapTx=tr('武器'), tb=t=>`<button type="button" data-t="${t[0]}"><b>${t[1]}</b><small>${tr(t[2])}</small>${LOCKED.has(t[0])?'<i class="lock">🔒</i>':''}</button>`;
  ui.innerHTML='<div class="bw-tools">'+TOOLS.filter(t=>!WEAP.has(t[0])).map(tb).join('')+
    `<button type="button" data-a="weap" class="weap"><b>⚔️</b><small>${weapTx}</small></button>`+
    `<button type="button" data-a="undo" class="act"><b>↩</b><small>${undoTx}</small></button><button type="button" data-a="reset" class="act"><b>🔄</b><small>${resetTx}</small></button></div>`+
    '<div class="bw-bar">'+HOTBAR.map((b,q)=>`<button type="button" data-s="${q}" title="${tr(BT[b][0])}"><i style="background-image:url(${iconURL(A.cv,b)})"></i><small>${q+1}</small></button>`).join('')+'</div>'+
    `<div class="bw-btns"><button type="button" data-a="jump">${jumpTx}</button><button type="button" data-a="fly"></button><button type="button" data-a="float"></button><button type="button" data-a="fast"></button></div>`+
    '<div class="bw-wmenu" hidden>'+TOOLS.filter(t=>WEAP.has(t[0])).map(tb).join('')+'</div>';
  $('#v3d').appendChild(ui);
  const bWeap=ui.querySelector('[data-a=weap]'), wmenu=ui.querySelector('.bw-wmenu');
  function weapMenu(open){
    wmenu.hidden=!open; bWeap.classList.toggle('open',open); if(!open) return;
    const b=bWeap.getBoundingClientRect(), t=ui.querySelector('.bw-tools').getBoundingClientRect(), w=wmenu.offsetWidth;
    wmenu.style.left=Math.max(8,Math.min(innerWidth-w-8,b.left+b.width/2-w/2))+'px'; wmenu.style.bottom=(innerHeight-t.top+8)+'px';
  }
  bWeap.addEventListener('click',()=>weapMenu(wmenu.hidden));
  cv.addEventListener('pointerdown',()=>weapMenu(false));
  const slots=[...ui.querySelectorAll('.bw-bar button')], tbtn=[...ui.querySelectorAll('[data-t]')], bJump=ui.querySelector('[data-a=jump]'), bFly=ui.querySelector('[data-a=fly]');
  function pickSlot(q){ sel=q; slots.forEach((s,i)=>s.classList.toggle('on',i===q)); }
  function pickTool(t){
    if(LOCKED.has(t)&&!bombOK){ weapMenu(false); gate(t); return; }
    tool=t; tbtn.forEach(b=>b.classList.toggle('on',b.dataset.t===t)); showHeld(); weapMenu(false);
    const w=TOOLS.find(x=>x[0]===t), isW=WEAP.has(t); // 「武器」按鈕顯示目前拿的武器
    bWeap.classList.toggle('on',isW); bWeap.querySelector('b').textContent=isW?w[1]:'⚔️'; bWeap.querySelector('small').textContent=isW?tr(w[2]):weapTx;
    ui.querySelectorAll('.bw-wmenu .lock').forEach(l=>{ l.hidden=bombOK; });
    if(t==='bomb') ctx.toast(tr('炸彈模式：點一下放炸彈，1 秒後爆炸！炸錯了可以按「上一步」'),3000);
    if(t==='rocket') ctx.toast(tr('火箭筒：點哪裡就往哪裡發射，撞到方塊就爆炸！炸錯了可以按「上一步」'),3000);
    if(t==='blaster') ctx.toast(tr('方塊槍：點哪裡就射哪裡，可以打掉遠處的方塊'),2500);
    if(t==='laser') ctx.toast(tr('雷射槍：一道光束射過去，路上的方塊一次消失好幾格'),2500);
    if(t==='saber') ctx.toast(tr('光劍：點一下往前揮，前面的方塊都切掉'),2500);
    if(t==='tornado') ctx.toast(tr('龍捲風：點地面放一個龍捲風，它會往前走，把方塊捲上天！炸錯了可以按「上一步」'),3000);
  }
  const showFly=()=>{ bFly.textContent=tr(pl.fly?'🚶 走路':'🕊 飛'); bFly.classList.toggle('on',pl.fly); };
  const bFloat=ui.querySelector('[data-a=float]'), bFast=ui.querySelector('[data-a=fast]');
  const showOpt=()=>{ bFloat.textContent=tr(pl.floaty?'🛟 浮力 開':'🛟 浮力 關'); bFloat.classList.toggle('on',pl.floaty); bFast.textContent=tr(pl.fast?'⚡ 加速 開':'⚡ 加速'); bFast.classList.toggle('on',pl.fast); };
  const toggleFloat=()=>{ pl.floaty=!pl.floaty; showOpt(); ctx.toast(tr(pl.floaty?'浮力打開了：掉進水裡會自動浮起來':'浮力關掉了：在水裡會慢慢沉下去，按跳可以往上游'),2200); };
  const toggleFast=()=>{ pl.fast=!pl.fast; showOpt(); };
  bFloat.addEventListener('click',toggleFloat); bFast.addEventListener('click',toggleFast);
  slots.forEach((s,q)=>s.addEventListener('click',()=>{ pickSlot(q); if(tool!=='place'&&tool!=='wall') pickTool('place'); }));
  tbtn.forEach(b=>b.addEventListener('click',()=>pickTool(b.dataset.t)));
  ui.querySelector('[data-a=undo]').addEventListener('click',undo);
  ui.querySelector('[data-a=reset]').addEventListener('click',resetAll);
  bFly.addEventListener('click',()=>{ pl.fly=!pl.fly; pl.vy=0; showFly(); });
  bJump.addEventListener('pointerdown',e=>{ e.preventDefault(); jump=true; });
  for(const ev of ['pointerup','pointerleave','pointercancel']) bJump.addEventListener(ev,()=>{ jump=false; });
  pickSlot(0); pickTool('break'); showFly(); showOpt();
  loadKenney(A,()=>{ if(disposed) return; atlas.needsUpdate=true; for(const c of chunks) c.dirty=true; // 換成 Kenney 材質，所有方塊重畫（顏色平均值變了）
    slots.forEach((s,q)=>{ s.querySelector('i').style.backgroundImage=`url(${iconURL(A.cv,HOTBAR[q])})`; }); });
  ctx.toast(tr(matchMedia('(pointer:coarse)').matches?'方塊世界是照這裡的真實地圖做的！搖桿走路、拖曳畫面轉頭；上面一排選工具，點一下就能拆、放、種風機':'方塊世界是照這裡的真實地圖做的！W A S D 走路、空白鍵跳、F 飛；上面一排選工具再點一下，右鍵放方塊，Ctrl+Z 上一步'),6000);

  // 炸彈模式的門檻：要輸入畫面上的驗證碼（英文＋數字），小小孩亂按不會打開
  function gate(next){
    if(ui.querySelector('.bw-gate')) return;
    const CH='ABCDEFGHJKLMNPQRSTUVWXYZ', DG='23456789'; let code;
    do{ code=''; for(let q=0;q<5;q++){ const s=Math.random()<0.5?CH:DG; code+=s[Math.floor(Math.random()*s.length)]; } }while(!/[A-Z]/.test(code)||!/\d/.test(code));
    const g=document.createElement('div'), hint=tr('請大人幫忙：把下面的驗證碼（英文＋數字）打進框框裡'), err=tr('不對喔，再看清楚一次'), noTx=tr('取消'), okTx=tr('開啟'), ttl=tr('強力道具（炸彈、火箭筒、龍捲風）');
    g.className='bw-gate';
    g.innerHTML=`<div class="bw-gbox"><b>💥 ${ttl}</b><p>${hint}</p><div class="bw-code"></div>`+
      `<input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5"><p class="bw-err" hidden>${err}</p>`+
      `<div class="bw-gact"><button type="button" data-g="no">${noTx}</button><button type="button" data-g="ok">${okTx}</button></div></div>`;
    g.querySelector('.bw-code').textContent=code.split('').join(' ');
    ui.appendChild(g); const inp=g.querySelector('input'); setTimeout(()=>inp.focus(),50);
    const done=()=>g.remove();
    const ok=()=>{ if(inp.value.trim().toUpperCase()===code){ bombOK=true; done(); pickTool(next); } else { g.querySelector('.bw-err').hidden=false; inp.select(); } };
    g.querySelector('[data-g=ok]').addEventListener('click',ok); g.querySelector('[data-g=no]').addEventListener('click',done);
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter') ok(); else if(e.key==='Escape') done(); });
  }

  // ---------- 鍵盤（由 game3d.js 轉過來） ----------
  const MOVE=/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/;
  function key(e,down){
    if(e.target&&/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return false; // 正在打驗證碼
    const c=e.code;
    if(MOVE.test(c)){ if(down) keys.add(c); else keys.delete(c); return true; }
    if(!down) return false;
    if(c==='KeyZ'&&(e.ctrlKey||e.metaKey)){ undo(); return true; }
    if(c==='KeyF'){ pl.fly=!pl.fly; pl.vy=0; showFly(); return true; }
    if(c==='KeyR'){ toggleFast(); return true; }
    if(c==='KeyB'){ toggleFloat(); return true; }
    if(c==='KeyQ'){ const L=TOOLS.filter(t=>bombOK||!LOCKED.has(t[0])), q=L.findIndex(t=>t[0]===tool); pickTool(L[(q+1)%L.length][0]); return true; }
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
    stepProjs(dt); stepHeld(dt); stepTornados(dt);
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
    ui.remove();
    scene.traverse(m=>{ if(m.geometry) m.geometry.dispose(); });
    atlas.dispose(); opMat.dispose(); waMat.dispose(); rotorMat.dispose(); for(const m of back) m.material.dispose();
    pmatA.dispose(); pmatB.dispose(); fuseMat.dispose(); pbox.dispose(); heldMat.dispose();
    for(const x of [pelletGeo,pelletMat,rocketGeo,rocketMat,flameGeo,flameMat,puffGeo,puffMat,beamGeo,twMat]) x.dispose(); try{ AC&&AC.close(); }catch(e){}
  }
  { const r=cv.getBoundingClientRect(); resize(r.width||innerWidth,r.height||innerHeight); }
  return {step,resize,key,dispose,_:{vox,colTop,N,H,X0,Y0,Z0,pl,get,act,ray,cam,undo,resetAll,pickTool,turbs,hist:()=>hist}}; // _ 方便除錯
}

window.BlockWorld={create};
})();
