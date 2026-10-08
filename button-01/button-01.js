/* Button 01, the engine: magnetic, from the Button set.
   Moving parts. The button leans lightly toward the pointer before it reaches it, and settles back with a soft elastic return. Ignores a finger, played with GSAP.
   Readable source: components/button-01/button-01.js, built from components/button-motion/button-motion.js */
(function (global) {
  'use strict';

  // Settings. Change values below.
  var DEFAULTS = {
    duration: 0.6, // s. Base length, the return takes 1.8 times it.
    pull: 0.1,     // share of the offset. How far the button follows the pointer.
    reach: 0.4,    // share of the button height. Where the pull begins around it.
    press: 0.96,   // scale. Size of the button while pressed, 1 for none.
  };

  /* The animation of this file, handed to the base of the set.
     Every button of the set ships the base, the second script of this file.
     The first file on the page builds it; a file loaded after it finds it on
     window.ButtonMotion and only adds its animation, so two buttons pasted
     on one page share one base, one pointer listener and one list of
     buttons. The page-wide block is read here, as the file loads, so the
     settings block of an Embed governs what that Embed brings. */
  var pack = {
    sheet: 'button-01.css',
    defaults: DEFAULTS,
    page: global.ButtonMotionSettings,
    effects: [magnetic],
  };
  var base = global.ButtonMotion;
  if (base && base.register) base.register(pack);
  else global.ButtonMotion = { packs: ((base && base.packs) || []).concat(pack) };

  /* ---------- magnetic ---------- */

  /* The button leans toward the pointer before the pointer reaches it.
     The pull starts outside the box, so the button's own enter event is too
     late for it: the page's pointer, read once per frame by the base, drives
     it. Each button measures its own distance, with its current travel taken
     off so a button already pulled does not chase itself. */
  function magnetic(kit) {
    var magnets = [];

    function frame(e) {
      magnets.forEach(function (inst) {
        if (inst.dead || !inst.built || kit.reduced()) return;
        var r = inst.el.getBoundingClientRect();
        // Travel read only while pulled: GSAP writes translate, rotate and
        // scale as none on a button it parses, and one at rest holds nothing.
        var moved = inst.el.style.transform !== '';
        var cx = r.left + r.width / 2 - (moved ? parseFloat(global.gsap.getProperty(inst.el, 'x')) || 0 : 0);
        var cy = r.top + r.height / 2 - (moved ? parseFloat(global.gsap.getProperty(inst.el, 'y')) || 0 : 0);
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var reach = inst.s.reach * r.height;
        var inside = Math.abs(dx) < r.width / 2 + reach && Math.abs(dy) < r.height / 2 + reach;
        if (inside) {
          if (!inst.magnet) {
            inst.magnet = true;
            kit.enter(inst, kit.point(inst, e), 'pointer');
          }
          pull(inst, dx, dy);
        } else if (inst.magnet) {
          inst.magnet = false;
          kit.leave(inst, kit.point(inst, e));
        }
      });
    }

    function pull(inst, dx, dy) {
      var gsap = global.gsap;
      gsap.to(inst.el, { x: dx * inst.s.pull, y: dy * inst.s.pull, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
      // The label goes a little further than its plate: two layers, not one.
      gsap.to(inst.label, { x: dx * inst.s.pull * 0.4, y: dy * inst.s.pull * 0.4, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
    }

    /* The cleanup rides the label's tween, created last: the two end on the
       same tick, and the one created last renders last. */
    function release(inst, t) {
      var gsap = global.gsap;
      gsap.to(inst.el, { x: 0, y: 0, duration: t * 1.8, ease: 'elastic.out(1, 0.6)', overwrite: 'auto' });
      gsap.to(inst.label, {
        x: 0, y: 0, duration: t * 1.8, ease: 'elastic.out(1, 0.6)', overwrite: 'auto',
        onComplete: function () { if (!inst.hover) kit.clearInline(inst); },
      });
    }

    return {
      name: 'magnetic',
      // Settings this animation reads, the keys a file of this button alone keeps.
      uses: ['duration', 'pull', 'reach', 'press'],
      limits: { pull: [0, 1], reach: [0, 4] },
      moves: true,
      follows: true,
      near: true,
      build: function (inst) {
        magnets.push(inst);
        kit.onMove(frame);
      },
      unbuild: function (inst) {
        var at = magnets.indexOf(inst);
        if (at !== -1) magnets.splice(at, 1);
        if (!magnets.length) kit.offMove(frame);
      },
      // The pull itself is driven frame by frame by frame().
      enter: function () {},
      leave: function (inst, p, t) { release(inst, t); },
    };
  }
}(window));

/* ---------- second script ---------- */

/* The base of the set: settings, ink, label, pointer, keyboard, mounting.
   Every button of the set ships it. The first file on the page builds it
   and takes the animations every file hands over; a file loaded after it
   finds it on window.ButtonMotion and leaves this part at once. */
(function (global) {
  'use strict';

  var early = global.ButtonMotion;
  if (early && early.register) return;

  /* Animation: the value of the data-button-motion attribute.
     The animation is not a setting: it is the value of the marking attribute
     itself, data-button-motion="magnetic", "fill", "roll", "outline",
     "tilt", "pixel" or "sparks", so it is read
     and changed on the element, in the Webflow Settings panel, and a
     page-wide block can never silently swap one button's animation for
     another. */
  var PREFIX = 'data-button-motion';
  // The animations of the set. A value among them whose file is not on the page yet waits for it.
  var FAMILY = ['magnetic', 'fill', 'roll', 'outline', 'tilt', 'pixel', 'sparks'];
  var FALLBACK_MODE = 'fill';

  var STATE = PREFIX + '-state';
  var MARKER = '--button-motion-css';

  // Class of the label, the button's own content moved into one box.
  var LABEL = 'button-motion-label';

  /* Settings the stylesheet reads, passed as custom properties.
     Written only when not the sheet's own fallback, so an untouched button
     holds nothing inline at all. */
  var VARS = { color: '--button-motion-color', ink: '--button-motion-ink' };

  /* Ink picked for the colour when none is given.
     `ink: 'auto'`, the default, takes whichever of the two reads better on
     `color` by WCAG contrast: the dark one on the default amber #ffab1a or a pale colour, the light one on
     a deep or saturated one. An ink given by
     attribute, page block or mount() is kept as it is. The dark one is the
     sheet's fallback. */
  var INK_DARK = '#15100c';
  var INK_LIGHT = '#f4ece0';
  // The sheet's fallbacks: its colour, and the ink auto picks on it.
  var FALLBACKS = { color: '#ffab1a', ink: INK_DARK };

  // px. The button's border widths, top, right, bottom, left.
  var EDGES = ['--button-motion-bt', '--button-motion-br', '--button-motion-bb', '--button-motion-bl'];

  /* Bounds of the settings: low, high, and 1 for whole numbers.
     The two every animation reads are here; each animation adds its own. */
  var LIMITS = { duration: [0.05, 5], press: [0.5, 1] };

  // How long GSAP is waited for before a button gives up and stays plain.
  var GSAP_WAIT = 10000; // ms

  var effects = {};   // The animations handed over, by name.
  var modes = [];     // Their names, in the order they came.
  var instances = [];
  var waiting = [];   // Buttons whose animation's file is not on the page yet.
  var movers = [];    // What reads the page's pointer once per frame.
  var moveHooked = false;
  var lastMove = null;
  var seen = null; // Where the pointer was one move ago, on the page.
  var moveFrame = 0;

  function each(list, fn) {
    [].slice.call(list).forEach(fn);
  }

  function reduced() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function dashed(key) {
    return PREFIX + '-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function clamp(n, low, high) {
    return n < low ? low : n > high ? high : n;
  }

  function emit(inst, name, extra) {
    var detail = { element: inst.el, mode: inst.mode };
    for (var key in extra) detail[key] = extra[key];
    inst.el.dispatchEvent(new CustomEvent('buttonmotion:' + name, { bubbles: true, detail: detail }));
  }

  /* ---------- Registering ---------- */

  /* A file hands over its animations with its DEFAULTS, the page-wide block
     as it stood when the file loaded, and the name of its stylesheet.
     An animation is a function of the kit below that returns what it does:
     its name, the settings it reads (uses) and their bounds (limits);
     paints, when its layers paint the button over its border; moves, when
     it is movement and nothing else; follows, when it follows a pointer and
     ignores a finger; near, when the page's pointer drives it rather than
     the button's enter and leave; the custom properties it writes (props);
     then its steps, build, label, unbuild, kill, rest, move and press, each
     optional, and enter and leave. The first file to bring a name keeps it. */
  function register(pack) {
    if (!self.defaults) self.defaults = pack.defaults;
    pack.effects.forEach(function (make) {
      var fx = make(kit);
      if (modes.indexOf(fx.name) !== -1) return;
      fx.defaults = pack.defaults;
      fx.page = pack.page;
      fx.sheet = pack.sheet;
      for (var key in fx.limits) LIMITS[key] = fx.limits[key];
      effects[fx.name] = fx;
      modes.push(fx.name);
    });
    // Before the DOM is ready, auto() on DOMContentLoaded mounts everything at once.
    if (document.readyState !== 'loading') {
      waiting.slice().forEach(function (w) { mountOne(w.el, w.overrides, w.page); });
      auto();
    }
  }

  /* A button whose animation is one of the set's, with no file for it yet.
     It stays the page's plain button until that file comes, and says so
     after the time GSAP is given. */
  function wait(el, overrides, fromPage) {
    for (var i = 0; i < waiting.length; i++) if (waiting[i].el === el) return;
    waiting.push({ el: el, overrides: overrides, page: fromPage });
    setTimeout(function () {
      if (el.__buttonMotion) return;
      console.warn('Button motion: ' + PREFIX + '="' + (el.getAttribute(PREFIX) || '').trim() + '" is an ' +
        'animation whose code is not on this page, so the button stays as it is. Add the Embed or the ' +
        'file of that button. Animations on this page: ' + modes.join(', ') + '.', el);
    }, GSAP_WAIT);
  }

  function unwait(el) {
    for (var i = 0; i < waiting.length; i++) {
      if (waiting[i].el === el) { waiting.splice(i, 1); return; }
    }
  }

  /* ---------- Settings ---------- */

  /* Settings order: defaults, page block, element attributes.
     Three levels, least specific first: the DEFAULTS of the animation's own
     file, then what the caller hands in (the page-wide block, a mount()
     argument), then the element's own attributes. */
  /* Example: data-button-motion-pull="0.5" */
  function readSettings(el, overrides, into, fx) {
    var defaults = fx.defaults;
    var s = into || {};
    for (var key in defaults) {
      var value = defaults[key];
      if (overrides && overrides[key] != null && overrides[key] !== '') value = overrides[key];
      var raw = el.getAttribute(dashed(key));
      if (raw !== null && raw.trim() !== '') value = raw.trim();
      if (typeof defaults[key] === 'number') {
        var n = parseFloat(value);
        value = isNaN(n) ? defaults[key] : n;
      } else {
        value = String(value);
      }
      s[key] = value;
    }
    for (key in LIMITS) {
      if (typeof s[key] !== 'number') continue;
      var b = LIMITS[key];
      s[key] = clamp(s[key], b[0], b[1]);
      if (b[2]) s[key] = Math.round(s[key]);
    }
    if (s.ink != null && s.ink.toLowerCase() === 'auto') s.ink = inkFor(s.color);
    return s;
  }

  /* The page-wide block an animation reads, the animation left out.
     The block its file saw as it loaded, or window.ButtonMotionSettings as
     it stands when the file saw none. */
  function pageOf(fx) {
    var page = fx.page || global.ButtonMotionSettings;
    if (!page) return null;
    var shared = {};
    for (var key in page) if (key !== 'mode') shared[key] = page[key];
    return shared;
  }

  /* ---------- Ink ---------- */

  var probe = null;

  /* Any CSS colour as sRGB, painted on a one pixel canvas.
     The canvas reads every syntax the browser knows, names, hex, rgb(),
     hsl(), oklch(), and hands back plain numbers. A value it refuses, or a
     var() it cannot see, gives null. */
  function rgbOf(color) {
    try {
      if (!probe) {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        probe = canvas.getContext('2d', { willReadFrequently: true });
      }
      var mark = '#010203';
      probe.fillStyle = mark;
      probe.fillStyle = color;
      if (probe.fillStyle === mark && String(color).trim().toLowerCase() !== mark) return null;
      probe.clearRect(0, 0, 1, 1);
      probe.fillRect(0, 0, 1, 1);
      var d = probe.getImageData(0, 0, 1, 1).data;
      return d[3] ? [d[0], d[1], d[2]] : null;
    } catch (e) {
      return null;
    }
  }

  // Relative luminance, WCAG 2.
  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // The ink of the two with the higher contrast on the colour, dark when unreadable.
  function inkFor(color) {
    var rgb = rgbOf(color);
    if (!rgb) return INK_DARK;
    var l = luminance(rgb) + 0.05;
    var dark = l / (luminance(rgbOf(INK_DARK)) + 0.05);
    var light = (luminance(rgbOf(INK_LIGHT)) + 0.05) / l;
    return light > dark ? INK_LIGHT : INK_DARK;
  }

  /* Animation reader, with a warning for an unknown value.
     An empty or unknown value falls back to fill, or to the first animation
     on the page when fill's file is not there, and says so with the
     element, because an animation nobody gets is the one mistake a Designer
     user cannot see. A value of the set whose file has not come yet gives
     null: the button waits for it. */
  function readMode(el, overrides) {
    var raw = el.getAttribute(PREFIX);
    var value = (raw || '').trim().toLowerCase();
    if (!value && overrides && overrides.mode) value = String(overrides.mode).trim().toLowerCase();
    if (modes.indexOf(value) !== -1) return value;
    if (FAMILY.indexOf(value) !== -1) return null;
    var fallback = modes.indexOf(FALLBACK_MODE) !== -1 ? FALLBACK_MODE : modes[0];
    console.warn('Button motion: ' + PREFIX + '="' + (raw || '') + '" ' +
      (value ? 'is not an animation this component knows' : 'has no animation') +
      '. Accepted values: ' + modes.join(', ') + '. Using "' + fallback + '".', el);
    return fallback;
  }

  function applyVars(el, S) {
    for (var key in VARS) {
      if (S[key] == null) {
        el.style.removeProperty(VARS[key]);
        continue;
      }
      var value = String(S[key]);
      if (value.toLowerCase() === FALLBACKS[key]) el.style.removeProperty(VARS[key]);
      else el.style.setProperty(VARS[key], value);
    }
    tidy(el);
  }

  // An emptied style attribute is removed, so a button at rest holds nothing.
  function tidy(el) {
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  }

  function hasSheet(el) {
    return global.getComputedStyle(el).getPropertyValue(MARKER).trim() !== '';
  }

  /* ---------- What the engine builds ---------- */

  /* The label: the button's own content, moved into one span.
     Every animation moves or paints the words apart from the button, so they
     need a box of their own. The nodes are moved, never copied, and put back
     as they were on destroy. An animation that shows the words its own way
     fills the label itself; then it builds its layers beside it. */
  function build(inst) {
    var el = inst.el;
    var label = document.createElement('span');
    label.className = LABEL;
    inst.original = [].slice.call(el.childNodes);
    inst.label = label;

    if (inst.fx.label) {
      inst.fx.label(inst);
    } else {
      inst.original.forEach(function (node) { label.appendChild(node); });
    }
    el.appendChild(label);

    if (inst.fx.build) inst.fx.build(inst);
    inst.built = true;
  }

  // Everything the engine added taken out, the original nodes put back.
  function unbuild(inst) {
    var el = inst.el;
    if (!inst.built) return;
    killAll(inst);
    if (inst.fx.unbuild) inst.fx.unbuild(inst);
    while (el.firstChild) el.removeChild(el.firstChild);
    inst.original.forEach(function (node) { el.appendChild(node); });
    inst.original = [];
    inst.label = null;
    inst.built = false;
    inst.hover = false;
    inst.magnet = false;
    clearInline(inst);
  }

  function killAll(inst) {
    if (!global.gsap) return;
    if (inst.fx.kill) inst.fx.kill(inst);
    global.gsap.killTweensOf(inst.label ? [inst.el, inst.label] : [inst.el]);
  }

  /* A transform taken off, GSAP's cache included.
     GSAP also writes translate, rotate and scale as none beside the
     transform it sets, and clearing the transform does not always take
     those three with it, so they are removed by name. */
  function clearTransform(node) {
    if (global.gsap) global.gsap.set(node, { clearProps: 'transform' });
    ['transform', 'translate', 'rotate', 'scale'].forEach(function (name) {
      node.style.removeProperty(name);
    });
    tidy(node);
  }

  // Nothing inline once an interaction is over: the sheet alone dresses the rest.
  function clearInline(inst) {
    var el = inst.el;
    (inst.fx.props || []).concat(EDGES).forEach(function (name) { el.style.removeProperty(name); });
    clearTransform(el);
    if (inst.label) clearTransform(inst.label);
    if (inst.fx.rest) inst.fx.rest(inst);
  }

  /* ---------- The border ---------- */

  /* The button's border widths, written for the layers that paint it.
     An absolute layer starts inside the border, so a flood, a sheen, a grid
     or a glow left there showed the page's border as a ring around the
     colour. The sheet pushes those layers out by these four widths onto the
     border box, where border-radius: inherit is the outer radius. Measured
     at enter, written only for a side that has a border, cleared at rest. */
  function edges(inst) {
    var cs = global.getComputedStyle(inst.el);
    var widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
    widths.forEach(function (w, i) {
      var n = parseFloat(w) || 0;
      if (n > 0) inst.el.style.setProperty(EDGES[i], n + 'px');
      else inst.el.style.removeProperty(EDGES[i]);
    });
    tidy(inst.el);
  }

  /* ---------- Where the pointer is ---------- */

  // The pointer inside the button's box, or its centre when there is no pointer.
  function point(inst, e) {
    var r = inst.el.getBoundingClientRect();
    if (!e || e.clientX == null) return { x: r.width / 2, y: r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height, l: r.left, t: r.top };
  }

  /* The point pushed onto the nearest edge of the button.
     A pointer brought in quickly is already well inside the box by the time
     the browser reports it, and a flood born there covers the button at
     once. Born on the rim, the circle always has the whole button to cross,
     however fast the pointer arrived. */
  function onRim(p) {
    var was = outside(p, seen);
    if (was) return was;
    var top = p.y;
    var right = p.w - p.x;
    var bottom = p.h - p.y;
    var left_ = p.x;
    var near = Math.min(top, right, bottom, left_);
    var x = Math.min(Math.max(p.x, 0), p.w);
    var y = Math.min(Math.max(p.y, 0), p.h);
    if (near === top) return { x: x, y: 0 };
    if (near === right) return { x: p.w, y: y };
    if (near === bottom) return { x: x, y: p.h };
    return { x: 0, y: y };
  }

  /* The last place the pointer was seen outside the button, on its rim.
     A pointer brought in quickly is reported inside the box, and the edge
     nearest that report is often not the edge it crossed. The move before
     it was still outside, and pulled back to the box it names the side. */
  function outside(p, at) {
    if (!at || p.l == null) return null;
    var x = at.x - p.l;
    var y = at.y - p.t;
    if (x > 0 && x < p.w && y > 0 && y < p.h) return null;
    return { x: Math.min(Math.max(x, 0), p.w), y: Math.min(Math.max(y, 0), p.h) };
  }

  // The rim point the pointer left by, or the nearest edge when it is still inside.
  function rimLeave(p) {
    return outside(p, { x: p.l + p.x, y: p.t + p.y }) || onRim(p);
  }

  // A rim point with the box size of the point it came from.
  function sized(rim, p) {
    return { x: rim.x, y: rim.y, w: p.w, h: p.h };
  }

  // Which side of the box a rim point is on.
  function sideOf(rim, p) {
    if (rim.x <= 0) return 'left';
    if (rim.x >= p.w) return 'right';
    if (rim.y <= 0) return 'top';
    return 'bottom';
  }

  // The label's box inside the button's, measured now.
  function labelBox(inst) {
    var lr = inst.label.getBoundingClientRect();
    var er = inst.el.getBoundingClientRect();
    return { x: lr.left - er.left, y: lr.top - er.top, w: lr.width, h: lr.height };
  }

  /* One pointer listener for the whole page, read once per frame.
     Two things need the pointer before it is over a button: an animation
     whose pull starts outside the box, which asks for the frames with
     onMove(), and every animation that starts at an edge, which needs the
     move before the one that landed inside, the one that names the side the
     pointer came from. */
  function hookMoves() {
    if (moveHooked) return;
    moveHooked = true;
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      seen = { x: e.clientX, y: e.clientY };
      lastMove = e;
      if (movers.length && !moveFrame) moveFrame = requestAnimationFrame(runMovers);
    }, { passive: true });
  }

  function runMovers() {
    moveFrame = 0;
    var e = lastMove;
    if (!e || !global.gsap) return;
    movers.slice().forEach(function (fn) { fn(e); });
  }

  function onMove(fn) {
    if (movers.indexOf(fn) === -1) movers.push(fn);
  }

  function offMove(fn) {
    var at = movers.indexOf(fn);
    if (at !== -1) movers.splice(at, 1);
  }

  /* ---------- Enter, leave, press ---------- */

  /* Reduced motion: the end state at once, and nothing that follows the pointer.
     fill, roll, outline and pixel jump to their hover state and back,
     which keeps the hover readable; sparks keeps its glow and loses its
     sparks; magnetic and tilt, which are movement and nothing else, do
     nothing at all. */
  function enter(inst, p, via) {
    if (!inst.built || inst.hover) return;
    inst.hover = true;
    inst.via = via;
    inst.el.setAttribute(STATE, 'hover');
    var still = reduced();
    var t = still ? 0 : inst.s.duration;
    if (!(still && inst.fx.moves)) {
      if (inst.fx.paints) edges(inst);
      inst.fx.enter(inst, p, t);
    }
    emit(inst, 'enter', { via: via });
  }

  function leave(inst, p) {
    if (!inst.built || !inst.hover) return;
    inst.hover = false;
    inst.el.setAttribute(STATE, 'idle');
    var still = reduced();
    var t = still ? 0 : inst.s.duration;
    if (!(still && inst.fx.moves)) inst.fx.leave(inst, p, t);
    emit(inst, 'leave', { via: inst.via });
  }

  function press(inst) {
    if (!inst.built || inst.pressed || reduced() || inst.s.press >= 1) return;
    inst.pressed = true;
    global.gsap.to(inst.el, { scale: inst.s.press, duration: 0.14, ease: 'power2.out', overwrite: 'auto' });
  }

  function release(inst) {
    if (!inst.pressed) return;
    inst.pressed = false;
    global.gsap.to(inst.el, {
      scale: 1, duration: 0.5, ease: 'back.out(3)', overwrite: 'auto',
      onComplete: function () { if (!inst.hover && !inst.magnet) clearInline(inst); },
    });
  }

  /* ---------- Listening ---------- */

  function on(inst, name, fn, options) {
    inst.el.addEventListener(name, fn, options);
    inst.handlers.push([name, fn, options]);
  }

  function focusVisible(el) {
    try { return el.matches(':focus-visible'); } catch (e) { return true; }
  }

  /* Pointer, finger and keyboard, on the button itself.
     A finger gets the animation for the length of the tap, since a touch
     pointer enters on touch and leaves on release. magnetic and tilt follow
     a pointer and ignore a finger. Keyboard focus, when the browser would
     show a ring, plays the enter from the centre. */
  function listen(inst) {
    var fx = inst.fx;
    on(inst, 'pointerenter', function (e) {
      if (e.pointerType === 'touch' && fx.follows) return;
      if (fx.near) return;
      enter(inst, point(inst, e), e.pointerType === 'touch' ? 'touch' : 'pointer');
    });
    on(inst, 'pointerleave', function (e) {
      if (fx.near) return;
      if (inst.via === 'keyboard') return;
      leave(inst, point(inst, e));
    });
    on(inst, 'pointermove', function (e) {
      if (!fx.move || e.pointerType === 'touch' || !inst.hover || reduced()) return;
      fx.move(inst, point(inst, e));
    }, { passive: true });
    on(inst, 'focusin', function () {
      if (inst.hover || !focusVisible(inst.el)) return;
      enter(inst, point(inst, null), 'keyboard');
    });
    on(inst, 'focusout', function () {
      if (inst.via !== 'keyboard') return;
      if (fx.near) inst.magnet = false;
      leave(inst, point(inst, null));
      release(inst);
    });
    on(inst, 'pointerdown', function (e) {
      press(inst);
      if (fx.press) fx.press(inst, point(inst, e));
    });
    on(inst, 'pointerup', function () { release(inst); });
    on(inst, 'pointercancel', function () { release(inst); });
    on(inst, 'keydown', function (e) {
      if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
      press(inst);
      if (fx.press) fx.press(inst, point(inst, null));
    });
    on(inst, 'keyup', function () { release(inst); });
    hookMoves();
  }

  function unlisten(inst) {
    inst.handlers.forEach(function (h) { inst.el.removeEventListener(h[0], h[1], h[2]); });
    inst.handlers = [];
  }

  /* ---------- Mounting ---------- */

  function mount(el, overrides) {
    return mountOne(el, overrides, false);
  }

  // fromPage: mounted by auto(), which hands the page-wide block of the button's animation.
  function mountOne(el, overrides, fromPage) {
    if (!el || el.nodeType !== 1) return null;
    if (el.__buttonMotion) return el.__buttonMotion;

    var mode = readMode(el, overrides);
    if (!mode) {
      wait(el, overrides, fromPage);
      return null;
    }
    unwait(el);
    var fx = effects[mode];
    if (fromPage) overrides = pageOf(fx);

    var inst = {
      el: el,
      overrides: overrides || null,
      mode: mode,
      fx: fx,
      s: {},
      original: [],
      label: null,
      handlers: [],
      built: false,
      hover: false,
      via: '',
      pressed: false,
      magnet: false,
      dead: false,
    };
    readSettings(el, overrides, inst.s, fx);
    applyVars(el, inst.s);
    instances.push(inst);

    var api = {
      element: el,
      settings: inst.s,
      mode: inst.mode,
      // enter() and leave() play the animation from the centre, as focus does.
      enter: function () { enter(inst, point(inst, null), 'api'); return api; },
      leave: function () { inst.magnet = false; leave(inst, point(inst, null)); return api; },
      // refresh(): reread the settings and, if the attribute value changed, rebuild.
      refresh: function () {
        var mode = readMode(el, inst.overrides);
        var rebuild = mode && mode !== inst.mode && inst.built;
        if (!mode) {
          console.warn('Button motion: ' + PREFIX + '="' + el.getAttribute(PREFIX) + '" is an animation whose ' +
            'code is not on this page. The button keeps "' + inst.mode + '".', el);
        }
        if (rebuild) {
          unlisten(inst);
          unbuild(inst);
          inst.mode = mode;
          inst.fx = effects[mode];
          api.mode = mode;
          for (var key in inst.s) delete inst.s[key];
        }
        readSettings(el, inst.overrides, inst.s, inst.fx);
        applyVars(el, inst.s);
        if (rebuild) {
          build(inst);
          listen(inst);
          el.setAttribute(STATE, 'idle');
        }
        return api;
      },
      destroy: function () {
        inst.dead = true;
        unlisten(inst);
        unbuild(inst);
        el.removeAttribute(STATE);
        for (var key in VARS) el.style.removeProperty(VARS[key]);
        tidy(el);
        var at = instances.indexOf(inst);
        if (at !== -1) instances.splice(at, 1);
        delete el.__buttonMotion;
      },
    };
    el.__buttonMotion = api;

    if (!hasSheet(el)) {
      console.warn('Button motion: ' + fx.sheet + ' is not on this page, so the ' +
        'layers the engine builds have no place and no colour. Add the stylesheet.');
    }

    whenReady(function () {
      if (inst.dead) return;
      build(inst);
      listen(inst);
      el.setAttribute(STATE, 'idle');
      emit(inst, 'ready', { reduced: reduced() });
    });

    return api;
  }

  function destroy(el) {
    if (el && el.__buttonMotion) el.__buttonMotion.destroy();
  }

  function refresh(el) {
    if (el && el.__buttonMotion) return el.__buttonMotion.refresh();
    return null;
  }

  /* Page-wide settings from window.ButtonMotionSettings.
     Read here and not only by whoever calls mount(): auto-mounting happens
     first, and mount() on a button already mounted hands back the existing
     one untouched. Each button gets the block of its own animation's file
     (pageOf). The animation is left out on purpose: it stays on the
     element. */
  function auto(root) {
    var scope = root || document;
    if (scope.nodeType === 1 && scope.hasAttribute(PREFIX)) mountOne(scope, null, true);
    each(scope.querySelectorAll('[' + PREFIX + ']'), function (el) { mountOne(el, null, true); });
  }

  /* Wait for GSAP before touching the button.
     GSAP can land after this file: Webflow injects its own copy, and a
     script tag written into an Embed loads on its own schedule. So a button
     waits for it instead of assuming it is there, and stays the plain
     button of the page the whole time it waits. */
  function whenReady(run) {
    var waited = 0;
    function step() {
      if (global.gsap) return run();
      if (waited >= GSAP_WAIT) {
        console.warn('Button motion: GSAP was not found on this page. The button ' +
          'stays as the page styled it, and nothing moves.');
        return;
      }
      waited += 50;
      setTimeout(step, 50);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', step);
    } else {
      step();
    }
  }

  // What an animation may use of the base.
  var kit = {
    color: FALLBACKS.color,
    vars: VARS,
    clamp: clamp,
    reduced: reduced,
    tidy: tidy,
    clearTransform: clearTransform,
    clearInline: clearInline,
    point: point,
    onRim: onRim,
    outside: outside,
    rimLeave: rimLeave,
    sized: sized,
    sideOf: sideOf,
    labelBox: labelBox,
    enter: enter,
    leave: leave,
    onMove: onMove,
    offMove: offMove,
  };

  var self = {
    mount: mount,
    destroy: destroy,
    refresh: refresh,
    auto: auto,
    // The DEFAULTS of the first file on the page.
    defaults: null,
    modes: modes,
    register: register,
    kit: kit,
  };
  global.ButtonMotion = self;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { auto(); });
  }
  ((early && early.packs) || []).forEach(register);
}(window));
