import { beforeAll, expect, it } from 'vitest';
import { roadLanes } from '@crossy/config';
import { GeneratedWorld, initializePhysics } from '@crossy/simulation';
import { maxSnapshotBytes, maxGeneratedSnapshotBytes, isSnapshotMessage, isPrivateRoomOptions, isCouchOptions, packSnapshot, unpackSnapshot } from '@crossy/protocol';
import { AuthoritativeSession } from './authoritative-session.js';
beforeAll(initializePhysics);
it.each([2,3,4] as const)('%i generated seats: authoritative seed/layout, strict snapshots, pause/reconnect reconstruction and reset',capacity=>{
 const s=new AuthoritativeSession('generated',capacity,42);
 try{
  const initial=s.snapshot(0);expect(isSnapshotMessage(initial)).toBe(true);expect(unpackSnapshot(packSnapshot(initial))).toEqual(initial);
  expect(initial.world!.seed).toBe(42);s.setPhase('running');for(let i=0;i<180;i++)s.advance(1/60);
  const before=s.snapshot(1000);s.setPhase('paused');for(let i=0;i<1000;i++)s.advance(1/60);
  const paused=s.snapshot(2000);expect(paused.world).toEqual(before.world);expect(paused.chain).toEqual(before.chain);expect(paused.players).toEqual(before.players);
  expect(isSnapshotMessage(paused)).toBe(true);expect(unpackSnapshot(packSnapshot(paused))).toEqual(paused);
  paused.world!.sections[0]!.start=999;expect(s.snapshot(2100).world).toEqual(before.world);
  s.reset();expect(s.snapshot(3000).world).toEqual(initial.world);expect(s.runGeneration).toBe(1);
  for(const mutate of [(v:typeof initial)=>{v.world!.version=1 as 4;},(v:typeof initial)=>{v.world!.sections[0]!.id='spoof';},(v:typeof initial)=>{v.world!.sections[0]!.start++;},(v:typeof initial)=>{v.world!.hazards=[];},(v:typeof initial)=>{delete v.world;},(v:typeof initial)=>{v.scenarioVersion=6;},(v:typeof initial)=>{v.phase='ended';}]){const bad=structuredClone(initial);mutate(bad);expect(isSnapshotMessage(bad)).toBe(false);}
 }finally{s.dispose();}
},30000);
it('room options allow only bounded generated seeds and keep phone authority untrusted',()=>{
 for(const seed of [0,42,4294967295]){
  expect(isPrivateRoomOptions({protocolVersion:1,capacity:4,course:'generated',seed})).toBe(true);
  expect(isCouchOptions({protocolVersion:1,role:'display',displaySecret:'b'.repeat(32),capacity:4,course:'generated',seed})).toBe(true);
 }
 for(const seed of [-1,1.5,NaN,4294967296,'42'])expect(isPrivateRoomOptions({protocolVersion:1,course:'generated',seed})).toBe(false);
 expect(isPrivateRoomOptions({protocolVersion:1,course:'river',seed:42})).toBe(false);
 expect(isCouchOptions({protocolVersion:1,role:'controller',course:'generated',seed:42})).toBe(false);
 const a=new AuthoritativeSession('generated'),b=new AuthoritativeSession('generated');try{expect(a.worldSeed).not.toBe(b.worldSeed);}finally{a.dispose();b.dispose();}
});
it('generated numeric wire tuples preserve terminal victims/water exactly and reject malformed values',()=>{
 const s=new AuthoritativeSession('generated',4,1);
 try{
  const snap=s.snapshot(1000),end=structuredClone(snap);end.phase='ended';end.world!.outcome='failed';end.world!.dead=['p2'];
  const road=end.world!.hazards.find(h=>h.road)!.road!;road.dead=['p2'];road.outcome='failed';
  expect(isSnapshotMessage(end)).toBe(true);expect(unpackSnapshot(packSnapshot(end))).toEqual(end);
  const wet=structuredClone(snap);wet.phase='ended';wet.world!.outcome='failed';wet.world!.dead=['p1'];wet.world!.water.dead=['p1'];wet.world!.water.outcome='failed';
  Object.assign(wet.world!.water.players[0]!,{phase:'failed',exposureSeconds:8,safeSeconds:0});
  expect(isSnapshotMessage(wet)).toBe(true);expect(unpackSnapshot(packSnapshot(wet))).toEqual(wet);
  const railSession=new AuthoritativeSession('generated',4,20261016);
  try{
   const train=railSession.snapshot(1200);train.phase='ended';train.world!.outcome='failed';train.world!.dead=['p3'];
   const hit=train.world!.hazards.find(h=>h.railway)!.railway!;hit.outcome='failed';hit.dead=['p3'];
   expect(isSnapshotMessage(train)).toBe(true);expect(unpackSnapshot(packSnapshot(train))).toEqual(train);
  }finally{railSession.dispose();}

  for(const mutate of [(w:NonNullable<ReturnType<typeof packSnapshot>['world']>)=>{w.water[2]=99;},(w:NonNullable<ReturnType<typeof packSnapshot>['world']>)=>{w.water[3]=NaN;},(w:NonNullable<ReturnType<typeof packSnapshot>['world']>)=>{w.hazards[0]!.push(1);},(w:NonNullable<ReturnType<typeof packSnapshot>['world']>)=>{w.hazards[0]![w.hazards[0]!.length-1]=16;},(w:NonNullable<ReturnType<typeof packSnapshot>['world']>)=>{w.sections[1]=4;}]){
   const wire=packSnapshot(snap);mutate(wire.world!);expect(unpackSnapshot(wire)).toBeUndefined();
  }
 }finally{s.dispose();}
});
it('preserves every pooled-slot coordinate losslessly and rejects inconsistent offsets and aliases',()=>{
 const s=new AuthoritativeSession('generated',4,42);
 try{
  s.setPhase('running');
  for(let i=0;i<180;i++){
   s.advance(1/60);const snap=s.snapshot(i),wire=packSnapshot(snap);
   expect(unpackSnapshot(wire)).toEqual(snap);
   for(const h of snap.world!.hazards.filter(h=>h.road)){
    expect(new Set(h.road!.vehicles.map(v=>v.id)).size).toBe(h.road!.vehicles.length);
    const row=wire.world!.hazards.find(row=>row[0]===snap.world!.sections.find(section=>section.id===h.id)!.index)!;
    expect(row.length).toBe(roadLanes(snap.world!.sections.find(s=>s.id===h.id)!).length+4);
   }
  }
  for(const [field,badValue] of [[3,0],[6,99],[6,-1],[6,.5]]){
   const wire=packSnapshot(s.snapshot(1000));wire.world!.sections[field!]=badValue!;
   expect(()=>unpackSnapshot(wire)).not.toThrow();expect(unpackSnapshot(wire)).toBeUndefined();
  }
  for(const alias of [false,true]){
   const bad=s.snapshot(1000),cars=bad.world!.hazards.find(h=>h.road)!.road!.vehicles;
   if(alias)cars[1]!.id=cars[0]!.id;else cars[1]!.x+=.01;
   expect(isSnapshotMessage(bad)).toBe(false);
  }
 }finally{s.dispose();}
});
it.each([2,3,4] as const)('%i progressed seats: pause/reclaim snapshots retain boundary, death freezes it and restart resets it',capacity=>{
 const s=new AuthoritativeSession('generated',capacity,42);
 try{
  const initial=s.snapshot(0);s.setPhase('running');
  for(let i=0;i<65;i++){for(const p of s.simulation.states())s.input(p.id,0,1,i+1);s.advance(1/60);}
  const advanced=s.snapshot(1000);expect(advanced.world!.highWater).toBeGreaterThan(0);expect(advanced.world!.rearLimit).toBeGreaterThan(-6.7);
  expect(unpackSnapshot(packSnapshot(advanced))).toEqual(advanced);
  s.setPhase('paused');for(let i=0;i<120;i++)s.advance(1/60);expect(s.snapshot(2000).world).toEqual(advanced.world);
  s.setPhase('running');for(let i=65;i<1500&&s.phase==='running';i++){for(const p of s.simulation.states())s.input(p.id,0,1,i+1);s.advance(1/60);}
  expect(s.phase).toBe('ended');const terminal=s.snapshot(3000);for(let i=0;i<120;i++)s.advance(1/60);expect(s.snapshot(4000).world).toEqual(terminal.world);
  expect(unpackSnapshot(packSnapshot(terminal))).toEqual(terminal);
  s.reset();expect(s.snapshot(5000).world).toEqual(initial.world);
  for(const mutate of [(w:NonNullable<typeof advanced.world>)=>{w.highWater=NaN;},(w:NonNullable<typeof advanced.world>)=>{w.rearLimit=Infinity;},(w:NonNullable<typeof advanced.world>)=>{w.rearLimit=w.highWater+1;}]){
   const bad=structuredClone(advanced);mutate(bad.world!);expect(isSnapshotMessage(bad)).toBe(false);
  }
 }finally{s.dispose();}
});

