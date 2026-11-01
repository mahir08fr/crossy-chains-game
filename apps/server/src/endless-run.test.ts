import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { isSnapshotMessage, packSnapshot, unpackSnapshot } from '@crossy/protocol';
import { EndlessRunScore } from './endless-run.js';
import { AuthoritativeSession } from './authoritative-session.js';
import { PrivateLobby } from './private-lobby.js';
beforeAll(initializePhysics);
const poses = (...zs: number[]) => zs.map((z,i) => ({ position: { x: i*3, y: .8, z } }));
it('whole-team metres reject leader-only, sideways/backward/replayed progress; final result and completed-run room record freeze', () => {
  const score = new EndlessRunScore();
  score.advance(poses(18,0,0,0),false); expect(score.state().distance).toBe(0);
  score.advance(poses(20,5,3,4),false); expect(score.state().distance).toBe(3);
  score.advance(poses(22,5,-1,6),false); expect(score.state().distance).toBe(3);
  score.advance(poses(22,5,3,6).map(p=>({position:{...p.position,x:100}})),false);
  expect(score.state().distance).toBe(3);
  score.advance(poses(22,5,4,6),true);
  const final=score.state(); expect(final).toMatchObject({distance:4,roomBest:4,previousBest:0,newRecord:true});
  score.advance(poses(999,999),true);expect(score.state()).toEqual(final);
  score.reset();expect(score.state()).toMatchObject({distance:0,roomBest:4,previousBest:4,newRecord:false,difficultyTier:0});
  score.advance(poses(3,3),true);expect(score.state()).toMatchObject({distance:3,roomBest:4,previousBest:4,newRecord:false});
  score.reset();score.advance(poses(8,8),false);score.reset();expect(score.state().roomBest).toBe(4); // abandoned attempt is not a completed record
});
it.each([2,3,4] as const)('%i authoritative seats: waiting, running, retreat, pause/reclaim, shared failure, record and same-seed reset', capacity => {
  const s=new AuthoritativeSession('generated',capacity,42);
  try {
    const initial=s.snapshot(0);s.advance(10);expect(s.snapshot(1).run).toEqual(initial.run);
    s.setPhase('running');
    const drive=(z:number,n:number)=>{for(let i=0;i<n&&s.phase==='running';i++){for(const p of s.simulation.states())s.input(p.id,0,z,i+1);s.advance(1/60);}};
    drive(1,60);const forward=s.snapshot(2);expect(forward.run!.distance).toBeGreaterThan(0);
    expect(forward.run!.distance).toBeGreaterThanOrEqual(forward.world!.highWater);
    drive(-1,60);const retreat=s.snapshot(3);
    // The body first coasts forward while braking; count that real motion. Once
    // all bodies are retreating, further backward travel must earn no distance.
    expect(retreat.players.every(p=>p.velocity.z<0)).toBe(true);
    drive(-1,40);expect(s.snapshot(3.5).run!.distance).toBe(retreat.run!.distance);
    s.setPhase('paused');const paused=s.snapshot(4);s.advance(10);expect(s.snapshot(5).run).toEqual(paused.run);
    expect(unpackSnapshot(packSnapshot(paused))).toEqual(paused);
    s.setPhase('running');drive(1,1800);expect(s.phase).toBe('ended');
    const final=s.snapshot(6);expect(final.run!.roomBest).toBe(final.run!.distance);expect(final.run!.newRecord).toBe(true);
    s.advance(10);expect(s.snapshot(7).run).toEqual(final.run);
    const copy=s.snapshot(8);copy.run!.distance=100000;expect(s.snapshot(9).run).toEqual(final.run);
    for (const edit of [(v:typeof final)=>{v.run!.difficultyVersion=99 as 3;},(v:typeof final)=>{v.run!.distance=-1;},(v:typeof final)=>{v.run!.roomBest=0;},(v:typeof final)=>{v.run!.newRecord=false;},(v:typeof final)=>{delete v.run;}]){
      const bad=structuredClone(final);edit(bad);expect(isSnapshotMessage(bad)).toBe(false);
    }
    s.reset();const reset=s.snapshot(10);expect(reset.world).toEqual(initial.world);expect(reset.run).toMatchObject({distance:0,difficultyTier:0,newRecord:false,roomBest:final.run!.distance,previousBest:final.run!.distance});
    expect(isSnapshotMessage(reset)).toBe(true);
  } finally {s.dispose();}
},30000);
it.each([2,3,4] as const)('%i endless seats: terminal unanimity, cancellation, duplicate/stale votes and reconnect epoch reset',capacity=>{
  const lobby=new PrivateLobby('ABCDEFGH',0,capacity,true),slots=(['p1','p2','p3','p4'] as const).slice(0,capacity);
  const act=(slot:typeof slots[number],action:Parameters<PrivateLobby['command']>[2])=>lobby.command(slot,lobby.state(0).epoch,action,true,1000);
  slots.forEach((slot,i)=>lobby.join(slot,i));slots.forEach(slot=>act(slot,'ready'));expect(act('p1','start').effect).toBe('start');
  expect(act('p1','restart')).toEqual({});expect(act('p1','restart')).toEqual({});act('p1','cancel-restart');
  expect(lobby.state(0).players[0]!.restartRequested).toBe(false);act('p1','restart');
  const stale=lobby.state(0).epoch;lobby.connection('p1',false,20);lobby.connection('p1',true,30);
  expect(lobby.command('p1',stale,'restart',true,40).error).toBe('stale-command');
  for(const slot of slots.slice(0,-1))expect(act(slot,'restart')).toEqual({});
  expect(act(slots.at(-1)!,'restart').effect).toBe('restart');
  expect(lobby.command(slots.at(-1)!,lobby.state(0).epoch-1,'restart',true,50).error).toBe('stale-command');
});
