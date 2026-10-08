# Velocity marquee

A ribbon that runs on its own, and speeds up or turns back with the scroll.

![Velocity marquee](../media/velocity-marquee.gif)

A ribbon of content runs on without end, and the page scroll drives it: it cruises on its own when nothing is happening, gains speed as the reader scrolls down, runs back the other way when the reader scrolls up, and leans a little while it is being pulled, standing upright again the moment it settles. The repeat is seamless at any window width and with any content: the row is written once, the engine repeats it as many times as the width needs, reads the distance between two copies from the page itself and wraps a single transform on that distance, so there is no jump at the join and no drift after any number of turns. It is real text the whole time, selectable and searchable, read once by a screen reader and once only, and nothing runs at all while the ribbon is off screen or when the reader asks for reduced motion.

## Files

| File | What it is |
|---|---|
| `velocity-marquee.js` | The engine, readable, no build step. Its settings are the `DEFAULTS` block at the top |
| `velocity-marquee.css` | The mechanics the engine needs, then the look of the preview, which is optional |
| `snippet.html` | The markup of the preview, with its attributes |
| `demo.html` | The preview as a page: open it in a browser |

## Use

```html
<link rel="stylesheet" href="velocity-marquee.css">
<!-- the markup of snippet.html -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="velocity-marquee.js"></script>
```

