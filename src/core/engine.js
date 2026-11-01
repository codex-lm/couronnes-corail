import { coords, distance, neighbors, tileId, tilesWithin } from './hex.js';

const RESOURCES = ['provisions', 'materials', 'knowledge'];
const zeroCost = () => ({ provisions: 0, materials: 0, knowledge: 0 });
const attachData = (state, data) => Object.defineProperty(state, '_data', { value: data, enumerable: false });
const rules = (state) => state._data;
const factionOf = (state, id) => state.factions.find((faction) => faction.id === id);
const activeFaction = (state) => state.factions[state.currentFaction];
const unitDefinition = (state, unit) => rules(state).units[unit.type];
const buildingDefinition = (state, id) => rules(state).buildings[id];

export const getTile = (state, id) => state.tiles.find((tile) => tile.id === id);
export const getUnit = (state, id) => state.units.find((unit) => unit.id === id);
export const getPort = (state, id) => state.ports.find((port) => port.id === id);
export const getUnitAt = (state, tile) => state.units.find((unit) => unit.tileId === tile);
export const getPortAt = (state, tile) => state.ports.find((port) => port.tileId === tile);
export const getFaction = (state, id) => factionOf(state, id);
export const getCurrentFaction = (state) => activeFaction(state);
export const tideForRound = (state, round) => rules(state).map.tidePhases[Math.floor((round - 1) / 4) % 4];
export const nextTideRound = (state) => (Math.floor((state.round - 1) / 4) + 1) * 4 + 1;

function addLog(state, type, textKey, params = {}, factionId = null) {
  state.log.unshift({ id: state.nextIds.log++, round: state.round, type, textKey, params, factionId });
  state.log = state.log.slice(0, 100);
}

function createTiles(map) {
  const tiles = [];
  for (let r = 0; r < map.height; r += 1) {
    for (let q = 0; q < map.width; q += 1) {
      const token = map.rows[r][q];
      tiles.push({ id: tileId(q, r), q, r, ...map.tokens[token], token });
    }
  }
  return tiles;
}

function createUnit(state, factionId, type, tile) {
  const definition = unitDefinition(state, { type });
  const unit = {
    id: `u${state.nextIds.unit++}`,
    factionId,
    type,
    tileId: tile,
    hp: definition.maxHp,
    remainingMp: definition.move,
    hasActed: false,
    supplied: true
  };
  const stats = unitStats(state, unit);
  unit.hp = stats.maxHp;
  unit.remainingMp = stats.move;
  state.units.push(unit);
  return unit;
}

function createPort(state, factionId, tile, capitalOf = null) {
  const techHp = capitalOf && factionOf(state, factionId).techs.includes('shell_masonry') ? 4 : 0;
  const port = {
    id: `p${state.nextIds.port++}`,
    factionId,
    tileId: tile,
    capitalOf,
    hp: (capitalOf ? 26 : 20) + techHp,
    maxHp: (capitalOf ? 26 : 20) + techHp,
    buildings: [],
    queue: [],
    focus: 'balanced',
    lastFocusRound: 0,
    worked: []
  };
  state.ports.push(port);
  port.worked = selectWorkedTiles(state, port);
  return port;
}

export function createGame(data) {
  const state = {
    schemaVersion: 1,
    gameId: `crown-${Date.now().toString(36)}`,
    mapId: data.map.id,
    width: data.map.width,
    height: data.map.height,
    round: 1,
    currentFaction: 0,
    tide: data.map.tidePhases[0],
    tiles: createTiles(data.map),
    factions: data.map.starts.map((start) => ({
      id: start.factionId,
      human: data.factions[start.factionId].human,
      resources: { provisions: 12, materials: 10, knowledge: 6 },
      techs: [],
      research: null,
      explored: [],
      visible: [],
      defeated: false
    })),
    ports: [],
    units: [],
    claimedSites: [],
    pendingDiscovery: null,
    winner: null,
    winReason: null,
    finalScores: null,
    log: [],
    nextIds: { unit: 1, port: 1, log: 1 }
  };
  attachData(state, data);
  for (const start of data.map.starts) {
    createPort(state, start.factionId, tileId(start.capital.q, start.capital.r), start.factionId);
    createUnit(state, start.factionId, 'scout', tileId(start.scout.q, start.scout.r));
    createUnit(state, start.factionId, 'colonizer', tileId(start.colonizer.q, start.colonizer.r));
  }
  updateVision(state);
  addLog(state, 'start', 'log.expeditionStarts');
  return state;
}

