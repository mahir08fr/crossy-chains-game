import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { generateSection, roadLanes } from './generated-world.js';

it('retains the pre-M15E exact descriptors and lane recipes through cold cache eviction at every tier', () => {
  const hash = createHash('sha256');
  for (let seed = 100; seed < 102; seed++) for (let index = 0; index < 512; index++) {
    const section = generateSection(seed, index, 4, undefined, index % 4);
    // Normalize only the explicitly authorized current magnitudes; retain the original
    // golden for every terrain, rock and traffic field.
    if (section.river) section.river.acceleration = section.river.strength === "fast" ? 5 : 2;
    hash.update(JSON.stringify(section));
    if (section.type === 'road') hash.update(JSON.stringify(roadLanes(section)));
  }
  // Captured from the preserved dirty baseline, before the interval-allocation optimization.
  expect(hash.digest('hex')).toBe('8dfcc62a16aedd088eff0e4a1d16ad8d83072f46ee711b6a5740d46becfc1762');
});
