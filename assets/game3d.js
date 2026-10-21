/* 風車地球 3D 風場：依地點換場景（台灣海峽、海上、北海、沙漠、草原、山區、雪地），三關任務
 * 由 app.js 第一次進 3D 時載入；app.js 準備好風機位置、海岸線、地形種類後呼叫 WindGame3D.open(spec, ctx)。
 * spec：{title, biome, night, sunAlt, sunAz, pts:[{x,z,D,hh}]（公尺，x 往東、z 往南）, rings（陸地輪廓，[x,-z]）, wind:[往東, 往北] m/s}
 * ctx ：{toast, say, addStar, confetti, powerFrac, VCI, VCO, onClose, onNight}
 */
(function(){
'use strict';
const TAU=Math.PI*2, $=s=>document.querySelector(s);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const angDiff=(a,b)=>{ let d=(a-b)%TAU; if(d>Math.PI) d-=TAU; else if(d<-Math.PI) d+=TAU; return d; };

/* ---------- 各場景的設定 ---------- */
const BIOMES={
  taiwan:  {name:'台灣海峽',sea:true, sky:[0x5fb4ff,0xcfeaff],water:0x2f78b8,land:0x5f8a3f,storm:'颱風',stormWhat:'雨',boats:true,gulls:true},
  sea:     {name:'海上',    sea:true, sky:[0x6ab8f5,0xd8efff],water:0x2a6fb0,land:0x6d9448,storm:'海上暴風',stormWhat:'雨',boats:true,gulls:true},
  northsea:{name:'北海',    sea:true, sky:[0x7d97ad,0xc9d6df],water:0x3d5f78,land:0x6f8a5a,storm:'北海暴風',stormWhat:'雨',platform:true,gulls:true,fog:1.6},
  desert:  {name:'沙漠戈壁',sky:[0x5aa6e8,0xf3dfb8],ground:[0xdcb57a,0xc99a5b],storm:'沙塵暴',stormWhat:'沙',camels:true},
  grass:   {name:'草原農田',sky:[0x58aef0,0xd6efff],ground:[0x6fae4a,0x4f8f35],storm:'強烈陣風',stormWhat:'雨',animals:true,trees:'round',tufts:true},
  mountain:{name:'山區',    sky:[0x63aee8,0xdcecf5],ground:[0x5c8a43,0x3f6a33],storm:'強烈山風',stormWhat:'雨',trees:'pine',birds:true},
  snow:    {name:'雪地',    sky:[0x8fb8dc,0xeef4fa],ground:[0xf4f7fb,0xd9e3ee],storm:'暴風雪',stormWhat:'雪',trees:'snowpine',snowing:true}
};
function heightFn(b){
  if(b==='desert') return (x,z)=>34*Math.pow(Math.sin(x*0.0021+Math.sin(z*0.0007)*2),2)+12*Math.sin(z*0.0013+x*0.0004);
  if(b==='mountain') return (x,z)=>150+120*Math.sin(x*0.0009)*Math.cos(z*0.0011)+60*Math.sin(x*0.0023+z*0.0017)+28*Math.cos(z*0.004-x*0.002);
  if(b==='snow') return (x,z)=>20*Math.sin(x*0.0012)*Math.cos(z*0.0009)+8*Math.sin(x*0.004+z*0.003);
  return (x,z)=>16*Math.sin(x*0.0011)*Math.cos(z*0.0013)+7*Math.sin(x*0.003+z*0.002);
}
const MISSIONS=[
  {t:'點亮村莊',d:'按住「吹風」，讓風車轉起來，把燈全部點亮！'},
  {t:'對準風向',d:'風向一直在變！用 ◀ ▶ 把風車轉向迎風，維持發電 10 秒。'},
  {t:'暴風來襲',d:''}
];

let T=null, ctx=null, R3=null, cv=null;
const G={open:false};

/* ---------- 小工具：畫在 canvas 上的貼圖 ---------- */
function glowTex(inner,outer,size=128){
  const c=document.createElement('canvas'); c.width=c.height=size; const g=c.getContext('2d'), r=size/2;
  const gr=g.createRadialGradient(r,r,0,r,r,r); gr.addColorStop(0,inner); gr.addColorStop(0.35,inner); gr.addColorStop(1,outer);
  g.fillStyle=gr; g.fillRect(0,0,size,size); return new T.CanvasTexture(c);
}
function cloudTex(){
  const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  for(let i=0;i<6;i++){ const x=30+Math.random()*68, y=40+Math.random()*48, r=20+Math.random()*26;
    const gr=g.createRadialGradient(x,y,0,x,y,r); gr.addColorStop(0,'rgba(255,255,255,0.9)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=gr; g.fillRect(0,0,128,128); }
  return new T.CanvasTexture(c);
}
function disposeScene(sc){ sc.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); }); } }); }
const d3mean=(a,f)=>a.reduce((s,v)=>s+f(v),0)/a.length;
function pip(rings,x,z){ const y=-z; for(const r of rings){ let ins=false; for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins;} if(ins) return true; } return false; }