export function hydrateState(saved, data) {
  if (!saved || saved.schemaVersion !== 1 || saved.mapId !== data.map.id) throw new Error('Incompatible save');
  if (!Array.isArray(saved.tiles) || !Array.isArray(saved.factions) || !Array.isArray(saved.units) || !Array.isArray(saved.ports)) {
    throw new Error('Invalid save');
  }
  attachData(saved, data);
  updateVision(saved);
  return saved;
}

export function unitStats(state, unit) {
  const base = unitDefinition(state, unit);
  const faction = factionOf(state, unit.factionId);
  const has = (tech) => faction.techs.includes(tech);
  return {
    maxHp: base.maxHp + (has('reinforced_keels') ? 2 : 0),
    move: Math.max(1, base.move + (has('swift_hulls') ? 1 : 0) + (unit.type === 'scout' && has('cartographers_guild') ? 1 : 0) - (unit.supplied === false ? 1 : 0)),
    vision: base.vision + (has('star_charts') ? 1 : 0) + (unit.type === 'scout' && has('cartographers_guild') ? 1 : 0),
    attack: Math.max(0, base.attack + (has('admiralty') ? 1 : 0) + (unit.type === 'escort' && has('coordinated_escorts') ? 1 : 0)),
    range: base.range + (unit.type === 'bomber' && has('long_range_ballistae') ? 1 : 0),
    armor: base.armor,
    upkeep: base.upkeep
  };
}

export function portStats(state, port) {
  const faction = factionOf(state, port.factionId);
  const bastion = port.buildings.includes('reef_bastion');
  return {
    attack: 3 + (bastion ? 2 : 0) + (faction.techs.includes('admiralty') ? 2 : 0),
    range: 1,
    armor: 1,
    vision: 2 + (faction.techs.includes('star_charts') ? 1 : 0)
  };
}

export function updateVision(state, factionId = null) {
  for (const faction of state.factions) {
    if (factionId && faction.id !== factionId) continue;
    const visible = new Set();
    for (const unit of state.units.filter((item) => item.factionId === faction.id)) {
      for (const id of tilesWithin(unit.tileId, unitStats(state, unit).vision)) if (getTile(state, id)) visible.add(id);
    }
    for (const port of state.ports.filter((item) => item.factionId === faction.id)) {
      for (const id of tilesWithin(port.tileId, portStats(state, port).vision)) if (getTile(state, id)) visible.add(id);
    }
    faction.visible = [...visible];
    faction.explored = [...new Set([...faction.explored, ...visible])];
  }
}

export function isPassable(state, tile, tide = state.tide) {
  if (!tile) return false;
  const definition = rules(state).terrain[tile.terrain];
  if (definition.passable === false) return false;
  return !definition.passablePhases || definition.passablePhases.includes(tide);
}

export function movementCost(state, tile, factionId, tide = state.tide) {
  const definition = rules(state).terrain[tile.terrain];
  let cost = definition.phaseMove?.[tide] ?? definition.baseMove;
  if (tile.terrain === 'current' && factionOf(state, factionId).techs.includes('current_lore')) cost = Math.max(1, cost - 1);
  return cost;
}

