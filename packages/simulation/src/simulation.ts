import { GeneratedWorld } from './generated-world.js';
import { RailwayChallenge } from './railway.js';
import { RiverChallenge, inRiver } from './river.js';
import { riverSettings } from '@crossy/config';
import { RoadChallenge } from './road.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { course, foundationPlayers, settings } from '@crossy/config';
import { inspectBody, inspectConstraints } from './faults.js';
import type { SimulationFault } from './faults.js';
import { ChainAssembly } from './chain.js';
import type { BodyPose } from './chain.js';
import type { CourseBox, CourseObstacle, PlayerDefinition, PlayerId, Point3 } from '@crossy/config';

export type MovementInput = { x: number; z: number };
export type PlayerInputs = Partial<Record<PlayerId, MovementInput>>;
export type PlayerState = { id: PlayerId; position: Point3; velocity: Point3; grounded: boolean; tick: number };

let initialization: Promise<void> | undefined;
export function initializePhysics(): Promise<void> {
  return initialization ??= RAPIER.init();
}

export function normalizeInput(input: MovementInput): MovementInput {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.z)) return { x: 0, z: 0 };
  const length = Math.hypot(input.x, input.z);
  const divisor = Math.max(1, length);
  return { x: input.x / divisor, z: input.z / divisor };
}

export class FoundationSimulation {
  world: RAPIER.World;
  private readonly players = new Map<PlayerId, { definition: PlayerDefinition; body: RAPIER.RigidBody; collider: RAPIER.Collider; grounded: boolean }>();
  private tick = 0;
  private generated: GeneratedWorld | undefined;
  private rear: RAPIER.Collider | undefined;
  private railway: RailwayChallenge | undefined;
  private road: RoadChallenge | undefined;
  private river: RiverChallenge | undefined;
  private failure: SimulationFault | undefined;
  private chains: ChainAssembly[] = [];
  private readonly obstacles = new Map<string, RAPIER.Collider>();
  private readonly terrain = new Set<number>();

  constructor(private readonly definitions: readonly PlayerDefinition[] = foundationPlayers, private readonly boxes: readonly CourseBox[] = course, private readonly chainEnabled = false, private readonly obstacleDefinitions: readonly CourseObstacle[] = [], private readonly roadEnabled = false, private readonly riverEnabled = false, private readonly railwayEnabled = false, private readonly generatedSeed?: number) {
    if (definitions.length === 0 || new Set(definitions.map(({ id }) => id)).size !== definitions.length) {
      throw new Error('Players require unique IDs and at least one definition');
    }
    this.world = this.createWorld();
  }

