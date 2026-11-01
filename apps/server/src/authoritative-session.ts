import { EndlessRunScore } from './endless-run.js';
import { randomBytes } from 'node:crypto';
import { generatedScenario, groupScenario, railwayScenario, riverScenario, roadScenario, course, localPlayers, scenarios, settings } from '@crossy/config';
import { FixedStepClock, FoundationSimulation } from '@crossy/simulation';
import type { PlayerInputs } from '@crossy/simulation';
import { protocolVersion } from '@crossy/protocol';
import type { GroupSize, ChainCourse, MotionChain, PlayerSlot, RoomPhase, SnapshotMessage, MotionWorld, MotionRailway, MotionRiver, MotionRoad } from '@crossy/protocol';

/** Owns a tested Foundation/M2 world; knows nothing about sockets or rendering. */
export class AuthoritativeSession {
  readonly simulation: FoundationSimulation;
  private readonly runScore = new EndlessRunScore();
  private safeWorld: MotionWorld | undefined;
  private safeChain: MotionChain | undefined;
  private safeRailway: MotionRailway | undefined;
  private safeRiver: MotionRiver | undefined;
  private safeRoad: MotionRoad | undefined;
  private readonly clock = new FixedStepClock(settings.physics.tickSeconds, settings.physics.maxCatchUpTicks);
  private droppedSeconds = 0;
  private inputs: PlayerInputs = {};
  private sequences: Partial<Record<PlayerSlot, number>> = {};
  private safePlayers: (ReturnType<FoundationSimulation['states']>[number] & { acknowledgedSequence: number })[];
  runGeneration = 0;
  onTickMeasured?: (milliseconds: number, threadCpuMilliseconds: number) => void;
  phase: RoomPhase = 'waiting';

  constructor(readonly chainCourse?: ChainCourse, readonly capacity: GroupSize = 2, readonly worldSeed = randomBytes(4).readUInt32LE()) {
    const base = chainCourse === 'generated' ? generatedScenario : chainCourse === 'railway' ? railwayScenario : chainCourse === 'river' ? riverScenario : chainCourse === 'road' ? roadScenario : chainCourse ? scenarios.find(({ id }) => id === chainCourse) : undefined;
    const scenario = base ? groupScenario(base, capacity) : undefined;
    if (capacity !== 2 && !chainCourse) throw new Error('Larger groups require a chain course');
    if (chainCourse && (!scenario || !scenario.chain)) throw new Error('Unsupported chain course');
    this.simulation = scenario
      ? new FoundationSimulation(scenario.players, scenario.boxes, true, scenario.obstacles, chainCourse === 'road', chainCourse === 'river', chainCourse === 'railway', chainCourse === 'generated' ? worldSeed : undefined)
      : new FoundationSimulation(localPlayers, course, false);
    this.safePlayers = this.simulation.states().map((player) => ({ ...player, acknowledgedSequence: 0 }));
    this.captureChain();
  }

  private captureChain(): void {
    this.safeWorld = this.simulation.generatedState();
    this.safeRailway = this.simulation.railwayState();
    this.safeRiver = this.simulation.riverState();
    this.safeRoad = this.simulation.roadState();
    this.safeChain = this.chainCourse ? { course: this.chainCourse, endpoints: this.simulation.states().map(player => player.id),
      segments: this.simulation.chainStates().map(({ position, rotation }) => ({ position, rotation })) } : undefined;
  }

  setPhase(phase: Exclude<RoomPhase, 'fault'>): void {
    if (this.phase === 'fault' || this.phase === 'ended') return;
    if (phase !== this.phase) { this.droppedSeconds += this.clock.droppedSeconds; this.clock.reset(); }
    this.phase = phase;
  }

  input(slot: PlayerSlot, x: number, z: number, sequence: number): void {
    this.inputs[slot] = { x, z };
    this.sequences[slot] = sequence;
  }

  clearInputs(): void { this.inputs = {}; this.sequences = {}; }

  advance(elapsedSeconds: number): void {
    if (this.phase !== 'running') return;
    this.clock.advance(elapsedSeconds, () => {
      if (this.phase === 'fault' || this.phase === 'ended') return;
      const measure = this.onTickMeasured;
      const startedAt = measure ? performance.now() : 0;
      const cpu = measure ? process.threadCpuUsage() : undefined;
      this.simulation.step(this.inputs);
      if (measure && cpu) {
        const wallMs = performance.now() - startedAt;
        const used = process.threadCpuUsage(cpu);
        measure(wallMs, (used.user + used.system) / 1000);
      }
      if (this.simulation.fault) { this.phase = 'fault'; this.clearInputs(); return; }
      this.captureChain();
      this.safePlayers = this.simulation.states().map((player) => ({
        ...player, acknowledgedSequence: this.sequences[player.id] ?? this.safePlayers.find((safe) => safe.id === player.id)!.acknowledgedSequence,
      }));
      if (this.safeWorld) this.runScore.advance(this.safePlayers, this.safeWorld.outcome === 'failed');
      if ((this.safeWorld && this.safeWorld.outcome !== 'active') || (this.safeRailway && this.safeRailway.outcome !== 'active') || (this.safeRoad && this.safeRoad.outcome !== 'active') || (this.safeRiver && this.safeRiver.outcome !== 'active')) { this.phase = 'ended'; this.clearInputs(); }
    });
  }

  snapshot(serverTimeMs: number): SnapshotMessage {
    return { protocolVersion, scenarioVersion: this.safeWorld ? 7 : this.safeRailway ? 6 : this.safeRiver ? 5 : this.capacity > 2 ? 4 : this.safeRoad ? 3 : this.chainCourse ? 2 : 1, runGeneration: this.runGeneration,
      phase: this.phase, droppedSeconds: this.droppedSeconds + this.clock.droppedSeconds,
      tick: this.safePlayers[0]!.tick, serverTimeMs,
      ...(this.safeWorld ? { run: this.runScore.state(), world: structuredClone(this.safeWorld) } : {}),
      ...(this.safeChain ? { chain: structuredClone(this.safeChain) } : {}),
      ...(this.safeRailway ? { railway: structuredClone(this.safeRailway) } : {}),
      ...(this.safeRiver ? { river: structuredClone(this.safeRiver) } : {}),
      ...(this.safeRoad ? { road: structuredClone(this.safeRoad) } : {}),
      players: this.safePlayers.map(({ tick: _tick, ...player }) => ({
        ...player, position: { ...player.position }, velocity: { ...player.velocity },
      })),
    };
  }

  reset(): void {
    this.simulation.reset();
    this.runScore.reset();
    this.droppedSeconds = 0;
    this.clock.reset();
    this.clearInputs();
    this.runGeneration++;
    this.phase = 'waiting';
    this.captureChain();
    this.safePlayers = this.simulation.states().map((player) => ({ ...player, acknowledgedSequence: 0 }));
  }

  diagnostics() {
    return { ...this.simulation.generatedDiagnostics(), bodies: this.simulation.world.bodies.len(),
      colliders: this.simulation.world.colliders.len(), joints: this.simulation.world.impulseJoints.len(),
      runGeneration: this.runGeneration, runSeconds: this.safeWorld?.elapsedSeconds,
      distance: this.safeWorld ? this.runScore.state().distance : undefined };
  }

  dispose(): void { this.clearInputs(); this.simulation.dispose(); }
}
