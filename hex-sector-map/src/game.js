// Game logic, ported from the Claude artifact. Uses window.__hexBackend for live play.
(function(){
const S=40, S3=Math.sqrt(3);
const DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const key=(q,r)=>q+","+r;
const dist=(a,b)=>(Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs(a.q+a.r-b.q-b.r))/2;

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
function shuffle(arr,rng){for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}

/* ---------- Build the hexagon ---------- */
// Six Dropship corners, each exactly 5 hexes from its neighbours; every hex within 5 of the center.
const RADIUS=5;
const CORNER_QR=[[0,-RADIUS],[RADIUS,-RADIUS],[RADIUS,0],[0,RADIUS],[-RADIUS,RADIUS],[-RADIUS,0]];
const NC=CORNER_QR.length;
function toPx(q,r){return [1.5*q, S3*(r+q/2)];}
const cellSet=new Map();
for(let q=-RADIUS;q<=RADIUS;q++)for(let r=-RADIUS;r<=RADIUS;r++){if(Math.abs(q+r)<=RADIUS){const [x,y]=toPx(q,r);cellSet.set(key(q,r),{q,r,x,y});}}
const CELLS=[...cellSet.values()].map(c=>({q:c.q,r:c.r,x:c.x*S,y:c.y*S}));
const byKey=new Map(CELLS.map(c=>[key(c.q,c.r),c]));
CELLS.forEach(c=>{c.nb=DIRS.map(d=>byKey.get(key(c.q+d[0],c.r+d[1]))).filter(Boolean);});
const CORNERS=CORNER_QR.map(([q,r])=>byKey.get(key(q,r)));
const CENTER=byKey.get(key(0,0));

/* ---------- Type catalogue ---------- */
const PLAYER_COLORS=["#e5484d","#3e7bfa","#30a46c","#f76b15","#8e4ec6","#8a5a2b"];
const PLAYER_NAMES=["Red","Blue","Green","Orange","Purple","Brown"];
// 18 Special hexes in total (center Fortress included)
const TYPE_COUNTS={"Mech Bay":4,"Air Base":4,"Forward Base":4,"Comm Station":3,"Fortress":3};
const N_SPECIAL=Object.values(TYPE_COUNTS).reduce((a,b)=>a+b,0);
const SPECIALS={
  "Mech Bay":{color:"#4ea3e0"},
  "Air Base":{color:"#b58cf0"},
  "Forward Base":{color:"#7cc36b"},
  "Comm Station":{color:"#3fc5c0"},
  "Fortress":{color:"#e05a4f"}
};
const TERRAIN={
  Forest:{tier:"Basic",base:"#3f6b3a"}, Grassland:{tier:"Basic",base:"#93b65c"},
  Desert:{tier:"Basic",base:"#e2c27c"}, Tundra:{tier:"Basic",base:"#c8d2c3"},
  River:{tier:"Rough",base:"#8aac5c"}, Ice:{tier:"Rough",base:"#d3e9f2"},
  Lava:{tier:"Rough",base:"#3b2b28"}, Hills:{tier:"Rough",base:"#b09f66"}, Swamp:{tier:"Rough",base:"#5e7a50"},
  Mountains:{tier:"Impassible",base:"#8b8680"}, Ocean:{tier:"Impassible",base:"#2f6f9e"}, Volcano:{tier:"Impassible",base:"#4a3b37"}
};

/* ---------- Generation ---------- */
function field(rng){
  const bumps=[];for(let i=0;i<4;i++)bumps.push({x:(rng()-.5)*14*S,y:(rng()-.5)*14*S,w:(rng()*2-1),s:(2.5+rng()*3)*S});
  const ang=rng()*Math.PI*2, gx=Math.cos(ang), gy=Math.sin(ang);
  const raw=CELLS.map(c=>{let v=(c.x*gx+c.y*gy)/(8*S);for(const b of bumps){const d2=((c.x-b.x)**2+(c.y-b.y)**2)/(b.s*b.s);v+=b.w*Math.exp(-d2);}return v;});
  const order=raw.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]); const out=new Array(CELLS.length);
  order.forEach(([,i],rank)=>out[i]=rank/(CELLS.length-1)); return out;
}

function placeSpecials(rng){
  const dropSet=new Set(CORNERS);
  const blocked=new Set([CENTER,...CENTER.nb]);
  CORNERS.forEach(d=>{blocked.add(d);d.nb.forEach(n=>blocked.add(n));});
  const cand=CELLS.filter(c=>!blocked.has(c));
  let best=null,bestScore=-1e9;
  for(let t=0;t<500;t++){
    shuffle(cand,rng);
    const chosen=[];
    for(const minD of [3,2]){
      for(const c of cand){
        if(chosen.length>=N_SPECIAL-1)break;
        if(chosen.includes(c))continue;
        if([CENTER,...chosen].every(o=>dist(o,c)>=minD))chosen.push(c);
      }
    }
    if(chosen.length<N_SPECIAL-1)continue;
    const pts=[CENTER,...chosen];
    let minPair=99,sumPair=0;
    for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){const d=dist(pts[i],pts[j]);minPair=Math.min(minPair,d);}
    let cover=0,coverSum=0;
    for(const c of CELLS){if(dropSet.has(c))continue;let m=99;for(const p of pts)m=Math.min(m,dist(c,p));cover=Math.max(cover,m);coverSum+=m;}
    const wedges=new Array(NC).fill(0);
    chosen.forEach(c=>{let a=Math.atan2(c.y,c.x)+Math.PI/2;a=(a+Math.PI*4)%(Math.PI*2);wedges[Math.floor(a/(Math.PI*2/NC))%NC]++;});
    const bal=wedges.reduce((s,w)=>s+Math.abs(w-(N_SPECIAL-1)/NC),0);
    const score=minPair*4-cover*3-coverSum*0.08-bal*1.5+rng()*0.8;
    if(score>bestScore){bestScore=score;best=chosen.slice();}
  }
  return best;
}


// Pick k cells from cand spread evenly across the map (away from each other and from `fixed`)
function spreadPick(cand,k,fixed,rng,trials,thresholds){
  cand=cand.slice();let best=null,bestScore=-1e9;
  const wedge=c=>{let a=Math.atan2(c.y,c.x)+Math.PI/2;a=(a+Math.PI*4)%(Math.PI*2);return Math.floor(a/(Math.PI*2/NC))%NC;};
  for(let t=0;t<trials;t++){
    shuffle(cand,rng);const chosen=[];const inC=new Set();
    for(const minD of thresholds){
      for(const c of cand){
        if(chosen.length>=k)break;if(inC.has(c))continue;
        if(fixed.every(o=>dist(o,c)>=minD)&&chosen.every(o=>dist(o,c)>=minD)){chosen.push(c);inC.add(c);}
      }
    }
    if(chosen.length<k)continue;
    const pts=[...fixed,...chosen];let adj=0;
    for(const c of chosen)for(const o of pts)if(o!==c&&dist(o,c)===1)adj++;
    let cover=0,coverSum=0;
    for(const c of cand){let m=99;for(const p of chosen)m=Math.min(m,dist(c,p));cover=Math.max(cover,m);coverSum+=m;}
    const w=new Array(NC).fill(0);chosen.forEach(c=>w[wedge(c)]++);
    const bal=w.reduce((s,x)=>s+Math.abs(x-k/NC),0);
    const score=-adj*3-cover*2-coverSum*0.1-bal*1.5+rng()*0.8;
    if(score>bestScore){bestScore=score;best=chosen;}
  }
  return best;
}


// Give the non-center Special hexes their types so that no two of the same type are within 2 hexes
function assignTypes(sp,rng){
  const pool=[];Object.keys(SPECIALS).forEach(k=>{for(let i=0;i<TYPE_COUNTS[k]-(k==="Fortress"?1:0);i++)pool.push(k);});
  const cells=[CENTER,...sp];let best=null,bestScore=-1e9;
  for(let t=0;t<400;t++){
    const types=["Fortress",...shuffle(pool.slice(),rng)];
    let minSame=99,sumSame=0;
    for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++)if(types[i]===types[j]){const d=dist(cells[i],cells[j]);minSame=Math.min(minSame,d);sumSame+=d;}
    if(minSame<3)continue;
    const score=minSame*5+sumSame*0.1+rng();
    if(score>bestScore){bestScore=score;best=types.slice(1);}
  }
  return best;
}

function generate(seed){
  const rng=mulberry32(seed);
  for(let attempt=0;attempt<60;attempt++){
    const map=new Map();
    CORNERS.forEach((c,i)=>map.set(c,{kind:"Dropship",seat:i}));
    map.set(CENTER,{kind:"Special",name:"Fortress"});
    const sp=placeSpecials(rng);
    if(!sp)continue;
    const types=assignTypes(sp,rng);
    if(!types)continue;
    sp.forEach((c,i)=>map.set(c,{kind:"Special",name:types[i]}));
    const basics=CELLS.filter(c=>!map.has(c));
    // tiers
    const T=field(rng),M=field(rng),R=field(rng);
    const idx=new Map(CELLS.map((c,i)=>[c,i]));
    const nImp=Math.floor(basics.length*0.10), nRough=Math.round(basics.length*0.30);
    const impSet=new Set(spreadPick(basics,nImp,[],rng,250,[4,3,2,1]));
    const roughSet=new Set(spreadPick(basics.filter(c=>!impSet.has(c)),nRough,[...impSet],rng,250,[3,2,1]));
    basics.forEach(c=>{
      const tier=impSet.has(c)?"Impassible":roughSet.has(c)?"Rough":"Basic";
      const t=T[idx.get(c)],m=M[idx.get(c)]; let name;
      if(tier==="Basic") name=t<0.18?"Tundra":m>0.6?"Forest":(m<0.35&&t>0.45)?"Desert":"Grassland";
      else if(tier==="Rough") name=t<0.22?"Ice":(t>0.78&&m<0.55)?"Lava":m>0.62?(t>0.55?"Swamp":"River"):"Hills";
      else name=(t>0.75&&m<0.6)?"Volcano":m>0.58?"Ocean":"Mountains";
      map.set(c,{kind:"Terrain",name,tier,variant:Math.floor(rng()*6),highway:false});
    });
    // Special hexes sit on Basic or Rough ground (2:1, matching the 60/30 Basic-to-Rough mix)
    const spCells=[CENTER,...sp];
    const nSpRough=Math.round(spCells.length/3);
    const spRough=new Set(spreadPick(spCells,nSpRough,[],rng,120,[3,2,1]));
    spCells.forEach(c=>{
      const t=T[idx.get(c)],m=M[idx.get(c)];const tier=spRough.has(c)?"Rough":"Basic";
      const name=tier==="Basic"?(t<0.18?"Tundra":m>0.6?"Forest":(m<0.35&&t>0.45)?"Desert":"Grassland"):(t<0.22?"Ice":(t>0.78&&m<0.55)?"Lava":m>0.62?(t>0.55?"Swamp":"River"):"Hills");
      map.get(c).ground={name,tier,variant:Math.floor(rng()*6)};
    });
    // connectivity of all passable hexes
    const passable=c=>{const d=map.get(c);return !(d.kind==="Terrain"&&d.tier==="Impassible");};
    const start=CORNERS[0],seen=new Set([start]),q=[start];
    while(q.length){const c=q.shift();for(const n of c.nb)if(passable(n)&&!seen.has(n)){seen.add(n);q.push(n);}}
    if(seen.size!==CELLS.filter(passable).length)continue;
    const roads=buildHighways(map,rng);
    return {map,roads,seed};
  }
  return null;
}

