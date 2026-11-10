/**
 * tune-panel: a dev-time panel for tuning feel values (springs, easing, tilt, shader numbers).
 * It never ships. Wire it, tune, press "Copy values", paste the JSON in chat, bake, remove it.
 *
 *   import { tune } from ".../tune-panel.js";
 *   const CFG = { max: 12, spring: { stiffness: 420, damping: 20, mass: 1 }, push: true };
 *   tune(CFG, { max: [0, 20, 0.5] }, { title: "Hover tilt", theme: "hendri" });
 *
 * The panel mutates CFG in place, so a render loop that reads CFG picks changes up with no glue.
 * Anything the second argument leaves out is inferred from CFG's values.
 *
 * The maths (step inference, scrub steps, spring and cubic-bezier) is ported from the Halftone
 * Controls kit's headless core (lib/controls), written in the same studio.
 */
import THEMES from "./themes/index.js";

export const VERSION = "0.1.2";
const TAG = "tune-panel";
const MIN_W = 280;
const MAX_W = 520;
const RAIL_W = 44;

/* ================================================================== maths */

/** Decimal places in a number as written: 0.25 → 2, 1e-3 → 3, 10 → 0. */
export function decimalsOf(n) {
  if (!Number.isFinite(n)) return 0;
  const [mantissa, exp] = String(n).toLowerCase().split("e");
  return Math.max(0, (mantissa.split(".")[1] ?? "").length - Number(exp ?? 0));
}
export const clamp = (n, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, n));
/** Rounds away float noise to the places a step of `step` can produce. */
export const roundTo = (n, step) => Number(n.toFixed(Math.min(10, decimalsOf(step))));

/** `blurRadius`, `blur_radius`, `blur-radius` → "Blur radius". */
export function labelOf(key) {
  const w = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** A range for a bare number: 0 to 1 for a fraction, otherwise out to twice its size. */
export function inferRange(n) {
  if (n >= 0 && n <= 1) return { min: 0, max: 1 };
  const span = Math.max(Math.abs(n) * 2, 10);
  return n < 0 ? { min: -span, max: span } : { min: 0, max: span };
}

/** About a hundred stops across the range, rounded to 1, 2 or 5 × a power of ten. */
export function inferStep(min, max, ...values) {
  const places = Math.max(0, ...[min, max, ...values].map(decimalsOf));
  const raw = Math.abs(max - min) / 100 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  return Math.min(nice, places ? 10 ** -places : nice);
}

/** Shift is fine (a tenth of a step), Alt is coarse (ten steps). */
export const modifierOf = (e) => (e.shiftKey ? "fine" : e.altKey ? "coarse" : "normal");
const SCALE = { fine: 0.1, normal: 1, coarse: 10 };

/** A value snapped to the grid a modifier works on, and clamped. */
export function snap(v, { min, max, step }, mod = "normal") {
  const s = step * SCALE[mod];
  const snapped = min + Math.round((v - min) / s) * s;
  return clamp(roundTo(snapped, step * SCALE.fine), min, max);
}

/** What a key does to a number, or null when it isn't ours. */
export function keyAction(key, value, mod, range) {
  const by = (dir, m) => snap(value + dir * range.step * SCALE[m], range, m === "coarse" ? "normal" : m);
  switch (key) {
    case "ArrowUp": case "ArrowRight": return by(1, mod);
    case "ArrowDown": case "ArrowLeft": return by(-1, mod);
    case "PageUp": return by(1, "coarse");
    case "PageDown": return by(-1, "coarse");
    case "Home": return range.min;
    case "End": return range.max;
    default: return null;
  }
}

/** Where a spring released from 0 is after `t` seconds, heading for 1 (exact, every damping regime). */
export function springAt({ stiffness, damping, mass = 1 }, t) {
  if (t <= 0) return 0;
  const m = Math.max(mass, 0.001);
  const k = Math.max(stiffness, 1e-9);
  const w0 = Math.sqrt(k / m);
  const zeta = damping / (2 * Math.sqrt(k * m));
  if (zeta < 1 - 1e-9) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta <= 1 + 1e-9) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** Seconds until the spring stays within `restDelta` of 1 (capped at `max` for one that never rests). */
export function settleTime(spring, restDelta = 0.001, max = 10) {
  const dt = 1 / 240;
  let last = 0;
  for (let t = 0; t <= max; t += dt) if (Math.abs(springAt(spring, t) - 1) > restDelta) last = t;
  return Math.min(max, last + dt);
}

export const SPRING_RANGES = {
  stiffness: [1, 1000, 1],
  damping: [0, 100, 0.5],
  mass: [0.1, 10, 0.1],
};

export const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  standard: [0.2, 0, 0, 1],
  emphasized: [0.3, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
};

/** `cubic-bezier(0.2, 0, 0, 1)`, `0.2, 0, 0, 1`, `[0.2, 0, 0, 1]` or a preset name. Null otherwise (x must be 0 to 1). */
export function parseBezier(input) {
  if (Array.isArray(input)) {
    if (input.length !== 4 || !input.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return input[0] < 0 || input[0] > 1 || input[2] < 0 || input[2] > 1 ? null : input.map((n) => roundTo(n, 0.001));
  }
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase();
  if (text in EASING_PRESETS) return EASING_PRESETS[text].slice();
  const inner = /^cubic-bezier\((.*)\)$/.exec(text)?.[1] ?? text.replace(/^\[|\]$/g, "");
  const parts = inner.split(/[\s,]+/).filter(Boolean).map(Number);
  return parts.length === 4 ? parseBezier(parts) : null;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const hex6 = (c) => (c.length === 4 ? "#" + [...c.slice(1)].map((ch) => ch + ch).join("") : c).toLowerCase();

/* ================================================================== schema */

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const isSpring = (v) => isPlain(v) && typeof v.stiffness === "number" && typeof v.damping === "number";
const clone = (v) => (Array.isArray(v) ? v.slice() : isPlain(v) ? { ...v } : v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const join = (parent, key) => (parent ? `${parent}.${key}` : String(key));

/**
 * A range written as an array. [min, max, step?] is the bind form; a first number that isn't below the
 * second reads as DialKit's [default, min, max, step?], whose default the object's own value overrides.
 */
function rangeOf(arr) {
  if (arr.length >= 3 && arr[0] >= arr[1]) return { min: arr[1], max: arr[2], step: arr[3] };
  return { min: arr[0], max: arr[1], step: arr[2] };
}

function numberNode(base, value, spec) {
  let r = {};
  if (Array.isArray(spec)) r = rangeOf(spec);
  else if (isPlain(spec)) r = { min: spec.min, max: spec.max, step: spec.step };
  const inferred = inferRange(value);
  const min = r.min ?? Math.min(inferred.min, value);
  const max = r.max ?? Math.max(inferred.max, value);
  return {
    ...base, kind: "number", min, max,
    step: r.step ?? inferStep(min, max, value),
    unit: (isPlain(spec) && spec.unit) || "",
  };
}

/** One control for `obj[key]`, or null when the value isn't something the panel can edit. */
function control(obj, key, spec, path) {
  const value = obj[key];
  const type = typeof spec === "string" ? spec : isPlain(spec) ? spec.type : undefined;
  const base = {
    key, path, obj,
    label: (isPlain(spec) && spec.label) || labelOf(key),
    hint: isPlain(spec) ? spec.hint : undefined,
    def: clone(value),
  };
  if (type === "spring" || (!type && isSpring(value))) {
    if (!isSpring(value)) return warn(`"${path}" needs { stiffness, damping, mass? } for a spring.`);
    const fields = ["stiffness", "damping", ...("mass" in value ? ["mass"] : [])];
    const node = { ...base, kind: "spring", children: [] };
    node.children = fields.map((f) => {
      const r = isPlain(spec) && Array.isArray(spec[f]) ? spec[f] : SPRING_RANGES[f];
      const child = numberNode({ key: f, path: join(path, f), obj: value, label: labelOf(f), def: value[f] }, value[f], r);
      child.owner = node;
      return child;
    });
    return node;
  }
  if (type === "easing") {
    if (!parseBezier(value)) return warn(`"${path}" needs a [x1, y1, x2, y2] array for an easing.`);
    return { ...base, kind: "easing" };
  }
  if (type === "select") {
    const options = (spec.options ?? []).map((o) => (isPlain(o) ? o : { value: o, label: labelOf(o) }));
    if (!options.length) return warn(`"${path}" has no options.`);
    const short = options.length <= 3 && options.every((o) => String(o.label).length <= 8);
    return { ...base, kind: "select", options, display: spec.display ?? (short ? "segmented" : "menu") };
  }
  if (type === "color" || type === "colour" || (!type && typeof value === "string" && HEX.test(value))) {
    if (!HEX.test(value)) return warn(`"${path}" needs a hex colour.`);
    return { ...base, kind: "colour" };
  }
  if (typeof value === "boolean") return { ...base, kind: "toggle" };
  if (typeof value === "number") return numberNode(base, value, spec);
  if (isPlain(value)) {
    return {
      ...base, kind: "section",
      collapsed: isPlain(spec) && !!spec._collapsed,
      label: (isPlain(spec) && spec._label) || base.label,
      children: build(value, isPlain(spec) ? spec : {}, path),
    };
  }
  return null; // functions, other strings, arrays without a type: left alone
}

function warn(msg) {
  console.warn(`tune-panel: ${msg}`);
  return null;
}

/**
 * The schema's entries in its order, then whatever else `obj` holds (inferred). A schema key that isn't in
 * `obj` and holds a plain object is a visual group of keys at the same level; a function is an action button.
 */
function build(obj, schema, parent, used = new Set(), rest = true) {
  const nodes = [];
  for (const [key, spec] of Object.entries(schema ?? {})) {
    if (key.startsWith("_")) continue;
    const path = join(parent, key);
    if (spec === false) { used.add(key); continue; }
    if (typeof spec === "function") { nodes.push({ kind: "action", key, path, label: labelOf(key), run: spec }); continue; }
    if (isPlain(spec) && spec.type === "action") { nodes.push({ kind: "action", key, path, label: spec.label ?? labelOf(key), run: spec.run }); continue; }
    if (isPlain(spec) && spec.type === "readout") { nodes.push({ kind: "readout", key, path, label: spec.label ?? labelOf(key), get: spec.get }); continue; }
    if (key in obj) {
      used.add(key);
      const n = control(obj, key, spec, path);
      if (n) nodes.push(n);
      continue;
    }
    if (isPlain(spec) && !spec.type) {
      nodes.push({
        kind: "section", key, path: `group:${path}`,
        label: spec._label ?? key, collapsed: !!spec._collapsed,
        children: build(obj, spec, parent, used, false),
      });
      continue;
    }
    warn(`"${path}" is in the schema but not in the object.`);
  }
  if (rest) {
    for (const key of Object.keys(obj)) {
      if (used.has(key)) continue;
      const n = control(obj, key, undefined, join(parent, key));
      if (n) nodes.push(n);
    }
  }
  return nodes;
}

/** Every control that holds a value, sections and springs opened up. */
function leaves(nodes) {
  return nodes.flatMap((n) => (n.kind === "section" || n.kind === "spring" ? leaves(n.children) : ["action", "readout"].includes(n.kind) ? [] : [n]));
}

const read = (n) => n.obj[n.key];

/** A pasted value checked against its control: clamped where it can be, or a reason it can't be used. */
export function normalise(node, raw) {
  switch (node.kind) {
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, reason: "not a number" };
      return { ok: true, value: clamp(raw, node.min, node.max), clamped: raw < node.min || raw > node.max };
    case "toggle":
      return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false, reason: "not true or false" };
    case "colour":
      return typeof raw === "string" && HEX.test(raw.trim()) ? { ok: true, value: raw.trim().toLowerCase() } : { ok: false, reason: "not a hex colour" };
    case "select": {
      const hit = node.options.find((o) => o.value === raw || String(o.value) === String(raw));
      return hit ? { ok: true, value: hit.value } : { ok: false, reason: "not one of the options" };
    }
    case "easing": {
      const c = parseBezier(raw);
      return c ? { ok: true, value: c } : { ok: false, reason: "not a cubic-bezier" };
    }
  }
  return { ok: false, reason: "not a control" };
}

function getAt(obj, path) {
  return path.split(".").reduce((v, k) => (v !== null && typeof v === "object" ? v[k] : undefined), obj);
}

function pathsIn(obj, parent = "") {
  return Object.entries(obj).flatMap(([k, v]) => (isPlain(v) ? pathsIn(v, join(parent, k)) : [join(parent, k)]));
}

/* ================================================================== clipboard */

/** Async clipboard first, then a hidden textarea with execCommand (embedded browsers refuse the first). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  const back = document.activeElement; // the host, when focus is inside the panel
  const inner = back?.shadowRoot?.activeElement;
  document.body.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  (inner ?? back)?.focus?.({ preventScroll: true });
  return ok;
}

/* ================================================================== DOM helpers */

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "spellcheck") el.setAttribute(k, String(v));
    else if (k in el && !k.includes("-")) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

/** Pointer capture for one drag; every listener goes when it ends. */
function drag(el, e, onMove, onEnd) {
  el.setPointerCapture(e.pointerId);
  const ac = new AbortController();
  const end = (ev) => { ac.abort(); onEnd?.(ev); };
  el.addEventListener("pointermove", onMove, { signal: ac.signal });
  el.addEventListener("pointerup", end, { signal: ac.signal });
  el.addEventListener("pointercancel", end, { signal: ac.signal });
}

const SVG = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c) el.append(c);
  return el;
}

