import { distance, tilesWithin } from './hex.js';
import {
  endTurn, foundPort, getCurrentFaction, getPortAt, getTile, moveUnit,
  previewAttack, attack, queueProduction, reachableForUnit, repairUnit,
  researchOptions, resolveDiscovery, setPortFocus, startResearch
} from './engine.js';

function resolveAiDiscovery(state, faction) {
  const pending = state.pendingDiscovery;
  if (!pending || pending.factionId !== faction.id) return;
  let choice = 'provisions';
  if (pending.kind === 'supply_cache') choice = faction.resources.materials < faction.resources.provisions ? 'materials' : 'provisions';
  if (pending.kind === 'pearl_archive') choice = 'knowledge';
  if (pending.kind === 'tide_beacon') choice = faction.research ? 'research' : 'provisions';
  resolveDiscovery(state, choice);
}

function chooseResearch(state, faction) {
  if (faction.research) return;
  const preferences = faction.id === 'coral'
    ? ['reinforced_keels', 'coordinated_escorts', 'star_charts', 'shell_masonry', 'long_range_ballistae', 'admiralty', 'tidal_mills', 'pearl_artisans', 'pharos_architecture']
    : ['star_charts', 'shell_masonry', 'tidal_mills', 'current_lore', 'pearl_artisans', 'reinforced_keels', 'pharos_architecture', 'swift_hulls'];
  const options = researchOptions(state, faction.id)
    .filter((tech) => tech.available && tech.affordable && !tech.completed)
    .sort((a, b) => {
      const ai = preferences.indexOf(a.id);
      const bi = preferences.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.cost - b.cost || a.id.localeCompare(b.id);
    });
  if (options[0]) startResearch(state, options[0].id);
}

function chooseProduction(state, faction, port) {
  if (port.queue.length >= 2) return;
  const buildings = port.buildings;
  const units = state.units.filter((unit) => unit.factionId === faction.id);
  const ports = state.ports.filter((item) => item.factionId === faction.id);
  let choice = null;
  if (!buildings.includes('pearl_academy') && !port.queue.some((item) => item.typeId === 'pearl_academy')) choice = ['building', 'pearl_academy'];
  else if (!buildings.includes('coral_shipyard') && faction.resources.materials < 14) choice = ['building', 'coral_shipyard'];
  else if (!buildings.includes('stilt_market') && faction.resources.provisions < 10) choice = ['building', 'stilt_market'];
  else if (faction.techs.includes('pharos_architecture') && !buildings.includes('great_lighthouse')) choice = ['building', 'great_lighthouse'];
  else if (ports.length < 4 && !units.some((unit) => unit.type === 'colonizer') && !port.queue.some((item) => item.typeId === 'colonizer')) choice = ['unit', 'colonizer'];
  else if (units.filter((unit) => unit.type === 'escort').length < ports.length + 1) choice = ['unit', 'escort'];
  else if (units.filter((unit) => unit.type === 'bomber').length < 2) choice = ['unit', 'bomber'];
  else if (!units.some((unit) => unit.type === 'scout')) choice = ['unit', 'scout'];
  if (choice) queueProduction(state, port.id, ...choice);
}

function bestAttack(state, unit) {
  const faction = state.factions.find((item) => item.id === unit.factionId);
  const candidates = [];
  for (const target of state.units) {
    if (target.factionId === unit.factionId || !faction.visible.includes(target.tileId)) continue;
    const preview = previewAttack(state, unit.id, 'unit', target.id);
    if (preview.ok) candidates.push({ kind: 'unit', id: target.id, preview });
  }
  for (const target of state.ports) {
    if (target.factionId === unit.factionId || !faction.visible.includes(target.tileId)) continue;
    const preview = previewAttack(state, unit.id, 'port', target.id);
    if (preview.ok) candidates.push({ kind: 'port', id: target.id, preview });
  }
  candidates.sort((a, b) => Number(b.preview.portCaptured) - Number(a.preview.portCaptured)
    || Number(b.preview.targetDestroyed) - Number(a.preview.targetDestroyed)
    || (b.preview.damage - b.preview.retaliation) - (a.preview.damage - a.preview.retaliation)
    || a.id.localeCompare(b.id));
  return candidates[0] || null;
}

function knownTargets(state, faction, unit) {
  const visibleEnemies = state.units.filter((target) => target.factionId !== faction.id && faction.visible.includes(target.tileId));
  const rememberedPorts = state.ports.filter((port) => port.factionId !== faction.id && faction.explored.includes(port.tileId));
  return [...visibleEnemies, ...rememberedPorts].sort((a, b) => distance(unit.tileId, a.tileId) - distance(unit.tileId, b.tileId) || a.id.localeCompare(b.id));
}

