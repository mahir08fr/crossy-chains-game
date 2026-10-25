import { describe, expect, it } from 'vitest';
import { protocolVersion } from '@crossy/protocol';
import type { InputMessage } from '@crossy/protocol';
import { InputScheduler } from './input-scheduler.js';
const input = (sequence: number, referenceTimeMs = 100, x = 0): InputMessage => ({
  protocolVersion, sequence, connectionGeneration: 1, runGeneration: 0, referenceTimeMs, x, z: 0,
});
function setup() {
  const scheduler = new InputScheduler();
  scheduler.connect('p1', 1, 100); scheduler.connect('p2', 2, 100);
  scheduler.issueReference('p1', 100); scheduler.issueReference('p2', 100);
  return scheduler;
}
describe('bounded latest input scheduler', () => {
  it('keeps a continuous stream with valid delayed references alive while receipt gaps stay below 250 ms', () => {
    const scheduler = setup();
    const arrivals = [[100, 170], [150, 240], [200, 300], [250, 430], [300, 520]];
    const events = arrivals.flatMap(([reference, received], index) => [
      { time: reference!, issue: true, index }, { time: received!, issue: false, index },
    ]).sort((a, b) => a.time - b.time || Number(b.issue) - Number(a.issue));
    for (const event of events) {
      if (event.issue) scheduler.issueReference('p1', event.time);
      else expect(scheduler.accept('p1', input(event.index + 1, arrivals[event.index]![0]!, event.index ? 1 : 0), 0, event.time)).toBeUndefined();
    }
    expect(scheduler.latest('p1').x).toBe(1);
  });
  it('pauses for a stale peer without expiring the other healthy input stream', () => {
    const scheduler = setup();
    scheduler.accept('p1', input(1), 0, 100);
    scheduler.accept('p2', { ...input(1), connectionGeneration: 2 }, 0, 100);
    scheduler.issueReference('p1', 300);
    scheduler.accept('p1', input(2, 300, 1), 0, 300);
    expect(scheduler.expire(350)).toBe(true);
    expect(scheduler.ready).toBe(false);
    expect(scheduler.latest('p1')).toEqual({ sequence: 2, x: 1, z: 0 });
    scheduler.issueReference('p1', 351);
    expect(scheduler.accept('p1', input(3, 351, 1), 0, 351)).toBeUndefined();
  });
  it('requires neutral, maps generations and retains only the newest accepted axes', () => {
    const scheduler = setup();
    expect(scheduler.accept('p1', input(1, 100, 1), 0, 101)).toBe('requires-neutral');
    expect(scheduler.accept('p1', input(1), 0, 101)).toBeUndefined();
    expect(scheduler.accept('p2', { ...input(1), connectionGeneration: 2 }, 0, 101)).toBeUndefined();
    expect(scheduler.ready).toBe(true);
    expect(scheduler.accept('p1', input(2, 100, 1), 0, 102)).toBeUndefined();
    expect(scheduler.accept('p1', input(3, 100, -1), 0, 103)).toBeUndefined();
    expect(scheduler.latest('p1')).toEqual({ sequence: 3, x: -1, z: 0 });
    expect(scheduler.accept('p1', input(2), 0, 104)).toBe('old-sequence');
    expect(scheduler.accept('p2', input(4), 0, 104)).toBe('invalid-generation');
    expect(scheduler.accept('p1', input(4), 1, 104)).toBe('invalid-generation');
  });
  it('separates receipt silence from packet freshness and never refreshes from rejected references', () => {
    const scheduler = setup();
    scheduler.accept('p1', input(1), 0, 100);
    scheduler.issueReference('p2', 200);
    scheduler.accept('p2', { ...input(1, 200), connectionGeneration: 2 }, 0, 200);
    scheduler.accept('p1', input(2, 100, 1), 0, 340); // valid delayed packet
    expect(scheduler.expire(350)).toBe(false); // only 10 ms of stream silence
    expect(scheduler.latest('p1').x).toBe(1);
    expect(scheduler.accept('p1', input(3), 0, 350)).toBe('stale-input');
    expect(scheduler.accept('p1', input(3, 351), 0, 350)).toBe('stale-input');
    expect(scheduler.accept('p2', { ...input(2, 200, 1), connectionGeneration: 2 }, 0, 350)).toBeUndefined();
    expect(scheduler.expire(589)).toBe(false);
    expect(scheduler.expire(590)).toBe(true); // exactly 250 ms since last valid receipt
    expect(scheduler.latest('p1').x).toBe(0);
    expect(scheduler.latest('p2').x).toBe(1);
    expect(scheduler.ready).toBe(false);
    scheduler.issueReference('p1', 600);
    expect(scheduler.accept('p1', input(3, 600, 1), 0, 600)).toBe('requires-neutral');
    expect(scheduler.accept('p1', input(3, 600), 0, 600)).toBeUndefined();
    expect(scheduler.accept('p1', input(4, 600, 1), 0, 601)).toBeUndefined();
  });
  it('notifies only the expired owner once and invalidates all its pre-expiry references', () => {
    const expired: unknown[] = [];
    const scheduler = new InputScheduler((...args) => expired.push(args));
    scheduler.connect('p1', 1, 100); scheduler.issueReference('p1', 100);
    scheduler.accept('p1', input(1), 0, 100);
    scheduler.issueReference('p1', 349);
    scheduler.expire(350); scheduler.expire(351);
    expect(expired).toEqual([['p1', 1, 250, 350]]);
    expect(scheduler.accept('p1', input(2, 349), 0, 351)).toBe('stale-input');
    scheduler.issueReference('p1', 351);
    expect(scheduler.accept('p1', input(2, 351, 1), 0, 351)).toBe('requires-neutral');
  });
  it('bounds bursts and clears reset/disconnect inputs without reopening old sequences', () => {
    const scheduler = setup();
    for (let sequence = 1; sequence <= 10; sequence++) expect(scheduler.accept('p1', input(sequence), 0, 100)).toBeUndefined();
    expect(scheduler.accept('p1', input(11), 0, 100)).toBe('rate-limit');
    expect(scheduler.accept('p1', input(11), 0, 125)).toBeUndefined();
    scheduler.clear();
    expect(scheduler.ready).toBe(false);
    expect(scheduler.accept('p1', input(12), 0, 126)).toBe('stale-input');
    scheduler.issueReference('p1', 200);
    expect(scheduler.accept('p1', input(11, 200), 0, 200)).toBe('old-sequence');
    scheduler.disconnect('p1'); scheduler.connect('p1', 3, 200);
    expect(scheduler.accept('p1', input(12, 200), 0, 200)).toBe('invalid-generation');
  });
});
it('four-player scheduler binds each stream, rejects duplicate/out-of-order input and expires only stale owners', () => {
  const events: string[] = [], scheduler = new InputScheduler(slot => events.push(slot), 4);
  const slots = ['p1','p2','p3','p4'] as const;
  slots.forEach((slot,index) => {
    scheduler.connect(slot,index+1,0); scheduler.issueReference(slot,0);
    expect(scheduler.accept(slot,{protocolVersion:1,sequence:1,connectionGeneration:index+1,runGeneration:0,referenceTimeMs:0,x:0,z:0},0,1)).toBeUndefined();
  });
  expect(scheduler.ready).toBe(true);
  for(const [index,slot] of slots.entries()) {
    const packet={protocolVersion:1 as const,sequence:2,connectionGeneration:index+1,runGeneration:0,referenceTimeMs:0,x:.5,z:0};
    expect(scheduler.accept(slot,packet,0,10)).toBeUndefined();
    expect(scheduler.accept(slot,packet,0,11)).toBe('old-sequence');
    expect(scheduler.accept(slot,{...packet,sequence:1},0,12)).toBe('old-sequence');
    expect(scheduler.accept(slot,{...packet,sequence:3,connectionGeneration:99},0,13)).toBe('invalid-generation');
    expect(scheduler.accept(slot,{...packet,sequence:3,runGeneration:99},0,14)).toBe('invalid-generation');
    if(slot!=='p3') {scheduler.issueReference(slot,200);expect(scheduler.accept(slot,{...packet,sequence:4,referenceTimeMs:200},0,200)).toBeUndefined();}
  }
  scheduler.expire(261); expect(events).toEqual(['p3']);expect(scheduler.ready).toBe(false);
  expect(scheduler.latest('p2').x).toBe(.5);expect(scheduler.latest('p3').x).toBe(0);
  scheduler.issueReference('p3',261);
  expect(scheduler.accept('p3',{protocolVersion:1,sequence:5,connectionGeneration:3,runGeneration:0,referenceTimeMs:261,x:1,z:0},0,262)).toBe('requires-neutral');
});

it('exposes owning slot, generation, exact silence and neutral cause without mutating safety', () => {
  const scheduler = setup();
  expect(scheduler.diagnostics(100)[0]).toMatchObject({ slot: 'p1', generation: 1, requiresNeutral: true, neutralReason: 'connected', silenceMs: null });
  scheduler.accept('p1', input(1), 0, 100);
  scheduler.expire(350);
  expect(scheduler.diagnostics(350)[0]).toMatchObject({ slot: 'p1', sequence: 1, requiresNeutral: true, neutralReason: 'expired', silenceMs: 250 });
  expect(scheduler.latest('p1')).toEqual({ x: 0, z: 0, sequence: 1 });
  scheduler.clear(); expect(scheduler.diagnostics(350)[0]?.neutralReason).toBe('cleared');
});
