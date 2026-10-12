const $=id=>document.getElementById(id),rng=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
let LV;
const PLACES=['Block','Alley','Boulevard','Market','Docks','Rooftops','Underpass','Plaza','Row','Crossing'];
const THEMES=[
{n:'Dawn',sky:['#ffd1a3','#6c6fa8'],fog:0xd8a08a,sun:0xfff0b0,sy:9,sr:1.1,bld:[0xe3bfb0,0xb69ab5,0x8c7aa8],gr:0x9a94a2,hl:[0xffe6d0,0x6a5a7a,.95],dl:[0xffd2a0,1]},
{n:'Noon',sky:['#cdeeff','#3f9bff'],fog:0xbfdcf0,sun:0xffffe0,sy:34,sr:.8,day:1,bld:[0xe8e8f0,0xc4cde0,0xa4b0d0],gr:0xb4b4bc,hl:[0xffffff,0x8a8a99,1.15],dl:[0xfffbe8,1.5]},
{n:'Sunset',sky:['#ffb36b','#6a3d7e'],fog:0xc9775f,sun:0xffe2a0,sy:15,sr:1.2,bld:[0xd9b0a0,0xa07a90,0x7a5a86],gr:0x8c8796,hl:[0xfff0e0,0x554466,1],dl:[0xffe6c0,1.1]},
{n:'Dusk',sky:['#e0607a','#2b2760'],fog:0x6a3a68,sun:0xffb08a,sy:10,sr:1,bld:[0xb08aa8,0x806090,0x584878],gr:0x6e6684,hl:[0xe8c0d0,0x403658,.9],dl:[0xffa890,.9]},
{n:'Midnight',sky:['#24367a','#090c24'],fog:0x151b3d,sun:0xdfe8ff,sy:24,sr:.9,bld:[0x8a9ac8,0x5c6aa0,0x3e4a80],gr:0x56587a,hl:[0xaab8ff,0x303050,.85],dl:[0xaab8ff,.8]},
{n:'Neon',sky:['#5a1470','#0a0420'],fog:0x2a0d3c,sun:0xff6bd6,sy:20,sr:1,bld:[0xc890e0,0x9060c0,0x6a40a0],gr:0x6a5a86,hl:[0xffc0ff,0x402060,.95],dl:[0xff9ae8,.9]},
{n:'Overcast',sky:['#aab4bd','#6e7a86'],fog:0x929ca6,sun:0xe8eef2,sy:28,sr:.7,day:1,bld:[0xc4ccd4,0x9aa4b0,0x7c8794],gr:0x9a9ea6,hl:[0xe8eef4,0x70788a,1.05],dl:[0xe8eef4,.9]}];
const BIO={city:{ic:'🏙️',pl:PLACES,gr:0,dk:0x2a2535,rd:0x1a1722,st:0xf4b32a,p:[0x9a6a3a,0xc99a5a,0xc4522f]},outback:{ic:'🦘',pl:['Red Centre','Dry Creek','Bush Track','Salt Flats','Homestead','Uluru Road'],gr:0xb5532c,dk:0x5a2a18,rd:0x9a4a2a,st:0xd98a4a,p:[0x8a4a2c,0xb06a40,0x9a5a38]},finland:{ic:'🌲',pl:['Lakeside','Pine Forest','Sauna Trail','Helsinki Docks','Lapland','Frozen Lake'],gr:0xe6eef4,dk:0x4a5560,rd:0xdce6ee,st:0xffffff,p:[0x6a4a2c,0x8a6a40,0x8a5a34]},telaviv:{ic:'🌴',pl:['Bauhaus Row','Beachfront','Rothschild Blvd','Jaffa Port','Carmel Market','Dizengoff'],gr:0xe8dcc0,dk:0x6a5a44,rd:0xd8c89c,st:0xf0e8d0,p:[0xd9c9a0,0xeeddb0,0x3a8fb0]}};
function genRun(){const t=THEMES.slice().sort(()=>Math.random()-.5),bs=Object.keys(BIO).sort(()=>Math.random()-.5);LV=[0,1,2].map(i=>({...t[i],bio:bs[i],name:t[i].n+' '+BIO[bs[i]].pl[Math.random()*6|0],L:[130,175,220][i]+(Math.random()*30-10|0),seed:Math.random()*1e9|0,haz:[.35,.6,.85][i]+Math.random()*.1}))}genRun();
const R=new THREE.WebGLRenderer({antialias:true});R.setPixelRatio(Math.min(devicePixelRatio,2));document.body.prepend(R.domElement);
const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(48,1,.1,220);
const HL=new THREE.HemisphereLight(0xfff0e0,0x554466,1.0);scene.add(HL);const sunL=new THREE.DirectionalLight(0xffe6c0,1.1);sunL.position.set(6,12,10);scene.add(sunL,sunL.target);
let camZ=12;function rs(){const w=innerWidth,h=innerHeight;R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();camZ=w/h<.8?20:w/h<1.2?15:11.5}addEventListener('resize',rs);rs();
// audio
let AC;function snd(f,d,ty='square',v=.05,sl=0){try{AC=AC||new(window.AudioContext||webkitAudioContext)();const o=AC.createOscillator(),g=AC.createGain();o.type=ty;o.frequency.value=f;o.frequency.linearRampToValueAtTime(f+sl,AC.currentTime+d);g.gain.value=v;g.gain.linearRampToValueAtTime(0,AC.currentTime+d);o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+d)}catch(e){}}
// music
let vol=.5,mG=null,mBuf=null,mSrc=null,mDec=false;try{const v=localStorage.getItem('sqvol');if(v!==null)vol=Math.min(1,Math.max(0,+v))}catch(e){}
function ac(){AC=AC||new(window.AudioContext||webkitAudioContext)();if(AC.state=='suspended')AC.resume();return AC}
function setVol(v){vol=v/100;if(mG)mG.gain.value=vol;try{localStorage.setItem('sqvol',vol)}catch(e){}}
function volUI(){return '<p style="margin:14px 0 0;font-size:21px">🎵 Music <input type="range" min="0" max="100" value="'+Math.round(vol*100)+'" oninput="setVol(this.value)"></p>'}
async function music(){try{const c=ac();if(!mG){mG=c.createGain();mG.gain.value=vol;mG.connect(c.destination)}if(!mBuf&&!mDec){mDec=true;const buffer=await fetch(new URL('./assets/mus.mp3', import.meta.url)).then(r=>r.arrayBuffer());mBuf=await c.decodeAudioData(buffer)}if(mBuf&&!mSrc){mSrc=c.createBufferSource();mSrc.buffer=mBuf;mSrc.loop=true;mSrc.connect(mG);mSrc.start()}}catch(e){console.error(e);mDec=false}}
// particles
const PP=[],pgeo=new THREE.BoxGeometry(.13,.13,.13);for(let i=0;i<90;i++){const m=new THREE.Mesh(pgeo,new THREE.MeshBasicMaterial({color:0xffffff}));m.visible=false;m.userData={l:0,m:1,v:new THREE.Vector3()};scene.add(m);PP.push(m)}
let pn=0;function puff(x,y,z,n,cols,sp=4,life=.6,up=0){for(let i=0;i<n;i++){const m=PP[pn++%90],u=m.userData;m.position.set(x,y,z);u.v.set((Math.random()-.5)*sp,Math.random()*sp+up,(Math.random()-.5)*sp);u.l=u.m=life*(.5+Math.random()*.7);m.material.color.set(cols[Math.random()*cols.length|0]);m.visible=true}}
// shared geo
const BOX=new THREE.BoxGeometry(1,1,1),SG=new THREE.CylinderGeometry(.15,.15,.55,10),SC=new THREE.SphereGeometry(.15,10,8);
let LG,lv,solids,spikes,barrels,saus,CP,cpI,cpObj,total,got,gx,gS=[];
const mat=c=>new THREE.MeshLambertMaterial({color:c});
function box(w,h,d,c,x,y,z,p){const m=new THREE.Mesh(BOX,mat(c));m.scale.set(w,h,d);m.position.set(x,y,z);(p||LG).add(m);return m}
function sausage(c){const g=new THREE.Group(),m=mat(c),a=new THREE.Mesh(SG,m);a.rotation.z=Math.PI/2;g.add(a);[-.275,.275].forEach(x=>{const s=new THREE.Mesh(SC,m);s.position.x=x;g.add(s)});g.userData.m=m;return g}
function winTex(s,d){const r=rng(s),c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#bbb';x.fillRect(0,0,64,64);for(let a=0;a<4;a++)for(let b=0;b<4;b++){x.fillStyle=d?(r()<.5?'#9ec8e8':'#6f8fae'):(r()<.4?'#fff4b8':'#555');x.fillRect(a*16+3,b*16+3,10,10)}const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.NearestFilter;return t}
const WT=[11,22,33].map(s=>winTex(s)),WD=[11,22,33].map(s=>winTex(s,1));
function build(i){
 clearE(true);if(LG)scene.remove(LG);LG=new THREE.Group();scene.add(LG);lv=LV[i];const L=lv.L,r=rng(lv.seed),h=lv.haz,BI=BIO[lv.bio],BF=Math.min(1,(c=>(c.r+c.g+c.b)/3)(new THREE.Color(lv.bld[0]))/.85);
 solids=[];spikes=[];barrels=[];saus=[];CP=[0];cpI=0;cpObj=[];let x=-8,last=0;const G=[];
 const flat=n=>{G.push([x,x+n]);x+=n},line=(x0,n,y,g)=>{for(let k=0;k<n;k++)saus.push([x0+k*g,y])},arc=(x0,w,y0,hh)=>{for(let k=0;k<5;k++)saus.push([x0+w*(k+.5)/5,y0+Math.sin((k+.5)/5*Math.PI)*hh])};
 flat(16);
 while(x<L-18){
  if(x-last>36){CP.push(x-3);last=x}
  const t=r(),s=x;
  if(t<.18){flat(8);line(s+1.5,5,.9,1.2)}
  else if(t<.4){const w=2.6+r()*1.4;x+=w;arc(s,w,1.3,1.7);flat(7)}
  else if(t<.6){flat(13);[1.7,2.8,1.7].forEach((y,k)=>{const px=s+2+k*4;solids.push({x0:px,x1:px+3.2,top:y,pl:1});saus.push([px+1.6,y+.9])});if(r()<h)spikes.push([s+6.5,s+8.5]);line(s+.8,2,.9,1.1)}
  else if(t<.78){const w=1.8+r()*.8;flat(14);const sx=s+6;spikes.push([sx,sx+w+(r()<h?1.2:0)]);arc(sx-.3,w+2.4,1.3,1.9)}
  else if(t<.93||h<.5){flat(14);barrels.push({x:s+7,a:s+1.5,b:s+12.5,d:1,v:3+h*2.5,o:null});line(s+4,4,2.3,1.2)}
  else{x+=8.5;solids.push({x0:s+2.7,x1:s+5.8,top:.8,pl:1});saus.push([s+4.2,1.7]);flat(7)}
 }
 G.push([x,L+16]);total=saus.length;got=0;
 G.forEach(g=>{solids.push({x0:g[0],x1:g[1],top:0});const n=g[1]-g[0];box(n,.3,7,BI.gr||lv.gr,(g[0]+g[1])/2,-.15,-.5);box(n,3,7,BI.dk,(g[0]+g[1])/2,-1.8,-.5);box(n,.1,.4,BI.st,(g[0]+g[1])/2,.02,2.8)});
 solids.forEach(s=>{if(!s.pl)return;const w=s.x1-s.x0,c=(s.x0+s.x1)/2;if(s.top<=1.3)box(w,s.top,1.6,BI.p[0],c,s.top/2,0),box(w+.1,.1,1.7,BI.p[1],c,s.top,0);else{box(w,.3,1.6,BI.p[2],c,s.top-.15,0);box(.15,s.top,.15,0x333,s.x0+.3,s.top/2,0);box(.15,s.top,.15,0x333,s.x1-.3,s.top/2,0)}});
 spikes.forEach(s=>{const w=s[1]-s[0],n=Math.round(w/.5);box(w,.12,1.2,0x444,(s[0]+s[1])/2,.06,0);for(let k=0;k<n;k++){const c=new THREE.Mesh(new THREE.ConeGeometry(.24,.7,6),mat(0xc9ced8));c.position.set(s[0]+(k+.5)*w/n,.45,0);LG.add(c)}});
 barrels.forEach(b=>{const g=new THREE.Group(),m=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,1,14),mat(0xd7263d));m.rotation.x=Math.PI/2;g.add(m);const st=new THREE.Mesh(new THREE.CylinderGeometry(.52,.52,.2,14),mat(0xf4b32a));st.rotation.x=Math.PI/2;g.add(st);b.o=g;LG.add(g);g.position.set(b.x,.5,0)});
 CP.forEach((c,k)=>{if(!k)return;box(.12,3,.12,0x333,c,1.5,-2);cpObj[k]=box(.5,.5,.5,0xd7263d,c,3.1,-2)});
 scenery(lv,r,L,BF);
 (lv.bio=='city'?[[-9,6,15,4,7],[-19,9,22,5,9],[-31,12,30,7,12]]:lv.bio=='telaviv'?[[-9,4,8,5,8],[-19,5,10,6,10],[-31,6,12,8,12]]:[]).forEach((l,li)=>{let bx=-40;while(bx<L+60){const w=l[3]+r()*(l[4]-l[3]),hh=l[1]+r()*(l[2]-l[1]),t=(lv.bio=='telaviv'?WA:lv.day?WD:WT)[li].clone();t.needsUpdate=true;t.repeat.set(Math.ceil(w/5),Math.ceil(hh/5));const m=new THREE.Mesh(BOX,new THREE.MeshBasicMaterial({color:lv.bio=='telaviv'?new THREE.Color(lv.bld[li]).lerp(new THREE.Color(0xffffff),.3):lv.bld[li],map:t}));m.scale.set(w,hh,w);m.position.set(bx+w/2,hh/2-1,l[0]-w/2);LG.add(m);bx+=w+r()*(lv.bio=='telaviv'?5:1.2)}});
 const rd=new THREE.Mesh(new THREE.PlaneGeometry(L+200,6),mat(BI.rd));rd.rotation.x=-Math.PI/2;rd.position.set(L/2,-.05,-7);LG.add(rd);
 const vd=new THREE.Mesh(new THREE.PlaneGeometry(L+200,30),new THREE.MeshBasicMaterial({color:0x050308}));vd.rotation.x=-Math.PI/2;vd.position.set(L/2,-5,0);LG.add(vd);
 const sun=new THREE.Mesh(new THREE.CircleGeometry(7,32),new THREE.MeshBasicMaterial({color:lv.sun,fog:false}));sun.position.set(0,lv.sy,-95);sun.scale.setScalar(lv.sr);HL.color.set(lv.hl[0]);HL.groundColor.set(lv.hl[1]);HL.intensity=lv.hl[2];sunL.color.set(lv.dl[0]);sunL.intensity=lv.dl[1];FM.color.setScalar(Math.min(1,Math.max(.5,(lv.dl[1]*.5+lv.hl[2]*.45)*.9)));LG.add(sun);LG.userData.sun=sun;
 const c=document.createElement('canvas');c.width=2;c.height=256;const cx=c.getContext('2d'),gr=cx.createLinearGradient(0,0,0,256);gr.addColorStop(0,lv.sky[1]);gr.addColorStop(1,lv.sky[0]);cx.fillStyle=gr;cx.fillRect(0,0,2,256);scene.background=new THREE.CanvasTexture(c);scene.fog=new THREE.Fog(lv.fog,28,95);
 saus.forEach(p=>{const s=sausage(0xb5412a);s.position.set(p[0],p[1],0);s.rotation.z=.4;LG.add(s);p.push(s,false)});
 // BBQ
 const B=new THREE.Group();B.position.set(L,0,0);gx=L;LG.add(B);
 const bowl=new THREE.Mesh(new THREE.SphereGeometry(1.2,24,12,0,Math.PI*2,Math.PI/2,Math.PI/2),new THREE.MeshLambertMaterial({color:0x222228,side:THREE.DoubleSide}));bowl.position.y=1.4;B.add(bowl);
 const coal=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,.05,20),new THREE.MeshBasicMaterial({color:0xff5a1a}));coal.position.y=1.25;B.add(coal);
 const gt=new THREE.Mesh(new THREE.CylinderGeometry(1.22,1.22,.05,20),mat(0x777));gt.position.y=1.4;B.add(gt);
 [0,2.1,4.2].forEach(a=>{const l=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.9),mat(0x333));l.position.set(Math.cos(a)*.7,.45,Math.sin(a)*.7);B.add(l)});
 const sc=document.createElement('canvas');sc.width=256;sc.height=128;const sx=sc.getContext('2d');sx.fillStyle='#d7263d';sx.fillRect(0,0,256,128);sx.strokeStyle='#f4b32a';sx.lineWidth=8;sx.strokeRect(6,6,244,116);sx.fillStyle='#fff3d0';sx.font='72px Impact,sans-serif';sx.textAlign='center';sx.fillText('BBQ',128,92);
 const sg=new THREE.Mesh(new THREE.PlaneGeometry(4,2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(sc)}));sg.position.set(0,4.6,-1.2);B.add(sg);box(.15,4,.15,0x333,-1.8,2,-1.2,B);box(.15,4,.15,0x333,1.8,2,-1.2,B);
 gS=[];const n=Math.min(12,total);
 B.userData.g=B;LG.userData.B=B;
 hud();
}
// hero
let hero=new THREE.Group(),lean=new THREE.Group(),mixer=null,loaded=false;hero.add(lean);scene.add(hero);
const blob=new THREE.Mesh(new THREE.CircleGeometry(.6,16),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:.35}));blob.rotation.x=-Math.PI/2;scene.add(blob);
const AN={};let curA=null;function setAnim(n){const a=AN[n];if(!a||a===curA)return;a.reset().fadeIn(.18).play();if(curA)curA.fadeOut(.18);curA=a}
(function(){fetch(new URL('./assets/glb.glb', import.meta.url)).then(r=>r.arrayBuffer()).then(buffer=>{const u=new Uint8Array(buffer);
 new THREE.GLTFLoader().parse(u.buffer,'',g=>{const m=g.scene,bb=new THREE.Box3().setFromObject(m),sz=bb.getSize(new THREE.Vector3()),ct=bb.getCenter(new THREE.Vector3()),s=1.9/sz.y;m.scale.setScalar(s);m.position.set(-ct.x*s,-bb.min.y*s,-ct.z*s);
  m.traverse(o=>{if(o.isMesh){o.frustumCulled=false;[].concat(o.material).forEach(q=>{q.metalness=0;q.roughness=.85})}});lean.add(m);
  if(g.animations.length){mixer=new THREE.AnimationMixer(m);g.animations.forEach(a=>AN[a.name]=mixer.clipAction(a));setAnim('Idle_11')}ok()},e=>{console.error(e);const c=new THREE.Mesh(new THREE.CapsuleGeometry?new THREE.CapsuleGeometry(.4,1,4,8):new THREE.CylinderGeometry(.4,.4,1.8),mat(0xf4b32a));c.position.y=.9;lean.add(c);ok()})}).catch(e=>{console.error(e);ok()})})();
