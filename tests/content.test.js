import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { playAiFaction } from '../src/core/ai.js';
import { endTurn, foundPort, previewAttack } from '../src/core/engine.js';
import { addUnit, makeState, testData } from './helpers.js';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

test('all starting expansion reefs offer at least one free neighboring exploitation', () => {
  const state = makeState();
  for (let index = 0; index < state.factions.length; index += 1) {
    state.currentFaction = index;
    const faction = state.factions[index];
    const colonizer = state.units.find((unit) => unit.factionId === faction.id && unit.type === 'colonizer');
    const result = foundPort(state, colonizer.id);
    assert.equal(result.ok, true);
    assert.ok(result.port.worked.length >= 1, `${faction.id} expansion has a free resource`);
  }
});

test('the reference map contains all three discovery types', () => {
  const state = makeState();
  assert.deepEqual(new Set(state.tiles.filter((tile) => tile.site).map((tile) => tile.site)), new Set(['pearl_archive', 'supply_cache', 'tide_beacon']));
});

test('a fourth owned port prevents further captures instead of exceeding the cap', () => {
  const state = makeState();
  const template = state.ports.find((port) => port.factionId === 'nacre');
  for (const id of ['4,5', '6,5', '5,3']) state.ports.push({ ...template, id: `cap-${id}`, tileId: id, queue: [], worked: [] });
  const target = state.ports.find((port) => port.factionId === 'coral');
  for (const unit of state.units.filter((unit) => unit.factionId === 'coral')) unit.tileId = '10,8';
  const escort = addUnit(state, 'nacre', 'escort', '8,1');
  state.factions[0].visible.push(target.tileId);
  const preview = previewAttack(state, escort.id, 'port', target.id);
  assert.equal(preview.ok, false);
  assert.equal(preview.error, 'portLimit');
});

test('EN, FR and ES cover exactly the same interface and content keys', () => {
  const locales = testData().locales;
  const english = Object.keys(locales.en).sort();
  assert.ok(english.length > 200);
  for (const language of ['fr', 'es']) {
    assert.deepEqual(Object.keys(locales[language]).sort(), english, language);
    for (const key of english) assert.ok(locales[language][key].trim(), `${language}:${key}`);
  }
});

test('all data-referenced models and sprites exist and Blender/GLB files have real signatures', () => {
  const data = testData();
  const references = [];
  for (const group of ['terrain', 'units', 'buildings', 'technologies', 'factions']) {
    for (const definition of Object.values(data[group])) {
      if (definition.model) references.push(definition.model);
      if (definition.sprite) references.push(definition.sprite);
    }
  }
  for (const reference of references) assert.ok(fs.existsSync(path.join(root, reference)), reference);
  const blends = fs.readdirSync(path.join(root, 'assets/blend')).filter((name) => name.endsWith('.blend'));
  const glbs = fs.readdirSync(path.join(root, 'assets/glb')).filter((name) => name.endsWith('.glb'));
  assert.ok(blends.length >= 35);
  assert.ok(glbs.length >= 35);
  for (const name of blends) assert.equal(fs.readFileSync(path.join(root, 'assets/blend', name)).subarray(0, 7).toString(), 'BLENDER');
  let animated = 0;
  for (const name of glbs) {
    const bytes = fs.readFileSync(path.join(root, 'assets/glb', name));
    assert.equal(bytes.subarray(0, 4).toString(), 'glTF');
    const length = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
    if (json.animations?.length) animated += 1;
  }
  assert.ok(animated >= 18);
});

test('a complete AI game respects port caps, valid resources and a decisive ending', () => {
  const state = makeState();
  for (const faction of state.factions) faction.human = false;
  let guard = 0;
  while (!state.winner && guard < 121) {
    playAiFaction(state);
    endTurn(state);
    guard += 1;
  }
  assert.ok(state.winner, 'game reaches a victory or score ending');
  assert.ok(guard < 121);
  for (const faction of state.factions) {
    assert.ok(state.ports.filter((port) => port.factionId === faction.id).length <= 4);
    for (const value of Object.values(faction.resources)) assert.ok(Number.isFinite(value) && value >= 0);
  }
  assert.ok(['lighthouses', 'capitals', 'score', 'elimination', 'human-eliminated'].includes(state.winReason));
});
