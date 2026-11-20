// The embed gate (clickjacking mitigation) and a few small UI fixes that live
// in the wiring rather than a helper. Read-file style like providers-ui tests.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { embedAllowed } from "../ui/embed-gate.js";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");

test("magpie's opaque sandbox frame is allowed", () => {
  // Desktop: the launcher's sandboxed document navigates the same iframe to
  // the service page. Both opaque, parent reports "null" on Chromium.
  expect(
    embedAllowed({ top: {}, self: {}, origin: "null", ancestorOrigins: ["null"] }),
  ).toBe(true);
  // A host with no ancestor chain reporting (WebKit) still passes on the two
  // facts it can prove: framed and opaque.
  expect(embedAllowed({ top: {}, self: {}, origin: "null" })).toBe(true);
});

test("a direct top-level open is refused", () => {
  const win = {};
  win.top = win;
  expect(embedAllowed({ top: win, self: win, origin: "null" })).toBe(false);
  expect(embedAllowed({ top: win, self: win, origin: "http://127.0.0.1:3492" })).toBe(false);
});

test("a readable foreign iframe is refused", () => {
  // Without the sandbox the embedded document keeps its own origin, and the
  // parent could read the token straight out of the DOM.
  expect(
    embedAllowed({
      top: {},
      self: {},
      origin: "http://127.0.0.1:3492",
      ancestorOrigins: ["https://evil.test"],
    }),
  ).toBe(false);
});

test("a foreign http(s) parent is refused on Chromium", () => {
  // location.ancestorOrigins is readable even from an opaque document, so a
  // sandboxed evil iframe is caught where the Origin gate cannot help.
  expect(
    embedAllowed({ top: {}, self: {}, origin: "null", ancestorOrigins: ["https://evil.test"] }),
  ).toBe(false);
  // Non-http(s) ancestors (the shell's own scheme) stay allowed.
  expect(
    embedAllowed({ top: {}, self: {}, origin: "null", ancestorOrigins: ["null", "wails://wails"] }),
  ).toBe(true);
});

test("the gate runs before the app boots and hides the shell", () => {
  expect(app).toContain('import { embedAllowed } from "./embed-gate.js"');
  expect(app).toContain("embedAllowed({");
  expect(app).toContain('document.getElementById("embed-denied")');
  expect(html).toContain('id="embed-denied"');
});

test("the environment progress strip clears outside the preparing phase", () => {
  // A finished or cancelled job used to leave its last "96% · ..." line in
  // the hidden strip, repainted the moment the next prepare began.
  const block = /byId\("environment-progress-bar"\)\.style\.width = `\$\{preparing \? percent : 0\}%`;[\s\S]*?byId\("environment-progress-text"\)\.textContent = preparing[\s\S]*?: "";/.exec(
    app,
  );
  expect(block).not.toBeNull();
});

test("serverErrorText consults the localized key maps before the raw pair", () => {
  const fn = /function serverErrorText\(error\) \{[\s\S]*?\n\}/.exec(app)?.[0] || "";
  expect(fn).toContain("checkErrorKeys[code]");
  expect(fn).toContain("errorKeys[code]");
  // `not_found` is domain-dependent (proxy vs account), so it stays raw.
  expect(fn).toContain('code !== "not_found"');
  // The generic table wins on overlap: "the request failed" is truthful
  // anywhere, while the check dialog's "this check" is not.
  expect(fn.indexOf("errorKeys[code]")).toBeLessThan(fn.indexOf("checkErrorKeys[code]"));
});

test("the proxy form clears its error as the user types and saves on Enter", () => {
  const input = /byId\("proxy-form"\)\.addEventListener\("input",[\s\S]*?\n\}\);/.exec(app)?.[0] || "";
  expect(input).toContain('setFormError("")');
  const keydown = /byId\("proxy-form"\)\.addEventListener\("keydown",[\s\S]*?\n\}\);/.exec(app)?.[0] || "";
  expect(keydown).toContain('event.key !== "Enter"');
  expect(keydown).toContain("saveProxy()");
});

test("the tabs scroll sideways instead of wrapping on a phone", () => {
  const tabs = /\.tabs \{[\s\S]*?\}/.exec(css)?.[0] || "";
  expect(tabs).toContain("flex-wrap: nowrap");
  expect(tabs).toContain("overflow-x: auto");
  const tab = /\.tab \{[\s\S]*?\}/.exec(css)?.[0] || "";
  expect(tab).toContain("white-space: nowrap");
});