function buildHighways(map,rng){
  const nTerrain=CELLS.filter(c=>map.get(c).kind==="Terrain").length;
  const target=Math.round(nTerrain*0.25)-Math.floor(rng()*2);
  const nodes=CELLS.filter(c=>map.get(c).kind!=="Terrain");
  const isRoadable=c=>map.get(c).kind==="Terrain";
  const edges=new Set(),hw=new Set();
  const addEdge=(a,b)=>edges.add([key(a.q,a.r),key(b.q,b.r)].sort().join("|"));
  function path(a,b){
    const prev=new Map([[a,null]]),q=[a];
    while(q.length){const c=q.shift();if(c===b)break;
      for(const n of shuffle(c.nb.slice(),rng)){if(prev.has(n))continue;if(n!==b&&!isRoadable(n))continue;prev.set(n,c);q.push(n);}}
    if(!prev.has(b))return null;const p=[];let c=b;while(c){p.unshift(c);c=prev.get(c);}return p;
  }
  const pairs=[];
  for(const a of nodes){
    const near=nodes.filter(b=>b!==a&&map.get(b).kind==="Special").sort((x,y)=>dist(a,x)-dist(a,y)).slice(0,2);
    near.forEach(b=>pairs.push([a,b,map.get(a).kind==="Dropship"?0:1]));
  }
  shuffle(pairs,rng).sort((x,y)=>x[2]-y[2]);
  for(const [a,b] of pairs){
    const remaining=target-hw.size; if(remaining<=0)break;
    const p=path(a,b); if(!p)continue;
    const fresh=p.slice(1,-1).filter(c=>!hw.has(c));
    if(fresh.length===0||fresh.length>remaining)continue;
    p.slice(1,-1).forEach(c=>{hw.add(c);map.get(c).highway=true;});
    for(let i=0;i<p.length-1;i++)addEdge(p[i],p[i+1]);
  }
  let guard=0;
  while(hw.size<target&&guard++<500){
    const from=[...hw,...nodes][Math.floor(rng()*(hw.size+nodes.length))];
    const opts=from.nb.filter(n=>isRoadable(n)&&!hw.has(n));
    if(!opts.length)continue;
    const n=opts[Math.floor(rng()*opts.length)];
    hw.add(n);map.get(n).highway=true;addEdge(from,n);
  }
  return [...edges].map(e=>e.split("|").map(k=>byKey.get(k)));
}

/* ---------- Drawing ---------- */
const hexPts=(s)=>{const p=[];for(let i=0;i<6;i++){const a=Math.PI/3*i;p.push((s*Math.cos(a)).toFixed(2)+","+(s*Math.sin(a)).toFixed(2));}return p.join(" ");};
const HEX=hexPts(S), INNER=hexPts(S*0.84);

function decor(name,v){
  const rot=v*60;
  switch(name){
    case "Forest":{const t=(x,y,k)=>`<path d="M${x} ${y-10*k}L${x+8*k} ${y+5*k}H${x-8*k}Z" fill="#284a26"/><path d="M${x} ${y-4*k}L${x+9*k} ${y+9*k}H${x-9*k}Z" fill="#2f5a2c"/><rect x="${x-1.5}" y="${y+9*k}" width="3" height="${4*k}" fill="#4a3522"/>`;
      return t(-14,-6,.9)+t(12,-10,.8)+t(2,6,1)+t(-20,14,.7)+t(22,10,.7);}
    case "Grassland":{let s="";[[-18,-12],[10,-16],[-4,2],[18,6],[-16,16],[6,20],[24,-4]].forEach(([x,y])=>s+=`<path d="M${x-4} ${y}l2 -6M${x} ${y}v-7M${x+4} ${y}l-2 -6" stroke="#6b8f3e" stroke-width="1.6" stroke-linecap="round" fill="none"/>`);return s;}
    case "Desert":return `<g transform="rotate(${rot/3})" fill="none" stroke="#c19a52" stroke-width="2" stroke-linecap="round"><path d="M-30 -8q10 -9 22 0"/><path d="M-6 6q12 -10 26 0"/><path d="M-24 20q9 -7 18 0"/><path d="M6 -20q8 -6 16 0"/></g><circle cx="16" cy="18" r="1.6" fill="#a88445"/>`;
    case "Tundra":return `<g fill="#9fae9a"><circle cx="-14" cy="-10" r="2"/><circle cx="10" cy="-4" r="1.6"/><circle cx="-4" cy="14" r="2"/><circle cx="20" cy="14" r="1.5"/></g><g stroke="#f4f8f6" stroke-width="3" stroke-linecap="round"><path d="M-24 4h12M4 -18h14M2 24h12"/></g>`;
    case "River":return `<g transform="rotate(${rot})"><path d="M-44 -6C-20 -22 -6 16 14 2S34 -8 44 4" stroke="#2f6f9e" stroke-width="10" fill="none"/><path d="M-44 -6C-20 -22 -6 16 14 2S34 -8 44 4" stroke="#5aa2d6" stroke-width="5" fill="none"/></g>`;
    case "Ice":return `<g stroke="#8fb9cc" stroke-width="1.6" fill="none" transform="rotate(${rot})"><path d="M-30 -10l14 6l8 -10l14 14l16 -4"/><path d="M-16 -4l-4 18l12 8"/><path d="M14 10l6 16"/></g><path d="M-8 -22l6 4l-4 5z" fill="#fff" opacity=".8"/>`;
    case "Lava":return `<g transform="rotate(${rot})" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M-34 -4l12 -6l10 10l12 -12l12 8l14 -4" stroke="#ff7a2a" stroke-width="4"/><path d="M-6 0l-6 18l10 10M18 -4l4 22" stroke="#ffb13a" stroke-width="2.5"/></g>`;
    case "Hills":return `<g fill="#8e7f4d"><path d="M-30 10q12 -22 26 0z"/><path d="M-4 16q14 -26 30 0z"/><path d="M-6 -8q10 -18 22 0z"/></g><g fill="#c7b77c"><path d="M-24 4q5 -9 10 -8q-4 5 -3 8z"/><path d="M4 8q6 -11 12 -10q-5 6 -4 10z"/></g>`;
    case "Swamp":return `<g fill="#4c6b6a"><ellipse cx="-12" cy="-6" rx="12" ry="5"/><ellipse cx="14" cy="10" rx="13" ry="5"/><ellipse cx="-10" cy="18" rx="7" ry="3"/></g><g stroke="#2f4a27" stroke-width="1.8" stroke-linecap="round"><path d="M4 -10v-10M8 -10v-7M22 -2v-9M-26 8v-8M-22 8v-6"/></g>`;
    case "Mountains":return `<path d="M-34 20L-10 -18L8 12L20 -6L36 20Z" fill="#5d5955"/><path d="M-10 -18L-2 -5L-8 -8L-14 -4L-17 -7Z" fill="#fff"/><path d="M20 -6L26 3L21 1L16 4Z" fill="#fff"/><path d="M-10 -18L8 12L-4 20H-34Z" fill="#6f6a65" opacity=".6"/>`;
    case "Ocean":return `<g fill="none" stroke="#8fc3e6" stroke-width="2" stroke-linecap="round"><path d="M-30 -12q5 -5 10 0t10 0t10 0"/><path d="M-4 4q5 -5 10 0t10 0t10 0"/><path d="M-28 18q5 -5 10 0t10 0"/><path d="M6 -22q5 -5 10 0t10 0"/></g>`;
    case "Volcano":return `<path d="M-30 22L-8 -10H8L30 22Z" fill="#2c2220"/><path d="M-8 -10H8L4 -4H-4Z" fill="#ff7a2a"/><path d="M-2 -6L-8 10L0 4L2 18" stroke="#ff7a2a" stroke-width="2.5" fill="none" stroke-linejoin="round"/><g fill="#8a817e" opacity=".75"><circle cx="-2" cy="-18" r="5"/><circle cx="6" cy="-24" r="6"/><circle cx="14" cy="-30" r="4"/></g>`;
  }
  return "";
}

function icon(name,col){
  const w="#f3f5f4";
  switch(name){
    case "Mech Bay":return `<circle r="9" fill="none" stroke="${col}" stroke-width="5" stroke-dasharray="3.6 3.47"/><circle r="8" fill="none" stroke="${col}" stroke-width="3"/><circle r="3" fill="${w}"/>`;
    case "Air Base":return `<path d="M0 -12L2 -4L11 1V3L2 1L1 8L4 10V11.5L0 10.5L-4 11.5V10L-1 8L-2 1L-11 3V1L-2 -4Z" fill="${col}"/>`;
    case "Forward Base":return `<path d="M-12 11L-3 -3L6 11Z" fill="${col}"/><path d="M-3 11L-3 4L1 11Z" fill="#283039"/><path d="M5 11V-12" stroke="${w}" stroke-width="2"/><path d="M5 -12H14L11 -8L14 -4H5Z" fill="${col}"/>`;
    case "Comm Station":return `<path d="M-7 12L0 -6L7 12M-4.5 5H4.5" stroke="${w}" stroke-width="2" fill="none"/><circle cy="-7" r="2.5" fill="${col}"/><g fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"><path d="M-7 -12a8 8 0 0 0 0 10M7 -12a8 8 0 0 1 0 10M-11 -15a13 13 0 0 0 0 16M11 -15a13 13 0 0 1 0 16"/></g>`;
    case "Fortress":return `<path d="M-12 12V-8H-8.6V-4H-5.2V-8H-1.8V-4H1.8V-8H5.2V-4H8.6V-8H12V12H4V5A4 4 0 0 0 -4 5V12Z" fill="${col}"/>`;
    case "Dropship":{const a=col||"#f2b134";return `<path d="M-7 6L-10 9.5M7 6L10 9.5M-2.6 7.5L-3 10M2.6 7.5L3 10" stroke="#1f1f1f" stroke-width="1.6" stroke-linecap="round"/><path d="M-11.8 9.3h3.6l.4 1.7h-4.4zM8.2 9.3h3.6l.4 1.7H7.8zM-4.6 9.8h3.2l.3 1.6h-3.8zM1.4 9.8h3.2l.3 1.6H1.1z" fill="#1f1f1f"/><path d="M-11 2H11L9 8H-9Z" fill="#1f1f1f"/><circle cy="-5" r="12.5" fill="#1f1f1f"/><rect x="-2" y="-19.8" width="4" height="3" rx="1.5" fill="#1f1f1f"/><path d="M-12.4 -0.8H12.4" stroke="${a}" stroke-width="1.3" opacity=".85"/><path d="M-10.6 3.4H10.6" stroke="${a}" stroke-width=".8" stroke-dasharray="1.2 1" opacity=".7"/><circle cx="5.5" cy="-9" r="2.1" fill="${a}" opacity=".8"/>`;}
  }
}

