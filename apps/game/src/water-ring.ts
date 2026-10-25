import type { MotionRiver } from '@crossy/protocol';
export function waterRing(state: MotionRiver['players'][number] | undefined,limit=8): {remaining:number;color:number;visible:boolean} {
  const remaining=state?Math.max(0,Math.min(1,1-state.exposureSeconds/limit)):1;
  return {remaining,color:remaining<=.25?0xf04747:remaining<=.5?0xffd34e:0x64d98b,visible:!!state&&state.phase!=='safe'&&remaining>0};
}
