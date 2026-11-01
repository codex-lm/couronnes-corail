import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGameData } from '../src/core/data.js';
import { advanceToHuman } from '../src/core/ai.js';
import {
  attack, checkVictory, createGame, endTurn, foundPort, getCurrentFaction,
  getPortAt, getTile, getUnit, hydrateState, incomeReport, isPassable,
  moveUnit, movementCost, nextTideRound, portStats, previewAttack,
  publicStateFor, queueProduction, reachableForUnit, repairUnit,
  researchOptions, resolveDiscovery, scoreFaction, setPortFocus,
  startResearch, tideForRound, unitStats
} from '../src/core/engine.js';
import { addUnit, makeState, testData } from './helpers.js';

test('reference data is complete and the hand-authored map is 11 by 9', () => {
  const data = testData();
  assert.deepEqual(validateGameData(data), []);
  assert.equal(Object.keys(data.technologies).length, 12);
  for (const branch of ['navigation', 'economy', 'fleet']) {
    assert.equal(Object.values(data.technologies).filter((tech) => tech.branch === branch).length, 4);
  }
  const state = makeState();
  assert.equal(state.tiles.length, 99);
  assert.equal(state.ports.length, 3);
  assert.equal(state.units.length, 6);
  for (const start of data.map.starts) {
    const capital = getTile(state, `${start.capital.q},${start.capital.r}`);
    assert.equal(capital.terrain, 'reef');
    const colonizer = state.units.find((unit) => unit.factionId === start.factionId && unit.type === 'colonizer');
    assert.equal(getTile(state, colonizer.tileId).terrain, 'reef');
  }
});

test('fog of war keeps explored memory and public projection hides unknown information', () => {
  const state = makeState();
  const human = state.factions[0];
  const initial = human.explored.length;
  const scout = state.units.find((unit) => unit.factionId === 'nacre' && unit.type === 'scout');
  const destination = Object.keys(reachableForUnit(state, scout.id)).find((id) => !human.explored.includes(id));
  assert.ok(destination);
  assert.equal(moveUnit(state, scout.id, destination).ok, true);
  assert.ok(human.explored.length > initial);
  const projected = publicStateFor(state, 'nacre');
  assert.ok(projected.tiles.some((tile) => tile.terrain === 'unknown'));
  assert.ok(projected.units.every((unit) => unit.factionId === 'nacre' || human.visible.includes(unit.tileId)));
  const visible = new Set(human.visible);
  scout.tileId = '0,0';
  state.factions[0].visible = [];
  assert.ok([...visible].every((id) => human.explored.includes(id)));
});

test('tides change every four complete rounds and are announced one cycle ahead', () => {
  const state = makeState();
  assert.equal(state.tide, 'low');
  assert.equal(nextTideRound(state), 5);
  for (let i = 0; i < 12; i += 1) assert.equal(endTurn(state).ok, true);
  assert.equal(state.round, 5);
  assert.equal(state.tide, 'rising');
  assert.equal(nextTideRound(state), 9);
  assert.equal(tideForRound(state, 9), 'high');
  assert.equal(tideForRound(state, 13), 'falling');
  assert.equal(tideForRound(state, 17), 'low');
});

test('tidal shoals open without destroying or trapping embarked units', () => {
  const state = makeState();
  const shoal = state.tiles.find((tile) => tile.terrain === 'shoal');
  state.tide = 'low';
  assert.equal(isPassable(state, shoal), true);
  state.tide = 'high';
  assert.equal(isPassable(state, shoal), false);
  const scout = state.units[0];
  scout.tileId = shoal.id;
  scout.remainingMp = 4;
  state.factions[0].explored.push(shoal.id, ...Object.keys(reachableForUnit(state, scout.id)));
  const destinations = reachableForUnit(state, scout.id);
  assert.ok(Object.keys(destinations).length > 0, 'a unit on a closing shoal can always sail away');
  assert.ok(state.units.includes(scout));
});

test('current movement costs change with tide and current lore', () => {
  const state = makeState();
  const current = state.tiles.find((tile) => tile.terrain === 'current');
  state.tide = 'low';
  assert.equal(movementCost(state, current, 'nacre'), 2);
  state.tide = 'rising';
  assert.equal(movementCost(state, current, 'nacre'), 1);
  state.tide = 'low';
  state.factions[0].techs.push('current_lore');
  assert.equal(movementCost(state, current, 'nacre'), 1);
});

test('movement consumes one provision per expedition and exact movement points', () => {
  const state = makeState();
  const scout = state.units.find((unit) => unit.type === 'scout' && unit.factionId === 'nacre');
  const target = Object.entries(reachableForUnit(state, scout.id)).sort((a, b) => b[1].cost - a[1].cost)[0];
  const provisions = state.factions[0].resources.provisions;
  const mp = scout.remainingMp;
  const result = moveUnit(state, scout.id, target[0]);
  assert.equal(result.ok, true);
  assert.equal(state.factions[0].resources.provisions, provisions - 1);
  assert.equal(scout.remainingMp, mp - target[1].cost);
  assert.equal(scout.tileId, target[0]);
});