  private createWorld(): RAPIER.World {
    this.players.clear();
    this.terrain.clear();
    this.obstacles.clear();
    this.chains = [];
    this.railway = this.railwayEnabled ? new RailwayChallenge() : undefined;
    this.river = this.riverEnabled ? new RiverChallenge(this.definitions.map(p => p.id)) : undefined;
    this.road = this.roadEnabled ? new RoadChallenge() : undefined;
    this.world = new RAPIER.World({ x: 0, y: settings.physics.gravity, z: 0 });
    this.world.timestep = settings.physics.tickSeconds / (this.chainEnabled ? settings.chain.substeps : 1);
    if (this.chainEnabled) {
      this.world.numSolverIterations = settings.chain.solverIterations;
      // Contact and joint rows must converge together. One inner PGS pass can
      // leave a snagged cable's anchor error to become a large corrective
      // velocity on the next substep (deterministic two-post reproduction).
      this.world.integrationParameters.numInternalPgsIterations = settings.chain.internalPgsIterations;
    }
    for (const box of this.boxes) this.addTerrain(box);
    this.generated = this.generatedSeed === undefined ? undefined : new GeneratedWorld(this.generatedSeed,
      this.definitions.length as 2 | 3 | 4, this.definitions.map(p=>p.id), box=>this.addTerrain(box), handle=>{
        const collider=this.world.getCollider(handle); if(collider)this.world.removeCollider(collider,true); this.terrain.delete(handle);
        for(const [id,c] of this.obstacles)if(c.handle===handle)this.obstacles.delete(id);
      });
    this.rear = this.generated ? this.world.getCollider(this.addTerrain({id:'progress-rear',kind:'boundary',center:{x:0,y:.4,z:-7},halfSize:{x:10,y:1.1,z:.3}})) : undefined;
    for (const obstacle of this.obstacleDefinitions) {
      const shape = obstacle.shape === 'post'
        ? RAPIER.ColliderDesc.cylinder(obstacle.halfHeight, obstacle.radius)
        : RAPIER.ColliderDesc.roundCuboid(obstacle.halfSize.x, obstacle.halfSize.y, obstacle.halfSize.z, obstacle.borderRadius);
      const collider = this.world.createCollider(shape
        .setTranslation(obstacle.center.x, obstacle.center.y, obstacle.center.z)
        .setFriction(settings.chain.friction).setRestitution(0).setCollisionGroups(0x00010007));
      this.obstacles.set(obstacle.id, collider);
      this.terrain.add(collider.handle);
    }
    for (const definition of this.definitions) {
      const spawn = { ...definition.spawn };
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(spawn.x, spawn.y, spawn.z)
          .lockRotations()
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(settings.player.halfHeight, settings.player.radius)
          .setMass(settings.player.mass)
          .setFriction(settings.player.friction)
          .setRestitution(0).setCollisionGroups(0x00020003),
        body,
      );
      this.players.set(definition.id, { definition: { ...definition, spawn }, body, collider, grounded: false });
    }
    if (this.chainEnabled) {
      if (this.players.size < 2) throw new Error('Chain requires at least two players');
      const players = [...this.players.values()];
      for (let index = 1; index < players.length; index++) {
        this.chains.push(new ChainAssembly(this.world, players[index - 1]!.body, players[index]!.body));
      }
    }
    this.generated?.stream(this.occupiedPositions());
    return this.world;
  }

  private addTerrain(box: CourseBox): number {
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.halfSize.x, box.halfSize.y, box.halfSize.z)
      .setTranslation(box.center.x, box.center.y, box.center.z)
      .setRotation({ x: Math.sin((box.rotationX ?? 0) / 2), y: 0, z: 0, w: Math.cos((box.rotationX ?? 0) / 2) })
      .setFriction(settings.player.friction).setRestitution(0).setCollisionGroups(0x00010007));
    if(box.id.includes('/river-v1/rock-')) { this.obstacles.set(box.id,collider); }
    else this.terrain.add(collider.handle);
    return collider.handle;
  }

  /** Keep every physical centre in streaming/progress bounds without constructing full poses. */
  private occupiedPositions(): Point3[] {
    return [...this.players.values()].map(player => player.body.translation()).concat(this.chains.flatMap(chain => chain.positions()));
  }

  generatedDiagnostics() { return this.generated?.diagnostics(); }

  generatedState() { return this.generated?.state(); }

  get fault(): SimulationFault | undefined { return this.failure; }

  step(inputs: PlayerInputs): void {
    if (this.failure || this.generated?.ended || this.road?.ended || this.river?.ended || this.railway?.ended) return;
    this.failure = this.detectFault();
    if (this.failure) return;
    this.generated?.stream(this.occupiedPositions());
    const substeps = this.chainEnabled ? settings.chain.substeps : 1;
    for (let i = 0; i < substeps; i++) {
      const before = this.road || this.railway || this.generated ? this.states() : [];
      if(this.generated && this.rear){
        const limit=this.generated.progress(this.occupiedPositions(),this.world.timestep);
        this.rear.setTranslation({x:0,y:.4,z:limit-.3});
      }
      this.applyDrive(inputs);
      this.world.step();
      this.failure = this.detectFault();
      if (this.failure) return;
      this.generated?.step(before, this.states(), this.world.timestep);
      this.road?.step(before, this.states(), this.world.timestep);
      this.railway?.step(before, this.states(), this.world.timestep);
      this.river?.step(this.states(), this.world.timestep);
      if (this.generated?.ended || this.road?.ended || this.river?.ended || this.railway?.ended) break;
    }
    this.tick++;
  }

  private detectFault(): SimulationFault | undefined {
    let reason: ReturnType<typeof inspectBody>;
    const poses = new Map<number, BodyPose>();
    this.world.bodies.forEach((body) => {
      if (reason) return;
      let player: PlayerId | undefined;
      for (const [id, entry] of this.players) { if (entry.body.handle === body.handle) { player = id; break; } }
      const pose = { position: body.translation(), rotation: body.rotation() };
      poses.set(body.handle, pose);
      reason = inspectBody({ ...pose, velocity: body.linvel(), angularVelocity: body.angvel() }, player ?? `segment ${body.handle}`, player ? settings.faults.playerSpeed : settings.faults.segmentSpeed);
    });
    for (const chain of this.chains) reason ??= inspectConstraints(chain.metrics(poses));
    return reason ? { ...reason, tick: this.tick } : undefined;
  }

  private applyDrive(inputs: PlayerInputs): void {
    for (const [id, player] of this.players) {
      const input = normalizeInput(inputs[id] ?? { x: 0, z: 0 });
      const position = player.body.translation();
      const ray = new RAPIER.Ray(position, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRayAndGetNormal(
        ray,
        settings.player.halfHeight + settings.player.radius + settings.player.groundProbe,
        true,
        undefined,
        undefined,
        player.collider,
        undefined,
        (collider) => this.terrain.has(collider.handle),
      );
      player.grounded = hit !== null && hit.normal.y > 0.7;
      player.body.resetForces(false);
      const wet = (!!this.river && inRiver(position)) || (this.generated?.wet(position) ?? false);
      player.collider.setFriction(wet ? riverSettings.friction : settings.player.friction);
      if (wet) {
        const v = player.body.linvel();
        const dragScale = Math.min(riverSettings.drag, riverSettings.maxDragAcceleration / Math.max(Math.hypot(v.x, v.z), 1e-9));
        const vx = input.x * riverSettings.speed, vz = input.z * riverSettings.speed;
        const ax = (vx - v.x) / settings.player.responseSeconds, az = (vz - v.z) / settings.player.responseSeconds;
        const scale = player.grounded ? Math.min(1, riverSettings.acceleration / Math.max(Math.hypot(ax, az), 1e-9)) : 0;
        player.body.addForce({ x: (ax * scale - v.x * dragScale + (this.generated?.current(position) ?? 0)) * player.body.mass(), y: 0,
          z: (az * scale - v.z * dragScale) * player.body.mass() }, true);
      } else if (player.grounded) {
        const velocity = player.body.linvel();
        const active = input.x !== 0 || input.z !== 0;
        const responseSeconds = !active && this.chainEnabled ? settings.chain.idleResponseSeconds : settings.player.responseSeconds;
        let ax = (input.x * settings.player.speed - velocity.x) / responseSeconds;
        let az = (input.z * settings.player.speed - velocity.z) / responseSeconds;
        const idleBraking = this.chainEnabled ? settings.chain.idleBraking : settings.player.braking;
        const limit = active ? settings.player.acceleration : idleBraking;
        const scale = Math.min(1, limit / Math.max(Math.hypot(ax, az), 1e-9));
        ax *= scale;
        az *= scale;
        // A bounded drive force preserves external forces for the later chain prototype.
        player.body.addForce({ x: ax * player.body.mass(), y: 0, z: az * player.body.mass() }, true);
      }
    }
  }

  state(id: PlayerId = 'p1'): PlayerState {
    const player = this.players.get(id);
    if (!player) throw new Error(`Unknown player: ${id}`);
    return {
      id,
      position: { ...player.body.translation() },
      velocity: { ...player.body.linvel() },
      grounded: player.grounded,
      tick: this.tick,
    };
  }

  states(): PlayerState[] {
    return [...this.players.keys()].map((id) => this.state(id));
  }

  railwayState() { return this.railway?.state(); }

  riverState() { return this.river?.state(); }

  roadState() { return this.road?.state(); }

  chainStates() { return this.chains.flatMap(chain => chain.states()); }
  chainMetrics() { return this.chains[0]?.metrics(); }

  chainMetricsAll() { return this.chains.map(chain => chain.metrics()); }

  obstacleContacts(): { ids: string[]; pairs: number; maxPenetration: number } {
    const ids = new Set<string>();
    let pairs = 0, maxPenetration = 0;
    this.world.colliders.forEach((segment) => {
      if (segment.collisionGroups() !== 0x00040001) return;
      for (const [id, obstacle] of this.obstacles) {
        let touching = false;
        this.world.contactPair(segment, obstacle, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i++) {
            if (manifold.contactImpulse(i) > 1e-6) touching = true;
          }
        });
        if (touching) { ids.add(id); pairs++; }
        const contact = segment.contactCollider(obstacle, 0);
        if (contact) maxPenetration = Math.max(maxPenetration, -contact.distance);
      }
    });
    return { ids: [...ids], pairs, maxPenetration };
  }

  reset(): void {
    // Rebuild the whole world so resets cannot retain contact/constraint state.
    this.world.free();
    this.world = this.createWorld();
    this.tick = 0;
    this.failure = undefined;
  }

  debugLines(): { vertices: Float32Array; colors: Float32Array } {
    return this.world.debugRender();
  }

  dispose(): void {
    this.world.free();
  }
}
