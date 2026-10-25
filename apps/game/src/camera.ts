import { OrthographicCamera, Vector3 } from 'three';
import { settings } from '@crossy/config';
import type { Point3 } from '@crossy/config';

export class FollowCamera {
  readonly camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  private readonly target = new Vector3();
  private aspect = 1;
  private viewHeight: number = settings.camera.viewHeight;

  resize(width: number, height: number): void {
    this.aspect = Math.max(1, width) / Math.max(1, height);
    this.project();
  }

  private project(): void {
    const halfHeight = this.viewHeight / 2;
    const halfWidth = halfHeight * this.aspect;
    Object.assign(this.camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
    this.camera.updateProjectionMatrix();
  }

  update(positions: readonly Point3[], elapsed: number, snap = false, progression?: {highWater:number;rearLimit:number}): void {
    if (positions.length === 0) return;
    const xs = positions.map((p) => p.x);
    const zs = positions.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const desired = new Vector3(progression ? 0 : (minX + maxX) / 2, 0, progression ? progression.highWater+3 : (minZ + maxZ) / 2 + 3);
    if(progression && !snap)desired.z=Math.max(this.target.z,desired.z);
    this.target.lerp(desired, snap ? 1 : 1 - Math.exp(-settings.camera.smoothing * elapsed));
    // Include camera lag in the fit. Keep the angled orientation and world input axes fixed.
    const horizontal = Math.max(...positions.map((p) => Math.abs(p.x - this.target.x))) * 2;
    const vertical = Math.max(...positions.map((p) => Math.abs(p.z - this.target.z))) * 2;
    const required = Math.min(settings.camera.maxViewHeight, Math.max(
      settings.camera.viewHeight,
      (horizontal + settings.camera.padding) / this.aspect,
      vertical + settings.camera.padding,
    ));
    // Expand immediately to avoid clipping a moving player; shrink smoothly.
    this.viewHeight = snap || required > this.viewHeight ? required : this.viewHeight + (required - this.viewHeight) * (1 - Math.exp(-settings.camera.smoothing * elapsed));
    this.project();
    this.camera.position.set(this.target.x, settings.camera.height, this.target.z - settings.camera.behind);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
