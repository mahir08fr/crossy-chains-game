export { FixedStepClock } from './fixed-step.js';
export { FoundationSimulation, initializePhysics, normalizeInput } from './simulation.js';
export type { MovementInput, PlayerInputs, PlayerState } from './simulation.js';
export type { Rotation4, SegmentState, ChainMetrics } from './chain.js';
export type { SimulationFault } from './faults.js';
export { exerciseInput, exerciseScenarioIds, exerciseTicks } from './endurance.js';

export { vehicleHitsPlayer, vehicleX } from './road.js';
export type { RoadState, VehicleState } from './road.js';

export { RiverChallenge, inRiver, safeRiverGround } from './river.js';
export type { RiverState, WaterPlayer, WaterPhase } from './river.js';

export { RailwayChallenge, railwayPose, railwayPeriod, railwayTiming, trainHitsPlayer } from './railway.js';
export type { RailwayState, RailwaySettings } from './railway.js';

export { GeneratedWorld } from './generated-world.js';
