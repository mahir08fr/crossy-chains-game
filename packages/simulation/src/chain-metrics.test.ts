import { beforeAll, expect, it } from 'vitest';
import { groupScenario, scenarios } from '@crossy/config';
import { FoundationSimulation, initializePhysics } from './simulation';
import { worldPoint } from './chain';
beforeAll(initializePhysics);
it('optimized complete checks exactly equal live-joint reference metrics through motion and anchor fault injection', () => {
  const s = groupScenario(scenarios.find(s => s.id === 'slack')!, 4);
  const sim = new FoundationSimulation(s.players, s.boxes, true);
  const compare = () => {
    const joints = sim.world.impulseJoints.getAll();
    for (const [index, actual] of sim.chainMetricsAll().entries()) {
      const edge = joints.slice(index * 13, (index + 1) * 13);
      const gaps = edge.map(j => {
        const a = worldPoint(j.body1(), j.anchor1()), b = worldPoint(j.body2(), j.anchor2());
        return Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      });
      const first=edge[0]!, last=edge.at(-1)!;
      const a=worldPoint(first.body1(),first.anchor1()), b=worldPoint(last.body2(),last.anchor2());
      const total=gaps.reduce((a,b)=>a+b,0);
      expect(actual).toEqual({ restLength:6, endpointDistance:Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),
        effectivePathLength:6+total, maxAnchorError:Math.max(...gaps), totalAnchorError:total, excessRatio:total/6 });
    }
  };
  try {
    for(let tick=0;tick<240;tick++) {sim.step({p2:{x:.3,z:0}});if(tick%20===0)compare();}
    // Read actual anchors on every check: external diagnostic edits cannot hide a gap.
    const joint=sim.world.impulseJoints.getAll().at(-1)!;
    joint.setAnchor2({x:1,y:0,z:0}); compare();sim.step({});expect(sim.fault?.kind).toBe('constraint');
  } finally {sim.dispose();}
}, 15000);