it('accepts bounded expanded pooled worlds beyond 16 KiB while compact packets stay under the original wire bound',()=>{
 const s=new AuthoritativeSession('generated',4,42);
 try{
  const world=new GeneratedWorld(42,4,['p1','p2','p3','p4'],()=>0,()=>{});
  world.stream([{x:0,y:.8,z:200},{x:0,y:.8,z:218.7}]);
  const snapshot=s.snapshot(0);snapshot.world=world.state();
  const fullBytes=Buffer.byteLength(JSON.stringify(snapshot)),wire=packSnapshot(snapshot);
  expect(fullBytes).toBeGreaterThan(maxSnapshotBytes);expect(fullBytes).toBeLessThan(maxGeneratedSnapshotBytes);
  expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(maxSnapshotBytes);
  expect(isSnapshotMessage(snapshot)).toBe(true);expect(unpackSnapshot(wire)).toEqual(snapshot);
  expect(unpackSnapshot({...wire,padding:'x'.repeat(maxSnapshotBytes)})).toBeUndefined();
 }finally{s.dispose();}
});
it.each([2,3,4] as const)('%i seats preserve versioned river recipes through compact/reconnect/pause/restart and reject recipe tampering',capacity=>{
 const s=new AuthoritativeSession('generated',capacity,1);
 try{
  const first=s.snapshot(0),river=first.world!.sections.find(s=>s.river)!;expect(river.river!.rocks.length).toBeGreaterThanOrEqual(5);
  expect(unpackSnapshot(packSnapshot(first))).toEqual(first);
  for(const mutate of [()=>{river.river!.rocks[0]!.x=0;},()=>{river.river!.acceleration=900;},()=>{river.river!.direction*=-1;},()=>{river.river!.rocks.pop();}]){
   const snapshot=s.snapshot(0),r=snapshot.world!.sections.find(s=>s.river)!;
   const old=river.river;river.river=r.river;mutate();expect(isSnapshotMessage(snapshot)).toBe(false);river.river=old;
  }
  s.setPhase('running');for(let i=0;i<60;i++)s.advance(1/60);const running=s.snapshot(1000);s.setPhase('paused');for(let i=0;i<300;i++)s.advance(1/60);
  const paused=s.snapshot(2000);expect(paused.world).toEqual(running.world);expect(unpackSnapshot(packSnapshot(paused))).toEqual(paused);
  s.reset();expect(s.snapshot(3000).world).toEqual(first.world);
 }finally{s.dispose();}
});

it('river rules schema rejects old/malformed state without throwing and permits reordered recipe keys',()=>{
 const s=new AuthoritativeSession('generated',4,1);
 try{
  for(const invalid of [null,3,{},'river']){const snap=s.snapshot(0);snap.world!.sections[0]=invalid as never;expect(isSnapshotMessage(snap)).toBe(false);}
  const old=s.snapshot(0);delete (old.world as unknown as Record<string,unknown>).riverVersion;expect(isSnapshotMessage(old)).toBe(false);
  const snap=s.snapshot(0),r=snap.world!.sections.find(s=>s.river)!.river!;
  Object.assign(r,{rocks:r.rocks.map(x=>({z:x.z,x:x.x,size:x.size,id:x.id}))});expect(isSnapshotMessage(snap)).toBe(true);expect(unpackSnapshot(packSnapshot(snap))).toEqual(snap);
 }finally{s.dispose();}
});