/* ---------- 建立場景 ---------- */
function build(spec){
  const B=BIOMES[spec.biome]||BIOMES.grass, night=spec.night, rr=mulberry32(20261022);
  const sc=new T.Scene();
  let R=300; for(const p of spec.pts) R=Math.max(R,Math.hypot(p.x,p.z));
  const size=R*8+16000, half=size/2;
  G.B=B; G.R=R; G.size=size; G.night=night;

  // 天空：漸層球 + 太陽／月亮 + 星星
  const top=new T.Color(night?0x0b1838:B.sky[0]), hor=new T.Color(night?0x2a3f72:(spec.sunAlt<8?0xf7b98f:B.sky[1]));
  G.skyTop=top.clone(); G.skyHor=hor.clone();
  const skyMat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{top:{value:top},hor:{value:hor},dark:{value:0}},
    vertexShader:'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:'uniform vec3 top; uniform vec3 hor; uniform float dark; varying vec3 vP; void main(){ float h=clamp(vP.y*1.6,0.0,1.0); vec3 c=mix(hor,top,pow(h,0.7)); c=mix(c,vec3(0.18,0.2,0.24),dark); gl_FragColor=vec4(c,1.0); }'});
  const sky=new T.Mesh(new T.SphereGeometry(size*0.55,32,16),skyMat); sc.add(sky); G.skyMat=skyMat;
  const fogC=hor.clone(); sc.fog=new T.Fog(fogC,R*1.2+1500/(B.fog||1),(R*7+9000)/(B.fog||1)); G.fogBase=fogC.clone();
  const az=(spec.sunAz||200)*Math.PI/180, alt=Math.max(night?25:4,night?30:spec.sunAlt||40)*Math.PI/180;
  const sunDir=new T.Vector3(Math.sin(az)*Math.cos(alt),Math.sin(alt),-Math.cos(az)*Math.cos(alt));
  const sun=new T.Sprite(new T.SpriteMaterial({map:glowTex(night?'rgba(240,244,255,1)':'rgba(255,250,220,1)','rgba(255,240,200,0)'),fog:false,depthWrite:false}));
  sun.position.copy(sunDir.clone().multiplyScalar(size*0.45)); sun.scale.setScalar(size*(night?0.05:0.09)); sc.add(sun);
  if(night){
    const n=900, pos=new Float32Array(n*3);
    for(let i=0;i<n;i++){ const u=rr()*TAU, v=Math.acos(rr()*0.95), r=size*0.5; pos[3*i]=Math.sin(v)*Math.cos(u)*r; pos[3*i+1]=Math.cos(v)*r; pos[3*i+2]=Math.sin(v)*Math.sin(u)*r; }
    const g=new T.BufferGeometry(); g.setAttribute('position',new T.BufferAttribute(pos,3));
    sc.add(new T.Points(g,new T.PointsMaterial({color:0xffffff,size:size*0.0012,fog:false,transparent:true,opacity:0.85})));
  }
  sc.add(new T.HemisphereLight(night?0x6f86c8:0xffffff,night?0x18233a:0x8a7a5a,night?0.75:0.62));
  const dl=new T.DirectionalLight(night?0xaec0ff:0xfff2dd,night?0.45:0.8); dl.position.copy(sunDir); sc.add(dl);

  // 雲
  const ct=cloudTex(); G.clouds=[];
  for(let i=0;i<14;i++){
    const grp=new T.Group(), m=new T.SpriteMaterial({map:ct,transparent:true,opacity:night?0.25:0.85,depthWrite:false,fog:false,color:night?0x8090b0:0xffffff});
    for(let k=0;k<4;k++){ const s=new T.Sprite(m); s.position.set((rr()-0.5)*900,(rr()-0.5)*120,(rr()-0.5)*500); s.scale.setScalar(700+rr()*600); grp.add(s); }
    grp.position.set((rr()-0.5)*size*0.7,(B.sea?1500:spec.biome==='mountain'?1300:1800)+rr()*900,(rr()-0.5)*size*0.7); sc.add(grp); G.clouds.push(grp);
  }

  // 地面或海面
  const LANDY=6; G.h=()=>0; G.water=null; G.rings=[];
  if(B.sea){
    const gg=new T.PlaneGeometry(size,size,96,96); gg.rotateX(-Math.PI/2);
    sc.add(new T.Mesh(gg,new T.MeshPhongMaterial({color:night?0x1a4677:B.water,shininess:80,flatShading:true})));
    G.water=gg; G.wbase=Float32Array.from(gg.attributes.position.array);
    G.rings=spec.rings||[];
    const landM=new T.MeshLambertMaterial({color:night?0x2c4a2e:B.land,side:T.DoubleSide});
    if(!spec.ground) for(const r of G.rings){ if(r.length<3) continue; const sg=new T.ShapeGeometry(new T.Shape(r.map(p=>new T.Vector2(p[0],p[1])))); sg.rotateX(-Math.PI/2); const m=new T.Mesh(sg,landM); m.position.y=LANDY; sc.add(m); }
    G.h=(x,z)=>pip(G.rings,x,z)?LANDY:0;
  }else{
    const h0=heightFn(spec.biome), hs=spec.ground&&spec.biome!=='mountain'?0.35:1, h=(x,z)=>h0(x,z)*hs; G.h=h;
    const gg=new T.PlaneGeometry(size,size,140,140); gg.rotateX(-Math.PI/2);
    const a=gg.attributes.position, col=new Float32Array(a.count*3), c0=new T.Color(B.ground[0]), c1=new T.Color(B.ground[1]), cc=new T.Color();
    for(let i=0;i<a.count;i++){
      const x=a.getX(i), z=a.getZ(i), y=h(x,z); a.setY(i,y);
      let k=0.5+0.5*Math.sin(x*0.0031+z*0.0023)*Math.cos(z*0.0017-x*0.0007);
      if(spec.biome==='grass'&&Math.sin(x*0.0016)>0.55) k=0.15; // 一塊塊農田
      if(spec.biome==='mountain') k=Math.min(1,Math.max(0,(y-60)/260));
      cc.copy(c0).lerp(c1,k); if(night) cc.multiplyScalar(0.45); col.set([cc.r,cc.g,cc.b],3*i);
    }
    gg.setAttribute('color',new T.BufferAttribute(col,3)); gg.computeVertexNormals();
    sc.add(new T.Mesh(gg,new T.MeshLambertMaterial({vertexColors:true})));
  }
  // 真實地圖貼圖：遠景整片、近景（風機附近）比較清楚；海上場景的海面已經挖空，露出底下的 3D 海浪
  if(spec.ground){
    const lay=(shot,lift,order)=>{
      if(!shot) return;
      const tex=new T.CanvasTexture(shot.img); tex.anisotropy=R3.capabilities.getMaxAnisotropy();
      const w=shot.x1-shot.x0, d=shot.z1-shot.z0, seg=B.sea?1:110;
      const g=new T.PlaneGeometry(w,d,seg,seg); g.rotateX(-Math.PI/2); g.translate((shot.x0+shot.x1)/2,0,(shot.z0+shot.z1)/2);
      if(!B.sea){ const a=g.attributes.position; for(let i=0;i<a.count;i++) a.setY(i,G.h(a.getX(i),a.getZ(i))); g.computeVertexNormals(); }
      const m=new T.MeshLambertMaterial({map:tex,transparent:B.sea,alphaTest:B.sea?0.5:0,color:night?0x5a6788:0xffffff,
        polygonOffset:true,polygonOffsetFactor:-order,polygonOffsetUnits:-order*4});
      const mesh=new T.Mesh(g,m); mesh.position.y=B.sea?LANDY+lift:lift; mesh.renderOrder=order; sc.add(mesh);
    };
    lay(spec.ground.far,0.5,1); lay(spec.ground.near,1.2,2);
  }

  // 風機位置與高度
  const pos=spec.pts.map(p=>{ const y=G.h(p.x,p.z); return {x:p.x,z:p.z,D:p.D,hh:p.hh,y,land:B.sea?y>0:true}; });
  G.pos=pos;
  // 鏡頭與村莊對準風機最密集的地方（1.5 公里內鄰居最多的那一支；一樣多時取比較南邊、靠鏡頭的）
  let far=pos[0], best=-1;
  for(const p of pos){ let c=0; for(const q of pos) if(Math.abs(q.x-p.x)<1500&&Math.abs(q.z-p.z)<1500) c++; if(c>best||(c===best&&p.z>far.z)){ best=c; far=p; } }

  // 村莊：附近有真實建築就用真實的；否則海上場景優先放在真實陸地，太遠就做示意小島；陸地場景放在風機前方
  let vx=far.x, vz=far.z+650, island=false;
  // 真實建築：離風機最密集處 3 公里內有 15 棟以上，就把它們蓋成立體，最近的 24 棟是要點亮的「村莊」
  const realB=(spec.ground&&spec.ground.buildings||[]).map(b=>{ let cx=0,cz=0; for(const p of b.ring){cx+=p[0];cz+=p[1];} cx/=b.ring.length; cz/=b.ring.length; return Object.assign(b,{cx,cz,d:Math.hypot(cx-far.x,cz-far.z)}); }).filter(b=>b.d<3000);
  const useReal=realB.length>=15;
  if(useReal){ realB.sort((a,b)=>a.d-b.d); const lit=realB.slice(0,24); vx=d3mean(lit,b=>b.cx); vz=d3mean(lit,b=>b.cz); }
  if(B.sea&&!useReal){
    let onLand=false;
    if(far.land){ for(const k of [650,400,250]) if(pip(G.rings,far.x,far.z+k)){ vz=far.z+k; onLand=true; break; } }
    if(!onLand){
      let best=null,bd=5000; for(const r of G.rings) for(const q of r){ const d=Math.hypot(q[0]-far.x,-q[1]-far.z); if(d<bd){bd=d;best=q;} }
      if(best){ const bx=best[0], bz=-best[1], dx=bx-far.x, dz=bz-far.z, dn=Math.hypot(dx,dz)||1;
        for(const k of [200,400,650,1000]){ const x=bx+dx/dn*k, z=bz+dz/dn*k; if(pip(G.rings,x,z)){ vx=x; vz=z; onLand=true; break; } } }
    }
    island=!onLand;
    if(island){ const isl=new T.Mesh(new T.CylinderGeometry(520,620,8,40),new T.MeshLambertMaterial({color:night?0x24402a:0x7cbf63})); isl.position.set(vx,0,vz); sc.add(isl);
      const sand=new T.Mesh(new T.CylinderGeometry(660,700,4,40),new T.MeshLambertMaterial({color:night?0x5c5440:0xf1dfa8})); sand.position.set(vx,0,vz); sc.add(sand); }
  }
  G.island=island; G.village=[vx,vz]; G.realVillage=useReal;
  const hb=new T.BoxGeometry(46,30,40); hb.translate(0,15,0); const hr=new T.ConeGeometry(36,22,4); hr.rotateY(Math.PI/4); hr.translate(0,41,0);
  const roofCols=spec.biome==='snow'?[0xffffff]:[0xd9534f,0x2f7ad6,0xf0a830,0x8a5cd6,0x3cae6b];
  const cand=[]; for(let row=0;row<5;row++) for(let col=0;col<5;col++) cand.push([vx+(col-2)*110+(row%2?40:0), vz-200+row*120]);
  let spots=B.sea&&!island?cand.filter(c=>pip(G.rings,c[0],c[1])).slice(0,12):cand.slice(0,12); if(spots.length<6) spots=cand.slice(0,12);
  G.houses=[];
  if(useReal){
    const wall=new T.MeshLambertMaterial({color:night?0x8a8070:0xf1e7d6}), roof=new T.MeshLambertMaterial({color:night?0x6a5a50:0xc98a6a});
    realB.slice(0,700).forEach((b,i)=>{
      const shape=new T.Shape(b.ring.map(p=>new T.Vector2(p[0],-p[1])));
      const g=new T.ExtrudeGeometry(shape,{depth:Math.min(b.h,200),bevelEnabled:false}); g.rotateX(-Math.PI/2);
      const lit=i<24, wm=lit?new T.MeshLambertMaterial({color:0xf3ead8,emissive:0x000000}):wall;
      const m=new T.Mesh(g,[roof,wm]); m.position.y=B.sea?LANDY+1.5:G.h(b.cx,b.cz)+0.5; sc.add(m);
      if(lit) G.houses.push(wm);
    });
  }else spots.forEach((c,i)=>{
    const y=island?4:G.h(c[0],c[1]), m=new T.MeshLambertMaterial({color:0xf3ead8,emissive:0x000000});
    const hs=new T.Mesh(hb,m); hs.position.set(c[0],y,c[1]); hs.rotation.y=(rr()-0.5)*0.4; sc.add(hs);
    const roof=new T.Mesh(hr,new T.MeshLambertMaterial({color:roofCols[i%roofCols.length]})); roof.position.copy(hs.position); roof.rotation.y=hs.rotation.y; sc.add(roof);
    G.houses.push(m);
  });

  // 樹
  const free=(x,z,d)=>!pos.some(p=>Math.abs(p.x-x)<d&&Math.abs(p.z-z)<d)&&Math.hypot(x-vx,z-vz)>380;
  if(B.trees||B.sea){
    const kind=B.trees||'round', n=kind==='round'?220:340;
    const tg=kind==='round'?new T.SphereGeometry(18,8,6):new T.ConeGeometry(14,44,7); tg.translate(0,kind==='round'?30:22,0);
    const tm=new T.MeshLambertMaterial({color:night?0x1e3d22:(kind==='snowpine'?0x2f5d3a:0x3f8a3a)});
    const mesh=new T.InstancedMesh(tg,tm,n), M=new T.Matrix4(); let c=0;
    const trunkG=new T.CylinderGeometry(2.5,3.5,14,5); trunkG.translate(0,7,0);
    const trunks=new T.InstancedMesh(trunkG,new T.MeshLambertMaterial({color:0x6b4a2b}),n);
    const caps=kind==='snowpine'?new T.InstancedMesh((()=>{const g=new T.ConeGeometry(9,18,7); g.translate(0,40,0); return g;})(),new T.MeshLambertMaterial({color:0xffffff}),n):null;
    for(let i=0;i<4000&&c<n;i++){
      const x=(rr()-0.5)*R*5, z=(rr()-0.5)*R*5; if(B.sea&&!pip(G.rings,x,z)) continue; if(!free(x,z,70)) continue;
      const s=0.7+rr()*0.9, y=G.h(x,z); M.makeScale(s,s,s); M.setPosition(x,y,z); mesh.setMatrixAt(c,M); trunks.setMatrixAt(c,M); if(caps) caps.setMatrixAt(c,M); c++;
    }
    mesh.count=trunks.count=c; if(caps) caps.count=c;
    sc.add(mesh,trunks); if(caps) sc.add(caps);
  }

  // 會隨風搖的草
  G.tufts=null;
  if(B.tufts){
    const n=700, g=new T.ConeGeometry(2.2,16,4); g.translate(0,8,0);
    const m=new T.InstancedMesh(g,new T.MeshLambertMaterial({color:night?0x2c5a2a:0x7fc65a}),n); G.tufts={m,p:[]};
    for(let i=0;i<n;i++){ const x=(rr()-0.5)*R*2.6, z=(rr()-0.5)*R*2.6; G.tufts.p.push([x,G.h(x,z),z,rr()*TAU,0.6+rr()*0.8]); }
    sc.add(m);
  }

  // 動物、駱駝、漁船、海鷗、鑽油平台
  G.movers=[];
  const lam=c=>new T.MeshLambertMaterial({color:c});
  if(B.animals){
    for(let i=0;i<14;i++){
      const g=new T.Group(), sheep=i%3!==0, body=new T.Mesh(sheep?new T.SphereGeometry(9,8,6):new T.BoxGeometry(26,14,12),lam(sheep?0xf5f5f0:0x7a5a3c));
      body.position.y=sheep?12:16; g.add(body);
      const head=new T.Mesh(new T.BoxGeometry(7,7,7),lam(sheep?0x333333:0xeeeeee)); head.position.set(sheep?10:16,sheep?14:20,0); g.add(head);
      const x=vx+(rr()-0.5)*900, z=vz-500+(rr()-0.5)*500; g.position.set(x,G.h(x,z),z); g.rotation.y=rr()*TAU; sc.add(g);
      G.movers.push({o:g,kind:'graze',v:3+rr()*4,t:rr()*10});
    }
  }
  if(B.camels){
    for(let i=0;i<5;i++){
      const g=new T.Group(), c=lam(0xb07a45);
      const body=new T.Mesh(new T.BoxGeometry(30,14,12),c); body.position.y=30; g.add(body);
      for(const dx of [-6,6]){ const hump=new T.Mesh(new T.SphereGeometry(7,8,6),c); hump.position.set(dx,40,0); g.add(hump); }
      const neck=new T.Mesh(new T.BoxGeometry(6,18,6),c); neck.position.set(17,40,0); neck.rotation.z=-0.4; g.add(neck);
      const head=new T.Mesh(new T.BoxGeometry(10,6,6),c); head.position.set(22,49,0); g.add(head);
      for(const [lx,lz] of [[-11,-4],[-11,4],[11,-4],[11,4]]){ const leg=new T.Mesh(new T.BoxGeometry(3,23,3),c); leg.position.set(lx,11.5,lz); g.add(leg); }
      sc.add(g); G.movers.push({o:g,kind:'caravan',i,base:[vx-700,vz-300]});
    }
  }
  if(B.boats){
    for(let i=0;i<5;i++){
      const g=new T.Group(), hull=new T.Mesh(new T.BoxGeometry(60,12,20),lam(i%2?0xd9534f:0x2f7ad6)); hull.position.y=4; g.add(hull);
      const cab=new T.Mesh(new T.BoxGeometry(18,14,14),lam(0xf4f4f4)); cab.position.set(-10,17,0); g.add(cab);
      const mast=new T.Mesh(new T.CylinderGeometry(1,1,30,5),lam(0x666666)); mast.position.set(12,25,0); g.add(mast);
      const a=rr()*TAU, r=R*1.3+rr()*R; g.position.set(Math.cos(a)*r,0,Math.sin(a)*r); sc.add(g);
      G.movers.push({o:g,kind:'boat',a,r,v:0.012+rr()*0.01});
    }
  }
  if(B.platform){
    const g=new T.Group(), steel=lam(0x9aa3ab);
    for(const [x,z] of [[-30,-30],[30,-30],[-30,30],[30,30]]){ const leg=new T.Mesh(new T.CylinderGeometry(4,5,80,8),steel); leg.position.set(x,40,z); g.add(leg); }
    const deck=new T.Mesh(new T.BoxGeometry(90,14,90),lam(0xe0b030)); deck.position.y=86; g.add(deck);
    const tower=new T.Mesh(new T.BoxGeometry(14,70,14),lam(0xd04030)); tower.position.set(25,128,25); g.add(tower);
    const flare=new T.Sprite(new T.SpriteMaterial({map:glowTex('rgba(255,170,60,1)','rgba(255,90,0,0)'),depthWrite:false})); flare.position.set(-35,140,-35); flare.scale.setScalar(50); g.add(flare);
    g.position.set(-R*1.6,0,-R*0.8); sc.add(g); G.movers.push({o:flare,kind:'flare'});
  }
  G.birds=[];
  if(B.gulls||B.birds){
    const wing=new T.PlaneGeometry(14,5); wing.translate(7,0,0); const wm=new T.MeshBasicMaterial({color:B.gulls?0xffffff:0x333333,side:T.DoubleSide});
    for(let i=0;i<12;i++){
      const g=new T.Group(), l=new T.Mesh(wing,wm), r=new T.Mesh(wing,wm); r.rotation.y=Math.PI; g.add(l,r);
      g.position.set(0,200+rr()*250,0); sc.add(g); G.birds.push({g,l,r,a:rr()*TAU,rad:200+rr()*R,cx:(rr()-0.5)*R,cz:(rr()-0.5)*R,v:0.15+rr()*0.15,ph:rr()*TAU});
    }
  }

  // 風機
  const towerG=new T.CylinderGeometry(0.6,1,1,14); towerG.translate(0,0.5,0);
  const nacG=new T.BoxGeometry(1,1,1), hubG=new T.SphereGeometry(1,14,10);
  const bladeG=new T.BoxGeometry(0.075,1,0.02,1,8,1); bladeG.translate(0,0.5,0);
  { const a=bladeG.attributes.position; for(let i=0;i<a.count;i++){const y=a.getY(i); a.setX(i,a.getX(i)*(1-0.75*y)+(y<0.15?0:0.012*(1-y)));} a.needsUpdate=true; bladeG.computeVertexNormals(); }
  const white=new T.MeshLambertMaterial({color:0xf4f6f8,emissive:night?0x2a3346:0x000000}), yellow=new T.MeshLambertMaterial({color:0xf2c200}), red=new T.MeshBasicMaterial({color:0xff3030});
  G.bladeMat=white; const redG=new T.SphereGeometry(1,8,6);
  G.turbs=[]; G.lights=[];
  for(const p of pos){
    const hh=p.hh, rad=p.D/2, g=new T.Group(), base=p.y; g.position.set(p.x,base,p.z);
    const sea=B.sea&&!p.land;
    if(sea){ const tp=new T.Mesh(towerG,yellow); tp.scale.set(hh*0.05,hh*0.13,hh*0.05); g.add(tp); }
    const tw=new T.Mesh(towerG,white); tw.position.y=sea?hh*0.13:0; tw.scale.set(hh*0.032,hh-(sea?hh*0.13:0),hh*0.032); g.add(tw);
    const head=new T.Group(); head.position.y=hh; g.add(head);
    const nac=new T.Mesh(nacG,white); nac.scale.set(hh*0.07,hh*0.07,hh*0.17); nac.position.set(0,0,-hh*0.03); head.add(nac);
    const rotor=new T.Group(); rotor.position.set(0,0,hh*0.07); head.add(rotor);
    const hub=new T.Mesh(hubG,white); hub.scale.set(hh*0.04,hh*0.04,hh*0.05); rotor.add(hub);
    const blades=[]; for(let k=0;k<3;k++){ const piv=new T.Group(); piv.rotation.z=k*TAU/3; const b=new T.Mesh(bladeG,white); b.scale.set(rad,rad,rad); piv.add(b); rotor.add(piv); blades.push(b); }
    rotor.rotation.z=rr()*TAU;
    const lt=new T.Mesh(redG,red); lt.scale.setScalar(hh*0.02); lt.position.set(0,hh*0.045,-hh*0.06); lt.visible=night; head.add(lt); G.lights.push(lt);
    sc.add(g); G.turbs.push({g,head,rotor,blades,k:167/Math.max(40,p.D),jit:(rr()-0.5)*0.06,shake:rr()*TAU});
  }

  // 風線、天氣粒子
  const N=160, sg=new T.BufferGeometry(), sp=new Float32Array(N*6); sg.setAttribute('position',new T.BufferAttribute(sp,3));
  const sm=new T.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.5});
  G.streak={g:sg,m:sm,p:[]}; for(let i=0;i<N;i++) G.streak.p.push({x:(rr()-0.5)*R*3,y:30+rr()*Math.max(150,R*0.12),z:(rr()-0.5)*R*3});
  sc.add(new T.LineSegments(sg,sm));
  { const n=2500, g=new T.BufferGeometry(), a=new Float32Array(n*3); for(let i=0;i<n;i++){ a[3*i]=(rr()-0.5)*R*3; a[3*i+1]=rr()*900; a[3*i+2]=(rr()-0.5)*R*3; }
    g.setAttribute('position',new T.BufferAttribute(a,3));
    const col=B.stormWhat==='沙'?0xe2b46b:B.stormWhat==='雪'?0xffffff:0xbfd6ff;
    G.precip={pts:new T.Points(g,new T.PointsMaterial({color:col,size:B.stormWhat==='雨'?4:6,transparent:true,opacity:0})),g,n}; sc.add(G.precip.pts); }

  // 鏡頭
  const cdx=vx-far.x, cdz=vz-far.z, cdn=Math.hypot(cdx,cdz)||1;
  G.cam=new T.PerspectiveCamera(50,1,5,size*1.2);
  G.az=Math.atan2(cdx,cdz); G.el=0.24; G.dist=Math.max(1100,far.hh*13,cdn*0.9+900);
  G.target=new T.Vector3(far.x+cdx*0.35,far.y+far.hh*0.5,far.z+cdz*0.35);
  return sc;
}

