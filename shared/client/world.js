// Canvas renderer for a village room: tiles, props, ninjas, chat bubbles, emotes.
// Simple vector shapes for v1 art. Also used by the admin Map Editor (World.drawStatic).
(function () {
  const P = window.ClubDojoProtocol;
  const WALK_SPEED = 6.5; // tiles per second
  const BUBBLE_MS = 6000;
  const EMOTE_MS = 2500;

  const COVERING_PROPS = new Set(['forest', 'mountains', 'building', 'wall', 'counter', 'table', 'tree', 'dummy', 'npc']);

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

  function drawTile(ctx, c, x, y, T, time, floor, covered) {
    const px = x * T, py = y * T;
    const n = hash(x, y);
    if (c === '#' && covered) c = floor;
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

  function drawTiles(ctx, room, T, time) {
    const floor = floorOf(room);
    const covered = coverMap(room);
    for (let y = 0; y < room.height; y++) {
      const row = room.tiles[y];
      for (let x = 0; x < room.width; x++) drawTile(ctx, row[x], x, y, T, time, floor, covered.has(y * room.width + x));
    }
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

  // Props: each returns its depth (bottom edge in tile units) and a draw function.
  function propDrawable(p, T, time) {
    const x = p.x * T, y = p.y * T, w = (p.w || 1) * T, h = (p.h || 1) * T;
    const depth = p.type === 'mountains' || p.type === 'forest' || p.type === 'wall' ? -1 : p.y + (p.h || 1);
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
      npc(ctx) {
        drawNinja(ctx, { x: p.x + 0.5, y: p.y + 0.5, color: '#f3f8fb', headband: '#f5b82e', belt: 'black' }, T, time);
        drawLabel(ctx, p.name || 'Sensei', x + T / 2, y + T * 0.75, T, { bg: 'rgba(122,59,46,.85)' });
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

  // Minigame pavilion: footprint MINIGAME_SPOT (3x2), pad tile in front.
  function spotDrawable(sp, T, time, status) {
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
        // pad
        const pad = P.spotPad(sp);
        const glow = 0.35 + Math.sin(time / 380) * 0.15;
        ctx.strokeStyle = `rgba(245,184,46,${glow + 0.3})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        roundRect(ctx, pad.x * T + 3, pad.y * T + 3, T - 6, T - 6, T * 0.25); ctx.stroke();
        ctx.setLineDash([]);
        if (status && status.count) {
          const label = status.phase === 'lobby' ? `${status.count}/${status.max} waiting` : `${status.count} playing`;
          drawLabel(ctx, label, x + W / 2, y - T * 1.05, T, { bg: status.phase === 'lobby' ? 'rgba(63,191,127,.92)' : 'rgba(232,69,60,.92)' });
        }
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
      const spot = this.hover && P.spotAt(this.room, this.hover.x, this.hover.y);
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
        // Cover the window (crop the edges slightly if the aspect differs) so the world fills it like the mockup.
        const fit = Math.min(w / this.room.width, h / this.room.height);
        const cover = Math.max(w / this.room.width, h / this.room.height);
        this.T = Math.min(cover, fit * 1.06);
        this.ox = (w - this.room.width * this.T) / 2;
        this.oy = (h - this.room.height * this.T) / 2;
      }
    }

    setRoom(room, players, youId) {
      this.room = room;
      this.spotStatus = (room && room.spotStatus) || {};
      this.youId = youId;
      this.players.clear();
      for (const p of players) this.addPlayer(p);
      this.marker = null;
      this.layout();
    }

    addPlayer(p) {
      this.players.set(p.id, { ...p, px: p.x + 0.5, py: p.y + 0.5, path: [], bubble: null, emote: null, facing: 0 });
    }
    removePlayer(id) { this.players.delete(id); }
    updateLook(p) {
      const n = this.players.get(p.id);
      if (n) Object.assign(n, { name: p.name, color: p.color, headband: p.headband, belt: p.belt, role: p.role });
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
        let budget = WALK_SPEED * dt;
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
      ctx.setTransform(this.dpr, 0, 0, this.dpr, this.ox * this.dpr, this.oy * this.dpr);

      drawTiles(ctx, room, T, now);
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
        const d = propDrawable(p, T, now);
        if (d) drawables.push(d);
      }
      for (const sp of room.minigames || []) drawables.push(spotDrawable(sp, T, now, (this.spotStatus || {})[sp.id]));
      for (const n of this.players.values()) {
        drawables.push({
          depth: n.py + 0.45,
          draw: (c) => {
            const pos = drawNinja(c, { ...n, x: n.px, y: n.py }, T, now, { you: n.id === this.youId });
            n._top = pos.top;
            const star = n.role === 'grandmaster' ? '★ ' : n.role === 'sensei' ? '☆ ' : '';
            drawLabel(c, star + n.name, pos.cx, pos.feet + T * 0.15, T, { bg: n.id === this.youId ? 'rgba(47,111,209,.85)' : 'rgba(0,0,0,.5)' });
          },
        });
      }
      drawables.sort((a, b) => a.depth - b.depth);
      for (const d of drawables) d.draw(ctx);

      // Overlays above everything: door labels, bubbles, emotes
      const hoverSpot = this.hover && P.spotAt(room, this.hover.x, this.hover.y);
      if (hoverSpot) drawLabel(ctx, `Play ${hoverSpot.name || hoverSpot.game}`, (hoverSpot.x + P.MINIGAME_SPOT.w / 2) * T, hoverSpot.y * T - T * 1.7, T, { bg: 'rgba(245,184,46,.95)', color: '#1b2a36' });
      if (hoverPortal) drawLabel(ctx, `To ${hoverPortal.label}`, (hoverPortal.x + (hoverPortal.w || 1) / 2) * T, hoverPortal.y * T - T * 0.9, T, { bg: 'rgba(245,184,46,.95)', color: '#1b2a36' });
      for (const n of this.players.values()) {
        const cx = n.px * T;
        let top = (n._top ?? n.py * T - T) - T * 0.25;
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

  window.ClubDojoWorld = World;
})();
