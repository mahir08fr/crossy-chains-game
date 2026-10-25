// All values are initial tuning choices, not approved performance/gameplay targets.
export const playerMovementScale = 0.85;
export const settings = {
  physics: { tickSeconds: 1 / 60, maxCatchUpTicks: 6, gravity: -18 },
  player: {
    radius: 0.35,
    halfHeight: 0.42,
    mass: 70,
    speed: 7.5 * playerMovementScale,
    acceleration: 28,
    braking: 51,
    responseSeconds: 0.12,
    friction: 0.15,
    groundProbe: 0.1,
    spawn: { x: 0, y: 0.8, z: -5 },
  },
  chain: {
    length: 6, segments: 12, radius: 0.08, segmentMass: 4,
    linearDamping: 0.25, angularDamping: 0.8, friction: 0.1,
    substeps: 4, solverIterations: 12, internalPgsIterations: 2, idleBraking: 18, idleResponseSeconds: 0.3,
  },
  faults: { playerSpeed: 15, segmentSpeed: 35, angularSpeed: 250, anchorGap: 0.3, pathExcess: 0.25 },
  camera: { height: 16, behind: 18, viewHeight: 20, maxViewHeight: 80, padding: 5, smoothing: 8 },
  rendering: { maxPixelRatio: 1.5 },
} as const;

export type Point3 = { x: number; y: number; z: number };
export type CourseBox = {
  id: string;
  center: Point3;
  halfSize: Point3;
  kind: 'ground' | 'boundary' | 'obstacle';
  rotationX?: number;
};

// One shared description keeps placeholder visuals aligned with physics shapes.
export const course: readonly CourseBox[] = [
  { id: 'ground', center: { x: 0, y: -0.25, z: 8 }, halfSize: { x: 12, y: 0.25, z: 18 }, kind: 'ground' },
  { id: 'left-wall', center: { x: -12, y: 0.65, z: 8 }, halfSize: { x: 0.3, y: 0.65, z: 18 }, kind: 'boundary' },
  { id: 'right-wall', center: { x: 12, y: 0.65, z: 8 }, halfSize: { x: 0.3, y: 0.65, z: 18 }, kind: 'boundary' },
  { id: 'start-wall', center: { x: 0, y: 0.65, z: -10 }, halfSize: { x: 12, y: 0.65, z: 0.3 }, kind: 'boundary' },
  { id: 'end-wall', center: { x: 0, y: 0.65, z: 26 }, halfSize: { x: 12, y: 0.65, z: 0.3 }, kind: 'boundary' },
  { id: 'barrier', center: { x: 0, y: 0.6, z: 2 }, halfSize: { x: 2.5, y: 0.6, z: 0.7 }, kind: 'obstacle' },
  { id: 'block-a', center: { x: -4.5, y: 0.9, z: 9 }, halfSize: { x: 0.9, y: 0.9, z: 0.9 }, kind: 'obstacle' },
  { id: 'block-b', center: { x: 4.5, y: 0.9, z: 9 }, halfSize: { x: 0.9, y: 0.9, z: 0.9 }, kind: 'obstacle' },
  { id: 'long-block', center: { x: -2, y: 0.6, z: 17 }, halfSize: { x: 0.7, y: 0.6, z: 2 }, kind: 'obstacle' },
];

export const playerIds = ['p1', 'p2', 'p3', 'p4'] as const;
export type PlayerId = typeof playerIds[number];
export type GroupSize = 2 | 3 | 4;
export type PlayerDefinition = { id: PlayerId; spawn: Point3; color: number };

// Keep the Foundation spawn for P1 and place P2 clear of its capsule.
export const localPlayers: readonly PlayerDefinition[] = [
  { id: 'p1', spawn: settings.player.spawn, color: 0xf4bd62 },
  { id: 'p2', spawn: { x: -2, y: settings.player.spawn.y, z: settings.player.spawn.z }, color: 0x78bde8 },
];
export const foundationPlayers: readonly PlayerDefinition[] = [localPlayers[0]!];

export type CourseObstacle =
  | { id: string; center: Point3; shape: 'post'; radius: number; halfHeight: number }
  | { id: string; center: Point3; shape: 'barrier'; halfSize: Point3; borderRadius: number };

export type Scenario = {
  id: string;
  label: string;
  players: readonly PlayerDefinition[];
  boxes: readonly CourseBox[];
  chain: boolean;
  obstacles?: readonly CourseObstacle[];
};

const openGround: readonly CourseBox[] = [
  { id: 'ground', center: { x: 0, y: -0.25, z: 0 }, halfSize: { x: 30, y: 0.25, z: 30 }, kind: 'ground' },
  { id: 'left-wall', center: { x: -30, y: 0.65, z: 0 }, halfSize: { x: 0.3, y: 0.65, z: 30 }, kind: 'boundary' },
  { id: 'right-wall', center: { x: 30, y: 0.65, z: 0 }, halfSize: { x: 0.3, y: 0.65, z: 30 }, kind: 'boundary' },
  { id: 'start-wall', center: { x: 0, y: 0.65, z: -30 }, halfSize: { x: 30, y: 0.65, z: 0.3 }, kind: 'boundary' },
  { id: 'end-wall', center: { x: 0, y: 0.65, z: 30 }, halfSize: { x: 30, y: 0.65, z: 0.3 }, kind: 'boundary' },
];

