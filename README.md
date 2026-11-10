# tune-panel

A dev-time panel for tuning feel values (springs, easing, tilt, shader numbers) live, themed per brand.
It never ships: wire it, tune, press **Copy values**, paste the JSON in chat, bake the numbers into code, remove it.

One web component in a shadow DOM, so the page's styles can't break it and it can't break the page. No build,
no dependencies. It sits full height on the right and the page narrows beside it, and it collapses to a rail.

## Use it

Plain HTML page (pin the version; never an unpinned URL):

```html
<script type="module">
import { tune } from "https://cdn.jsdelivr.net/gh/itsHendri/tune-panel@0.1.1/tune-panel.js";

const CFG = { max: 12, spring: { stiffness: 420, damping: 20, mass: 1 }, push: true };   // what the page reads

tune(CFG, { max: { min: 0, max: 20, step: 0.5, unit: "°" } }, { title: "Hover tilt", theme: "hendri", fps: true });
</script>
```

Vite or React app:

```bash
npm i -D github:itsHendri/tune-panel#0.1.1
```

```js
import { tune } from "tune-panel";

useEffect(() => {
  const panel = tune(cfgRef.current, schema, { title: "Card tilt", onChange: () => setTick((n) => n + 1) });
  return () => panel.destroy();
}, []);
```

The panel mutates `CFG` in place, so a render loop that reads `CFG` needs no glue. For React, read the ref in
the animation loop, or re-render from `onChange`.

## Declaring controls

`tune(cfg, schema, options)`. Values and defaults live in `cfg`; the schema only adds ranges and types, and
anything it leaves out is inferred from the value (a number, a boolean, a hex string, a `{ stiffness, damping }`
spring, a nested object as a section).

| Schema entry | Control | Value in `cfg` |
|---|---|---|
| `[min, max, step?]` | number: fill bar plus field | number |
| `{ min, max, step, unit, label, hint }` | number with more detail | number |
| `[default, min, max, step?]` | DialKit's form also reads (the `cfg` value wins) | number |
| `"spring"` or `{ type: "spring", stiffness: [60, 800, 10], damping: [...], mass: [...] }` | spring with a curve preview | `{ stiffness, damping, mass? }` |
| `"easing"` | cubic-bezier editor with presets | `[x1, y1, x2, y2]` |
| `{ type: "select", options: ["x", "y", "both"] }` | segmented (3 short options) or a menu | one of the options |
| `"color"` | hex field plus picker | `"#rrggbb"` |
| `{ _label, _collapsed, ...children }` for a nested object | a section | an object |
| `{ ...keys }` under a key that isn't in `cfg` | a section grouping keys at the same level | |
| `() => replay()` or `{ type: "action", label, run }` | a button | |
| `{ type: "readout", get: () => value }` | a live value, read ten times a second | |
| `false` | hide that key | |

## Options

`title`, `theme` (`"neutral"`, `"hendri"`, `"fontsake"`, or an object shaped like `themes/neutral.js`),
`scheme` (`"auto"`, `"light"`, `"dark"`), `fps` (an FPS graph), `snapshots` (A/B, on by default),
`width` (340), `collapsed`, `onChange({ path, value, values })`.

The element `tune()` returns has `values`, `set(path, value)`, `refresh()` (after the page changed `cfg` itself),
`reset()`, `copy()`, `paste(json)` and `destroy()`, and fires `change` and `reset` events.

## Keys and pointer

* Press anywhere on a bar and the handle jumps under your pointer and stays there while you drag; a bubble shows the
  value. Shift slows the drag to a tenth from where it is, Alt snaps to ten steps. A faint line shows where a click lands.
* With a bar focused: arrows step, Page Up and Down step coarse, Home and End go to the ends, Enter types a value,
  Delete resets it.
* A changed value shows a bar on its left edge, "edited" after its label and a reset button; a tick marks the default.
* Copy values copies `cfg` as JSON. Where the browser refuses the clipboard (embedded browsers), it falls back to a
  hidden textarea, then shows the JSON selected in the panel.
* Paste values takes the JSON back: out-of-range numbers are clamped, wrong types and unknown keys are reported.
* A and B: tune one version, switch, tune another, flip between them. Copy takes the one showing.

## Themes

`themes/<brand slug>.js`, mapped by hand from `brands/<slug>/identity/tokens.json`. To add a brand, copy
`neutral.js`, fill its keys, and add one line to `themes/index.js`. A page can also override any variable itself:
`tune-panel { --tune-accent: hotpink }`. Variables: `--tune-bg`, `--tune-surface`, `--tune-field`, `--tune-fill`,
`--tune-text`, `--tune-muted`, `--tune-line`, `--tune-accent`, `--tune-on-accent`, `--tune-focus`, `--tune-font`,
`--tune-mono`, `--tune-radius`, `--tune-radius-sm`, `--tune-gap`, `--tune-row`.

A shadow root can't load fonts, so the page loads the brand's fonts; the theme only names them.

## Notes

* One panel per page; a second `tune()` replaces the first. Nest objects in one config for more sections.
* The page is pushed with a right margin on `<html>`. The page's own `position: fixed` elements at `right: 0`, and
  anything sized `100vw`, still reach under the panel.
* Width, collapsed state and closed sections are remembered per page in localStorage. Values are not: a reload
  starts from the code, which is what gets baked.
* An agent driving the page can read the values without the clipboard:
  `document.querySelector("tune-panel").values`.

## Removing it

Delete the import and the `tune(...)` call (and `npm uninstall tune-panel`). Then prove it's gone:

```bash
grep -rn "tune-panel" --exclude-dir=node_modules . ; grep -n "tune-panel" package.json package-lock.json pnpm-lock.yaml 2>/dev/null
```

## Develop

`npm test` runs the maths tests. `demo/index.html` exercises every control; serve the folder (for example
`python3 -m http.server`) and open `/demo/`, with `?theme=hendri&scheme=dark` to try a theme. `explorations/looks.html`
is the first round of looks; Fill bars (2) was picked on 2026-11-10.

The spring, cubic-bezier and step maths are ported from the Halftone Controls kit's headless core, written in the
same studio.
