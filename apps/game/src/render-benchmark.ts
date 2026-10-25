import { Mesh } from 'three';
import type { SegmentPose, MotionWorld } from '@crossy/protocol';
// Standalone local diagnostic fixture. No network or physics on the render thread.
import { GameRenderer } from './renderer';
import { wrapTrafficX, sectionIndex, roadLanes, generateSection, generatedScenario, groupScenario, railwayScenario, roadScenario, scenarios, roadSettings, railwaySettings } from '@crossy/config';
import { PerformanceMetrics } from './performance-metrics';
const fixtureParams = new URLSearchParams(location.search);
const fixtureAspect=Number(fixtureParams.get('aspect'));
if(fixtureAspect>=.4&&fixtureAspect<=4){
  const viewport=document.getElementById('viewport')!;
  viewport.style.width=`min(100vw, ${85*fixtureAspect}vh)`;
  viewport.style.height='auto';viewport.style.aspectRatio=String(fixtureAspect);
}
const renderer = new GameRenderer(document.getElementById('viewport')!);
let generatedWorld:MotionWorld|undefined;
const output = document.getElementById('output')!;
const params = new URLSearchParams(location.search);
const generated = params.get('scene') === 'generated';
const fixtureZ = Number(params.get('z')??24);
const road = params.get('scene') === 'road';
const railway = params.get('scene') === 'railway';
const capacity = params.get('capacity') === '4' ? 4 : params.get('capacity') === '3' ? 3 : 2;
renderer.setScenario(generated ? groupScenario(generatedScenario,capacity) : railway ? groupScenario(railwayScenario, capacity) : road ? roadScenario : scenarios[0]!);
// Development-only same-geometry A/B reference, never a gameplay setting.
if (params.get('boundaryShade') === '0') renderer.boundaryShading.amount.value = 0;
if (railway || generated) renderer.chain.setCount(12 * (capacity - 1));
renderer.chain.group.visible = generated || road || railway;
const assetLoadStart = performance.now();
await renderer.loadGoose();
const characterLoadMs = performance.now() - assetLoadStart;
for (const [id] of renderer.players) renderer.labels.setName(id, ({p1:"Goose",p2:"Axie",p3:"Capy",p4:"Unicorn"})[id]);
if (road) await renderer.traffic.load();
if (railway) { await renderer.railway.load(); renderer.railway.update({elapsedSeconds:railwaySettings.safeSeconds+40/35,pass:0,x:4,signal:'occupying',dead:[],outcome:'active'}); }
if(generated){
  // Static rendering-only slack formation; no physics work on this thread.
  // Both half-arms have length 3 m, matching the existing 6 m / 12 span cable.
  const poses:SegmentPose[]=[];
  for(let pair=0;pair<capacity-1;pair++){
    const ax=(capacity-1)*2-pair*4,z=fixtureZ-5,bend=Math.sqrt(5);
    const points=Array.from({length:13},(_,i)=>i<=6?{x:ax-2*i/6,z:z+bend*i/6}:{x:ax-2-2*(i-6)/6,z:z+bend*(1-(i-6)/6)});
    for(let i=0;i<12;i++){
      const a=points[i]!,b=points[i+1]!,dx=(b.x-a.x)/.5,dz=(b.z-a.z)/.5,norm=Math.hypot(dz,-dx,1);
      poses.push({position:{x:(a.x+b.x)/2,y:.9,z:(a.z+b.z)/2},rotation:{x:dz/norm,y:0,z:-dx/norm,w:1/norm}});
    }
  }
  renderer.chain.update(poses,poses,1);
  const seed=Number(params.get('seed')??20261016), index=sectionIndex(fixtureZ);
  const sections=Array.from({length:7},(_,i)=>generateSection(seed,index-2+i));
  generatedWorld={version:4,riverVersion:1,highWater:fixtureZ,rearLimit:fixtureZ-7,seed,elapsedSeconds:0,sections,hazards:sections.flatMap<MotionWorld['hazards'][number]>(s=>s.type==='road'?[{id:s.id,road:{elapsedSeconds:0,vehicles:roadLanes(s).flatMap((lane,i)=>lane.positions.map((offset,slot)=>({id:roadLanes(s).slice(0,i).reduce((n,l)=>n+l.positions.length,0)+slot,lane:i,x:params.has('stacked')?4:slot===0?lane.offset:wrapTrafficX(lane.offset+offset,lane.period)}))),dead:[],outcome:'active' as const}}]:s.type==='railway'?[{id:s.id,railway:{elapsedSeconds:railwaySettings.safeSeconds+40/35,pass:0,x:4,signal:'occupying' as const,dead:[],outcome:'active' as const}}]:[]),water:{exposureLimitSeconds:8,recoverySeconds:1,players:[],dead:[],outcome:'active'},dead:[],outcome:'active'};renderer.generated.update(generatedWorld);
}
if (params.has('hideTrain')) renderer.railway.train.visible = false;
if (params.has('hideCars')) renderer.traffic.group.visible = false;

