import { loadGameData, validateGameData } from '../core/data.js';
import {
  attack, createGame, endTurn, foundPort, getCurrentFaction, getFaction,
  getPort, getPortAt, getTile, getUnit, getUnitAt, hydrateState, incomeReport,
  isPassable, movementCost, moveUnit, nextTideRound, portStats, previewAttack,
  productionOptions, queueProduction, cancelProduction, reachableForUnit,
  repairUnit, researchOptions, resolveDiscovery, scoreFaction, setPortFocus,
  startResearch, unitStats
} from '../core/engine.js';
import { playAiFaction } from '../core/ai.js';
import { clearLocal, loadLocal, loadSettings, saveLocal, saveSettings } from '../core/save.js';
import { I18n } from './i18n.js';
import { AudioEngine } from './audio.js';
import { MapRenderer } from './renderer.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const params = new URLSearchParams(location.search);
const autoplay = params.get('autoplay') === '1';
let data;
let state;
let settings = loadSettings();
let i18n;
let audio;
let renderer;
let selected = null;
let reachable = {};
let pendingAttack = null;
let busy = false;
let modalLocked = false;
let toastTimer;
let tideTimer;
let gameoverShown = false;

function t(key, values) { return i18n.t(key, values); }
function factionName(id) { return id === 'draw' ? t('ui.draw') : t(data.factions[id]?.nameKey || id); }
function definitionName(kind, id) { return t(data[kind][id]?.nameKey || id); }
function costHtml(cost) {
  return `<div class="cost">${['provisions', 'materials', 'knowledge'].filter((resource) => cost[resource]).map((resource) => `<span>${t(`ui.${resource}`)} <strong>${cost[resource]}</strong></span>`).join('')}</div>`;
}

function toast(message) {
  clearTimeout(toastTimer);
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
}

function openModal(html, locked = false) {
  modalLocked = locked;
  $('#modal-content').innerHTML = html;
  $('#modal-close').hidden = locked;
  if (!$('#modal').open) $('#modal').showModal();
  $('#modal').scrollTop = 0;
}

function closeModal(force = false) {
  if (modalLocked && !force) return;
  modalLocked = false;
  if ($('#modal').open) $('#modal').close();
}

function save() {
  if (autoplay || !state) return;
  saveLocal(state);
}

function select(kind, id) {
  selected = kind ? { kind, id } : null;
  reachable = selected?.kind === 'unit' && getUnit(state, selected.id)?.factionId === 'nacre' ? reachableForUnit(state, selected.id) : {};
  renderAll();
  $('#selection-panel').scrollTop = 0;
}

function renderAll() {
  if (!state) return;
  if (selected?.kind === 'unit' && !getUnit(state, selected.id)) selected = null;
  if (selected?.kind === 'port' && !getPort(state, selected.id)) selected = null;
  reachable = selected?.kind === 'unit' && getUnit(state, selected.id)?.factionId === getCurrentFaction(state).id ? reachableForUnit(state, selected.id) : {};
  renderer.setState(state, selected, reachable);
  i18n.apply();
  renderTopbar();
  renderTide();
  renderFactions();
  renderObjectives();
  renderSelection();
  renderChronicle();
  $('#end-turn').disabled = busy || state.winner || !getCurrentFaction(state).human || Boolean(state.pendingDiscovery);
  $('#end-turn').textContent = busy ? t('ui.aiTurn') : t('ui.endTurn');
}

function renderTopbar() {
  const human = getFaction(state, 'nacre');
  const report = incomeReport(state, 'nacre');
  $('#turn-label').textContent = t('ui.turn', { round: state.round });
  $('#resource-bar').innerHTML = ['provisions', 'materials', 'knowledge'].map((resource) => `
    <div class="resource-chip" title="${t(`ui.${resource}`)} · ${t('ui.upkeep', { value: report.upkeep })}">
      <span class="resource-icon ${resource}"></span>
      <span class="resource-value">${human.resources[resource]}</span>
      <span class="resource-net">${t('ui.net', { value: report.net[resource] })}</span>
    </div>`).join('');
  const research = human.research;
  $('#research-button').title = research ? `${definitionName('technologies', research.techId)} · ${t('ui.turnsLeft', { count: research.turnsLeft })}` : t('ui.noResearch');
}

