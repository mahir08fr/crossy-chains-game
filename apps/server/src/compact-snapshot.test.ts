import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import { unpackSnapshot, isSnapshotMessage } from '@crossy/protocol';
import type { SnapshotMessage } from '@crossy/protocol';
import { createServerRuntime } from './runtime.js';
import { readServerConfig } from './config.js';
const runtime=createServerRuntime(readServerConfig({}));let endpoint:string;
beforeAll(async()=>{endpoint=`http://127.0.0.1:${await runtime.start(0)}`;});afterAll(()=>runtime.stop());
it('negotiates lossless compact snapshots per client and preserves the legacy cohort in the same room',async()=>{
 const sdk=new Client(endpoint,{headers:{Origin:'http://127.0.0.1:5173'}});
 const first=await sdk.create('private-game',{protocolVersion:1,capacity:4});
 const second=await sdk.joinById(first.roomId,{protocolVersion:1});
 const compact:SnapshotMessage[]=[],legacy:SnapshotMessage[]=[];
 let otherLeft=false;
 const other=await sdk.create('private-game',{protocolVersion:1,capacity:2});
 for(const type of ['snapshot','lobby','welcome'])other.onMessage(type,()=>{});
 try {
  first.onMessage('snapshot-compact',(m:unknown)=>{const s=unpackSnapshot(m);expect(s).toBeDefined();compact.push(s!);});
  first.onMessage('snapshot',()=>{});second.onMessage('snapshot',(m:unknown)=>{expect(isSnapshotMessage(m)).toBe(true);legacy.push(m as SnapshotMessage);});
  for(const r of [first,second]){r.onMessage('welcome',()=>{});r.onMessage('lobby',()=>{});r.onMessage('input-expired',()=>{});}
  first.send('hello',{protocolVersion:1,snapshotFormat:'flat-chain-v1'});second.send('hello',{protocolVersion:1});
  await vi.waitFor(()=>expect(compact.length).toBeGreaterThan(2));
  const common=compact.find(s=>legacy.some(t=>t.serverTimeMs===s.serverTimeMs));expect(common).toBeDefined();
  expect(legacy.find(s=>s.serverTimeMs===common!.serverTimeMs)).toEqual(common);
  let diagnostics: Record<string, unknown> | undefined;
  first.onMessage('performance', (message: Record<string, unknown>) => { diagnostics=message; });
  first.send('performance',{protocolVersion:1});
  await vi.waitFor(()=>expect(diagnostics).toBeDefined(),{timeout:6500});
  expect(diagnostics!.activeRooms).toBe(2);expect(diagnostics!.runningRooms).toBe(0);expect(diagnostics!.roomPhases).toEqual([{capacity:4,phase:'waiting'},{capacity:2,phase:'waiting'}]);
  expect(diagnostics!.capacity).toBe(4);expect(diagnostics!.processRssMiB).toBeGreaterThan(0);
  expect(diagnostics!.eventLoopP95Ms).toBeGreaterThanOrEqual(0);expect(JSON.stringify(diagnostics)).not.toContain(first.reconnectionToken);
  await other.leave();otherLeft=true;diagnostics=undefined;
  await vi.waitFor(()=>expect(diagnostics?.activeRooms).toBe(1),{timeout:6500});
  expect(diagnostics!.roomPhases).toEqual([{capacity:4,phase:'waiting'}]);
  first.send('hello',{protocolVersion:1});const before=compact.length;
  await new Promise(r=>setTimeout(r,200));expect(compact.length).toBe(before);
 } finally {await Promise.all([first.leave(),second.leave(),...(otherLeft?[]:[other.leave().catch(()=>{})])]);}
},15000);