export function reachableForUnit(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!unit || unit.hasActed || unit.factionId !== activeFaction(state).id || state.winner) return {};
  const faction = factionOf(state, unit.factionId);
  const known = new Set(faction.explored);
  const result = { [unit.tileId]: { cost: 0, path: [unit.tileId] } };
  const open = [{ id: unit.tileId, cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
    const current = open.shift();
    if (current.cost !== result[current.id]?.cost) continue;
    for (const next of neighbors(current.id)) {
      const tile = getTile(state, next);
      if (!tile) continue;
      const isKnown = known.has(next);
      if (!isKnown && !known.has(current.id)) continue;
      if (isKnown && !isPassable(state, tile)) continue;
      if (isKnown) {
        const occupant = getUnitAt(state, next);
        if (occupant && (occupant.factionId === unit.factionId || faction.visible.includes(next))) continue;
      }
      const stepCost = isKnown ? movementCost(state, tile, unit.factionId) : 1;
      const cost = current.cost + stepCost;
      if (cost > unit.remainingMp || (result[next] && result[next].cost <= cost)) continue;
      const path = [...result[current.id].path, next];
      result[next] = { cost, path };
      if (isKnown) open.push({ id: next, cost });
    }
  }
  delete result[unit.tileId];
  return result;
}

function triggerDiscovery(state, unit, tile) {
  if (!tile.site || state.claimedSites.includes(tile.id)) return;
  state.pendingDiscovery = { factionId: unit.factionId, unitId: unit.id, tileId: tile.id, kind: tile.site };
  addLog(state, 'discovery', 'log.ruinsFound', { site: tile.site }, unit.factionId);
}

export function moveUnit(state, unitId, targetId) {
  const unit = getUnit(state, unitId);
  if (!unit) return { ok: false, error: 'unknownUnit' };
  if (unit.factionId !== activeFaction(state).id || unit.hasActed || state.winner) return { ok: false, error: 'unitUnavailable' };
  const reachable = reachableForUnit(state, unitId);
  if (!reachable[targetId]) return { ok: false, error: 'unreachable' };
  if (factionOf(state, unit.factionId).resources.provisions < 1) return { ok: false, error: 'provisionsNeeded' };
  const path = reachable[targetId].path;
  let moved = 0;
  for (const next of path.slice(1)) {
    const tile = getTile(state, next);
    if (!isPassable(state, tile)) break;
    const occupant = getUnitAt(state, next);
    if (occupant) {
      updateVision(state, unit.factionId);
      break;
    }
    const cost = movementCost(state, tile, unit.factionId);
    if (cost > unit.remainingMp) break;
    unit.tileId = next;
    unit.remainingMp -= cost;
    moved += 1;
    updateVision(state, unit.factionId);
    triggerDiscovery(state, unit, tile);
    if (state.pendingDiscovery) break;
  }
  if (!moved) return { ok: false, error: 'passageBlocked' };
  factionOf(state, unit.factionId).resources.provisions -= 1;
  addLog(state, 'move', 'log.expedition', { unit: unit.type, tile: unit.tileId }, unit.factionId);
  return { ok: true, moved, remainingMp: unit.remainingMp, pendingDiscovery: state.pendingDiscovery };
}

export function resolveDiscovery(state, choice) {
  const pending = state.pendingDiscovery;
  if (!pending) return { ok: false, error: 'noDiscovery' };
  const faction = factionOf(state, pending.factionId);
  const valid = {
    supply_cache: ['provisions', 'materials'],
    pearl_archive: ['knowledge', 'reveal'],
    tide_beacon: ['research', 'provisions']
  }[pending.kind];
  if (!valid?.includes(choice)) return { ok: false, error: 'invalidChoice' };
  if (choice === 'provisions') faction.resources.provisions += pending.kind === 'supply_cache' ? 8 : 5;
  if (choice === 'materials') faction.resources.materials += 6;
  if (choice === 'knowledge') faction.resources.knowledge += 7;
  if (choice === 'reveal') {
    const explored = new Set(faction.explored);
    for (const id of tilesWithin(pending.tileId, 3)) if (getTile(state, id)) explored.add(id);
    faction.explored = [...explored];
  }
  if (choice === 'research') {
    if (faction.research) {
      faction.research.turnsLeft = Math.max(0, faction.research.turnsLeft - 2);
      if (faction.research.turnsLeft === 0) completeResearch(state, faction);
    } else {
      faction.resources.knowledge += 5;
    }
  }
  state.claimedSites.push(pending.tileId);
  state.pendingDiscovery = null;
  addLog(state, 'reward', 'log.discoveryClaimed', { choice }, faction.id);
  checkVictory(state);
  return { ok: true };
}