test('colonizers found a port, disappear and control at most two neighboring resources', () => {
  const state = makeState();
  const colonizer = state.units.find((unit) => unit.type === 'colonizer' && unit.factionId === 'nacre');
  const result = foundPort(state, colonizer.id);
  assert.equal(result.ok, true);
  assert.equal(state.units.includes(colonizer), false);
  assert.equal(state.ports.filter((port) => port.factionId === 'nacre').length, 2);
  assert.ok(result.port.worked.length <= 2);
  assert.ok(result.port.worked.every((id) => getTile(state, id).resource));
  assert.equal(foundPort(state, colonizer.id).ok, false);
});

test('the four-port cap is enforced', () => {
  const state = makeState();
  const colonizer = state.units.find((unit) => unit.type === 'colonizer' && unit.factionId === 'nacre');
  foundPort(state, colonizer.id);
  for (const id of ['4,5', '6,5']) {
    state.ports.push({ id: `extra-${id}`, factionId: 'nacre', tileId: id, capitalOf: null, hp: 20, maxHp: 20, buildings: [], queue: [], focus: 'balanced', worked: [], lastFocusRound: 0 });
  }
  const extra = addUnit(state, 'nacre', 'colonizer', '5,3');
  const result = foundPort(state, extra.id);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'portLimit');
});

test('production shows costs, completes after its duration and respects queue length', () => {
  const state = makeState();
  const port = state.ports.find((item) => item.factionId === 'nacre');
  state.factions[0].resources.materials = 30;
  const materials = state.factions[0].resources.materials;
  const first = queueProduction(state, port.id, 'unit', 'scout');
  assert.equal(first.ok, true);
  assert.equal(first.item.turnsLeft, 1);
  assert.equal(state.factions[0].resources.materials, materials - 5);
  assert.equal(queueProduction(state, port.id, 'unit', 'escort').ok, true);
  assert.equal(queueProduction(state, port.id, 'unit', 'bomber').error, 'queueFull');
  const count = state.units.length;
  endTurn(state);
  endTurn(state);
  endTurn(state);
  assert.equal(state.units.length, count + 1);
  assert.equal(port.queue[0].typeId, 'escort');
  assert.equal(port.queue[0].turnsLeft, 2);
});

test('research consumes knowledge, takes the advertised time and improves vision', () => {
  const state = makeState();
  const faction = state.factions[0];
  const scout = state.units.find((unit) => unit.factionId === 'nacre' && unit.type === 'scout');
  const vision = unitStats(state, scout).vision;
  assert.equal(startResearch(state, 'star_charts').ok, true);
  assert.equal(faction.resources.knowledge, 1);
  assert.equal(startResearch(state, 'shell_masonry').ok, false);
  for (let round = 0; round < 6; round += 1) endTurn(state);
  assert.ok(faction.techs.includes('star_charts'));
  assert.equal(unitStats(state, scout).vision, vision + 1);
  assert.ok(researchOptions(state, 'nacre').find((tech) => tech.id === 'current_lore').available);
});

test('income report explains buildings, focus, worked resources and upkeep', () => {
  const state = makeState();
  const port = state.ports.find((item) => item.factionId === 'nacre');
  port.buildings.push('pearl_academy');
  setPortFocus(state, port.id, 'knowledge');
  const report = incomeReport(state, 'nacre');
  assert.equal(report.upkeep, 2);
  assert.equal(report.net.provisions, report.gross.provisions - 2);
  assert.equal(report.gross.knowledge, 6);
  assert.equal(report.perPort[0].income.knowledge, report.gross.knowledge);
});

test('combat preview exactly matches deterministic damage and retaliation', () => {
  const state = makeState();
  const attacker = state.units.find((unit) => unit.factionId === 'nacre' && unit.type === 'scout');
  const defender = state.units.find((unit) => unit.factionId === 'coral' && unit.type === 'scout');
  attacker.tileId = '4,4';
  defender.tileId = '5,4';
  state.factions[0].visible.push(defender.tileId);
  const preview = previewAttack(state, attacker.id, 'unit', defender.id);
  assert.equal(preview.ok, true);
  assert.equal(preview.damage, 2);
  assert.equal(preview.retaliation, 1);
  const result = attack(state, attacker.id, 'unit', defender.id);
  assert.equal(result.ok, true);
  assert.equal(defender.hp, 4);
  assert.equal(attacker.hp, 5);
  assert.equal(attacker.hasActed, true);
  assert.equal(previewAttack(state, attacker.id, 'unit', defender.id).ok, false);
});