function cellSVG(c,d,clipId){
  let inner="",tint="",label="",border="";
  if(d.kind==="Terrain"){
    const t=TERRAIN[d.name];
    inner=`<polygon points="${HEX}" fill="${t.base}"/>`+decor(d.name,d.variant);
    if(d.tier==="Rough")border=`<polygon points="${INNER}" fill="none" stroke="rgba(20,20,20,.45)" stroke-width="1.6" stroke-dasharray="5 4"/>`;
    if(d.tier==="Impassible")border=`<polygon points="${INNER}" fill="none" stroke="rgba(10,10,10,.7)" stroke-width="3"/>`;
  }else if(d.kind==="Dropship"){
    inner=`<polygon points="${HEX}" fill="#f2b134"/><g stroke="#1f1f1f" stroke-width="5" opacity=".22">${[-48,-32,-16,0,16,32,48].map(x=>`<path d="M${x-20} 40L${x+20} -40"/>`).join("")}</g><polygon points="${hexPts(S*0.62)}" fill="#f7c95e"/>`;
    if(d.seat!=null)border=`<polygon points="${INNER}" fill="none" stroke="${PLAYER_COLORS[d.seat]}" stroke-width="5"/>`;
    label=`<g transform="translate(0,4)">${icon("Dropship","#f2b134")}</g><text y="-21" text-anchor="middle" font-family="Chakra Petch, Arial Narrow, sans-serif" font-size="8.5" font-weight="700" fill="#1f1f1f">${d.seat!=null?"P"+(d.seat+1)+" ":""}DROPSHIP</text>`;
  }else{
    const col=SPECIALS[d.name].color;
    if(d.ground){
      inner=`<polygon points="${HEX}" fill="${TERRAIN[d.ground.name].base}"/>`+decor(d.ground.name,d.ground.variant);
      border=`<polygon points="${INNER}" fill="none" stroke="${col}" stroke-width="4"/>`+
        (d.ground.tier==="Rough"?`<polygon points="${hexPts(S*0.7)}" fill="none" stroke="rgba(20,20,20,.55)" stroke-width="1.6" stroke-dasharray="5 4"/>`:"");
    }else inner=`<polygon points="${HEX}" fill="#283039"/><polygon points="${INNER}" fill="none" stroke="${col}" stroke-width="3"/>`;
    const w=d.name.length*4.3+8;
    label=`<g transform="translate(0,-6)">${icon(d.name,col)}</g><rect x="${-w/2}" y="14" width="${w}" height="10" rx="3" fill="#283039" opacity=".92"/><text y="21.6" text-anchor="middle" font-family="Chakra Petch, Arial Narrow, sans-serif" font-size="8" font-weight="600" fill="#f3f5f4">${d.name}</text>`;
  }
  return {body:`<g clip-path="url(#${clipId})">${inner}</g>${border}`,label};
}

function describe(d){
  if(d.kind==="Dropship")return ["Dropship",d.seat!=null?`Player ${d.seat+1} (${PLAYER_NAMES[d.seat]}) landing zone`:"Landing zone at a hexagon point"];
  if(d.kind==="Special")return [d.name,d.ground?`Special hex on ${d.ground.name} (${d.ground.tier})`:"Special hex"];
  return [d.name+(d.highway?" with highway":""),`${d.tier} hex${d.highway?" (highway modifier)":""}`];
}

function render(res){
  const svg=document.getElementById("map");
  const xs=CELLS.map(c=>c.x),ys=CELLS.map(c=>c.y);
  const minX=Math.min(...xs)-S-6,maxX=Math.max(...xs)+S+6,minY=Math.min(...ys)-S-6,maxY=Math.max(...ys)+S+6;
  svg.setAttribute("viewBox",`${minX} ${minY} ${maxX-minX} ${maxY-minY}`);
  let out=`<defs><clipPath id="hc"><polygon points="${HEX}"/></clipPath></defs>`;
  const cx=CORNERS.reduce((s,c)=>s+c.x,0)/NC,cy=CORNERS.reduce((s,c)=>s+c.y,0)/NC;
  const pent=CORNERS.map(c=>`${(cx+(c.x-cx)*1.12).toFixed(1)},${(cy+(c.y-cy)*1.12).toFixed(1)}`).join(" ");
  out+=`<polygon points="${pent}" fill="none" stroke="var(--outline)" stroke-width="2" stroke-dasharray="8 7"/>`;
  let tiles="",labels="",roads="";
  CELLS.forEach((c,i)=>{
    const d=res.map.get(c),parts=cellSVG(c,d,"hc");
    tiles+=`<g class="hexcell" data-i="${i}" tabindex="0" transform="translate(${c.x.toFixed(2)},${c.y.toFixed(2)})"><title>${describe(d)[0]}</title>${parts.body}<polygon points="${HEX}" fill="none" stroke="rgba(15,20,25,.55)" stroke-width="1.2"/><polygon class="hl" points="${hexPts(S-2)}"/></g>`;
    if(parts.label)labels+=`<g transform="translate(${c.x.toFixed(2)},${c.y.toFixed(2)})" pointer-events="none">${parts.label}</g>`;
  });
  // Draw each highway only inside the hex that carries it: center to shared edge
  const halves=[];
  res.roads.forEach(([a,b])=>{const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    if(res.map.get(a).highway)halves.push([a.x,a.y,mx,my]);
    if(res.map.get(b).highway)halves.push([b.x,b.y,mx,my]);});
  halves.forEach(([x1,y1,x2,y2])=>roads+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2b2b2b" stroke-width="9"/>`);
  CELLS.forEach(c=>{if(res.map.get(c).highway)roads+=`<circle cx="${c.x}" cy="${c.y}" r="4.5" fill="#2b2b2b"/>`;});
  halves.forEach(([x1,y1,x2,y2])=>roads+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f2d25c" stroke-width="1.5" stroke-dasharray="5 5"/>`);
  out+=tiles+`<g pointer-events="none">${roads}</g>`;
  // badges over roads for specials & dropships
  CELLS.forEach(c=>{const d=res.map.get(c);if(d.kind==="Special")labels=`<g transform="translate(${c.x},${c.y})" pointer-events="none"><circle cy="-6" r="15" fill="#283039"/></g>`+labels;
    if(d.kind==="Dropship")labels=`<g transform="translate(${c.x},${c.y})" pointer-events="none"><circle cy="0" r="17" fill="#f7c95e"/></g>`+labels;});
  out+=labels+`<g id="dmg" pointer-events="none"></g><g id="reach" pointer-events="none"></g><g id="salv" pointer-events="none"></g><g id="tokens"></g>`;
  svg.innerHTML=out;
  // totals
  const cnt={};let hw=0;
  let spB=0,spR=0;
  res.map.forEach(d=>{const k=d.kind==="Terrain"?d.tier:d.kind==="Special"?d.name:"Dropship";cnt[k]=(cnt[k]||0)+1;if(d.highway)hw++;
    if(d.ground){if(d.ground.tier==="Rough")spR++;else spB++;}});
  const basicTotal=(cnt.Basic||0)+(cnt.Rough||0)+(cnt.Impassible||0);
  const specTotal=Object.keys(SPECIALS).reduce((s,k)=>s+(cnt[k]||0),0);
  const row=(a,b,cls="")=>`<tr class="${cls}"><td>${a}</td><td class="n">${b}</td></tr>`;
  document.getElementById("totals").innerHTML=
    row("Dropship hexes",cnt.Dropship,"grp")+
    row("Basic category",basicTotal,"grp")+row("Basic",cnt.Basic||0,"sub")+row("Rough",cnt.Rough||0,"sub")+row("Impassible",cnt.Impassible||0,"sub")+
    row(`Highway modifier (${Math.round(hw/basicTotal*100)}%)`,hw,"sub")+
    row("Special category",specTotal,"grp")+Object.keys(SPECIALS).map(k=>row(k+(k==="Fortress"?" (incl. center)":""),cnt[k]||0,"sub")).join("")+
    row("On Basic ground",spB,"sub")+row("On Rough ground",spR,"sub")+
    row("Total hexes",CELLS.length,"grp");
}

function legend(){
  const mini=(d)=>{const p=cellSVG(null,d,"lc");return `<svg width="34" height="30" viewBox="-42 -37 84 74" aria-hidden="true"><defs><clipPath id="lc"><polygon points="${HEX}"/></clipPath></defs>${p.body}<polygon points="${HEX}" fill="none" stroke="rgba(15,20,25,.55)" stroke-width="1.5"/>${d.kind==="Terrain"?"":`<g transform="scale(1.5)">${d.kind==="Dropship"?`<circle r="16" fill="#f7c95e"/>`+icon("Dropship"):`<circle r="15" fill="#283039"/>`+icon(d.name,SPECIALS[d.name].color)}</g>`}</svg>`;};
  let h="";
  [["Basic",["Forest","Grassland","Desert","Tundra"]],["Rough",["River","Ice","Lava","Hills","Swamp"]],["Impassible",["Mountains","Ocean","Volcano"]]].forEach(([tier,list])=>{
    h+=`<h3>${tier}</h3>`+list.map(n=>`<div>${mini({kind:"Terrain",name:n,tier,variant:0})}${n}</div>`).join("");
  });
  h+=`<h3>Special</h3>`+Object.keys(SPECIALS).map(n=>`<div>${mini({kind:"Special",name:n})}${n}</div>`).join("");
  h+=`<h3>Other</h3><div>${mini({kind:"Dropship"})}Dropship</div><div><svg width="34" height="30" viewBox="-42 -37 84 74" aria-hidden="true"><polygon points="${HEX}" fill="#93b65c" stroke="rgba(15,20,25,.55)" stroke-width="1.5"/><line x1="-40" y1="0" x2="40" y2="0" stroke="#2b2b2b" stroke-width="12"/><line x1="-40" y1="0" x2="40" y2="0" stroke="#f2d25c" stroke-width="2" stroke-dasharray="6 6"/></svg>Highway</div><div><svg width="34" height="30" viewBox="-17 -17 34 34" aria-hidden="true">${MECH_ICON}</svg>Lance (player color)</div><div><svg width="34" height="30" viewBox="-13 -13 26 26" aria-hidden="true">${SALV_ICON}</svg>Has salvage</div>`;
  document.getElementById("legend").innerHTML=h;
}

/* ---------- Multiplayer ---------- */
const MECHS=["Alpha","Beta","Gamma"];
const DEFAULT_MP=4, MAX_MP=20;
const $=id=>document.getElementById(id);
const seedInput=$("seed");
let RES=null, game={seed:null,epoch:"local"}, rawSeats=new Array(NC).fill(null);
let db=null,user=null,myId=null,live=false,canWrite=true,isEditor=true,names={};
let selected=null, reachMap=null, hoverCell=null, pinnedCell=null, localSeat=0;
let roadSet=new Set(); // "from|to" hex pairs joined by a highway, both directions
let destroyed=new Map(),dmgUnsub=null; // hexKey -> {special,highway}

const clone=o=>JSON.parse(JSON.stringify(o));
const fmt=n=>Number.isInteger(n)?String(n):(Math.round(n*10)/10).toString();
const newEpoch=()=>"e"+Date.now().toString(36)+Math.floor(Math.random()*1e6).toString(36);
let toastT=null;
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),3200);}

