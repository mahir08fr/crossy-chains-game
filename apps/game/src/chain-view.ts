import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, Quaternion } from 'three';
import { settings } from '@crossy/config';
import type { SegmentPose } from '@crossy/protocol';

export class ChainView {
  readonly group = new Group();
  private readonly geometry = new CapsuleGeometry(settings.chain.radius, settings.chain.length / settings.chain.segments - 2 * settings.chain.radius, 4, 8);
  private readonly material = new MeshStandardMaterial({ color: 0xe4ddd0, roughness: 0.7 });
  private readonly targetRotation = new Quaternion();

  setCount(count: number): void {
    this.group.clear();
    for (let i = 0; i < count; i++) {
      const segment = new Mesh(this.geometry, this.material);
      segment.castShadow = true;
      this.group.add(segment);
    }
  }

  update(previous: readonly SegmentPose[], current: readonly SegmentPose[], alpha: number): void {
    for (let i = 0; i < current.length; i++) {
      const before = previous[i]!, after = current[i]!;
      const mesh = this.group.children[i]!;
      mesh.position.set(
        before.position.x + (after.position.x - before.position.x) * alpha,
        before.position.y + (after.position.y - before.position.y) * alpha,
        before.position.z + (after.position.z - before.position.z) * alpha,
      );
      mesh.quaternion.set(before.rotation.x, before.rotation.y, before.rotation.z, before.rotation.w);
      this.targetRotation.set(after.rotation.x, after.rotation.y, after.rotation.z, after.rotation.w);
      mesh.quaternion.slerp(this.targetRotation, alpha);
    }
  }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); }
}