function renderTide() {
  const phases = data.map.tidePhases;
  const nextRound = nextTideRound(state);
  const nextTide = phases[(phases.indexOf(state.tide) + 1) % phases.length];
  $('#tide-card').innerHTML = `
    <div class="tide-heading"><span class="tide-name">${t(`ui.tide.${state.tide}`)}</span><span class="tide-turn">${t('ui.turn', { round: state.round })}</span></div>
    <p class="tide-description">${t(`ui.tide.${state.tide}.desc`)}</p>
    <div class="tide-track">${phases.map((phase) => `<span class="tide-step ${phase === state.tide ? 'active' : ''}"></span>`).join('')}</div>
    <div class="tide-next">${t('ui.nextTide', { tide: t(`ui.tide.${nextTide}`), round: nextRound })}</div>`;
}

function renderFactions() {
  $('#faction-strip').innerHTML = state.factions.map((faction) => {
    const definition = data.factions[faction.id];
    const ports = state.ports.filter((port) => port.factionId === faction.id).length;
    return `<div class="faction-chip ${faction.id === getCurrentFaction(state).id ? 'active' : ''} ${faction.defeated ? 'defeated' : ''}" style="--faction:${definition.color}">
      <span class="faction-sail"></span><span class="faction-name">${factionName(faction.id)}</span><small>${ports}/4</small></div>`;
  }).join('');
}

function renderObjectives() {
  const ports = state.ports.filter((port) => port.factionId === 'nacre');
  const lighthouses = ports.filter((port) => port.buildings.includes('great_lighthouse')).length;
  const capitals = state.ports.filter((port) => port.factionId === 'nacre' && port.capitalOf && port.capitalOf !== 'nacre').length;
  $('#objectives').innerHTML = `<h3>${t('ui.objective')}</h3>
    <div class="objective-line"><span>${t('ui.lighthousePath')}</span><strong>${lighthouses}/3</strong></div><div class="objective-meter"><span style="width:${lighthouses / 3 * 100}%"></span></div>
    <div class="objective-line"><span>${t('ui.capitalPath')}</span><strong>${capitals}/2</strong></div><div class="objective-meter"><span style="width:${capitals / 2 * 100}%"></span></div>
    <div class="objective-line"><span>${t('ui.portCount', { count: ports.length })}</span><strong>${ports.reduce((sum, port) => sum + port.queue.length, 0)} ◆</strong></div>`;
}

function statGrid(stats, extra = {}) {
  const entries = [
    ['hp', extra.hp ?? stats.maxHp, stats.maxHp],
    ['movement', extra.movement ?? stats.move, ''],
    ['vision', stats.vision ?? 2, ''],
    ['attack', stats.attack, ''],
    ['range', stats.range, ''],
    ['armor', stats.armor, '']
  ];
  return `<div class="stat-grid">${entries.map(([label, value, max]) => `<div class="stat"><strong>${value}${max ? `/${max}` : ''}</strong><small>${t(`ui.${label}`)}</small></div>`).join('')}</div>`;
}

function renderSelection() {
  const panel = $('#selection-panel');
  if (!selected) {
    const humanPorts = state.ports.filter((port) => port.factionId === 'nacre');
    panel.innerHTML = `<p class="selection-kicker">${t('map.reference')}</p><h2 class="selection-title">${t('ui.objective')}</h2>
      <p class="selection-description">${t('ui.help.turns.body')}</p>
      <div class="section-heading"><h3>${t('ui.ports')}</h3><small>${humanPorts.length}/4</small></div>
      <div class="action-stack">${humanPorts.map((port) => `<button class="button secondary" data-select-port="${port.id}">${port.capitalOf ? `${t('ui.capital')} · ` : ''}${port.tileId}</button>`).join('')}</div>`;
    return;
  }
  if (selected.kind === 'unit') return renderUnitSelection(panel, getUnit(state, selected.id));
  if (selected.kind === 'port') return renderPortSelection(panel, getPort(state, selected.id));
  return renderTileSelection(panel, getTile(state, selected.id));
}