/* ---------- 開啟、關閉 ---------- */
function open(spec,c){
  T=window.THREE; ctx=c; cv=$('#c3d');
  if(!R3){ R3=new T.WebGLRenderer({canvas:cv,antialias:true}); R3.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); bindInput(); }
  if(G.scene) disposeScene(G.scene);
  G.spec=spec; G.scene=build(spec);
  const w=spec.wind||[1,0], wn=Math.hypot(w[0],w[1])||1;
  G.windA=Math.atan2(-w[0]/wn,w[1]/wn);            // 風機要面向的方向（迎風）
  G.windTarget=G.windA; G.yaw=G.windA; G.yawCmd=0;
  G.open=true; G.boost=0; G.blowing=false; G.spin=0.5; G.idle=0; G.prot=false; G.pitch=0; G.lastMsg='';
  startMission(0);
  $('#v3d').hidden=false; document.body.classList.add('v3on');
  $('#v3title').textContent=spec.title;
  $('#v3info').textContent=`${G.B.name}・${spec.pts.length} 支風機・${spec.ground?'地面是真實地圖':'海岸線依真實地圖'}・${G.realVillage?'房子是地圖上的真實建築':G.island?'陸地太遠，村莊小島為示意':'村莊為示意'}・拖曳轉視角、滾輪縮放`;
  $('#v3dn').textContent=G.night?'☀ 換成白天':'☾ 換成晚上';
  resize(); G.last=performance.now(); requestAnimationFrame(loop);
}
function close(){ G.open=false; G.blowing=false; $('#v3d').hidden=true; document.body.classList.remove('v3on'); ctx&&ctx.onClose&&ctx.onClose(); }
function resize(){ if(!R3) return; const w=cv.clientWidth||innerWidth, h=cv.clientHeight||innerHeight; R3.setSize(w,h,false); if(G.cam){G.cam.aspect=w/h;G.cam.updateProjectionMatrix();} }

