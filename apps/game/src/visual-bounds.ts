import { Camera, Vector3 } from 'three';
import { railwaySettings as rail } from '@crossy/config';
import type { MotionRailway } from '@crossy/protocol';

/** Render-only bounds. Physics continues to use the original course descriptors.
 * Unproject both ends of the four corner rays onto the ground plane. This also
 * handles orthographic tilt/zoom/view offsets and downward perspective cameras. */
export class VisualBounds {
  halfWidth = 24;
  private readonly near = new Vector3();
  private readonly far = new Vector3();
  update(camera: Camera): boolean {
    let extent = 10;
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      this.near.set(x,y,-1).unproject(camera);
      this.far.set(x,y,1).unproject(camera);
      const dy=this.far.y-this.near.y;
      // Display can draw its waiting room before the first camera update.
      if(Math.abs(dy)<1e-8)return false;
      const t=-this.near.y/dy;
      extent=Math.max(extent,Math.abs(this.near.x+(this.far.x-this.near.x)*t));
    }
    // Six metres covers the 3.18m train nose, model height parallax and shadows
    // for the retained light/camera orientation. Round up; never churn on shrink.
    const next=Math.ceil((extent+6)/8)*8;
    if(next<=this.halfWidth)return false;
    this.halfWidth=next;return true;
  }
}

/** Enumerate every periodic image whose whole-model/shadow envelope intersects
 * the render corridor. Modulo recycle changes image identity, never position.
 * The image inside playable bounds is exactly the authoritative collision image. */
export function imageRange(x:number,period:number,halfWidth:number,margin:number): [number,number] {
  return [Math.ceil((-halfWidth-margin-x)/period),Math.floor((halfWidth+margin-x)/period)];
}

/** Continuous visual transit during the authoritative off-corridor dwell.
 * Period/speed/arrival/clear/warning and collision positions remain unchanged. */
export function visualTrainX(state: MotionRailway, direction:number): number {
  const local=state.elapsedSeconds-state.pass*rail.cycleSeconds;
  // SnapshotBuffer intentionally holds X across pass IDs. Continue the outgoing
  // off-corridor image on its interpolated clock until the next bracket arrives.
  if(local>=rail.cycleSeconds)return (rail.exitX+(local-rail.cycleSeconds)*rail.speed)*direction;
  return local<rail.safeSeconds ? (rail.entryX+(local-rail.safeSeconds)*rail.speed)*direction : state.x;
}