function openPlayers(separation: number): readonly PlayerDefinition[] {
  return localPlayers.map((player, index) => ({
    ...player,
    spawn: { x: (index === 0 ? 1 : -1) * separation / 2, y: settings.player.spawn.y, z: 0 },
  }));
}

export const scenarios: readonly Scenario[] = [
  { id: 'foundation', label: 'Foundation course · unchained', players: localPlayers, boxes: course, chain: false },
  { id: 'slack', label: 'Open ground · slack', players: openPlayers(4), boxes: openGround, chain: true },
  { id: 'post', label: 'Round post · catch / reverse', players: openPlayers(4), boxes: openGround, chain: true, obstacles: [{ id: 'post', shape: 'post', center: { x: 0, y: 1.5, z: 3.5 }, radius: 0.65, halfHeight: 1.5 }] },
  { id: 'barrier', label: 'Rounded barrier · reverse', players: openPlayers(5), boxes: openGround, chain: true, obstacles: [
    { id: 'barrier', shape: 'barrier', center: { x: 0, y: 1.1, z: 3.5 }, halfSize: { x: 1.4, y: 0.75, z: 0.3 }, borderRadius: 0.35 },
  ] },
  { id: 'two-posts', label: 'Two posts · multiple contacts', players: openPlayers(4), boxes: openGround, chain: true, obstacles: [
    { id: 'post-left', shape: 'post', center: { x: 0.75, y: 1.5, z: 3.5 }, radius: 0.4, halfHeight: 1.5 },
    { id: 'post-right', shape: 'post', center: { x: -0.75, y: 1.5, z: 3.5 }, radius: 0.4, halfHeight: 1.5 },
  ] },
  { id: 'taut', label: 'Open ground · full length', players: openPlayers(6), boxes: openGround, chain: true },
];


// Handcrafted M6 course. Traffic wraps outside the playable boundaries.
export const roadSettings = {
  halfLength: 18, laneWidth: 3, finishZ: 15,
  carHalfSize: { x: 1.77, y: 0.75, z: 0.86 },
  lanes: [
    { z: 3, speed: 7.5, direction: 1, offset: -14 },
    { z: 6, speed: 9, direction: -1, offset: 12 },
    { z: 11, speed: 10, direction: 1, offset: -8 },
  ],
} as const;
export const roadScenario: Scenario = {
  id: 'road', label: 'First playable road', chain: true,
  players: openPlayers(4).map(player => ({ ...player, spawn: { ...player.spawn, z: -2 } })),
  boxes: [
    { id: 'ground', kind: 'ground', center: { x: 0, y: -0.25, z: 7 }, halfSize: { x: 10, y: 0.25, z: 12 } },
    { id: 'left-wall', kind: 'boundary', center: { x: -10, y: 0.65, z: 7 }, halfSize: { x: 0.3, y: 0.65, z: 12 } },
    { id: 'right-wall', kind: 'boundary', center: { x: 10, y: 0.65, z: 7 }, halfSize: { x: 0.3, y: 0.65, z: 12 } },
    { id: 'start-wall', kind: 'boundary', center: { x: 0, y: 0.65, z: -5 }, halfSize: { x: 10, y: 0.65, z: 0.3 } },
    { id: 'end-wall', kind: 'boundary', center: { x: 0, y: 0.65, z: 19 }, halfSize: { x: 10, y: 0.65, z: 0.3 } },
  ],
};

// Reuse authored geometry; preserve the exact approved two-player spawn.
export function groupScenario(scenario: Scenario, capacity: GroupSize = 2): Scenario {
  if (capacity === 2) return scenario;
  const colors = [0xf4bd62, 0x78bde8, 0xe99ab8, 0xafa1ed];
  const z = scenario.players[0]!.spawn.z;
  return { ...scenario, players: playerIds.slice(0, capacity).map((id, index) => ({
    id, color: colors[index]!, spawn: { x: (capacity - 1) * 2 - index * 4, y: settings.player.spawn.y, z },
  })) };
}


