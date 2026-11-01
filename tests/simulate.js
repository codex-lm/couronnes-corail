import { playAiFaction } from '../src/core/ai.js';
import { endTurn, getCurrentFaction, incomeReport, scoreFaction } from '../src/core/engine.js';
import { makeState } from './helpers.js';

const state = makeState();
for (const faction of state.factions) faction.human = false;
const timeline = [];
let guard = 0;
while (!state.winner && guard < 121) {
  const faction = getCurrentFaction(state);
  const round = state.round;
  playAiFaction(state);
  const result = endTurn(state);
  if (round !== state.round || result.finished) {
    timeline.push({
      round,
      tide: state.tide,
      ports: Object.fromEntries(state.factions.map((item) => [item.id, state.ports.filter((port) => port.factionId === item.id).length])),
      units: Object.fromEntries(state.factions.map((item) => [item.id, state.units.filter((unit) => unit.factionId === item.id).length])),
      technologies: Object.fromEntries(state.factions.map((item) => [item.id, item.techs.length]))
    });
  }
  guard += 1;
  if (faction.defeated) break;
}

console.log(JSON.stringify({
  completed: guard < 121,
  factionTurns: guard,
  round: state.round,
  winner: state.winner,
  winReason: state.winReason,
  scores: state.factions.map((faction) => scoreFaction(state, faction.id)),
  finalIncome: state.factions.map((faction) => ({ factionId: faction.id, ...incomeReport(state, faction.id) })),
  timeline,
  recentEvents: state.log.slice(0, 20)
}, null, 2));

if (guard >= 121) process.exitCode = 1;
