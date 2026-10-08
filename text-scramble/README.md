# Text scramble

Text shuffles through glyphs and settles back into its words, letter by letter.

![Text scramble](../media/text-scramble.gif)

Text shuffles through glyphs and settles back into its own words, character by character. Symbols, digits, letters, any mix of them, or a string of your own. It plays as the text comes into view on scroll, or when the pointer enters it, and the choice is written on the element itself, as the value of its attribute: data-text-scramble="scroll", "hover", or "scroll hover". The words never move: the native text stays exactly where it is, its scrambled characters are emptied one range at a time, and the glyphs are drawn over them in a layer of no size, each one picked among glyphs about as wide as the letter it covers. So nothing reflows, in a proportional face as in a mono, on one line or ten, at any width; links, bold, italics and coloured spans come back untouched; and a screen reader reads the real text the whole time.

## Files

| File | What it is |
|---|---|
| `text-scramble.js` | The engine, readable, no build step. Its settings are the `DEFAULTS` block at the top |
| `text-scramble.css` | The mechanics the engine needs, then the look of the preview, which is optional |
| `snippet.html` | The markup of the preview, with its attributes |
| `demo.html` | The preview as a page: open it in a browser |
| `demo-hover.html` | The other trigger of the same effect, as a page |
| `images/` | The photographs of the demo, from Unsplash; their origin is in `images/sources.json`. Not under the MIT licence, see `NOTICE.md` |

## Use

```html
<link rel="stylesheet" href="text-scramble.css">
<!-- the markup of snippet.html -->
<script src="text-scramble.js"></script>
```

No dependency. The script mounts every `data-text-scramble` it finds on DOM ready and leaves `window.TextScramble` for the rest.

From a bundler, React or Next.js: `import { mount } from 'movingparts-free/text-scramble'`, see the README at the root.

## Settings

The defaults, as they stand at the top of the engine:

```js
var DEFAULTS = {
  color: 'auto',           // Colour of the scrambled glyphs, or auto.
  chars: 'symbols digits', // sets or characters. Glyphs shuffled through.
  duration: 0.5,           // s. Time one character stays scrambled.
  stagger: 0.03,           // s. Delay between two characters.
  spread: 1.2,             // s. Longest wave, first to last character.
  speed: 30,               // per s. How often a scrambled glyph changes.
  order: 'start',          // order. Which characters settle first.
  delay: 0,                // s. Wait before the effect starts.
  trigger: 0.86,           // share of the viewport. Where scroll starts it.
  replay: false,           // true or false. Scroll plays on every entry.
};
```

The values live in `DEFAULTS`. The attribute is the key in kebab-case after the
component prefix, `data-text-scramble-chars` for `chars`. The trigger is not in
this table on purpose: it is the value of `data-text-scramble` itself.

| Key | What it is | Lower | Higher |
|---|---|---|---|
| `color` | Colour of the glyphs while they are scrambled | Options: any CSS colour, or `auto` to keep the text's own colour | |
| `chars` | The glyphs the text shuffles through | Options: `symbols`, `digits`, `letters`, any of them combined with spaces (`symbols digits`), or any other string, taken as the glyphs themselves (`01`, `/\|_`) | |
| `duration` | How long one character stays scrambled before it settles, in seconds | A flicker, the glyphs barely show | Every character churns for a long time |
| `stagger` | Delay between two characters starting, in seconds | The whole text scrambles at once | A clean wave running across the text |
| `spread` | The longest the wave may take from the first character to the last, in seconds; a long text shrinks its stagger to fit | Long paragraphs rush through | Long paragraphs take their time |
| `speed` | How many times per second a scrambled glyph changes, 1 to 120 | Slow, legible glyph swaps | A fast shimmer, closer to noise |
| `order` | Which characters settle first | Options: `start` (reading order), `end`, `center` (from the middle out), `edges` (from both ends in), `random` | |
| `delay` | Wait before the effect starts, in seconds | Starts the moment it is triggered | Lets another element go first |
| `trigger` | How far into the screen the text has to come before it plays on scroll, as a share of the viewport height | It waits until it has climbed higher up the screen | It plays as soon as it enters at the bottom |
| `replay` | Whether a scroll effect plays again every time the text comes back into view | Options: `false` (once), `true` (every entry) | |

## Choosing the trigger

The trigger is the **value of the attribute that marks the element**, and
nothing else. It is visible and editable where a Webflow user already works:
select the element, Settings panel, Custom attributes.

| Value | What plays |
|---|---|
| `scroll` | The text is transparent until it reaches the trigger line, then scrambles in and settles, once (or on every entry with `replay`) |
| `hover` | The text is untouched until the pointer enters it, it gets keyboard focus, or it is tapped; then it scrambles and settles |
| `scroll hover` | Both: it settles on scroll, then scrambles again on every hover |

An empty or unknown value falls back to `scroll` and logs a console warning
that names the element and the accepted values. `window.TextScrambleSettings`
never carries the trigger, so a page-wide block cannot turn a hover into a
scroll behind the Designer's back.

