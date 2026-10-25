import { expect, it } from 'vitest';
import { formatServerPerformance, PerformanceMetrics } from './performance-metrics';
it('keeps frame diagnostics bounded, ignores invalid timings and reports frame rate from elapsed intervals',()=>{
 const metrics=new PerformanceMetrics();metrics.record('frame interval ms',Infinity);metrics.record('frame interval ms',-1);
 for(let i=0;i<700;i++)metrics.record('frame interval ms',20);
 expect(metrics.summary()).toContain('(600 samples) · rolling FPS 50.0');
 expect(metrics.summary()).toContain('p95 20.00');
 expect(metrics.summary()).toContain('p99 20.00');
});
it('formats bounded readable server timing windows and tolerates missing or malformed diagnostics',()=>{
 const text=formatServerPerformance({at:'2026-10-15T06:50:17Z',durationMs:5000,activeRooms:2,runningRooms:1,processCpuPercent:10,eventLoopP95Ms:12,timings:{simulationTickMs:{p95:2,max:5},simulationTickCpuMs:{p95:1,max:2},simulationTickWallCpuGapMs:{p95:1,max:3},wsBufferedBytes:{max:0}},counts:{inputExpiries:3,simulationTicks:300}});
 expect(text).toContain('CPU 10.00% of core');expect(text).toContain('tick p95/max 2.00/5.00');expect(text).toContain('expiries 3.00');expect(text).toContain('2.00 (1.00 running)');expect(text).toContain('completed 60.00 ticks/s');expect(text).toContain('thread CPU p95/max 1.00/2.00');expect(text).toContain('wall−CPU gap p95/max 1.00/3.00');
 expect(formatServerPerformance({timings:null,counts:'invalid',processCpuPercent:Infinity})).toContain('CPU —%');
});
it('exposes optional endless resource and run counters for human endurance monitoring',()=>{
 const text=formatServerPerformance({resources:{activeSections:13,createdSections:19,removedSections:6,bodies:40,colliders:80,joints:39,removedTerrainColliders:20,distance:120,runSeconds:140,runGeneration:2},processHeapMiB:18,counts:{safetyPauses:3},timings:{fullSnapshotBytes:{max:10000}}});
 for(const value of ['Sections 13.00','created/removed 19.00/6.00','40.00/80.00/39.00','120.00 m / 140.00 s','safety pauses 3.00','10000.00 bytes'])expect(text).toContain(value);
});
