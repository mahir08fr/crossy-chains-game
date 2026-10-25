import { beforeAll, expect, it } from 'vitest';
import { Mesh } from 'three';
import { riverScenario, riverSettings } from '@crossy/config';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { createWorldView } from './world-view';
import { SnapshotBuffer } from './snapshot-buffer';
import { waterFeedback } from './water-feedback';
beforeAll(initializePhysics);
it('presents water timers on the player/chain bracket, freezes underruns and snaps whole terminal assembly',()=>{
 const s=new AuthoritativeSession('river');
 try {
  s.setPhase('running');s.input('p1',0,1,1);s.input('p2',0,1,1);for(let i=0;i<100;i++)s.advance(1/60);
  const a=s.snapshot(1000);for(let i=0;i<6;i++)s.advance(1/60);const b=s.snapshot(1100);
  const buffer=new SnapshotBuffer(0);buffer.push(a,1000);buffer.push(b,1100);
  const mid=buffer.sample(1050)!.river!;
  for(const [i,p] of mid.players.entries())expect(p.exposureSeconds).toBeCloseTo((a.river!.players[i]!.exposureSeconds+b.river!.players[i]!.exposureSeconds)/2,8);
  expect(buffer.sample(9999)!.river).toEqual(b.river); // no client countdown extrapolation
  expect(buffer.push(a,10000)).toBe(false);
  expect(waterFeedback(a.river!)).toContain('endangered');
  s.clearInputs();for(let i=0;i<600;i++)s.advance(1/60);const end=s.snapshot(1200);
  expect(end.phase).toBe('ended');buffer.push(end,1200);const presented=buffer.sample(1200)!;
  expect(presented.players).toEqual(end.players);expect(presented.chain).toEqual(end.chain);expect(presented.river).toEqual(end.river);expect(waterFeedback(end.river!)).toContain('Team failed');
  s.reset();buffer.push(s.snapshot(1300),1300);expect(buffer.latest!.river!.players.every(p=>p.phase==='safe')).toBe(true);
 }finally{s.dispose();}
});
it('uses lightweight matching terrain/bank transforms plus a simple blue surface',()=>{
 const view=createWorldView(riverScenario);
 try{
  riverScenario.boxes.forEach((box,i)=>{const mesh=view.children[i] as Mesh;expect(mesh.position.toArray()).toEqual([box.center.x,box.center.y,box.center.z]);expect(mesh.rotation.x).toBe(box.rotationX??0);});
  const surface=view.children[riverScenario.boxes.length] as Mesh;
  expect(surface.position.y).toBe(riverSettings.surfaceY);expect(surface.geometry.type).toBe('PlaneGeometry');
 }finally{view.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
});