function renderUnitSelection(panel, unit) {
  if (!unit) return select(null);
  const definition = data.units[unit.type];
  const stats = unitStats(state, unit);
  const own = unit.factionId === 'nacre';
  panel.innerHTML = `<p class="selection-kicker">${factionName(unit.factionId)}</p><h2 class="selection-title">${t(definition.nameKey)}</h2>
    <p class="selection-description">${t(definition.descriptionKey)}</p>
    <div class="health-track"><span style="width:${unit.hp / stats.maxHp * 100}%"></span></div>
    ${statGrid(stats, { hp: unit.hp, movement: unit.remainingMp })}
    <div class="tag-list"><span class="tag">${t('ui.upkeepShort')} ${stats.upkeep}</span><span class="tag">${unit.tileId}</span>${unit.supplied === false ? `<span class="tag">${t('log.shortage')}</span>` : ''}</div>
    <div class="action-stack">${own ? `<button class="button secondary" data-found="${unit.id}" ${unit.type !== 'colonizer' || unit.hasActed ? 'disabled' : ''}>${t('ui.foundPort')}</button>
      <button class="button secondary" data-repair="${unit.id}" ${unit.hasActed || unit.hp >= stats.maxHp ? 'disabled' : ''}>${t('ui.repair')}</button><small class="selection-description">${t('ui.repairCost')}</small>` : ''}</div>`;
}

function renderPortSelection(panel, port) {
  if (!port) return select(null);
  const own = port.factionId === 'nacre';
  const stats = portStats(state, port);
  const terrain = data.terrain[getTile(state, port.tileId).terrain];
  let html = `<p class="selection-kicker">${factionName(port.factionId)}${port.capitalOf ? ` · ${t('ui.capital')}` : ''}</p><h2 class="selection-title">${t(terrain.nameKey)} · ${port.tileId}</h2>
    <p class="selection-description">${t(terrain.descriptionKey)}</p><div class="health-track"><span style="width:${port.hp / port.maxHp * 100}%"></span></div>
    ${statGrid({ ...stats, maxHp: port.maxHp, move: 0 }, { hp: port.hp, movement: 0 })}`;
  if (!own) {
    panel.innerHTML = `${html}<div class="tag-list"><span class="tag">${t('ui.buildings')}: ${port.buildings.length}</span></div>`;
    return;
  }
  html += `<div class="section-heading"><h3>${t('ui.focus')}</h3></div><div class="focus-grid">${['balanced', 'provisions', 'materials', 'knowledge'].map((focus) => `<button class="button ${port.focus === focus ? 'active' : ''}" data-focus="${focus}" data-port="${port.id}">${t(`ui.focus.${focus}`)}</button>`).join('')}</div>`;
  html += `<div class="section-heading"><h3>${t('ui.worked')}</h3><small>${port.worked.length}/2</small></div><div class="tag-list">${port.worked.length ? port.worked.map((id) => {
    const tile = getTile(state, id);
    return `<span class="tag">${t(`ui.${tile.resource}`)} +${tile.yield} · ${id}</span>`;
  }).join('') : `<span class="tag">${t('terrain.reef')}</span>`}</div>`;
  if (port.buildings.length) html += `<div class="section-heading"><h3>${t('ui.buildings')}</h3><small>${port.buildings.length}</small></div><div class="tag-list">${port.buildings.map((id) => `<span class="tag" title="${t(data.buildings[id].descriptionKey)}">${definitionName('buildings', id)}</span>`).join('')}</div>`;
  html += `<div class="section-heading"><h3>${t('ui.production')}</h3><small>${t('ui.queue', { count: port.queue.length })}</small></div>`;
  if (port.queue.length) {
    html += port.queue.map((item, index) => `<div class="queue-item"><div class="queue-top"><strong>${definitionName(item.kind === 'unit' ? 'units' : 'buildings', item.typeId)}</strong><small>${item.turnsLeft <= 0 ? t('ui.waitingSpace') : t('ui.turnsLeft', { count: item.turnsLeft })}</small></div>
      <div class="progress"><span style="width:${Math.max(0, (item.totalTurns - item.turnsLeft) / item.totalTurns * 100)}%"></span></div><button class="button ghost" data-cancel-queue="${index}" data-port="${port.id}">${t('ui.cancel')} · 75%</button></div>`).join('');
  } else html += `<p class="selection-description">${t('ui.emptyQueue')}</p>`;
  const options = productionOptions(state, port.id);
  html += `<div class="section-heading"><h3>${t('ui.production')}</h3><small>${options.length}</small></div>`;
  html += options.map(({ kind, definition, affordable, queued }) => `<div class="production-item ${!affordable ? 'locked' : ''}"><div><div class="production-top"><strong>${t(definition.nameKey)}</strong><small>${t('ui.turnsLeft', { count: definition.buildTurns })}</small></div>
    <p>${t(definition.descriptionKey)}</p>${costHtml(definition.cost)}</div><button class="button secondary" data-queue-kind="${kind}" data-queue-id="${definition.id}" data-port="${port.id}" ${!affordable || queued || port.queue.length >= 2 || busy ? 'disabled' : ''}>+</button></div>`).join('');
  panel.innerHTML = html;
}