// Development-only M15D review: synthetic cosmetic stimuli, never gameplay authority.
const effects = renderer.effects;
const controls = document.createElement('div');
let heldEffect: import('./visual-effects').EffectKind | undefined;
let pulseEffect: import('./visual-effects').EffectKind | undefined;
let lastPulse = -Infinity;
for (const kind of ['entry','exit','car','train','clear'] as const) {
  const button=document.createElement('button');button.textContent=kind;
  button.onclick=()=>{ heldEffect=undefined; pulseEffect=undefined; effects?.clear(); if(kind!=='clear') burst(kind); };
  controls.append(button);
}
const hold=document.createElement('select');
for(const kind of ['none','entry','exit','car','train']){const option=document.createElement('option');option.value=kind;option.textContent=`Held capture: ${kind}`;hold.append(option);}
hold.onchange=()=>{effects?.clear();pulseEffect=undefined;heldEffect=hold.value==='none'?undefined:hold.value as typeof heldEffect;};controls.append(hold);
const pulse=document.createElement('button');pulse.textContent='Measure train bursts';pulse.onclick=()=>{heldEffect=undefined;pulseEffect='train';lastPulse=-Infinity;};controls.append(pulse);
const reset=document.createElement('button');reset.textContent='Reset samples';reset.onclick=()=>{metrics=new PerformanceMetrics();};controls.append(reset);
output.before(controls);
function burst(kind: import('./visual-effects').EffectKind) {
  for(const [i,slot] of (['p1','p2','p3','p4'] as const).slice(0,capacity).entries()) effects?.emit({kind,slot,position:{x:generated?(capacity-1)*2-i*4:i*3-1.5,y:kind==='entry'||kind==='exit'?.065:.9,z:generated?fixtureZ-5:-2}});
}

