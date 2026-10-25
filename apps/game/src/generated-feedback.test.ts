import { beforeAll, expect, it } from 'vitest';
import { initializePhysics } from '@crossy/simulation';
import { AuthoritativeSession } from '../../server/src/authoritative-session';
import { generatedFeedback } from './generated-feedback';
beforeAll(initializePhysics);
it('labels authority, room-only records, status and unanimous replay without browser personal claims',()=>{
 const session=new AuthoritativeSession('generated',4,42);
 try{
  const snapshot=session.snapshot(0),world=snapshot.world!,run=snapshot.run!;
  expect(generatedFeedback(world,'waiting',run)).toContain('Choose Ready');
  expect(generatedFeedback(world,'paused',run)).toContain('paused safely');
  const text=generatedFeedback({...world,outcome:'failed',dead:['p1'],elapsedSeconds:12},'ended',{...run,distance:8,roomBest:8,newRecord:true});
  for(const part of ['Final 8.0 m','Room best 8.0 m','Previous best 0.0 m','New room record','Survived 12.0 s','Every player votes','Seed 42'])expect(text).toContain(part);
  expect(text).not.toContain('personal');
 }finally{session.dispose();}
});