function renderTileSelection(panel, tile) {
  const human = getFaction(state, 'nacre');
  if (!tile || !human.explored.includes(tile.id)) {
    panel.innerHTML = `<p class="selection-description">${t('ui.noSelection')}</p>`;
    return;
  }
  const terrain = data.terrain[tile.terrain];
  panel.innerHTML = `<p class="selection-kicker">${tile.id}</p><h2 class="selection-title">${t(terrain.nameKey)}</h2><p class="selection-description">${t(terrain.descriptionKey)}</p>
    <div class="tag-list"><span class="tag">${t(`ui.tide.${state.tide}`)}</span><span class="tag">${isPassable(state, tile) ? `↝ ${movementCost(state, tile, 'nacre')}` : '×'}</span>${tile.resource ? `<span class="tag">${t(`ui.${tile.resource}`)} +${tile.yield}</span>` : ''}${tile.site ? `<span class="tag">${t(tile.site)}</span>` : ''}</div>`;
}

function renderChronicle() {
  const visibleLogs = state.log.filter((entry) => !entry.factionId || entry.factionId === 'nacre' || entry.type === 'defeat').slice(0, 35);
  $('#chronicle-panel').innerHTML = visibleLogs.map((entry) => `<div class="log-entry"><small>${t('ui.turn', { round: entry.round })}</small>${t(entry.textKey, entry.params)}</div>`).join('');
}

function onTile(tileId) {
  if (!state || busy || state.winner || state.pendingDiscovery || !getCurrentFaction(state).human || modalLocked) return;
  const unit = getUnitAt(state, tileId);
  const port = getPortAt(state, tileId);
  const human = getFaction(state, 'nacre');
  if (selected?.kind === 'unit' && unit && unit.factionId !== 'nacre' && human.visible.includes(tileId)) {
    return showAttack(selected.id, 'unit', unit.id);
  }
  if (selected?.kind === 'unit' && port && port.factionId !== 'nacre' && human.visible.includes(tileId)) {
    return showAttack(selected.id, 'port', port.id);
  }
  if (unit?.factionId === 'nacre') return select('unit', unit.id);
  if (selected?.kind === 'unit' && reachable[tileId]) {
    const moving = getUnit(state, selected.id);
    const from = moving.tileId;
    const result = moveUnitWithRules(selected.id, tileId);
    if (!result.ok) return toast(t(`error.${result.error}`));
    audio.play('sail');
    renderer.animateMove(selected.id, from, tileId);
    afterAction();
    return;
  }
  if (port) return select('port', port.id);
  if (unit) return select('unit', unit.id);
  select('tile', tileId);
}

