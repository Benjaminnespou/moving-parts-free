# Button 01

The button leans toward the pointer, then settles back with a soft elastic return.

![Button 01](../media/button-01.gif)

A button that leans toward the pointer before the pointer reaches it, the label a little further than its plate, and settles back with a soft elastic return. Played with GSAP on the button the page already has: the engine sets no font, size, border or background, and puts the label back exactly on destroy. Keyboard focus and reduced motion are handled, and a finger is left alone. Button 01 of the Button set: another button of the set pasted on the same page shares its base.

## Files

| File | What it is |
|---|---|
| `button-01.js` | The engine, readable, no build step. Its settings are the `DEFAULTS` block at the top |
| `button-01.css` | The mechanics the engine needs, then the look of the preview, which is optional |
| `snippet.html` | The markup of the preview, with its attributes |
| `demo.html` | The preview as a page: open it in a browser |

## Use

```html
<link rel="stylesheet" href="button-01.css">
<!-- the markup of snippet.html -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="button-01.js"></script>
```

The engine needs GSAP 3 on the page, loaded before it. GSAP is not in this repository: it is loaded from its CDN, under [its own licence](https://gsap.com/standard-license). The script mounts every `data-button-motion` it finds on DOM ready and leaves `window.ButtonMotion` for the rest.

From a bundler, React or Next.js: `import { mount } from 'movingparts-free/button-01'`, see the README at the root.

## Settings

The defaults, as they stand at the top of the engine:

```js
var DEFAULTS = {
  duration: 0.6, // s. Base length, the return takes 1.8 times it.
  pull: 0.1,     // share of the offset. How far the button follows the pointer.
  reach: 0.4,    // share of the button height. Where the pull begins around it.
  press: 0.96,   // scale. Size of the button while pressed, 1 for none.
};
```

The values live in `DEFAULTS`. The attribute is the key in kebab-case after the
component prefix, `data-button-motion-pull` for `pull`. The animation is not in
this table on purpose: it is the value of `data-button-motion` itself.

| Key | What it is | Lower | Higher |
|---|---|---|---|
| `duration` | The base length of the return, in seconds: once the pointer is out of reach the button settles back over 1.8 times this, with a soft elastic ease. The pull itself follows the pointer at its own pace | A quick snap back into place | A slow, loose settle |
| `pull` | How far the button follows the pointer, as a share of the distance between the button's centre and the pointer | The button barely moves, a nod | The button sits under the pointer, at 1 it is dragged |
| `reach` | Where the pull begins, as a share of the button's height around its box | The pull starts only once the pointer is almost on it | The pull starts from far away, which feels sticky between two close buttons |
| `press` | The scale of the button while it is pressed | A deep press, the button shrinks visibly under the click | Barely a press, and `1` turns it off |

## Using it

- **Mark the button**: `data-button-motion="magnetic"` on the `<button>` or
  the `<a>` that is the button. Its content becomes the label: the engine moves
  the nodes into one span at mount and puts them back at destroy.
- **Settings go on the same element**, as more attributes:
  `data-button-motion-pull="0.3"`. Three levels, least specific
  first: `DEFAULTS`, then `window.ButtonMotionSettings = { pull: 0.3 }`
  declared before the engine, then the element's own attributes.
- **The preview ships whole.** `snippet.html` with the last part of
  `button-01.css`, after the line `look, left out of the Webflow Embed`, is the
  preview: the same button, row and words, in Geist and Geist Mono, loaded
  by the font tag of the Code tab. Those `button-set-*` classes are never
  read by the engine. On a button of your own, keep your class and add the
  attribute; that last part of the file can then go.
- **On Webflow, add the fonts first.** Add Geist and Geist Mono to your
  site's fonts (Site settings, Fonts, Google Fonts) before pasting: the
  paste names them, and the Designer drops a font the site does not have.
- **Other buttons of the set on the same page.** Every button of the set
  ships the same base. Paste another button's Embed, or load its two files,
  in any order: the file that loads first builds the base, and each one after
  it only adds its animation. The base rules its stylesheet repeats are the
  same rules. Each animation reads the `DEFAULTS` of its own file and the
  settings block of its own Embed, the `window.ButtonMotionSettings` that
  stood when its file loaded.
- **A value whose file is not on the page** waits for it: with this file
  alone, a button marked `data-button-motion="roll"` stays the page's plain
  button, and the console says so after ten seconds. An empty or unknown
  value plays `fill` when fill's file is on the page, and the first
  animation on the page otherwise, `magnetic` with this file alone, with a
  warning that names the element.
- **A finger** gets nothing: `magnetic` follows a pointer, and a touch
  pointer only exists for the length of a tap.
- **The keyboard**: a focus the browser would show a ring for enters the
  button from its centre, where the pull is nothing, so the keyboard shows
  the focus ring of the page and no movement. Enter and Space press it like
  a click does.
- **From JavaScript**: `ButtonMotion.mount(el, overrides)` returns
  `{ element, settings, mode, enter(), leave(), refresh(), destroy() }`, or
  `null` for a button whose animation's file is not on the page.
  `enter()` and `leave()` play from the centre. `refresh()` reads the
  attributes again and, if the value of `data-button-motion` changed to an
  animation on the page, rebuilds the button for it. `destroy()` puts the
  content back exactly as it was. `ButtonMotion.destroy(el)`,
  `ButtonMotion.refresh(el)`, `ButtonMotion.auto(root)`,
  `ButtonMotion.defaults` (the `DEFAULTS` of the first file of the set on
  the page) and `ButtonMotion.modes` (the animations on the page) complete
  it. `ButtonMotion.register(pack)` is how a file of the set hands its
  animation to the base; the files call it themselves.
- **Events**, all bubbling, with `{ element, mode }` in `detail`:
  `buttonmotion:ready` once GSAP is there and the button is built (plus
  `reduced`), `buttonmotion:enter` and `buttonmotion:leave` around every hover
  (plus `via`: `pointer`, `touch`, `keyboard` or `api`).
- **The state** is on the element as `data-button-motion-state`, `idle` or
  `hover`, for a rule of the page that wants to follow it.
- **Under `prefers-reduced-motion: reduce`** `magnetic`, which is movement
  and nothing else, does nothing at all, and the press is skipped.
- The words of the demo are the demo's: the preview ships with them, and on
  a real page every label is the user's own, in the page's language, or
  asked for.

## Pitfalls when integrating

- **The button needs a box.** A bare `<a>` is inline and cannot be
  transformed; the sheet makes it `inline-block` at zero specificity, and a
  class of yours that sets `display` wins. `flex` and `inline-flex` are fine.
  `position: static` set by a class of yours would let the layers escape: the
  engine's layers are absolute inside the button.
- **Two magnetic buttons close together** share the same pointer: with a
  large `reach` both pull at once. Keep `reach` under 1 in a row of buttons.
- **A page that never gets GSAP shows a plain button**, styled by its class,
  and the engine says so in the console after ten seconds. Nothing is built
  before GSAP is there, so the label is not even wrapped.
- **The stylesheet places the layers.** Without `button-01.css` the layers of the
  animation have no place and no colour, and the engine says so in the
  console.
- **Two copies of the set's base on one page are one.** The file that loads
  first builds the base and the others use it, so the button of a newer
  version of the bank pasted beside an older one runs on the older base. The
  first file to bring an animation keeps it, too: the whole set's file and
  this one on the same page play `magnetic` with the settings of the one
  that loaded first.
- **Webflow turns a `<button>` with children into a Link block**: the engine
  reads the attribute, never the tag, so an `<a>` with the attribute is a
  button to it.

## The other formats

This folder is the code route. The same component exists as a Webflow paste (structure, classes and one Embed, ready for the Designer) and as a prompt for an AI assistant, on its page: [movingparts.supply/components/button-01/](https://movingparts.supply/components/button-01/?from=github).
