import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { isSnapshotMessage, playerSlots, protocolVersion } from '@crossy/protocol';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { InputScheduler } from '../../server/src/input-scheduler';
import { SnapshotBuffer } from './snapshot-buffer';
beforeAll(initializePhysics);
for (const high of [false,true]) {
  it(`four-player ordered ${high ? '250±50 ms' : '100±20 ms + two-second interruption'} transport retains coherent safe physics`, () => {
    const session = new AuthoritativeSession('slack',4), buffers = playerSlots.map(()=>new SnapshotBuffer());
    const seen = playerSlots.map(()=>new Map<number,string>()), sequences=[0,0,0,0], references=[0,0,0,0], intent=[0,0,0,0];
    const queue: { at: number; deliver:()=>void }[] = [], deadlines = Array.from({length:8},()=>0);
    let time=0, seed=9, expiries=0, maxQueue=0, peakExcess=0, movingTicks=0, pausedTicks=0;
    const transmit=(lane:number,deliver:()=>void)=>{
      seed=(seed*1664525+1013904223)>>>0;
      const delay=(high?125:50)+(seed/2**32*2-1)*(high?25:10);
      const at=Math.max(deadlines[lane]!,time+delay, !high && time>=4000 && time<6000 ? 6000 : 0);
      deadlines[lane]=at;queue.push({at,deliver});maxQueue=Math.max(maxQueue,queue.length);
    };
    const scheduler=new InputScheduler((slot,_sequence,_silence,now)=>{
      expiries++; const i=playerSlots.indexOf(slot);scheduler.issueReference(slot,now);
      transmit(i*2+1,()=>{intent[i]=0;references[i]=Math.max(references[i]!,now);});
    },4);
    playerSlots.forEach((slot,i)=>{scheduler.connect(slot,i+1,0);scheduler.issueReference(slot,0);});
    try {
      for(time=0;time<=9000;time++) {
        queue.sort((a,b)=>a.at-b.at);while(queue[0] && queue[0].at<=time) queue.shift()!.deliver();
        if(time===1000 || time===7000) intent[1]=1;
        if(time===3000) intent[1]=-1;
        if(time%33===0) playerSlots.forEach((slot,i)=>{
          const fresh=buffers[i]!.ageMs(time)<250;if(!fresh)intent[i]=0;
          if(!fresh)return;
          const packet={protocolVersion,sequence:++sequences[i]!,connectionGeneration:i+1,runGeneration:0,referenceTimeMs:references[i]!,x:buffers[i]!.latest?.phase==='running'?intent[i]!:0,z:0};
          transmit(i*2,()=>{const rejection=scheduler.accept(slot,packet,0,time);if(rejection==='requires-neutral')intent[i]=0;});
        });
        if(time%17===0){
          scheduler.expire(time);session.setPhase(scheduler.ready?'running':'paused');
          playerSlots.forEach(slot=>{const p=scheduler.latest(slot);session.input(slot,p.x,p.z,p.sequence);});
          session.advance(.017);if(session.phase==='running')movingTicks++;else pausedTicks++;
          peakExcess=Math.max(peakExcess,...session.simulation.chainMetricsAll().map(m=>m.excessRatio));
        }
        if(time%50===0){
          const snapshot=session.snapshot(time);expect(isSnapshotMessage(snapshot)).toBe(true);
          playerSlots.forEach((slot,i)=>{scheduler.issueReference(slot,time);transmit(i*2+1,()=>{
            buffers[i]!.push(snapshot,time);references[i]=Math.max(references[i]!,snapshot.serverTimeMs);seen[i]!.set(snapshot.serverTimeMs,JSON.stringify(snapshot));
          });});
        }
        if(time%16===0)for(const b of buffers){const p=b.sample(time);if(p)expect(p.chain!.segments).toHaveLength(36);expect(b.size).toBeLessThanOrEqual(32);}
      }
      const common=[...seen[0]!].filter(([stamp])=>seen.every(map=>map.has(stamp)));
      for(const [stamp,json]of common) for(const map of seen)expect(map.get(stamp)).toBe(json);
      expect(common.length).toBeGreaterThan(120);expect(session.simulation.fault).toBeUndefined();expect(peakExcess).toBeLessThan(.05);expect(maxQueue).toBeLessThan(400);
      expect(expiries).toBeGreaterThanOrEqual(4);
      if(!high){expect(movingTicks).toBeGreaterThan(200);expect(session.simulation.state('p2').position.x).toBeGreaterThan(3);}
      else expect(pausedTicks).toBeGreaterThan(movingTicks);
      console.info('M8 ordered model',JSON.stringify({high,expiries,common:common.length,peakExcess,maxQueue,movingTicks,pausedTicks}));
    }finally{session.dispose();}
  },15000);
}
