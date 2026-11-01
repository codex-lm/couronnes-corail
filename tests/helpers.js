import fs from 'node:fs';
import { byId } from '../src/core/data.js';
import { createGame } from '../src/core/engine.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));

export function testData() {
  return {
    terrain: byId(read('terrain')),
    units: byId(read('units')),
    buildings: byId(read('buildings')),
    technologies: byId(read('technologies')),
    factions: byId(read('factions')),
    map: read('map-reference'),
    locales: read('locales')
  };
}

export function makeState() {
  return createGame(testData());
}

export function addUnit(state, factionId, type, tileId, hp = null) {
  const definition = state._data.units[type];
  const unit = {
    id: `test-u-${state.units.length + 1}`,
    factionId,
    type,
    tileId,
    hp: hp ?? definition.maxHp,
    remainingMp: definition.move,
    hasActed: false,
    supplied: true
  };
  state.units.push(unit);
  return unit;
}

export function finishFactionTurn(state) {
  const before = state.currentFaction;
  return { before };
}