const icon = (d, size = 16) => s("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, s("path", { d }));
const ICON = {
  collapse: () => icon("M6 3l5 5-5 5M13 2v12"),
  expand: () => icon("M10 3L5 8l5 5M3 2v12"),
  chevron: () => icon("M4 6l4 4 4-4", 14),
  up: () => icon("M4 10l4-4 4 4"),
};

const store = {
  key: () => `tune-panel:${location.pathname}`,
  get() { try { return JSON.parse(localStorage.getItem(this.key())) ?? {}; } catch { return {}; } },
  set(patch) { try { localStorage.setItem(this.key(), JSON.stringify({ ...this.get(), ...patch })); } catch {} },
};

function themeCss(theme) {
  const vars = (o) => Object.entries(o).map(([k, v]) => `--tune-${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}:${v};`).join("");
  const common = vars({ font: theme.font, mono: theme.mono, radius: theme.radius, radiusSm: theme.radiusSm });
  // The handle: a grey mixed from the theme's own text colour, multiplied in light and screened in dark,
  // so the label and number read straight through it in every theme.
  const knobLight = "--tune-knob:color-mix(in srgb,var(--tune-text) 45%,white);--tune-knob-blend:multiply;";
  const knobDark = "--tune-knob:color-mix(in srgb,var(--tune-text) 45%,black);--tune-knob-blend:screen;";
  return `:host{${common}${vars(theme.light)}${knobLight}color-scheme:light}
@media (prefers-color-scheme: dark){:host(:not([scheme=light])){${vars(theme.dark)}${knobDark}color-scheme:dark}}
:host([scheme=dark]){${vars(theme.dark)}${knobDark}color-scheme:dark}`;
}

/* ================================================================== styles */

const CSS = `
:host{all:initial;display:block;--tune-gap:6px;--tune-row:44px}
*,*::before,*::after{box-sizing:border-box}
.panel{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--tune-bg);color:var(--tune-text);
  font:14px/1.3 var(--tune-font);border-left:1px solid var(--tune-line);-webkit-font-smoothing:antialiased}
:host([collapsed]) .panel{display:none}
button,input,select,textarea{font:inherit;color:inherit}
:focus{outline:none}
:focus-visible{outline:2px solid var(--tune-focus);outline-offset:2px}
.bar :focus-visible,.seg :focus-visible{outline-offset:-2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

header{display:flex;align-items:center;gap:8px;padding:14px 14px 12px 16px}
h2{flex:1;min-width:0;margin:0;font-size:15px;font-weight:650;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon{flex:none;width:36px;height:36px;border:0;border-radius:var(--tune-radius-sm);background:var(--tune-field);display:grid;place-items:center;cursor:pointer}
.icon:hover{background:var(--tune-fill)}

/* Compare: a pill floating on the page at the panel's top-left edge, shown once something changed. */
.cmp{position:absolute;z-index:5;top:12px;right:calc(100% + 12px);display:flex;align-items:center;gap:8px;padding:8px 12px;border:0;border-radius:999px;
  background:var(--tune-text);color:var(--tune-surface);font:500 13px var(--tune-font);white-space:nowrap;box-shadow:0 6px 20px rgb(0 0 0 / .18);
  cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;transition:opacity .2s,transform .2s}
.cmp kbd{font:500 12px var(--tune-mono);padding:1px 6px;border-radius:4px;background:color-mix(in srgb,var(--tune-surface) 18%,transparent)}
.cmp[data-show=false]{opacity:0;transform:translateY(-6px);pointer-events:none;visibility:hidden}
.cmp[aria-pressed=true]{background:var(--tune-accent);color:var(--tune-on-accent)}
.cmp[aria-pressed=true] .k{display:none}
:host([comparing]) .scroll{pointer-events:none;opacity:.7}

.scroll{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;overscroll-behavior:contain;scrollbar-width:thin}
.card{background:var(--tune-surface);border-radius:var(--tune-radius);padding:6px;margin-bottom:10px}
.card .card{background:none;padding:0;margin:4px 0 0;border-radius:0;border-left:2px solid var(--tune-line);padding-left:8px}
.head{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:4px 8px;border:0;background:none;border-radius:var(--tune-radius-sm);
  font-weight:650;font-size:13px;text-align:left;cursor:pointer}
.head .count{margin-left:auto;font-weight:500;color:var(--tune-muted)}
.head .chev{display:grid;color:var(--tune-muted);transition:transform .15s}
.head[aria-expanded=false] .chev{transform:rotate(-90deg)}
.body{display:flex;flex-direction:column;gap:var(--tune-gap)}
.body[hidden]{display:none}

.bar{position:relative;user-select:none;-webkit-user-select:none;display:flex;align-items:center;min-height:var(--tune-row);border-radius:var(--tune-radius-sm);background:var(--tune-field);overflow:hidden}
.fill{position:absolute;inset:0 auto 0 0;background:var(--tune-fill);pointer-events:none}
.hit{position:absolute;inset:0;border-radius:inherit;cursor:pointer;touch-action:none}
.drag .hit{cursor:grabbing}
.bw{position:relative}
/* The handle: a rounded band, plus a 2px stub above and below it reaching the row's edges. The pieces don't
   overlap, so the blend never doubles up. */
.knob{position:absolute;top:0;bottom:0;width:6px;margin-left:-3px;pointer-events:none;transition:width .12s,margin .12s}
.knob::before,.knob::after{content:"";position:absolute;mix-blend-mode:var(--tune-knob-blend)}
.knob::before{left:0;right:0;top:4px;bottom:4px;border-radius:3px;background:var(--tune-knob)}
.knob::after{left:50%;top:0;bottom:0;width:2px;margin-left:-1px;border-radius:1px;
  background:linear-gradient(var(--tune-knob) 0 4px,transparent 4px calc(100% - 4px),var(--tune-knob) calc(100% - 4px))}
.bar:hover .knob,.bar.drag .knob{width:8px;margin-left:-4px}
.bub{position:absolute;z-index:4;bottom:calc(100% + 5px);padding:3px 8px;border-radius:6px;background:var(--tune-text);color:var(--tune-surface);
  font:500 12px var(--tune-mono);white-space:nowrap;pointer-events:none;opacity:0;transform:translateX(-50%) translateY(4px);transition:opacity .12s,transform .12s}
.bub::after{content:"";position:absolute;left:50%;top:100%;margin-left:-4px;border:4px solid transparent;border-top-color:var(--tune-text)}
.bw.below .bub{bottom:auto;top:calc(100% + 5px)}
.bw.below .bub::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:var(--tune-text)}
.bw.drag .bub{opacity:1;transform:translateX(-50%)}
button.hit{border:0;background:none;padding:0;cursor:pointer}
.over{position:relative;display:flex;align-items:center;gap:2px;width:100%;min-height:var(--tune-row);padding:0 6px 0 12px;pointer-events:none}
.over > :not(.lab){pointer-events:auto}
.lab{flex:1;min-width:0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.val{width:7ch;min-width:0;padding:6px 2px;border:0;border-radius:5px;background:none;font:500 13px var(--tune-mono);text-align:right;cursor:text}
.val:focus{background:var(--tune-surface)}
.unit{font:13px var(--tune-mono);color:var(--tune-muted);min-width:4px;margin-right:6px}
.hint{margin:-2px 12px 2px;font-size:12px;color:var(--tune-muted)}

.pill{margin-right:6px;padding:4px 10px;border:1.5px solid currentColor;border-radius:5px;font-weight:650;font-size:12px;color:var(--tune-muted)}
.on .pill{background:var(--tune-accent);border-color:var(--tune-accent);color:var(--tune-on-accent)}

.seg{flex:0 0 60%;display:flex;gap:2px;padding:3px}
.seg button{flex:1;min-width:0;min-height:36px;border:0;border-radius:5px;background:none;font-size:13px;color:var(--tune-muted);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px}
.seg button[aria-checked=true]{background:var(--tune-surface);color:var(--tune-text);font-weight:650;box-shadow:0 1px 2px rgb(0 0 0 / .12)}
.menu{max-width:58%;margin-right:4px;padding:8px 28px 8px 10px;border:0;border-radius:6px;background:var(--tune-surface);appearance:none;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px;background-repeat:no-repeat}
.hex{width:8.5ch;padding:6px 4px;border:0;border-radius:5px;background:none;font:500 13px var(--tune-mono);text-align:right}
.hex:focus{background:var(--tune-surface)}
.swatch{position:relative;flex:none;width:30px;height:30px;margin:0 4px;border-radius:6px;box-shadow:inset 0 0 0 1px rgb(0 0 0 / .18);overflow:hidden}
.swatch input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);opacity:0;cursor:pointer}
.swatch:focus-within{outline:2px solid var(--tune-focus);outline-offset:-2px}

.tiles{display:grid;grid-template-columns:1fr 1fr;gap:var(--tune-gap)}
.tile{min-width:0;padding:8px 10px;border-radius:var(--tune-radius-sm);background:var(--tune-field);font-size:12px;color:var(--tune-muted)}
.tile b{display:block;font:500 15px var(--tune-mono);color:var(--tune-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.action{justify-content:center;width:100%;border:0;font-weight:600;cursor:pointer}
.action:hover{background:var(--tune-fill)}

.block{position:relative;display:flex;flex-direction:column;gap:var(--tune-gap);border-radius:var(--tune-radius-sm)}
.cap{display:flex;align-items:center;gap:4px;min-height:30px;padding:0 4px 0 12px}
.cap .lab{color:var(--tune-text)}
.cap .meta{font:12px var(--tune-mono);color:var(--tune-muted)}
.curve{border-radius:var(--tune-radius-sm);background:var(--tune-field);color:var(--tune-text)}
.curve svg{display:block;width:100%;height:auto;overflow:visible}
.ease svg{touch-action:none;user-select:none;-webkit-user-select:none}
.handle{cursor:grab}
.handle:focus-visible{outline:none}
.handle:focus-visible circle{stroke:var(--tune-focus);stroke-width:3}
.row{display:flex;gap:var(--tune-gap)}
.row input{flex:1;min-width:0;min-height:40px;padding:0 10px;border:0;border-radius:var(--tune-radius-sm);background:var(--tune-field);font:500 13px var(--tune-mono)}
.row select{flex:none;min-height:40px;border:0;border-radius:var(--tune-radius-sm);background:var(--tune-field);padding:0 8px;cursor:pointer}

.fps{display:block;width:100%;height:30px}

footer{position:relative;padding:12px;border-top:1px solid var(--tune-line);background:var(--tune-bg)}
.split{display:flex;gap:2px}
.split .pri{flex:1;border-radius:var(--tune-radius) 4px 4px var(--tune-radius)}
.split .more{flex:none;width:52px;border-radius:4px var(--tune-radius) var(--tune-radius) 4px;display:grid;place-items:center}
.split .more svg{transition:transform .15s}
.split .more[aria-expanded=true] svg{transform:rotate(180deg)}
.menu{position:absolute;z-index:6;right:12px;bottom:calc(100% - 4px);min-width:200px;display:flex;flex-direction:column;padding:6px;border-radius:var(--tune-radius);
  background:var(--tune-surface);box-shadow:0 10px 30px rgb(0 0 0 / .18),0 0 0 1px var(--tune-line)}
.menu[hidden]{display:none}
.menu button{min-height:40px;padding:0 12px;border:0;border-radius:var(--tune-radius-sm);background:none;text-align:left;font-weight:500;cursor:pointer}
.menu button:hover,.menu button:focus-visible{background:var(--tune-field)}
.pri{min-height:52px;border:0;border-radius:var(--tune-radius);background:var(--tune-accent);color:var(--tune-on-accent);font-weight:650;font-size:15px;cursor:pointer}
.pri:hover{filter:brightness(1.12)}
.sec{min-height:52px;border:1.5px solid color-mix(in srgb,var(--tune-text) 22%,transparent);border-radius:var(--tune-radius);background:var(--tune-surface);font-weight:600;cursor:pointer}
.sec:hover{border-color:var(--tune-text)}
.paste{display:grid;grid-template-columns:2fr 1fr;gap:8px}
.paste textarea{grid-column:1/-1;min-height:150px;padding:10px;border:1px solid var(--tune-line);border-radius:var(--tune-radius-sm);background:var(--tune-surface);
  font:12px/1.45 var(--tune-mono);resize:vertical}
.paste .pri,.paste .sec{min-height:44px}
.msg{grid-column:1/-1;min-height:1.2em;margin:0;font-size:12.5px;color:var(--tune-muted)}
.msg:empty{display:none}

.grip{position:absolute;z-index:3;left:-5px;top:0;bottom:0;width:10px;cursor:ew-resize;touch-action:none}
.grip::after{content:"";position:absolute;left:4px;top:50%;width:3px;height:48px;margin-top:-24px;border-radius:2px;background:var(--tune-text);opacity:0;transition:opacity .15s}
.grip:hover::after,.grip:focus-visible::after,.grip.dragging::after{opacity:.35}
.grip:focus-visible{outline:none}
:host([collapsed]) .grip{display:none}

.rail{display:none;position:absolute;inset:0;flex-direction:column;align-items:center;gap:14px;width:100%;padding:14px 0;
  border:0;border-left:1px solid var(--tune-line);background:var(--tune-bg);color:var(--tune-text);font:600 13px var(--tune-font);cursor:pointer}
:host([collapsed]) .rail{display:flex}
.rail span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap}
.rail:hover{background:var(--tune-field)}
.rail:focus-visible{outline-offset:-3px}
@media (prefers-reduced-motion: reduce){*{transition:none !important}}
`;

/* ================================================================== the element */

const Base = globalThis.HTMLElement ?? class {};

class TunePanel extends Base {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._views = new Map(); // node → { update }
    this._sections = []; // { node, head, count }
    this._readouts = [];
    this._loop = 0;
  }

  /** Builds the panel for `cfg`. Called by tune(). */
  mount(cfg, schema = {}, options = {}) {
    this.cfg = cfg;
    this.options = options;
    this.nodes = build(cfg, schema, "");
    this.leaves = leaves(this.nodes);
    const saved = store.get();
    this.width = clamp(saved.width ?? options.width ?? 340, MIN_W, MAX_W);
    this.closed = new Set(saved.closed ?? []);

    const theme = typeof options.theme === "object" ? { ...THEMES.neutral, ...options.theme } : THEMES[options.theme ?? "neutral"];
    if (!theme) warn(`no theme "${options.theme}"; using neutral. Themes: ${Object.keys(THEMES).join(", ")}.`);
    if (options.scheme && options.scheme !== "auto") this.setAttribute("scheme", options.scheme);

    const root = this.shadowRoot;
    root.replaceChildren(h("style", {}, CSS), h("style", {}, themeCss(theme ?? THEMES.neutral)));

    this._live = h("p", { class: "sr", role: "status" });
    const title = options.title ?? "Tune";
    const collapseBtn = h("button", { class: "icon", type: "button", "aria-label": "Collapse the tune panel", "aria-expanded": "true", onclick: () => this.collapse(true) }, ICON.collapse());
    const header = h("header", {}, h("h2", { id: "title" }, title), collapseBtn);

    const scroll = h("div", { class: "scroll" });
    if (options.fps) scroll.append(this._fpsCard());
    let loose = [];
    const flush = () => {
      if (!loose.length) return;
      scroll.append(h("div", { class: "card" }, h("div", { class: "body" }, this._render(loose))));
      loose = [];
    };
    for (const n of this.nodes) {
      if (n.kind === "section") { flush(); scroll.append(this._section(n)); }
      else loose.push(n);
    }
    flush();

    this._copyBtn = h("button", { class: "pri", type: "button", onclick: () => this.copy() }, "Copy values");
    this._footer = h("footer", {});
    this._footerIdle();

    const parts = [header];
    parts.push(scroll, this._footer, this._live);
    const panel = h("section", { class: "panel", "aria-labelledby": "title" }, ...parts);

    this._rail = h("button", { class: "rail", type: "button", "aria-label": `Open the tune panel: ${title}`, "aria-expanded": "false", onclick: () => this.collapse(false) },
      ICON.expand(), h("span", {}, `Tune · ${title}`));
    root.append(this._grip(), panel, this._rail);
    if (options.compare !== false && this.leaves.length) root.append(this._comparePill());

    this._applyHostStyle();
    this.collapse(saved.collapsed ?? options.collapsed ?? false, false);
    this._marks();
    return this;
  }

  /* ---------------------------------------------------------- public API */

  /** The object the panel edits (the one passed to tune). */
  get values() { return this.cfg; }

  /** Sets a value by its dot path, as if the control had changed it. */
  set(path, value) {
    const node = this.leaves.find((n) => n.path === path);
    if (!node) return warn(`no control at "${path}".`);
    const checked = normalise(node, value);
    if (checked.ok) this._apply(node, checked.value);
    else warn(`"${path}": ${checked.reason}.`);
  }

  /** Re-reads every value from the object (after the page changed it itself). */
  refresh() {
    for (const v of this._views.values()) v.update();
    this._marks();
  }

  /** Every control back to the value it had when the panel mounted. */
  reset() {
    for (const n of this.leaves) this._apply(n, clone(n.def), false);
    this._afterChange(null);
    this._say("Every value is back to its default.");
    this.dispatchEvent(new CustomEvent("reset"));
  }

  /** Copies the object as JSON; returns the JSON. */
  async copy() {
    const json = JSON.stringify(this.cfg, null, 2);
    const ok = await copyText(json);
    if (ok) {
      this._copyBtn.textContent = "Copied";
      this._say("Values copied. Paste them in chat.");
      clearTimeout(this._copyTimer);
      this._copyTimer = setTimeout(() => { this._copyBtn.textContent = "Copy values"; }, 1600);
    } else {
      this._footerShow(json); // some embedded browsers refuse both clipboard paths and swallow prompt()
    }
    return json;
  }

  collapse(on, save = true) {
    this.toggleAttribute("collapsed", on);
    this._push();
    if (save) store.set({ collapsed: on });
    if (on) this._stopLoop(); else this._startLoop();
    if (save) (on ? this._rail : this.shadowRoot.querySelector("header .icon"))?.focus();
  }

  destroy() { this.remove(); }

  disconnectedCallback() {
    this._stopLoop();
    window.removeEventListener("keydown", this._onKey, true);
    window.removeEventListener("keyup", this._onKey, true);
    window.removeEventListener("blur", this._onBlur);
    document.getElementById("tune-panel-push")?.remove();
    document.documentElement.style.removeProperty("--tune-panel-push");
  }

  connectedCallback() {
    if (this.cfg) { this._push(); if (!this.hasAttribute("collapsed")) this._startLoop(); }
    if (this.options?.compare !== false) {
      window.addEventListener("keydown", this._onKey, true);
      window.addEventListener("keyup", this._onKey, true);
      window.addEventListener("blur", this._onBlur);
    }
  }

  /* ---------------------------------------------------------- layout */

  _applyHostStyle() {
    const set = (p, v) => this.style.setProperty(p, v, "important");
    set("position", "fixed");
    set("top", "0");
    set("right", "0");
    set("bottom", "0");
    set("height", "100dvh");
    set("z-index", "2147483000");
    set("display", "block");
    set("margin", "0");
  }

  /** The page narrows beside the panel: a right margin on <html>, so nothing is covered. */
  _push() {
    if (!this.isConnected) return;
    const w = this.hasAttribute("collapsed") ? RAIL_W : this.width;
    this.style.setProperty("width", `${w}px`, "important");
    if (!document.getElementById("tune-panel-push")) {
      document.head.append(h("style", { id: "tune-panel-push" }, "html{margin-right:var(--tune-panel-push,0px) !important}"));
    }
    document.documentElement.style.setProperty("--tune-panel-push", `${w}px`);
    this.shadowRoot.querySelector(".grip")?.setAttribute("aria-valuenow", this.width);
  }

  _grip() {
    const grip = h("div", { class: "grip", role: "separator", tabindex: 0, "aria-orientation": "vertical", "aria-label": "Resize the tune panel",
      "aria-valuemin": MIN_W, "aria-valuemax": MAX_W, "aria-valuenow": this.width });
    const setW = (w) => { this.width = clamp(Math.round(w), MIN_W, MAX_W); this._push(); };
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.classList.add("dragging");
      const x0 = e.clientX, w0 = this.width;
      drag(grip, e, (ev) => setW(w0 - (ev.clientX - x0)), () => {
        grip.classList.remove("dragging");
        store.set({ width: this.width });
      });
    });
    grip.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: 16, ArrowRight: -16 }[e.key];
      if (!d) return;
      e.preventDefault();
      setW(this.width + d * (e.shiftKey ? 0.25 : 1));
      store.set({ width: this.width });
    });
    return grip;
  }

  /* ---------------------------------------------------------- changes */

  _apply(node, value, notify = true) {
    if (node.kind === "easing") read(node).splice(0, 4, ...value);
    else node.obj[node.key] = value;
    this._views.get(node)?.update();
    if (node.owner) this._views.get(node.owner)?.update();
    if (notify) this._afterChange(node);
  }

  _afterChange(node) {
    this._marks();
    const detail = node ? { path: node.path, value: clone(read(node)), values: this.cfg } : { path: null, value: null, values: this.cfg };
    this.options.onChange?.(detail);
    this.dispatchEvent(new CustomEvent("change", { detail }));
  }

  _edited(node) {
    const v = read(node);
    return node.kind === "colour" ? hex6(v) !== hex6(node.def) : !same(v, node.def);
  }

  /** Rows carry no edited marks; the compare button says whether anything changed. */
  _marks() {
    if (!this._cmp || this._held) return;
    this._cmp.dataset.show = String(this.leaves.some((l) => this._edited(l)));
  }

  _say(text) {
    this._live.textContent = "";
    requestAnimationFrame(() => { this._live.textContent = text; });
  }

  /* ---------------------------------------------------------- sections */

  _render(nodes) {
    const out = [];
    let tiles = null;
    for (const n of nodes) {
      if (n.kind === "readout") {
        if (!tiles) { tiles = h("div", { class: "tiles" }); out.push(tiles); }
        tiles.append(this._readout(n));
        continue;
      }
      tiles = null;
      out.push(this[`_${n.kind}`](n));
    }
    return out;
  }

  _section(node) {
    const id = `s${this._sections.length}`;
    const open = !(this.closed.has(node.path) || (node.collapsed && !this.closed.has(`open:${node.path}`)));
    const body = h("div", { class: "body", id, hidden: !open }, this._render(node.children));
    const head = h("button", { class: "head", type: "button", "aria-expanded": String(open), "aria-controls": id },
      h("span", {}, node.label), h("span", { class: "chev", style: "margin-left:auto" }, ICON.chevron()));
    head.addEventListener("click", () => {
      const isOpen = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", String(!isOpen));
      body.hidden = isOpen;
      this.closed.delete(node.path);
      this.closed.delete(`open:${node.path}`);
      if (isOpen) this.closed.add(node.path);
      else if (node.collapsed) this.closed.add(`open:${node.path}`);
      store.set({ closed: [...this.closed] });
    });
    this._sections.push({ node, head });
    return h("div", { class: "card" }, head, body);
  }

  /* ---------------------------------------------------------- rows */

  /** The shared row: a hit area under a label and the row's own end. */
  _row(node, hit, ...end) {
    const over = h("div", { class: "over" }, h("span", { class: "lab", "aria-hidden": "true" }, node.label), ...end);
    const bar = h("div", { class: "bar" }, hit, over);
    const bw = h("div", { class: "bw" }, bar);
    const wrap = node.hint ? h("div", { class: "body" }, bw, h("p", { class: "hint" }, node.hint)) : bw;
    return { bar, bw, wrap };
  }

  _number(node) {
    const range = { min: node.min, max: node.max, step: node.step };
    const pct = (v) => ((v - node.min) / (node.max - node.min || 1)) * 100;
    const fmt = (v) => String(roundTo(v, node.step * SCALE.fine));
    const fill = h("span", { class: "fill" });
    const hit = h("div", { class: "hit", role: "slider", tabindex: 0, "aria-label": node.label, "aria-valuemin": node.min, "aria-valuemax": node.max });
    const input = h("input", { class: "val", type: "text", inputmode: "decimal", spellcheck: "false", autocomplete: "off", "aria-label": `${node.label}, type a value` });
    const knob = h("span", { class: "knob", "aria-hidden": "true" });
    const bub = h("span", { class: "bub", "aria-hidden": "true" });
    const row = this._row(node, hit, input, h("span", { class: "unit", "aria-hidden": "true" }, node.unit));
    row.bar.prepend(fill, knob);
    row.bw.append(bub);
    const set = (v) => { if (v !== read(node)) this._apply(node, v); };

    // Absolute: the value is wherever the pointer is, so the handle stays under it. Shift slows it to a tenth
    // from where it is; Alt snaps to ten steps.
    hit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; // no preventDefault: the mouse focuses the row without a keyboard ring
      const rect = row.bar.getBoundingClientRect();
      const scroller = this.shadowRoot.querySelector(".scroll").getBoundingClientRect();
      row.bw.classList.toggle("below", rect.top - scroller.top < 34); // no room above: the bubble goes under
      let fine = null;
      const apply = (ev) => {
        const m = modifierOf(ev);
        if (m === "fine") {
          fine ??= { x: ev.clientX, v: read(node) };
          set(snap(fine.v + ((ev.clientX - fine.x) / rect.width) * (node.max - node.min) * SCALE.fine, range, "fine"));
        } else {
          fine = null;
          set(snap(node.min + clamp((ev.clientX - rect.left) / rect.width, 0, 1) * (node.max - node.min), range, m));
        }
      };
      row.bar.classList.add("drag");
      row.bw.classList.add("drag");
      apply(e);
      drag(hit, e, apply, () => {
        row.bar.classList.remove("drag");
        row.bw.classList.remove("drag");
      });
    });
    hit.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.focus(); return; }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); set(node.def); return; }
      const v = keyAction(e.key, read(node), modifierOf(e), range);
      if (v === null) return;
      e.preventDefault();
      set(v);
    });
    const commit = () => {
      const n = parseFloat(input.value);
      if (Number.isFinite(n)) set(clamp(roundTo(n, node.step * SCALE.fine), node.min, node.max));
      view.update(true);
    };
    input.addEventListener("focus", () => input.select());
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); hit.focus(); return; }
      if (e.key === "Escape") { e.preventDefault(); view.update(true); hit.focus(); return; }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        set(keyAction(e.key, read(node), modifierOf(e), range));
        view.update(true);
        input.select();
      }
    });

    const view = {
      update: (force) => {
        const v = read(node);
        const p = `${clamp(pct(v), 0, 100)}%`;
        fill.style.width = p;
        knob.style.left = p;
        bub.style.left = p;
        bub.textContent = `${fmt(v)}${/^[a-z]/i.test(node.unit) ? " " : ""}${node.unit}`; // 1000 px, 18°
        if (force || this.shadowRoot.activeElement !== input) input.value = fmt(v);
        hit.setAttribute("aria-valuenow", v);
        hit.setAttribute("aria-valuetext", `${fmt(v)}${node.unit}`);
      },
    };
    this._views.set(node, view);
    view.update();
    return row.wrap;
  }

  _toggle(node) {
    const hit = h("button", { class: "hit", type: "button", role: "switch", "aria-label": node.label, onclick: () => this._apply(node, !read(node)) });
    const pill = h("span", { class: "pill", "aria-hidden": "true" });
    const row = this._row(node, hit, pill);
    const view = {
      update: () => {
        const on = !!read(node);
        hit.setAttribute("aria-checked", String(on));
        pill.textContent = on ? "On" : "Off";
        row.bar.classList.toggle("on", on);
      },
    };
    this._views.set(node, view);
    view.update();
    return row.wrap;
  }

  _select(node) {
    let end, update;
    if (node.display === "segmented") {
      const buttons = node.options.map((o, i) =>
        h("button", { type: "button", role: "radio", title: o.label, onclick: () => this._apply(node, o.value) }, String(o.label)));
      end = h("div", { class: "seg", role: "radiogroup", "aria-label": node.label }, buttons);
      end.addEventListener("keydown", (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const i = node.options.findIndex((o) => o.value === read(node));
        const next = (i + d + node.options.length) % node.options.length;
        this._apply(node, node.options[next].value);
        buttons[next].focus();
      });
      update = () => buttons.forEach((b, i) => {
        const on = node.options[i].value === read(node);
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      });
    } else {
      end = h("select", { class: "menu", "aria-label": node.label, onchange: (e) => this._apply(node, node.options[e.target.selectedIndex].value) },
        node.options.map((o) => h("option", {}, String(o.label))));
      update = () => { end.selectedIndex = node.options.findIndex((o) => o.value === read(node)); };
    }
    const row = this._row(node, null, end);
    const view = { update, mark: row.mark };
    this._views.set(node, view);
    view.update();
    return row.wrap;
  }

  _colour(node) {
    const text = h("input", { class: "hex", type: "text", spellcheck: "false", autocomplete: "off", "aria-label": `${node.label}, hex` });
    const picker = h("input", { type: "color", "aria-label": `${node.label}, pick a colour` });
    const swatch = h("span", { class: "swatch" }, picker);
    const row = this._row(node, null, text, swatch);
    picker.addEventListener("input", () => this._apply(node, picker.value));
    const commit = () => {
      const v = text.value.trim().replace(/^([0-9a-f]{3}|[0-9a-f]{6})$/i, "#$1");
      if (HEX.test(v)) this._apply(node, v.toLowerCase());
      view.update(true);
    };
    text.addEventListener("change", commit);
    text.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") view.update(true); });
    const view = {
      update: (force) => {
        const v = read(node);
        if (force || this.shadowRoot.activeElement !== text) text.value = v;
        picker.value = hex6(v);
        swatch.style.background = v;
      },
    };
    this._views.set(node, view);
    view.update();
    return row.wrap;
  }

  _readout(node) {
    const out = h("b", {}, "–");
    this._readouts.push({ node, out, last: undefined });
    return h("div", { class: "tile" }, node.label, out);
  }

  _action(node) {
    return h("button", { class: "bar action", type: "button", onclick: () => node.run?.(this.cfg) }, node.label);
  }

  _caption(node, ...extra) {
    return h("div", { class: "cap" }, h("span", { class: "lab" }, node.label), ...extra);
  }

  _spring(node) {
    const W = 300, H = 86, P = 10;
    const path = s("path", { fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" });
    const goal = s("line", { x1: P, x2: W - P, stroke: "currentColor", "stroke-opacity": 0.35, "stroke-dasharray": "3 3" });
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, goal, path);
    const meta = h("span", { class: "meta" });
    const cap = h("div", { class: "cap" }, h("span", { class: "lab" }, node.label), meta);
    const block = h("div", { class: "block" }, cap, h("div", { class: "curve" }, svg), node.children.map((c) => this._number(c)));
    const view = {
      update: () => {
        const p = read(node);
        const T = Math.max(settleTime(p), 0.05);
        const pts = Array.from({ length: 81 }, (_, i) => springAt(p, (i / 80) * T));
        const top = Math.max(1.1, ...pts), bottom = Math.min(0, ...pts);
        const y = (v) => P + ((top - v) / (top - bottom)) * (H - 2 * P);
        path.setAttribute("d", "M" + pts.map((v, i) => `${(P + (i / 80) * (W - 2 * P)).toFixed(1)},${y(v).toFixed(1)}`).join(" L"));
        goal.setAttribute("y1", y(1));
        goal.setAttribute("y2", y(1));
        meta.textContent = `settles in ${T.toFixed(2)} s`;
        svg.setAttribute("aria-label", `${node.label} curve, settles in ${T.toFixed(2)} seconds`);
      },
    };
    this._views.set(node, view);
    view.update();
    return block;
  }

  _easing(node) {
    const W = 300, H = 220, P = 18, Y0 = -0.6, Y1 = 1.6;
    const X = (x) => P + x * (W - 2 * P);
    const Y = (y) => P + ((Y1 - y) / (Y1 - Y0)) * (H - 2 * P);
    const frame = s("rect", { x: X(0), y: Y(1), width: X(1) - X(0), height: Y(0) - Y(1), fill: "none", stroke: "currentColor", "stroke-opacity": 0.18 });
    const diag = s("line", { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), stroke: "currentColor", "stroke-opacity": 0.18, "stroke-dasharray": "3 3" });
    const l1 = s("line", { x1: X(0), y1: Y(0), stroke: "currentColor", "stroke-opacity": 0.5 });
    const l2 = s("line", { x1: X(1), y1: Y(1), stroke: "currentColor", "stroke-opacity": 0.5 });
    const curve = s("path", { fill: "none", stroke: "currentColor", "stroke-width": 2.5 });
    const handle = (n) => s("g", { class: "handle", tabindex: 0, role: "slider", "aria-label": `${node.label}, handle ${n}`, "aria-roledescription": "curve handle" },
      s("circle", { r: 14, fill: "transparent" }), s("circle", { r: 7, fill: "var(--tune-surface)", stroke: "currentColor", "stroke-width": 2 }));
    const h1 = handle(1), h2 = handle(2);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}` }, frame, diag, l1, l2, curve, h1, h2);
    const text = h("input", { type: "text", spellcheck: "false", autocomplete: "off", "aria-label": `${node.label}, cubic-bezier values` });
    const presets = h("select", { "aria-label": `${node.label}, presets` }, h("option", { value: "" }, "Presets"),
      Object.keys(EASING_PRESETS).map((k) => h("option", { value: k }, k)));
    const cap = this._caption(node);
    const block = h("div", { class: "block ease" }, cap, h("div", { class: "curve" }, svg), h("div", { class: "row" }, text, presets));

    const setHandle = (i, x, y) => {
      const c = read(node).slice();
      c[i * 2] = roundTo(clamp(x, 0, 1), 0.01);
      c[i * 2 + 1] = roundTo(clamp(y, Y0, Y1), 0.01);
      this._apply(node, c);
    };
    const toCurve = (e) => {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      return [(pt.x - P) / (W - 2 * P), Y1 - ((pt.y - P) / (H - 2 * P)) * (Y1 - Y0)];
    };
    [h1, h2].forEach((g, i) => {
      g.addEventListener("pointerdown", (e) => {
        drag(g, e, (ev) => setHandle(i, ...toCurve(ev)));
      });
      g.addEventListener("keydown", (e) => {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (!d) return;
        e.preventDefault();
        const by = modifierOf(e) === "coarse" ? 0.1 : 0.01; // 0.01 is the curve's grain, so Shift has nothing finer
        const c = read(node);
        setHandle(i, c[i * 2] + d[0] * by, c[i * 2 + 1] + d[1] * by);
      });
    });
    text.addEventListener("change", () => {
      const c = parseBezier(text.value);
      if (c) this._apply(node, c);
      view.update(true);
    });
    text.addEventListener("keydown", (e) => { if (e.key === "Enter") text.dispatchEvent(new Event("change")); });
    presets.addEventListener("change", () => {
      if (presets.value) this._apply(node, EASING_PRESETS[presets.value].slice());
      presets.value = "";
    });

    const view = {
      update: (force) => {
        const [x1, y1, x2, y2] = read(node);
        curve.setAttribute("d", `M${X(0)},${Y(0)} C${X(x1)},${Y(y1)} ${X(x2)},${Y(y2)} ${X(1)},${Y(1)}`);
        l1.setAttribute("x2", X(x1)); l1.setAttribute("y2", Y(y1));
        l2.setAttribute("x2", X(x2)); l2.setAttribute("y2", Y(y2));
        h1.setAttribute("transform", `translate(${X(x1)} ${Y(y1)})`);
        h2.setAttribute("transform", `translate(${X(x2)} ${Y(y2)})`);
        h1.setAttribute("aria-valuetext", `x ${x1}, y ${y1}`);
        h2.setAttribute("aria-valuetext", `x ${x2}, y ${y2}`);
        if (force || this.shadowRoot.activeElement !== text) text.value = `${x1}, ${y1}, ${x2}, ${y2}`;
      },
    };
    this._views.set(node, view);
    view.update();
    return block;
  }

  /* ---------------------------------------------------------- FPS and readouts */

  _fpsCard() {
    this._fps = { canvas: h("canvas", { class: "fps", "aria-hidden": "true" }), label: h("span", { class: "count" }, "– fps"), samples: [] };
    return h("div", { class: "card" }, h("div", { class: "head", style: "cursor:default" }, h("span", {}, "Performance"), this._fps.label),
      h("div", { class: "curve", style: "padding:6px 8px" }, this._fps.canvas));
  }

  _startLoop() {
    if (this._loop || (!this._fps && !this._readouts.length)) return;
    let last = performance.now(), drawn = 0, polled = 0;
    const tick = (now) => {
      const dt = now - last;
      last = now;
      if (this._fps && dt > 0 && dt < 1000) {
        const f = this._fps.samples;
        f.push(1000 / dt);
        if (f.length > 120) f.shift();
        if (now - drawn > 250) { drawn = now; this._drawFps(); }
      }
      if (this._readouts.length && now - polled > 100) {
        polled = now;
        for (const r of this._readouts) {
          let v;
          try { v = r.node.get?.(this.cfg); } catch { v = "–"; }
          v = typeof v === "number" ? String(roundTo(v, 0.01)) : String(v ?? "–");
          if (v !== r.last) { r.last = v; r.out.textContent = v; }
        }
      }
      this._loop = requestAnimationFrame(tick);
    };
    this._loop = requestAnimationFrame(tick);
  }

  _stopLoop() {
    cancelAnimationFrame(this._loop);
    this._loop = 0;
  }

  _drawFps() {
    const { canvas, samples, label } = this._fps;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, hh = canvas.clientHeight;
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    const style = getComputedStyle(this.shadowRoot.querySelector(".panel"));
    const bars = 60, bw = w / bars;
    const recent = samples.slice(-bars);
    recent.forEach((f, i) => {
      const v = clamp(f / 120, 0.04, 1);
      ctx.fillStyle = style.getPropertyValue("--tune-muted");
      ctx.globalAlpha = f < 50 ? 1 : 0.45; // dropped frames stand out by height and weight, not colour
      ctx.fillRect((bars - recent.length + i) * bw, hh - v * hh, Math.max(1, bw - 1), v * hh);
    });
    ctx.globalAlpha = 1;
    const last = samples.slice(-30);
    const avg = last.reduce((a, b) => a + b, 0) / (last.length || 1);
    label.textContent = `${Math.round(avg)} fps`;
  }

  /* ---------------------------------------------------------- compare */

  /**
   * Hold to see the page with the values from the code; let go to get your edits back. The pill floats on the page at
   * the panel's top edge once something has changed, and the backslash key does the same from anywhere.
   */
  _comparePill() {
    this._cmpLabel = h("span", {}, "Hold");
    this._cmp = h("button", { class: "cmp", type: "button", "aria-pressed": "false", "data-show": "false",
      "aria-label": "Hold to compare with the original values (or hold the backslash key)" },
      this._cmpLabel, h("kbd", { class: "k", "aria-hidden": "true" }, "\\"), h("span", { class: "k" }, "to compare"));
    const btn = this._cmp;
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch {} // keeps the hold if the pointer slides off
      this._compare(true);
    });
    for (const n of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(n, () => this._compare(false));
    btn.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); this._compare(true); }
    });
    btn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") this._compare(false); });
    return btn;
  }

  _compare(on) {
    if (!this._cmp || on === !!this._held) return;
    if (on) {
      if (!this.leaves.some((l) => this._edited(l))) return;
      this._held = new Map(this.leaves.map((n) => [n, clone(read(n))]));
      for (const n of this.leaves) this._apply(n, clone(n.def), false);
      this._cmpLabel.textContent = "Showing the original";
    } else {
      for (const [n, v] of this._held) this._apply(n, v, false);
      this._held = null;
      this._cmpLabel.textContent = "Hold";
    }
    this.toggleAttribute("comparing", on);
    this._cmp.setAttribute("aria-pressed", String(on));
    this._afterChange(null);
    this._say(on ? "Showing the original values." : "Showing your values.");
  }

  /** The backslash key, held anywhere on the page outside a text field, compares too (Lightroom's before and after). */
  _onKey = (e) => {
    if (e.key !== "\\" || e.repeat || e.metaKey || e.ctrlKey) return;
    const el = e.composedPath()[0];
    if (el instanceof Element && el.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.type === "keydown") { e.preventDefault(); this._compare(true); } else this._compare(false);
  };
  _onBlur = () => this._compare(false);

  /* ---------------------------------------------------------- footer and paste */

  /** Copy values, and an arrow that opens the two rare actions above it. */
  _footerIdle() {
    const more = h("button", { class: "pri more", type: "button", "aria-label": "More actions", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "menu" }, ICON.up());
    const item = (label, run) => h("button", { type: "button", role: "menuitem", tabindex: -1, onclick: () => { close(); run(); } }, label);
    const items = [item("Paste values", () => this._footerPaste()), item("Reset all", () => { this.reset(); this._copyBtn.focus(); })];
    const menu = h("div", { class: "menu", id: "menu", role: "menu", "aria-label": "More actions", hidden: true }, items);
    const outside = (e) => { if (!e.composedPath().some((n) => n === menu || n === more)) close(); };
    const open = () => {
      menu.hidden = false;
      more.setAttribute("aria-expanded", "true");
      items[0].focus();
      document.addEventListener("pointerdown", outside, true);
    };
    function close(refocus) {
      menu.hidden = true;
      more.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      if (refocus) more.focus();
    }
    more.addEventListener("click", () => (menu.hidden ? open() : close()));
    more.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); open(); } });
    menu.addEventListener("keydown", (e) => {
      const i = items.indexOf(this.shadowRoot.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
      if (e.key === "Escape") { e.preventDefault(); close(true); }
      if (e.key === "Tab") close();
    });
    this._copyBtn.textContent = "Copy values";
    this._footer.replaceChildren(h("div", { class: "split" }, this._copyBtn, more), menu);
  }

  /** The JSON, selected, for a browser that won't let a page write the clipboard. */
  _footerShow(json) {
    const ta = h("textarea", { "aria-label": "Values as JSON", readOnly: true, spellcheck: "false" }, json);
    const done = () => { this._footerIdle(); this._copyBtn.focus(); };
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); });
    this._footer.replaceChildren(h("div", { class: "paste" },
      h("p", { class: "msg", role: "status" }, "This browser won't let the page copy. The values are selected: press ⌘C or Ctrl+C."),
      ta, h("button", { class: "sec", type: "button", style: "grid-column:1/-1", onclick: done }, "Done")));
    ta.focus();
    ta.select();
  }

  _footerPaste() {
    const ta = h("textarea", { "aria-label": "Values as JSON", placeholder: '{ "max": 14 }', spellcheck: "false" });
    const msg = h("p", { class: "msg", role: "status" });
    const apply = () => {
      const result = this.paste(ta.value);
      msg.textContent = result.message;
      if (result.ok && !result.skipped.length) { this._footerIdle(); this._say(result.message); this._copyBtn.focus(); }
    };
    const cancel = () => { this._footerIdle(); this._footer.querySelector(".more").focus(); };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) apply();
    });
    this._footer.replaceChildren(h("div", { class: "paste" }, ta,
      h("button", { class: "pri", type: "button", onclick: apply }, "Apply"),
      h("button", { class: "sec", type: "button", onclick: cancel }, "Cancel"), msg));
    ta.focus();
  }

  /**
   * Applies pasted JSON (a values object, or { values }) onto the controls. Out-of-range numbers are clamped,
   * the wrong type or an unknown key is skipped and reported. Returns what happened.
   */
  paste(text) {
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, skipped: [], message: "That isn’t JSON. Copy values from a panel and paste them again." }; }
    if (!isPlain(data)) return { ok: false, skipped: [], message: "Values are a JSON object." };
    const incoming = isPlain(data.values) ? data.values : data;
    const applied = [], skipped = [], clamped = [];
    const known = new Set();
    for (const node of this.leaves) {
      const raw = getAt(incoming, node.path);
      if (raw === undefined) continue;
      known.add(node.path);
      const r = normalise(node, raw);
      if (!r.ok) { skipped.push(`${node.path} (${r.reason})`); continue; }
      this._apply(node, r.value, false);
      applied.push(node.path);
      if (r.clamped) clamped.push(node.path);
    }
    for (const p of pathsIn(incoming)) {
      if (!known.has(p) && ![...known].some((k) => p.startsWith(`${k}.`)) && !this.leaves.some((l) => l.path.startsWith(`${p}.`))) skipped.push(`${p} (no such control)`);
    }
    if (applied.length) this._afterChange(null);
    const n = applied.length;
    const parts = [n ? `Pasted ${n} value${n === 1 ? "" : "s"}` : "Nothing pasted"];
    if (clamped.length) parts.push(`clamped ${clamped.join(", ")} to its range`);
    if (skipped.length) parts.push(`skipped ${skipped.join(", ")}`);
    return { ok: n > 0, applied, skipped, message: parts.join("; ") + "." };
  }
}

if (globalThis.customElements && !customElements.get(TAG)) customElements.define(TAG, TunePanel);

/* ================================================================== entry point */

/**
 * Mounts the panel for `cfg` and returns it. One panel per page: a second call replaces the first.
 *
 * schema, per key (all optional; anything left out is inferred from cfg):
 *   [min, max, step?]                       a number (DialKit's [default, min, max, step?] also reads)
 *   { min, max, step, unit, label, hint }   a number with more detail
 *   "spring" | { type: "spring", stiffness: [min, max, step], ... }   cfg value { stiffness, damping, mass? }
 *   "easing"                                 cfg value [x1, y1, x2, y2]
 *   { type: "select", options: [...] }      cfg value one of the options
 *   "color"                                  cfg value a hex string (also inferred)
 *   { _label, _collapsed, ...children }      for a nested object in cfg: its section
 *   { ...keys }  (a key not in cfg)          a section grouping keys at the same level
 *   () => {}  |  { type: "action", run }     a button, e.g. Replay
 *   { type: "readout", get: () => value }   a live value shown in the panel
 *   false                                    hide that key
 *
 * options: { title, theme: "neutral" | "hendri" | ... | { ...vars }, scheme: "auto" | "light" | "dark",
 *            fps: false, compare: true, width: 340, collapsed: false, onChange({ path, value, values }) }
 */
export function tune(cfg, schema = {}, options = {}) {
  if (typeof document === "undefined") return null;
  if (!isPlain(cfg)) throw new TypeError("tune-panel: tune(cfg) needs the plain object your page reads.");
  const old = document.querySelector(TAG);
  if (old) {
    console.warn("tune-panel: one panel per page; replacing the previous one. Nest objects in one config for more sections.");
    old.remove();
  }
  const el = document.createElement(TAG);
  el.mount(cfg, schema, options);
  document.documentElement.append(el);
  return el;
}

tune.themes = THEMES;
tune.version = VERSION;
export { THEMES as themes };
export default tune;