/* ---------- 任務 ---------- */
function startMission(i){
  G.m=i; G.mt=0; G.prog=0; G.full=0; G.dmg=0; G.broken=0; G.prot=false; G.storm=0;
  const M=MISSIONS[i];
  const show=(id,on)=>{ const el=$(id); if(el) el.hidden=!on; };
  show('#v3l',i>=1&&i<3); show('#v3r',i>=1&&i<3); show('#v3prot',i===2); show('#v3again',i===3); show('#v3blow',i<3);
  $('#v3prot').classList.remove('on');
  if(i<3){
    const d=i===2?`${G.B.storm}要來了！風速超過每秒 25 公尺前，按「🛡 保護」收起葉片；風變小後再關掉保護。`:M.d;
    $('#v3mt').textContent=`任務 ${i+1}／3：${i===2?G.B.storm+'來襲':M.t}`; $('#v3md').textContent=d;
    ctx.say(`任務${i+1}，${i===2?G.B.storm+'來襲':M.t}。${d.replace(/[「」🛡◀▶]/g,'')}`);
  }else{
    $('#v3mt').textContent='三個任務都完成了！'; $('#v3md').textContent=`你是${G.spec.title}的風之小勇者！`;
  }
}
function missionDone(){
  ctx.addStar(); ctx.confetti($('#v3d'));
  const txt=['全村的燈都亮了！','風向對準了，電一直送出去！',`${G.B.storm}過去了，風機平安無事！`][G.m];
  ctx.toast('⭐ '+txt,3000); ctx.say(txt);
  const next=G.m+1; G.m=-1; setTimeout(()=>{ if(G.open) startMission(next); if(next===3){ ctx.say('三個任務都完成了，你是風之小勇者！'); ctx.confetti($('#v3d')); } },2600);
}