function selectWorkedTiles(state, port) {
  const claimed = new Set(state.ports.filter((item) => item.id !== port.id).flatMap((item) => item.worked));
  return neighbors(port.tileId)
    .map((id) => getTile(state, id))
    .filter((tile) => tile?.resource && !claimed.has(tile.id))
    .sort((a, b) => Number(b.resource === port.focus) - Number(a.resource === port.focus) || b.yield - a.yield || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map((tile) => tile.id);
}

export function setPortFocus(state, portId, focus) {
  const port = getPort(state, portId);
  if (!port || port.factionId !== activeFaction(state).id) return { ok: false, error: 'portUnavailable' };
  if (!['balanced', ...RESOURCES].includes(focus)) return { ok: false, error: 'invalidFocus' };
  if (port.lastFocusRound === state.round && port.focus !== focus) return { ok: false, error: 'focusAlreadyChanged' };
  port.focus = focus;
  port.lastFocusRound = state.round;
  port.worked = selectWorkedTiles(state, port);
  return { ok: true };
}

export function foundPort(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!unit || unit.type !== 'colonizer' || unit.factionId !== activeFaction(state).id || unit.hasActed) {
    return { ok: false, error: 'colonizerUnavailable' };
  }
  const tile = getTile(state, unit.tileId);
  if (!rules(state).terrain[tile.terrain].habitable || getPortAt(state, tile.id)) return { ok: false, error: 'reefRequired' };
  if (state.ports.filter((port) => port.factionId === unit.factionId).length >= 4) return { ok: false, error: 'portLimit' };
  const factionId = unit.factionId;
  state.units = state.units.filter((item) => item.id !== unit.id);
  const port = createPort(state, factionId, tile.id);
  updateVision(state);
  addLog(state, 'port', 'log.portFounded', { tile: tile.id }, factionId);
  checkVictory(state);
  return { ok: true, port };
}

function affordable(faction, cost) {
  return RESOURCES.every((resource) => faction.resources[resource] >= (cost[resource] || 0));
}

function pay(faction, cost) {
  for (const resource of RESOURCES) faction.resources[resource] -= cost[resource] || 0;
}

export function productionOptions(state, portId) {
  const port = getPort(state, portId);
  if (!port) return [];
  const faction = factionOf(state, port.factionId);
  const units = Object.values(rules(state).units).map((definition) => ({ kind: 'unit', definition }));
  const buildings = Object.values(rules(state).buildings)
    .filter((definition) => !port.buildings.includes(definition.id))
    .filter((definition) => !definition.requiresTech || faction.techs.includes(definition.requiresTech))
    .map((definition) => ({ kind: 'building', definition }));
  return [...units, ...buildings].map((option) => ({
    ...option,
    affordable: affordable(faction, option.definition.cost),
    queued: port.queue.some((item) => item.kind === option.kind && item.typeId === option.definition.id)
  }));
}

export function queueProduction(state, portId, kind, typeId) {
  const port = getPort(state, portId);
  if (!port || port.factionId !== activeFaction(state).id || state.winner) return { ok: false, error: 'portUnavailable' };
  if (port.queue.length >= 2) return { ok: false, error: 'queueFull' };
  const definition = kind === 'unit' ? rules(state).units[typeId] : rules(state).buildings[typeId];
  if (!definition) return { ok: false, error: 'unknownProduction' };
  const faction = factionOf(state, port.factionId);
  if (kind === 'building' && (port.buildings.includes(typeId) || port.queue.some((item) => item.typeId === typeId))) {
    return { ok: false, error: 'alreadyBuilt' };
  }
  if (definition.requiresTech && !faction.techs.includes(definition.requiresTech)) return { ok: false, error: 'technologyRequired' };
  if (!affordable(faction, definition.cost)) return { ok: false, error: 'resourcesNeeded' };
  pay(faction, definition.cost);
  const item = { kind, typeId, turnsLeft: definition.buildTurns, totalTurns: definition.buildTurns };
  port.queue.push(item);
  addLog(state, 'production', 'log.productionQueued', { item: typeId, port: port.id }, port.factionId);
  return { ok: true, item };
}