function moveUnitWithRules(unitId, tileId) {
  return moveUnit(state, unitId, tileId);
}

function afterAction() {
  save();
  renderAll();
  if (state.pendingDiscovery && !$('#modal').open) showDiscovery();
  if (state.winner && !gameoverShown) showGameover();
}

function showAttack(attackerId, targetKind, targetId) {
  const preview = previewAttack(state, attackerId, targetKind, targetId);
  if (!preview.ok) return toast(t(`error.${preview.error}`));
  pendingAttack = preview;
  const attacker = getUnit(state, attackerId);
  const target = targetKind === 'unit' ? getUnit(state, targetId) : getPort(state, targetId);
  const targetName = targetKind === 'unit' ? definitionName('units', target.type) : `${t('ui.ports')} · ${target.tileId}`;
  const risk = preview.portCaptured ? t('ui.capture') : preview.targetDestroyed ? t('ui.lethal') : preview.attackerDestroyed ? t('ui.attackerRisk') : '';
  openModal(`<h2>${t('ui.confirmAttack')}</h2><p class="modal-intro">${definitionName('units', attacker.type)} → ${targetName}</p>
    <div class="forecast"><div class="forecast-card"><strong>−${preview.damage}</strong>${t('ui.damageForecast')} · ${preview.targetHpAfter} HP</div>
    <div class="forecast-card retaliation"><strong>${preview.retaliation ? `−${preview.retaliation}` : '0'}</strong>${preview.retaliation ? `${t('ui.retaliation')} · ${preview.attackerHpAfter} HP` : t('ui.noRetaliation')}</div></div>
    ${risk ? `<p class="risk-note">${risk}</p>` : ''}<div class="action-stack"><button class="button primary large" data-confirm-attack>${t('ui.attackNow')}</button><button class="button ghost" data-close-modal>${t('ui.cancel')}</button></div>`);
}

function confirmAttack() {
  if (!pendingAttack) return;
  const { attackerId, targetKind, targetId } = pendingAttack;
  const target = targetKind === 'unit' ? getUnit(state, targetId) : getPort(state, targetId);
  const tileId = target.tileId;
  const result = attack(state, attackerId, targetKind, targetId);
  pendingAttack = null;
  closeModal(true);
  if (!result.ok) return toast(t(`error.${result.error}`));
  audio.play('impact');
  renderer.animateImpact(tileId);
  afterAction();
}

function showDiscovery() {
  const pending = state.pendingDiscovery;
  if (!pending || pending.factionId !== 'nacre') return;
  const choices = {
    supply_cache: ['provisions', 'materials'],
    pearl_archive: ['knowledge', 'reveal'],
    tide_beacon: ['research', 'provisions']
  }[pending.kind];
  const art = pending.kind === 'pearl_archive' ? 'archive' : pending.kind === 'supply_cache' ? 'cache' : 'beacon';
  audio.play('discovery');
  openModal(`<p class="selection-kicker">${t('ui.discovery')} · ${pending.tileId}</p><h2>${t(pending.kind)}</h2><p class="modal-intro">${t(`${pending.kind}.desc`)}</p>
    <div class="discovery-art"><img src="assets/sprites/ruin-${art}.png" alt=""></div><p>${t('ui.chooseReward')}</p>
    <div class="discovery-choices">${choices.map((choice) => `<button class="button secondary" data-discovery-choice="${choice}">${t(`ui.choice.${choice}`)}</button>`).join('')}</div>`, true);
}

function chooseDiscovery(choice) {
  const result = resolveDiscovery(state, choice);
  if (!result.ok) return toast(t(`error.${result.error}`));
  closeModal(true);
  audio.play('build');
  afterAction();
}

