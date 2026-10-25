/** Versioned progression overlay; terrain topology uses generator v4. */
export const difficultyVersion = 3 as const;
export const difficultyTiers = [
  { from: 0, label: 'Opening', roadSpeedScale: 1, headwayScale: 1 },
  { from: 100, label: 'Flow', roadSpeedScale: 1.05, headwayScale: .98 },
  { from: 250, label: 'Timing', roadSpeedScale: 1.05, headwayScale: .96 },
  { from: 500, label: 'Endless', roadSpeedScale: 1.1, headwayScale: .94 },
] as const;
export function difficultyAt(distance: number): number {
  let tier = 0;
  for (let i = 1; i < difficultyTiers.length; i++) if (distance >= difficultyTiers[i]!.from) tier = i;
  return tier;
}