export function cancelProduction(state, portId, index) {
  const port = getPort(state, portId);
  if (!port || port.factionId !== activeFaction(state).id || !port.queue[index]) return { ok: false, error: 'queueUnavailable' };
  const [item] = port.queue.splice(index, 1);
  const definition = item.kind === 'unit' ? rules(state).units[item.typeId] : rules(state).buildings[item.typeId];
  for (const resource of RESOURCES) factionOf(state, port.factionId).resources[resource] += Math.floor((definition.cost[resource] || 0) * 0.75);
  return { ok: true };
}

function spawnNearPort(state, port, type) {
  const candidates = [port.tileId, ...neighbors(port.tileId), ...neighbors(port.tileId).flatMap((id) => neighbors(id))];
  const tile = [...new Set(candidates)].map((id) => getTile(state, id)).find((item) => item && isPassable(state, item) && !getUnitAt(state, item.id));
  return tile ? createUnit(state, port.factionId, type, tile.id) : null;
}

function completeProduction(state, port) {
  const item = port.queue[0];
  if (!item || item.turnsLeft > 0) return false;
  if (item.kind === 'unit') {
    const unit = spawnNearPort(state, port, item.typeId);
    if (!unit) return false;
    addLog(state, 'production', 'log.unitReady', { unit: unit.type, port: port.id }, port.factionId);
  } else {
    port.buildings.push(item.typeId);
    if (item.typeId === 'reef_bastion') {
      port.maxHp += 6;
      port.hp += 6;
    }
    addLog(state, 'production', 'log.buildingReady', { building: item.typeId, port: port.id }, port.factionId);
  }
  port.queue.shift();
  updateVision(state);
  checkVictory(state);
  return true;
}

export function researchOptions(state, factionId) {
  const faction = factionOf(state, factionId);
  return Object.values(rules(state).technologies).map((tech) => ({
    ...tech,
    completed: faction.techs.includes(tech.id),
    available: tech.prerequisites.every((id) => faction.techs.includes(id)),
    affordable: faction.resources.knowledge >= tech.cost
  }));
}

export function startResearch(state, techId) {
  const faction = activeFaction(state);
  const tech = rules(state).technologies[techId];
  if (!tech || faction.research || faction.techs.includes(techId)) return { ok: false, error: 'researchUnavailable' };
  if (!tech.prerequisites.every((id) => faction.techs.includes(id))) return { ok: false, error: 'prerequisiteMissing' };
  if (faction.resources.knowledge < tech.cost) return { ok: false, error: 'knowledgeNeeded' };
  faction.resources.knowledge -= tech.cost;
  faction.research = { techId, turnsLeft: tech.turns, totalTurns: tech.turns };
  addLog(state, 'research', 'log.researchStarted', { tech: techId }, faction.id);
  return { ok: true };
}

function completeResearch(state, faction) {
  const techId = faction.research?.techId;
  if (!techId) return;
  faction.techs.push(techId);
  faction.research = null;
  if (techId === 'reinforced_keels') {
    for (const unit of state.units.filter((item) => item.factionId === faction.id)) {
      unit.hp += 2;
      unit.remainingMp = Math.min(unit.remainingMp, unitStats(state, unit).move);
    }
  }
  if (techId === 'shell_masonry') {
    for (const port of state.ports.filter((item) => item.factionId === faction.id)) {
      port.maxHp += 4;
      port.hp += 4;
    }
  }
  updateVision(state, faction.id);
  addLog(state, 'research', 'log.researchComplete', { tech: techId }, faction.id);
}

function escortProtection(state, target) {
  if (!target.factionId) return 0;
  const escort = state.units.find((unit) => unit.factionId === target.factionId && unit.type === 'escort' && unit.id !== target.id && distance(unit.tileId, target.tileId) === 1);
  if (!escort) return 0;
  return 1 + (factionOf(state, target.factionId).techs.includes('coordinated_escorts') ? 1 : 0);
}

