/* Dot repel, the engine.
   Moving parts. A halftone screen of fine dots behind a hero, parted by the pointer.
   Readable source: components/dot-repel/dot-repel.js */
(function (global) {
  'use strict';

  // Settings. Change values below.
  var DEFAULTS = {
    color: '#15100c',     // Colour of the dots.
    rest: 0.12,           // 0 to 1. Opacity of a dot at rest.
    peak: 0.34,           // 0 to 1. Opacity of a dot pushed the farthest.
    spacing: 16,          // px, keep px. Distance between two dots.
    dot: 1.2,             // px, keep px. Radius of a dot at rest.
    reach: 'clamp(120px, 12vw, 180px)', // any CSS unit. Radius the pointer parts.
    grow: 1.35,           // times dot. Radius of a dot pushed the farthest.
    push: 0.28,           // times reach. How far the dots are pushed.
    life: 0.9,            // s. Time a dot takes to spring back.
  };

  var PREFIX = 'data-dot-repel';
  var STATE = PREFIX + '-state';

  var LENGTHS = ['reach'];
  var NUMBERS = ['rest', 'peak', 'spacing', 'dot', 'grow', 'push', 'life'];

  // Canvas pixel ratio, capped at 2.
  // A 3x screen would more than double what is cleared and filled for a
  // grain nobody sees finer.
  function ratio() {
    return Math.min(2, global.devicePixelRatio || 1);
  }

  // Longest step of the clock, so a stalled frame never jumps the field.
  var MAX_STEP = 1 / 20; // s

  // A touch that moves less than this and lifts quickly is a tap.
  var TAP_TRAVEL = 10; // px
  var TAP_TIME = 350;  // ms

  // Steps between a dot at rest and a dot pushed the farthest. Dots are
  // drawn by step, one fill per step.
  var STEPS = 48;

  // The ripple a tap leaves: how far it runs, as a share of reach, how
  // long it lasts, and how wide its ring is, in spacings.
  var RIPPLE_REACH = 0.9;
  var RIPPLE_TIME = 0.9; // s
  var RIPPLE_BAND = 2.4;

  // Spring of a dot: damping ratio, and how much stiffer the push is than
  // the return, so the hole follows the pointer and the dots settle softly.
  var DAMP = 0.5;
  var PUSH_STIFF = 5;

  function dashed(key) {
    return PREFIX + '-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  /* Quote stripping for values copied from DEFAULTS.
     A value copied from DEFAULTS keeps the quotes it has in the file:
     data-dot-repel-reach="'160px'". Quotes around a whole value are never
     part of a length, a number or a colour. */
  function unquote(value) {
    if (typeof value !== 'string') return value;
    var text = value.trim();
    var m = text.match(/^(['"‘’“”])([\s\S]*)(['"‘’“”])$/);
    return m ? m[2].trim() : text;
  }

  /* Length resolver: any CSS unit, read through a probe.
     The value is assigned to a real property on a probe inside the section
     and the computed result is read back in pixels, which covers vw, rem,
     clamp(), calc() and custom properties without a unit parser. */
  var probe = null;

  function resolveLength(el, value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    var text = unquote(value);
    if (text === '') return null;
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    if (!probe) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;height:0;padding:0;border:0';
    }
    el.appendChild(probe);
    probe.style.width = '';
    probe.style.width = text;
    var px = parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return px > 0 ? px : null;
  }

  /* Settings cascade: defaults, caller, data attributes.
     The defaults, then whatever the caller hands in (the settings block of
     the embed, a mount() argument), then the section's own attributes. The
     attribute comes last so one section can differ from the page-wide block.
     Lengths stay raw here: reach is fluid, so it is read again at every
     resize. */
  function readSettings(el, overrides) {
    var s = {};
    for (var key in DEFAULTS) {
      var value = DEFAULTS[key];
      if (overrides && overrides[key] != null && overrides[key] !== '') value = unquote(overrides[key]);
      var raw = unquote(el.getAttribute(dashed(key)));
      if (raw !== null && raw !== '') value = raw;
      s[key] = value;
    }
    for (var i = 0; i < NUMBERS.length; i++) {
      var n = Number(s[NUMBERS[i]]);
      s[NUMBERS[i]] = isNaN(n) ? Number(DEFAULTS[NUMBERS[i]]) : n;
    }
    // Colour: attribute, then caller, then the section's custom property,
    // then the default.
    s.color = unquote(el.getAttribute(dashed('color')))
      || unquote(overrides && overrides.color)
      || getComputedStyle(el).getPropertyValue('--dot-repel-color').trim()
      || DEFAULTS.color;
    s.rest = clamp(s.rest, 0, 1);
    s.peak = clamp(s.peak, s.rest, 1);
    s.spacing = Math.max(4, Math.round(s.spacing));
    s.dot = clamp(s.dot, 0.3, s.spacing / 2 - 1);
    s.grow = Math.max(1, s.grow);
    s.push = clamp(s.push, 0, 0.5);
    s.life = Math.max(0.05, s.life);
    return s;
  }

  function lengths(el, S) {
    for (var j = 0; j < LENGTHS.length; j++) {
      var key = LENGTHS[j];
      var raw = S.raw[key];
      var px = resolveLength(el, raw);
      if (px === null) px = resolveLength(el, DEFAULTS[key]);
      S[key] = Math.max(S.spacing * 2, px === null ? 150 : px);
    }
  }

  // Soft round falloff: 1 at the centre, 0 at the edge, flat at both ends.
  function fall(d2) {
    if (d2 >= 1) return 0;
    var f = 1 - d2;
    return f * f;
  }

  /* ---------- The field ---------- */

  /* One dot per cell of a fixed grid, centred in the section.
     Every dot at rest is drawn once, at mount and at each resize. After
     that only the dots the pointer stirs are touched: they join a list of
     live dots, spring towards where the pointer pushes them, and leave the
     list once they are back at rest. A live dot leaves its cell, so each
     frame clears the box around the live dots and draws every dot of that
     box again, by step (see STEPS). */
  function Field(S) {
    var sp = S.spacing;
    var cols = 0, rows = 0, n = 0, ox = 0, oy = 0, W = 0, H = 0;
    var want = null, on = null;
    var list = null, count = 0, draws = null, order = null;
    var offX = null, offY = null, velX = null, velY = null;
    var tally = new Int32Array(STEPS + 1), cursor = new Int32Array(STEPS + 1);
    var alphaOf = new Float32Array(STEPS + 1), radiusOf = new Float32Array(STEPS + 1);
    // Pointer: where it is, whether it is over the field, and whether it
    // moved since the last frame.
    var has = false, px = 0, py = 0, fresh = false;
    // The tap ripple.
    var rippling = false, rx = 0, ry = 0, rAge = 0;
    // Box of cells drawn last frame.
    var b0 = 0, b1 = -1, b2 = 0, b3 = -1;

    function tune() {
      for (var q = 0; q <= STEPS; q++) {
        var k = q / STEPS;
        alphaOf[q] = S.rest + (S.peak - S.rest) * k;
        radiusOf[q] = Math.min(sp / 2 - 1, S.dot * (1 + (S.grow - 1) * k));
      }
    }

    function resize(w, h, dpr) {
      W = w; H = h;
      cols = Math.max(1, Math.ceil(w / sp));
      rows = Math.max(1, Math.ceil(h / sp));
      // Grid centred, its origin on the device pixel grid so every dot has
      // the same sub-pixel phase.
      ox = Math.round(((w - (cols - 1) * sp) / 2) * dpr) / dpr;
      oy = Math.round(((h - (rows - 1) * sp) / 2) * dpr) / dpr;
      if (cols * rows !== n) {
        n = cols * rows;
        want = new Uint8Array(n);
        on = new Uint8Array(n);
        list = new Int32Array(n);
        draws = new Int32Array(n);
        order = new Int32Array(n);
        offX = new Float32Array(n); offY = new Float32Array(n);
        velX = new Float32Array(n); velY = new Float32Array(n);
      }
      tune();
      clear();
    }

    // Everything back at rest, nothing live.
    function clear() {
      if (n) {
        want.fill(0); on.fill(0);
        offX.fill(0); offY.fill(0); velX.fill(0); velY.fill(0);
      }
      count = 0;
      has = false; fresh = false; rippling = false;
      b0 = 0; b1 = -1; b2 = 0; b3 = -1;
    }

    function point(x, y) {
      has = true;
      px = x; py = y;
      fresh = true;
    }

    function leave() {
      has = false;
      fresh = true;
    }

    function tap(x, y) {
      rippling = true;
      rx = x; ry = y; rAge = 0;
    }

    function join(i) {
      if (!on[i]) { on[i] = 1; list[count++] = i; }
    }

    // Every dot within r of (x, y) joins the live list.
    function gather(x, y, r) {
      var c0 = Math.max(0, Math.ceil((x - r - ox) / sp));
      var c1 = Math.min(cols - 1, Math.floor((x + r - ox) / sp));
      var r0 = Math.max(0, Math.ceil((y - r - oy) / sp));
      var r1 = Math.min(rows - 1, Math.floor((y + r - oy) / sp));
      var rr = r * r;
      for (var row = r0; row <= r1; row++) {
        var dy = oy + row * sp - y;
        for (var col = c0; col <= c1; col++) {
          var dx = ox + col * sp - x;
          if (dx * dx + dy * dy < rr) join(row * cols + col);
        }
      }
    }

    // The ripple's ring at a dot, 0 to 1.
    var ringR = 0, ringW = 0, ringA = 0;
    function ringAt(x, y) {
      var dx = x - rx, dy = y - ry;
      var u = (Math.sqrt(dx * dx + dy * dy) - ringR) / ringW;
      return ringA * fall(u * u);
    }

    /* One frame. Returns true while something is still moving. */
    function frame(dt, ctx) {
      var R = S.reach;
      var busy = false;

      if (rippling) {
        rAge += dt;
        if (rAge >= RIPPLE_TIME) {
          rippling = false;
          ringA = 0;
        } else {
          var k = rAge / RIPPLE_TIME;
          ringR = R * RIPPLE_REACH * (1 - (1 - k) * (1 - k));
          ringW = sp * RIPPLE_BAND;
          ringA = (1 - k) * (1 - k);
          gather(rx, ry, ringR + ringW);
          busy = true;
        }
      }

      if (has && fresh) gather(px, py, R);
      fresh = false;
      return repel(dt, ctx, R) || busy;
    }

    /* Each live dot springs towards the offset the pointer and the ripple
       ask of it: out of a round hole around the pointer, the dots nearest
       the pointer pushed the farthest, so they pile up at its rim. */
    function repel(dt, ctx, R) {
      var P = S.push * R;
      var RR = R * R;
      // Return spring from life, the push several times stiffer.
      var omega = 4 / (DAMP * S.life);
      var kBack = omega * omega, cBack = 2 * DAMP * omega;
      var kPush = kBack * PUSH_STIFF, cPush = 2 * DAMP * omega * Math.sqrt(PUSH_STIFF);
      var h = dt / 2;
      var wave = sp * 0.9;
      var busy = false, w = 0;
      var c0 = cols, c1 = -1, r0 = rows, r1 = -1;
      for (var k = 0; k < count; k++) {
        var i = list[k];
        var col = i % cols, row = (i / cols) | 0;
        var x = ox + col * sp, y = oy + row * sp;
        var tx = 0, ty = 0;
        if (has) {
          var dx = x - px, dy = y - py;
          var d2 = dx * dx + dy * dy;
          if (d2 < RR) {
            var d = Math.sqrt(d2);
            var a = 1 - d / R;
            var push = P * a * a;
            if (d > 0.01) { tx = dx / d * push; ty = dy / d * push; } else { tx = push; }
          }
        }
        if (rippling) {
          var ex = x - rx, ey = y - ry;
          var e = Math.sqrt(ex * ex + ey * ey);
          if (e > 0.01) {
            var s = ringAt(x, y) * wave / e;
            tx += ex * s; ty += ey * s;
          }
        }
        var X = offX[i], Y = offY[i], VX = velX[i], VY = velY[i];
        var out = tx * tx + ty * ty > X * X + Y * Y;
        var kk = out ? kPush : kBack, cc = out ? cPush : cBack;
        // Two sub-steps, for a spring this stiff at a slow frame rate.
        for (var sub = 0; sub < 2; sub++) {
          VX += (kk * (tx - X) - cc * VX) * h;
          VY += (kk * (ty - Y) - cc * VY) * h;
          X += VX * h;
          Y += VY * h;
        }
        if (Math.abs(tx - X) < 0.03 && Math.abs(ty - Y) < 0.03 && Math.abs(VX) < 0.3 && Math.abs(VY) < 0.3) {
          X = tx; Y = ty; VX = 0; VY = 0;
        } else {
          busy = true;
        }
        offX[i] = X; offY[i] = Y; velX[i] = VX; velY[i] = VY;
        if (X === 0 && Y === 0 && VX === 0 && VY === 0 && tx === 0 && ty === 0) {
          on[i] = 0;
        } else {
          list[w++] = i;
          if (col < c0) c0 = col;
          if (col > c1) c1 = col;
          if (row < r0) r0 = row;
          if (row > r1) r1 = row;
        }
      }
      var shrank = w !== count;
      count = w;
      if (busy || shrank) {
        // The live box, grown by the farthest a dot can travel, overshoot
        // of the spring included.
        var M = Math.ceil((P + (rippling ? wave : 0)) * 1.25 / sp) + 1;
        if (c1 >= c0) {
          c0 = Math.max(0, c0 - M); c1 = Math.min(cols - 1, c1 + M);
          r0 = Math.max(0, r0 - M); r1 = Math.min(rows - 1, r1 + M);
        }
        // Drawn: this box and last frame's, so nothing is left behind.
        var d0 = Math.min(c0, b0), d1 = Math.max(c1, b1);
        var d2r = Math.min(r0, b2), d3 = Math.max(r1, b3);
        if (b1 < b0) { d0 = c0; d1 = c1; d2r = r0; d3 = r1; }
        if (d1 >= d0) paintBox(ctx, d0, d1, d2r, d3, P);
        b0 = c0; b1 = c1; b2 = r0; b3 = r1;
      }
      return busy;
    }

    /* The box is cleared under a clip and every dot in it drawn again,
       moved or not. A dot's step is how far it was pushed. */
    function paintBox(ctx, c0, c1, r0, r1, P) {
      var half = sp / 2;
      var m = 0;
      var inv = P > 0 ? STEPS / P : 0;
      for (var row = r0; row <= r1; row++) {
        for (var col = c0; col <= c1; col++) {
          var i = row * cols + col;
          var X = offX[i], Y = offY[i];
          want[i] = X === 0 && Y === 0 ? 0 : Math.min(STEPS, Math.round(Math.sqrt(X * X + Y * Y) * inv));
          draws[m++] = i;
        }
      }
      var x0 = ox + c0 * sp - half, y0 = oy + r0 * sp - half;
      var w = (c1 - c0 + 1) * sp, h = (r1 - r0 + 1) * sp;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w, h);
      ctx.clip();
      ctx.clearRect(x0, y0, w, h);
      paint(ctx, m);
      ctx.restore();
    }

    /* The dots in draws[0..m), sorted by step, one path and one fill per
       step. */
    function paint(ctx, m) {
      var q, k;
      for (q = 0; q <= STEPS; q++) tally[q] = 0;
      for (k = 0; k < m; k++) tally[want[draws[k]]]++;
      var at = 0;
      for (q = 0; q <= STEPS; q++) { cursor[q] = at; at += tally[q]; }
      for (k = 0; k < m; k++) { var j = draws[k]; order[cursor[want[j]]++] = j; }
      ctx.fillStyle = S.color;
      var from = 0;
      for (q = 0; q <= STEPS; q++) {
        var c = tally[q];
        if (!c) continue;
        var r = radiusOf[q];
        ctx.globalAlpha = alphaOf[q];
        ctx.beginPath();
        for (k = from; k < from + c; k++) {
          var i = order[k];
          var x = ox + (i % cols) * sp, y = oy + ((i / cols) | 0) * sp;
          x += offX[i]; y += offY[i];
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, 6.283185307179586);
        }
        ctx.fill();
        from += c;
      }
      ctx.globalAlpha = 1;
    }

    // The whole field at rest, drawn once.
    function paintAll(ctx) {
      ctx.clearRect(0, 0, W, H);
      var r = radiusOf[0];
      ctx.fillStyle = S.color;
      ctx.globalAlpha = alphaOf[0];
      ctx.beginPath();
      for (var row = 0; row < rows; row++) {
        var y = oy + row * sp;
        for (var col = 0; col < cols; col++) {
          var x = ox + col * sp;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, 6.283185307179586);
        }
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    return {
      resize: resize,
      clear: clear,
      point: point,
      leave: leave,
      tap: tap,
      frame: frame,
      paintAll: paintAll,
      pending: function () { return count > 0 || rippling || fresh; },
    };
  }

  /* ---------- Mount ---------- */

  function mount(el, overrides) {
    if (!el) return null;
    if (el.__dotRepel) return el.__dotRepel;

    var S = readSettings(el, overrides);
    S.raw = { reach: S.reach };
    var motion = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    // Reduced motion: the field stays, still, and answers nothing.
    var still = !!(motion && motion.matches);

    /* The section's own style attribute, kept as text.
       The script may set position and isolation on the section; destroy()
       puts the attribute back exactly as it was, or takes it off. */
    var styleBefore = el.getAttribute('style');
    var cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    // A stacking context of its own, so the canvas can sit under the
    // content and over the section's background.
    if (cs.isolation !== 'isolate' && cs.zIndex === 'auto') el.style.isolation = 'isolate';

    /* The layer: one canvas under the section's content, clicks pass through.
       Out of the flow from the first frame, whether the stylesheet is there
       or not: a canvas left in the flow would make the section taller, the
       watcher below would size the canvas to the taller section, and the two
       would grow each other. */
    var canvas = document.createElement('canvas');
    canvas.className = 'dot-repel-layer';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;z-index:-1;width:100%;height:100%;pointer-events:none';
    el.insertBefore(canvas, el.firstChild);
    var ctx = canvas.getContext('2d');

    var field = Field(S);
    var W = 0, H = 0, DPR = 0;
    var frame = 0, running = false, lastT = 0, frames = 0;
    var destroyed = false;

    /* Frozen: the hole stays where the pointer left it.
       A pointer that leaves the section, or a finger that lifts, no longer
       closes the field, so the parted field is held as a still picture once
       the dots have settled. See freeze() on the api below. */
    var frozen = false;

    // Touch in progress: where and when it began, how far it went.
    var touchX = 0, touchY = 0, touchT = 0, touchMoved = 0, touching = false;

    function size() {
      var w = el.clientWidth;
      var h = el.clientHeight;
      var dpr = ratio();
      if (w === W && h === H && dpr === DPR) return;
      W = w; H = h; DPR = dpr;
      sleep();
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      lengths(el, S);
      field.resize(W, H, DPR);
      field.paintAll(ctx);
      if (!destroyed) el.setAttribute(STATE, still ? 'still' : 'idle');
    }

    /* ---------- The loop ---------- */

    // Runs only while a dot is moving, and never in a hidden tab.
    function loop(now) {
      frame = 0;
      if (destroyed || document.hidden) { running = false; lastT = 0; return; }
      var dt = lastT ? Math.min(MAX_STEP, (now - lastT) / 1000) : 1 / 60;
      lastT = now;
      var alive = field.frame(dt, ctx);
      frames++;
      if (!alive) {
        // Settled: the dots are where they stay, then sleep.
        running = false;
        lastT = 0;
        el.setAttribute(STATE, frozen ? 'held' : 'idle');
        return;
      }
      frame = requestAnimationFrame(loop);
    }

    function wake() {
      if (running || destroyed || still || document.hidden) return;
      running = true;
      lastT = 0;
      el.setAttribute(STATE, 'live');
      frame = requestAnimationFrame(loop);
    }

    function sleep() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      running = false;
      lastT = 0;
    }

    /* ---------- Pointer ---------- */

    function local(clientX, clientY) {
      var box = el.getBoundingClientRect();
      field.point(clientX - box.left, clientY - box.top);
      wake();
    }

    function onMove(e) {
      if (still || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
      local(e.clientX, e.clientY);
    }

    function onLeave(e) {
      if (still || frozen || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
      field.leave();
      wake();
    }

    /* Touch: touch events rather than pointer events.
       A finger drag that turns into a scroll cancels its pointer events but
       keeps sending touchmove. The page still scrolls; the field is parted
       in section coordinates, so it answers where the finger passes. A
       short touch that barely moves is a tap, and leaves a ripple. */
    function onTouchStart(e) {
      if (still || !e.touches.length) return;
      var t = e.touches[0];
      touching = true;
      touchX = t.clientX; touchY = t.clientY; touchT = e.timeStamp || performance.now(); touchMoved = 0;
    }

    function onTouchMove(e) {
      if (still || !touching || !e.touches.length) return;
      var t = e.touches[0];
      var dx = t.clientX - touchX, dy = t.clientY - touchY;
      touchMoved = Math.max(touchMoved, Math.sqrt(dx * dx + dy * dy));
      if (touchMoved >= TAP_TRAVEL) local(t.clientX, t.clientY);
    }

    function onTouchEnd(e) {
      if (still || !touching) return;
      touching = false;
      if (!frozen) field.leave();
      var held = (e.timeStamp || performance.now()) - touchT;
      if (touchMoved < TAP_TRAVEL && held < TAP_TIME) {
        var box = el.getBoundingClientRect();
        field.tap(touchX - box.left, touchY - box.top);
      }
      wake();
    }

    function onVisibility() {
      if (document.hidden) sleep();
      else if (field.pending()) wake();
    }

    function onMotion() {
      still = !!(motion && motion.matches);
      sleep();
      field.clear();
      field.paintAll(ctx);
      el.setAttribute(STATE, still ? 'still' : 'idle');
    }

    /* ---------- Wiring ---------- */

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    global.addEventListener('resize', size);
    if (motion && motion.addEventListener) motion.addEventListener('change', onMotion);
    /* Section size watcher.
       The canvas is a bitmap sized from the section. A section that changes
       size without the window doing so (fonts that arrive, a min-height set
       late) would show every dot stretched until the next real resize. */
    var watcher = null;
    if (typeof ResizeObserver === 'function') {
      watcher = new ResizeObserver(size);
      watcher.observe(el);
    }
    size();

    var api = {
      element: el,
      settings: S,
      resize: size,
      // Rendered frames since mount, and whether the loop is running: for
      // a test to see that the loop sleeps at rest.
      frames: function () { return frames; },
      isRunning: function () { return running; },
      ripple: function (x, y) { if (!still) { field.tap(x, y); wake(); } return api; },
      clear: function () {
        sleep();
        field.clear();
        field.paintAll(ctx);
        if (!destroyed) el.setAttribute(STATE, still ? 'still' : 'idle');
        return api;
      },
      /* freeze(): the parted field held as a still picture.
         The pointer leaving no longer closes the hole: the dots settle where
         the last move pushed them and the loop stops, so a held field costs
         nothing. Meant for a still image of the effect, a thumbnail that has
         to show the field parted at rest; a page never needs it. unfreeze()
         lets the hole close again, at once. */
      freeze: function () {
        frozen = true;
        if (!running && !destroyed && !still) el.setAttribute(STATE, 'held');
        return api;
      },
      unfreeze: function () {
        frozen = false;
        if (destroyed || still) return api;
        field.leave();
        if (!running) el.setAttribute(STATE, 'idle');
        wake();
        return api;
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        sleep();
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchEnd);
        document.removeEventListener('visibilitychange', onVisibility);
        global.removeEventListener('resize', size);
        if (motion && motion.removeEventListener) motion.removeEventListener('change', onMotion);
        if (watcher) watcher.disconnect();
        canvas.remove();
        el.removeAttribute(STATE);
        if (styleBefore === null) el.removeAttribute('style');
        else el.setAttribute('style', styleBefore);
        if (el.__dotRepel === api) delete el.__dotRepel;
      },
    };

    el.__dotRepel = api;
    return api;
  }

  function destroy(el) {
    if (el && el.__dotRepel) el.__dotRepel.destroy();
  }

  function freeze(el) {
    if (el && el.__dotRepel) el.__dotRepel.freeze();
  }

  function unfreeze(el) {
    if (el && el.__dotRepel) el.__dotRepel.unfreeze();
  }

  /* Page-wide settings, read before auto mounting.
     auto() reads window.DotRepelSettings itself: auto mounting happens at
     DOM ready, and mount() on a section that already carries a field
     returns the existing one untouched, so settings handed in afterwards
     would be dropped. */
  function auto(root) {
    var scope = root || document;
    var page = global.DotRepelSettings;
    [].forEach.call(scope.querySelectorAll('[' + PREFIX + ']'), function (el) { mount(el, page); });
  }

  global.DotRepel = {
    mount: mount,
    auto: auto,
    destroy: destroy,
    freeze: freeze,
    unfreeze: unfreeze,
    defaults: DEFAULTS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { auto(); });
  } else {
    auto();
  }
}(window));