/* ----- actions ----- */
const ACTIONS={
  Confront:{code:"CON",rule:"Move up to full MP. May finish on an enemy lance's hex."},
  Hold:{code:"HLD",rule:"Move up to half MP. Can't enter an enemy lance's hex. Gains a green plus if it doesn't move."},
  Recon:{code:"REC",rule:"Move up to full MP. Can't enter an enemy lance's hex."},
  Destroy:{code:"DST",rule:"Move up to full MP. May finish on an enemy lance's hex."},
  Salvage:{code:"SLV",rule:"Move up to half MP. May finish on an enemy lance's hex."}
};
const ENDS_ON_ENEMY=new Set(["Confront","Destroy","Salvage"]);
function lowestWalk(m){const w=(m.walk||[]).filter(x=>typeof x==="number"&&x>0);return w.length?Math.min(...w):0;}
// A lance moves at the pace of its slowest mech: once any Walk MV is filled in, the lowest one is its MP
function mpOf(m){return lowestWalk(m)||m.mp;}
function allowance(m){const mp=mpOf(m);switch(m.action){case"Confront":case"Recon":case"Destroy":return mp;case"Hold":case"Salvage":return mp/2;default:return 0;}}
function spentOf(m){return typeof m.spent==="number"?m.spent:(typeof m.rem==="number"?Math.max(0,m.mp-m.rem):0);}
function remOf(m){return Math.max(0,Math.round((allowance(m)-spentOf(m))*10)/10);}
function holdBonus(m){return m.action==="Hold"&&spentOf(m)===0;}
function setAction(i,name,a){const s=clone(seat(i)),m=s.mechs[name];m.action=ACTIONS[a]?a:null;m.spent=spentOf(m);delete m.rem;writeSeat(i,s);}

function freshSeat(i,keep){
  const [q,r]=CORNER_QR[i],mechs={};
  MECHS.forEach(m=>{const mp=keep&&keep.mechs&&keep.mechs[m]&&typeof keep.mechs[m].mp==="number"?keep.mechs[m].mp:DEFAULT_MP;const ro=keep&&keep.mechs&&keep.mechs[m]&&Array.isArray(keep.mechs[m].roster)?keep.mechs[m].roster.slice(0,4):["","","",""];const km=keep&&keep.mechs&&keep.mechs[m]||{};mechs[m]={q,r,mp,spent:0,prev:null,roster:ro,walk:Array.isArray(km.walk)?km.walk.slice(0,4):[null,null,null,null],action:ACTIONS[km.action]?km.action:null,subtitle:typeof km.subtitle==="string"?km.subtitle:""};});
  return {owner:keep&&keep.owner?keep.owner:null,epoch:game.epoch,mechs};
}
function seat(i){const raw=rawSeats[i];if(!raw||raw.epoch!==game.epoch||!raw.mechs||!MECHS.every(m=>raw.mechs[m]))return freshSeat(i,raw);return raw;}
function mySeat(){if(!live)return localSeat;if(!myId)return -1;for(let i=0;i<NC;i++)if(seat(i).owner===myId)return i;return -1;}
function canControl(i){return !live||(myId!=null&&canWrite&&seat(i).owner===myId);}

/* ----- persistence ----- */
const queues={};
function writeSeat(i,data,quiet){
  data.epoch=game.epoch; rawSeats[i]=data; if(!quiet)refreshAll();
  if(!live)return;
  const path="seats/p"+(i+1);
  queues[path]=(queues[path]||Promise.resolve()).then(()=>db.doc(path).set(clone(rawSeats[i]))).catch(handleWriteErr);
}
function handleWriteErr(e){
  if(e&&e.code==="invalid_argument"){canWrite=false;toast("You can watch this game but can't make changes.");refreshAll();}
  else if(e&&e.code==="quota_exceeded")toast("The game's storage is full.");
  else toast("Couldn't save that change. Try again.");
}

/* ----- movement ----- */
function occupants(){const occ=new Map();for(let i=0;i<NC;i++){const s=seat(i);MECHS.forEach(m=>{const k=key(s.mechs[m].q,s.mechs[m].r);if(!occ.has(k))occ.set(k,[]);occ.get(k).push({seat:i,mech:m});});}return occ;}
function reach(si,name){
  const s=seat(si),m=s.mechs[name],start=byKey.get(key(m.q,m.r));
  const enemy=new Set();
  for(let j=0;j<NC;j++)if(j!==si){const sj=seat(j);MECHS.forEach(n=>enemy.add(key(sj.mechs[n].q,sj.mechs[n].r)));}
  if(!ACTIONS[m.action])return new Map();
  const budget=remOf(m),endOnEnemy=ENDS_ON_ENEMY.has(m.action);
  const best=new Map([[start,0]]),open=[start];
  while(open.length){
    open.sort((a,b)=>best.get(a)-best.get(b));const c=open.shift(),cc=best.get(c);
    for(const n of c.nb){
      const d=RES.map.get(n);
      if(d.kind==="Terrain"&&d.tier==="Impassible")continue;
      const isEnemy=enemy.has(key(n.q,n.r));
      if(isEnemy&&!endOnEnemy)continue;
      const rough=(d.kind==="Terrain"&&d.tier==="Rough")||(d.ground&&d.ground.tier==="Rough");
      const onRoad=(d.highway&&!hwyDown(n))||(roadSet.has(key(c.q,c.r)+"|"+key(n.q,n.r))&&RES.map.get(c).highway&&!hwyDown(c));
      const nc=cc+(onRoad?0.5:rough?2:1);
      if(nc>budget+1e-9)continue;
      if(!best.has(n)||nc<best.get(n)-1e-9){best.set(n,nc);if(!isEnemy)open.push(n);}
    }
  }
  best.delete(start);return best;
}
function selectMech(i,m){
  if(selected&&selected.seat===i&&selected.mech===m)selected=null;else selected={seat:i,mech:m};
  if(!live&&selected)localSeat=i;
  refreshAll();
}
function moveTo(c){
  const {seat:i,mech:name}=selected,cost=reachMap.get(c);
  const s=clone(seat(i)),m=s.mechs[name];
  const sp=spentOf(m);m.prev={q:m.q,r:m.r,spent:sp};m.q=c.q;m.r=c.r;m.spent=Math.round((sp+cost)*10)/10;delete m.rem;
  writeSeat(i,s);
}
function undo(i,name){const s=clone(seat(i)),m=s.mechs[name];if(!m.prev)return;m.q=m.prev.q;m.r=m.prev.r;m.spent=typeof m.prev.spent==="number"?m.prev.spent:(typeof m.prev.rem==="number"?Math.max(0,m.mp-m.prev.rem):0);delete m.rem;m.prev=null;writeSeat(i,s);}
function setMP(i,name,delta){const s=clone(seat(i)),m=s.mechs[name];const mp=Math.min(MAX_MP,Math.max(0,m.mp+delta));const d=mp-m.mp;if(!d)return;m.spent=spentOf(m);delete m.rem;m.mp=mp;writeSeat(i,s);}
/* ----- lance rosters (4 mechs per lance) ----- */
const rosterPending={};let rosterT=null;
function applyPending(){Object.keys(rosterPending).forEach(i=>{const s=clone(seat(+i));Object.entries(rosterPending[i]).forEach(([n,p])=>{if(p.roster)s.mechs[n].roster=p.roster;if(p.walk)s.mechs[n].walk=p.walk;if(typeof p.subtitle==="string")s.mechs[n].subtitle=p.subtitle;});s.epoch=game.epoch;rawSeats[+i]=s;});}
function setRoster(i,name,k,v){
  const r=((seat(i).mechs[name].roster)||[]).slice(0,4);while(r.length<4)r.push("");r[k]=v.slice(0,60);
  const p=((rosterPending[i]=rosterPending[i]||{})[name]=rosterPending[i][name]||{});p.roster=r;applyPending();
  clearTimeout(rosterT);rosterT=setTimeout(flushRoster,700);
}
function setSubtitle(i,name,v){
  const p=((rosterPending[i]=rosterPending[i]||{})[name]=rosterPending[i][name]||{});p.subtitle=v.slice(0,80);applyPending();
  clearTimeout(rosterT);rosterT=setTimeout(flushRoster,700);
}
function setWalk(i,name,k,v){
  const w=((seat(i).mechs[name].walk)||[]).slice(0,4);while(w.length<4)w.push(null);
  const n=parseFloat(v);w[k]=isFinite(n)&&n>0?Math.min(20,Math.round(n*2)/2):null;
  const p=((rosterPending[i]=rosterPending[i]||{})[name]=rosterPending[i][name]||{});p.walk=w;applyPending();
  clearTimeout(rosterT);rosterT=setTimeout(flushRoster,700);
}
function flushRoster(){clearTimeout(rosterT);Object.keys(rosterPending).forEach(i=>{applyPending();delete rosterPending[i];writeSeat(+i,clone(seat(+i)),true);});drawOverlay();renderInspect();}
function refill(i){const s=clone(seat(i));MECHS.forEach(n=>{s.mechs[n].spent=0;delete s.mechs[n].rem;s.mechs[n].prev=null;});writeSeat(i,s);}
function hexClick(c){
  pinnedCell=c;
  if(selected&&reachMap&&reachMap.has(c)&&canControl(selected.seat)){moveTo(c);return;}
  hoverCell=c;
  const here=(occupants().get(key(c.q,c.r))||[]);
  const mine=here.filter(o=>canControl(o.seat));
  if(mine.length){
    let idx=0;if(selected){const k=mine.findIndex(o=>o.seat===selected.seat&&o.mech===selected.mech);if(k>=0)idx=(k+1)%mine.length;}
    selected=null;selectMech(mine[idx].seat,mine[idx].mech);return;
  }
  if(here.length){selected=null;selectMech(here[0].seat,here[0].mech);return;}
  selected=null;refreshAll();
}