export function previewAttack(state, attackerId, targetKind, targetId) {
  const attacker = getUnit(state, attackerId);
  const target = targetKind === 'unit' ? getUnit(state, targetId) : getPort(state, targetId);
  if (!attacker || !target || attacker.factionId === target.factionId) return { ok: false, error: 'invalidTarget' };
  if (attacker.factionId !== activeFaction(state).id || attacker.hasActed || state.winner) return { ok: false, error: 'unitUnavailable' };
  const attackerStats = unitStats(state, attacker);
  if (attackerStats.attack <= 0) return { ok: false, error: 'cannotAttack' };
  const range = distance(attacker.tileId, target.tileId);
  if (range > attackerStats.range) return { ok: false, error: 'outOfRange' };
  const faction = factionOf(state, attacker.factionId);
  if (!faction.visible.includes(target.tileId)) return { ok: false, error: 'targetNotVisible' };
  if (targetKind === 'port') {
    if (state.ports.filter((port) => port.factionId === attacker.factionId).length >= 4) return { ok: false, error: 'portLimit' };
    const defender = getUnitAt(state, target.tileId);
    if (defender && defender.factionId === target.factionId) return { ok: false, error: 'defendedByUnit' };
  }
  const targetStats = targetKind === 'unit' ? unitStats(state, target) : portStats(state, target);
  const protection = escortProtection(state, target);
  const damage = Math.max(1, attackerStats.attack - targetStats.armor - protection);
  const survivingHp = Math.max(0, target.hp - damage);
  const targetCanRespond = survivingHp > 0 && targetStats.attack > 0 && range <= targetStats.range;
  const retaliation = targetCanRespond ? Math.max(1, Math.floor(targetStats.attack * 0.6) - attackerStats.armor - escortProtection(state, attacker)) : 0;
  return {
    ok: true,
    attackerId,
    targetKind,
    targetId,
    damage,
    retaliation,
    targetHpAfter: survivingHp,
    attackerHpAfter: Math.max(0, attacker.hp - retaliation),
    targetDestroyed: targetKind === 'unit' && survivingHp === 0,
    portCaptured: targetKind === 'port' && survivingHp === 0,
    attackerDestroyed: attacker.hp - retaliation <= 0,
    protection
  };
}

export function attack(state, attackerId, targetKind, targetId) {
  const preview = previewAttack(state, attackerId, targetKind, targetId);
  if (!preview.ok) return preview;
  const attacker = getUnit(state, attackerId);
  const target = targetKind === 'unit' ? getUnit(state, targetId) : getPort(state, targetId);
  const defenderFactionId = target.factionId;
  target.hp = Math.max(0, target.hp - preview.damage);
  attacker.hasActed = true;
  attacker.remainingMp = 0;
  if (preview.targetDestroyed) state.units = state.units.filter((unit) => unit.id !== target.id);
  if (preview.portCaptured) {
    target.factionId = attacker.factionId;
    target.hp = Math.max(6, Math.floor(target.maxHp / 2));
    target.queue = [];
    target.worked = selectWorkedTiles(state, target);
    addLog(state, 'capture', 'log.portCaptured', { port: target.id }, attacker.factionId);
  }
  if (preview.retaliation) attacker.hp = Math.max(0, attacker.hp - preview.retaliation);
  if (attacker.hp <= 0) state.units = state.units.filter((unit) => unit.id !== attacker.id);
  addLog(state, 'combat', 'log.combat', { damage: preview.damage, retaliation: preview.retaliation }, attacker.factionId);
  updateVision(state);
  eliminateDefeated(state, defenderFactionId);
  eliminateDefeated(state, attacker.factionId);
  checkVictory(state);
  return { ok: true, preview, captured: preview.portCaptured };
}

