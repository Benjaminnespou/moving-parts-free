/* Pixel ribbon, the engine.
   Moving parts. A liquid ribbon of pixels trails the cursor on springs, then folds back in.
   Readable source: components/pixel-ribbon/pixel-ribbon.js */
(function (global) {
  'use strict';

  // Settings. Change values below.
  var DEFAULTS = {
    color: '#ffab1a',     // Colour of the pixels.
    opacity: 1,           // 0 to 1. Opacity of the ribbon.
    cell: 6,              // px, keep px. Side of one pixel.
    size: 'clamp(9px, 0.82vw, 14px)', // any CSS unit. Radius of the ribbon at its head.
    life: 0.75,           // s. Time the ribbon takes to deflate at rest.
    burst: 2.2,           // times size. Reach of the drops a tap throws.
  };

  var PREFIX = 'data-pixel-ribbon';
  var STATE = PREFIX + '-state';

  var LENGTHS = ['size'];
  var NUMBERS = ['opacity', 'cell', 'life', 'burst'];

  // Canvas pixel ratio, capped at 2.
  // One canvas the size of the section: a 3x screen would more than double
  // what is cleared and filled each frame for a grain nobody sees finer.
  var DPR = Math.min(2, global.devicePixelRatio || 1);

  // Longest step of the clock, so a stalled frame never jumps the ribbon.
  var MAX_STEP = 1 / 20; // s

  // A touch that moves less than this and lifts quickly is a tap.
  var TAP_TRAVEL = 10; // px
  var TAP_TIME = 350;  // ms

  // Pause of the pointer after which a frozen ribbon is held.
  var HOLD_AFTER = 0.1; // s

  function dashed(key) {
    return PREFIX + '-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  // A fixed scatter per blob, the same every time, so a tap never flickers.
  function hash(i) {
    var s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /* Quote stripping for values copied from DEFAULTS.
     A value copied from DEFAULTS keeps the quotes it has in the file:
     data-pixel-ribbon-color="'#ffab1a'". Quotes around a whole value are
     never part of a length, a number or a colour. */
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
     attribute comes last so one section can differ from the page-wide block. */
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
    for (var j = 0; j < LENGTHS.length; j++) {
      var px = resolveLength(el, s[LENGTHS[j]]);
      if (px === null) px = resolveLength(el, DEFAULTS[LENGTHS[j]]);
      s[LENGTHS[j]] = px === null ? 12 : px;
    }
    // Colour: attribute, then caller, then the section's custom property,
    // then the default.
    s.color = unquote(el.getAttribute(dashed('color')))
      || unquote(overrides && overrides.color)
      || getComputedStyle(el).getPropertyValue('--pixel-ribbon-color').trim()
      || DEFAULTS.color;
    s.opacity = clamp(s.opacity, 0, 1);
    s.cell = Math.max(2, Math.round(s.cell));
    s.size = Math.max(s.cell, s.size);
    s.life = Math.max(0.05, s.life);
    s.burst = Math.max(0, s.burst);
    return s;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  /* ---------- The ribbon ---------- */

  /* Liquid pixels: a chain of soft blobs merged into one field.
     Each blob is tied by a spring to where the pointer was a moment
     earlier, the first one a few milliseconds back, the last one about half
     a second. So the chain lies on the gesture, lags a little behind it and
     wobbles when it turns, and when the pointer stops the whole path folds
     back into the head, like a drop pulling itself in. The blobs are summed
     into one field on the pixel grid, which is what makes them merge: a
     cell is lit where the field passes a threshold, and cells near the
     threshold are drawn smaller, so the rim of the ribbon is a fringe of
     shrinking pixels that reshapes as the chain moves. The blobs swell with
     the travel of the pointer and deflate at rest, the tail first. */
  function Ribbon(host) {
    var S = host.S;
    var N = 36;          // blobs in the chain
    var SPACE = 0.016;   // s. Delay of one blob's target behind the one before.
    var STIFF = 520;     // spring of a blob to its target
    var DAMP = 0.8;      // share of critical damping, under 1 wobbles
    var TAPER = 0.62;    // share of the radius the tail loses
    var LEAST = 0.35;    // smallest blob drawn, in cells
    var LOW = 0.2;       // field where the smallest pixels appear
    var HIGH = 0.95;     // field where a pixel is whole
    var REACH = 2.6;     // support of one blob, in radii
    var KEEP = 128;      // steps of pointer history, well over N * SPACE
    var SLACK = 0.7;     // s. Time the springs take to firm up after a tap.
    var x = new Float32Array(N), y = new Float32Array(N);
    var vx = new Float32Array(N), vy = new Float32Array(N);
    var e = new Float32Array(N);
    // Pointer history, a ring: where the pointer was, and when.
    var hx = new Float32Array(KEEP), hy = new Float32Array(KEEP), ht = new Float32Array(KEEP);
    var head = 0, kept = 0, clock = 0;
    var tx = 0, ty = 0, energy = 0, awake = false, loose = 0;
    var cols = 0, rows = 0, field = null;
    // Cells written last frame, cleared before the next one.
    var b0 = 0, b1 = -1, b2 = 0, b3 = -1;

    function resize(w, h) {
      cols = Math.ceil(w / S.cell);
      rows = Math.ceil(h / S.cell);
      field = new Float32Array(cols * rows);
      b1 = b3 = -1;
      clear();
    }

    function gather(px, py) {
      for (var i = 0; i < N; i++) { x[i] = px; y[i] = py; vx[i] = vy[i] = 0; e[i] = 0; }
      kept = 0;
      tx = px; ty = py;
    }

    function enter(px, py) {
      if (!awake) gather(px, py);
      tx = px; ty = py;
    }

    function stroke(x0, y0, x1, y1) {
      if (!awake) gather(x0, y0);
      awake = true;
      tx = x1; ty = y1;
      var dx = x1 - x0, dy = y1 - y0;
      energy = Math.min(1, energy + Math.sqrt(dx * dx + dy * dy) / (S.size * 6));
    }

    /* A tap: the chain thrown out from the point as drops.
       The springs are slack at first, then firm up and pull the drops back
       in. */
    function burst(px, py) {
      gather(px, py);
      awake = true;
      energy = 1;
      loose = 1;
      var speed = S.size * S.burst * 24;
      for (var i = 0; i < N; i++) {
        var a = i * 2.39996 + hash(i) * 0.6;
        var v = speed * (0.35 + 0.65 * hash(i + 7));
        vx[i] = Math.cos(a) * v;
        vy[i] = Math.sin(a) * v;
        e[i] = 0.35 + 0.65 * hash(i + 3);
      }
    }

    function step(dt) {
      if (!awake) return false;
      clock += dt;
      head = (head + 1) % KEEP;
      hx[head] = tx; hy[head] = ty; ht[head] = clock;
      if (kept < KEEP) kept++;
      // Two sub-steps, for a spring this stiff at a slow frame rate.
      var h = dt / 2;
      loose = Math.max(0, loose - dt / SLACK);
      var firm = 1 - loose;
      var k = STIFF * (0.04 + 0.96 * firm * firm * firm);
      var c = 2 * Math.sqrt(k) * DAMP;
      // One walk back through the history serves every blob, oldest last.
      var back = 0;
      for (var i = 0; i < N; i++) {
        var when = clock - i * SPACE;
        while (back < kept - 1 && ht[(head - back - 1 + KEEP) % KEEP] >= when) back++;
        var slot = (head - back + KEEP) % KEEP;
        var gx = hx[slot], gy = hy[slot];
        for (var sub = 0; sub < 2; sub++) {
          vx[i] += (k * (gx - x[i]) - c * vx[i]) * h;
          vy[i] += (k * (gy - y[i]) - c * vy[i]) * h;
          x[i] += vx[i] * h;
          y[i] += vy[i] * h;
        }
      }
      energy *= Math.exp(-dt / (S.life * 0.4));
      if (energy < 0.004) energy = 0;
      // The swell runs down the chain, so the tail deflates last.
      var pass = 1 - Math.exp(-dt * 16);
      e[0] += (energy - e[0]) * pass;
      for (var j = 1; j < N; j++) e[j] += (e[j - 1] - e[j]) * pass;
      // Asleep once no blob is big enough to be drawn and none is coming.
      var any = energy > 0.02;
      for (var k = 0; k < N && !any; k++) if (radius(k) >= S.cell * LEAST) any = true;
      if (!any) awake = false;
      return awake;
    }

    function radius(i) {
      return S.size * (1 - TAPER * i / (N - 1)) * Math.sqrt(e[i]);
    }

    function draw(ctx) {
      var cell = S.cell;
      // Clear what the last frame wrote.
      for (var r = b2; r <= b3; r++) for (var q = b0; q <= b1; q++) field[r * cols + q] = 0;
      b0 = cols; b1 = -1; b2 = rows; b3 = -1;
      var half = cell / 2;
      for (var i = 0; i < N; i++) {
        var rad = radius(i);
        if (rad < cell * LEAST) continue;
        var R = rad * REACH;
        var R2 = R * R;
        var c0 = Math.max(0, Math.floor((x[i] - R) / cell));
        var c1 = Math.min(cols - 1, Math.floor((x[i] + R) / cell));
        var r0 = Math.max(0, Math.floor((y[i] - R) / cell));
        var r1 = Math.min(rows - 1, Math.floor((y[i] + R) / cell));
        if (c0 > c1 || r0 > r1) continue;
        if (c0 < b0) b0 = c0;
        if (c1 > b1) b1 = c1;
        if (r0 < b2) b2 = r0;
        if (r1 > b3) b3 = r1;
        for (var rr = r0; rr <= r1; rr++) {
          var dy = rr * cell + half - y[i];
          for (var cc = c0; cc <= c1; cc++) {
            var dx = cc * cell + half - x[i];
            var d2 = (dx * dx + dy * dy) / R2;
            if (d2 >= 1) continue;
            var f = 1 - d2;
            field[rr * cols + cc] += f * f;
          }
        }
      }
      if (b1 < b0) return;
      var gap = Math.max(1, cell * 0.14);
      var full = cell - gap;
      var span = HIGH - LOW;
      ctx.beginPath();
      for (var y0 = b2; y0 <= b3; y0++) {
        for (var x0 = b0; x0 <= b1; x0++) {
          var v = field[y0 * cols + x0];
          if (v <= LOW) continue;
          var s = v >= HIGH ? full : full * smooth((v - LOW) / span);
          if (s < 0.6) continue;
          ctx.rect(x0 * cell + half - s / 2, y0 * cell + half - s / 2, s, s);
        }
      }
      ctx.globalAlpha = S.opacity;
      ctx.fillStyle = S.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function clear() {
      awake = false;
      energy = 0;
      loose = 0;
      for (var i = 0; i < N; i++) e[i] = 0;
    }

    return { resize: resize, enter: enter, stroke: stroke, burst: burst, step: step, draw: draw, clear: clear };
  }

  /* ---------- Mount ---------- */

  function mount(el, overrides) {
    if (!el) return null;
    if (el.__pixelRibbon) return el.__pixelRibbon;

    var S = readSettings(el, overrides);
    var motion = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    // Reduced motion: no ribbon at all, not even a still dot. The pointer is
    // the user's own cursor, and a mark that follows it is motion by nature.
    var still = !!(motion && motion.matches);

    var positioned = getComputedStyle(el).position === 'static';
    if (positioned) el.style.position = 'relative';

    /* The layer: one canvas over the whole section, clicks pass through.
       Out of the flow from the first frame, whether the stylesheet is there
       or not: a canvas left in the flow would make the section taller, the
       watcher below would size the canvas to the taller section, and the two
       would grow each other. */
    var canvas = document.createElement('canvas');
    canvas.className = 'pixel-ribbon-layer';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    el.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var host = { S: S };
    var look = Ribbon(host);
    var W = 0, H = 0;
    var frame = 0, running = false, lastT = 0, frames = 0;
    var destroyed = false;

    // Last pointer point, in section coordinates.
    var has = false, px = 0, py = 0;
    // Touch in progress: where and when it began, how far it went.
    var touchX = 0, touchY = 0, touchT = 0, touchMoved = 0, touching = false;

    /* Frozen state: the ribbon held once the pointer pauses.
       Frozen, the loop stops HOLD_AFTER seconds after the last move and the
       canvas keeps that frame, the ribbon lying on the path instead of
       folding in. See freeze() on the api below. */
    var frozen = false, moved = false, quiet = 0;

    function size() {
      var w = el.clientWidth;
      var h = el.clientHeight;
      if (w === W && h === H) return;
      W = w; H = h;
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      look.resize(W, H);
      has = false;
    }

    /* ---------- The loop ---------- */

    // Runs only while something is on screen, and never in a hidden tab.
    function loop(now) {
      frame = 0;
      if (destroyed || document.hidden) { running = false; return; }
      var dt = lastT ? Math.min(MAX_STEP, (now - lastT) / 1000) : 1 / 60;
      lastT = now;
      // Frozen and the pointer paused: the last frame drawn is kept.
      if (frozen) {
        quiet = moved ? 0 : quiet + dt;
        moved = false;
        if (quiet >= HOLD_AFTER) {
          running = false;
          lastT = 0;
          el.setAttribute(STATE, 'held');
          return;
        }
      }
      var alive = look.step(dt);
      ctx.clearRect(0, 0, W, H);
      look.draw(ctx);
      frames++;
      if (!alive) {
        // Nothing left: the last frame drew the empty canvas, then sleep.
        running = false;
        lastT = 0;
        el.setAttribute(STATE, 'idle');
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

    // Everything drawn so far taken off, and the next move a new gesture.
    function wipe() {
      look.clear();
      ctx.clearRect(0, 0, W, H);
      has = false;
    }

    /* ---------- Pointer ---------- */

    function local(clientX, clientY) {
      var box = el.getBoundingClientRect();
      var x = clientX - box.left;
      var y = clientY - box.top;
      if (!has) {
        has = true;
        px = x; py = y;
        look.enter(x, y);
        return;
      }
      var dx = x - px, dy = y - py;
      if (Math.sqrt(dx * dx + dy * dy) < 0.5) return;
      look.stroke(px, py, x, y);
      px = x; py = y;
      moved = true;
      wake();
    }

    function onMove(e) {
      if (still || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
      local(e.clientX, e.clientY);
    }

    function onLeave(e) {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') has = false;
    }

    /* Touch: touch events rather than pointer events.
       A finger drag that turns into a scroll cancels its pointer events but
       keeps sending touchmove. The page still scrolls; the ribbon is drawn
       in section coordinates, so it stays where the finger passed. A short
       touch that barely moves is a tap, and throws the chain out as drops. */
    function onTouchStart(e) {
      if (still || !e.touches.length) return;
      var t = e.touches[0];
      touching = true;
      touchX = t.clientX; touchY = t.clientY; touchT = e.timeStamp || performance.now(); touchMoved = 0;
      has = false;
      local(t.clientX, t.clientY);
    }

    function onTouchMove(e) {
      if (still || !touching || !e.touches.length) return;
      var t = e.touches[0];
      var dx = t.clientX - touchX, dy = t.clientY - touchY;
      touchMoved = Math.max(touchMoved, Math.sqrt(dx * dx + dy * dy));
      local(t.clientX, t.clientY);
    }

    function onTouchEnd(e) {
      if (still || !touching) return;
      touching = false;
      has = false;
      var held = (e.timeStamp || performance.now()) - touchT;
      if (touchMoved < TAP_TRAVEL && held < TAP_TIME) {
        var box = el.getBoundingClientRect();
        look.burst(touchX - box.left, touchY - box.top);
        moved = true;
        wake();
      }
    }

    function onVisibility() {
      if (document.hidden) sleep();
      else if (look.step(0)) wake();
    }

    function onMotion() {
      still = !!(motion && motion.matches);
      if (still) {
        sleep();
        look.clear();
        ctx.clearRect(0, 0, W, H);
        el.setAttribute(STATE, 'still');
      } else {
        el.setAttribute(STATE, 'idle');
      }
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
       late) would show every pixel stretched until the next real resize. */
    var watcher = null;
    if (typeof ResizeObserver === 'function') {
      watcher = new ResizeObserver(size);
      watcher.observe(el);
    }
    size();
    el.setAttribute(STATE, still ? 'still' : 'idle');

    var api = {
      element: el,
      settings: S,
      resize: size,
      // Rendered frames since mount, and whether the loop is running: for
      // a test to see that the loop sleeps at rest.
      frames: function () { return frames; },
      isRunning: function () { return running; },
      burst: function (x, y) { if (!still) { look.burst(x, y); moved = true; wake(); } return api; },
      clear: function () { look.clear(); ctx.clearRect(0, 0, W, H); return api; },
      /* freeze(): the next ribbon held as a still picture.
         What is on screen is taken off, then the next ribbon drawn is held
         a moment after the pointer pauses, lying on its path, and the loop
         stops, so a held ribbon costs nothing. Meant for a still image of
         the effect, a thumbnail that has to show a ribbon at rest; a page
         never needs it. unfreeze() takes the held ribbon off and hands the
         next one back to the clock. */
      freeze: function () {
        frozen = true;
        moved = false;
        quiet = 0;
        wipe();
        if (!running && !destroyed) el.setAttribute(STATE, still ? 'still' : 'idle');
        return api;
      },
      unfreeze: function () {
        frozen = false;
        wipe();
        if (!running && !destroyed) el.setAttribute(STATE, still ? 'still' : 'idle');
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
        if (positioned) el.style.position = '';
        if (el.getAttribute('style') === '') el.removeAttribute('style');
        if (el.__pixelRibbon === api) delete el.__pixelRibbon;
      },
    };

    el.__pixelRibbon = api;
    return api;
  }

  function destroy(el) {
    if (el && el.__pixelRibbon) el.__pixelRibbon.destroy();
  }

  function freeze(el) {
    if (el && el.__pixelRibbon) el.__pixelRibbon.freeze();
  }

  function unfreeze(el) {
    if (el && el.__pixelRibbon) el.__pixelRibbon.unfreeze();
  }

  /* Page-wide settings, read before auto mounting.
     auto() reads window.PixelRibbonSettings itself: auto mounting happens
     at DOM ready, and mount() on a section that already carries a ribbon
     returns the existing one untouched, so settings handed in afterwards
     would be dropped. */
  function auto(root) {
    var scope = root || document;
    var page = global.PixelRibbonSettings;
    [].forEach.call(scope.querySelectorAll('[' + PREFIX + ']'), function (el) { mount(el, page); });
  }

  global.PixelRibbon = {
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