/* ----- seats ----- */
async function takeSeat(i){
  if(!live){localSeat=i;selected=null;refreshAll();return;}
  if(!myId){toast("Sign in to take a seat.");return;}
  const ref=db.doc("seats/p"+(i+1));
  try{
    const l=await ref.acquire({holder:myId,ttlMs:4000});
    if(!l.acquired){toast("Someone else is taking that seat.");return;}
    const snap=await ref.get(),cur=snap.exists?snap.data():null;
    if(cur&&cur.owner&&cur.owner!==myId){toast("That seat is already taken.");return;}
    const mine=mySeat();
    if(mine>=0&&mine!==i){const o=clone(seat(mine));o.owner=null;writeSeat(mine,o);}
    const base=cur&&cur.epoch===game.epoch&&cur.mechs?clone(cur):freshSeat(i,cur);
    base.owner=myId;selected=null;writeSeat(i,base);
  }catch(e){handleWriteErr(e);}
}
function leaveSeat(i){const s=clone(seat(i));s.owner=null;if(selected&&selected.seat===i)selected=null;writeSeat(i,s);}

/* ----- drawing ----- */
const OFFS={1:[[0,4]],2:[[-13,4],[13,4]],3:[[-22,4],[0,4],[22,4]],4:[[-12,-8],[12,-8],[-12,16],[12,16]],5:[[-22,-8],[0,-8],[22,-8],[-11,16],[11,16]],6:[[-22,-8],[0,-8],[22,-8],[-22,16],[0,16],[22,16]]};
// Mech silhouette traced from the reference image: separate head, shoulders, torso, arms and legs (about 23 wide, 32 tall)
const MECH_D="M2.3 -3.1L2.0 -2.9L2.0 1.8L2.7 2.7L2.7 3.6L2.0 4.4L2.0 10.2L3.1 11.6L3.1 12.1L2.0 13.2L2.0 13.8L1.1 14.8L1.0 15.8L1.3 16.0L6.8 16.0L7.0 15.8L6.9 14.5L5.9 13.3L5.9 12.8L5.3 12.1L5.4 11.4L6.3 10.3L6.3 5.8L5.3 4.7L5.3 3.4L5.9 2.7L6.0 2.3L5.9 -1.9L3.8 -2.0L3.6 -2.1L3.5 -2.8L3.4 -3.0ZM-2.2 -3.1L-3.4 -3.0L-3.6 -2.0L-5.7 -2.0L-5.9 -1.7L-5.9 2.5L-5.2 3.3L-5.2 4.7L-6.3 5.8L-6.3 10.3L-5.3 11.3L-5.2 12.1L-5.8 12.6L-6.0 13.6L-6.9 14.5L-7.0 15.7L-6.7 16.0L-1.3 16.0L-0.9 15.7L-1.0 14.8L-1.9 13.8L-2.2 13.0L-3.1 12.0L-3.0 11.4L-2.0 10.2L-2.0 4.4L-2.7 3.5L-2.7 2.7L-2.0 1.9L-2.0 -2.8ZM-0.8 -11.3L-1.7 -10.5L-1.6 -6.0L-1.7 -5.9L-3.0 -5.7L-3.1 -4.2L-2.5 -3.4L-1.6 -3.1L-1.6 -0.6L-0.6 0.2L0.4 0.2L1.6 -0.5L1.6 -3.2L2.3 -3.3L2.9 -3.9L3.1 -4.3L3.0 -5.7L2.8 -5.8L1.8 -5.8L1.6 -6.0L1.6 -10.6L0.8 -11.3ZM-11.2 -12.4L-11.4 -12.1L-11.3 -9.0L-10.3 -8.7L-10.3 -6.6L-11.0 -5.8L-11.0 0.8L-9.7 2.0L-7.5 1.9L-7.3 1.7L-7.3 -0.8L-8.1 -1.7L-8.1 -7.0L-6.3 -9.0L-6.3 -12.3L-6.4 -12.4ZM11.3 -12.4L6.3 -12.4L6.3 -8.9L8.1 -6.9L8.1 -1.7L7.4 -0.8L7.5 1.9L9.8 2.0L11.0 0.8L11.0 -5.7L10.4 -6.5L10.4 -8.7L11.1 -8.8L11.4 -9.0ZM4.1 -14.6L3.1 -14.5L3.0 -12.8L1.4 -11.5L1.4 -11.3L1.9 -10.6L1.9 -7.3L2.2 -7.1L3.6 -7.1L3.8 -7.3L3.8 -8.9L5.9 -11.0L5.9 -12.8ZM2.1 -15.9L-2.0 -15.9L-2.7 -15.1L-2.9 -13.7L-3.1 -14.6L-4.0 -14.6L-5.9 -12.8L-5.9 -10.9L-3.8 -8.9L-3.8 -7.5L-3.6 -7.2L-1.9 -7.2L-1.9 -10.7L-1.3 -11.3L-3.0 -12.9L-1.3 -11.8L1.4 -11.8L2.7 -12.9L2.7 -15.3Z";
// Dark backing fills the gaps between parts (like the reference), then the parts in the player's color
function mechShape(fill,stroke,sw){return `<path d="${MECH_D}" fill="${stroke}" stroke="${stroke}" stroke-width="${sw*2}" stroke-linejoin="round"/><path d="${MECH_D}" fill="${fill}"/>`;}
const MECH_ICON=mechShape("#8a9399","#141414",1.1);
// On Dropship hexes, mechs stand around the ship so it stays visible
const DOFFS={1:[[0,21]],2:[[-23,4],[23,4]],3:[[-23,4],[23,4],[0,21]]};
function drawOverlay(){
  const reachG=$("reach"),tokG=$("tokens");if(!reachG)return;
  reachMap=null;let rs="";
  if(selected&&canControl(selected.seat)){
    reachMap=reach(selected.seat,selected.mech);
    const col=PLAYER_COLORS[selected.seat];
    reachMap.forEach((cost,c)=>{
      rs+=`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})"><polygon points="${hexPts(S-4)}" fill="rgba(255,255,255,.3)" stroke="${col}" stroke-width="3" stroke-dasharray="6 4"/><rect x="-13" y="-33" width="26" height="12" rx="6" fill="${col}"/><text y="-24" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-size="9" font-weight="700" fill="#fff">${fmt(cost)}</text></g>`;
    });
  }
  reachG.innerHTML=rs;
  let ts="";
  occupants().forEach((list,k)=>{
    const c=byKey.get(k),nn=Math.min(6,list.length),isDrop=RES.map.get(c).kind==="Dropship"&&nn<=3,offs=(isDrop?DOFFS:OFFS)[nn];
    list.forEach((o,j)=>{
      const [ox,oy]=offs[j%offs.length],col=PLAYER_COLORS[o.seat],m=seat(o.seat).mechs[o.mech];
      const rem=remOf(m),act=ACTIONS[m.action],lab=act?fmt(rem):"–",w=lab.length*5.2+7,spent=act&&rem<allowance(m),sc=isDrop?(oy>15?.85:.95):(nn>=4?.8:nn>=3?1.05:1.25),[bx,by]=isDrop?(oy>15?[9,-8]:ox<0?[-5-w,-25]:[5,-25]):[5,-25];
      const sel=selected&&selected.seat===o.seat&&selected.mech===o.mech;
      ts+=`<g class="mech" data-mech="${o.seat}:${o.mech}" tabindex="0" role="button" aria-label="${PLAYER_NAMES[o.seat]} ${o.mech} Lance, ${act?m.action+", "+fmt(rem)+" of "+fmt(allowance(m))+" movement points left":"no action chosen"}" transform="translate(${(c.x+ox).toFixed(1)},${(c.y+oy).toFixed(1)}) scale(${sc})">
        ${sel?mechShape("#f2b134","#f2b134",2.8):""}
        ${mechShape(col,"#141414",1.1)}
        <g transform="translate(0,-4.4)"><circle r="5.4" fill="#fff" stroke="#141414" stroke-width="1"/><text y="3" text-anchor="middle" font-family="Chakra Petch, Arial, sans-serif" font-size="8.4" font-weight="700" fill="#1e2b36">${o.mech[0]}</text></g>
        <g transform="translate(${bx},${by})"><rect width="${w}" height="12" rx="6" fill="${act&&rem===0?"#6b7479":"#1e2b36"}" stroke="${col}" stroke-width="1.5"/><text x="${w/2}" y="9" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-size="8.5" font-weight="700" fill="${spent?"#f2d25c":"#fff"}">${lab}</text></g>
        ${act?`<g transform="translate(0,22)"><rect x="-11" y="-5" width="22" height="10" rx="2.5" fill="#1e2b36" stroke="${col}" stroke-width="1.2"/><text y="2.9" text-anchor="middle" font-family="Chakra Petch, Arial Narrow, sans-serif" font-size="7" font-weight="700" fill="#fff" letter-spacing=".3">${act.code}</text></g>`:""}
        ${holdBonus(m)?`<g transform="translate(13.5,4)"><circle r="5.6" fill="#2fb344" stroke="#fff" stroke-width="1.4"/><path d="M-3 0H3M0 -3V3" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></g>`:""}
      </g>`;
    });
  });
  tokG.innerHTML=ts;
  drawDamage();drawSalvageMarks();markCells();
}

