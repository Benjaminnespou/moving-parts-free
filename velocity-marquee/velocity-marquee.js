/* Velocity marquee, the engine.
   Moving parts. An endless ribbon whose speed, way and lean follow the page scroll.
   Readable source: components/velocity-marquee/velocity-marquee.js */
(function (global) {
  'use strict';

  // Settings. Change values below.
  var DEFAULTS = {
    cruise: 46,         // px/s. Speed of the ribbon when the page stands still.
    direction: 'left',  // left or right. Way the ribbon runs at rest.
    boost: 1.5,         // factor. Share of the scroll speed added to the ribbon.
    maxSpeed: 2400,     // px/s. Fastest the ribbon may ever run.
    ease: 0.12,         // 0 to 1. How fast the ribbon answers the scroll.
    skew: 7,            // deg. Largest lean, reached at top speed.
    reverse: true,      // true or false. Scrolling up runs the ribbon backwards.
    reducedSpeed: 0,    // px/s. Speed under reduced motion (0 stands still).
    debug: false,       // true or false. Writes the live state in attributes.
  };

  var PREFIX = 'data-velocity-marquee';
  var TRACK = PREFIX + '-track';
  var STRIP = PREFIX + '-strip';
  var CLONE = PREFIX + '-clone';
  var STATE = PREFIX + '-state';
  var DEBUG = PREFIX + '-debug-';
  var MARKER = '--velocity-marquee-css';

  var NUMBERS = ['cruise', 'boost', 'maxSpeed', 'ease', 'skew', 'reducedSpeed'];
  var BOOLS = ['reverse', 'debug'];
  var WAYS = { left: -1, right: 1 };

  /* Longest frame step, so a stall never jumps the ribbon.
     A frame longer than this is a stall, not a slow frame. Advancing the
     ribbon by the whole gap would be a jump, so the gap is capped instead. */
  var MAX_STEP = 0.05; // s

  // The clock is checked this often, and revived if no frame came for this long.
  var PULSE_CHECK = 300;  // ms
  var PULSE_GRACE = 900;  // ms

  // How long the library is waited for before the engine says it is missing.
  var GSAP_WAIT = 10000; // ms

  // Debug attributes are written this often, never once a frame.
  var DEBUG_RATE = 6; // per s

  /* Delay before a ribbon that measures nothing warns.
     How long a ribbon that measures nothing keeps quiet. A stylesheet that is
     merely late leaves the copies stacked for a frame or two, and naming a
     fault that fixes itself is worse than saying nothing. */
  var LATE_WARN = 1500; // ms

  /* Copy limit for a very narrow ribbon.
     A ribbon of a few pixels (a stylesheet that never came, a track holding
     one thin item) would ask for thousands of copies. It gets this many and
     says so. */
  var MAX_COPIES = 40;

  var FOCUSABLE = 'a[href], button, input, select, textarea, iframe, area[href], summary, [tabindex], [contenteditable]';

  var items = [];      // every mounted ribbon
  var live = [];       // the ones on screen, the only ones that cost anything
  var seer = null;     // one IntersectionObserver for all of them
  var sizer = null;    // one ResizeObserver for all of them
  var fonts = false;
  var motion = null;
  var warned = {};

  function warn(key, message, el) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn('Velocity marquee: ' + message, el || '');
  }

  function stamp() {
    return global.performance && performance.now ? performance.now() : Date.now();
  }

  function clamp(n, low, high) {
    return n < low ? low : n > high ? high : n;
  }

  function reduced() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function dashed(key) {
    return PREFIX + '-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function truthy(value) { return value === true || /^(true|1|yes|on)$/i.test(String(value)); }
  function falsy(value) { return value === false || /^(false|0|no|off)$/i.test(String(value)); }

  function scrollTop() {
    if (typeof global.scrollY === 'number') return global.scrollY;
    var doc = document.scrollingElement || document.documentElement;
    return doc ? doc.scrollTop : 0;
  }

  /* Settings merge: defaults, page block, element attributes.
     Three levels, least specific first: the defaults above, then what the
     caller hands in (the page-wide block, a mount() argument), then the
     element's own attributes. Read again at every measure, so an attribute or
     a class that lands late is simply taken into account. */
  function readSettings(el, overrides, into) {
    var s = into || {};
    for (var key in DEFAULTS) {
      var value = DEFAULTS[key];
      if (overrides && overrides[key] != null && overrides[key] !== '') value = overrides[key];
      var raw = el.getAttribute(dashed(key));
      if (raw !== null && raw.trim() !== '') value = raw.trim();
      if (NUMBERS.indexOf(key) !== -1) {
        var n = Number(value);
        value = isNaN(n) ? DEFAULTS[key] : n;
      } else if (BOOLS.indexOf(key) !== -1) {
        value = falsy(value) ? false : truthy(value) ? true : DEFAULTS[key];
      }
      s[key] = value;
    }
    s.direction = String(s.direction).toLowerCase();
    if (!WAYS.hasOwnProperty(s.direction)) {
      warn('direction', 'direction "' + s.direction + '" is unknown. Accepted: left, right. Using "' +
        DEFAULTS.direction + '".', el);
      s.direction = DEFAULTS.direction;
    }
    s.cruise = Math.max(0, s.cruise);
    s.boost = clamp(s.boost, 0, 20);
    s.maxSpeed = Math.max(1, s.maxSpeed);
    s.ease = clamp(s.ease, 0.005, 1);
    s.skew = clamp(s.skew, 0, 45);
    s.reducedSpeed = Math.max(0, s.reducedSpeed);
    s.way = WAYS[s.direction];
    return s;
  }

  /* ---------- The shared clock ---------- */

  /* Shared clock on the GSAP ticker.
     One reading of the scroll and one pass over the ribbons per frame, on
     GSAP's own ticker: every marquee of the page shares the single animation
     frame the library already schedules, and its lag smoothing keeps a frame
     that arrives after a stall from being counted as travel. */

  var ticking = false;
  var lastTick = 0;
  var guard = 0;
  var raf = 0;
  var own = false;      // the ribbon's own loop, taken over from a dead ticker
  var revivals = 0;
  var pageAt = 0;

  function onTick(time, delta) {
    step(delta / 1000);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    var delta = (now - lastTick) / 1000;
    step(delta);
  }

  function step(dt) {
    lastTick = stamp();
    revivals = 0;
    if (!(dt > 0)) return;
    if (dt > MAX_STEP) dt = MAX_STEP;
    var sy = scrollTop();
    var pageSpeed = (sy - pageAt) / dt;
    pageAt = sy;
    for (var i = live.length - 1; i >= 0; i--) live[i].step(dt, pageSpeed);
  }

  /* Clock watchdog: revives a ticker that went quiet.
     A clock that goes quiet while ribbons are on screen: another script has
     put the library to sleep, emptied its ticker or replaced it (this is what
     Webflow.destroy() does to anything hanging off GSAP). The ribbon asks the
     library once, twice, then runs its own frame loop rather than stopping. */
  function check() {
    if (!ticking || own || document.hidden) return;
    if (stamp() - lastTick < PULSE_GRACE) return;
    revivals++;
    if (revivals < 3 && global.gsap && gsap.ticker) {
      gsap.ticker.remove(onTick);
      gsap.ticker.add(onTick);
      if (gsap.ticker.wake) gsap.ticker.wake();
      lastTick = stamp();
      return;
    }
    own = true;
    if (global.gsap && gsap.ticker) gsap.ticker.remove(onTick);
    lastTick = stamp();
    raf = requestAnimationFrame(loop);
  }

  function pulse(on) {
    if (on === ticking) return;
    ticking = on;
    if (on) {
      pageAt = scrollTop();
      lastTick = stamp();
      revivals = 0;
      if (own) raf = requestAnimationFrame(loop);
      else gsap.ticker.add(onTick);
      guard = setInterval(check, PULSE_CHECK);
      return;
    }
    if (global.gsap && gsap.ticker) gsap.ticker.remove(onTick);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(guard);
    guard = 0;
  }

  function join(item) {
    if (live.indexOf(item) !== -1) return;
    live.push(item);
    if (live.length === 1) pulse(true);
  }

  function leave(item) {
    var at = live.indexOf(item);
    if (at === -1) return;
    live.splice(at, 1);
    if (!live.length) pulse(false);
  }

  /* ---------- Shared observers ---------- */

  function watchers() {
    if (!seer && typeof IntersectionObserver !== 'undefined') {
      // No threshold: a ribbon counts as on screen the moment a pixel of it is.
      seer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var item = e.target.__velocityMarquee;
          if (item) item.onSeen(e.isIntersecting);
        });
      });
    }
    if (!sizer && typeof ResizeObserver !== 'undefined') {
      sizer = new ResizeObserver(function (entries) {
        entries.forEach(function (e) {
          var el = e.target.closest('[' + PREFIX + ']');
          var item = el && el.__velocityMarquee;
          if (item) item.later('resize');
        });
      });
    }
    if (!motion && global.matchMedia) {
      motion = global.matchMedia('(prefers-reduced-motion: reduce)');
      var answer = function () { items.slice().forEach(function (item) { item.later('motion'); }); };
      if (motion.addEventListener) motion.addEventListener('change', answer);
      else if (motion.addListener) motion.addListener(answer);
    }
    if (!fonts && document.fonts && document.fonts.addEventListener) {
      fonts = true;
      document.fonts.addEventListener('loadingdone', function () {
        items.slice().forEach(function (item) { item.later('fonts'); });
      });
    }
  }

  /* ---------- One ribbon ---------- */

  function mount(el, overrides) {
    if (!el || el.nodeType !== 1) return null;
    if (el.__velocityMarquee) return el.__velocityMarquee.api;
    if (!global.gsap) return null;

    var S = readSettings(el, overrides, {});
    var built = null;      // the track, when the markup had none
    var strip = null;
    var track = el.querySelector('[' + TRACK + ']');
    if (track && track.closest('[' + PREFIX + ']') !== el) track = null;

    if (!track) {
      // No marked track: the whole box content becomes the ribbon.
      // No marked track: everything inside the box is the ribbon. The box is
      // never itself the track, since the strip has to move inside it.
      track = document.createElement('div');
      track.setAttribute(TRACK, '');
      while (el.firstChild) track.appendChild(el.firstChild);
      el.appendChild(track);
      built = track;
    }

    strip = document.createElement('div');
    strip.setAttribute(STRIP, '');
    track.parentNode.insertBefore(strip, track);
    strip.appendChild(track);

    var copies = [track];
    var setX = gsap.quickSetter(strip, 'x', 'px');
    var setSkew = gsap.quickSetter(strip, 'skewX', 'deg');

    var x = 0;             // where the strip sits, in px, always within one period
    var speed = 0;         // px/s, signed: negative runs left
    var lean = 0;          // deg
    var period = 0;        // one copy plus whatever space follows it
    var box = 0;           // width of the window the ribbon runs behind
    var still = false;     // reduced motion, and no speed asked for
    var seen = false;
    var paused = false;
    var dead = false;
    var queued = 0;
    var doubt = 0;
    var debugAt = 0;
    var wayNow = S.way;

    var item = {
      el: el,
      step: step1,
      onSeen: onSeen,
      later: later,
    };

    /* ---------- Copies ---------- */

    /* Copy cleanup: no duplicate ids, no keyboard stops.
       A copy carries no id and nothing the keyboard can reach: the same id
       twice is a broken document, and a link reachable three times is a
       broken tab order. The text itself stays text, selectable, and out of
       the accessibility tree. */
    function clean(copy) {
      copy.removeAttribute('id');
      var inside = copy.querySelectorAll('[id]');
      for (var i = 0; i < inside.length; i++) inside[i].removeAttribute('id');
      var reachable = copy.querySelectorAll(FOCUSABLE);
      for (var k = 0; k < reachable.length; k++) reachable[k].setAttribute('tabindex', '-1');
    }

    function ensure(count) {
      while (copies.length > count) {
        var gone = copies.pop();
        if (gone.parentNode) gone.parentNode.removeChild(gone);
      }
      while (copies.length < count) {
        var copy = track.cloneNode(true);
        copy.setAttribute(CLONE, '');
        copy.setAttribute('aria-hidden', 'true');
        clean(copy);
        strip.appendChild(copy);
        copies.push(copy);
      }
    }

    /* ---------- Measuring ---------- */

    /* Period: distance between two copies, read from the page.
       The period is read from the page itself: the distance between the same
       edge of two copies laid out side by side. It is a fraction of a pixel,
       never rounded, and it carries whatever space the stylesheet puts
       between two copies, so the seam holds for any content and any width.

       Rects are used rather than offsetLeft, which browsers round to whole
       pixels: a period off by half a pixel is a seam that shows. Both copies
       sit at the same height inside the same transformed strip, so the
       translation and the lean shift them by exactly the same amount and the
       difference between the two is the layout distance. */
    function measure(why) {
      if (dead) return;
      readSettings(el, overrides, S);
      still = reduced() && !(S.reducedSpeed > 0);
      box = el.getBoundingClientRect().width;

      if (still) {
        ensure(1);
        period = 0;
        x = 0;
        setX(0);
        setSkew(0);
        strip.removeAttribute('style');
        el.setAttribute(STATE, 'still');
        leave(item);
        return;
      }

      ensure(2);
      var a = copies[0].getBoundingClientRect();
      var b = copies[1].getBoundingClientRect();
      period = b.left - a.left;

      if (!(period > 1)) {
        period = 0;
        ensure(1);
        el.setAttribute(STATE, 'still');
        leave(item);
        complain();
        return;
      }

      // Copy count: one more than the window holds.
      // One copy more than the window holds: whatever the offset, the window
      // is covered from edge to edge.
      var need = Math.ceil(box / period) + 1;
      if (need > MAX_COPIES) {
        warn('copies', 'the content would need ' + need + ' copies to fill this box. It is kept ' +
          'to ' + MAX_COPIES + ': put more in the ribbon, or make the items wider.', el);
        need = MAX_COPIES;
      }
      ensure(Math.max(2, need));

      if (copies.length > 2) {
        var gap = parseFloat(getComputedStyle(track).columnGap);
        if (gap > 0 && parseFloat(getComputedStyle(strip).columnGap) < 0.5) {
          warn('gap', 'the track spaces its items with a flex gap, so the seam has none. Give ' +
            'the same length to --velocity-marquee-gap, or move the space onto the items.', el);
        }
      }

      place();
      el.dispatchEvent(new CustomEvent('velocitymarquee:measure', {
        bubbles: true,
        detail: { element: el, period: period, copies: copies.length, width: box, reason: why || 'mount' },
      }));
      if (seen && !paused) join(item);
      state();
    }

    /* Missing stylesheet or empty track warning.
       Two copies that measure nothing mean the copies are stacked, so either
       the stylesheet is missing or the track is empty. Which of the two is
       only worth saying once the page has had time to finish arriving. */
    function complain() {
      if (doubt) return;
      doubt = setTimeout(function () {
        doubt = 0;
        if (dead || period > 1) return;
        if (getComputedStyle(el).getPropertyValue(MARKER).trim() === '') {
          warn('css', 'velocity-marquee.css is not on the page. The ribbon needs it to lay its ' +
            'copies on one line and to clip them.', el);
        } else {
          warn('empty', 'the track has no width, so there is nothing to repeat. Put the ribbon ' +
            'content inside the element marked ' + TRACK + '.', el);
        }
      }, LATE_WARN);
    }

    // Re-measure batching, once per frame.
    // Re-measuring is put off to the next frame: a font, a resize and a class
    // often land together, and each one alone would measure the same page.
    function later(why) {
      if (dead || queued) return;
      queued = requestAnimationFrame(function () {
        queued = 0;
        measure(why);
      });
    }

    /* ---------- Running ---------- */

    function place() {
      // Strip start: one period left of the box.
      // The strip starts one period to the left of the box, so the ribbon can
      // run either way without ever leaving the left edge bare.
      var at = period > 0 ? wrap(x) : 0;
      setX(at);
      setSkew(lean);
    }

    function wrap(value) {
      var at = value % period;
      if (at > 0) at -= period;
      return at;
    }

    function state() {
      el.setAttribute(STATE, still ? 'still' : paused || !seen ? 'paused' : 'running');
    }

    function step1(dt, pageSpeed) {
      var push = S.reverse ? pageSpeed : Math.abs(pageSpeed);
      var target = clamp(S.way * (cruise() + S.boost * push), -S.maxSpeed, S.maxSpeed);

      // Smoothing factor, the same at any frame rate.
      // Frame rate independent smoothing: the same answer to the same scroll
      // at 60 or at 120 images a second.
      var k = 1 - Math.pow(1 - S.ease, dt * 60);
      speed += (target - speed) * k;

      /* Lean: follows the speed the scroll adds.
         The lean follows what the scroll adds, not the speed itself: at cruise
         the ribbon stands upright, and it only leans while the page pulls it
         faster or the other way. */
      var drive = reduced() ? 0 : clamp((speed - S.way * cruise()) / S.maxSpeed, -1, 1);
      lean += (-S.skew * drive - lean) * k;

      x = wrap(x + speed * dt);
      setX(x);
      setSkew(lean);

      var way = speed < -0.5 ? -1 : speed > 0.5 ? 1 : wayNow;
      if (way !== wayNow) {
        wayNow = way;
        el.dispatchEvent(new CustomEvent('velocitymarquee:reverse', {
          bubbles: true,
          detail: { element: el, direction: way < 0 ? 'left' : 'right', speed: speed },
        }));
      }

      if (S.debug) debug();
    }

    function cruise() {
      return reduced() ? S.reducedSpeed : S.cruise;
    }

    function debug() {
      var now = stamp();
      if (now - debugAt < 1000 / DEBUG_RATE) return;
      debugAt = now;
      el.setAttribute(DEBUG + 'speed', speed.toFixed(1));
      el.setAttribute(DEBUG + 'lean', lean.toFixed(2));
      el.setAttribute(DEBUG + 'period', period.toFixed(2));
      el.setAttribute(DEBUG + 'copies', String(copies.length));
      el.setAttribute(DEBUG + 'offset', x.toFixed(2));
    }

    function clearDebug() {
      ['speed', 'lean', 'period', 'copies', 'offset'].forEach(function (key) {
        el.removeAttribute(DEBUG + key);
      });
    }

    function onSeen(now) {
      if (now === seen) return;
      seen = now;
      if (seen && !still && !paused && period > 0) join(item);
      else leave(item);
      state();
      el.dispatchEvent(new CustomEvent('velocitymarquee:' + (seen ? 'enter' : 'leave'), {
        bubbles: true,
        detail: { element: el, speed: speed },
      }));
    }

    /* ---------- The public handle ---------- */

    var api = {
      element: el,
      track: track,
      settings: S,
      speed: function () { return speed; },
      lean: function () { return lean; },
      period: function () { return period; },
      copies: function () { return copies.length; },
      measure: function () { measure('api'); return api; },
      pause: function () {
        paused = true;
        leave(item);
        state();
        return api;
      },
      play: function () {
        paused = false;
        if (seen && !still && period > 0) join(item);
        state();
        return api;
      },
      destroy: function () {
        if (dead) return;
        dead = true;
        leave(item);
        if (queued) cancelAnimationFrame(queued);
        if (doubt) clearTimeout(doubt);
        if (seer) seer.unobserve(el);
        if (sizer) { sizer.unobserve(el); sizer.unobserve(track); }
        ensure(1);
        gsap.set(strip, { clearProps: 'all' });
        strip.parentNode.insertBefore(track, strip);
        strip.parentNode.removeChild(strip);
        if (built) {
          while (built.firstChild) el.insertBefore(built.firstChild, built);
          el.removeChild(built);
        }
        el.removeAttribute(STATE);
        clearDebug();
        if (el.getAttribute('style') === '') el.removeAttribute('style');
        if (el.getAttribute('class') === '') el.removeAttribute('class');
        var at = items.indexOf(item);
        if (at !== -1) items.splice(at, 1);
        delete el.__velocityMarquee;
      },
    };

    item.api = api;
    el.__velocityMarquee = item;
    items.push(item);

    watchers();
    measure('mount');
    if (seer) seer.observe(el);
    else { seen = true; if (!still && period > 0) join(item); state(); }
    if (sizer) { sizer.observe(el); sizer.observe(track); }

    el.dispatchEvent(new CustomEvent('velocitymarquee:ready', {
      bubbles: true,
      detail: { element: el, period: period, copies: copies.length, still: still },
    }));

    return api;
  }

  function destroy(el) {
    if (el && el.__velocityMarquee) el.__velocityMarquee.api.destroy();
  }

  /* Page-wide settings block, read by auto().
     The page-wide settings, if the page declared any, are read here and not
     only by whoever calls mount(): auto() mounts first, and mount() on an
     element that already carries a ribbon hands back the existing one, so
     settings passed afterwards would be dropped in silence. */
  function auto(root) {
    var scope = root || document;
    var page = global.VelocityMarqueeSettings || null;
    if (scope.nodeType === 1 && scope.hasAttribute(PREFIX)) mount(scope, page);
    [].slice.call(scope.querySelectorAll('[' + PREFIX + ']')).forEach(function (el) {
      mount(el, page);
    });
  }

  /* Start: waits for GSAP before the first pass.
     GSAP can land after this file: Webflow injects its own copy, and a script
     tag inserted at runtime loads on its own schedule. So the first pass waits
     for the library instead of assuming it is already there. */
  function whenReady(run) {
    var waited = 0;
    function look() {
      if (global.gsap) return run();
      if (waited >= GSAP_WAIT) {
        // Escaped closing script tag, kept for the Webflow embed.
        // The closing tag below is escaped on purpose. This file is pasted
        // inside a script element in the Webflow embed, and a closing script
        // tag written out plainly, in a string or even in a comment like this
        // one, ends that element there and leaves the rest of the engine to
        // the HTML parser. A backslash before the slash is just a slash in a
        // string, so the message reads exactly the same.
        console.warn('Velocity marquee: GSAP was not found on this page. Add ' +
          '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"><\/script> before this file.');
        return;
      }
      waited += 50;
      setTimeout(look, 50);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look);
    else look();
  }

  global.VelocityMarquee = {
    mount: mount,
    destroy: destroy,
    auto: auto,
    defaults: DEFAULTS,
  };

  whenReady(function () { auto(); });
}(window));
