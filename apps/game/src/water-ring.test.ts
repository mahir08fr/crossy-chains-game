import { expect,it } from 'vitest';
import { Mesh, BufferAttribute } from 'three';
import { waterRing } from './water-ring';
import { PlayerView } from './player-view';
import { waterFeedback } from './water-feedback';
import { SnapshotBuffer } from './snapshot-buffer';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { initializePhysics } from '@crossy/simulation';
const state=(exposureSeconds:number,phase:'endangered'|'safe'|'recovering'|'failed'='endangered')=>({id:'p1' as const,phase,exposureSeconds,safeSeconds:0});
it('uses the specified remaining fractions and green/yellow/red thresholds without ordinary timer text',()=>{
 for(const [seconds,remaining,color] of [[0,1,0x64d98b],[2,.75,0x64d98b],[4,.5,0xffd34e],[6,.25,0xf04747],[8,0,0xf04747]])expect(waterRing(state(seconds!))).toMatchObject({remaining,color});
 expect(waterRing(state(4,'recovering')).remaining).toBe(.5);expect(waterRing(state(0,'safe')).visible).toBe(false);expect(waterRing(state(8,'failed')).visible).toBe(false);
 expect(waterFeedback({exposureLimitSeconds:8,recoverySeconds:1,players:[state(4)],dead:[],outcome:'active'})).not.toMatch(/\d(?:\.\d)?s\b/);
});
it('reuses a fixed smooth arc buffer, depletes clockwise in world orientation and keeps recovery/per-player states separate',()=>{
 const a=new PlayerView(0xffaa00),b=new PlayerView(0x00aaff);
 try{
  a.setWater(state(2));b.setWater({...state(6),id:'p2'});
  const ma=a.group.getObjectByName('water-marker') as Mesh,mb=b.group.getObjectByName('water-marker') as Mesh;
  expect(ma).toBeDefined();const geometry=ma.geometry,attribute=geometry.getAttribute('position') as BufferAttribute;
  expect(attribute.getX(0)).toBeCloseTo(.59);expect(attribute.getZ(0)).toBeCloseTo(0);
  a.setWater(state(2.01));expect(ma.geometry).toBe(geometry);expect(attribute.getX(0)).not.toBe(.59);
  a.setWater(state(4,'recovering'));expect(ma.visible).toBe(true);expect(waterRing(state(4,'recovering')).color).toBe(0xffd34e);
  a.update({x:0,y:.5,z:0},{x:2,y:0,z:0},1);expect(ma.rotation.y+a.group.rotation.y).toBeCloseTo(0);
  expect((mb.material as import('three').MeshBasicMaterial).color.getHex()).toBe(0xf04747);
  a.setDead(true);a.setWater(state(8,'failed'));expect(a.group.getObjectByName('death-marker')!.visible).toBe(false);expect(ma.visible).toBe(false);expect(ma.geometry.drawRange.count).toBe(0);
  a.reset();a.setWater(state(0));expect((ma.material as import('three').MeshBasicMaterial).color.getHex()).toBe(0x64d98b);
 }finally{a.dispose();b.dispose();}
});
it('interpolates only within authority brackets; pause/underrun/recovery reset/restart never run a client countdown',async()=>{
 await initializePhysics();const session=new AuthoritativeSession('generated',4,1);
 try{
  session.setPhase('running');const a=session.snapshot(1000),b=structuredClone(a);a.world!.water.players[0]=state(2);b.world!.water.players[0]=state(3);b.tick++;b.serverTimeMs=1100;
  const buffer=new SnapshotBuffer(0);buffer.push(a,1000);buffer.push(b,1100);expect(buffer.sample(1050)!.world!.water.players[0]!.exposureSeconds).toBe(2.5);expect(buffer.sample(5000)!.world!.water.players[0]!.exposureSeconds).toBe(3);
  buffer.clear();b.phase='paused';buffer.push(a,1000);buffer.push(b,1100);expect(buffer.sample(1050)!.world!.water.players[0]!.exposureSeconds).toBe(2);
  buffer.clear();b.phase='running';b.world!.water.players[0]=state(0,'safe');a.world!.water.players[0]=state(4,'recovering');buffer.push(a,1000);buffer.push(b,1100);expect(buffer.sample(1050)!.world!.water.players[0]!.exposureSeconds).toBe(4);expect(buffer.sample(1100)!.world!.water.players[0]!.exposureSeconds).toBe(0);
  session.reset();buffer.push(session.snapshot(1200),1200);expect(buffer.size).toBe(1);expect(buffer.sample(1200)!.world!.water.players.every(p=>p.exposureSeconds===0)).toBe(true);
 }finally{session.dispose();}
});