function renderInspect(){
  const insp=$("inspect");if(!RES)return;
  insp.textContent="";
  const add=(cls,txt,parent)=>{const d=document.createElement("div");d.className=cls;d.textContent=txt;(parent||insp).appendChild(d);return d;};
  if(selected){
    const m=seat(selected.seat).mechs[selected.mech];
    add("name",`${PLAYER_NAMES[selected.seat]} ${selected.mech} Lance`);
    if(m.subtitle&&m.subtitle.trim())add("subt",m.subtitle);
    if(ACTIONS[m.action]){
      add("meta",`Action: ${m.action}${holdBonus(m)?" (+ holding position)":""}. ${ACTIONS[m.action].rule}`);
      add("meta",`${fmt(remOf(m))} of ${fmt(allowance(m))} MP left this turn. ${canControl(selected.seat)?"Click a highlighted hex to move.":"Belongs to another player."}`);
    }else add("meta",canControl(selected.seat)?"No action chosen. Pick one in the Lances panel to move.":"No action chosen yet. Belongs to another player.");
    const ro=(m.roster||[]).filter(x=>x&&x.trim());
    if(ro.length){const ol=document.createElement("ol");ol.className="rlist";(m.roster||[]).forEach((x,k)=>{if(!x||!x.trim())return;const li=document.createElement("li");const wv=(m.walk||[])[k];li.textContent=x+(typeof wv==="number"?` (Walk ${fmt(wv)})`:"");ol.appendChild(li);});insp.appendChild(ol);}
    else add("meta","Lance roster not filled in yet.");
    if(hoverCell&&reachMap){const cost=reachMap.get(hoverCell);const [n]=describe(RES.map.get(hoverCell));add("meta",cost!=null?`${n}: costs ${fmt(cost)} MP to reach`:`${n}: out of reach`);}
  }
  const c=pinnedCell||(selected?null:hoverCell);
  if(!c){if(!selected){add("name","Select a hex");add("meta","Tap any hex to see its type and salvage, or tap a lance to move it.");}return;}
  const sec=document.createElement("div");if(selected)sec.className="salv";insp.appendChild(sec);
  const [n,mm]=describe(RES.map.get(c));
  add(selected?"mname":"name",n,sec);add("meta",`${mm} · Hex ${c.q}, ${c.r}${c===CENTER?" (center)":""}`,sec);
  const dd=RES.map.get(c),dv=destroyed.get(key(c.q,c.r))||{};
  if(dd.kind==="Special"||dd.highway){
    if(dd.kind==="Special"&&dv.special)add("dmgtxt","Site destroyed",sec);
    if(dd.highway&&dv.highway)add("dmgtxt","Highway destroyed: no highway movement bonus here",sec);
    const box=document.createElement("div");box.className="dmgbtns";sec.appendChild(box);
    const ro=live&&!canWrite;
    if(dd.kind==="Special"){const b1=document.createElement("button");b1.className="sbtn";b1.textContent=dv.special?"Repair site":"Mark site destroyed";b1.disabled=ro;b1.onclick=()=>toggleDestroyed(c,"special");box.appendChild(b1);}
    if(dd.highway){const b2=document.createElement("button");b2.className="sbtn";b2.textContent=dv.highway?"Repair highway":"Destroy highway";b2.disabled=ro;b2.onclick=()=>toggleDestroyed(c,"highway");box.appendChild(b2);}
  }
  if(dd.kind==="Special"){
    const ow=hexState(c).owner;
    if(ow!=null){const so=seat(ow).owner,who=so&&names[so]?` (${names[so]})`:"";const ol=add("ownline",`Owned by P${ow+1} · ${PLAYER_NAMES[ow]}${who}`,sec);ol.style.borderLeftColor=PLAYER_COLORS[ow];}
    const orow=document.createElement("label");orow.className="ownrow";orow.textContent="Owner";
    const osel=document.createElement("select");osel.className="actsel";osel.disabled=live&&!canWrite;
    osel.innerHTML=`<option value="">No owner</option>`+PLAYER_NAMES.map((n,i)=>`<option value="${i}"${ow===i?" selected":""}>P${i+1} · ${n}</option>`).join("");
    osel.onchange=()=>setOwner(c,osel.value===""?null:+osel.value);orow.appendChild(osel);sec.appendChild(orow);
  }
  const txt=salvage.get(key(c.q,c.r))||"";
  const sv=document.createElement("div");sv.className="salv";sec.appendChild(sv);
  add("mname","Salvage",sv);
  if(txt)add("prev",txt,sv);else add("meta","No salvage assigned.",sv);
  const btn=document.createElement("button");btn.className="sbtn";btn.textContent=txt||(live&&!canWrite)?"Open salvage document":"Assign salvage";btn.onclick=()=>openSalvage(c,btn);sv.appendChild(btn);
}

/* ----- salvage documents (one per hex, per map) ----- */
// Salvage marker: the lance silhouette in black with a red X through it
const SALV_ICON=`<g transform="scale(.72)"><path d="${MECH_D}" fill="#f3f1ec" stroke="#f3f1ec" stroke-width="2.6" stroke-linejoin="round"/><path d="${MECH_D}" fill="#141414" stroke="#141414" stroke-width="1" stroke-linejoin="round"/><path d="M-11 -13L11 14M11 -13L-11 14" stroke="#141414" stroke-width="3.4" stroke-linecap="round"/><path d="M-11 -13L11 14M11 -13L-11 14" stroke="#e5484d" stroke-width="1.8" stroke-linecap="round"/></g>`;
let salvage=new Map(),salvUnsub=null,salvSeed=null,salvCell=null,salvTimer=null,salvDirty=false,salvOpener=null;
const salvPath=()=>`maps/s${game.seed}/salvage`;
const hexDocId=c=>`h_${c.q}_${c.r}`;
function subscribeSalvage(){
  if(!live||salvSeed===game.seed)return;
  if(salvUnsub)salvUnsub();if(dmgUnsub)dmgUnsub();salvSeed=game.seed;salvage=new Map();destroyed=new Map();
  dmgUnsub=db.collection(`maps/s${game.seed}/destroyed`).onSnapshot(qs=>{
    const next=new Map();
    qs.docs.forEach(d=>{const v=d.data();if(!v||typeof v.q!=="number"||typeof v.r!=="number")return;const ow=Number.isInteger(v.owner)&&v.owner>=0&&v.owner<NC?v.owner:null;if(v.special||v.highway||ow!=null)next.set(key(v.q,v.r),{special:!!v.special,highway:!!v.highway,owner:ow});});
    destroyed=next;refreshAll();
  },()=>{});
  salvUnsub=db.collection(salvPath()).onSnapshot(qs=>{
    const next=new Map();
    qs.docs.forEach(d=>{const v=d.data();if(v&&typeof v.text==="string"&&v.text.trim()&&typeof v.q==="number"&&typeof v.r==="number")next.set(key(v.q,v.r),v.text);});
    if(salvCell&&salvDirty){const k=key(salvCell.q,salvCell.r);if(salvage.has(k))next.set(k,salvage.get(k));else next.delete(k);}
    salvage=next;drawSalvageMarks();renderInspect();
    const ta=$("salvtext");if(salvCell&&!salvDirty&&document.activeElement!==ta)ta.value=salvage.get(key(salvCell.q,salvCell.r))||"";
  },()=>{});
}
function drawSalvageMarks(){
  const g=$("salv");if(!g)return;let out="";
  salvage.forEach((t,k)=>{const c=byKey.get(k);if(c)out+=`<g transform="translate(${(c.x-20).toFixed(1)},${(c.y-12).toFixed(1)})">${SALV_ICON}</g>`;});
  g.innerHTML=out;
}
function openSalvage(c,opener){
  salvCell=c;salvOpener=opener||null;salvDirty=false;
  const [n]=describe(RES.map.get(c));
  $("salvtitle").textContent=`Salvage · ${n}`;
  $("salvsub").textContent=`Hex ${c.q}, ${c.r}${c===CENTER?" (center)":""}`;
  const ta=$("salvtext");ta.value=salvage.get(key(c.q,c.r))||"";
  const ro=live&&!canWrite;ta.readOnly=ro;
  $("salvstatus").textContent=ro?"View only":(live?"Changes save automatically":"Local game: notes last until the page closes");
  $("salvmodal").classList.add("open");setTimeout(()=>ta.focus(),0);
}
function saveSalvage(){
  clearTimeout(salvTimer);if(!salvCell||!salvDirty)return;
  const c=salvCell,text=$("salvtext").value,k=key(c.q,c.r);
  if(text.trim())salvage.set(k,text);else salvage.delete(k);
  drawSalvageMarks();renderInspect();
  if(!live){salvDirty=false;$("salvstatus").textContent="Saved for this session";return;}
  const path=`${salvPath()}/${hexDocId(c)}`;
  queues[path]=(queues[path]||Promise.resolve()).then(()=>text.trim()?db.doc(path).set({text,q:c.q,r:c.r}):db.doc(path).delete())
    .then(()=>{if(salvCell===c&&$("salvtext").value===text){salvDirty=false;$("salvstatus").textContent="Saved";}})
    .catch(e=>{$("salvstatus").textContent="Not saved";handleWriteErr(e);});
}
function closeSalvage(){
  if(salvDirty)saveSalvage();
  $("salvmodal").classList.remove("open");salvCell=null;
  if(salvOpener&&document.body.contains(salvOpener))salvOpener.focus();
}
$("salvtext").addEventListener("input",()=>{salvDirty=true;$("salvstatus").textContent="Saving…";clearTimeout(salvTimer);salvTimer=setTimeout(saveSalvage,800);});
$("salvclose").addEventListener("click",closeSalvage);
$("salvmodal").addEventListener("click",e=>{if(e.target===e.currentTarget)closeSalvage();});
$("salvmodal").addEventListener("keydown",e=>{if(e.key==="Escape"){e.stopPropagation();closeSalvage();}});