let metrics = new PerformanceMetrics();
let last = performance.now(), count = 0;
const start = last;
const draw = (now: number) => {
  const lastFrame=last;
  const elapsed = params.has('still') ? 0 : (now - last) / 1000; last = now;
  const characterStart=performance.now();
  for (const [index, view] of [...renderer.players.values()].entries()) {
    if(params.has('riverReview'))view.setWater({id:('p'+(index+1)) as 'p1'|'p2'|'p3'|'p4',phase:'endangered',exposureSeconds:index*2,safeSeconds:0});
    view.update({x:generated?(capacity-1)*2-index*4:index*3-1.5,y:params.has('riverReview') ? .47 : .9,z:generated?fixtureZ-5:-2},{x:params.has('still')?0:.5,z:0,y:0},elapsed,true,false);
  }
  if(now-start>2000)metrics.record('character updates CPU ms',performance.now()-characterStart);
  renderer.camera.update(generated?[{x:-6,y:.9,z:fixtureZ-5},{x:6,y:.9,z:fixtureZ+5}]:[{x:-1.5,y:.9,z:-2},{x:1.5,y:.9,z:12}],elapsed,count===0);
  if (road) renderer.traffic.update({elapsedSeconds:now/1000,outcome:'active',dead:[],vehicles:roadSettings.lanes.flatMap((_lane,i)=>[0,1].map(n=>({id:i*2+n,lane:i,x:Math.sin(now/3000+n)*12}))) });
  if(generatedWorld&&params.has('motion')){
    const time=(now-start)/1000+Number(params.get('time')??0);generatedWorld.elapsedSeconds=time;
    for(const h of generatedWorld.hazards){
      const section=generatedWorld.sections.find(s=>s.id===h.id)!;
      if(h.road){h.road.elapsedSeconds=time;for(const v of h.road.vehicles){
        const lane=roadLanes(section)[v.lane]!,slots=h.road.vehicles.filter(c=>c.lane===v.lane),slot=slots.findIndex(c=>c.id===v.id);
        v.x=wrapTrafficX(lane.offset+lane.positions[slot]!+lane.speed*lane.direction*time,lane.period);
      }}
      if(h.railway){
        const pass=Math.floor(time/7),local=time-pass*7;
        const along=railwaySettings.entryX+Math.max(0,local-railwaySettings.safeSeconds)*35;
        const front=along+3.18,rear=along-12.5;
        h.railway={...h.railway,elapsedSeconds:time,pass,x:along*section.direction,
          signal:front>=-10.35&&rear<=10.35?'occupying':local>=railwaySettings.safeSeconds+(-10.35-railwaySettings.entryX-3.18)/35-3&&rear<=10.35?'warning':'safe'};
      }
    }
    renderer.generated.update(generatedWorld);
  }
  if(pulseEffect && now-lastPulse>=850){burst(pulseEffect);lastPulse=now;}
  const effectStart=performance.now();
  if(heldEffect){effects?.clear();burst(heldEffect);effects?.update(.16);}
  const before = performance.now(); renderer.draw();
  if(now-start>2000)metrics.record('effect fixture CPU ms',before-effectStart);
  if (now-start>2000) { metrics.record('frame interval ms',now-lastFrame); metrics.record('render submission CPU ms',performance.now()-before); }
  if (++count%60===0) {
    const downloads=performance.getEntriesByType('resource').filter(e=>/\.glb(?:\?|$)/.test(e.name)&&!/[?&](?:import|url)(?:&|$)/.test(e.name)) as PerformanceResourceTiming[];
    const resources={glbRequests:downloads.length,uniqueGlbs:new Set(downloads.map(e=>e.name)).size,encodedBytes:downloads.reduce((n,e)=>n+e.encodedBodySize,0),transferBytes:downloads.reduce((n,e)=>n+e.transferSize,0)};
    let meshCount=0; renderer.scene.traverse(o=>{if(o instanceof Mesh)meshCount++;});
    output.replaceChildren(...`Fixture ${params.has('riverReview')?'synthetic river rings · ':''}${generated?`generated ${capacity} seats at ${fixtureZ}m`:railway?`railway ${capacity} seats${params.has('hideTrain')?' without train':''}`:road?'road with six car models':'foundation'} · ${((count-1)*1000/(now-start)).toFixed(1)} FPS average incl loading warmup\n${metrics.summary()}\nDraw calls ${renderer.renderer.info.render.calls} · triangles ${renderer.renderer.info.render.triangles} · geometries ${renderer.renderer.info.memory.geometries} · scene meshes ${meshCount} · textures ${renderer.renderer.info.memory.textures} · effects ${JSON.stringify(effects?.metrics()??{})} · character load ${characterLoadMs.toFixed(1)} ms · resources ${JSON.stringify(resources)} · character triangles ${[...renderer.players.values()].reduce((sum,p)=>sum+p.characterTriangles,0)}`.split('\n').map(line=>{const row=document.createElement('div');row.textContent=line;return row;}));
  }
  requestAnimationFrame(draw);
};requestAnimationFrame(draw);
