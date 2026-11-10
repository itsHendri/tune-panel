import { test } from "node:test";
import assert from "node:assert/strict";
import { snap, keyAction, inferStep, inferRange, parseBezier, springAt, settleTime, normalise, labelOf } from "../tune-panel.js";

const range = { min: 0, max: 20, step: 0.5 };

test("snap rounds to the step, a tenth with Shift, ten with Alt, and clamps", () => {
  assert.equal(snap(14.3, range), 14.5);
  assert.equal(snap(14.33, range, "fine"), 14.35);
  assert.equal(snap(13, range, "coarse"), 15);
  assert.equal(snap(99, range), 20);
  assert.equal(snap(0.1 + 0.2, { min: 0, max: 1, step: 0.1 }), 0.3);
});

test("keys step, page coarse, home and end", () => {
  assert.equal(keyAction("ArrowRight", 12, "normal", range), 12.5);
  assert.equal(keyAction("ArrowDown", 12, "fine", range), 11.95);
  assert.equal(keyAction("PageUp", 12, "normal", range), 17);
  assert.equal(keyAction("End", 12, "normal", range), 20);
  assert.equal(keyAction("a", 12, "normal", range), null);
});

test("ranges and steps inferred from a bare value", () => {
  assert.deepEqual(inferRange(0.35), { min: 0, max: 1 });
  assert.deepEqual(inferRange(420), { min: 0, max: 840 });
  assert.equal(inferStep(0, 1, 0.35), 0.01);
  assert.equal(inferStep(0, 840, 420), 10);
});

test("cubic-bezier parsing", () => {
  assert.deepEqual(parseBezier("cubic-bezier(.22, 1, .36, 1)"), [0.22, 1, 0.36, 1]);
  assert.deepEqual(parseBezier("ease-out"), [0, 0, 0.58, 1]);
  assert.deepEqual(parseBezier("[0.2, 0, 0, 1]"), [0.2, 0, 0, 1]);
  assert.equal(parseBezier([1.2, 0, 0, 1]), null);
  assert.equal(parseBezier("nope"), null);
});

test("spring heads for 1 and settles", () => {
  const s = { stiffness: 420, damping: 20, mass: 1 };
  assert.equal(springAt(s, 0), 0);
  assert.ok(Math.abs(springAt(s, 3) - 1) < 1e-3);
  const t = settleTime(s);
  assert.ok(t > 0.4 && t < 0.9, `settles in ${t}`);
  assert.ok(settleTime({ stiffness: 420, damping: 80, mass: 1 }) > 0); // overdamped
});

test("pasted values are checked against their control", () => {
  const num = { kind: "number", min: 0, max: 20, step: 0.5 };
  assert.deepEqual(normalise(num, 30), { ok: true, value: 20, clamped: true });
  assert.equal(normalise(num, "x").ok, false);
  const sel = { kind: "select", options: [{ value: "x" }, { value: "both" }] };
  assert.equal(normalise(sel, "both").value, "both");
  assert.equal(normalise(sel, "z").ok, false);
  assert.equal(normalise({ kind: "colour" }, "#ABCDEF").value, "#abcdef");
});

test("labels from keys", () => {
  assert.equal(labelOf("blurRadius"), "Blur radius");
  assert.equal(labelOf("tilt_max"), "Tilt max");
});