export function repairUnit(state, unitId) {
  const unit = getUnit(state, unitId);
  if (!unit || unit.factionId !== activeFaction(state).id || unit.hasActed) return { ok: false, error: 'unitUnavailable' };
  const port = getPortAt(state, unit.tileId);
  if (!port || port.factionId !== unit.factionId) return { ok: false, error: 'friendlyPortRequired' };
  const stats = unitStats(state, unit);
  if (unit.hp >= stats.maxHp) return { ok: false, error: 'alreadyHealthy' };
  const faction = factionOf(state, unit.factionId);
  if (faction.resources.materials < 2) return { ok: false, error: 'materialsNeeded' };
  faction.resources.materials -= 2;
  unit.hp = Math.min(stats.maxHp, unit.hp + 5);
  unit.hasActed = true;
  unit.remainingMp = 0;
  return { ok: true, hp: unit.hp };
}

export function incomeReport(state, factionId) {
  const faction = factionOf(state, factionId);
  const gross = zeroCost();
  const perPort = [];
  for (const port of state.ports.filter((item) => item.factionId === factionId)) {
    const income = { provisions: 2, materials: 1, knowledge: 1 };
    if (port.focus === 'balanced') for (const resource of RESOURCES) income[resource] += 1;
    else income[port.focus] += 2;
    for (const workedId of port.worked) {
      const tile = getTile(state, workedId);
      if (tile?.resource) income[tile.resource] += tile.yield;
    }
    for (const buildingId of port.buildings) {
      const buildingIncome = buildingDefinition(state, buildingId).income || zeroCost();
      for (const resource of RESOURCES) income[resource] += buildingIncome[resource] || 0;
    }
    if (faction.techs.includes('tidal_mills')) income.provisions += 1;
    if (faction.techs.includes('pearl_artisans')) {
      income.materials += 1;
      income.knowledge += 1;
    }
    perPort.push({ portId: port.id, income });
    for (const resource of RESOURCES) gross[resource] += income[resource];
  }
  const upkeep = state.units.filter((unit) => unit.factionId === factionId).reduce((sum, unit) => sum + unitStats(state, unit).upkeep, 0);
  return { gross, upkeep, net: { ...gross, provisions: gross.provisions - upkeep }, perPort };
}

function beginTurn(state, faction) {
  const report = incomeReport(state, faction.id);
  for (const resource of RESOURCES) faction.resources[resource] += report.gross[resource];
  const shortage = faction.resources.provisions < report.upkeep;
  faction.resources.provisions = Math.max(0, faction.resources.provisions - report.upkeep);
  for (const unit of state.units.filter((item) => item.factionId === faction.id)) {
    unit.hasActed = false;
    unit.supplied = !shortage;
    unit.remainingMp = unitStats(state, unit).move;
    const port = getPortAt(state, unit.tileId);
    if (port?.factionId === faction.id && port.buildings.includes('spiral_drydock')) {
      unit.hp = Math.min(unitStats(state, unit).maxHp, unit.hp + 2);
    }
  }
  if (shortage) addLog(state, 'supply', 'log.shortage', {}, faction.id);
  if (faction.research) {
    faction.research.turnsLeft -= 1;
    if (faction.research.turnsLeft <= 0) completeResearch(state, faction);
  }
  for (const port of state.ports.filter((item) => item.factionId === faction.id)) {
    if (port.queue[0]) port.queue[0].turnsLeft -= 1;
    while (port.queue[0]?.turnsLeft <= 0 && completeProduction(state, port)) { /* complete all ready items */ }
  }
  updateVision(state, faction.id);
}

export function scoreFaction(state, factionId) {
  const faction = factionOf(state, factionId);
  const ports = state.ports.filter((port) => port.factionId === factionId);
  const units = state.units.filter((unit) => unit.factionId === factionId);
  const components = {
    ports: ports.length * 20,
    capitals: ports.filter((port) => port.capitalOf === factionId).length * 10,
    units: units.length * 3,
    technologies: faction.techs.length * 5,
    lighthouses: ports.filter((port) => port.buildings.includes('great_lighthouse')).length * 25,
    exploration: Math.floor(faction.explored.length / 4),
    stockpile: Math.floor(RESOURCES.reduce((sum, resource) => sum + faction.resources[resource], 0) / 3)
  };
  return { factionId, components, total: Object.values(components).reduce((sum, value) => sum + value, 0) };
}

