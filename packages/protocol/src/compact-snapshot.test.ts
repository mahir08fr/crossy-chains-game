import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../../apps/server/src/authoritative-session';
import { isSnapshotHello, packSnapshot, unpackSnapshot } from './index';
beforeAll(initializePhysics);
it('round-trips every exact pose, terminal state and generation without float quantization for 2/3/4 players', () => {
  for(const capacity of [2,3,4] as const) {
    const s=new AuthoritativeSession('road',capacity);
    try {
      s.setPhase('running');for(let i=0;i<30;i++)s.advance(1/60);
      for(const message of [s.snapshot(123.456),{...s.snapshot(124),phase:'ended' as const,road:{...s.snapshot(124).road!,outcome:'failed' as const,dead:['p4' as const].slice(0,capacity===4?1:0)}}]) {
        if(message.phase==='ended'&&capacity!==4)continue;
        const packed=packSnapshot(message);expect(packed.chain.segments).toHaveLength(84*(capacity-1));
        expect(unpackSnapshot(packed)).toEqual(message);
      }
      s.reset();expect(unpackSnapshot(packSnapshot(s.snapshot(200)))).toEqual(s.snapshot(200));
    } finally{s.dispose();}
  }
});
it('rejects malformed, oversized, nonfinite, misordered and unsafe compact poses with existing validators',()=>{
 const s=new AuthoritativeSession('road',4);
 try {
  const good=packSnapshot(s.snapshot(0));
  for(const mutate of [
   (v:typeof good)=>{v.chain.segments.pop();},
   (v:typeof good)=>{v.chain.segments.push(...Array(10000).fill(0));},
   (v:typeof good)=>{v.chain.segments[0]=NaN;},
   (v:typeof good)=>{v.chain.segments[6]=5;},
   (v:typeof good)=>{v.chain.endpoints.reverse();},
   (v:typeof good)=>{v.players[3]!.id='p1';},
   (v:typeof good)=>{v.road!.outcome='failed';},
   (v:typeof good)=>{Object.assign(v,{unexpected:'x'});},
  ]){const bad=structuredClone(good);mutate(bad);expect(unpackSnapshot(bad)).toBeUndefined();}
  expect(unpackSnapshot({})).toBeUndefined();
  expect(isSnapshotHello({protocolVersion:1})).toBe(true);
  expect(isSnapshotHello({protocolVersion:1,snapshotFormat:'flat-chain-v1'})).toBe(true);
  expect(isSnapshotHello({protocolVersion:1,snapshotFormat:'anything'})).toBe(false);
  expect(isSnapshotHello({protocolVersion:1,snapshotFormat:'flat-chain-v1',slot:'p4'})).toBe(false);
 }finally{s.dispose();}
});