function moveMilitary(state, faction, unit) {
  const reachable = reachableForUnit(state, unit.id);
  if (!Object.keys(reachable).length) return;
  const targets = knownTargets(state, faction, unit);
  let destination = null;
  if (targets.length) {
    destination = Object.entries(reachable).sort((a, b) => {
      const da = Math.min(...targets.map((target) => distance(a[0], target.tileId)));
      const db = Math.min(...targets.map((target) => distance(b[0], target.tileId)));
      return da - db || b[1].cost - a[1].cost || a[0].localeCompare(b[0]);
    })[0][0];
  } else {
    destination = Object.entries(reachable).sort((a, b) => {
      const newA = tilesWithin(a[0], 2).filter((id) => !faction.explored.includes(id)).length;
      const newB = tilesWithin(b[0], 2).filter((id) => !faction.explored.includes(id)).length;
      return newB - newA || a[0].localeCompare(b[0]);
    })[0][0];
  }
  if (destination) moveUnit(state, unit.id, destination);
  if (state.pendingDiscovery) resolveAiDiscovery(state, faction);
}

function moveScout(state, faction, unit) {
  const reachable = reachableForUnit(state, unit.id);
  const destination = Object.entries(reachable).sort((a, b) => {
    const newA = tilesWithin(a[0], 3).filter((id) => !faction.explored.includes(id)).length;
    const newB = tilesWithin(b[0], 3).filter((id) => !faction.explored.includes(id)).length;
    const ruinsA = getTile(state, a[0])?.site && faction.explored.includes(a[0]) ? 4 : 0;
    const ruinsB = getTile(state, b[0])?.site && faction.explored.includes(b[0]) ? 4 : 0;
    return (newB + ruinsB) - (newA + ruinsA) || b[1].cost - a[1].cost || a[0].localeCompare(b[0]);
  })[0]?.[0];
  if (destination) moveUnit(state, unit.id, destination);
  if (state.pendingDiscovery) resolveAiDiscovery(state, faction);
}

function moveColonizer(state, faction, unit) {
  const reachable = reachableForUnit(state, unit.id);
  const ownPorts = state.ports.filter((port) => port.factionId === faction.id);
  const candidates = Object.entries(reachable).filter(([id]) => {
    if (!faction.explored.includes(id)) return false;
    const tile = getTile(state, id);
    return tile?.terrain === 'reef' && !getPortAt(state, id);
  });
  if (candidates.length) {
    candidates.sort((a, b) => {
      const resourcesA = tilesWithin(a[0], 1).filter((id) => faction.explored.includes(id) && getTile(state, id)?.resource).length;
      const resourcesB = tilesWithin(b[0], 1).filter((id) => faction.explored.includes(id) && getTile(state, id)?.resource).length;
      const distanceA = Math.min(...ownPorts.map((port) => distance(a[0], port.tileId)));
      const distanceB = Math.min(...ownPorts.map((port) => distance(b[0], port.tileId)));
      return resourcesB - resourcesA || distanceA - distanceB || a[1].cost - b[1].cost || a[0].localeCompare(b[0]);
    });
    moveUnit(state, unit.id, candidates[0][0]);
  } else {
    moveScout(state, faction, unit);
  }
  if (state.pendingDiscovery) resolveAiDiscovery(state, faction);
  foundPort(state, unit.id);
}

export function playAiFaction(state) {
  const faction = getCurrentFaction(state);
  if (faction.human || faction.defeated || state.winner) return [];
  const before = state.nextIds.log;
  resolveAiDiscovery(state, faction);
  chooseResearch(state, faction);
  for (const port of state.ports.filter((item) => item.factionId === faction.id)) {
    const desiredFocus = port.buildings.includes('pearl_academy') ? 'knowledge' : 'balanced';
    if (port.focus !== desiredFocus) setPortFocus(state, port.id, desiredFocus);
    chooseProduction(state, faction, port);
    chooseProduction(state, faction, port);
  }
  const unitIds = state.units.filter((unit) => unit.factionId === faction.id).map((unit) => unit.id);
  for (const unitId of unitIds) {
    if (state.winner) break;
    const unit = state.units.find((item) => item.id === unitId);
    if (!unit) continue;
    if (unit.type === 'colonizer') {
      foundPort(state, unit.id);
      if (!state.units.some((item) => item.id === unitId)) continue;
      moveColonizer(state, faction, unit);
      continue;
    }
    if (unit.hp < 5 && getPortAt(state, unit.tileId)?.factionId === faction.id) {
      repairUnit(state, unit.id);
      continue;
    }
    if (unit.type === 'scout') {
      const target = bestAttack(state, unit);
      if (target && target.preview.retaliation <= 1) attack(state, unit.id, target.kind, target.id);
      else moveScout(state, faction, unit);
      continue;
    }
    let target = bestAttack(state, unit);
    if (target) {
      attack(state, unit.id, target.kind, target.id);
      continue;
    }
    moveMilitary(state, faction, unit);
    if (state.winner || !state.units.some((item) => item.id === unitId)) continue;
    target = bestAttack(state, unit);
    if (target) attack(state, unit.id, target.kind, target.id);
  }
  resolveAiDiscovery(state, faction);
  return state.log.filter((entry) => entry.id >= before);
}

export function advanceToHuman(state, maximumTurns = 12) {
  let count = 0;
  while (!getCurrentFaction(state).human && !state.winner && count < maximumTurns) {
    playAiFaction(state);
    endTurn(state);
    count += 1;
  }
  return count;
}