/* ---------- 每一幀 ---------- */
function loop(now){
  if(!G.open) return;
  step(now);
  requestAnimationFrame(loop);
}
function step(now){
  const dt=Math.max(0,Math.min(0.1,(now-G.last)/1000)); G.last=Math.max(G.last,now); const t=now/1000;
  const pf=ctx.powerFrac, VCI=ctx.VCI, VCO=ctx.VCO;
  G.boost=G.blowing?Math.min(21,G.boost+dt*5.5):Math.max(0,G.boost-dt*3);
  if(G.m>=0) G.mt+=dt;
  let ws, msg='';
  // 風向：任務 2 會一直轉；其他時候慢慢晃
  if(G.m===1){ if(G.mt>=2&&(G.mt-2)%7<dt) G.windTarget=G.windA+(Math.random()<0.5?-1:1)*(1+Math.random())*Math.PI/3; } // 進關 2 秒後第一次轉向，之後每 7 秒
  else if(G.m!==3) G.windTarget+=Math.sin(t*0.3)*0.0006;
  G.windA+=Math.max(-0.45*dt,Math.min(0.45*dt,angDiff(G.windTarget,G.windA)));
  // 風機轉向：任務 2 由玩家控制，其他時候自動對準風
  if(G.m===1) G.yaw+=G.yawCmd*0.7*dt; else G.yaw+=angDiff(G.windA,G.yaw)*Math.min(1,dt*1.5);
  const off=angDiff(G.yaw,G.windA), eff=Math.max(0,Math.cos(off));
  // 風速
  if(G.m===2){
    const s=G.mt; ws=s<5?9:s<13?9+(s-5)/8*23:s<20?31+2*Math.sin(t*2):s<28?31-(s-20)/8*22:9+Math.sin(t*0.7);
    ws+=G.boost*0.3; G.storm=s<5?0:s<13?(s-5)/8:s<20?1:s<28?1-(s-20)/8:0;
  }else if(G.m===1) ws=12.8+1.2*Math.sin(t*0.5)+G.boost*0.2; // 對準時剛好全力發電，偏 45° 只剩三成多
  else if(G.m===3) ws=10+1.2*Math.sin(t*0.6);
  else ws=2.5+0.6*Math.sin(t/1.7)+G.boost;
  const wsEff=ws*eff;
  // 保護模式：葉片轉成順風，停止轉動
  G.pitch+=((G.prot?1:0)-G.pitch)*Math.min(1,dt*2.5);
  const cut=wsEff>=VCO;
  let frac=G.prot||G.broken>0||cut?0:pf(wsEff);
  const rpm=G.prot||G.broken>0?0:cut?0:wsEff<VCI?0.8:Math.min(16,3+wsEff*0.95);
  G.spin+=(rpm/60*TAU*1.7-G.spin)*Math.min(1,dt*(G.prot?0.8:1.6));
  if(G.m===3) frac=Math.max(frac,1);
  // 各任務的判斷
  if(G.m===0){
    if(frac>=0.999){ G.full+=dt; if(G.full>1.5) missionDone(); } else G.full=0;
    msg=ws<VCI?'風太小了，風車只能慢慢轉。按住「吹風」幫幫它！':frac>=0.999?'全力發電中！村莊的燈全部亮了！':G.blowing?'風車越轉越快了！':'風變小了，燈一間一間暗下來…再按住吹風！';
    G.prog=Math.min(1,G.full/1.5);
  }else if(G.m===1){
    if(frac>=0.85) G.prog=Math.min(1,G.prog+dt/10); else G.prog=Math.max(0,G.prog-dt/30);
    if(G.prog>=1) missionDone();
    const deg=Math.round(Math.abs(off)*180/Math.PI);
    msg=deg<20?'對準了！風車正面迎著風，電一直送出去～':`風向偏了 ${deg}°，按 ${off>0?'▶':'◀'} 把風車轉向風吹來的方向！`;
  }else if(G.m===2){
    if(G.broken>0){ G.broken-=dt; msg='哎呀！風太強，風機受損了…等一下重新開始。'; if(G.broken<=0) startMission(2); }
    else{
      if(ws>=VCO&&!G.prot){ G.dmg+=dt; if(G.dmg>2.5){ G.broken=4; ctx.say('風機受損了，再試一次！'); } } else G.dmg=Math.max(0,G.dmg-dt);
      if(G.mt>22&&!G.prot&&ws<20&&frac>0.4){ G.prog=Math.min(1,G.prog+dt/2); if(G.prog>=1) missionDone(); }
      msg=G.mt<5?`天空變暗了…${G.B.storm}快來了，注意風速！`:
          ws>=VCO?(G.prot?'葉片收好了！風機安全停下來，等暴風過去～':'危險！風速超過每秒 25 公尺，快按「🛡 保護」！'):
          ws>=20&&!G.prot?'風越來越強！準備按「🛡 保護」':
          G.prot&&ws<20&&G.mt>20?'風變小了，關掉「保護」讓風車繼續發電！':
          G.prot?'保護模式：葉片轉成順風，風車停止轉動':G.mt>22?'暴風過去了，風車又開始發電囉！':'風很強，風車全力發電中！';
    }
  }else if(G.m===3) msg='按「再玩一次」可以重新挑戰，或換個地方的風場玩玩看！';
  if(msg!==G.lastMsg){ $('#v3msg').textContent=msg; G.lastMsg=msg; }
  // 房子的燈
  const lit=Math.round(frac*G.houses.length);
  G.houses.forEach((m,i)=>m.emissive.setHex(i<lit?(G.night?0xffb84a:0x9a6a12):0x000000));
  $('#v3ws').textContent=ws.toFixed(1); $('#v3pw').style.width=(frac*100)+'%'; $('#v3lit').textContent=`${lit} / ${G.houses.length}`;
  $('#v3goal').style.width=(G.prog*100)+'%';
  $('#v3dirT').textContent=G.m===1?`偏差 ${Math.round(Math.abs(off)*180/Math.PI)}°`:'';
  updCompass(off);
  // 風機動畫
  const shaking=G.m===2&&ws>=VCO&&!G.prot;
  for(const tb of G.turbs){
    tb.rotor.rotation.z-=G.spin*tb.k*dt;
    tb.head.rotation.y=G.yaw+tb.jit-tb.g.rotation.y;
    for(const b of tb.blades) b.rotation.y=G.pitch*1.45;
    tb.g.rotation.x=shaking?Math.sin(t*18+tb.shake)*0.012:0;
  }
  G.bladeMat.color.setHex(G.broken>0?0xffb0a0:0xf4f6f8);
  // 天氣：暴風時天空變暗、粒子變多
  const st=G.storm||0;
  G.skyMat.uniforms.dark.value=st*0.55; G.scene.fog.color.copy(G.fogBase).lerp(new T.Color(G.B.stormWhat==='沙'?0xc89a5a:0x8a96a3),st*0.7);
  G.scene.fog.near=(G.R*1.2+1500)*(1-st*0.6); G.scene.fog.far=(G.R*7+9000)*(1-st*0.6)/(G.B.fog||1);
  const pc=G.precip, snowBase=G.B.snowing?0.7:0; pc.pts.material.opacity=Math.max(snowBase,st*0.9);
  if(pc.pts.material.opacity>0.01){
    const a=pc.g.attributes.position.array, fall=G.B.stormWhat==='雨'?900:G.B.stormWhat==='雪'?90:40, side=G.B.stormWhat==='沙'?ws*25:ws*6;
    const dx=Math.sin(G.windA+Math.PI), dz=Math.cos(G.windA+Math.PI), Rr=G.R*1.5;
    for(let i=0;i<pc.n;i++){ a[3*i+1]-=fall*dt; a[3*i]+=dx*side*dt; a[3*i+2]+=dz*side*dt;
      if(a[3*i+1]<0){ a[3*i+1]=900; } if(Math.abs(a[3*i])>Rr) a[3*i]*=-0.98; if(Math.abs(a[3*i+2])>Rr) a[3*i+2]*=-0.98; }
    pc.g.attributes.position.needsUpdate=true;
  }
  if(G.water){ const a=G.water.attributes.position, b=G.wbase, amp=1+st*2.5; for(let i=0;i<a.count;i++){const x=b[3*i],z=b[3*i+2]; a.array[3*i+1]=(Math.sin(x*0.004+t*1.2)*3+Math.cos(z*0.005+t)*2.5)*amp;} a.needsUpdate=true; }
  if(G.night){ const on=(t%1.5)<0.4; for(const l of G.lights) l.visible=on; }
  // 雲、風線、草、動物、鳥
  const wdx=Math.sin(G.windA+Math.PI), wdz=Math.cos(G.windA+Math.PI), half=G.size*0.35;
  for(const c of G.clouds){ c.position.x+=wdx*ws*3*dt; c.position.z+=wdz*ws*3*dt; if(Math.abs(c.position.x)>half) c.position.x*=-0.98; if(Math.abs(c.position.z)>half) c.position.z*=-0.98; }
  const s=G.streak, arr=s.g.attributes.position.array, spd=ws*54*dt, L=12+ws*4, Rr=G.R*1.5;
  s.m.opacity=Math.min(0.75,0.08+ws/30);
  s.p.forEach((q,i)=>{ q.x+=wdx*spd; q.z+=wdz*spd; if(Math.abs(q.x)>Rr||Math.abs(q.z)>Rr){ q.x=-wdx*Rr*0.95+(Math.random()-0.5)*Rr*2*Math.abs(wdz); q.z=-wdz*Rr*0.95+(Math.random()-0.5)*Rr*2*Math.abs(wdx); }
    arr.set([q.x,q.y,q.z,q.x-wdx*L,q.y,q.z-wdz*L],i*6); });
  s.g.attributes.position.needsUpdate=true;
  if(G.tufts){ const M=new T.Matrix4(), Q=new T.Quaternion(), E=new T.Euler(), V=new T.Vector3(), S=new T.Vector3();
    const bend=Math.min(0.9,0.05+ws*0.03);
    G.tufts.p.forEach((p,i)=>{ const sw=bend*(0.7+0.3*Math.sin(t*2.2+p[3])); E.set(wdz*sw,0,-wdx*sw); Q.setFromEuler(E); V.set(p[0],p[1],p[2]); S.setScalar(p[4]); M.compose(V,Q,S); G.tufts.m.setMatrixAt(i,M); });
    G.tufts.m.instanceMatrix.needsUpdate=true; }
  for(const m of G.movers){
    if(m.kind==='graze'){ m.t+=dt; if(Math.sin(m.t*0.4)>0.3){ m.o.position.x+=Math.cos(m.o.rotation.y)*m.v*dt; m.o.position.z-=Math.sin(m.o.rotation.y)*m.v*dt; } else m.o.rotation.y+=dt*0.2*Math.sin(m.t);
      m.o.position.y=G.h(m.o.position.x,m.o.position.z); }
    else if(m.kind==='caravan'){ const k=(t*0.012+m.i*0.012)%1, x=m.base[0]+k*1600, z=m.base[1]+Math.sin(k*TAU)*120; m.o.position.set(x,G.h(x,z),z); m.o.rotation.y=-Math.atan2(Math.cos(k*TAU)*120*TAU/1600,1); m.o.rotation.z=Math.sin(t*3+m.i)*0.03; }
    else if(m.kind==='boat'){ m.a+=m.v*dt*(1-st*0.8); m.o.position.set(Math.cos(m.a)*m.r,Math.sin(t*1.3+m.r)*3*(1+st*2),Math.sin(m.a)*m.r); m.o.rotation.y=-m.a-Math.PI/2; m.o.rotation.z=Math.sin(t*1.1+m.r)*0.05*(1+st*3); }
    else if(m.kind==='flare'){ m.o.scale.setScalar(44+Math.sin(t*9)*8+Math.random()*6); }
  }
  for(const b of G.birds){ b.a+=b.v*dt*(1-st*0.5); const x=b.cx+Math.cos(b.a)*b.rad, z=b.cz+Math.sin(b.a)*b.rad; b.g.position.x=x; b.g.position.z=z; b.g.rotation.y=-b.a; const f=Math.sin(t*8+b.ph)*0.6; b.l.rotation.x=f; b.r.rotation.x=-f; b.g.visible=st<0.6; }
  // 鏡頭
  G.idle+=dt; if(G.idle>5) G.az+=dt*0.04;
  const c=G.cam, TG=G.target, ce=Math.cos(G.el);
  c.position.set(TG.x+G.dist*Math.sin(G.az)*ce, TG.y+G.dist*Math.sin(G.el), TG.z+G.dist*Math.cos(G.az)*ce); c.lookAt(TG);
  R3.render(G.scene,c);
}
// 指南針（北在上）：藍色箭頭是風吹去的方向，白色是風車正面
function updCompass(off){
  const w=$('#v3cw'), f=$('#v3cf'); if(!w) return;
  const deg=a=>a*180/Math.PI;
  // 箭頭預設朝上（北）；風吹去的方位角＝-windA，風車正面的方位角＝π-yaw（對準時兩者正好相反）
  w.setAttribute('transform',`rotate(${deg(-G.windA)} 30 30)`);
  f.setAttribute('transform',`rotate(${deg(Math.PI-G.yaw)} 30 30)`);
  f.style.stroke=Math.abs(off)<0.35?'#7bd36a':'#ffffff';
}