/* ----- destroyed Special sites and highways (per map, shared) ----- */
function hwyDown(c){const v=destroyed.get(key(c.q,c.r));return !!(v&&v.highway);}
// Per-hex shared state for this map: destroyed site/highway, and which player owns a Special site
function hexState(c){return Object.assign({special:false,highway:false,owner:null},destroyed.get(key(c.q,c.r))||{});}
function writeHexState(c,v){
  const k=key(c.q,c.r),keep=!!(v.special||v.highway||v.owner!=null);
  if(keep)destroyed.set(k,v);else destroyed.delete(k);
  refreshAll();
  if(!live)return;
  const path=`maps/s${game.seed}/destroyed/${hexDocId(c)}`;
  queues[path]=(queues[path]||Promise.resolve()).then(()=>keep?db.doc(path).set({special:!!v.special,highway:!!v.highway,owner:v.owner==null?null:v.owner,q:c.q,r:c.r}):db.doc(path).delete()).catch(handleWriteErr);
}
function toggleDestroyed(c,field){const v=hexState(c);v[field]=!v[field];writeHexState(c,v);}
function setOwner(c,o){const v=hexState(c);v.owner=Number.isInteger(o)&&o>=0&&o<NC?o:null;writeHexState(c,v);}
function ownedCount(i){let n=0;if(!RES)return 0;destroyed.forEach((v,k)=>{const c=byKey.get(k);if(v.owner===i&&c&&RES.map.get(c).kind==="Special")n++;});return n;}
const hashStr=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};
function blob(rng,r,n,j,sy){let d="";for(let i=0;i<n;i++){const a=i/n*Math.PI*2+rng()*0.25,rr=r*(1-j/2+rng()*j);d+=(i?"L":"M")+(Math.cos(a)*rr).toFixed(1)+" "+(Math.sin(a)*rr*(sy||1)).toFixed(1);}return d+"Z";}
function crater(rng,x,y,s){
  let g=`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${Math.floor(rng()*360)}) scale(${s})">`;
  for(let i=0;i<5;i++){const a=rng()*Math.PI*2,rr=7.5+rng()*3;g+=`<path d="${blob(rng,0.9+rng()*0.9,5,0.6)}" transform="translate(${(Math.cos(a)*rr).toFixed(1)},${(Math.sin(a)*rr).toFixed(1)})" fill="#5a4636"/>`;}
  g+=`<path d="${blob(rng,7,13,0.42,0.86)}" fill="#6e5743" stroke="#2a1f17" stroke-width=".9" stroke-linejoin="round"/>`;
  g+=`<path d="${blob(rng,4.4,11,0.5,0.82)}" fill="#3a2a1e" transform="translate(${(rng()-.5).toFixed(1)},${(rng()-.5).toFixed(1)})"/>`;
  g+=`<path d="${blob(rng,2.1,8,0.55)}" fill="#1a120c" transform="translate(.8,.6)"/>`;
  return g+"</g>";
}
function roadGap(rng,gx){
  const L=[],R=[];for(let i=0;i<=4;i++){const y=-6.6+i*3.3;L.push([gx-3.4-rng()*2.2,y]);R.push([gx+3.4+rng()*2.2,y]);}
  return "M"+L.concat(R.reverse()).map(p=>p[0].toFixed(1)+" "+p[1].toFixed(1)).join("L")+"Z";
}
function chunk(rng,x,y){let d="";for(let i=0;i<4;i++){const a=i/4*Math.PI*2+rng()*0.9,rr=1.6+rng()*1.6;d+=(i?"L":"M")+(x+Math.cos(a)*rr).toFixed(1)+" "+(y+Math.sin(a)*rr).toFixed(1);}return d+"Z";}
function drawDamage(){
  const g=$("dmg");if(!g||!RES)return;let out="";
  destroyed.forEach((v,k)=>{
    const c=byKey.get(k);if(!c)return;const d=RES.map.get(c);
    if(v.owner!=null&&d.kind==="Special"){
      const oc=PLAYER_COLORS[v.owner];
      out+=`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})"><polygon points="${hexPts(S-3)}" fill="none" stroke="${oc}" stroke-width="5.5" stroke-linejoin="round"/><g transform="translate(13,-11)"><path d="M0 0V-13" stroke="#1e2b36" stroke-width="1.5" stroke-linecap="round"/><path d="M.5 -13H13L10.4 -9.2L13 -5.4H.5Z" fill="${oc}" stroke="#1e2b36" stroke-width=".9" stroke-linejoin="round"/><text x="6.2" y="-7" text-anchor="middle" font-family="Chakra Petch, Arial Narrow, sans-serif" font-size="6.2" font-weight="700" fill="#fff">P${v.owner+1}</text></g></g>`;
    }
    if(v.highway&&d.highway){
      const rng=mulberry32(hashStr(k));
      RES.roads.forEach(([a,b])=>{const o=a===c?b:b===c?a:null;if(!o)return;
        const ang=Math.atan2(o.y-c.y,o.x-c.x)*180/Math.PI,len=Math.hypot(o.x-c.x,o.y-c.y)/2;
        let seg=`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${ang.toFixed(1)})">`;
        let z=`M5 ${(rng()*4-2).toFixed(1)}`;for(let x=9;x<len-1;x+=3.5)z+=`L${x.toFixed(1)} ${(rng()*7-3.5).toFixed(1)}`;
        seg+=`<path d="${z}" stroke="#0d0d0d" stroke-width="1" fill="none" stroke-linejoin="round"/>`;
        seg+=`<path d="M${(len*.3).toFixed(1)} -4.5l2 2.5l-1 2l2.5 2.5" stroke="#0d0d0d" stroke-width=".8" fill="none"/>`;
        const gx=len*(0.58+rng()*0.14);
        seg+=`<path d="${roadGap(rng,gx)}" fill="#7a6248" stroke="#3a2b1e" stroke-width=".8" stroke-linejoin="round"/>`;
        seg+=`<path d="${chunk(rng,gx-1.5,-8.5-rng()*2.5)}" fill="#2b2b2b" stroke="#0d0d0d" stroke-width=".7"/><path d="${chunk(rng,gx+3,8.5+rng()*2.5)}" fill="#2b2b2b" stroke="#0d0d0d" stroke-width=".7"/><path d="${chunk(rng,gx+6,-7.5-rng()*2)}" fill="#3a3a3a" stroke="#0d0d0d" stroke-width=".6" transform="scale(.8)"/>`;
        out+=seg+"</g>";
      });
      out+=crater(rng,c.x+(rng()-.5)*4,c.y+(rng()-.5)*4,1.3+rng()*0.25);
    }
    if(v.special&&d.kind==="Special"){
      out+=`<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)})"><path d="M-30 -10L-14 -4L-6 -14L4 -2L14 -8L30 4M-6 -14L-2 -26M4 -2L0 10M14 -8L22 -22" stroke="#111" stroke-width="1.6" fill="none" stroke-linejoin="round"/><g fill="#6d6259" stroke="#222" stroke-width=".8"><path d="M-29 6l5-4l5 3l-2 5h-7z"/><path d="M19 3l6-3l4 5l-5 3z"/></g><rect x="-25" y="-31" width="50" height="11" rx="2" fill="#b3261e"/><text y="-22.6" text-anchor="middle" font-family="Chakra Petch, Arial Narrow, sans-serif" font-size="7.6" font-weight="700" fill="#fff" letter-spacing=".4">DESTROYED</text></g>`;
    }
  });
  g.innerHTML=out;
}

function markCells(){
  document.querySelectorAll(".hexcell.sel").forEach(x=>x.classList.remove("sel"));
  [hoverCell,pinnedCell].forEach(c=>{if(c){const g=document.querySelector(`.hexcell[data-i="${CELLS.indexOf(c)}"]`);if(g)g.classList.add("sel");}});
}

async function resolveNames(){
  if(!user||!live)return;
  const ids=[...new Set(rawSeats.filter(Boolean).map(s=>s.owner).filter(Boolean))];
  if(!ids.length)return;
  try{const ps=await user.profiles(ids);ids.forEach(id=>{names[id]=(ps[id]&&ps[id].name)||"";});renderSeats();}catch(e){}
}

function renderSeats(){
  const box=$("seatlist");box.textContent="";
  const mine=mySeat();
  for(let i=0;i<NC;i++){
    const s=seat(i),row=document.createElement("div");row.className="seatrow";
    const dot=document.createElement("span");dot.className="dot";dot.style.background=PLAYER_COLORS[i];row.appendChild(dot);
    const who=document.createElement("div");who.className="who";
    const b=document.createElement("b");b.textContent=`P${i+1} · ${PLAYER_NAMES[i]}`;
    const sp=document.createElement("span");
    if(!live)sp.textContent=i===mine?"Controlling now":"Open";
    else if(!s.owner)sp.textContent="Open seat";
    else if(s.owner===myId)sp.textContent="You";
    else sp.textContent=names[s.owner]||"Taken";
    {const oc=ownedCount(i);if(oc)sp.textContent+=` · ${oc} site${oc>1?"s":""}`;}
    who.append(b,sp);row.appendChild(who);
    const btn=document.createElement("button");btn.className="sbtn";
    if(!live){btn.textContent=i===mine?"Active":"Control";btn.disabled=i===mine;btn.onclick=()=>takeSeat(i);}
    else if(!s.owner){btn.textContent=mine>=0?"Switch here":"Take seat";btn.classList.add("solid");btn.disabled=!canWrite||!myId;btn.onclick=()=>takeSeat(i);}
    else if(s.owner===myId){btn.textContent="Leave";btn.disabled=!canWrite;btn.onclick=()=>leaveSeat(i);}
    else if(isEditor&&canWrite){btn.textContent="Free seat";btn.onclick=()=>leaveSeat(i);}
    else btn.style.display="none";
    row.appendChild(btn);box.appendChild(row);
  }
  $("modenote").textContent=live
    ?(canWrite?(myId?"Take a seat to command its Dropship and lances. Everyone sees moves live.":"Sign in to take a seat."):"You're viewing this game; you can't move lances.")
    :(window.__hexBackendError?"Not connected, so nothing is saved: "+window.__hexBackendError:"Local game: use Control to switch players on this screen. Nothing is saved.");
  const tag=$("livetag");tag.classList.toggle("on",live);tag.lastElementChild.textContent=live?"Live game":(window.__hexBackendError?"Local game · not saved":"Connecting…");
}

