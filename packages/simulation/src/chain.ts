import RAPIER from '@dimforge/rapier3d-compat';
import { settings } from '@crossy/config';
import type { Point3 } from '@crossy/config';

export type Rotation4 = { x: number; y: number; z: number; w: number };
export type BodyPose = { position: Point3; rotation: Rotation4 };
export type SegmentState = { position: Point3; rotation: Rotation4; velocity: Point3 };
export type ChainMetrics = {
  restLength: number;
  endpointDistance: number;
  effectivePathLength: number;
  maxAnchorError: number;
  totalAnchorError: number;
  excessRatio: number;
};

export function worldPoint(body: RAPIER.RigidBody, point: Point3): Point3 {
  return pointFromPose(body.translation(), body.rotation(), point);
}

function pointFromPose(p: Point3, q: Rotation4, point: Point3): Point3 {
  const tx = 2 * (q.y * point.z - q.z * point.y);
  const ty = 2 * (q.z * point.x - q.x * point.z);
  const tz = 2 * (q.x * point.y - q.y * point.x);
  return {
    x: p.x + point.x + q.w * tx + q.y * tz - q.z * ty,
    y: p.y + point.y + q.w * ty + q.z * tx - q.x * tz,
    z: p.z + point.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

export class ChainAssembly {
  private readonly segments: RAPIER.RigidBody[] = [];
  // Topology is fixed for this assembly; anchors are still read live for diagnostics.
  private readonly bindings: { joint: RAPIER.ImpulseJoint; first: RAPIER.RigidBody; last: RAPIER.RigidBody }[] = [];

  constructor(world: RAPIER.World, first: RAPIER.RigidBody, last: RAPIER.RigidBody) {
    const { length, segments: count, radius, segmentMass, linearDamping, angularDamping } = settings.chain;
    const a = first.translation(), b = last.translation();
    const separation = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (count % 2 !== 0 || separation > length + 1e-5 || separation < 1e-5 || Math.abs(a.y - b.y) > 1e-5) {
      throw new Error('Chain fixture requires an even segment count and distinct level endpoints within rest length');
    }
    // Two equal straight arms form known slack without stretching any segment.
    // Fixtures are on flat ground with equal attachment heights.
    const bend = Math.sqrt(Math.max(0, (length / 2) ** 2 - (separation / 2) ** 2));
    const middle = { x: (a.x + b.x) / 2 + bend * (b.z - a.z) / separation, y: a.y, z: (a.z + b.z) / 2 - bend * (b.x - a.x) / separation };
    const points: Point3[] = [];
    for (let i = 0; i <= count; i++) {
      const start = i <= count / 2 ? a : middle;
      const end = i <= count / 2 ? middle : b;
      const fraction = i <= count / 2 ? i / (count / 2) : (i - count / 2) / (count / 2);
      points.push({ x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction, z: start.z + (end.z - start.z) * fraction });
    }
    const halfLength = length / count / 2;
    for (let i = 0; i < count; i++) {
      const start = points[i]!, end = points[i + 1]!;
      const dx = (end.x - start.x) / (2 * halfLength);
      const dy = (end.y - start.y) / (2 * halfLength);
      const dz = (end.z - start.z) / (2 * halfLength);
      // Quaternion rotates Rapier/Three capsule local +Y onto the segment direction.
      const norm = Math.hypot(dz, -dx, 1 + dy);
      const rotation = { x: dz / norm, y: 0, z: -dx / norm, w: (1 + dy) / norm };
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2)
        .setRotation(rotation).setLinearDamping(linearDamping).setAngularDamping(angularDamping).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.capsule(halfLength - radius, radius)
        .setMass(segmentMass).setFriction(settings.chain.friction).setRestitution(0)
        // Membership cable (4), filter terrain (1); no player or cable contacts.
        .setCollisionGroups(0x00040001), body);
      this.segments.push(body);
    }
    const connect = (body1: RAPIER.RigidBody, body2: RAPIER.RigidBody, anchor1: Point3, anchor2: Point3) => {
      const joint = world.createImpulseJoint(RAPIER.JointData.spherical(anchor1, anchor2), body1, body2, true);
      joint.setContactsEnabled(false);
      this.bindings.push({ joint, first: body1, last: body2 });
    };
    const origin = { x: 0, y: 0, z: 0 };
    const startAnchor = { x: 0, y: -halfLength, z: 0 };
    const endAnchor = { x: 0, y: halfLength, z: 0 };
    connect(first, this.segments[0]!, origin, startAnchor);
    for (let i = 1; i < count; i++) connect(this.segments[i - 1]!, this.segments[i]!, endAnchor, startAnchor);
    connect(this.segments[count - 1]!, last, endAnchor, origin);
  }

  /** Extent queries need centres only, never velocity or rotation. */
  positions(): Point3[] { return this.segments.map(body => body.translation()); }

  states(): SegmentState[] {
    return this.segments.map((body) => ({ position: { ...body.translation() }, rotation: { ...body.rotation() }, velocity: { ...body.linvel() } }));
  }

  metrics(poses = new Map<number, BodyPose>()): ChainMetrics {
    // A complete fault check already reads every body pose. Reuse only that
    // call's samples; standalone metrics still read live poses and anchors.
    const point = (body: RAPIER.RigidBody, anchor: Point3) => {
      let pose = poses.get(body.handle);
      if (!pose) { pose = { position: body.translation(), rotation: body.rotation() }; poses.set(body.handle, pose); }
      return pointFromPose(pose.position, pose.rotation, anchor);
    };
    const gaps = this.bindings.map(({ joint, first, last }) => {
      const a = point(first, joint.anchor1()), b = point(last, joint.anchor2());
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    });
    const first = this.bindings[0]!, last = this.bindings[this.bindings.length - 1]!;
    const a = point(first.first, first.joint.anchor1());
    const b = point(last.last, last.joint.anchor2());
    const totalAnchorError = gaps.reduce((sum, gap) => sum + gap, 0);
    // Sum rigid material lengths and gaps; no claim of measured solver tension/force.
    const effectivePathLength = settings.chain.length + totalAnchorError;
    return {
      restLength: settings.chain.length,
      endpointDistance: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
      effectivePathLength,
      maxAnchorError: Math.max(...gaps),
      totalAnchorError,
      excessRatio: totalAnchorError / settings.chain.length,
    };
  }
}
