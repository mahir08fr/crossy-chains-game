import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { isSnapshotMessage } from '@crossy/protocol';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { SnapshotBuffer } from './snapshot-buffer';
beforeAll(initializePhysics);
it('interpolates all four players and all 36 spans on one timeline and rejects changed topology/stale state', () => {
  const session = new AuthoritativeSession('road',4), buffer = new SnapshotBuffer(50);
  try {
    const a=session.snapshot(100), b=structuredClone(a); b.serverTimeMs=200; b.tick=1;
    for(const p of b.players) p.position.z+=2;
    for(const p of b.chain!.segments) p.position.z+=2;
    expect(isSnapshotMessage(b)).toBe(true);
    buffer.push(a,100);buffer.push(b,200);
    const presented=buffer.sample(200)!;
    for(let i=0;i<4;i++) expect(presented.players[i]!.position.z).toBe(a.players[i]!.position.z+1);
    for(let i=0;i<36;i++) expect(presented.chain!.segments[i]!.position.z).toBe(a.chain!.segments[i]!.position.z+1);
    expect(buffer.push(a,201)).toBe(false);
    const changed=structuredClone(b);changed.serverTimeMs=201;changed.chain!.endpoints.reverse();expect(buffer.push(changed,201)).toBe(false);
    for(const mutate of [
      (s: typeof b)=>{s.chain!.segments[35]!.position.x=NaN;},
      (s: typeof b)=>{s.chain!.segments[24]!.rotation.w=4;},
      (s: typeof b)=>{s.players[3]!.id='p1';},
      (s: typeof b)=>{s.chain!.segments.push(s.chain!.segments[0]!);},
      (s: typeof b)=>{s.road!.dead=['p4'];},
    ]) {const bad=structuredClone(b);mutate(bad);expect(isSnapshotMessage(bad)).toBe(false);}
    const terminal=structuredClone(b);terminal.tick=2;terminal.serverTimeMs=250;terminal.phase='ended';terminal.road!.dead=['p4'];terminal.road!.outcome='failed';
    expect(isSnapshotMessage(terminal)).toBe(true);buffer.push(terminal,250);expect(buffer.sample(251)!.players).toEqual(terminal.players);
    session.reset(); const reset=session.snapshot(300);buffer.push(reset,300);expect(buffer.size).toBe(1);
  } finally {session.dispose();}
});
