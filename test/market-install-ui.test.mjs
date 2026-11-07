// A market card used to be the one dead end on the page: it said "not
// installed" and offered nothing but a report button. It now installs the
// package magpie's own market lists, through the local service, because the
// page cannot (magpie's API answers magpie's window only, and the sandbox
// carries `connect-src 'none'`).
//
// Read-file style, like the other UI guards: what is pinned here is the wiring
// that a re-render or a copy edit silently breaks — the gate that decides which
// card gets the button, the sandbox-safe control, the four languages, and the
// fact that the page never talks to anything but its own service.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const style = readFileSync(join(root, "ui", "style.css"), "utf8").replaceAll("\r\n", "\n");

test("only a market card with a package gets the install control", () => {
  const gate = app.slice(app.indexOf("function marketInstallPackage(provider)"));
  expect(gate).toContain('provider.presence === "catalog"');
  expect(gate).toContain("provider.pluginPackage");
  // The card builder asks that helper; it never guesses from the name or the
  // source line, which is how the 未安装/已安装插件 contradiction happened.
  expect(app).toContain("const installPackage = marketInstallPackage(provider);");
  expect(app).toContain("if (installPackage) {");
});

test("the install control is a sandbox-safe button with a live lookup key", () => {
  const block = app.slice(app.indexOf("  const installPackage = marketInstallPackage(provider);"));
  expect(block).toContain('install.type = "button"');
  expect(block).toContain('install.className = "button primary provider-install"');
  // The package the card was built from is the package the click installs.
  expect(block).toContain("install.dataset.pluginPackage = installPackage;");
  expect(block).toContain("runMarketInstall(installPackage)");
  // Cards are rebuilt on every merge, so the button is found by its package
  // name instead of a captured node a re-render would have detached.
  const lookup = app.slice(app.indexOf("function marketInstallControls(pkg)"));
  expect(lookup).toContain('document.querySelectorAll(".provider-install")');
  expect(lookup).toContain("button.dataset.pluginPackage !== pkg");
});

test("the page installs nothing itself and never waits on the child", () => {
  // Everything the install does goes through the local service.
  expect(app).toContain('api("api/market/install", { method: "POST", body: { package: pkg } })');
  expect(app).toContain('const data = await api("api/market/install");');
  // No magpie API call, no window.open, no form: the bridge cannot install and
  // the sandbox would drop the rest.
  const installSection = app.slice(
    app.indexOf("// --- installing a plugin magpie's market lists"),
    app.indexOf("// --- reporting a card"),
  );
  expect(installSection).not.toContain("window.open");
  expect(installSection).not.toContain("magpie.service");
  expect(installSection).not.toContain("fetch(");
  // Waiting is bounded by a timer the page owns, not by a hung request.
  expect(installSection).toContain("window.setTimeout");
  expect(installSection).toContain("MARKET_INSTALL_WAIT_MS");
});

test("a finished install forces a fresh plugin scan", () => {
  const refresh = app.slice(app.indexOf("async function refreshAfterMarketInstall()"));
  // The scan cache is allowed to be a minute old; a click must not wait it out.
  expect(refresh).toContain("refresh: true");
  expect(refresh).toContain("api(\"api/provider-sources\"");
  // The scan usually answers while running, so the existing bounded follow-up
  // is reused rather than a second polling loop invented here.
  expect(refresh).toContain("startPluginScanPolling();");
});

test("every language carries the install wording", () => {
  for (const key of [
    "installPlugin",
    "installingPlugin",
    "installPluginFailed",
    "installPluginTimeout",
  ]) {
    const hits = app.split(`    ${key}: "`).length - 1;
    expect(hits, key).toBe(4);
  }
});

test("the install button and its note have their own styles", () => {
  // Same flex contract as 添加账号, or a card with both buttons lays them out
  // differently for no reason.
  expect(style).toContain(".provider-install { flex: 1 1 auto; }");
  expect(style).toContain(".provider-install-note {");
  // A failure is a warning, not an error red: nothing was lost.
  expect(style.slice(style.indexOf(".provider-install-note {"))).toContain("var(--amber)");
});
