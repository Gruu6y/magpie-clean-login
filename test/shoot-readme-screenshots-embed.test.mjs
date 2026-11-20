// ui/embed-gate.js refuses a top-level load: the shipped page only renders
// framed, opaque-origin, and under an ancestor it trusts. The screenshot
// generator must therefore mount the app the way magpie does -- a sandboxed
// iframe under a trusted ancestor -- not page.goto straight at the app. These
// are source assertions in the spirit of test/readme-languages.test.mjs: a
// live render needs a real Chrome and is verified by running the script.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "..", "scripts", "shoot-readme-screenshots.mjs"),
  "utf8",
).replaceAll("\r\n", "\n");

test("the generator never navigates a page straight at the app", () => {
  // page.goto(`${base}/?theme=...) is exactly what the embed gate denies.
  expect(source).not.toMatch(/page\.goto\(`\$\{base\}\/\?/);
  // The parent document it does goto must be same-origin with the app --
  // embed-gate trusts an ancestor whose origin is the page's own
  // location.origin (the "magpie web" mount), and a foreign http(s) parent
  // either trips the gate or Chromium's Private Network Access block on loopback.
  expect(source).toContain("page.goto(`${base}/");
});

test("the generator mounts the app in an opaque-origin sandboxed iframe", () => {
  // allow-scripts but never allow-same-origin: the frame must stay an opaque
  // origin or embed-gate reads a readable foreign frame and denies it.
  expect(source).toContain('frame.setAttribute("sandbox", "allow-scripts")');
  // ...and the attribute must not grow allow-same-origin alongside it.
  expect(source).not.toContain('sandbox", "allow-scripts allow-same-origin');
  expect(source).toContain("contentFrame()");
});

test("the generator drives the app through the frame, not the page", () => {
  expect(source).toContain('app.click(`#tab-${tab}`)');
  expect(source).toContain("app.evaluate(");
  // A denied embed must fail loudly, not time out on the first tab click.
  expect(source).toContain("#embed-denied");
  expect(source).toContain("denied the README screenshot embed");
});
