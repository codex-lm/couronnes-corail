import { hexToPixel } from '../core/hex.js';
import { getFaction, getPortAt, getTile, getUnitAt, isPassable, movementCost, portStats, unitStats } from '../core/engine.js';

const TAU = Math.PI * 2;
const RESOURCE_COLORS = { provisions: '#ef8172', materials: '#dfbd7e', knowledge: '#80d2d2' };

export class MapRenderer {
  constructor(canvas, data, onTile) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.data = data;
    this.onTile = onTile;
    this.size = 54;
    this.zoom = 1;
    this.camera = { x: 0, y: 0 };
    this.state = null;
    this.selection = null;
    this.reachable = {};
    this.animations = new Map();
    this.impacts = [];
    this.pointers = new Map();
    this.images = new Map();
    this.ready = this.loadImages();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.bindInput();
    this.resize();
    requestAnimationFrame((time) => this.draw(time));
  }

  loadImages() {
    const names = ['port', 'great-lighthouse', 'reef-01', 'reef-02', 'reef-03', 'reef-04', 'reef-05', 'reef-06',
      'ruin-archive', 'ruin-cache', 'ruin-beacon', 'market', 'shipyard', 'academy', 'bastion', 'drydock'];
    for (const unit of ['scout', 'colonizer', 'escort', 'bomber']) {
      for (const faction of ['nacre', 'coral', 'outremer']) names.push(`${unit}-${faction}`);
    }
    return Promise.all(names.map((name) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => { this.images.set(name, image); resolve(); };
      image.onerror = () => resolve();
      image.src = `assets/sprites/${name}.png`;
    })));
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (!this.fitted && this.state) this.fit();
  }

  setState(state, selection = null, reachable = {}) {
    this.state = state;
    this.selection = selection;
    this.reachable = reachable;
    if (!this.fitted) this.fit();
  }

  fit() {
    if (!this.state || !this.width || !this.height) return;
    const points = this.state.tiles.map((tile) => hexToPixel(tile.id, this.size));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y * 0.72));
    const maxY = Math.max(...points.map((point) => point.y * 0.72));
    this.camera.x = (minX + maxX) / 2;
    this.camera.y = (minY + maxY) / 2;
    this.zoom = Math.max(0.24, Math.min(1.1, (this.width - 56) / (maxX - minX + this.size * 2.2), (this.height - 52) / (maxY - minY + this.size * 1.9)));
    this.fitted = true;
  }

  centerOn(tileId) {
    const point = hexToPixel(tileId, this.size);
    this.camera.x = point.x;
    this.camera.y = point.y * 0.72;
  }

  zoomBy(factor, x = this.width / 2, y = this.height / 2) {
    const before = this.unproject(x, y);
    this.zoom = Math.max(0.22, Math.min(1.8, this.zoom * factor));
    const after = this.unproject(x, y);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  project(tileId) {
    const point = hexToPixel(tileId, this.size);
    return { x: (point.x - this.camera.x) * this.zoom + this.width / 2, y: (point.y * 0.72 - this.camera.y) * this.zoom + this.height / 2 };
  }

  unproject(x, y) {
    return { x: (x - this.width / 2) / this.zoom + this.camera.x, y: (y - this.height / 2) / this.zoom + this.camera.y };
  }

  hitTile(x, y) {
    if (!this.state) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const tile of this.state.tiles) {
      const point = this.project(tile.id);
      const dx = x - point.x;
      const dy = (y - point.y) / 0.72;
      const d = dx * dx + dy * dy;
      if (d < bestDistance) { bestDistance = d; best = tile.id; }
    }
    return bestDistance <= (this.size * this.zoom) ** 2 ? best : null;
  }

  bindInput() {
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
      this.dragged = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      const previous = { x: pointer.x, y: pointer.y };
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 7) this.dragged = true;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0) {
          const rect = this.canvas.getBoundingClientRect();
          this.zoomBy(distance / this.pinchDistance, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        this.pinchDistance = distance;
      } else if (this.dragged) {
        this.camera.x -= (pointer.x - previous.x) / this.zoom;
        this.camera.y -= (pointer.y - previous.y) / this.zoom;
      }
    });
    const release = (event) => {
      const pointer = this.pointers.get(event.pointerId);
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(event.pointerId);
      if (pointer && wasSingle && !this.dragged) {
        const rect = this.canvas.getBoundingClientRect();
        const tile = this.hitTile(event.clientX - rect.left, event.clientY - rect.top);
        if (tile) this.onTile(tile);
      }
      if (this.pointers.size < 2) this.pinchDistance = 0;
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', (event) => this.pointers.delete(event.pointerId));
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomBy(event.deltaY > 0 ? 0.90 : 1.10, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
  }

  animateMove(unitId, from, to) {
    this.animations.set(unitId, { from, to, start: performance.now(), duration: 380 });
  }

  animateImpact(tileId) {
    this.impacts.push({ tileId, start: performance.now(), kind: 'impact' });
  }

  animateConstruction(tileId) {
    this.impacts.push({ tileId, start: performance.now(), kind: 'construction' });
  }

  hexPath(tileId, scale = 1) {
    const center = this.project(tileId);
    const path = new Path2D();
    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI / 180 * (60 * index - 30);
      const x = center.x + Math.cos(angle) * this.size * this.zoom * scale;
      const y = center.y + Math.sin(angle) * this.size * this.zoom * 0.72 * scale;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  factionColor(factionId) {
    return this.data.factions[factionId]?.color || '#f3ead7';
  }

  drawResource(resource, x, y, size) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = RESOURCE_COLORS[resource];
    ctx.fillStyle = RESOURCE_COLORS[resource];
    ctx.lineWidth = Math.max(1, size * 0.12);
    if (resource === 'knowledge') {
      ctx.beginPath(); ctx.arc(0, 0, size * 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-size * 0.18, -size * 0.18, size * 0.16, 0, TAU); ctx.fillStyle = '#f3ead7'; ctx.fill();
    } else if (resource === 'materials') {
      ctx.rotate(Math.PI / 4); ctx.strokeRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      ctx.strokeRect(-size * 0.20, -size * 0.20, size * 0.4, size * 0.4);
    } else {
      ctx.beginPath(); ctx.ellipse(0, 0, size * 0.45, size * 0.65, -0.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#15304d'; ctx.beginPath(); ctx.moveTo(-size * 0.2, size * 0.45); ctx.lineTo(size * 0.2, -size * 0.45); ctx.stroke();
    }
    ctx.restore();
  }

  drawTileBase(tile, time, human) {
    const ctx = this.context;
    const explored = human.explored.includes(tile.id);
    const visible = human.visible.includes(tile.id);
    const path = this.hexPath(tile.id, 0.97);
    if (!explored) {
      ctx.fillStyle = '#0a1a30';
      ctx.fill(path);
      ctx.strokeStyle = 'rgba(73,104,139,.15)';
      ctx.lineWidth = 1;
      ctx.stroke(path);
      const point = this.project(tile.id);
      ctx.fillStyle = 'rgba(117,154,181,.18)';
      ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1, this.zoom * 2), 0, TAU); ctx.fill();
      return;
    }
    const colors = { ocean: '#174c73', current: '#1d6386', reef: '#3c7182', shoal: '#3d7187', ruins: '#285673', rocks: '#233b56' };
    ctx.fillStyle = colors[tile.terrain] || '#174c73';
    ctx.fill(path);
    ctx.strokeStyle = visible ? 'rgba(144,196,211,.32)' : 'rgba(91,127,153,.22)';
    ctx.lineWidth = Math.max(0.7, this.zoom);
    ctx.stroke(path);
    const center = this.project(tile.id);
    if (tile.terrain === 'ocean' || tile.terrain === 'current' || tile.terrain === 'ruins') {
      ctx.strokeStyle = `rgba(141,211,218,${visible ? 0.20 : 0.09})`;
      ctx.lineWidth = Math.max(0.7, this.zoom);
      for (let row = -1; row <= 1; row += 1) {
        const offset = Math.sin(time / 1100 + tile.q + row) * 3 * this.zoom;
        ctx.beginPath();
        ctx.moveTo(center.x - 18 * this.zoom + offset, center.y + row * 12 * this.zoom);
        ctx.quadraticCurveTo(center.x, center.y + (row * 12 - 4) * this.zoom, center.x + 18 * this.zoom + offset, center.y + row * 12 * this.zoom);
        ctx.stroke();
      }
    }
    if (tile.terrain === 'current') {
      const cost = movementCost(this.state, tile, human.id);
      ctx.fillStyle = cost === 1 ? '#9de0d8' : '#f1c38c';
      ctx.font = `700 ${Math.max(8, 12 * this.zoom)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(`↝ ${cost}`, center.x, center.y + 5 * this.zoom);
    }
    if (tile.terrain === 'shoal') {
      const open = isPassable(this.state, tile);
      ctx.fillStyle = open ? '#c9b98f' : '#39667c';
      ctx.beginPath(); ctx.ellipse(center.x, center.y, 25 * this.zoom, 10 * this.zoom, -0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = open ? '#a6e0c5' : '#df9c8e';
      ctx.setLineDash([3 * this.zoom, 3 * this.zoom]);
      ctx.stroke(this.hexPath(tile.id, 0.83));
      ctx.setLineDash([]);
    }
    if (tile.resource) this.drawResource(tile.resource, center.x, center.y + 3 * this.zoom, 11 * this.zoom);
    if (!visible) {
      ctx.fillStyle = 'rgba(5,15,30,.46)';
      ctx.fill(this.hexPath(tile.id, 0.97));
    }
  }

  drawImage(name, tileId, width, yOffset = 0, alpha = 1, positionOverride = null) {
    const image = this.images.get(name);
    const point = positionOverride || this.project(tileId);
    const ctx = this.context;
    const w = width * this.zoom;
    const h = image ? w * image.height / image.width : w;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (image) ctx.drawImage(image, point.x - w / 2, point.y - h / 2 + yOffset * this.zoom, w, h);
    else {
      ctx.fillStyle = '#f3ead7';
      ctx.beginPath(); ctx.arc(point.x, point.y + yOffset * this.zoom, w * 0.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawPort(port, tile, human, time) {
    const ctx = this.context;
    const visible = human.visible.includes(tile.id);
    if (!visible && port.factionId !== human.id) return;
    const faction = getFaction(this.state, port.factionId);
    const point = this.project(tile.id);
    ctx.save();
    ctx.strokeStyle = this.factionColor(port.factionId);
    ctx.lineWidth = Math.max(1.5, this.zoom * 3);
    ctx.stroke(this.hexPath(tile.id, 0.83));
    ctx.restore();
    const lighthouse = port.buildings.includes('great_lighthouse');
    if (lighthouse) {
      const beamHeight = 70 * this.zoom;
      const gradient = ctx.createLinearGradient(point.x, point.y - beamHeight, point.x, point.y);
      gradient.addColorStop(0, 'rgba(166,231,236,0)');
      gradient.addColorStop(1, `rgba(193,239,233,${0.20 + Math.sin(time / 500) * 0.05})`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(point.x - 5 * this.zoom, point.y - 18 * this.zoom);
      ctx.lineTo(point.x - 34 * this.zoom, point.y - beamHeight);
      ctx.lineTo(point.x + 34 * this.zoom, point.y - beamHeight);
      ctx.lineTo(point.x + 5 * this.zoom, point.y - 18 * this.zoom);
      ctx.fill();
    }
    this.drawImage(lighthouse ? 'great-lighthouse' : 'port', tile.id, lighthouse ? 105 : 92, -15);
    const latestBuilding = port.buildings.filter((id) => id !== 'great_lighthouse').at(-1);
    const buildingSprites = { stilt_market: 'market', coral_shipyard: 'shipyard', pearl_academy: 'academy', reef_bastion: 'bastion', spiral_drydock: 'drydock' };
    if (latestBuilding) {
      this.drawImage(buildingSprites[latestBuilding], tile.id, 42, 0, 0.96, { x: point.x + 25 * this.zoom, y: point.y - 12 * this.zoom });
    }
    if (port.capitalOf) {
      ctx.fillStyle = this.factionColor(port.factionId);
      ctx.beginPath();
      const y = point.y - 45 * this.zoom;
      ctx.moveTo(point.x - 8 * this.zoom, y);
      ctx.lineTo(point.x - 4 * this.zoom, y - 9 * this.zoom);
      ctx.lineTo(point.x, y - 2 * this.zoom);
      ctx.lineTo(point.x + 5 * this.zoom, y - 10 * this.zoom);
      ctx.lineTo(point.x + 8 * this.zoom, y);
      ctx.closePath(); ctx.fill();
    }
    if (this.selection?.kind === 'port' && this.selection.id === port.id) {
      ctx.strokeStyle = '#f3ead7';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke(this.hexPath(tile.id, 0.90 + Math.sin(time / 250) * 0.015));
      ctx.setLineDash([]);
    }
    const stats = portStats(this.state, port);
    if (port.hp < port.maxHp || this.selection?.id === port.id) this.drawHealth(point.x, point.y + 26 * this.zoom, port.hp, port.maxHp, 42 * this.zoom);
    if (port.buildings.length && !lighthouse) {
      ctx.fillStyle = '#f3ead7';
      ctx.font = `700 ${Math.max(8, 10 * this.zoom)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(`${port.buildings.length} ◆`, point.x + 27 * this.zoom, point.y - 21 * this.zoom);
    }
    ctx.fillStyle = faction?.human ? '#f3ead7' : this.factionColor(port.factionId);
  }

  drawHealth(x, y, hp, maxHp, width) {
    const ctx = this.context;
    ctx.fillStyle = 'rgba(5,13,26,.82)';
    ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 5);
    ctx.fillStyle = hp / maxHp < 0.35 ? '#ed7567' : '#8bd0bd';
    ctx.fillRect(x - width / 2, y, width * Math.max(0, hp / maxHp), 3);
  }

  drawUnit(unit, human, time) {
    if (unit.factionId !== human.id && !human.visible.includes(unit.tileId)) return;
    const ctx = this.context;
    let point = this.project(unit.tileId);
    const animation = this.animations.get(unit.id);
    if (animation) {
      const progress = Math.min(1, (time - animation.start) / animation.duration);
      if (progress >= 1) this.animations.delete(unit.id);
      else {
        const from = this.project(animation.from);
        const to = this.project(animation.to);
        const eased = 1 - (1 - progress) ** 3;
        point = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased - Math.sin(progress * Math.PI) * 12 * this.zoom };
      }
    }
    const bob = Math.sin(time / 520 + Number(unit.id.replace(/\D/g, '') || 1)) * 1.8 * this.zoom;
    ctx.fillStyle = 'rgba(3,13,25,.38)';
    ctx.beginPath(); ctx.ellipse(point.x, point.y + 12 * this.zoom, 20 * this.zoom, 7 * this.zoom, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = this.factionColor(unit.factionId);
    ctx.lineWidth = this.selection?.id === unit.id ? 3 : 2;
    ctx.beginPath(); ctx.ellipse(point.x, point.y + 9 * this.zoom, 22 * this.zoom, 9 * this.zoom, 0, 0, TAU); ctx.stroke();
    this.drawImage(`${unit.type}-${unit.factionId}`, unit.tileId, 66, -10 + bob / this.zoom, 1, point);
    if (this.selection?.kind === 'unit' && this.selection.id === unit.id) {
      ctx.strokeStyle = '#f3ead7';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.ellipse(point.x, point.y + 9 * this.zoom, 27 * this.zoom, 12 * this.zoom, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    const stats = unitStats(this.state, unit);
    if (unit.hp < stats.maxHp || this.selection?.id === unit.id) this.drawHealth(point.x, point.y + 21 * this.zoom, unit.hp, stats.maxHp, 33 * this.zoom);
    if (unit.hasActed) {
      ctx.fillStyle = 'rgba(8,20,35,.55)';
      ctx.beginPath(); ctx.arc(point.x + 18 * this.zoom, point.y - 18 * this.zoom, 5 * this.zoom, 0, TAU); ctx.fill();
    }
  }

  drawEffects(time) {
    const ctx = this.context;
    this.impacts = this.impacts.filter((effect) => time - effect.start < 750);
    for (const effect of this.impacts) {
      const progress = (time - effect.start) / 750;
      const point = this.project(effect.tileId);
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = effect.kind === 'impact' ? '#f6a08c' : '#a6e1d4';
      ctx.lineWidth = 3 * (1 - progress) + 1;
      ctx.beginPath(); ctx.arc(point.x, point.y - 5 * this.zoom, (8 + progress * 44) * this.zoom, 0, TAU); ctx.stroke();
      if (effect.kind === 'impact') {
        for (let ray = 0; ray < 7; ray += 1) {
          const angle = ray / 7 * TAU;
          ctx.beginPath();
          ctx.moveTo(point.x + Math.cos(angle) * 9 * this.zoom, point.y + Math.sin(angle) * 9 * this.zoom);
          ctx.lineTo(point.x + Math.cos(angle) * (15 + progress * 24) * this.zoom, point.y + Math.sin(angle) * (15 + progress * 24) * this.zoom);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  draw(time) {
    if (document.hidden || !this.canvas.offsetParent) {
      requestAnimationFrame((next) => this.draw(next));
      return;
    }
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const background = ctx.createRadialGradient(this.width * 0.45, this.height * 0.40, 10, this.width * 0.45, this.height * 0.45, Math.max(this.width, this.height));
    background.addColorStop(0, '#174b70');
    background.addColorStop(1, '#07172c');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.state) {
      const human = this.state.factions.find((faction) => faction.id === 'nacre');
      const sorted = [...this.state.tiles].sort((a, b) => this.project(a.id).y - this.project(b.id).y || a.q - b.q);
      for (const tile of sorted) this.drawTileBase(tile, time, human);
      for (const [id, info] of Object.entries(this.reachable)) {
        const tile = getTile(this.state, id);
        if (!tile) continue;
        ctx.fillStyle = 'rgba(119,214,199,.20)';
        ctx.fill(this.hexPath(id, 0.79));
        ctx.strokeStyle = 'rgba(170,239,216,.78)';
        ctx.lineWidth = 1.3;
        ctx.stroke(this.hexPath(id, 0.79));
        if (this.zoom > 0.52) {
          const point = this.project(id);
          ctx.fillStyle = '#e5f5e9';
          ctx.font = `700 ${Math.max(8, 11 * this.zoom)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(String(info.cost), point.x, point.y - 10 * this.zoom);
        }
      }
      for (const tile of sorted) {
        if (!human.explored.includes(tile.id)) continue;
        const reefIndex = ((tile.q * 3 + tile.r * 5) % 6) + 1;
        if (tile.terrain === 'reef') this.drawImage(`reef-0${reefIndex}`, tile.id, 82, -5, human.visible.includes(tile.id) ? 1 : 0.58);
        if (tile.terrain === 'rocks') this.drawImage('reef-06', tile.id, 85, -10, human.visible.includes(tile.id) ? 1 : 0.58);
        if (tile.site && !this.state.claimedSites.includes(tile.id)) this.drawImage(`ruin-${tile.site === 'pearl_archive' ? 'archive' : tile.site === 'supply_cache' ? 'cache' : 'beacon'}`, tile.id, 75, -10, human.visible.includes(tile.id) ? 1 : 0.55);
        const port = getPortAt(this.state, tile.id);
        if (port) this.drawPort(port, tile, human, time);
        const unit = getUnitAt(this.state, tile.id);
        if (unit) this.drawUnit(unit, human, time);
      }
      this.drawEffects(time);
    }
    requestAnimationFrame((next) => this.draw(next));
  }
}
