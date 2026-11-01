export const DIRECTIONS = Object.freeze([
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
]);

export const tileId = (q, r) => `${q},${r}`;
export const coords = (id) => id.split(',').map(Number);

export function neighbors(id) {
  const [q, r] = coords(id);
  return DIRECTIONS.map(([dq, dr]) => tileId(q + dq, r + dr));
}

export function distance(a, b) {
  const [aq, ar] = coords(a);
  const [bq, br] = coords(b);
  const dq = aq - bq;
  const dr = ar - br;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function tilesWithin(id, radius) {
  const [q, r] = coords(id);
  const result = [];
  for (let dq = -radius; dq <= radius; dq += 1) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr += 1) {
      result.push(tileId(q + dq, r + dr));
    }
  }
  return result;
}

export function hexToPixel(id, size = 48) {
  const [q, r] = coords(id);
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r
  };
}