test('bombers outrange close defenders and escorts protect adjacent allies', () => {
  const state = makeState();
  const bomber = addUnit(state, 'nacre', 'bomber', '4,4');
  const defender = addUnit(state, 'coral', 'escort', '6,4');
  state.factions[0].visible.push(defender.tileId);
  let preview = previewAttack(state, bomber.id, 'unit', defender.id);
  assert.equal(preview.ok, true);
  assert.equal(preview.retaliation, 0);
  assert.equal(preview.damage, 4);
  bomber.tileId = '5,4';
  defender.tileId = '6,4';
  addUnit(state, 'coral', 'escort', '6,5');
  preview = previewAttack(state, bomber.id, 'unit', defender.id);
  assert.equal(preview.protection, 1);
  assert.equal(preview.damage, 3);
});

test('port capture transfers ownership, clears production and can eliminate the last-port faction', () => {
  const state = makeState();
  const port = state.ports.find((item) => item.factionId === 'coral');
  port.hp = 3;
  port.queue.push({ kind: 'unit', typeId: 'scout', turnsLeft: 1, totalTurns: 1 });
  for (const unit of state.units.filter((item) => item.factionId === 'coral')) unit.tileId = '10,8';
  const escort = addUnit(state, 'nacre', 'escort', '8,1');
  state.factions[0].visible.push(port.tileId);
  const preview = previewAttack(state, escort.id, 'port', port.id);
  assert.equal(preview.portCaptured, true);
  const result = attack(state, escort.id, 'port', port.id);
  assert.equal(result.captured, true);
  assert.equal(port.factionId, 'nacre');
  assert.equal(port.queue.length, 0);
  assert.equal(state.factions.find((faction) => faction.id === 'coral').defeated, true);
  assert.equal(state.units.some((unit) => unit.factionId === 'coral'), false);
});

test('repair requires an allied port and spends materials', () => {
  const state = makeState();
  const port = state.ports.find((item) => item.factionId === 'nacre');
  const unit = addUnit(state, 'nacre', 'escort', port.tileId, 5);
  const materials = state.factions[0].resources.materials;
  const result = repairUnit(state, unit.id);
  assert.equal(result.ok, true);
  assert.equal(unit.hp, 10);
  assert.equal(state.factions[0].resources.materials, materials - 2);
  assert.equal(repairUnit(state, unit.id).ok, false);
});

test('discovery choices grant exactly one reward and block duplicate claims', () => {
  const state = makeState();
  const tile = state.tiles.find((item) => item.site === 'supply_cache');
  state.pendingDiscovery = { factionId: 'nacre', unitId: state.units[0].id, tileId: tile.id, kind: tile.site };
  const materials = state.factions[0].resources.materials;
  assert.equal(resolveDiscovery(state, 'materials').ok, true);
  assert.equal(state.factions[0].resources.materials, materials + 6);
  assert.ok(state.claimedSites.includes(tile.id));
  assert.equal(state.pendingDiscovery, null);
  assert.equal(resolveDiscovery(state, 'materials').ok, false);
});

test('three lighthouses on distinct reefs win immediately', () => {
  const state = makeState();
  const port = state.ports.find((item) => item.factionId === 'nacre');
  for (const id of ['4,5', '6,5']) {
    state.ports.push({ ...port, id: `light-${id}`, tileId: id, buildings: ['great_lighthouse'], queue: [], worked: [] });
  }
  port.buildings.push('great_lighthouse');
  assert.equal(checkVictory(state), 'nacre');
  assert.equal(state.winReason, 'lighthouses');
});

test('holding both opposing capitals wins independently of score', () => {
  const state = makeState();
  for (const port of state.ports.filter((item) => item.factionId !== 'nacre')) port.factionId = 'nacre';
  assert.equal(checkVictory(state), 'nacre');
  assert.equal(state.winReason, 'capitals');
});

test('turn 40 ends with a public explained score', () => {
  const state = makeState();
  state.round = 40;
  state.currentFaction = 2;
  const result = endTurn(state);
  assert.equal(result.finished, true);
  assert.equal(state.winReason, 'score');
  assert.equal(state.finalScores.length, 3);
  for (const score of state.finalScores) {
    assert.equal(score.total, Object.values(score.components).reduce((sum, value) => sum + value, 0));
    assert.equal(score.total, scoreFaction(state, score.factionId).total);
  }
});

test('JSON save round-trip preserves rules and the next real action', () => {
  const state = makeState();
  const scout = state.units.find((unit) => unit.type === 'scout' && unit.factionId === 'nacre');
  const destination = Object.keys(reachableForUnit(state, scout.id))[0];
  const saved = JSON.parse(JSON.stringify(state));
  assert.equal(saved._data, undefined);
  const loaded = hydrateState(saved, testData());
  const expected = moveUnit(state, scout.id, destination);
  const actual = moveUnit(loaded, scout.id, destination);
  assert.deepEqual(actual, expected);
  assert.equal(getUnit(loaded, scout.id).tileId, getUnit(state, scout.id).tileId);
});

test('local opponents complete their turns using the common rule engine', () => {
  const state = makeState();
  endTurn(state);
  const advanced = advanceToHuman(state);
  assert.equal(advanced, 2);
  assert.equal(getCurrentFaction(state).id, 'nacre');
  assert.equal(state.round, 2);
  assert.ok(state.ports.length >= 3);
});
