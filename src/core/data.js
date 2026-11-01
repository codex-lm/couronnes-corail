const FILES = ['terrain', 'units', 'buildings', 'technologies', 'factions', 'map-reference', 'locales'];

export async function loadGameData(base = './data/') {
  const entries = await Promise.all(FILES.map(async (name) => {
    const response = await fetch(`${base}${name}.json`);
    if (!response.ok) throw new Error(`Unable to load ${name}.json (${response.status})`);
    return [name, await response.json()];
  }));
  const raw = Object.fromEntries(entries);
  return {
    terrain: byId(raw.terrain),
    units: byId(raw.units),
    buildings: byId(raw.buildings),
    technologies: byId(raw.technologies),
    factions: byId(raw.factions),
    map: raw['map-reference'],
    locales: raw.locales
  };
}

export function byId(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export function validateGameData(data) {
  const errors = [];
  for (const key of ['terrain', 'units', 'buildings', 'technologies', 'factions']) {
    if (!data[key] || !Object.keys(data[key]).length) errors.push(`Missing ${key}`);
  }
  const { map } = data;
  if (!map || map.rows.length !== map.height) errors.push('Map height mismatch');
  map?.rows.forEach((row, index) => {
    if ([...row].length !== map.width) errors.push(`Map row ${index} has ${[...row].length} cells, expected ${map.width}`);
    for (const token of row) if (!map.tokens[token]) errors.push(`Unknown map token ${token}`);
  });
  for (const start of map?.starts || []) {
    if (!data.factions[start.factionId]) errors.push(`Unknown starting faction ${start.factionId}`);
    for (const key of ['capital', 'scout', 'colonizer']) {
      const { q, r } = start[key];
      if (q < 0 || r < 0 || q >= map.width || r >= map.height) errors.push(`${start.factionId} ${key} outside map`);
    }
    const capitalToken = map.rows[start.capital.r][start.capital.q];
    if (!map.tokens[capitalToken] || map.tokens[capitalToken].terrain !== 'reef') errors.push(`${start.factionId} capital is not on a reef`);
  }
  for (const tech of Object.values(data.technologies || {})) {
    for (const prerequisite of tech.prerequisites) {
      if (!data.technologies[prerequisite]) errors.push(`${tech.id}: unknown prerequisite ${prerequisite}`);
    }
  }
  for (const building of Object.values(data.buildings || {})) {
    if (building.requiresTech && !data.technologies[building.requiresTech]) errors.push(`${building.id}: unknown technology`);
  }
  return errors;
}
