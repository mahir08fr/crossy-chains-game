import { scenarios, settings } from '@crossy/config';
import { FoundationSimulation } from './simulation.js';
import type { PlayerInputs } from './simulation.js';

export const exerciseScenarioIds = ['slack', 'taut', 'post', 'barrier', 'two-posts'] as const;
export const exerciseTicks = 720;

// World-space inputs shared by Node stress checks and the browser soak.
// Each 12-second episode settles, catches/pulls, opposes, then reverses to release.
export function exerciseInput(id: string, tick: number): PlayerInputs {
  if (tick < 120) return {};
  if (tick < 360) return id === 'taut'
    ? { p1: { x: 1, z: 0 }, p2: { x: -1, z: 0 } }
    : { p1: { x: 0, z: 1 }, p2: { x: 0, z: 1 } };
  if (tick < 480) return { p1: { x: 0.3, z: 1 }, p2: { x: -0.3, z: 1 } };
  return { p1: { x: 0, z: -1 }, p2: { x: 0, z: -1 } };
}

export function runEndurance(seconds: number) {
  const totalTicks = Math.round(seconds / settings.physics.tickSeconds);
  const started = performance.now();
  const stepTimes: number[] = [];
  let maxExcess = 0, maxGap = 0, maxPenetration = 0, maxPlayerSpeed = 0, maxSegmentSpeed = 0, maxContacts = 0;
  let simulation: FoundationSimulation | undefined;
  let episodes = 0;
  let minBodies = Infinity, maxBodies = 0, minColliders = Infinity, maxColliders = 0, minJoints = Infinity, maxJoints = 0;
  const failures: string[] = [];
  let completedTicks = 0;
  try {
    for (let tick = 0; tick < totalTicks; tick++) {
      const phase = tick % exerciseTicks;
      const id = exerciseScenarioIds[Math.floor(tick / exerciseTicks) % exerciseScenarioIds.length]!;
      if (phase === 0) {
        simulation?.dispose();
        const scenario = scenarios.find((entry) => entry.id === id)!;
        simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain, scenario.obstacles);
        episodes++;
      }
      const world = simulation!;
      const stepStarted = performance.now();
      world.step(exerciseInput(id, phase));
      stepTimes.push(performance.now() - stepStarted);
      if (world.fault) { failures.push(`${id} tick ${tick}: ${world.fault.detail}`); break; }
      completedTicks++;
      const metrics = world.chainMetrics()!;
      const contact = world.obstacleContacts();
      maxExcess = Math.max(maxExcess, metrics.excessRatio);
      maxGap = Math.max(maxGap, metrics.maxAnchorError);
      maxPenetration = Math.max(maxPenetration, contact.maxPenetration);
      maxContacts = Math.max(maxContacts, contact.ids.length);
      for (const state of world.states()) maxPlayerSpeed = Math.max(maxPlayerSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
      for (const state of world.chainStates()) maxSegmentSpeed = Math.max(maxSegmentSpeed, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z));
      if (phase === exerciseTicks - 1 && contact.ids.length > 0) { failures.push(`Reverse did not release ${id}`); break; }
      const bodies = world.world.bodies.len(), colliders = world.world.colliders.len(), joints = world.world.impulseJoints.len();
      minBodies = Math.min(minBodies, bodies); maxBodies = Math.max(maxBodies, bodies);
      minColliders = Math.min(minColliders, colliders); maxColliders = Math.max(maxColliders, colliders);
      minJoints = Math.min(minJoints, joints); maxJoints = Math.max(maxJoints, joints);
      if (bodies !== 14 || joints !== 13 || colliders < 19 || colliders > 21) { failures.push(`Unexpected counts in ${id}`); break; }
    }
  } finally { simulation?.dispose(); }
  stepTimes.sort((a, b) => a - b);
  return { requestedSeconds: seconds, simulatedSeconds: completedTicks * settings.physics.tickSeconds, ticks: completedTicks, episodes, wallSeconds: (performance.now() - started) / 1000,
    maxExcess, maxGap, maxPenetration, maxPlayerSpeed, maxSegmentSpeed, maxContacts,
    bodyRange: [minBodies, maxBodies], colliderRange: [minColliders, maxColliders], jointRange: [minJoints, maxJoints],
    p95StepMs: stepTimes[Math.floor(stepTimes.length * 0.95)] ?? 0, failures };
}