// state
let state='title',px=0,py=0,vx=0,vy=0,face=1,gnd=false,inv=0,hearts=3,li=0,coy=0,jb=0,T=0,winT=0,shown=0,total0=0,runT=0,land=0,camX=0,camY=3;
const K={},tc={l:0,r:0,j:0};let jHeld=false;
addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();if(!K[e.key])if([' ','ArrowUp','w','W','z'].includes(e.key))jb=.12;K[e.key]=1});addEventListener('keyup',e=>K[e.key]=0);
[['bl','l'],['br','r'],['bj','j']].forEach(([id,k])=>{const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();tc[k]=1;b.classList.add('on');if(k=='j')jb=.12});['pointerup','pointerleave','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>{tc[k]=0;b.classList.remove('on')}))});
if(matchMedia('(pointer:coarse)').matches)$('touch').style.display='flex';
function hud(){$('hp').innerHTML='♥'.repeat(Math.max(0,hearts))+'<i>'+'♥'.repeat(3-Math.max(0,hearts))+'</i>';$('ln').textContent=BIO[lv.bio].ic+' '+lv.name;$('sc').textContent=got+' / '+total}
function card(h){$('card').innerHTML=h;$('ov').style.display=h?'flex':'none'}
let nLoad=0;function ok(){if(++nLoad<2)return;loaded=true;title()}
function title(){state='title';card('<h1>Sausage Quest</h1><p>Help Uncle CornPop run the city, grab every sausage, dodge the traps and reach the BBQ.</p><p>Dodge flying potatoes — stomp on Cobbee Bean\'s head to squash him. Watch the sky for a poop-dropping fly!</p><p>Arrows / A D to run &nbsp; Space / W to jump</p><p>Every run mixes new biomes — city, outback Australia, Finland and Tel Aviv — at new times of day.</p>'+volUI()+(loaded?'<button id="go">Start</button>':'<p>Loading Uncle CornPop…</p>'));const g=$('go');if(g)g.onclick=()=>{snd(440,.1);start(0)}}
function start(i,keep){li=i;if(!keep){total0=0;genRun()}music();build(i);spT=3+Math.random()*3;spF=6+Math.random()*5;hearts=3;px=0;py=0;vx=vy=0;face=1;inv=0;state='play';card('');hud();camX=3}
function respawn(){px=CP[cpI];py=.05;vx=vy=0;inv=1.6}
function hurt(fall){if(fall){if(inv<=0)hearts--;snd(150,.4,'sawtooth',.08,-100)}else{if(inv>0)return;hearts--;snd(200,.3,'sawtooth',.08,-120);puff(px,py+1,0,10,[0xd7263d,0xf3e3c3],5)}hud();if(hearts<=0){state='over';clearE(false);card('<h2>Burnt to a crisp</h2><p>Uncle CornPop ran out of hearts.</p>'+volUI()+'<button id="go">Retry level</button>');$('go').onclick=()=>start(li,1);return}if(fall)respawn();else{inv=1.6;vy=9;vx=-face*7}}
function win(){state='win';clearE(false);winT=0;shown=0;total0+=got;const n=Math.min(12,got);gS=[];for(let k=0;k<n;k++){const s=sausage(0xe0707a);s.scale.setScalar(.75);s.position.set(gx+(k%2?.45:-.45),1.62,-.8+Math.floor(k/2)*.32);s.visible=false;LG.add(s);gS.push(s)}snd(520,.3,'triangle',.06,300)}
function finish(){const p=got/total,t=p>=1?'Master Griller!':p>=.75?'Sizzling!':p>=.4?'Decent cookout':'Hungry crowd…',last=li==LV.length-1;shown=1;card('<h2>'+t+'</h2><p style="font-size:34px">'+'★'.repeat(p>=1?3:p>=.6?2:1)+'</p><p>'+got+' of '+total+' sausages grilled'+(last?'<br>Total this quest: '+total0:'')+'</p>'+volUI()+'<button id="go">'+(last?'Play again':'Next level')+'</button>');$('go').onclick=()=>{snd(440,.1);last?start(0):start(li+1,1)}}
// enemies
let beanG=null,bpool=[],ens=[],pots=[],chunks=[],spT=5,bsc=1;
const PGEO=new THREE.SphereGeometry(.3,10,8),PCOL=[0xc79a58,0xb98a4b,0xa57a3f],PG=new THREE.Group();scene.add(PG);
function potato(s){const m=new THREE.Mesh(PGEO,mat(PCOL[Math.random()*3|0]));m.scale.set(s,s*.72,s*.82);PG.add(m);return m}
function floorAt(x,y){let t=-99;for(const s of solids)if(x>s.x0&&x<s.x1&&s.top<=y+.3&&s.top>t)t=s.top;return t}
function initBean(g){beanG=g;const m=g.scene,bb=new THREE.Box3().setFromObject(m),sz=bb.getSize(new THREE.Vector3()),ct=bb.getCenter(new THREE.Vector3());bsc=1.5/sz.y;
 m.traverse(o=>{if(o.isMesh){if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();o.frustumCulled=false;[].concat(o.material).forEach(q=>{q.flatShading=false;q.metalness=0;q.roughness=.85;q.needsUpdate=true})}});
 for(let k=0;k<2;k++){const c=THREE.SkeletonUtils.clone(m),root=new THREE.Group(),lean=new THREE.Group();c.scale.setScalar(bsc);c.position.set(-ct.x*bsc,-bb.min.y*bsc,-ct.z*bsc);lean.add(c);root.add(lean);root.visible=false;scene.add(root);const mx=new THREE.AnimationMixer(c);g.animations.forEach(n=>{if(n.name=='Walking')mx.clipAction(n).play()});bpool.push({root,lean,mx})}}
function clearE(all){clearF();ens.forEach(e=>{e.i.root.visible=false;bpool.push(e.i)});ens=[];pots.forEach(p=>PG.remove(p.m));pots=[];if(all){chunks.forEach(c=>PG.remove(c.m));chunks=[]}}
function spawnE(){if(!bpool.length||ens.length>=(li?2:1))return;for(let k=0;k<8;k++){const x=px+9+Math.random()*6;if(x>lv.L-10)return;const c=solids.filter(s=>x>s.x0+1&&x<s.x1-1);if(!c.length)continue;if(spikes.some(s=>x>s[0]-1.2&&x<s[1]+1.2)||barrels.some(b=>x>b.a-1.5&&x<b.b+1.5)||ens.some(e=>Math.abs(e.x-x)<5))continue;const y=c[Math.random()*c.length|0].top,i=bpool.pop();i.root.visible=true;i.root.scale.setScalar(.01);ens.push({i,x,y,t:0,th:1.4,wind:0,kick:0,thrown:true});puff(x,y+.3,0,14,[0x8a6a40,0xc9a066,0xf3e3c3],5,.6,3);snd(120,.25,'sawtooth',.06,200);return}}
function throwP(e){const m=potato(.9),sx=e.x+(px>e.x?.6:-.6),sy=e.y+1.1,tx=px+vx*.35,ty=py+.9,d=tx-sx,t=Math.min(1.2,Math.max(.55,Math.abs(d)/9)),g=14;m.position.set(sx,sy,0);pots.push({m,vx:d/t,vy:(ty-sy+.5*g*t*t)/t,g});snd(260,.2,'square',.04,-120)}
function explode(e){const y=e.y+.8;puff(e.x,y,0,24,[0xc79a58,0xb98a4b,0xfff3d0,0xff9a3a],9,.8,4);snd(110,.5,'sawtooth',.1,-80);for(let k=0;k<10;k++){const m=potato(.85+Math.random()*.4);m.position.set(e.x+(Math.random()-.5)*.6,y+Math.random()*.6,(Math.random()-.5)*.6);chunks.push({m,vx:(Math.random()-.5)*9,vy:5+Math.random()*8,vz:(Math.random()-.5)*3,sx:(Math.random()-.5)*14,sz:(Math.random()-.5)*14,rest:false})}while(chunks.length>60){PG.remove(chunks.shift().m)}}
function updE(dt,playing){
 if(playing){spT-=dt;if(spT<=0){spT=Math.max(3,8-lv.haz*4)+Math.random()*5;if(Math.random()<.8)spawnE()}}
 for(let k=ens.length-1;k>=0;k--){const e=ens[k],I=e.i;e.t+=dt;const p=Math.min(1,e.t/.5),sc=p<1?(1-Math.pow(1-p,3))*(1+Math.sin(p*3.14)*.25):1;I.root.scale.setScalar(Math.max(.01,sc));
  I.root.position.set(e.x,e.y,0);I.root.rotation.y+=((px>e.x?Math.PI/2-.25:-Math.PI/2+.25)-I.root.rotation.y)*Math.min(1,dt*10);
  if(playing){e.th-=dt;const d=Math.abs(px-e.x);if(e.th<=0&&e.t>.8&&d<15&&d>1.2){e.wind=.45;e.th=1.8+Math.random()*.9;e.thrown=false}
   if(e.wind>0){e.wind-=dt;if(e.wind<=0&&!e.thrown){e.thrown=true;e.kick=.2;throwP(e)}}e.kick=Math.max(0,e.kick-dt);
   if(px-e.x>14){I.root.visible=false;bpool.push(I);ens.splice(k,1);continue}}
  const w=e.wind>0?-.45*Math.min(1,(.45-e.wind)/.3):e.kick>0?.35*e.kick/.2:0;I.lean.rotation.x+=(w-I.lean.rotation.x)*Math.min(1,dt*20);I.mx.timeScale=e.wind>0?.2:.9;I.mx.update(dt)}
 for(let k=pots.length-1;k>=0;k--){const q=pots[k],m=q.m;q.vy-=q.g*dt;m.position.x+=q.vx*dt;m.position.y+=q.vy*dt;m.rotation.z+=dt*9;let dead=false;
  if(playing&&inv<=0&&Math.abs(m.position.x-px)<.5&&m.position.y>py&&m.position.y<py+1.8){hurt();dead=true}
  else if(m.position.y<floorAt(m.position.x,m.position.y+.3)+.2||m.position.y<-3)dead=true;
  if(dead){puff(m.position.x,m.position.y,0,6,[0xc79a58,0xb98a4b],4,.4);PG.remove(m);pots.splice(k,1)}}
 chunks.forEach(c=>{if(c.rest)return;const m=c.m;c.vy-=28*dt;m.position.x+=c.vx*dt;m.position.y+=c.vy*dt;m.position.z=Math.max(-1.6,Math.min(1.8,m.position.z+c.vz*dt));m.rotation.x+=c.sx*dt;m.rotation.z+=c.sz*dt;const f=floorAt(m.position.x,m.position.y+.4);
  if(c.vy<0&&f>-90&&m.position.y<f+.22){m.position.y=f+.22;if(c.vy<-4){c.vy*=-.38;c.vx*=.65;c.vz*=.65;c.sx*=.6;c.sz*=.6}else{c.rest=true;c.vy=0;m.rotation.x=0}}
  if(m.position.y<-8){PG.remove(m);c.dead=true}});chunks=chunks.filter(c=>!c.dead)}
(function(){try{fetch(new URL('./assets/glb2.glb', import.meta.url)).then(r=>r.arrayBuffer()).then(buffer=>{const u=new Uint8Array(buffer);new THREE.GLTFLoader().parse(u.buffer,'',g=>{try{initBean(g)}catch(e){console.error(e)}ok()},e=>{console.error(e);ok()})}).catch(e=>{console.error(e);ok()})}catch(e){console.error(e);ok()}})();
// fly
let fl=null,poops=[],spF=7;const FM=new THREE.MeshBasicMaterial({map:new THREE.TextureLoader().load(new URL('./assets/fly.png', import.meta.url).href),transparent:true,alphaTest:.05,side:THREE.DoubleSide}),FAR=0.771,POM=new THREE.MeshLambertMaterial({color:0x5a3a1a}),PO1=new THREE.SphereGeometry(1,10,8);
function poop(){const g=new THREE.Group();[[.24,0],[.17,.16],[.1,.27]].forEach(a=>{const m=new THREE.Mesh(PO1,POM);m.scale.set(a[0],a[0]*.7,a[0]);m.position.y=a[1];g.add(m)});return g}
function clearF(){if(fl){scene.remove(fl.m);fl=null}poops.forEach(p=>scene.remove(p.g));poops=[]}
function spawnF(){if(fl)return;const HW=Math.tan(.4189)*camZ*cam.aspect,s=Math.random()<.5?-1:1,m=new THREE.Mesh(new THREE.PlaneGeometry(2.1,2.1*FAR),FM);scene.add(m);fl={m,x:camX+s*(HW+3),y:4.9,dir:-s,t:0,cd:1.5,life:15+Math.random()*6,vx:0,lv:0,ld:1};snd(180,.4,'sawtooth',.04,60)}
function updF(dt,playing){
 if(playing){spF-=dt;if(spF<=0){spF=11+Math.random()*9-lv.haz*4;if(!fl&&px<lv.L-10&&Math.random()<.8)spawnF()}}
 if(fl){const f=fl,HW=Math.tan(.4189)*camZ*cam.aspect;f.t+=dt;f.life-=dt;let tx=px+Math.sin(f.t*.8)*HW*.65;if(f.life<=0){if(!f.lv){f.lv=1;f.ld=f.x>camX?1:-1}tx=camX+f.ld*(HW+6)}
  const want=Math.max(-6.5,Math.min(6.5,(tx-f.x)*1.6));f.vx+=(want-f.vx)*Math.min(1,dt*2.5);f.x+=f.vx*dt;f.y=4.9+Math.sin(f.t*2.4)*.4;if(Math.abs(f.vx)>.8)f.dir=f.vx>0?1:-1;f.cd-=dt;
  if(playing&&f.life>0&&f.cd<=0&&Math.abs(f.x-(px+vx*.35))<.9){f.cd=1.6+Math.random()*1.2;const g=poop();g.position.set(f.x,f.y-.7,0);scene.add(g);poops.push({g,vx:f.vx*.6,vy:0});snd(330,.25,'square',.04,-200)}
  const fl2=Math.sin(f.t*40);f.m.position.set(f.x,f.y,.2);f.m.scale.set(f.dir*(1+fl2*.03),1+fl2*.05,1);f.m.rotation.z=-f.vx*.025;
  if(f.life<=0&&Math.abs(f.x-camX)>HW+4){scene.remove(f.m);fl=null}}
 for(let k=poops.length-1;k>=0;k--){const p=poops[k],g=p.g;p.vy-=22*dt;g.position.x+=p.vx*dt;g.position.y+=p.vy*dt;g.rotation.y+=dt*6;let dead=false;
  if(playing&&inv<=0&&Math.abs(g.position.x-px)<.5&&g.position.y>py-.1&&g.position.y<py+1.8){hurt();dead=true}
  else if(g.position.y<floorAt(g.position.x,g.position.y+.3)+.1||g.position.y<-3)dead=true;
  if(dead){puff(g.position.x,g.position.y+.1,0,8,[0x5a3a1a,0x7a5230],4,.45);scene.remove(g);poops.splice(k,1)}}}
// biomes
const WA=[11,22,33].map(sd=>{const r=rng(sd),c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#f3ede0';x.fillRect(0,0,64,64);for(let a=0;a<4;a++)for(let b=0;b<4;b++){x.fillStyle=r()<.2?'#f1c24a':'#5c7f9a';x.fillRect(a*16+3,b*16+4,10,7);x.fillStyle='#d8d0c0';x.fillRect(a*16,b*16+12,16,3)}const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.NearestFilter;return t});
function auTex(){const c=document.createElement('canvas');c.width=8;c.height=128;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,128);g.addColorStop(0,'rgba(60,255,170,0)');g.addColorStop(.5,'rgba(60,255,170,.6)');g.addColorStop(1,'rgba(150,90,255,0)');x.fillStyle=g;x.fillRect(0,0,8,128);return new THREE.CanvasTexture(c)}
function scenery(lv,r,L,BF){
 const bm=c=>new THREE.MeshBasicMaterial({color:new THREE.Color(c).multiplyScalar(BF)}),M=(c,z)=>z<-8?bm(c):mat(c),
 add=(g,m,x,y,z,sx=1,sy=1,sz=1)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);LG.add(o);return o},
 CONE=new THREE.ConeGeometry(1,1,7),CYL=new THREE.CylinderGeometry(1,1,1,8),SPH=new THREE.SphereGeometry(1,12,8),ROOF=new THREE.ConeGeometry(1,1,4).rotateY(.785),b=lv.bio;
 if(b=='city'){for(let k=-10;k<L+40;k+=15){box(.15,5,.15,0x222,k,2.5,-3.4);box(.9,.9,.9,0xffd27a,k,5.2,-3.4).material=new THREE.MeshBasicMaterial({color:0xffd27a})}return}
 if(b=='outback'){
  for(let k=0;k<3;k++)add(SPH,bm(0xb4502e),r()*L,-2,-54,26+r()*10,12+r()*4,10);
  for(let x=-30;x<L+60;x+=14+r()*14){const w=7+r()*8,h=4+r()*5;add(BOX,bm(0xc8643a),x,h/2-1,-34,w,h,6);add(BOX,bm(0xe08a55),x,h-.8,-34,w*1.02,.6,6.1)}
  const tree=(x,z,s)=>{add(CYL,M(0xe8e0cf,z),x,2*s,z,.2*s,4*s,.2*s);for(let k=0;k<3;k++)add(SPH,M(0x6b7a3a,z),x+(k-1)*.9*s,4.3*s+k%2*.4*s,z,1.3*s,.7*s,1.1*s)};
  for(let x=-20;x<L+50;x+=7+r()*10)tree(x,-12-r()*6,1.3+r()*.8);for(let x=8;x<L+10;x+=22+r()*18)tree(x,-3.3,1+r()*.4);
  for(let x=5;x<L+10;x+=11+r()*8){add(CONE,mat(0x9a5030),x,.9,-3.2,.6,1.8,.6);for(let k=0;k<3;k++)add(CONE,mat(0xb8a84e),x+3+k*.3,.35,-3.2-k*.3,.3,.7,.3)}
  for(let x=30;x<L;x+=45+r()*20){add(BOX,mat(0x333),x,1,-3.4,.1,2,.1);add(BOX,mat(0xf4c20a),x,2.4,-3.4,.9,.9,.08).rotation.z=.785}
 }
 if(b=='finland'){
  const pine=(x,z,s,full)=>{if(full)add(CYL,M(0x4a3220,z),x,.6*s,z,.15*s,1.2*s,.15*s);for(let k=0;k<(full?3:2);k++){add(CONE,M(0x1f4a35,z),x,(1.7+k*1.1)*s,z,(1.5-k*.35)*s,1.8*s,(1.5-k*.35)*s);add(CONE,M(0xf2f6fa,z),x,(2.15+k*1.1)*s,z,(.85-k*.2)*s,.8*s,(.85-k*.2)*s)}};
  for(let x=-40;x<L+60;x+=4+r()*3)pine(x,-31-r()*3,2.6+r()*1.4);for(let x=-30;x<L+50;x+=5+r()*4)pine(x,-19-r()*2,1.9+r()*.8);for(let x=-20;x<L+40;x+=7+r()*5)pine(x,-10-r()*2,1.5+r()*.6);
  for(let x=6;x<L+10;x+=12+r()*10)pine(x,-3.4,1.1+r()*.5,1);
  for(let x=14;x<L+30;x+=34+r()*18){add(BOX,bm(0xa8372c),x,1.2,-8,3.6,2.4,2.6);add(ROOF,bm(0x3a3038),x,3.2,-8,3.2,1.6,2.4);add(BOX,bm(0xffd27a),x+.9,1.3,-6.65,.7,.7,.05);add(BOX,bm(0x3a3038),x-1,3.6,-8,.4,1.2,.4)}
  if(['Midnight','Neon','Dusk'].includes(lv.n)){LG.userData.au=[0,1].map(k=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(150,28),new THREE.MeshBasicMaterial({map:auTex(),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:false}));m.position.set(0,24+k*5,-92+k);m.rotation.z=k?.12:-.08;LG.add(m);return m})}
  const sn=[];for(let k=0;k<70;k++){const m=new THREE.Mesh(BOX,new THREE.MeshBasicMaterial({color:0xffffff,fog:false}));m.scale.setScalar(.09);m.position.set((Math.random()-.5)*26,Math.random()*10,Math.random()*5-2);m.userData={s:.8+Math.random()*1.2,p:Math.random()*6};LG.add(m);sn.push(m)}LG.userData.sn=sn;
 }
 if(b=='telaviv'){
  add(new THREE.PlaneGeometry(L+240,12),bm(0x2f9ccf),L/2,5,-56);
  const palm=(x,z,s)=>{add(CYL,M(0x8a6a44,z),x,2.2*s,z,.22*s,4.4*s,.22*s);const fm=M(0x2f8a3a,z);for(let k=0;k<7;k++){const g=new THREE.Group();g.position.set(x,4.4*s,z);g.rotation.y=k*.9;const f=new THREE.Mesh(BOX,fm);f.scale.set(2.6*s,.08*s,.6*s);f.position.set(1.2*s,-.2*s,0);f.rotation.z=-.35;g.add(f);LG.add(g)}};
  for(let x=-20;x<L+40;x+=14+r()*8)palm(x,-11-r()*5,1.2+r()*.5);for(let x=10;x<L+10;x+=24+r()*10)palm(x,-3.2,1+r()*.3);
  for(let x=4;x<L+10;x+=17+r()*8){const c=[0xd7263d,0x3a8fb0,0xf4b32a][r()*3|0];add(CYL,mat(0xeeeeee),x,1.1,-3,.05,2.2,.05);add(CONE,mat(c),x,2.3,-3,1.1,.6,1.1)}
 }
}
function snowU(dt){const sn=LG.userData.sn;if(!sn)return;for(const m of sn){const u=m.userData;m.position.y-=u.s*dt;m.position.x+=Math.sin(T*1.3+u.p)*.4*dt;if(m.position.y<-.2){m.position.y=9+Math.random()*3;m.position.x=camX+(Math.random()-.5)*26}if(Math.abs(m.position.x-camX)>14)m.position.x=camX+(m.position.x>camX?-13:13)}}
// loop
let prev=performance.now();
function tick(now){requestAnimationFrame(tick);const dt=Math.min((now-prev)/1000,1/30);prev=now;T+=dt;if(!LG)return;
 const L=lv.L,playing=state=='play';
 if(playing||state=='win'){
  let dir=(K.ArrowRight||K.d||K.D||tc.r?1:0)-(K.ArrowLeft||K.a||K.A||tc.l?1:0);const jh=K.ArrowUp||K[' ']||K.w||K.W||K.z||tc.j;
  if(state=='win'){dir=px<L-2.4?1:0}
  const tv=dir*7.2;vx+=(tv-vx)*Math.min(1,(gnd?16:7)*dt);if(dir)face=dir;
  if(jb>0)jb-=dt;coy=gnd?.1:coy-dt;
  if(jb>0&&coy>0&&playing){vy=15.5;jb=0;coy=0;gnd=false;snd(300,.15,'square',.04,300);land=-.2}
  vy-=(vy>0&&!jh?80:36)*dt;const py0=py;px+=vx*dt;py+=vy*dt;if(px<-6)px=-6;gnd=false;
  if(vy<=0)for(const s of solids)if(px+.3>s.x0&&px-.3<s.x1&&py0>=s.top-.06&&py<=s.top){py=s.top;if(vy<-6)land=.25;vy=0;gnd=true}
  if(playing){
   if(py<-7)hurt(true);
   spikes.forEach(s=>{if(px+.25>s[0]&&px-.25<s[1]&&py<.55&&py>-.5)hurt()});
   barrels.forEach(b=>{if(Math.abs(px-b.x)<.75&&py<1.0&&py>-.5)hurt()});
   for(let k=ens.length-1;k>=0;k--){const e=ens[k];if(e.t<.5)continue;const dx=Math.abs(px-e.x);if(dx<.8&&vy<0&&py0>=e.y+1&&py<=e.y+1.5){explode(e);e.i.root.visible=false;bpool.push(e.i);ens.splice(k,1);vy=13.5;py=Math.max(py,e.y+1.5);jb=0;gnd=false;snd(500,.2,'triangle',.07,400)}else if(dx<.6&&py<e.y+1.2&&py>e.y-1.8)hurt()}
   saus.forEach(s=>{if(!s[3]&&Math.hypot(px-s[0],py+.9-s[1])<.85){s[3]=true;s[2].visible=false;got++;hud();snd(700+got*15,.12,'triangle',.06,500);puff(s[0],s[1],0,8,[0xf4b32a,0xfff3d0,0xd7263d],4)}});
   while(cpI+1<CP.length&&px>CP[cpI+1]){cpI++;cpObj[cpI].material.color.set(0x4cd964);snd(600,.2,'triangle',.06,400)}
   if(px>L-3)win();
  }
  if(inv>0)inv-=dt;
 }
 barrels.forEach(b=>{b.x+=b.d*b.v*dt;if(b.x>b.b)b.d=-1;if(b.x<b.a)b.d=1;b.o.position.x=b.x;b.o.rotation.z-=b.d*b.v*dt/.5});
 saus.forEach((s,k)=>{if(!s[3]){s[2].rotation.y=T*2.5;s[2].position.y=s[1]+Math.sin(T*3+k)*.08}});
 updE(dt,playing);updF(dt,playing);snowU(dt);
 // hero visuals
 const moving=Math.abs(vx)>1&&gnd;if(moving)runT+=dt*Math.abs(vx)*1.9;land*=Math.max(0,1-dt*9);
 hero.position.set(px,py,0);const dance=state=='win'&&px>=L-2.4,tgt=state=='title'||state=='over'||dance?.5:face>0?Math.PI/2-.25:-Math.PI/2+.25;hero.rotation.y+=(tgt-hero.rotation.y)*Math.min(1,dt*14);
 lean.rotation.x+=((moving?.08:0)-lean.rotation.x)*Math.min(1,dt*10);
 const st=gnd?1-land*.6:1+Math.min(.12,Math.abs(vy)*.006);lean.scale.set(1/Math.sqrt(st),st,1/Math.sqrt(st));
 hero.visible=inv<=0||Math.floor(T*16)%2==0;if(mixer){setAnim(dance?'Boom_Dance':(moving||!gnd)&&state!='over'?'Running':'Idle_11');mixer.timeScale=!gnd?.3:moving?Math.max(.8,Math.abs(vx)/7.2):1;mixer.update(dt)};
 let top=-99;for(const s of solids)if(px>s.x0&&px<s.x1&&s.top<=py+.1&&s.top>top)top=s.top;blob.visible=top>-90;blob.position.set(px,top+.03,0);blob.scale.setScalar(Math.max(.3,1-(py-top)*.12));
 // grill
 if(state=='win'){winT+=dt;gS.forEach((s,k)=>{const a=winT-k*.25-.5;if(a>0){if(!s.visible){s.visible=true;puff(gx,1.8,0,5,[0xffd27a,0xffffff],3,.5);snd(900,.05,'noise'in{}?'square':'square',.03)}const q=Math.min(1,a/2.5);s.userData.m.color.setRGB(.88-.58*q,.44-.33*q,.48-.38*q)}});if(winT>gS.length*.25+3.2&&!shown)finish()}
 if(LG.userData.B&&(state=='win'||Math.random()<.2))puff(gx+(Math.random()-.5)*1.6,1.5,(Math.random()-.5)*1.6,1,[0xff7a1a,0xffc83a,0xff3a1a],.8,.7,state=='win'?3.5:2);
 PP.forEach(m=>{if(!m.visible)return;const u=m.userData;u.l-=dt;if(u.l<=0)m.visible=false;else{m.position.addScaledVector(u.v,dt);m.scale.setScalar(u.l/u.m)}});
 // camera
 const cx=state=='win'?gx-1.5:px+(state=='title'?2:3.2*face);camX+=(Math.max(0,Math.min(cx,L+4))-camX)*Math.min(1,dt*4);camY+=((state=='win'?3.2:3.2+Math.max(0,py)*.3)-camY)*Math.min(1,dt*3);
 cam.position.set(camX,camY+(camZ>16?2:0),camZ);cam.lookAt(camX,camY-.9,0);sunL.position.set(camX+6,12,10);sunL.target.position.set(camX,0,0);LG.userData.sun.position.x=camX*.95;if(LG.userData.au)LG.userData.au.forEach(a=>a.position.x=camX*.95);
 $('bar').firstChild.style.width=Math.min(100,Math.max(0,px/L*100))+'%';
 R.render(scene,cam)}