function showResearch() {
  if (!state) return;
  const faction = getFaction(state, 'nacre');
  const current = faction.research;
  const options = researchOptions(state, 'nacre');
  let html = `<h2>${t('ui.research')}</h2><p class="modal-intro">${t('ui.noResearch')}</p>`;
  if (current) {
    const tech = data.technologies[current.techId];
    html += `<div class="research-status"><strong>${t('ui.researching')} · ${t(tech.nameKey)}</strong><div class="progress"><span style="width:${(current.totalTurns - current.turnsLeft) / current.totalTurns * 100}%"></span></div><small>${t('ui.turnsLeft', { count: current.turnsLeft })}</small></div>`;
  }
  html += `<div class="tech-branches">${['navigation', 'economy', 'fleet'].map((branch) => `<section class="tech-branch"><h3>${t(`ui.${branch}`)}</h3>${options.filter((tech) => tech.branch === branch).map((tech) => {
    const disabled = !tech.available || !tech.affordable || tech.completed || current || busy;
    const prerequisites = tech.prerequisites.length ? `<p>${t('ui.prerequisites')}: ${tech.prerequisites.map((id) => definitionName('technologies', id)).join(', ')}</p>` : '';
    return `<article class="tech-node ${tech.completed ? 'completed' : !tech.available ? 'locked' : ''}"><h4>${t(tech.nameKey)}</h4><p>${t(tech.descriptionKey)}</p>${prerequisites}<div class="cost"><span>${t('ui.knowledge')} ${tech.cost}</span><span>${t('ui.turnsLeft', { count: tech.turns })}</span></div>
      <button class="button ${tech.completed ? 'ghost' : 'secondary'}" data-research="${tech.id}" ${disabled ? 'disabled' : ''}>${tech.completed ? t('ui.completed') : t('ui.researchNow')}</button></article>`;
  }).join('')}</section>`).join('')}</div>`;
  openModal(html);
}

function chooseResearch(techId) {
  const result = startResearch(state, techId);
  if (!result.ok) return toast(t(`error.${result.error}`));
  audio.play('click');
  closeModal(true);
  afterAction();
}

function showHelp() {
  const sections = ['goal', 'turns', 'tides', 'economy', 'combat', 'ruins', 'controls'];
  openModal(`<h2>${t('ui.help')}</h2><p class="modal-intro">${t('ui.tagline')}</p><div class="help-grid">${sections.map((section) => `<section class="help-section"><h3>${t(`ui.help.${section}.title`)}</h3><p>${t(`ui.help.${section}.body`)}</p></section>`).join('')}</div>`);
}

function showGameover() {
  gameoverShown = true;
  const humanWon = state.winner === 'nacre';
  const scores = state.finalScores || state.factions.map((faction) => scoreFaction(state, faction.id)).sort((a, b) => b.total - a.total);
  const heading = humanWon ? t('ui.victory') : state.winner === 'draw' ? t('ui.draw') : ['human-eliminated', 'elimination'].includes(state.winReason) ? t('ui.defeat') : t('ui.winner', { faction: factionName(state.winner) });
  audio.play(humanWon ? 'victory' : 'impact');
  openModal(`<p class="selection-kicker">${t('ui.turn', { round: state.round })}</p><h2>${heading}</h2>
    <p class="modal-intro">${state.winner === 'draw' ? t('ui.draw') : t('ui.winner', { faction: factionName(state.winner) })} ${t(`ui.reason.${state.winReason}`)}</p>
    <h3>${t('ui.score')}</h3>${scores.map((score) => `<article class="score-card"><header><strong>${factionName(score.factionId)}</strong><strong>${score.total}</strong></header><div class="score-components">${Object.entries(score.components).map(([key, value]) => `<span>${t(`ui.score.${key}`)} · <strong>${value}</strong></span>`).join('')}</div></article>`).join('')}
    <button class="button primary large" data-confirm-new>${t('ui.playAgain')}</button>`, true);
  document.body.dataset.gameover = 'true';
}

function showTideBanner() {
  clearTimeout(tideTimer);
  const banner = $('#tide-banner');
  banner.textContent = `${t('ui.currentTide', { tide: t(`ui.tide.${state.tide}`) })} · ${t('ui.turn', { round: state.round })}`;
  banner.hidden = false;
  banner.style.animation = 'none';
  void banner.offsetWidth;
  banner.style.animation = '';
  audio.play('tide');
  tideTimer = setTimeout(() => { banner.hidden = true; }, 2300);
}