/* ---------- 操作 ---------- */
function bindInput(){
  const pts=new Map(); let st=null, pinch0=null;
  cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);G.idle=0;
    if(pts.size===1) st={x:e.clientX,y:e.clientY,az:G.az,el:G.el}; else if(pts.size===2){const [a,b]=[...pts.values()];pinch0={d:Math.hypot(a[0]-b[0],a[1]-b[1]),dist:G.dist};st=null;}});
  cv.addEventListener('pointermove',e=>{ if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,[e.clientX,e.clientY]); G.idle=0;
    if(pinch0&&pts.size===2){const [a,b]=[...pts.values()];G.dist=Math.max(150,Math.min(G.R*6+6000,pinch0.dist*pinch0.d/Math.hypot(a[0]-b[0],a[1]-b[1])));return;}
    if(st){G.az=st.az-(e.clientX-st.x)*0.006;G.el=Math.max(0.03,Math.min(1.4,st.el+(e.clientY-st.y)*0.004));}});
  const up=e=>{pts.delete(e.pointerId);if(pts.size<2)pinch0=null;st=null;};
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',e=>{e.preventDefault();G.idle=0;G.dist=Math.max(150,Math.min(G.R*6+6000,G.dist*Math.exp(e.deltaY*0.0012)));},{passive:false});
  const hold=(el,down,upf)=>{ el.addEventListener('pointerdown',e=>{e.preventDefault();down();el.classList.add('on');}); for(const ev of ['pointerup','pointerleave','pointercancel']) el.addEventListener(ev,()=>{upf();el.classList.remove('on');}); };
  hold($('#v3blow'),()=>G.blowing=true,()=>G.blowing=false);
  hold($('#v3l'),()=>G.yawCmd=1,()=>G.yawCmd=0);
  hold($('#v3r'),()=>G.yawCmd=-1,()=>G.yawCmd=0);
  $('#v3prot').onclick=()=>{ if(G.m!==2) return; G.prot=!G.prot; $('#v3prot').classList.toggle('on',G.prot); };
  $('#v3again').onclick=()=>startMission(0);
  document.addEventListener('keydown',e=>{ if(!G.open) return;
    const k=e.key; let used=true;
    if(k===' '){ G.blowing=true; $('#v3blow').classList.add('on'); }
    else if(k==='ArrowLeft') G.yawCmd=1; else if(k==='ArrowRight') G.yawCmd=-1;
    else if(k==='p'||k==='P'||k==='Enter') $('#v3prot').click();
    else if(k==='Escape') close(); else used=false;
    if(used){ e.preventDefault(); e.stopImmediatePropagation(); } },true);
  document.addEventListener('keyup',e=>{ if(!G.open) return;
    if(e.key===' '){ G.blowing=false; $('#v3blow').classList.remove('on'); } else if(e.key==='ArrowLeft'||e.key==='ArrowRight') G.yawCmd=0; },true);
  $('#v3close').onclick=close;
  $('#v3dn').onclick=()=>{ ctx.onNight&&ctx.onNight(!G.night); };
  window.addEventListener('resize',()=>{ if(G.open) resize(); });
}

window.WindGame3D={open,close,isOpen:()=>G.open,biomes:BIOMES,_G:G,_step:step}; // _G 方便在主控台除錯
})();