function renderMechs(){
  const card=$("mechcard"),list=$("mechlist"),i=mySeat();
  if(i<0){card.style.display="none";return;}
  card.style.display="";
  const ae=document.activeElement;if(ae&&ae.tagName==="INPUT"&&list.contains(ae))return;
  $("mechtitle").textContent=`${live?"Your lances":"Lances"} · P${i+1} ${PLAYER_NAMES[i]}`;
  list.textContent="";
  const s=seat(i),ctl=canControl(i);
  MECHS.forEach(name=>{
    const m=s.mechs[name],row=document.createElement("div");
    row.className="mechrow"+(selected&&selected.seat===i&&selected.mech===name?" on":"");
    const tok=document.createElement("div");tok.className="tok";tok.style.cssText="background:transparent;border:0;box-shadow:none;width:30px;height:40px";tok.innerHTML=`<svg viewBox="-12 -17 24 34" width="26" height="37" aria-hidden="true">${mechShape(PLAYER_COLORS[i],"#141414",1.1)}</svg>`;
    const nm=document.createElement("div");nm.className="mname";nm.textContent=`${name} Lance`;
    const sub=document.createElement("input");sub.type="text";sub.className="subin";sub.maxLength=80;sub.placeholder=ctl?"Add a subtitle…":"";sub.value=m.subtitle||"";sub.disabled=!ctl;sub.setAttribute("aria-label",`${name} Lance subtitle`);
    if(!ctl&&!m.subtitle)sub.style.display="none";
    sub.addEventListener("input",()=>setSubtitle(i,name,sub.value));
    sub.addEventListener("keydown",e=>{if(e.key==="Enter")sub.blur();});
    sub.addEventListener("blur",()=>{flushRoster();setTimeout(()=>{if(!list.contains(document.activeElement)||document.activeElement.tagName!=="INPUT")renderMechs();},0);});
    nm.appendChild(sub);
    const st=document.createElement("div");st.className="stepper";
    const minus=document.createElement("button");minus.textContent="−";minus.setAttribute("aria-label",`Lower ${name} movement points`);minus.disabled=!ctl||m.mp<=0||!!lowestWalk(m);minus.onclick=()=>setMP(i,name,-1);
    const val=document.createElement("span");val.className="val";val.textContent=fmt(mpOf(m));val.title=lowestWalk(m)?"Movement points: set by the lowest Walk MV in the roster":"Movement points";
    const plus=document.createElement("button");plus.textContent="+";plus.setAttribute("aria-label",`Raise ${name} movement points`);plus.disabled=!ctl||m.mp>=MAX_MP||!!lowestWalk(m);plus.onclick=()=>setMP(i,name,1);
    st.append(minus,val,plus);
    const meta=document.createElement("div");meta.className="mmeta";
    const cell=byKey.get(key(m.q,m.r)),d=RES?RES.map.get(cell):null;
    meta.textContent=`${ACTIONS[m.action]?`${fmt(remOf(m))} of ${fmt(allowance(m))} MP left`:"No action"} · ${d?describe(d)[0]:""}`;
    const act=document.createElement("div");act.className="mactions";
    const sel=document.createElement("button");sel.className="sbtn"+(selected&&selected.seat===i&&selected.mech===name?" solid":"");sel.textContent=selected&&selected.seat===i&&selected.mech===name?"Selected":"Select";sel.onclick=()=>selectMech(i,name);
    const un=document.createElement("button");un.className="sbtn";un.textContent="Undo move";un.disabled=!ctl||!m.prev;un.onclick=()=>undo(i,name);
    const asel=document.createElement("select");asel.className="actsel";asel.disabled=!ctl;asel.setAttribute("aria-label",`${name} Lance action`);
    asel.innerHTML=`<option value="">Choose action…</option>`+Object.keys(ACTIONS).map(a=>`<option value="${a}"${m.action===a?" selected":""}>${a}</option>`).join("");
    asel.onchange=()=>setAction(i,name,asel.value);
    act.append(asel,sel,un);
    const rule=document.createElement("div");rule.className="actrule";rule.textContent=(lowestWalk(m)?`MP ${fmt(mpOf(m))} from the lowest Walk MV. `:"")+(ACTIONS[m.action]?ACTIONS[m.action].rule+(holdBonus(m)?" Holding: green plus active.":""):"Choose an action to move this lance.");
    const ro=document.createElement("div");ro.className="roster";
    const rl=document.createElement("div");rl.className="rl";rl.textContent="Lance roster";ro.appendChild(rl);
    const hn=document.createElement("div");hn.className="mvh";hn.textContent="Mech";const hv=document.createElement("div");hv.className="mvh";hv.textContent="Walk MV (sets MP)";ro.append(hn,hv);
    const blur=()=>{flushRoster();setTimeout(()=>{if(!list.contains(document.activeElement)||document.activeElement.tagName!=="INPUT")renderMechs();},0);};
    for(let k=0;k<4;k++){const inp=document.createElement("input");inp.type="text";inp.maxLength=60;inp.placeholder=`Mech ${k+1}`;
      inp.setAttribute("aria-label",`${name} Lance, mech ${k+1}`);inp.value=((m.roster||[])[k])||"";inp.disabled=!ctl;
      inp.addEventListener("input",()=>setRoster(i,name,k,inp.value));inp.addEventListener("blur",blur);
      const mv=document.createElement("input");mv.type="number";mv.min="0";mv.max="20";mv.step="0.5";mv.inputMode="decimal";mv.placeholder="–";
      mv.setAttribute("aria-label",`${name} Lance, mech ${k+1} Walk MV`);const wv=(m.walk||[])[k];mv.value=typeof wv==="number"?String(wv):"";mv.disabled=!ctl;
      mv.addEventListener("input",()=>setWalk(i,name,k,mv.value));mv.addEventListener("blur",blur);
      ro.append(inp,mv);}
    row.append(tok,nm,st,meta,act,rule,ro);list.appendChild(row);
  });
  $("refill").disabled=!ctl;
}

function refreshAll(){drawOverlay();renderSeats();renderMechs();renderInspect();
  $("mapctl").style.display=(!live||(isEditor&&canWrite))?"contents":"none";}

function loadMap(seed){
  RES=generate(seed);if(!RES)return;seedInput.value=seed;render(RES);
  roadSet=new Set();RES.roads.forEach(([a,b])=>{const ka=key(a.q,a.r),kb=key(b.q,b.r);roadSet.add(ka+"|"+kb);roadSet.add(kb+"|"+ka);});
  selected=null;hoverCell=null;pinnedCell=null;
  if($("salvmodal").classList.contains("open"))closeSalvage();
  if(live)subscribeSalvage();else{salvage=new Map();destroyed=new Map();}
  refreshAll();
}

/* ----- map controls ----- */
function armed(btn,label,fn){
  if(btn.dataset.armed){delete btn.dataset.armed;btn.textContent=label;fn();return;}
  btn.dataset.armed="1";btn.textContent="Click again to confirm";
  setTimeout(()=>{if(btn.dataset.armed){delete btn.dataset.armed;btn.textContent=label;}},3500);
}
function startMap(seed,keepSeed){
  const epoch=newEpoch();
  if(live){
    // Map changes go through the admin server function, which checks admin rights
    if(typeof window.__hexAdmin!=="function"){toast("Only an admin can change the map.");return;}
    window.__hexAdmin({seed,epoch}).catch(e=>toast((e&&e.message)||"Only an admin can change the map."));
  }
  else{game={seed,epoch};if(keepSeed)refreshAll();else loadMap(seed);}
}
$("gen").addEventListener("click",e=>armed(e.currentTarget,"New map",()=>startMap(Math.floor(Math.random()*1e6),false)));
$("resetm").addEventListener("click",e=>armed(e.currentTarget,"Reset lances",()=>startMap(game.seed,true)));
$("load").addEventListener("click",()=>{const v=parseInt(seedInput.value,10);if(!isNaN(v))startMap(v,false);});
seedInput.addEventListener("keydown",e=>{if(e.key==="Enter")$("load").click();});
$("refill").addEventListener("click",()=>{const i=mySeat();if(i>=0&&canControl(i))refill(i);});

/* ----- board interaction ----- */
const svgEl=$("map");
svgEl.addEventListener("click",e=>{
  const t=e.target.closest("[data-mech]");
  if(t){const [i,m]=t.dataset.mech.split(":");const c=byKey.get(key(seat(+i).mechs[m].q,seat(+i).mechs[m].r));
    if(selected&&reachMap&&reachMap.has(c)&&!(selected.seat===+i&&selected.mech===m)){moveTo(c);return;}
    hoverCell=c;pinnedCell=c;selectMech(+i,m);return;}
  const h=e.target.closest(".hexcell");if(h)hexClick(CELLS[+h.dataset.i]);
});
const hov=e=>{const h=e.target.closest(".hexcell");if(h){const c=CELLS[+h.dataset.i];if(c!==hoverCell){hoverCell=c;renderInspect();markCells();}}};
svgEl.addEventListener("mouseover",hov);svgEl.addEventListener("focusin",hov);
svgEl.addEventListener("keydown",e=>{
  if(e.key==="Escape"){selected=null;pinnedCell=null;refreshAll();return;}
  if(e.key==="Enter"||e.key===" "){const t=e.target.closest("[data-mech]")||e.target.closest(".hexcell");if(t){e.preventDefault();t.dispatchEvent(new MouseEvent("click",{bubbles:true}));}}
});

/* ----- start ----- */
legend();
$("subline").textContent=`${CELLS.length} hexes: ${NC} dropships, ${CELLS.length-NC-N_SPECIAL} terrain hexes, ${N_SPECIAL} special sites. 6 players, 3 lances of 4 mechs each.`;
game={seed:Math.floor(Math.random()*1e6),epoch:"local"};
loadMap(game.seed);

(async function connect(){
  // Standalone build: the backend (Supabase + Discord or guest identity) is set up in main.js
  let backend=null;try{backend=await window.__hexBackend;}catch(e){console.error(e);}
  if(!backend){
    const why=window.__hexBackendError||"Couldn't reach the game server.";
    refreshAll();toast(why);return;
  }
  const d=backend.db,u=backend.user;
  db=d;user=u;
  if(u){myId=await u.id();isEditor=await u.canEdit();const cw=await u.can("data.write");canWrite=cw!==false;}
  else{canWrite=true;isEditor=false;}
  window.__hexSetAdmin=v=>{isEditor=!!v;refreshAll();};
  live=true;rawSeats=new Array(NC).fill(null);selected=null;refreshAll();
  let initTried=false;
  db.doc("game/state").onSnapshot(snap=>{
    if(!snap.exists){
      if(!snap.metadata.fromCache&&canWrite&&!initTried){initTried=true;db.doc("game/state").set({seed:Math.floor(Math.random()*1e6),epoch:newEpoch()}).catch(()=>{});}
      return;
    }
    const g=snap.data();
    if(g.seed!==game.seed){game={seed:g.seed,epoch:g.epoch};loadMap(g.seed);}
    else if(g.epoch!==game.epoch){game={seed:g.seed,epoch:g.epoch};selected=null;refreshAll();}
    subscribeSalvage();
  },()=>toast("Lost the live connection. Reload to reconnect."));
  db.collection("seats").onSnapshot(qs=>{
    const next=new Array(NC).fill(null);
    qs.docs.forEach(doc=>{const m=/^p(\d)$/.exec(doc.id);if(m&&+m[1]>=1&&+m[1]<=NC)next[+m[1]-1]=doc.data();});
    rawSeats=next;applyPending();
    if(selected&&!canControl(selected.seat)&&live&&seat(selected.seat).owner!==myId){/* keep viewing */}
    refreshAll();resolveNames();
  },()=>toast("Lost the live connection. Reload to reconnect."));
})();
})();
