// Canvas renderer for a village room: tiles, props, ninjas, chat bubbles, emotes.
// Simple vector shapes for v1 art. Also used by the admin Map Editor (World.drawStatic).
(function () {
  const P = window.ClubDojoProtocol;
  const WALK_SPEED = 6.5; // tiles per second
  const BUBBLE_MS = 6000;
  const EMOTE_MS = 2500;
  const TITLE_MS = 2600; // room name card after walking through a door

  const Art = window.ClubDojoMountainArt; // Mountain Town and Peak: tiles, props, sky and weather
  const ART_THEMES = new Set(['alpine', 'summit']);
  Art.registerAccessories(window.ClubDojoAvatar);

  const COVERING_PROPS = new Set(['forest', 'mountains', 'building', 'cave', 'wall', 'counter', 'table', 'tree', 'dummy', 'npc', ...Art.covering]);

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function floorOf(room) {
    const counts = {};
    for (const row of room.tiles) for (const c of row) if (P.TILES[c] && P.TILES[c].walkable) counts[c] = (counts[c] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '.';
  }

  function coverMap(room) {
    const covered = new Set();
    for (const p of room.props || []) {
      if (!COVERING_PROPS.has(p.type)) continue;
      const w = p.w || 1, h = p.h || 1;
      for (let j = p.y; j < p.y + h; j++) for (let i = p.x; i < p.x + w; i++) covered.add(j * room.width + i);
    }
    return covered;
  }

  function drawTile(ctx, c, x, y, T, time, floor, covered, theme) {
    const px = x * T, py = y * T;
    const n = hash(x, y);
    if (c === '#' && covered) c = floor;
    if (ART_THEMES.has(theme) && Art.tile(ctx, c, x, y, T, time, theme)) return;
    switch (c) {
      case '.':
        ctx.fillStyle = n > 0.85 ? '#eff7fb' : '#f4fafd';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        if (n < 0.06) { ctx.fillStyle = '#dcebf3'; ctx.fillRect(px + T * 0.3, py + T * 0.55, T * 0.25, T * 0.08); }
        break;
      case 'g':
        ctx.fillStyle = n > 0.85 ? '#80bf65' : '#7cba61';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        if (n < 0.18) {
          ctx.strokeStyle = 'rgba(46,105,52,.45)';
          ctx.lineWidth = Math.max(1, T * 0.05);
          ctx.beginPath();
          ctx.moveTo(px + T * 0.3, py + T * 0.75); ctx.lineTo(px + T * 0.34, py + T * 0.55);
          ctx.moveTo(px + T * 0.42, py + T * 0.75); ctx.lineTo(px + T * 0.48, py + T * 0.5);
          ctx.stroke();
        }
        break;
      case ':':
        ctx.fillStyle = n > 0.7 ? '#cfae7c' : '#d6b685';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        if (n < 0.25) { ctx.fillStyle = 'rgba(120,90,50,.35)'; ctx.beginPath(); ctx.arc(px + T * (0.25 + n * 2), py + T * 0.6, T * 0.06, 0, Math.PI * 2); ctx.fill(); }
        break;
      case 'f': {
        ctx.fillStyle = '#7dbb62';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        const petals = ['#ff7eb6', '#ffd23f', '#ffffff', '#b28dff'];
        for (let i = 0; i < 3; i++) {
          const fx = px + T * (0.2 + hash(x + i, y) * 0.6), fy = py + T * (0.2 + hash(x, y + i) * 0.6);
          ctx.fillStyle = petals[Math.floor(hash(x * 3 + i, y) * petals.length)];
          ctx.beginPath(); ctx.arc(fx, fy, T * 0.09, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f5b82e';
          ctx.beginPath(); ctx.arc(fx, fy, T * 0.035, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case ',':
        ctx.fillStyle = y % 2 ? '#c99a6b' : '#c39363';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        ctx.fillStyle = 'rgba(80,45,20,.18)';
        ctx.fillRect(px, py + T - 1, T, 1);
        if ((x + (y % 2) * 3) % 6 === 0) ctx.fillRect(px, py, 1, T);
        break;
      case '=':
        ctx.fillStyle = '#d9c08a';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        ctx.strokeStyle = 'rgba(90,70,30,.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        break;
      case '*':
        ctx.fillStyle = '#cdeaf7';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = Math.max(1, T * 0.05);
        ctx.beginPath();
        ctx.moveTo(px + T * (0.2 + n * 0.3), py + T * 0.3);
        ctx.lineTo(px + T * (0.45 + n * 0.3), py + T * 0.15);
        ctx.stroke();
        break;
      case '~': {
        ctx.fillStyle = '#6fb7dc';
        ctx.fillRect(px, py, T + 0.5, T + 0.5);
        const phase = time / 700 + x * 0.6 + y * 0.9;
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.lineWidth = Math.max(1, T * 0.06);
        ctx.beginPath();
        ctx.moveTo(px + T * 0.15, py + T * (0.5 + Math.sin(phase) * 0.12));
        ctx.quadraticCurveTo(px + T * 0.5, py + T * (0.35 + Math.sin(phase + 1) * 0.12), px + T * 0.85, py + T * (0.5 + Math.sin(phase + 2) * 0.12));
        ctx.stroke();
        break;
      }
      case '#':
      default:
        if (floor === ',') {
          ctx.fillStyle = '#6b4a35';
          ctx.fillRect(px, py, T + 0.5, T + 0.5);
        } else if (floor === 'g' || floor === ':' || floor === 'f') {
          ctx.fillStyle = '#7dbb62';
          ctx.fillRect(px, py, T + 0.5, T + 0.5);
          ctx.fillStyle = '#3f8a4a';
          roundRect(ctx, px + T * 0.05, py + T * 0.2, T * 0.9, T * 0.75, T * 0.35); ctx.fill();
          ctx.fillStyle = '#58a85c';
          roundRect(ctx, px + T * 0.15, py + T * 0.12, T * 0.55, T * 0.45, T * 0.22); ctx.fill();
        } else {
          ctx.fillStyle = '#f4fafd';
          ctx.fillRect(px, py, T + 0.5, T + 0.5);
          ctx.fillStyle = '#d5e6ee';
          roundRect(ctx, px + T * 0.06, py + T * 0.18, T * 0.88, T * 0.76, T * 0.35);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          roundRect(ctx, px + T * 0.14, py + T * 0.12, T * 0.6, T * 0.42, T * 0.2);
          ctx.fill();
        }
    }
  }

  function drawTiles(ctx, room, T, time, cache) {
    const floor = cache ? cache.floor : floorOf(room);
    const covered = cache ? cache.covered : coverMap(room);
    const theme = cache ? cache.theme : themeOf(room, floor);
    for (let y = 0; y < room.height; y++) {
      const row = room.tiles[y];
      for (let x = 0; x < room.width; x++) drawTile(ctx, row[x], x, y, T, time, floor, covered.has(y * room.width + x), theme);
    }
  }

  // ---------- Scenery around the room ----------
  // The room is fitted inside the window, so a margin is usually left on two sides. Fill it
  // with scenery that matches the room (forest, snow, rock or dark walls), and carry exit
  // paths out to the screen edge so they read as "the path continues this way".
  function themeOf(room, floor) {
    if (room.theme) return room.theme;
    if (/cave/i.test(room.id) || /cave/i.test(room.name)) return 'rock';
    if (floor === ',' || floor === '=') return 'indoor';
    if (floor === '.' || floor === '*') return 'snow';
    return 'forest';
  }

  const SURROUND = {
    forest: { base: '#2a5f45', dark: '#1f4a36', mid: '#2f6d4f', light: '#3f8a5a' },
    snow: { base: '#e3f0f6', dark: '#c9dfea', mid: '#d6e8f1', light: '#ffffff' },
    rock: { base: '#24212a', dark: '#1a181f', mid: '#33303a', light: '#423e4a' },
    indoor: { base: '#1c120e', dark: '#140c09', mid: '#2a1a13', light: '#3a2419' },
    ...Art.SURROUND,
  };

  function drawSurroundings(ctx, room, T, time, view, theme, cache) {
    const c = SURROUND[theme] || SURROUND.forest;
    const { x0, y0, x1, y1 } = view;
    if (x0 >= -1 && y0 >= -1 && x1 <= room.width + 1 && y1 <= room.height + 1) return; // no margin to fill
    ctx.fillStyle = c.base;
    ctx.fillRect(x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x >= 0 && y >= 0 && x < room.width && y < room.height) continue;
        const n = hash(x + 911, y + 377);
        const px = x * T, py = y * T;
        if (ART_THEMES.has(theme)) {
          Art.surroundTile(ctx, theme, x, y, T, n);
        } else if (theme === 'forest') {
          if (n < 0.62) {
            const r = T * (0.55 + n * 0.5);
            ctx.fillStyle = c.dark;
            ctx.beginPath(); ctx.arc(px + T * 0.5, py + T * 0.62, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = n < 0.3 ? c.mid : c.light;
            ctx.beginPath(); ctx.arc(px + T * 0.42, py + T * 0.45, r * 0.62, 0, Math.PI * 2); ctx.fill();
          }
        } else if (theme === 'snow') {
          if (n < 0.4) {
            ctx.fillStyle = c.dark;
            roundRect(ctx, px + T * 0.05, py + T * 0.3, T * 0.9, T * 0.6, T * 0.3); ctx.fill();
            ctx.fillStyle = c.light;
            roundRect(ctx, px + T * 0.15, py + T * 0.2, T * 0.55, T * 0.35, T * 0.18); ctx.fill();
          }
        } else if (theme === 'rock') {
          if (n < 0.5) {
            ctx.fillStyle = n < 0.25 ? c.mid : c.light;
            ctx.beginPath();
            ctx.moveTo(px + T * 0.1, py + T * 0.9); ctx.lineTo(px + T * (0.3 + n * 0.4), py + T * 0.15); ctx.lineTo(px + T * 0.95, py + T * 0.85);
            ctx.closePath(); ctx.fill();
          }
        } else {
          // Dark timber outside the walls: long planks with a few seams.
          ctx.fillStyle = c.mid;
          ctx.fillRect(px, py + T - Math.max(1, T * 0.06), T + 0.5, Math.max(1, T * 0.06));
          if (n < 0.18) ctx.fillRect(px, py, Math.max(1, T * 0.05), T);
        }
      }
    }
    // Paths keep going past the edge of the room for exits on the border.
    for (const p of room.portals || []) {
      const edge = portalEdge(room, p);
      if (!edge) continue;
      const w = p.w || 1, h = p.h || 1;
      const ch = room.tiles[p.y] && room.tiles[p.y][p.x];
      const tile = theme === 'indoor' ? null : (P.TILES[ch] && P.TILES[ch].walkable ? ch : ':');
      const run = [];
      if (edge === 'left') for (let x = x0; x < 0; x++) for (let j = 0; j < h; j++) run.push([x, p.y + j]);
      if (edge === 'right') for (let x = room.width; x < x1; x++) for (let j = 0; j < h; j++) run.push([x, p.y + j]);
      if (edge === 'up') for (let y = y0; y < 0; y++) for (let i = 0; i < w; i++) run.push([p.x + i, y]);
      if (edge === 'down') for (let y = room.height; y < y1; y++) for (let i = 0; i < w; i++) run.push([p.x + i, y]);
      if (tile) for (const [x, y] of run) drawTile(ctx, tile, x, y, T, time, cache ? cache.floor : 'g', false, theme);
      else {
        // Doorways out of a building: warm daylight spilling in from outside.
        const ex = edge === 'left' ? x0 * T : edge === 'right' ? room.width * T : p.x * T;
        const ey = edge === 'up' ? y0 * T : edge === 'down' ? room.height * T : p.y * T;
        const ew = edge === 'left' || edge === 'right' ? Math.abs((edge === 'left' ? 0 : x1) - (edge === 'left' ? x0 : room.width)) * T : w * T;
        const eh = edge === 'up' || edge === 'down' ? Math.abs((edge === 'up' ? 0 : y1) - (edge === 'up' ? y0 : room.height)) * T : h * T;
        ctx.fillStyle = 'rgba(255,226,160,.55)';
        ctx.fillRect(ex, ey, ew, eh);
      }
    }
  }

  // A soft shadow just outside the room border so the playable area reads clearly.
  function drawRoomEdge(ctx, room, T) {
    const W = room.width * T, H = room.height * T, s = T * 0.6;
    const sides = [
      [0, -s, W, s, 0, 0, 0, -s], [0, H, W, s, 0, H, 0, H + s],
      [-s, 0, s, H, 0, 0, -s, 0], [W, 0, s, H, W, 0, W + s, 0],
    ];
    for (const [x, y, w, h, gx0, gy0, gx1, gy1] of sides) {
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
  }

  // Which border of the room a portal sits on, or null for a door inside the room. With
  // slack, a gate a few tiles in from the border (the Sports Park gate) counts too.
  function portalEdge(room, p, slack = 0) {
    const w = p.w || 1, h = p.h || 1;
    if (p.x <= slack) return 'left';
    if (p.x + w >= room.width - slack) return 'right';
    if (p.y <= slack) return 'up';
    if (p.y + h >= room.height - slack) return 'down';
    return null;
  }
  const SIGN_SLACK = 3;

  // Exit sign for a portal on the room border: bouncing chevrons and a name tag, always shown.
  function drawExitSign(ctx, p, edge, T, time, hot) {
    const w = (p.w || 1) * T, h = (p.h || 1) * T;
    const cx = p.x * T + w / 2, cy = p.y * T + h / 2;
    const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[edge];
    const bob = (Math.sin(time / 260) + 1) * T * 0.08;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, T * 0.1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const k = i * T * 0.28 + bob;
      const ax = cx + dir[0] * k, ay = cy + dir[1] * k, s = T * 0.2;
      ctx.globalAlpha = hot ? 1 : 0.55 + i * 0.3;
      ctx.beginPath();
      ctx.moveTo(ax - dir[0] * s - dir[1] * s, ay - dir[1] * s - dir[0] * s);
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax - dir[0] * s + dir[1] * s, ay - dir[1] * s + dir[0] * s);
      ctx.stroke();
    }
    ctx.restore();
    const arrow = { left: '◀ ', right: '', up: '▲ ', down: '▼ ' }[edge];
    const text = `${arrow}${p.label || 'Exit'}${edge === 'right' ? ' ▶' : ''}`;
    const opts = { bg: hot ? 'rgba(245,184,46,.98)' : 'rgba(20,32,44,.78)', color: hot ? '#1b2a36' : '#fff', scale: 0.46 };
    ctx.font = `700 ${Math.max(10, T * opts.scale)}px Nunito, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(text).width + T * 0.4;
    let lx = cx, ly = cy - T * 0.3;
    if (edge === 'left') lx = p.x * T + w + T * 0.3 + tw / 2;
    if (edge === 'right') lx = p.x * T - T * 0.3 - tw / 2;
    if (edge === 'down') ly = p.y * T - T * 1.0;
    if (edge === 'up') ly = p.y * T + h + T * 0.35;
    drawLabel(ctx, text, lx, ly, T, opts);
  }

  // ---------- Time of day ----------
  // Outdoor rooms follow the host clock: golden morning, bright day, warm dusk, blue night.
  // Indoors stays lamp-lit; the cave is always dim.
  function lightingFor(theme, hour) {
    if (theme === 'indoor') return { dark: 0, warm: 0.08, night: false };
    if (theme === 'rock') return { dark: 0.42, warm: 0, night: true };
    let dark = 0, warm = 0;
    if (hour >= 21 || hour < 5) dark = 1;
    else if (hour >= 17.5) { const k = (hour - 17.5) / 3.5; dark = k * k; warm = Math.sin(k * Math.PI) * 0.9 + (k < 0.3 ? 0.3 : 0); }
    else if (hour < 7.5) { const k = 1 - (hour - 5) / 2.5; dark = k * k; warm = Math.sin(k * Math.PI) * 0.7; }
    return { dark: dark * 0.5, warm, night: dark > 0.45 };
  }
  function timeOfDayName(hour, theme) {
    if (theme === 'indoor') return 'Lanterns lit, tea is warm';
    if (theme === 'rock') return 'Mind your step in the dark';
    if (hour >= 21 || hour < 5) return 'Night falls on the village';
    if (hour >= 17.5) return 'Evening';
    if (hour < 7.5) return 'Dawn';
    if (hour < 11) return 'Morning';
    return 'Afternoon';
  }

  function drawLighting(ctx, room, T, time, view, light, env) {
    const { x0, y0, x1, y1 } = view;
    const X = x0 * T, Y = y0 * T, W = (x1 - x0) * T, H = (y1 - y0) * T;
    if (light.warm > 0) { ctx.fillStyle = `rgba(255,150,70,${0.13 * light.warm})`; ctx.fillRect(X, Y, W, H); }
    if (light.dark <= 0) return;
    ctx.fillStyle = `rgba(14,22,62,${light.dark})`;
    ctx.fillRect(X, Y, W, H);
    // Light sources glow through the dark.
    const k = Math.min(1, light.dark / 0.5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = (gx, gy, r, a, rgb = '255,190,90') => {
      const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, r);
      g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI * 2); ctx.fill();
    };
    for (const p of room.props || []) {
      if (p.type === 'lantern') {
        const f = 0.85 + Math.sin(time / 180 + p.x * 1.7) * 0.1;
        glow((p.x + 0.5) * T, p.y * T - T * 0.6, T * 3.2, 0.32 * k * f);
      } else if (p.type === 'building') {
        const w = (p.w || 1) * T;
        glow(p.x * T + T * 1.45, p.y * T + T * 2.65, T * 1.6, 0.3 * k);
        glow(p.x * T + w - T * 1.45, p.y * T + T * 2.65, T * 1.6, 0.3 * k);
        glow(p.x * T + w / 2, (p.y + (p.h || 1)) * T, T * 2, 0.22 * k);
      } else if (Art.props[p.type]) Art.glows(p, T, glow, k, time, env);
    }
    for (const sp of room.minigames || []) glow((sp.x + 1.5) * T, (sp.y + 1) * T, T * 2.2, 0.18 * k);
    ctx.restore();
  }

  // ---------- Ambient particles ----------
  // Falling leaves and petals by day, fireflies at night, dust motes indoors and in the cave.
  // Kept in tile units; purely cosmetic and local to this window.
  const LEAF_COLORS = ['#7cc35a', '#e8a33c', '#d9653b', '#ffb7d5', '#f5d33b'];
  function updateParticles(world, dt) {
    const room = world.room;
    const list = world.particles || (world.particles = []);
    const light = lightingFor(world.theme, world.hour());
    const art = ART_THEMES.has(world.theme);
    const kind = art ? 'snow' : world.theme === 'indoor' || world.theme === 'rock' ? 'dust' : world.theme === 'snow' ? 'snow' : light.night ? 'firefly' : 'leaf';
    // In the mountains the snow follows the day's weather, and blows harder at the summit.
    const summit = world.theme === 'summit', snowing = world.mountain && world.mountain.weather.id === 'snowfall';
    const max = art ? (snowing ? 130 : summit ? 55 : 22) : kind === 'snow' ? 60 : kind === 'firefly' ? 34 : kind === 'dust' ? 26 : 22;
    const rate = art ? (snowing ? 26 : summit ? 12 : 3) : kind === 'snow' ? 14 : kind === 'leaf' ? 3 : 6;
    const wind = summit ? 1.6 : 0;
    world.spawnAcc = (world.spawnAcc || 0) + dt * rate;
    while (world.spawnAcc >= 1) {
      world.spawnAcc -= 1;
      if (list.length >= max) break;
      const r = Math.random;
      if (kind === 'leaf' || kind === 'snow') {
        list.push({ kind, x: r() * (room.width + 6) - 6, y: -1 - r() * 2, vx: 0.5 + r() * 0.6 + wind, vy: kind === 'snow' ? 0.9 + r() * 0.8 : 0.7 + r() * 0.6,
          spin: r() * Math.PI * 2, vs: (r() - 0.5) * 5, c: LEAF_COLORS[Math.floor(r() * LEAF_COLORS.length)], size: 0.12 + r() * 0.1, life: 0, max: 30 });
      } else {
        list.push({ kind, x: r() * room.width, y: 3 + r() * (room.height - 3), vx: (r() - 0.5) * 0.4, vy: kind === 'dust' ? -0.05 - r() * 0.1 : (r() - 0.5) * 0.4,
          life: 0, max: 4 + r() * 4, phase: r() * 10, size: kind === 'dust' ? 0.04 + r() * 0.04 : 0.07 + r() * 0.05 });
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      if (p.kind === 'leaf' || p.kind === 'snow') {
        p.x += (p.vx + Math.sin(p.life * 2 + p.spin) * 0.6) * dt; p.y += p.vy * dt; p.spin += p.vs * dt;
        if (p.y > room.height + 1 || p.x > room.width + 6) list.splice(i, 1);
      } else {
        if (p.kind === 'firefly') { p.vx += (Math.random() - 0.5) * dt * 1.2; p.vy += (Math.random() - 0.5) * dt * 1.2; p.vx *= 0.98; p.vy *= 0.98; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.life > p.max) list.splice(i, 1);
      }
    }
  }

  function drawParticles(ctx, list, T, time, light) {
    if (!list || !list.length) return;
    ctx.save();
    for (const p of list) {
      const fade = p.max ? Math.min(1, p.life / 0.8, (p.max - p.life) / 0.8) : 1;
      if (p.kind === 'leaf') {
        ctx.globalAlpha = 0.85 * Math.min(1, p.life);
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.ellipse(p.x * T, p.y * T, T * p.size, T * p.size * 0.45 * Math.abs(Math.cos(p.spin)) + 0.5, p.spin, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'snow') {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * p.size * 0.6, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'firefly') {
        const pulse = 0.5 + Math.sin(time / 300 + p.phase) * 0.5;
        ctx.globalCompositeOperation = 'lighter';
        const r = T * 0.5;
        const g = ctx.createRadialGradient(p.x * T, p.y * T, 0, p.x * T, p.y * T, r);
        g.addColorStop(0, `rgba(230,255,140,${0.8 * pulse * fade})`); g.addColorStop(1, 'rgba(230,255,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x * T, p.y * T, r, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.globalAlpha = 0.35 * fade * (light.dark ? 1 : 0.8);
        ctx.fillStyle = '#ffe7b0';
        ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * p.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPortals(ctx, room, T, time, hoverPortal) {
    for (const p of room.portals || []) {
      const x = p.x * T, y = p.y * T, w = (p.w || 1) * T, h = (p.h || 1) * T;
      const glow = 0.45 + Math.sin(time / 400) * 0.2;
      ctx.fillStyle = `rgba(245,184,46,${hoverPortal === p ? 0.55 : glow * 0.5})`;
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, T * 0.25);
      ctx.fill();
      ctx.strokeStyle = '#f5b82e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawLabel(ctx, text, cx, y, T, opts = {}) {
    ctx.font = `700 ${Math.max(10, T * (opts.scale || 0.42))}px Nunito, "Segoe UI", sans-serif`;
    const w = ctx.measureText(text).width + T * 0.4;
    const h = Math.max(14, T * 0.6);
    ctx.fillStyle = opts.bg || 'rgba(0,0,0,.5)';
    roundRect(ctx, cx - w / 2, y, w, h, h / 2.5);
    ctx.fill();
    ctx.fillStyle = opts.color || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + h / 2 + 0.5);
  }

  // Flat sports surfaces, drawn over the grass. They are flat, so they sit under everything.
  function drawCourt(ctx, p, x, y, w, h, T) {
    const lw = Math.max(1.5, T * 0.07);
    const inset = T * 0.3;
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    if (p.sport === 'soccer') {
      const stripes = 8, sw = w / stripes;
      for (let i = 0; i < stripes; i++) { ctx.fillStyle = i % 2 ? '#66b653' : '#5aa948'; ctx.fillRect(x + i * sw, y, sw + 0.5, h); }
      ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      ctx.beginPath(); ctx.moveTo(cx, y + inset); ctx.lineTo(cx, y + h - inset); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.12, 0, Math.PI * 2); ctx.stroke();
      const bw = w * 0.16, bh = h * 0.6;
      ctx.strokeRect(x + inset, cy - bh / 2, bw, bh);
      ctx.strokeRect(x + w - inset - bw, cy - bh / 2, bw, bh);
      // Goals stand just outside each end line.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + inset - T * 0.35, cy - h * 0.12, T * 0.35, h * 0.24);
      ctx.fillRect(x + w - inset, cy - h * 0.12, T * 0.35, h * 0.24);
    } else if (p.sport === 'basketball') {
      ctx.fillStyle = '#d7733a';
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      ctx.beginPath(); ctx.moveTo(cx, y + inset); ctx.lineTo(cx, y + h - inset); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.12, 0, Math.PI * 2); ctx.stroke();
      const kw = w * 0.18, kh = h * 0.46;
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(x + inset, cy - kh / 2, kw, kh);
      ctx.fillRect(x + w - inset - kw, cy - kh / 2, kw, kh);
      ctx.strokeRect(x + inset, cy - kh / 2, kw, kh);
      ctx.strokeRect(x + w - inset - kw, cy - kh / 2, kw, kh);
      // Hoops: a backboard and an orange rim at each end.
      for (const [bx, dir] of [[x + T * 0.2, 1], [x + w - T * 0.2, -1]]) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx - (dir > 0 ? 0 : lw), cy - T * 0.45, lw * 1.5, T * 0.9);
        ctx.strokeStyle = '#ff5a1f'; ctx.lineWidth = lw * 1.2;
        ctx.beginPath(); ctx.arc(bx + dir * T * 0.32, cy, T * 0.16, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = lw;
      }
    } else if (p.sport === 'tennis') {
      ctx.fillStyle = '#3b7fc4';
      ctx.fillRect(x, y, w, h);
      const iw = w - inset * 2, ih = h - inset * 2;
      ctx.strokeRect(x + inset, y + inset, iw, ih); // doubles lines
      const sx = x + inset + iw * 0.08, sw2 = iw * 0.84; // singles sidelines
      ctx.strokeRect(sx, y + inset, sw2, ih);
      ctx.beginPath(); ctx.moveTo(sx + sw2 * 0.27, y + inset); ctx.lineTo(sx + sw2 * 0.27, y + h - inset); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + sw2 * 0.73, y + inset); ctx.lineTo(sx + sw2 * 0.73, y + h - inset); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, cy); ctx.lineTo(sx + sw2, cy); ctx.stroke();
      // Net across the middle, with posts.
      ctx.fillStyle = 'rgba(30,30,30,.35)';
      ctx.fillRect(cx - lw * 0.6, y + inset - T * 0.2, lw * 1.2, ih + T * 0.4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - lw * 0.6, y + inset - T * 0.2, lw * 1.2, lw * 1.2);
      ctx.fillRect(cx - lw * 0.6, y + h - inset + T * 0.2 - lw * 1.2, lw * 1.2, lw * 1.2);
    } else if (p.sport === 'football') {
      // Gridiron: striped turf, an end zone at each side, yard lines and yellow goal posts.
      const ez = w * 0.1, fx = x + ez, fw = w - ez * 2;
      const stripes = 10, sw = fw / stripes;
      for (let i = 0; i < stripes; i++) { ctx.fillStyle = i % 2 ? '#4f9e45' : '#5aab4f'; ctx.fillRect(fx + i * sw, y, sw + 0.5, h); }
      ctx.fillStyle = '#2f6fd1'; ctx.fillRect(x, y, ez, h);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(x + w - ez, y, ez, h);
      ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
      for (let i = 0; i <= stripes; i++) {
        ctx.beginPath(); ctx.moveTo(fx + i * sw, y + inset); ctx.lineTo(fx + i * sw, y + h - inset); ctx.stroke();
      }
      // Hash marks along the middle.
      for (let i = 0; i < stripes * 2; i++) {
        const hx = fx + (i + 0.5) * sw / 2;
        ctx.beginPath(); ctx.moveTo(hx, cy - h * 0.12); ctx.lineTo(hx, cy - h * 0.06); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx, cy + h * 0.06); ctx.lineTo(hx, cy + h * 0.12); ctx.stroke();
      }
      ctx.strokeStyle = '#f5d33b'; ctx.lineWidth = lw * 1.6;
      for (const [gx, dir] of [[x + inset * 0.6, 1], [x + w - inset * 0.6, -1]]) {
        ctx.beginPath(); ctx.moveTo(gx, cy - h * 0.18); ctx.lineTo(gx, cy + h * 0.18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx + dir * T * 0.3, cy); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Oval go-kart track: kerbs, asphalt, an infield of grass, a dashed racing line and a finish line.
  function drawKartTrack(ctx, x, y, w, h, T) {
    const r = Math.min(w, h) * 0.45; // w and h are already in pixels
    ctx.save();
    ctx.fillStyle = '#f4f4f4';
    roundRect(ctx, x, y, w, h, r); ctx.fill();
    ctx.fillStyle = '#4a4f57';
    roundRect(ctx, x + T * 0.2, y + T * 0.2, w - T * 0.4, h - T * 0.4, r - T * 0.2); ctx.fill();
    ctx.fillStyle = '#7cba61';
    roundRect(ctx, x + T * 1.2, y + T * 1.2, w - T * 2.4, h - T * 2.4, r - T); ctx.fill();
    ctx.setLineDash([T * 0.35, T * 0.3]);
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = Math.max(1.5, T * 0.06);
    roundRect(ctx, x + T * 0.7, y + T * 0.7, w - T * 1.4, h - T * 1.4, r - T * 0.5); ctx.stroke();
    ctx.setLineDash([]);
    // Checkered finish line across the top straight.
    const fx = x + w * 0.5 - T * 0.25, fy = y + T * 0.2, cell = T * 0.25;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#222222';
      ctx.fillRect(fx + i * cell, fy + j * cell, cell, cell);
    }
    ctx.restore();
  }

  // Props: each returns its depth (bottom edge in tile units) and a draw function.
  function propDrawable(p, T, time, env = {}) {
    const x = p.x * T, y = p.y * T, w = (p.w || 1) * T, h = (p.h || 1) * T;
    if (Art.props[p.type]) {
      const depth = p.depth ?? (Art.flat.has(p.type) ? -1 : p.y + (p.h || 1));
      return { depth, draw: (ctx) => Art.props[p.type](ctx, p, x, y, w, h, T, time, env) };
    }
    const depth = p.type === 'mountains' || p.type === 'forest' || p.type === 'wall' || p.type === 'court' || p.type === 'track' ? -1 : p.y + (p.h || 1);
    const draw = {
      building(ctx) {
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(x + T * 0.2, y + h - T * 0.2, w, T * 0.35);
        ctx.fillStyle = p.color || '#7a3b2e';
        roundRect(ctx, x + T * 0.2, y + T * 0.9, w - T * 0.4, h - T * 0.9, T * 0.15);
        ctx.fill();
        // roof
        ctx.fillStyle = p.roof || '#3a1d17';
        ctx.beginPath();
        ctx.moveTo(x - T * 0.3, y + T * 1.2);
        ctx.quadraticCurveTo(x + w / 2, y - T * 0.2, x + w + T * 0.3, y + T * 1.2);
        ctx.lineTo(x + w - T * 0.2, y + T * 0.7);
        ctx.quadraticCurveTo(x + w / 2, y - T * 0.6, x + T * 0.2, y + T * 0.7);
        ctx.closePath();
        ctx.fill();
        if (p.snow) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + T * 0.1, y + T * 0.55, w - T * 0.2, T * 0.18); } // snow on the roof
        // door
        ctx.fillStyle = '#24130f';
        roundRect(ctx, x + w / 2 - T * 0.8, y + h - T * 1.8, T * 1.6, T * 1.8, T * 0.3);
        ctx.fill();
        ctx.fillStyle = '#f5b82e';
        ctx.fillRect(x + w / 2 - T * 0.05, y + h - T * 1.8, T * 0.1, T * 1.8);
        // windows
        ctx.fillStyle = 'rgba(255,224,138,.85)';
        ctx.fillRect(x + T * 0.9, y + T * 2.2, T * 1.1, T * 0.9);
        ctx.fillRect(x + w - T * 2, y + T * 2.2, T * 1.1, T * 0.9);
        // sign
        ctx.font = `${Math.max(11, T * 0.62)}px Bangers, Impact, "Trebuchet MS", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(p.label || '', x + w / 2, y + T * 1.5);
      },
      // A rocky hill with a dark opening at the bottom middle, where the portal is.
      cave(ctx) {
        const cx = x + w / 2, base = y + h, cols = p.w || 1;
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.beginPath(); ctx.ellipse(cx, base, w * 0.56, T * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        // The hill: a lumpy outline, darker toward the ground
        const left = x - T * 0.5, span = w + T;
        const ridge = (i, n) => base - (h + T * 0.3) * Math.pow(Math.sin((Math.PI * i) / n), 0.55) - hash(i, 11) * T * 0.45;
        const steps = cols * 2;
        const rock = ctx.createLinearGradient(0, y, 0, base);
        rock.addColorStop(0, '#8b8693'); rock.addColorStop(0.55, '#67626f'); rock.addColorStop(1, '#45414d');
        ctx.fillStyle = rock;
        ctx.beginPath(); ctx.moveTo(left, base);
        for (let i = 0; i <= steps; i++) ctx.lineTo(left + (span * i) / steps, ridge(i, steps));
        ctx.lineTo(left + span, base); ctx.closePath(); ctx.fill();
        // Big boulders on the face of the hill
        for (let i = 0; i < cols * 2; i++) {
          const bx = x + hash(i, 21) * w, t = hash(i, 22);
          const hillTop = base - (h * 0.92) * Math.pow(Math.sin(Math.PI * Math.min(0.97, Math.max(0.03, (bx - left) / span))), 0.55);
          const by = hillTop + T * 0.8 + t * (base - hillTop - T * 1.2);
          const r = T * (0.4 + hash(i, 23) * 0.55);
          ctx.fillStyle = hash(i, 24) > 0.5 ? '#77727f' : '#59545f';
          ctx.beginPath(); ctx.ellipse(bx, by, r * 1.25, r, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.1)';
          ctx.beginPath(); ctx.ellipse(bx - r * 0.3, by - r * 0.35, r * 0.55, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        }
        // Moss and grass on top
        for (let i = 1; i < steps; i += 2) {
          const mx = left + (span * i) / steps, my = ridge(i, steps) + T * 0.2;
          ctx.fillStyle = hash(i, 31) > 0.5 ? '#4f9a54' : '#3f8a4a';
          ctx.beginPath(); ctx.ellipse(mx, my, T * (0.5 + hash(i, 32) * 0.5), T * 0.24, 0, 0, Math.PI * 2); ctx.fill();
        }
        // Rocks framing the mouth
        const mw = T * 3, mh = T * 3.5;
        for (let i = 0; i <= 10; i++) {
          const a = Math.PI + (Math.PI * i) / 10;
          const rx = cx + Math.cos(a) * (mw / 2 + T * 0.22), ry = base - T * 0.1 + Math.sin(a) * (mh + T * 0.15);
          ctx.fillStyle = i % 2 ? '#524d59' : '#3e3a45';
          ctx.beginPath(); ctx.ellipse(rx, ry, T * 0.52, T * 0.4, a, 0, Math.PI * 2); ctx.fill();
        }
        // The dark opening, deepest in the middle
        const dark = ctx.createRadialGradient(cx, base - mh * 0.45, T * 0.2, cx, base - mh * 0.45, mh);
        dark.addColorStop(0, '#000000'); dark.addColorStop(0.7, '#0c0a10'); dark.addColorStop(1, '#221e29');
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(cx - mw / 2, base);
        ctx.quadraticCurveTo(cx - mw / 2, base - mh * 1.28, cx, base - mh);
        ctx.quadraticCurveTo(cx + mw / 2, base - mh * 1.28, cx + mw / 2, base);
        ctx.closePath(); ctx.fill();
        // Stalactites hanging in the opening
        ctx.fillStyle = '#4d4854';
        for (let i = 0; i < 6; i++) {
          const sx = cx - mw * 0.36 + (mw * 0.72 * i) / 5;
          const top = base - mh * (1.0 - Math.abs(i - 2.5) * 0.09);
          const len = T * (0.45 + hash(i, 41) * 0.55);
          ctx.beginPath(); ctx.moveTo(sx - T * 0.17, top - T * 0.1); ctx.lineTo(sx + T * 0.17, top - T * 0.1); ctx.lineTo(sx, top + len); ctx.closePath(); ctx.fill();
        }
        // Mine rails running out of the dark
        ctx.strokeStyle = 'rgba(180,180,190,.55)'; ctx.lineWidth = Math.max(1, T * 0.07);
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * T * 0.2, base - T * 1.2); ctx.lineTo(cx + s * T * 0.58, base); ctx.stroke(); }
      },
      forest(ctx) {
        ctx.fillStyle = '#2f6d4f';
        ctx.fillRect(x, y, w, h);
        for (let row = 0; row < 3; row++) {
          for (let i = -1; i <= (p.w || 1); i++) {
            const tx = x + (i + (row % 2) * 0.5) * T * 1.4;
            if (tx < x - T * 2 || tx > x + w + T) continue;
            const base = y + T * (0.9 + row * 0.9);
            const r = T * (0.95 + hash(i, row) * 0.35);
            ctx.fillStyle = ['#244f3b', '#2f6d4f', '#3f8a5a'][row];
            ctx.beginPath(); ctx.arc(tx, base, r, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(x, y + h - T * 0.18, w, T * 0.18);
      },
      mountains(ctx) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, '#bfe3f2'); g.addColorStop(1, '#dff3fb');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        const peaks = Math.max(3, Math.round((p.w || 1) / 5));
        for (let layer = 0; layer < 2; layer++) {
          ctx.fillStyle = layer ? '#9cc3d6' : '#b9d6e4';
          for (let i = -1; i <= peaks; i++) {
            const px = x + (i + (layer ? 0.5 : 0)) * (w / peaks);
            const top = y - T * (layer ? 0.2 : 0.8) + hash(i, layer) * T * 0.8;
            const half = w / peaks * 0.75;
            ctx.beginPath(); ctx.moveTo(px - half, y + h); ctx.lineTo(px, top); ctx.lineTo(px + half, y + h); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px + half * 0.28, top + (y + h - top) * 0.28); ctx.lineTo(px - half * 0.28, top + (y + h - top) * 0.28); ctx.closePath(); ctx.fill();
            ctx.fillStyle = layer ? '#9cc3d6' : '#b9d6e4';
          }
        }
        ctx.fillStyle = '#f4fafd';
        ctx.beginPath(); ctx.moveTo(x, y + h); 
        for (let i = 0; i <= (p.w || 1); i++) ctx.lineTo(x + i * T, y + h - T * 0.25 - hash(i, 7) * T * 0.3);
        ctx.lineTo(x + w, y + h + 1); ctx.lineTo(x, y + h + 1); ctx.closePath(); ctx.fill();
      },
      wall(ctx) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, '#2a1610');
        g.addColorStop(1, p.color || '#5a2c22');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        for (let i = 0; i < (p.w || 1); i += 4) ctx.fillRect(x + i * T, y, 2, h);
        ctx.fillStyle = '#3a1d17';
        ctx.fillRect(x, y + h - T * 0.3, w, T * 0.3);
      },
      tree(ctx) {
        const cx = x + T / 2;
        if (p.style === 'leafy') {
          ctx.fillStyle = 'rgba(0,0,0,.15)';
          ctx.beginPath(); ctx.ellipse(cx, y + T * 0.9, T * 0.6, T * 0.2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#6b4226';
          ctx.fillRect(cx - T * 0.12, y + T * 0.2, T * 0.24, T * 0.75);
          const blobs = [[0, -0.55, 0.62], [-0.38, -0.2, 0.45], [0.38, -0.2, 0.45], [0, -0.05, 0.5]];
          for (const [dx, dy, r] of blobs) { ctx.fillStyle = '#3f8a4a'; ctx.beginPath(); ctx.arc(cx + dx * T, y + dy * T, r * T, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = '#58a85c';
          ctx.beginPath(); ctx.arc(cx - T * 0.15, y - T * 0.7, T * 0.28, 0, Math.PI * 2); ctx.fill();
          return;
        }
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.beginPath(); ctx.ellipse(cx, y + T * 0.9, T * 0.55, T * 0.18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(cx - T * 0.1, y + T * 0.5, T * 0.2, T * 0.45);
        for (let i = 0; i < 3; i++) {
          const top = y - T * (1.4 - i * 0.55), base = y + T * (0.1 + i * 0.25), half = T * (0.35 + i * 0.18);
          ctx.fillStyle = '#2f6d4f';
          ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + half, base); ctx.lineTo(cx - half, base); ctx.closePath(); ctx.fill();
          ctx.fillStyle = p.snow ? '#ffffff' : '#3f8a5a';
          ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + half * 0.45, top + (base - top) * 0.4); ctx.lineTo(cx - half * 0.45, top + (base - top) * 0.4); ctx.closePath(); ctx.fill();
        }
      },
      lantern(ctx) {
        const cx = x + T / 2;
        const flicker = 0.75 + Math.sin(time / 180 + p.x) * 0.08;
        ctx.fillStyle = '#3a2a20';
        ctx.fillRect(cx - T * 0.04, y - T * 0.6, T * 0.08, T * 1.4);
        const g = ctx.createRadialGradient(cx, y - T * 0.6, 1, cx, y - T * 0.6, T * 1.2);
        g.addColorStop(0, `rgba(255,201,74,${0.55 * flicker})`);
        g.addColorStop(1, 'rgba(255,201,74,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, y - T * 0.6, T * 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8453c';
        roundRect(ctx, cx - T * 0.25, y - T * 0.95, T * 0.5, T * 0.65, T * 0.22); ctx.fill();
        ctx.fillStyle = '#f5b82e';
        ctx.fillRect(cx - T * 0.25, y - T * 0.68, T * 0.5, T * 0.08);
      },
      sign(ctx) {
        const cx = x + T / 2;
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(cx - T * 0.06, y - T * 0.2, T * 0.12, T * 1);
        ctx.font = `700 ${Math.max(10, T * 0.38)}px Nunito, "Segoe UI", sans-serif`;
        const tw = ctx.measureText(p.text || '').width + T * 0.5;
        ctx.fillStyle = '#a8713f';
        roundRect(ctx, cx - tw / 2, y - T * 0.75, tw, T * 0.65, T * 0.12); ctx.fill();
        ctx.fillStyle = '#fff8e8';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.text || '', cx, y - T * 0.42);
      },
      court(ctx) { drawCourt(ctx, p, x, y, w, h, T); },
      track(ctx) { drawKartTrack(ctx, x, y, w, h, T); },
      npc(ctx) {
        drawNinja(ctx, { x: p.x + 0.5, y: p.y + 0.5, color: p.gi || '#f3f8fb', headband: p.headband || '#f5b82e', belt: p.belt || 'black', accessories: p.hat ? { head: 'fur-hat' } : undefined }, T, time);
        drawLabel(ctx, p.name || 'Sensei', x + T / 2, y + T * 0.75, T, { bg: p.npc ? 'rgba(47,109,140,.9)' : 'rgba(122,59,46,.85)' });
      },
      dummy(ctx) {
        const cx = x + T / 2;
        ctx.fillStyle = 'rgba(0,0,0,.15)';
        ctx.beginPath(); ctx.ellipse(cx, y + T * 0.9, T * 0.4, T * 0.15, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(cx - T * 0.07, y - T * 0.3, T * 0.14, T * 1.2);
        ctx.fillRect(cx - T * 0.5, y + T * 0.05, T, T * 0.12);
        ctx.fillStyle = '#d8b56b';
        roundRect(ctx, cx - T * 0.28, y - T * 0.6, T * 0.56, T * 0.9, T * 0.25); ctx.fill();
        ctx.strokeStyle = '#e8453c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, y - T * 0.15, T * 0.14, 0, Math.PI * 2); ctx.stroke();
      },
      banner(ctx) {
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + T, y); ctx.lineTo(x + T, y + T * 2.2); ctx.lineTo(x + T / 2, y + T * 1.9); ctx.lineTo(x, y + T * 2.2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f5b82e';
        ctx.beginPath(); ctx.arc(x + T / 2, y + T * 0.9, T * 0.28, 0, Math.PI * 2); ctx.fill();
      },
      counter(ctx) {
        ctx.fillStyle = '#7a4a2a';
        ctx.fillRect(x, y + T * 0.3, w, h - T * 0.3);
        ctx.fillStyle = '#a0683e';
        ctx.fillRect(x - 2, y, w + 4, T * 0.5);
        ctx.fillStyle = '#ffffff';
        for (let i = 2; i < (p.w || 1); i += 5) {
          ctx.beginPath(); ctx.ellipse(x + i * T, y + T * 0.2, T * 0.32, T * 0.16, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#e8a33c';
          ctx.beginPath(); ctx.ellipse(x + i * T, y + T * 0.2, T * 0.22, T * 0.09, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffffff';
        }
      },
      table(ctx) {
        const cx = x + T * 1.5, cy = y + T;
        ctx.fillStyle = 'rgba(0,0,0,.15)';
        ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.6, T * 1.3, T * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a5432';
        ctx.beginPath(); ctx.ellipse(cx, cy, T * 1.35, T * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a8693f';
        ctx.beginPath(); ctx.ellipse(cx, cy - T * 0.08, T * 1.2, T * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(cx - T * 0.4, cy - T * 0.1, T * 0.25, T * 0.14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + T * 0.45, cy, T * 0.25, T * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      },
    }[p.type];
    return draw ? { depth, draw } : null;
  }

  // World units -> avatar pixels. n.x/n.y are tile coordinates (center of tile = +0.5).
  function drawNinja(ctx, n, T, time, opts = {}) {
    return window.ClubDojoAvatar.draw(ctx, n, {
      x: n.x * T, y: n.y * T + T * 0.45, size: T, facing: n.facing || 0, walking: n.walking, time, you: opts.you,
    });
  }

  function drawSpotPadAndStatus(ctx, sp, T, time, status, labelX, labelY) {
    const pad = P.spotPad(sp);
    const glow = 0.35 + Math.sin(time / 380) * 0.15;
    ctx.strokeStyle = `rgba(245,184,46,${glow + 0.3})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    roundRect(ctx, pad.x * T + 3, pad.y * T + 3, T - 6, T - 6, T * 0.25); ctx.stroke();
    ctx.setLineDash([]);
    if (status && status.count) {
      const label = status.phase === 'lobby' ? `${status.count}/${status.max} waiting` : `${status.count} playing`;
      drawLabel(ctx, label, labelX, labelY, T, { bg: status.phase === 'lobby' ? 'rgba(63,191,127,.92)' : 'rgba(232,69,60,.92)' });
    }
  }

  // Fishing spot: drawn as the end of a wooden dock over the water instead of a pavilion.
  function dockDrawable(sp, T, time, status) {
    const { w, h } = P.MINIGAME_SPOT;
    const x = sp.x * T, y = sp.y * T, W = w * T, H = h * T;
    return {
      depth: sp.y + h,
      draw(ctx) {
        // posts in the water, with ripples
        const ripple = Math.sin(time / 500) * T * 0.04;
        for (const px of [x + T * 0.12, x + W - T * 0.12]) {
          ctx.strokeStyle = 'rgba(255,255,255,.4)';
          ctx.lineWidth = Math.max(1, T * 0.05);
          ctx.beginPath(); ctx.ellipse(px, y + H + T * 0.05, T * 0.2 + ripple, T * 0.07, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#5b3a22';
          ctx.fillRect(px - T * 0.08, y + T * 0.1, T * 0.16, H);
        }
        // deck planks
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(x + T * 0.05, y + T * 0.3, W - T * 0.1, H - T * 0.2);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? '#b98a5c' : '#c39363';
          ctx.fillRect(x + T * 0.05, y + T * 0.15 + i * (H - T * 0.3) / 5, W - T * 0.1, (H - T * 0.3) / 5 + 0.5);
        }
        ctx.fillStyle = 'rgba(80,45,20,.3)';
        for (let i = 1; i < 5; i++) ctx.fillRect(x + T * 0.05, y + T * 0.15 + i * (H - T * 0.3) / 5, W - T * 0.1, 1);
        // mooring posts on the corners
        ctx.fillStyle = '#6b4a35';
        for (const px of [x + T * 0.05, x + W - T * 0.3]) {
          roundRect(ctx, px, y - T * 0.1, T * 0.25, T * 0.45, T * 0.08); ctx.fill();
        }
        // bucket
        ctx.fillStyle = '#4f6d7a';
        roundRect(ctx, x + W - T * 0.9, y + T * 0.75, T * 0.4, T * 0.4, T * 0.08); ctx.fill();
        ctx.fillStyle = '#2f4650';
        ctx.fillRect(x + W - T * 0.9, y + T * 0.75, T * 0.4, T * 0.08);
        // rod leaning out over the water, line bobbing
        const tipX = x + T * 0.2, tipY = y - T * 0.9;
        ctx.strokeStyle = '#7a4a26';
        ctx.lineWidth = Math.max(1.5, T * 0.07);
        ctx.beginPath(); ctx.moveTo(x + T * 0.9, y + T * 0.9); ctx.lineTo(tipX, tipY); ctx.stroke();
        const bob = Math.sin(time / 420) * T * 0.06;
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - T * 0.35, y - T * 0.15 + bob); ctx.stroke();
        ctx.fillStyle = '#e8453c';
        ctx.beginPath(); ctx.arc(tipX - T * 0.35, y - T * 0.15 + bob, T * 0.09, 0, Math.PI * 2); ctx.fill();
        // sign with the game icon
        ctx.font = `${T * 0.7}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sp.icon || '🎣', x + W / 2, y + H * 0.45);
        drawSpotPadAndStatus(ctx, sp, T, time, status, x + W / 2, y - T * 1.05);
      },
    };
  }

  // Minigame pavilion: footprint MINIGAME_SPOT (3x2), pad tile in front.
  function spotDrawable(sp, T, time, status) {
    if (sp.game === 'fishing') return dockDrawable(sp, T, time, status);
    if (Art.spots && Art.spots[sp.game]) {
      const { w: sw, h: sh } = P.MINIGAME_SPOT;
      return { depth: sp.y + sh, draw(ctx) { Art.spots[sp.game](ctx, sp, sp.x * T, sp.y * T, sw * T, sh * T, T, time, status); drawSpotPadAndStatus(ctx, sp, T, time, status, (sp.x + sw / 2) * T, (sp.y - 1.05) * T); } };
    }
    const { w, h } = P.MINIGAME_SPOT;
    const x = sp.x * T, y = sp.y * T, W = w * T, H = h * T;
    return {
      depth: sp.y + h,
      draw(ctx) {
        ctx.fillStyle = 'rgba(0,0,0,.15)';
        ctx.beginPath(); ctx.ellipse(x + W / 2, y + H, W * 0.55, T * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        // platform
        ctx.fillStyle = '#8a5a35';
        roundRect(ctx, x + T * 0.1, y + H - T * 0.7, W - T * 0.2, T * 0.6, T * 0.12); ctx.fill();
        ctx.fillStyle = '#a8713f';
        ctx.fillRect(x + T * 0.1, y + H - T * 0.7, W - T * 0.2, T * 0.14);
        // posts
        ctx.fillStyle = '#5b3a22';
        ctx.fillRect(x + T * 0.3, y + T * 0.2, T * 0.16, H - T * 0.6);
        ctx.fillRect(x + W - T * 0.46, y + T * 0.2, T * 0.16, H - T * 0.6);
        // roof in the game's color
        ctx.fillStyle = sp.color || '#7a3b2e';
        ctx.beginPath();
        ctx.moveTo(x - T * 0.25, y + T * 0.45);
        ctx.quadraticCurveTo(x + W / 2, y - T * 0.6, x + W + T * 0.25, y + T * 0.45);
        ctx.lineTo(x + W - T * 0.1, y + T * 0.15);
        ctx.quadraticCurveTo(x + W / 2, y - T * 0.85, x + T * 0.1, y + T * 0.15);
        ctx.closePath(); ctx.fill();
        // sign with the game icon
        ctx.font = `${T * 0.75}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(sp.icon || '🥋', x + W / 2, y + H * 0.48);
        drawSpotPadAndStatus(ctx, sp, T, time, status, x + W / 2, y - T * 1.05);
      },
    };
  }

  class World {
    constructor(canvas, handlers = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.handlers = handlers;
      this.room = null;
      this.players = new Map();
      this.youId = null;
      this.hover = null;
      this.marker = null;
      this.T = 24; this.ox = 0; this.oy = 0;
      this.running = false;
      this.last = performance.now();

      canvas.addEventListener('mousemove', (e) => this.onMouse(e));
      canvas.addEventListener('mouseleave', () => { this.hover = null; });
      canvas.addEventListener('click', (e) => {
        const t = this.tileFromEvent(e);
        if (t && this.handlers.onTileClick) this.handlers.onTileClick(t);
      });
      new ResizeObserver(() => this.layout()).observe(canvas);
    }

    tileFromEvent(e) {
      if (!this.room) return null;
      const r = this.canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left - this.ox) / this.T);
      const y = Math.floor((e.clientY - r.top - this.oy) / this.T);
      if (x < 0 || y < 0 || x >= this.room.width || y >= this.room.height) return null;
      return { x, y };
    }

    onMouse(e) {
      this.hover = this.tileFromEvent(e);
      const portal = this.hover && P.portalAt(this.room, this.hover.x, this.hover.y);
      const spot = this.hover && (P.spotAt(this.room, this.hover.x, this.hover.y) || World.interactAt(this.room, this.hover.x, this.hover.y));
      this.canvas.style.cursor = portal || spot ? 'pointer' : this.hover && P.isWalkable(this.room, this.hover.x, this.hover.y) ? 'crosshair' : 'default';
    }

    layout() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
      if (this.room) {
        // Fit the whole room in the window whatever its size or shape, so exits on the edges
        // (the Sports Park gate, the Grotto path) are never cropped. The spare margin is filled
        // with matching scenery by drawSurroundings, so it does not look letterboxed.
        this.T = Math.min(w / this.room.width, h / this.room.height);
        this.ox = (w - this.room.width * this.T) / 2;
        this.oy = (h - this.room.height * this.T) / 2;
      }
      this.vw = w; this.vh = h;
    }

    setRoom(room, players, youId, opts = {}) {
      this.room = room;
      this.spotStatus = (room && room.spotStatus) || {};
      this.youId = youId;
      this.players.clear();
      for (const p of players) this.addPlayer(p);
      this.marker = null;
      this.cache = room ? { floor: floorOf(room), covered: coverMap(room) } : null;
      this.theme = room ? themeOf(room, this.cache.floor) : 'forest';
      if (this.cache) this.cache.theme = this.theme;
      this.springs = room ? (room.props || []).filter((p) => p.type === 'hotspring') : [];
      this.particles = [];
      // A map trip holds the fade and title until the map lifts (see reveal).
      if (opts.held) this.enteredAt = -1e9;
      else if (!opts.quiet) { this.enteredAt = performance.now(); this.skipFade = false; }
      this.layout();
    }

    // Show the room title now, without the fade from black: the map is what is fading away.
    reveal() { this.enteredAt = performance.now(); this.skipFade = true; }

    // Hour of day used for lighting. Tests and screenshots can pin it with world.hourOverride.
    hour() {
      if (this.hourOverride != null) return this.hourOverride;
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60;
    }

    addPlayer(p) {
      this.players.set(p.id, { ...p, px: p.x + 0.5, py: p.y + 0.5, path: [], bubble: null, emote: null, facing: 0 });
    }
    removePlayer(id) { this.players.delete(id); }
    updateLook(p) {
      const n = this.players.get(p.id);
      if (n) Object.assign(n, { name: p.name, color: p.color, headband: p.headband, belt: p.belt, role: p.role, accessories: p.accessories });
    }
    movePlayer(id, from, to) {
      const n = this.players.get(id);
      if (!n || !this.room) return;
      const cur = { x: Math.floor(n.px), y: Math.floor(n.py) };
      const path = P.findPath(this.room, cur, to) || P.findPath(this.room, from, to) || [to];
      n.path = path.slice(1);
      n.x = to.x; n.y = to.y;
      n.arrived = false;
    }
    say(id, text) {
      const n = this.players.get(id);
      if (n) n.bubble = { text, at: performance.now() };
    }
    emote(id, emote) {
      const n = this.players.get(id);
      if (n) n.emote = { glyph: P.EMOTES[emote] || '❔', at: performance.now() };
    }
    // A small number or icon that rises off a ninja's head.
    floatText(id, text) {
      const n = this.players.get(id);
      if (n) n.float = { text, at: performance.now() };
    }
    showMarker(t, ok) { this.marker = { ...t, ok, at: performance.now() }; }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        this.update(dt);
        this.draw(now);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      // requestAnimationFrame pauses while the window is hidden or minimized; keep walks
      // (and door arrivals) moving so the player is not stuck outside a door.
      this.hiddenTicker = setInterval(() => {
        const now = performance.now();
        if (now - this.last < 250) return;
        this.update(Math.min(0.25, (now - this.last) / 1000));
        this.last = now;
      }, 100);
    }
    stop() { this.running = false; clearInterval(this.hiddenTicker); }

    update(dt) {
      for (const n of this.players.values()) {
        // The frozen lake at the summit is quicker to cross than snow.
        const onIce = this.theme === 'summit' && this.room && P.tileAt(this.room, Math.floor(n.px), Math.floor(n.py)) === '*';
        let budget = WALK_SPEED * dt * (onIce ? 1.8 : 1);
        n.walking = n.path.length > 0;
        while (budget > 0 && n.path.length) {
          const t = n.path[0];
          const tx = t.x + 0.5, ty = t.y + 0.5;
          const dx = tx - n.px, dy = ty - n.py;
          const d = Math.hypot(dx, dy);
          if (Math.abs(dx) > 0.01) n.facing = Math.sign(dx);
          if (d <= budget) { n.px = tx; n.py = ty; n.path.shift(); budget -= d; }
          else { n.px += (dx / d) * budget; n.py += (dy / d) * budget; budget = 0; }
        }
        if (!n.path.length && !n.arrived) {
          n.arrived = true;
          if (n.id === this.youId && this.handlers.onArrive) this.handlers.onArrive({ x: n.x, y: n.y });
        }
      }
      if (this.room) updateParticles(this, dt);
    }

    draw(now) {
      const { ctx, canvas, room } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, '#dff3fb'); g.addColorStop(1, '#bfe3f2');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!room) return;
      const T = this.T;
      const dpr = this.dpr || 1;
      const light = lightingFor(this.theme, this.hour());
      const mt = this.mountain;
      const env = {
        hour: this.hour(), night: Math.min(1, light.dark / 0.5), warm: light.warm,
        weather: mt && mt.weather.id, beacon: mt && mt.beacon.lit, beaconRings: mt && mt.beacon.rings, beaconGoal: mt && mt.beacon.goal,
        bellAt: this.bellAt, bellRung: mt && mt.bell.rung,
      };
      ctx.setTransform(dpr, 0, 0, dpr, this.ox * dpr, this.oy * dpr);

      // Visible tile range, including the margin around the room.
      const vw = this.vw || canvas.width / dpr, vh = this.vh || canvas.height / dpr;
      const view = {
        x0: Math.floor(-this.ox / T) - 1, y0: Math.floor(-this.oy / T) - 1,
        x1: Math.ceil((vw - this.ox) / T) + 1, y1: Math.ceil((vh - this.oy) / T) + 1,
      };
      drawSurroundings(ctx, room, T, now, view, this.theme, this.cache);
      drawTiles(ctx, room, T, now, this.cache);
      drawRoomEdge(ctx, room, T);
      const hoverPortal = this.hover && P.portalAt(room, this.hover.x, this.hover.y);
      drawPortals(ctx, room, T, now, hoverPortal);

      if (this.hover && !hoverPortal) {
        const ok = P.isWalkable(room, this.hover.x, this.hover.y);
        ctx.strokeStyle = ok ? 'rgba(47,111,209,.55)' : 'rgba(232,69,60,.35)';
        ctx.lineWidth = 2;
        roundRect(ctx, this.hover.x * T + 2, this.hover.y * T + 2, T - 4, T - 4, T * 0.2);
        ctx.stroke();
      }
      if (this.marker && now - this.marker.at < 600) {
        const k = (now - this.marker.at) / 600;
        ctx.strokeStyle = this.marker.ok ? `rgba(47,111,209,${1 - k})` : `rgba(232,69,60,${1 - k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse((this.marker.x + 0.5) * T, (this.marker.y + 0.6) * T, T * (0.2 + k * 0.4), T * (0.1 + k * 0.2), 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Depth-sorted props and ninjas
      const drawables = [];
      for (const p of room.props || []) {
        const d = propDrawable(p, T, now, env);
        if (d) drawables.push(d);
      }
      if (mt && ART_THEMES.has(this.theme)) {
        for (const f of mt.finds) if (f.room === room.id) drawables.push({ depth: f.y + 0.7, draw: (c) => Art.drawWorldFind(c, f, T, now) });
      }
      for (const sp of room.minigames || []) drawables.push(spotDrawable(sp, T, now, (this.spotStatus || {})[sp.id]));
      for (const n of this.players.values()) {
        drawables.push({
          depth: n.py + 0.45,
          draw: (c) => {
            const pos = drawNinja(c, { ...n, x: n.px, y: n.py }, T, now, { you: n.id === this.youId });
            n._top = pos.top;
            if (this.springs.some((p) => n.px >= p.x + 0.3 && n.px <= p.x + (p.w || 1) - 0.3 && n.py >= p.y + 0.3 && n.py <= p.y + (p.h || 1) - 0.1)) Art.drawSoak(c, pos.cx, pos.feet, T, now);
            const star = n.role === 'grandmaster' ? '★ ' : n.role === 'sensei' ? '☆ ' : '';
            drawLabel(c, star + n.name, pos.cx, pos.feet + T * 0.15, T, { bg: n.id === this.youId ? 'rgba(47,111,209,.85)' : 'rgba(0,0,0,.5)' });
          },
        });
      }
      drawables.sort((a, b) => a.depth - b.depth);
      for (const d of drawables) d.draw(ctx);

      // Time of day, then lights and ambient particles on top of the scene.
      drawLighting(ctx, room, T, now, view, light, env);
      if (ART_THEMES.has(this.theme)) Art.overlay(ctx, room, T, now, view, env, this.springs);
      drawParticles(ctx, this.particles, T, now, light);

      // Overlays above everything: exit signs, door labels, bubbles, emotes
      for (const p of room.portals || []) {
        const edge = portalEdge(room, p, SIGN_SLACK);
        if (edge && p !== hoverPortal) drawExitSign(ctx, p, edge, T, now, false);
      }
      const hoverSpot = this.hover && P.spotAt(room, this.hover.x, this.hover.y);
      const hoverNpc = this.hover && World.interactAt(room, this.hover.x, this.hover.y);
      if (hoverSpot) drawLabel(ctx, `Play ${hoverSpot.name || hoverSpot.game}`, (hoverSpot.x + P.MINIGAME_SPOT.w / 2) * T, hoverSpot.y * T - T * 1.7, T, { bg: 'rgba(245,184,46,.95)', color: '#1b2a36' });
      if (hoverNpc) drawLabel(ctx, hoverNpc.hover || `Talk to ${hoverNpc.name || 'Sensei'}`, (hoverNpc.x + (hoverNpc.w || 1) / 2) * T, hoverNpc.y * T - T * 1.9, T, { bg: 'rgba(245,184,46,.95)', color: '#1b2a36' });
      if (hoverPortal) {
        const edge = portalEdge(room, hoverPortal, SIGN_SLACK);
        if (edge) drawExitSign(ctx, hoverPortal, edge, T, now, true);
        else drawLabel(ctx, `To ${hoverPortal.label}`, (hoverPortal.x + (hoverPortal.w || 1) / 2) * T, hoverPortal.y * T - T * 0.9, T, { bg: 'rgba(245,184,46,.95)', color: '#1b2a36' });
      }
      for (const n of this.players.values()) {
        const cx = n.px * T;
        let top = (n._top ?? n.py * T - T) - T * 0.25;
        if (n.float) {
          const age = now - n.float.at;
          if (age > 1500) n.float = null;
          else {
            ctx.font = `800 ${Math.max(13, T * 0.62)}px Nunito, "Segoe UI", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, T * 0.14); ctx.strokeStyle = 'rgba(20,32,44,.85)';
            ctx.globalAlpha = Math.min(1, (1500 - age) / 400);
            const fy = top - (age / 1500) * T * 1.4;
            ctx.strokeText(n.float.text, cx, fy);
            ctx.fillStyle = '#ffd54f';
            ctx.fillText(n.float.text, cx, fy);
            ctx.globalAlpha = 1;
          }
        }
        if (n.emote) {
          const age = now - n.emote.at;
          if (age > EMOTE_MS) n.emote = null;
          else {
            ctx.font = `${T * 1.1}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.globalAlpha = Math.min(1, (EMOTE_MS - age) / 400);
            ctx.fillText(n.emote.glyph, cx, top - Math.sin(age / 150) * T * 0.1);
            ctx.globalAlpha = 1;
            top -= T * 1.2;
          }
        }
        if (n.bubble) {
          const age = now - n.bubble.at;
          if (age > BUBBLE_MS) n.bubble = null;
          else {
            ctx.globalAlpha = Math.min(1, (BUBBLE_MS - age) / 500);
            drawBubble(ctx, n.bubble.text, cx, top, T);
            ctx.globalAlpha = 1;
          }
        }
      }

      // Screen-space finish: a soft vignette, then the fade-in and room title after a door.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vg = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.45, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.6);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,.22)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vw, vh);
      const age = now - (this.enteredAt || -1e9);
      if (age < 450 && !this.skipFade) {
        ctx.fillStyle = `rgba(10,16,24,${1 - age / 450})`;
        ctx.fillRect(0, 0, vw, vh);
      }
      if (age < TITLE_MS) {
        const a = Math.min(1, age / 300) * Math.min(1, (TITLE_MS - age) / 600);
        const size = Math.max(28, Math.min(72, T * 2));
        const ty = this.oy + room.height * T * 0.3 - (1 - Math.min(1, age / 400)) * size * 0.3;
        ctx.globalAlpha = a;
        ctx.font = `${size}px Bangers, Impact, "Trebuchet MS", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.14;
        ctx.strokeStyle = 'rgba(20,32,44,.85)';
        const title = room.name.toUpperCase();
        ctx.strokeText(title, vw / 2, ty);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(title, vw / 2, ty);
        ctx.font = `700 ${Math.round(size * 0.28)}px Nunito, "Segoe UI", sans-serif`;
        const sub = ART_THEMES.has(this.theme) && mt ? mt.weather.name : timeOfDayName(this.hour(), this.theme);
        ctx.lineWidth = size * 0.07;
        ctx.strokeText(sub, vw / 2, ty + size * 0.62);
        ctx.fillStyle = '#f5b82e';
        ctx.fillText(sub, vw / 2, ty + size * 0.62);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawBubble(ctx, text, cx, bottom, T) {
    const size = Math.max(11, T * 0.45);
    ctx.font = `600 ${size}px Nunito, "Segoe UI", sans-serif`;
    const maxW = Math.max(120, T * 7);
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
    const lh = size * 1.25;
    const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + size * 1.2;
    const h = lines.length * lh + size * 0.7;
    const x = cx - w / 2, y = bottom - h - size * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(27,42,54,.25)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, size * 0.6);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.4, y + h - 0.5); ctx.lineTo(cx, y + h + size * 0.55); ctx.lineTo(cx + size * 0.4, y + h - 0.5);
    ctx.fill();
    ctx.fillStyle = '#1b2a36';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, cx, y + size * 0.35 + i * lh));
  }

  // Static render for previews and the map editor.
  World.drawStatic = function (ctx, room, T, opts = {}) {
    const now = performance.now();
    drawTiles(ctx, room, T, now);
    drawPortals(ctx, room, T, now, null);
    if (opts.props !== false) {
      const list = [...(room.props || []).map((p) => propDrawable(p, T, now)), ...(room.minigames || []).map((sp) => spotDrawable(sp, T, now, null))]
        .filter(Boolean).sort((a, b) => a.depth - b.depth);
      for (const d of list) d.draw(ctx);
    }
  };
  World.drawNinja = drawNinja;
  // The NPC standing on a tile (Sensei Oru in the Main Dojo), or null.
  World.portalEdge = portalEdge;
  // Anything on a tile you can walk up to and use: an NPC, or a prop such as the Summit Bell.
  World.interactAt = function (room, x, y) {
    return World.npcAt(room, x, y) || (room && room.props || []).find((p) => p.interact && x >= p.x && x < p.x + (p.w || 1) && y >= p.y && y < p.y + (p.h || 1)) || null;
  };
  World.npcAt = function (room, x, y) {
    return (room && room.props || []).find((p) => p.type === 'npc' && p.x === x && p.y === y) || null;
  };

  window.ClubDojoWorld = World;
})();
