import { beforeAll, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { scenarios, settings } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from '@crossy/simulation';
import { ChainView } from './chain-view';

beforeAll(initializePhysics);
it('uses the same interpolation time for visual segments and player attachment positions', () => {
  const scenario = scenarios.find(({ id }) => id === 'slack')!;
  const simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain);
  const view = new ChainView();
  try {
    view.setCount(settings.chain.segments);
    for (let tick = 0; tick < 60; tick++) {
      const before = simulation.chainStates();
      const playersBefore = simulation.states();
      simulation.step({ p1: { x: 0.2, z: 0 } });
      const after = simulation.chainStates();
      const playersAfter = simulation.states();
      for (const alpha of [0, 0.5, 1]) {
        view.update(before, after, alpha);
        for (const [index, playerIndex, sign] of [[0, 0, -1], [11, 1, 1]]) {
          const mesh = view.group.children[index!]!;
          const point = new Vector3(0, sign! * settings.chain.length / settings.chain.segments / 2, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
          const p = playersBefore[playerIndex!]!.position, q = playersAfter[playerIndex!]!.position;
          const attachment = new Vector3(p.x, p.y, p.z).lerp(new Vector3(q.x, q.y, q.z), alpha);
          expect(point.distanceTo(attachment)).toBeLessThan(0.03);
        }
      }
    }
  } finally { simulation.dispose(); view.dispose(); }
});