function eliminateDefeated(state, factionId) {
  const faction = factionOf(state, factionId);
  if (faction.defeated || state.ports.some((port) => port.factionId === factionId)) return;
  faction.defeated = true;
  state.units = state.units.filter((unit) => unit.factionId !== factionId);
  addLog(state, 'defeat', 'log.factionDefeated', { faction: factionId }, factionId);
}

function finishByScore(state) {
  state.finalScores = state.factions.map((faction) => scoreFaction(state, faction.id)).sort((a, b) => b.total - a.total || a.factionId.localeCompare(b.factionId));
  state.winner = state.finalScores[0].total === state.finalScores[1]?.total ? 'draw' : state.finalScores[0].factionId;
  state.winReason = 'score';
  addLog(state, 'victory', 'log.scoreVictory', { winner: state.winner });
}

export function checkVictory(state) {
  if (state.winner) return state.winner;
  for (const faction of state.factions.filter((item) => !item.defeated)) {
    const ports = state.ports.filter((port) => port.factionId === faction.id);
    if (ports.filter((port) => port.buildings.includes('great_lighthouse')).length >= 3) {
      state.winner = faction.id;
      state.winReason = 'lighthouses';
      break;
    }
    const rivals = state.factions.filter((item) => item.id !== faction.id);
    if (rivals.every((rival) => state.ports.some((port) => port.capitalOf === rival.id && port.factionId === faction.id))) {
      state.winner = faction.id;
      state.winReason = 'capitals';
      break;
    }
  }
  if (!state.winner) {
    for (const faction of state.factions) eliminateDefeated(state, faction.id);
    const active = state.factions.filter((faction) => !faction.defeated);
    if (active.length === 1) {
      state.winner = active[0].id;
      state.winReason = 'elimination';
    } else if (factionOf(state, 'nacre')?.defeated) {
      const leader = active.map((faction) => scoreFaction(state, faction.id)).sort((a, b) => b.total - a.total)[0];
      state.winner = leader?.factionId || 'draw';
      state.winReason = 'human-eliminated';
    }
  }
  if (state.winner) addLog(state, 'victory', 'log.victory', { winner: state.winner, reason: state.winReason });
  return state.winner;
}

export function endTurn(state) {
  if (state.winner) return { ok: false, error: 'gameFinished' };
  if (state.pendingDiscovery) return { ok: false, error: 'discoveryPending' };
  const active = state.factions.map((faction, index) => ({ faction, index })).filter(({ faction }) => !faction.defeated);
  const position = active.findIndex(({ index }) => index === state.currentFaction);
  const nextPosition = (position + 1) % active.length;
  if (nextPosition === 0) state.round += 1;
  if (state.round > 40) {
    state.round = 40;
    finishByScore(state);
    return { ok: true, finished: true };
  }
  const previousTide = state.tide;
  state.tide = tideForRound(state, state.round);
  state.currentFaction = active[nextPosition].index;
  if (state.tide !== previousTide) addLog(state, 'tide', 'log.tideChanged', { tide: state.tide });
  beginTurn(state, activeFaction(state));
  checkVictory(state);
  return { ok: true, factionId: activeFaction(state).id, round: state.round, tide: state.tide };
}

export function publicStateFor(state, factionId) {
  const copy = JSON.parse(JSON.stringify(state));
  const faction = factionOf(state, factionId);
  copy.tiles = copy.tiles.map((tile) => faction.explored.includes(tile.id) ? tile : { id: tile.id, q: tile.q, r: tile.r, terrain: 'unknown' });
  copy.units = copy.units.filter((unit) => unit.factionId === factionId || faction.visible.includes(unit.tileId));
  copy.ports = copy.ports.filter((port) => port.factionId === factionId || faction.explored.includes(port.tileId));
  copy.factions = copy.factions.map((item) => item.id === factionId ? item : { id: item.id, defeated: item.defeated });
  delete copy.pendingDiscovery;
  return copy;
}