async function finishHumanTurn() {
  if (busy || state.winner) return;
  const oldTide = state.tide;
  const result = endTurn(state);
  if (!result.ok) {
    if (state.pendingDiscovery) showDiscovery();
    else toast(t(`error.${result.error}`));
    return;
  }
  busy = true;
  selected = null;
  renderAll();
  await runAiTurns(oldTide);
}

async function runAiTurns(oldTide = state.tide) {
  busy = true;
  while (!state.winner && !getCurrentFaction(state).human) {
    await wait(autoplay ? 30 : 420);
    playAiFaction(state);
    endTurn(state);
    renderAll();
  }
  busy = false;
  save();
  renderAll();
  if (state.tide !== oldTide) showTideBanner();
  if (state.winner && !gameoverShown) showGameover();
}

async function runAutoplay() {
  busy = true;
  for (const faction of state.factions) faction.human = false;
  let guard = 0;
  while (!state.winner && guard < 121) {
    playAiFaction(state);
    endTurn(state);
    renderAll();
    guard += 1;
    await wait(45);
  }
  busy = false;
  renderAll();
  if (state.winner && !gameoverShown) showGameover();
}

function startGame() {
  $('#menu-screen').hidden = true;
  $('#game').hidden = false;
  document.body.dataset.gameover = 'false';
  gameoverShown = false;
  renderer.fitted = false;
  renderer.resize();
  selected = null;
  renderAll();
  if (!getCurrentFaction(state).human && !state.winner) runAiTurns();
  if (state.pendingDiscovery) showDiscovery();
  if (state.winner) showGameover();
}

function newGame() {
  closeModal(true);
  if (!autoplay) clearLocal();
  state = createGame(data);
  selected = { kind: 'port', id: state.ports.find((port) => port.factionId === 'nacre').id };
  startGame();
  save();
  audio.play('sail');
  if (autoplay) runAutoplay();
}

function confirmNewGame() {
  if (!state || !$('#menu-screen').hidden || state.winner) return newGame();
  openModal(`<h2>${t('ui.newGame')}</h2><p class="modal-intro">${t('ui.newGameConfirm')}</p><div class="action-stack"><button class="button primary" data-confirm-new>${t('ui.newGame')}</button><button class="button ghost" data-close-modal>${t('ui.cancel')}</button></div>`);
}

function continueGame() {
  try {
    const saved = loadLocal();
    if (!saved) return;
    state = hydrateState(saved, data);
    startGame();
  } catch {
    clearLocal();
    toast(t('error.invalidChoice'));
    $('#continue-game').hidden = true;
  }
}

function showMainMenu() {
  closeModal(true);
  save();
  $('#game').hidden = true;
  $('#menu-screen').hidden = false;
  $('#continue-game').hidden = !loadLocal();
}

function changeLanguage(language) {
  settings.language = language;
  i18n.setLanguage(language);
  saveSettings(settings);
  $$('.language-select').forEach((select) => { select.value = language; });
  if (state) renderAll();
  else i18n.apply();
  if ($('#modal').open && !modalLocked) showHelp();
}

function toggleSound() {
  settings.sound = !settings.sound;
  audio.setEnabled(settings.sound);
  saveSettings(settings);
  $$('.sound-toggle').forEach((button) => { button.textContent = settings.sound ? '◖))' : '◖×'; button.setAttribute('aria-pressed', String(settings.sound)); });
  if (settings.sound) audio.play('click');
}