The two simple demo pages are one trigger each and nothing else: `demo.html` is
scroll only, `hover-variant.html` is hover only. They are what the preview of
the site shows. `complete-demo.html` holds both triggers and the options, in
numbered sections, and opens in a window of its own from the resource page.
`scroll hover` is described here and in the last step of the Webflow tab rather
than shown, so that no page can be read as mixing the two.

## Using it

- **Mark each text element**, not its section: `data-text-scramble="scroll"`
  on a heading, a paragraph, a label, a link, a button. Put it on a container
  and everything inside scrambles as one text, in one wave.
- **Settings go on the same element**, as more attributes:
  `data-text-scramble-chars="digits"`, `data-text-scramble-delay="0.2"`. Three
  levels, least specific first: `DEFAULTS`, then
  `window.TextScrambleSettings = { duration: 0.8 }` declared before the
  engine, then the element's attributes. Settings are read again at every
  start.
- **Inline markup survives**: `<strong>`, `<em>`, links and coloured spans
  inside the text keep their tags, and their glyphs take their font and
  colour. Whitespace is never scrambled.
- **Hover** listens to `pointerenter` and `focusin` on the element: a mouse, a
  pen, a finger (one play per tap) and the keyboard all start it. A hover that
  arrives while the effect runs is ignored, so a jittery pointer never
  restarts it and it always ends on the original text.
- **Scroll** plays once the element crosses `trigger`. A block too close to the
  end of the page to reach that line plays once the page is scrolled as far
  as it goes, and on a page too short to scroll, at once.
  An element already past that line when the page loads plays at once.
- **From JavaScript**: `TextScramble.mount(el, overrides)` returns
  `{ element, settings, modes, play(), destroy() }`; `overrides.mode`
  (`'hover'`) is used only when the element's own value names no trigger.
  `TextScramble.play(el)`, `TextScramble.destroy(el)`, `TextScramble.auto(root)`,
  `TextScramble.defaults` and `TextScramble.sets` complete it. Each play emits
  `textscramble:start` and `textscramble:done`, both bubbling, with
  `{ element, trigger, modes }` as `detail`; `trigger` is `scroll`, `hover`,
  `focus`, `api`, or `safety` when the safety net showed the text.
- **Under `prefers-reduced-motion: reduce`** nothing is scrambled and nothing
  is ever hidden. The events still fire, back to back, when the element is
  reached or hovered.
- The words of the markup are the preview's, and they ship as they are:
  pasted, the page reads the way the preview did. Put the user's own
  content in their place whenever they want, in the page's language.
- **On Webflow, add the fonts first.** Add Geist and Geist Mono to your
  site's fonts (Site settings, Fonts, Google Fonts) before pasting: the paste
  names them, and the Designer drops a font the site does not have.

## Pitfalls when integrating

- **The stylesheet matters.** Without `text-scramble.css`, text waiting for the
  scroll is not hidden (it shows, then plays), and the effect empties the text
  inline while it runs, then gives the `style` attribute back as it found it.
- **Settings handed to `mount()` after the page loaded are dropped**: `auto()`
  mounts on DOM ready, and a second `mount()` returns the first instance. Use
  `window.TextScrambleSettings`, or the attributes.
- **Do not hide waiting text yourself** with `visibility` or `opacity`. The
  script makes it transparent, which keeps the words for screen readers and
  text search, and the safety net can only show what it hid.
- **Text painted with `-webkit-text-fill-color` or `background-clip: text`**
  (gradient text) fights the mechanism, which empties glyphs the same way.
- **An ancestor with `overflow: hidden` that is not positioned does not clip
  the glyphs**: the layer is absolutely positioned, so an ellipsis or a mask
  lets the scrambled glyphs of the hidden part show for the length of the
  effect. Give the clipping ancestor `position: relative`.
- **`text-shadow` on the text disappears while its characters are
  scrambled**, and the glyphs carry none.
- **In Webflow, the trigger is read and changed in the Settings panel.** The
  paste carries both examples at once, a section named **"Scramble text (on
  scroll)"** in the Navigator and a row of links named **"Scramble text (on
  hover)"**, and every marked element carries `data-text-scramble` as a custom
  attribute, so its value is on screen where a Designer user already works.
  Changing the trigger is changing that value, on the element, and nothing
  else: no class, no page setting and no code. Each of the two examples can be
  deleted once the attribute is on the user's own text; only the Embed has to
  stay on the page.
- **A pointer state never survives the paste** (AB-41), and this component
  needs none: what answers the pointer is the effect itself, which lives in
  the engine that travels inside the Embed. Do not move it to a Webflow class
  variant, and do not count on one for a hover colour either.

## The other formats

This folder is the code route. The same component exists as a Webflow paste (structure, classes and one Embed, ready for the Designer) and as a prompt for an AI assistant, on its page: [movingparts.supply/components/text-scramble/](https://movingparts.supply/components/text-scramble/?from=github).
