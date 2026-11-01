// Career badges on a lanyard rail: a plain-JS port of the TeamLanyardRail React component.
// It reads <ol class="lanyards"> in the hero and turns each item into an ID badge that swings on a strap:
// hover to bring one forward, pull it down, click (or Enter) to flip it, Esc to turn it back.
// Wide screens hang every badge on one rail; narrow ones scroll the rail sideways with native scroll-snap.
(() => {
  const list = document.querySelector('.lanyards');
  if (!list) return;

  const RATIO = 96 / 62, MAX_W = 124, MIN_RAIL_W = 100, EM = 11.2;
  const RAIL_PITCH_MIN = 1.16, RAIL_PITCH_MAX = 1.62, CAROUSEL_PITCH = 1.2;
  const PERSPECTIVE = 900, MAX_STRETCH = 64, FIRST_DELAY = 1100, FLIP_DELAY = 700, INTERVAL = 2800;
  const SWING_K = 28, SWING_DAMP = 2.2, LAG = 0.12, REEL_K = 220, REEL_ZETA = 0.5;
  const REST_Y = [9, -10, 7, -8, 10, -7, 8, -9], REST_Z = [-1.6, 1.2, -2, 1.5, -1, 1.8, -1.3, 2], DROPS = [6, 20, 0, 13, 22, 4, 16, 9];
  const SAY = {
    rail: 'Where I have studied and worked. Brush along the rail, pull a badge down, click one to flip it.',
    carousel: 'Where I have studied and worked. Swipe along the rail, tap a badge to flip it.',
    flip: 'Click or press Enter to flip the badge', back: 'Click again or press Esc to turn it back',
    tapFlip: 'Tap the badge to flip it', tapBack: 'Tap again to turn it back',
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (v) => `${+v.toFixed(2)}px`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const linkIcon = (href) => (href.startsWith('#') ? 'fa-arrow-down' : href.startsWith('mailto:') ? 'fa-envelope' : 'fa-arrow-up-right-from-square');

  const items = [...list.children].map((li) => ({
    name: li.querySelector(':scope > b').textContent.trim(),
    role: li.querySelector(':scope > span').textContent.trim(),
    team: li.querySelector(':scope > em')?.textContent.trim() || '',
    bio: li.querySelector(':scope > p')?.textContent.trim() || '',
    tags: [...li.querySelectorAll(':scope > ul > li')].slice(0, 3).map((t) => t.textContent.trim()),
    links: [...li.querySelectorAll(':scope > a')].slice(0, 3).map((a) => ({ label: a.textContent.trim(), href: a.getAttribute('href') })),
    icon: li.dataset.icon,
    tone: li.style.getPropertyValue('--tone').trim(),
  }));
  const n = items.length;

  // ---- decorative print: a seeded barcode on the front, a QR-like grid on the back ----
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function random(seed) {
    let a = seed || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function qrPath(seed) {
    const size = 21, next = random(seed), corners = [[0, 0], [size - 7, 0], [0, size - 7]];
    let d = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = corners.find(([cx, cy]) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7);
      const quiet = (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
      const on = c ? Math.max(Math.abs(x - c[0] - 3), Math.abs(y - c[1] - 3)) !== 2
        : quiet ? false : x === 6 || y === 6 ? (x + y) % 2 === 0 : next() > 0.52;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
    return d;
  }
  function barcode(seed) {
    const next = random(seed ^ 0x9e3779b9);
    let x = 0, d = '';
    while (x < 92) {
      const w = 1 + Math.floor(next() * 3);
      d += `M${x} 0h${w}v20h-${w}z`;
      x += w + 1 + Math.floor(next() * 2.2);
    }
    return { d, width: x };
  }

  // ---- geometry: every length scales with the badge width W (124 px at full size) ----
  function geometry(W) {
    const u = W / MAX_W, H = W * RATIO;
    const railR = Math.max(3, 4.2 * u), railY = 14 + railR, ring = 9 * u, pivotY = railY + ring * 0.8;
    const strapW = Math.max(8, 11 * u), crimp = 6 * u, reel = 21 * u, cordRest = 12 * u, clipH = 13 * u, clipW = 30 * u, base = 56 * u;
    const straps = items.map((_, i) => base + DROPS[i % DROPS.length] * u);
    const reelTops = straps.map((len) => pivotY + len + crimp * 0.6);
    const clipTops = reelTops.map((top) => top + reel * 0.82 + cordRest);
    const cardTops = clipTops.map((top) => top + clipH * 0.62);
    const pendulum = cardTops.map((top) => top + H / 2 - pivotY);
    const restLength = pivotY + base + crimp * 0.6 + reel * 0.82 + cordRest + clipH * 0.62 + H / 2 - pivotY;
    return {
      W, H, u, railR, railY, ring, pivotY, strapW, crimp, reel, cordRest, clipH, clipW, straps, reelTops, clipTops, cardTops, pendulum,
      swingK: pendulum.map((len) => (SWING_K * restLength) / len),
      couple: pendulum.map((len) => (0.25 * 57.3) / len),
      maxStretch: Math.round(MAX_STRETCH * Math.min(1, W / 118)),
      height: Math.ceil(Math.max(...cardTops) + H + 16 * u + 8),
    };
  }

  // ---- DOM ----
  const stage = document.createElement('div');
  stage.className = 'ly-stage';
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', list.getAttribute('aria-label') || 'Career badges');
  stage.setAttribute('aria-roledescription', 'lanyard rail');
  const track = document.createElement('div');
  track.className = 'ly-track';
  stage.append(track);
  const dots = document.createElement('div');
  dots.className = 'ly-dots';
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', 'Show a badge');
  dots.innerHTML = items.map((it, i) => `<button type="button" data-dot="${i}" aria-label="Show ${esc(it.name)}"></button>`).join('');
  const caption = document.createElement('div');
  caption.className = 'ly-caption';
  caption.id = 'ly-caption';
  caption.innerHTML = '<p></p><p></p><span class="sr"></span>';
  list.replaceWith(stage, dots, caption); // the list stays in the HTML source for crawlers and no-JS readers

  function faces(it, seed) {
    const bars = barcode(seed), digits = String(seed % 1e9).padStart(9, '0');
    const band = (tall) => `<span class="ly-band${tall ? ' tall' : ''}"></span><span class="ly-hole"></span>`;
    const finish = '<span class="ly-gloss"></span><span class="ly-shade"></span>';
    return `<span class="ly-face ly-front">${band(true)}
<span class="ly-avatar"><span><i class="fa-solid ${esc(it.icon)}" aria-hidden="true"></i></span></span>
<span class="ly-name ly-t">${esc(it.name)}</span><span class="ly-role ly-t">${esc(it.role)}</span>${it.team ? `<span class="ly-team ly-t">${esc(it.team)}</span>` : ''}
<span class="ly-code"><svg viewBox="0 0 ${bars.width} 20" preserveAspectRatio="none" aria-hidden="true"><path d="${bars.d}"/></svg><span>${digits}</span></span>${finish}</span>
<span class="ly-face ly-back">${band(false)}
<span class="ly-head2"><b class="ly-t">${esc(it.name)}</b><span class="ly-t">${esc(it.role)}</span></span>
${it.bio ? `<span class="ly-bio"><span>${esc(it.bio)}</span></span>` : ''}
${it.tags.length ? `<span class="ly-tags">${it.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span>` : ''}
${it.links.length ? `<span class="ly-row">${it.links.map((l) => `<span><i class="fa-solid ${linkIcon(l.href)}" aria-hidden="true"></i>${esc(l.label)}</span>`).join('')}</span>` : ''}
<svg class="ly-qr" viewBox="-1 -1 23 23" aria-hidden="true"><path d="${qrPath(seed)}"/></svg>${finish}</span>
<span class="ly-edge"></span><span class="ly-edge r"></span>`;
  }

  function slotHTML(it, i) {
    const { W, H, u } = g, strap = g.straps[i], reelTop = g.reelTops[i], clipTop = g.clipTops[i];
    const off = g.cardTops[i] - clipTop, base = W / EM, mid = W / 2;
    return `<div class="ly-slot" style="--tone:${esc(it.tone)};left:${px(s.x[i] - mid)};width:${px(W)};height:${px(g.height)}">
<span class="ly-ring" style="left:${px(mid - 4.5 * u)};top:${px(g.railY - g.ring)};width:${px(9 * u)};height:${px(g.ring * 2)};border-width:${px(Math.max(1.6, 2.2 * u))}"></span>
<span class="ly-swing" style="transform-origin:${px(mid)} ${px(g.pivotY)}">
<span class="ly-strap-shadow" style="left:${px(mid - g.strapW / 2 + 3 * u)};top:${px(g.pivotY + 3)};width:${px(g.strapW)};height:${px(strap)}"></span>
<span class="ly-strap" style="left:${px(mid - g.strapW / 2)};top:${px(g.pivotY - 2)};width:${px(g.strapW)};height:${px(strap + 2)}"><span class="ly-fold" style="height:${px(7 * u)}"></span><span class="ly-seam" style="top:${px(9 * u)}"></span></span>
<svg class="ly-buckle" aria-hidden="true" style="left:${px(mid - g.strapW * 0.75)};top:${px(g.pivotY - 4 * u)};width:${px(g.strapW * 1.5)};height:${px(8 * u)}" viewBox="0 0 30 16" preserveAspectRatio="none"><rect x="2" y="3" width="26" height="10" rx="5"/><path d="M7 4.5H23"/></svg>
<span class="ly-crimp" style="left:${px(mid - g.strapW / 2 - 1.5)};top:${px(g.pivotY + strap - g.crimp * 0.4)};width:${px(g.strapW + 3)};height:${px(g.crimp)}"></span>
<span class="ly-reel" style="left:${px(mid - g.reel / 2)};top:${px(reelTop)};width:${px(g.reel)};height:${px(g.reel)}"></span>
<span class="ly-cord" style="left:${px(mid - 0.75)};top:${px(reelTop + g.reel * 0.82)};height:${px(g.cordRest)}"></span>
<span class="ly-hang" style="top:${px(clipTop)};width:${px(W)};height:${px(off + H)};transform-origin:${px(mid)} 0">
<span class="ly-shadow-blur" style="top:${px(off)};width:${px(W)};height:${px(H)};filter:blur(${px(Math.max(4, 8 * u))})"><span class="ly-shadow"></span></span>
<button type="button" class="ly-badge" data-badge="${i}" tabindex="-1" aria-label="${esc(it.name)}, ${esc(it.role)}" aria-describedby="ly-caption" aria-pressed="false" style="top:${px(off)};width:${px(W)};height:${px(H)};font-size:${px(base)}"><span class="ly-flip">${faces(it, hash(it.name))}</span></button>
<span class="ly-clip" style="left:${px(mid - g.clipW / 2)};width:${px(g.clipW)};height:${px(g.clipH + 10 * u)}"><span class="ly-clip-tab" style="top:${px(g.clipH * 0.7)};width:${px(g.clipW * 0.42)};height:${px(off - g.clipH * 0.7 + 1.02 * base)}"></span><span class="ly-clip-head" style="height:${px(g.clipH)}"></span><span class="ly-clip-hole" style="top:${px(g.clipH * 0.14)};width:${px(g.clipH * 0.34)};height:${px(g.clipH * 0.34)}"></span></span>
<span class="ly-links" style="top:${px(off)};width:${px(W)};height:${px(H)};font-size:${px(base)}"><span>${it.links.map((l) => `<a href="${esc(l.href)}"><i class="fa-solid ${linkIcon(l.href)}" aria-hidden="true"></i>${esc(l.label)}</a>`).join('')}</span></span>
</span></span></div>`;
  }

  // ---- state ----
  const KEYS = ['x', 'sw', 'vsw', 'beta', 'ry', 'vry', 'tr', 'rz', 'vrz', 'tz', 'lift', 'vlift', 'tl', 'pop', 'vpop', 'tp', 'st', 'vst'];
  const s = { pull: -1, raf: 0, last: 0, scroll: 0, pv: 0 };
  KEYS.forEach((k) => { s[k] = new Array(n).fill(0); });
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = media.matches;
  let size = { width: 0, W: MAX_W, carousel: false }, g = geometry(MAX_W), els = [];
  let active = null, flipped = null, focusIndex = 0, pendingOpen = -1;
  const pointer = { id: -1, index: -1, x: 0, y: 0, mode: '', kind: '', lastT: 0, hoverX: 0, hoverT: 0, hoverHit: -1 };

  function render(width) {
    const railW = Math.min(MAX_W, (width - 40) / (n * RAIL_PITCH_MIN + 0.4));
    const carousel = railW < MIN_RAIL_W;
    const W = Math.round((carousel ? clamp(width * 0.3, 96, 118) : railW) * 4) / 4;
    if (els.length && Math.abs(size.width - width) < 0.5 && size.W === W && size.carousel === carousel) return;
    const fresh = !els.length || size.carousel !== carousel;
    const focused = els.findIndex((e) => e.slot.contains(document.activeElement));
    size = { width, W, carousel };
    g = geometry(W);
    let trackW = width;
    if (carousel) {
      const pitch = W * CAROUSEL_PITCH;
      s.x = items.map((_, i) => width / 2 + i * pitch);
      trackW = width + (n - 1) * pitch;
    } else {
      const pitch = clamp((width - 40 - W * 0.6) / n, W * RAIL_PITCH_MIN, W * RAIL_PITCH_MAX);
      s.x = items.map((_, i) => width / 2 + (i - (n - 1) / 2) * pitch);
    }
    stage.classList.toggle('is-carousel', carousel);
    dots.hidden = !carousel;
    track.style.width = px(trackW);
    track.style.height = px(g.height);
    track.innerHTML = `<span class="ly-rail" aria-hidden="true" style="top:${px(g.railY - g.railR)};height:${px(g.railR * 2)}">${carousel ? '' : '<span class="ly-bracket"></span><span class="ly-bracket r"></span>'}</span>`
      + items.map(slotHTML).join('');
    els = [...track.querySelectorAll('.ly-slot')].map((slot) => ({
      slot, swing: slot.querySelector('.ly-swing'), cord: slot.querySelector('.ly-cord'), hang: slot.querySelector('.ly-hang'),
      button: slot.querySelector('.ly-badge'), flip: slot.querySelector('.ly-flip'), shadow: slot.querySelector('.ly-shadow'), links: slot.querySelector('.ly-links'),
    }));
    retarget(fresh);
    for (let i = 0; i < n; i++) paint(i);
    if (focused >= 0) els[focused].button.focus({ preventScroll: true });
    if (carousel) center(active ?? focusIndex, false);
  }

  function paint(i) {
    const e = els[i];
    if (!e) return;
    const sw = s.sw[i], st = s.st[i], lift = s.lift[i], pop = s.pop[i], ry = s.ry[i];
    e.swing.style.transform = `rotate(${sw.toFixed(3)}deg)`;
    e.cord.style.transform = `scaleY(${Math.max(0.12, (g.cordRest + st) / g.cordRest).toFixed(4)})`;
    e.hang.style.transform = `translate3d(0,${(st - 4 * lift).toFixed(2)}px,0) rotate(${(s.beta[i] - sw + s.rz[i]).toFixed(3)}deg) scale(${(1 + 0.08 * pop).toFixed(4)})`;
    const facing = Math.abs(Math.cos((ry * Math.PI) / 180));
    e.flip.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${ry.toFixed(2)}deg)`;
    e.flip.style.setProperty('--shade', ((1 - facing) * 0.45).toFixed(3));
    e.flip.style.setProperty('--gx', `${((((((ry + 90) % 180) + 180) % 180) - 90) * 0.9).toFixed(1)}%`);
    const grow = 1 + 0.03 * lift + 0.05 * pop;
    e.shadow.style.transform = `translate3d(${(g.W * 0.045 + lift * 3 * g.u).toFixed(2)}px,${(g.H * 0.03 + lift * 7 * g.u).toFixed(2)}px,0) scale(${(Math.max(0.12, facing) * grow).toFixed(3)},${grow.toFixed(3)})`;
    e.shadow.style.opacity = (0.72 + 0.28 * lift).toFixed(3);
    // real links show from 9° off the back, and stay through the spring's overshoot so a focused link never blinks out
    const on = Math.abs(ry - 180) < (e.links.style.visibility === 'visible' ? 24 : 9);
    e.links.style.opacity = on ? '1' : '0';
    e.links.style.visibility = on ? 'visible' : 'hidden';
    e.flip.style.setProperty('--drawn', on ? '0' : '1');
  }

  // ---- physics: damped springs for turn, tilt, lift and the retractable cord; a pendulum for the swing ----
  function spring(key, i, target, k, zeta, h) {
    const v = s['v' + key][i], x = s[key][i];
    const next = v + (-k * (x - target) - 2 * zeta * Math.sqrt(k) * v) * h;
    s['v' + key][i] = next;
    s[key][i] = x + next * h;
  }

  function cardEdge(i, side) {
    const theta = (s.sw[i] * Math.PI) / 180, psi = ((s.beta[i] + s.rz[i]) * Math.PI) / 180, scale = 1 + 0.08 * s.pop[i];
    const depth = g.clipTops[i] + s.st[i] - 4 * s.lift[i] - g.pivotY, off = g.cardTops[i] - g.clipTops[i];
    const cx = s.x[i] - depth * Math.sin(theta), half = (g.W / 2) * scale * Math.cos(psi) * side;
    return [cx + half - off * scale * Math.sin(psi), cx + half - (off + g.H) * scale * Math.sin(psi), depth + off * scale, depth + (off + g.H) * scale];
  }

  // neighbours knock into each other instead of passing through
  function collide() {
    for (let a = 0; a < n - 1; a++) {
      const b = a + 1;
      const [aTop, aBottom, aArmTop, aArmBottom] = cardEdge(a, 1);
      const [bTop, bBottom, bArmTop, bArmBottom] = cardEdge(b, -1);
      const topExcess = aTop - bTop + 2, bottomExcess = aBottom - bBottom + 2, excess = Math.max(topExcess, bottomExcess);
      if (excess <= 0) continue;
      const arm = Math.max(40, topExcess > bottomExcess ? (aArmTop + bArmTop) / 2 : (aArmBottom + bArmBottom) / 2);
      const push = (Math.asin(clamp(excess / arm, 0, 1)) * 180) / Math.PI;
      const share = a === s.pull ? 0 : b === s.pull ? 1 : 0.5;
      s.sw[a] = clamp(s.sw[a] + push * share, -18, 18); s.beta[a] += push * share;
      s.sw[b] = clamp(s.sw[b] - push * (1 - share), -18, 18); s.beta[b] -= push * (1 - share);
      const va = s.vsw[a], vb = s.vsw[b];
      if (vb - va > 0) {
        const mean = (va + vb) / 2;
        if (a !== s.pull) s.vsw[a] = mean + (vb - va) * 0.15;
        if (b !== s.pull) s.vsw[b] = mean - (vb - va) * 0.15;
      }
    }
  }

  function step() {
    const now = performance.now(); // not the rAF timestamp, which can run on another clock
    const dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 1 / 60;
    s.last = now;
    let dv = 0; // in the carousel, the rail moving under the badges swings them like a carried rail
    if (size.carousel) {
      const left = stage.scrollLeft, v = -(left - s.scroll) / dt;
      dv = clamp(v - s.pv, -900, 900);
      s.pv = v;
      s.scroll = left;
    }
    const sub = Math.max(3, Math.ceil(dt / 0.006)), h = dt / sub; // ~6 ms sub-steps keep the springs stable on slow frames
    for (let k = 0; k < sub; k++) {
      for (let i = 0; i < n; i++) {
        if (i !== s.pull) {
          const vsw = clamp(s.vsw[i] + (k ? 0 : g.couple[i] * dv), -90, 90);
          s.vsw[i] = vsw + (-g.swingK[i] * s.sw[i] - SWING_DAMP * vsw) * h;
          s.sw[i] = clamp(s.sw[i] + s.vsw[i] * h, -18, 18);
        }
        s.beta[i] += (s.sw[i] - s.beta[i]) * Math.min(1, h / LAG);
        spring('ry', i, s.tr[i], 170, 0.62, h);
        spring('rz', i, s.tz[i], 120, 0.8, h);
        spring('lift', i, s.tl[i], 200, 0.75, h);
        spring('pop', i, s.tp[i], 160, 0.55, h);
        if (i !== s.pull) {
          spring('st', i, 0, REEL_K, REEL_ZETA, h);
          s.st[i] = Math.max(-g.cordRest * 0.85, s.st[i]);
        }
      }
      collide();
    }
    let busy = s.pull >= 0 || Math.abs(s.pv) > 1;
    for (let i = 0; i < n; i++) {
      paint(i);
      if (Math.abs(s.ry[i] - s.tr[i]) > 0.05 || Math.abs(s.vry[i]) > 0.05 || Math.abs(s.rz[i] - s.tz[i]) > 0.02 || Math.abs(s.vrz[i]) > 0.05
        || Math.abs(s.lift[i] - s.tl[i]) > 0.002 || Math.abs(s.vlift[i]) > 0.01 || Math.abs(s.pop[i] - s.tp[i]) > 0.002 || Math.abs(s.vpop[i]) > 0.01
        || Math.abs(s.sw[i]) > 0.02 || Math.abs(s.vsw[i]) > 0.05 || Math.abs(s.beta[i] - s.sw[i]) > 0.01 || Math.abs(s.st[i]) > 0.05 || Math.abs(s.vst[i]) > 0.1) busy = true;
    }
    if (busy) s.raf = requestAnimationFrame(step);
    else { s.raf = 0; s.last = 0; snap(); }
  }

  function snap() {
    for (let i = 0; i < n; i++) {
      s.sw[i] = s.vsw[i] = s.beta[i] = 0;
      if (i !== s.pull) s.st[i] = s.vst[i] = 0;
      s.ry[i] = s.tr[i]; s.rz[i] = s.tz[i]; s.lift[i] = s.tl[i]; s.pop[i] = s.tp[i];
      s.vry[i] = s.vrz[i] = s.vlift[i] = s.vpop[i] = 0;
      paint(i);
    }
    s.pv = 0;
  }

  function kick() {
    if (reduced) { cancelAnimationFrame(s.raf); s.raf = 0; snap(); return; }
    if (!s.raf) { s.last = 0; s.scroll = stage.scrollLeft; s.pv = 0; s.raf = requestAnimationFrame(step); }
  }
  const impulse = (i, amount) => { if (reduced || i < 0 || i >= n) return; s.vsw[i] += amount; kick(); };
  const tug = (i, amount) => { if (reduced || i < 0 || i >= n) return; s.vst[i] += amount; kick(); };

  // ---- who faces front, who is flipped ----
  function retarget(fresh) {
    for (let i = 0; i < n; i++) {
      const front = flipped === i || active === i;
      s.tr[i] = flipped === i ? 180 : active === i ? 0 : REST_Y[i % REST_Y.length];
      s.tz[i] = front ? 0 : REST_Z[i % REST_Z.length];
      s.tl[i] = front ? 1 : 0;
      s.tp[i] = flipped === i ? 1 : 0;
      if (fresh) {
        s.sw[i] = s.vsw[i] = s.beta[i] = s.st[i] = s.vst[i] = s.vry[i] = s.vrz[i] = s.vlift[i] = s.vpop[i] = 0;
        s.ry[i] = s.tr[i]; s.rz[i] = s.tz[i]; s.lift[i] = s.tl[i]; s.pop[i] = s.tp[i];
      }
      const e = els[i];
      e.slot.style.zIndex = flipped === i ? 40 : active === i ? 30 : 10 + i;
      e.button.setAttribute('aria-pressed', String(flipped === i));
      e.button.tabIndex = i === (active ?? focusIndex) ? 0 : -1;
      dots.children[i].setAttribute('aria-current', String(i === (active ?? focusIndex)));
    }
    const cur = active ?? flipped, it = cur === null ? null : items[cur], back = cur !== null && cur === flipped;
    const [line1, line2, extra] = caption.children;
    line1.textContent = it ? `${it.name} — ${it.role}${it.team ? ' · ' + it.team : ''}` : size.carousel ? SAY.carousel : SAY.rail;
    line2.textContent = !it ? '' : size.carousel ? (back ? SAY.tapBack : SAY.tapFlip) : back ? SAY.back : SAY.flip;
    extra.textContent = back ? it.bio : '';
    kick();
  }

  function center(i, smooth = true) {
    if (!size.carousel || i === null) return;
    stage.scrollTo({ left: s.x[i] - size.width / 2, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  }

  function setActive(i, fromScroll) {
    if (active === i) return;
    const old = active;
    active = i;
    if (i !== null) { focusIndex = i; impulse(i - 1, 16); impulse(i + 1, -16); }
    if (old !== null) { impulse(old - 1, -6); impulse(old + 1, 6); }
    retarget();
    if (!fromScroll) center(i);
  }

  function setFlipped(i) {
    if (flipped === i) return;
    const old = flipped;
    // the back's links hide with it: keep keyboard focus on the badge instead of dropping it to <body>
    if (old !== null && els[old].links.contains(document.activeElement)) els[old].button.focus({ preventScroll: true });
    flipped = i;
    if (i !== null) { impulse(i, i % 2 ? 9 : -9); tug(i, 70); }
    if (old !== null) tug(old, 40);
    retarget();
  }

  function toggle(i) {
    stop();
    const next = flipped === i ? null : i;
    if (next !== null) setActive(i);
    setFlipped(next);
  }

  // ---- autoplay: badges turn and flip one by one until the visitor touches the rail ----
  let playing = !reduced, visible = false, timer = 0;
  caption.setAttribute('aria-live', playing ? 'off' : 'polite'); // don't read the tour aloud, only what the visitor picks
  function stop() {
    if (!playing) return;
    playing = false;
    clearTimeout(timer);
    caption.setAttribute('aria-live', 'polite');
  }
  function play() {
    if (!playing || reduced || !visible) return;
    clearTimeout(timer);
    timer = active === null ? setTimeout(() => front(0), FIRST_DELAY) : setTimeout(() => flipNext(active), FLIP_DELAY);
  }
  function front(i) { setActive(i); timer = setTimeout(() => flipNext(i), FLIP_DELAY); }
  function flipNext(i) { setFlipped(i); timer = setTimeout(() => { setFlipped(null); front((i + 1) % n); }, INTERVAL); }

  // ---- pointer: hover brings a badge forward, a downward drag pulls it, a click flips it ----
  function nearest(clientX, clientY) {
    const box = track.getBoundingClientRect(), x = clientX - box.left, y = clientY - box.top;
    if (y < g.railY - 12) return null;
    let best = null, distance = Infinity;
    for (let i = 0; i < n; i++) {
      if (y > g.cardTops[i] + g.H + Math.max(0, s.st[i]) + 8) continue;
      const d = Math.abs(x - s.x[i]);
      if (d < g.W / 2 + 6 && d < distance) { best = i; distance = d; }
    }
    return best;
  }
  const soft = (d, max) => { const knee = max * 0.75; return d <= knee ? d : knee + (max - knee) * (1 - Math.exp(-(d - knee) / (max - knee))); };

  stage.addEventListener('pointerdown', (e) => {
    stop();
    if (e.button !== 0 || e.target.closest('.ly-links a')) return;
    pendingOpen = -1;
    Object.assign(pointer, { id: e.pointerId, index: nearest(e.clientX, e.clientY) ?? -1, x: e.clientX, y: e.clientY, mode: '', kind: e.pointerType, lastT: performance.now() });
  });

  stage.addEventListener('pointermove', (e) => {
    const p = pointer, now = performance.now();
    if (p.id === e.pointerId) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.mode && Math.hypot(dx, dy) > 8) {
        p.mode = Math.abs(dy) > Math.abs(dx) && dy > 0 && p.index >= 0 && !size.carousel ? 'pull' : 'none';
        if (p.mode === 'pull') { s.pull = p.index; stage.setPointerCapture(e.pointerId); }
      }
      if (p.mode === 'pull') {
        const i = p.index, elapsed = Math.max(1, now - p.lastT);
        s.st[i] = soft(Math.max(0, dy), g.maxStretch);
        s.vst[i] = 0;
        const angle = clamp((-Math.atan2(dx, g.pendulum[i] + s.st[i]) * 180) / Math.PI, -16, 16);
        s.vsw[i] = ((angle - s.sw[i]) / elapsed) * 1000 * 0.5;
        s.sw[i] = angle;
        if (reduced) paint(i); else kick();
      }
      p.lastT = now;
      return;
    }
    if (e.pointerType !== 'mouse' || p.id >= 0 || size.carousel) return;
    const hit = nearest(e.clientX, e.clientY), hoverV = (e.clientX - p.hoverX) / Math.max(1, now - p.hoverT);
    p.hoverX = e.clientX;
    p.hoverT = now;
    if (hit !== null && hit !== p.hoverHit) impulse(hit, clamp(-hoverV * 22, -24, 24));
    p.hoverHit = hit ?? -1;
    if (hit !== null && hit !== active) { stop(); setActive(hit); }
  });

  function finish(e, cancelled) {
    const p = pointer;
    if (p.id !== e.pointerId) return;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    p.id = -1;
    if (p.mode === 'pull') {
      const i = s.pull;
      s.pull = -1;
      if (reduced) { s.st[i] = s.vst[i] = s.sw[i] = s.vsw[i] = s.beta[i] = 0; paint(i); } else kick();
      return;
    }
    if (cancelled || p.mode || p.index < 0) return;
    // a tap on touch (or on a carousel badge off-centre) brings the badge forward first; the next one flips it
    if ((p.kind !== 'mouse' || size.carousel) && active !== p.index) setActive(p.index);
    else pendingOpen = p.index;
  }
  stage.addEventListener('pointerup', (e) => finish(e, false));
  stage.addEventListener('pointercancel', (e) => finish(e, true));
  stage.addEventListener('pointerleave', (e) => {
    pointer.hoverHit = -1;
    if (e.pointerType === 'mouse' && pointer.id < 0 && !size.carousel && !document.activeElement?.matches('.ly-badge:focus-visible')) setActive(null);
  });

  stage.addEventListener('click', (e) => {
    const b = e.target.closest('.ly-badge');
    if (!b) return;
    const i = +b.dataset.badge, pending = pendingOpen;
    pendingOpen = -1;
    if (e.detail === 0 || pending === i) toggle(i); // detail 0: Enter or Space
  });

  stage.addEventListener('focusin', (e) => {
    const b = e.target.closest('.ly-badge');
    if (!b) { stop(); return; }
    focusIndex = +b.dataset.badge;
    if (pointer.id < 0) { stop(); setActive(focusIndex); }
  });

  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (flipped !== null) { e.preventDefault(); setFlipped(null); }
      return;
    }
    const badge = e.target.closest('.ly-badge')?.dataset.badge;
    if (e.key === 'ArrowDown') {
      if (badge === undefined) return;
      e.preventDefault();
      stop();
      tug(+badge, 300);
      return;
    }
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    stop();
    const from = active ?? focusIndex;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : clamp(from + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1);
    setActive(next);
    els[next].button.focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || flipped === null || stage.contains(e.target)) return;
    setFlipped(null);
  });

  dots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dot]');
    if (b) { stop(); setActive(+b.dataset.dot); }
  });

  // carousel: the badge that settles in the middle faces front
  let settle = 0;
  stage.addEventListener('scroll', () => {
    if (!size.carousel) return;
    kick();
    clearTimeout(settle);
    settle = setTimeout(() => {
      const mid = stage.scrollLeft + size.width / 2;
      let best = 0;
      s.x.forEach((x, i) => { if (Math.abs(x - mid) < Math.abs(s.x[best] - mid)) best = i; });
      setActive(best, true);
    }, 120);
  }, { passive: true });
  stage.addEventListener('wheel', (e) => { if (size.carousel && Math.abs(e.deltaX) > Math.abs(e.deltaY)) stop(); }, { passive: true });

  media.addEventListener('change', () => {
    reduced = media.matches;
    if (reduced) stop();
    kick();
  });

  render(stage.clientWidth);
  new ResizeObserver(([entry]) => render(entry.contentRect.width)).observe(stage);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) play(); else clearTimeout(timer);
  }, { threshold: 0.35 }).observe(stage);

  // the badges sway as they arrive
  if (!reduced) items.forEach((_, i) => setTimeout(() => impulse(i, (i % 2 ? -1 : 1) * (30 - (i % 4) * 3)), 60 + i * 70));
})();
