import gooseWalk from '../../../assets/goose/output/goose_animated/canada_goose_animated.glb?url';
import gooseSwim from '../../../assets/goose/output/goose_006/goose_swimming.glb?url';
import axolotlWalk from '../../../assets/axolotl/output/axolotl_animated/axolotl_animated.glb?url';
import axolotlSwim from '../../../assets/axolotl/output/axolotl_004/axolotl_swimming.glb?url';
import capybaraWalk from '../../../assets/capybara/output/capybara_003/capybara_animated.glb?url';
import capybaraSwim from '../../../assets/capybara/output/capybara_006/capybara_swimming.glb?url';
import unicornWalk from '../../../assets/unicorn/output/unicorn_006/unicorn_animated.glb?url';
import unicornSwim from '../../../assets/unicorn/output/unicorn_009/unicorn_swimming.glb?url';
import type { PlayerSlot } from '@crossy/protocol';

export type CharacterDefinition = { species: string; root: string; walk: string; swim: string; tread: string; landUrl: string; waterUrl: string; scale: number; waterline: number; landSpeed: number; swimSpeed: number };
export const characterAssets: Record<PlayerSlot, CharacterDefinition> = {
  p1: { species: 'Goose', root: 'Goose_Root', walk: 'Goose_Walk', swim: 'Goose_Swim', tread: 'Goose_TreadWater', landUrl: gooseWalk, waterUrl: gooseSwim, scale: .9, waterline: .77, landSpeed: .368, swimSpeed: .32 },
  p2: { species: 'Axolotl', root: 'Axolotl_Root', walk: 'Axolotl_Walk', swim: 'Axolotl_Swim', tread: 'Axolotl_TreadWater', landUrl: axolotlWalk, waterUrl: axolotlSwim, scale: 1, waterline: .48, landSpeed: .1107692308, swimSpeed: .26 },
  p3: { species: 'Capybara', root: 'Capybara_Root', walk: 'Capybara_Walk', swim: 'Capybara_Swim', tread: 'Capybara_TreadWater', landUrl: capybaraWalk, waterUrl: capybaraSwim, scale: 1, waterline: .84, landSpeed: .110769230769, swimSpeed: .22 },
  p4: { species: 'Unicorn', root: 'Unicorn_Root', walk: 'Unicorn_Walk', swim: 'Unicorn_Swim', tread: 'Unicorn_TreadWater', landUrl: unicornWalk, waterUrl: unicornSwim, scale: 1, waterline: 1.04, landSpeed: .135, swimSpeed: .24 },
};