function bindEvents() {
  window.addEventListener('error', (event) => toast(`Game error: ${event.message}`));
  window.addEventListener('unhandledrejection', (event) => toast(`Game error: ${event.reason?.message || event.reason}`));
  $('#continue-game').addEventListener('click', continueGame);
  $('#menu-help').addEventListener('click', showHelp);
  $('#help-button').addEventListener('click', showHelp);
  $('#research-button').addEventListener('click', showResearch);
  $('#end-turn').addEventListener('click', finishHumanTurn);
  $('#menu-button').addEventListener('click', () => openModal(`<h2>${t('ui.title')}</h2><div class="action-stack"><button class="button secondary" data-close-modal>${t('ui.close')}</button><button class="button secondary" data-main-menu>${t('ui.continue')}</button><button class="button primary" data-confirm-new-prompt>${t('ui.newGame')}</button></div>`));
  $('#modal-close').addEventListener('click', () => closeModal());
  $('#modal').addEventListener('cancel', (event) => { if (modalLocked) event.preventDefault(); });
  $('#zoom-in').addEventListener('click', () => renderer.zoomBy(1.18));
  $('#zoom-out').addEventListener('click', () => renderer.zoomBy(0.85));
  $('#center-map').addEventListener('click', () => { renderer.fitted = false; renderer.fit(); });
  $$('.language-select').forEach((select) => select.addEventListener('change', (event) => changeLanguage(event.target.value)));
  $$('.sound-toggle').forEach((button) => button.addEventListener('click', toggleSound));
  $$('.tab').forEach((button) => button.addEventListener('click', () => {
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    $('#selection-panel').hidden = button.dataset.tab !== 'selection';
    $('#chronicle-panel').hidden = button.dataset.tab !== 'chronicle';
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-close-modal')) closeModal();
    if (button.hasAttribute('data-confirm-attack')) confirmAttack();
    if (button.hasAttribute('data-confirm-new')) newGame();
    if (button.hasAttribute('data-confirm-new-prompt')) confirmNewGame();
    if (button.hasAttribute('data-main-menu')) showMainMenu();
    if (button.dataset.selectPort) select('port', button.dataset.selectPort);
    if (button.dataset.found) {
      const result = foundPort(state, button.dataset.found);
      if (!result.ok) toast(t(`error.${result.error}`));
      else { audio.play('build'); renderer.animateConstruction(result.port.tileId); select('port', result.port.id); afterAction(); }
    }
    if (button.dataset.repair) {
      const result = repairUnit(state, button.dataset.repair);
      if (!result.ok) toast(t(`error.${result.error}`));
      else { audio.play('build'); afterAction(); }
    }
    if (button.dataset.focus) {
      const result = setPortFocus(state, button.dataset.port, button.dataset.focus);
      if (!result.ok) toast(t(`error.${result.error}`));
      else afterAction();
    }
    if (button.dataset.queueKind) {
      const result = queueProduction(state, button.dataset.port, button.dataset.queueKind, button.dataset.queueId);
      if (!result.ok) toast(t(`error.${result.error}`));
      else { audio.play('click'); afterAction(); }
    }
    if (button.dataset.cancelQueue !== undefined) {
      const result = cancelProduction(state, button.dataset.port, Number(button.dataset.cancelQueue));
      if (!result.ok) toast(t(`error.${result.error}`));
      else afterAction();
    }
    if (button.dataset.research) chooseResearch(button.dataset.research);
    if (button.dataset.discoveryChoice) chooseDiscovery(button.dataset.discoveryChoice);
  });
}

async function init() {
  data = await loadGameData();
  const errors = validateGameData(data);
  if (errors.length) throw new Error(errors.join('\n'));
  i18n = new I18n(data.locales, settings.language);
  audio = new AudioEngine(settings.sound);
  $$('.language-select').forEach((select) => { select.value = settings.language; });
  $$('.sound-toggle').forEach((button) => { button.textContent = settings.sound ? '◖))' : '◖×'; });
  i18n.apply();
  renderer = new MapRenderer($('#map'), data, onTile);
  bindEvents();
  const saved = loadLocal();
  $('#continue-game').hidden = !saved;
  if (autoplay) newGame();
  window.Couronnes = Object.freeze({
    getState: () => state,
    getData: () => data,
    newGame,
    continueGame,
    endTurn: finishHumanTurn,
    selectTile: onTile,
    getRenderer: () => renderer
  });
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main style="padding:40px;color:#f3ead7;background:#09172b;min-height:100vh"><h1>Crowns of Coral</h1><p>Unable to load the local game data.</p><pre>${String(error.message)}</pre></main>`;
});