The engine needs GSAP 3 on the page, loaded before it. GSAP is not in this repository: it is loaded from its CDN, under [its own licence](https://gsap.com/standard-license). The script mounts every `data-velocity-marquee` it finds on DOM ready and leaves `window.VelocityMarquee` for the rest.

From a bundler, React or Next.js: `import { mount } from 'movingparts-free/velocity-marquee'`, see the README at the root.

## Settings

The defaults, as they stand at the top of the engine:

```js
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
```

The values live in `DEFAULTS`. The attribute is the key in kebab-case after the
component prefix, `data-velocity-marquee-max-speed` for `maxSpeed`, and it goes
on the same box as `data-velocity-marquee`.

| Key | What it is | Lower | Higher |
|---|---|---|---|
| `cruise` | How fast the ribbon runs on its own, in pixels a second, when the page is not moving | Nearly still between two scrolls | Runs on briskly with no help |
| `direction` | Which way the ribbon runs when nothing is happening | Options: `left`, `right` | |
| `boost` | How much of the scroll speed is handed to the ribbon, as a factor | The scroll barely shows in the ribbon | A flick of the wheel throws the ribbon across |
| `maxSpeed` | The ceiling, in pixels a second, whatever the scroll does | A calm ribbon that refuses to race | A ribbon that can turn into a blur |
| `ease` | How quickly the ribbon takes up a new speed, 0 to 1 | Long, heavy, keeps running after the scroll stops | Snappy, glued to the scroll, close to nervous |
| `skew` | The strongest lean, in degrees, reached at top speed | Upright at any speed | A pronounced slant, watch the legibility |
| `reverse` | Whether scrolling up sends the ribbon back the other way | Options: `false` (the page only ever pushes it forward), `true` | |
| `reducedSpeed` | The speed kept when the reader asks for reduced motion, in pixels a second | Options: `0` stands the ribbon still and makes no copy, any speed keeps it crawling with no lean | |
| `debug` | Whether the ribbon writes its live state in `data-velocity-marquee-debug-*` attributes | Options: `false`, `true` (speed, lean, period, copies and offset, six times a second) | |

## Using it

- **Mark the box, not the section**: `data-velocity-marquee` goes on the
  ribbon itself, the box with the height, the rules and the type. A page can
  hold as many as it likes and they stay independent, each with its own speed
  and its own offset.
- **Write the content once**, in the row marked `data-velocity-marquee-track`.
  Anything goes inside: words, links, images, badges, an icon between two
  items. The engine copies that row as many times as the width needs, and
  counts again when the width, the font or the content changes.
- **Settings go on the box**, as more attributes:
  `data-velocity-marquee-direction="right"`,
  `data-velocity-marquee-skew="12"`. Three levels, least specific first:
  `DEFAULTS`, then `window.VelocityMarqueeSettings = { cruise: 90 }` declared
  before the engine, then the box's own attributes.
- **From JavaScript**: `VelocityMarquee.mount(el, overrides)` returns
  `{ element, track, settings, speed(), lean(), period(), copies(), measure(),
  play(), pause(), destroy() }`, and hands back the existing handle for a box
  already mounted. `VelocityMarquee.destroy(el)`, `VelocityMarquee.auto(root)`
  and `VelocityMarquee.defaults` complete it. Events, all bubbling, with
  `element` in the `detail`: `velocitymarquee:ready`
  (`period`, `copies`, `still`), `velocitymarquee:measure` (`period`,
  `copies`, `width`, `reason`), `velocitymarquee:enter` and
  `velocitymarquee:leave` (`speed`), and `velocitymarquee:reverse`
  (`direction`, `speed`) each time the ribbon turns round.
- **It costs nothing off screen.** An `IntersectionObserver` takes a ribbon
  out of the frame loop the moment it leaves the window, and the loop itself
  stops when the last one leaves. Measured: 144 writes on the strip in 1.2 s
  on screen, 0 off screen.
- **Under `prefers-reduced-motion: reduce`** the ribbon stands still, makes no
  copy at all and leaves the page exactly as the stylesheet laid it out, with
  no transform of any kind. Set `data-velocity-marquee-reduced-speed` to keep
  it crawling instead; there is no lean on that path whatever `skew` says. The
  media query is listened to, so turning the setting on or off answers without
  a reload.
- **Touch**: a finger scrolling the page drives the ribbon exactly like a
  wheel, since both move the page. Nothing answers the pointer itself, so a
  link inside the ribbon stays a link.
- The words of the markup are the preview's, and they ship as they are:
  pasted, the page reads the way the preview did. Put the user's own
  content in their place whenever they want, in the page's language.
- **On Webflow, add the fonts first.** Add Geist and Geist Mono to your
  site's fonts (Site settings, Fonts, Google Fonts) before pasting: the paste
  names them, and the Designer drops a font the site does not have.

## Pitfalls when integrating

- **The stylesheet matters.** Without `velocity-marquee.css` the copies stack
  instead of lining up, the engine measures nothing, leaves the ribbon still
  and says so in the console after a second and a half, which is long enough
  for a sheet that is merely late to arrive.
- **A ribbon in a grid or a flex row needs the box to be given a width by its
  parent.** The stylesheet asks for that with `contain: inline-size`: the
  strip inside is as wide as every copy laid end to end, and without
  containment an `auto` grid column would take that width, which is thousands
  of pixels, and then ask for more copies still. A grid that holds a ribbon
  also wants `minmax(0, 1fr)` rather than the default `auto`.
- **No width is set on the box by the component.** A full bleed ribbon made of
  negative margins keeps working. A ribbon that must be exactly as wide as
  something else gets its width from your own class.
- **The space between two items belongs to the items.** `padding` or `margin`
  on each item repeats with the copies, so the rhythm holds at the join. A
  flex `gap` on the row does not: there is no gap between the last item of one
  copy and the first of the next. Either move the space onto the items, or
  give `--velocity-marquee-gap` the same length; the engine warns once when it
  sees a gap it cannot follow.
- **The ribbon needs something to clip it.** The box is `overflow: hidden` in
  the component CSS. An ancestor with `overflow: visible` and a fixed height
  is not enough on its own.
- **Do not put `data-velocity-marquee` on a section that also holds your
  headings.** The whole content of the box becomes the ribbon when no track is
  marked. Mark the row.
- **Two ribbons on one page are independent**, and share a single frame loop
  and a single reading of the scroll, so a second one costs almost nothing.
- **An `id` inside the ribbon travels no further than the original row**:
  copies have their ids stripped and their focusable elements taken out of the
  tab order, because a document with the same id three times is broken. Do not
  count on a copy being reachable.
- **A pointer state never survives the paste** (AB-41): a hover colour on a
  link inside the ribbon lives in the CSS of the component or in your own
  class, never in a Webflow class variant.

## The other formats

This folder is the code route. The same component exists as a Webflow paste (structure, classes and one Embed, ready for the Designer) and as a prompt for an AI assistant, on its page: [movingparts.supply/components/velocity-marquee/](https://movingparts.supply/components/velocity-marquee/?from=github).