build(0);title();requestAnimationFrame(tick);

// Hosting hooks only: the original controls, generation, physics, enemies,
// checkpoints, audio and three-level quest stay unchanged above.
window.setVol = setVol;
export function connectPeeper(bridge) {
 const originalStart=start, originalWin=win, originalFinish=finish;
 let ticket=null, attempt=0, reward=null;
 const rewardLine=()=>{
  if(!shown||state!=='win')return;
  let line=$('peeper-reward');
  if(!line){line=document.createElement('p');line.id='peeper-reward';$('card').append(line)}
  line.textContent=reward?.message || (ticket?'Saving your Peeper reward…':'Practice · daily rewards complete');
  line.style.color='#f4b32a';
 };
 bridge.onReward((token,result)=>{
  if(ticket!==token)return;
  reward={message:result.coinsEarned>0?`+${result.coinsEarned} ✦ · ${result.sausageQuest.completedToday}/5 levels today`:'Daily rewards complete · keep playing!'};
  rewardLine();
 });
 start=function(i,keep){
  originalStart(i,keep);ticket=null;reward=null;const active=++attempt;
  // Freeze only while the host obtains a reward ticket. The level starts at
  // exactly its original initial state once the server acknowledges it.
  state='peeper-wait';card('<h2>Ready to grill?</h2><p>Connecting to Peeper…</p>');
  const payload={requestId:bridge.requestId(),level:{index:li,seed:lv.seed,length:lv.L,hazard:lv.haz}};
  const prepare=()=>{
   card('<h2>Ready to grill?</h2><p>Connecting to Peeper…</p>');
   bridge.start(payload).then(result=>{
    if(active!==attempt)return;
    if(result.token&&result.totalSausages!==total)throw new Error('Level layout could not be verified');
    ticket=result.token;state='play';card('');
   }).catch(()=>{
    if(active!==attempt)return;
    card('<h2>Connection interrupted</h2><p>Retry to earn coins, or play this level for fun.</p><button id="peeper-retry">Retry connection</button><button id="peeper-practice">Practice</button>');
    $('peeper-retry').onclick=prepare;
    $('peeper-practice').onclick=()=>{ticket=null;reward={message:'Practice · no reward for this level'};state='play';card('')};
   });
  };
  prepare();
 };
 win=function(){
  originalWin();
  if(ticket){
   bridge.finish({token:ticket,collected:got,total}).catch(error=>{
    reward={message:error.retryable===false?'Reward could not be saved · '+error.message:'Reward pending · reconnect to Peeper to save it'};rewardLine();
   });
  }
 };
 finish=function(){originalFinish();rewardLine()};
 bridge.ready();
 const releaseControls=()=>{for(const key of Object.keys(K))K[key]=0;tc.l=tc.r=tc.j=0;['bl','br','bj'].forEach(id=>$(id).classList.remove('on'));jb=0};
 addEventListener('blur',releaseControls);
 document.addEventListener('visibilitychange',()=>{
  releaseControls();prev=performance.now();
  if(AC){if(document.hidden)AC.suspend();else if(state!=='title')AC.resume()}
 });
}