// M10 deterministic shallow-wading fixture; independent of the approved road.
export const riverSettings = {
  minZ: 2, maxZ: 7, halfWidth: 10, depth: 0.3, bankRun: 1.5, surfaceY: 0.025,
  finishZ: 10, exposureSeconds: 8, recoverySeconds: 1, safeMargin: 0.15,
  speed: 2.1 * playerMovementScale, acceleration: 12, drag: 0.8, maxDragAcceleration: 6, friction: 0.02,
} as const;
const bankAngle = Math.atan(riverSettings.depth / riverSettings.bankRun);
const bankLength = Math.hypot(riverSettings.depth, riverSettings.bankRun);
export const riverScenario: Scenario = {
  id: 'river', label: 'River · physical pulling and survival', chain: true,
  players: openPlayers(4).map(p => ({ ...p, spawn: { ...p.spawn, z: -1 } })),
  boxes: [
    { id: 'near-bank', kind: 'ground', center: { x: 0, y: -0.25, z: (riverSettings.minZ - 5) / 2 }, halfSize: { x: riverSettings.halfWidth, y: 0.25, z: (riverSettings.minZ + 5) / 2 } },
    { id: 'far-bank', kind: 'ground', center: { x: 0, y: -0.25, z: (riverSettings.maxZ + 13) / 2 }, halfSize: { x: riverSettings.halfWidth, y: 0.25, z: (13 - riverSettings.maxZ) / 2 } },
    { id: 'river-bed', kind: 'ground', center: { x: 0, y: -riverSettings.depth - 0.25, z: (riverSettings.minZ + riverSettings.maxZ) / 2 }, halfSize: { x: riverSettings.halfWidth, y: 0.25, z: (riverSettings.maxZ - riverSettings.minZ) / 2 - riverSettings.bankRun + 0.01 } },
    ...([-1, 1] as const).map(side => ({ id: `bank-slope-${side}`, kind: 'ground' as const,
      center: { x: 0, y: -riverSettings.depth / 2 - 0.1 * Math.cos(bankAngle), z: (riverSettings.minZ + riverSettings.maxZ) / 2 + side * ((riverSettings.maxZ - riverSettings.minZ - riverSettings.bankRun) / 2 + 0.1 * Math.sin(bankAngle)) },
      halfSize: { x: riverSettings.halfWidth, y: 0.1, z: bankLength / 2 + 0.005 }, rotationX: -side * bankAngle })),
    { id: 'left-wall', kind: 'boundary', center: { x: -riverSettings.halfWidth, y: 0.4, z: 4 }, halfSize: { x: 0.3, y: 1.1, z: 9 } },
    { id: 'right-wall', kind: 'boundary', center: { x: riverSettings.halfWidth, y: 0.4, z: 4 }, halfSize: { x: 0.3, y: 1.1, z: 9 } },
    { id: 'start-wall', kind: 'boundary', center: { x: 0, y: 0.65, z: -5 }, halfSize: { x: riverSettings.halfWidth, y: 0.65, z: 0.3 } },
    { id: 'end-wall', kind: 'boundary', center: { x: 0, y: 0.65, z: 13 }, halfSize: { x: riverSettings.halfWidth, y: 0.65, z: 0.3 } },
  ],
};

// M12 geometry retained. Phase 1.1 exact user targets apply to every railway,
// including generated difficulty tiers. Dwell is derived, never a second cycle.
export const railwayTargets = { speed: 35, cycleSeconds: 7, warningSeconds: 3 } as const;
const trainEntryX = -36, trainExitX = 48;
// Module roots/footprints match untouched train_004 GLBs.
export const railwaySettings = {
  z: 4, railTopY: 0.06, halfWidth: 10, finishZ: 9, speed: railwayTargets.speed, maxSpeed: railwayTargets.speed, direction: 1,
  entryX: trainEntryX, exitX: trainExitX, cycleSeconds: railwayTargets.cycleSeconds,
  safeSeconds: railwayTargets.cycleSeconds - (trainExitX-trainEntryX)/railwayTargets.speed,
  warningSeconds: railwayTargets.warningSeconds, minWarningSeconds: railwayTargets.warningSeconds,
  modules: [
    { name: 'locomotive', offset: 0, length: 6.36, width: 2.30, height: 3.13 },
    { name: 'boxcar', offset: -5.66, length: 4.96, width: 2.19, height: 2.885 },
    { name: 'open_wagon', offset: -10.32, length: 4.36, width: 2.16, height: 2.18 },
  ],
} as const;
export const railwayScenario: Scenario = {
  ...roadScenario, id: 'railway', label: 'Railway test',
  players: roadScenario.players.map(p => ({ ...p, spawn: { ...p.spawn } })),
};

export { terrainWeights, generationDiagnostics, resetGenerationDiagnostics, transitionMinimum, generatedVehicleSlots, trafficProfiles, trafficBaseSpeed, trafficMovementScale, trafficCrossingSpeed, wrapTrafficX, generatedCarsPerLane, generatedSettings, sectionStart, sectionLength, sectionCenter, sectionIndex, vehicleColor, generatedScenario, hazardHalfDepth, roadLanes, sectionReason, generateSection, generatorVersion, groupEnvelope, sectionBoxes, streamingSettings, validateSection, validateArrangement } from './generated-world.js';
export type { WorldSection, WorldLayout, SectionType } from './generated-world.js';

export { difficultyVersion, difficultyTiers, difficultyAt } from './endless.js';

export * from './river-layout.js';
