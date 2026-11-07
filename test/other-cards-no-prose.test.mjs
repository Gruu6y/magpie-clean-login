// The "other subscription providers" region is a list, not an essay. A card
// there is a name, an origin tag, the methods it declares, one source line and
// the buttons. Two families used to break that with three near-copy paragraphs:
//
//   plugin-only  description + notice + capability reason, each restating that
//                the provider came from an installed plugin and that magpie's
//                own list omits it — while the 第三方插件 tag, the method chips
//                and the 名单来源 line already said exactly those three things.
//   catalog      the same shape for "the plugin that signs into it is not
//                installed", under a 未安装 tag, with the source line even
//                claiming 已安装插件.
//
// The rule now: neither family prints prose. The tag states the origin, the
// chips state the methods, the source line states the layer, and the source
// line names the market (not the plugin scan) for a catalog card. These guards
// read the shipped source as text and also build real cards through the merge.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listProviders } from "../lib/provider-registry.mjs";
import { mergeProviderSources } from "../lib/provider-sources.mjs";
import { localizedText } from "../ui/provider-state.js";

const root = join(import.meta.dir, "..");
const sources = readFileSync(join(root, "lib", "provider-sources.mjs"), "utf8").replaceAll("\r\n", "\n");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const report = readFileSync(join(root, "lib", "issue-report.mjs"), "utf8").replaceAll("\r\n", "\n");
const style = readFileSync(join(root, "ui", "style.css"), "utf8").replaceAll("\r\n", "\n");
const LOCAL = listProviders();
const LANGS = ["en", "zh-Hans", "zh-Hant", "ja"];

function pluginOnlyCard(methods) {
  const view = mergeProviderSources({
    local: LOCAL,
    magpie: ["codex"],
    plugins: { available: true, providers: [{ id: "demo-plugin", package: "@example/demo-plugin", methods }] },
  });
  return view.providers.find((provider) => provider.presence === "plugin-only");
}

function catalogCard() {
  const view = mergeProviderSources({
    local: [],
    magpie: { ok: true, value: [] },
    plugins: { available: true, providers: [] },
    catalog: { available: true, providers: [{ id: "solo", name: "Solo", package: "@example/solo" }] },
  });
  return view.providers.find((provider) => provider.presence === "catalog");
}

function expectNoProse(card) {
  expect(card.description).toEqual({});
  expect(card.notice).toBeNull();
  expect(card.presenceNote).toBeNull();
  expect(card.capability.reason).toEqual({});
  for (const lang of LANGS) {
    expect(localizedText(card.description, lang)).toBe("");
    expect(localizedText(card.capability.reason, lang)).toBe("");
    expect(localizedText(card.notice, lang)).toBe("");
    expect(localizedText(card.presenceNote, lang)).toBe("");
  }
}

const SHAPES = [
  { name: "a browser method", methods: [{ type: "oauth", label: "Browser sign-in", browser: true, category: "browser", runnable: true }] },
  { name: "an open-ended method", methods: [{ type: "oauth", label: "Open-ended sign-in", browser: false, category: "pending", runnable: true }] },
  { name: "no classifiable method", methods: [{ type: "api", label: "API key", browser: false, category: "key", runnable: false }] },
];

// --- 1. the boilerplate constants are gone, not merely unused --------------

test("the plugin-only and catalog prose constants no longer exist", () => {
  expect(sources).not.toContain("const PLUGIN_ONLY_DESCRIPTION");
  expect(sources).not.toContain("const PLUGIN_ONLY_METHOD_REASON");
  expect(sources).not.toContain("const PLUGIN_ONLY_UNKNOWN");
  expect(sources).not.toContain("const PLUGIN_ONLY = Object.freeze({");
  expect(sources).not.toContain("const CATALOG_ONLY");
});

// --- 2. real cards print no prose, in every language ----------------------

for (const shape of SHAPES) {
  test(`a plugin-only card (${shape.name}) carries no prose`, () => {
    const card = pluginOnlyCard(shape.methods);
    expect(card).toBeTruthy();
    expectNoProse(card);
    // The methods the plugin declared still reach the card: silence about the
    // list must not cost the one thing the card is for.
    expect(card.authMethods.length).toBeGreaterThan(0);
    expect(card.authMethods[0].label).toBe(shape.methods[0].label);
  });
}

test("a catalog card carries no prose", () => {
  const card = catalogCard();
  expect(card).toBeTruthy();
  expectNoProse(card);
  // No methods, so the card cannot offer a sign-in entry either.
  expect(card.authMethods).toEqual([]);
  expect(card.signInProvider).toBeNull();
});

// --- 3. the origin still reaches the user, from the tag and source line ----

test("a catalog card names the market as its source, not the plugin scan", () => {
  const card = catalogCard();
  expect(card.sources).toEqual({ local: false, magpie: false, market: true });
  expect(app).toContain("if (provider.sources?.market) sourceNames.push(text.providerSourceMarket);");
  // The installed-plugin label must not fire for a market-only card: the tag
  // already says 未安装, and the two lines contradicted each other on screen.
  expect(app).toContain("if (provider.pluginPackage && provider.sources?.market !== true) {");
  for (const label of ["magpie market", "magpie 市场", "magpie 市場", "magpie のマーケット"]) {
    expect(app).toContain(label);
  }
  // The issue report names the same layer, so a filed report matches the card.
  expect(report).toContain('if (sources.market) names.push("magpie 市场");');
});

test("a plugin-only card is still sourced from the installed plugin", () => {
  const card = pluginOnlyCard(SHAPES[0].methods);
  expect(card.sources).toEqual({ local: false, magpie: false });
  expect(card.pluginPackage).toBe("@example/demo-plugin");
});

test("the other-providers grid lets a card end where its content ends", () => {
  // Without prose these cards are two or three lines tall; a stretched row
  // would draw a column of empty card under every button.
  expect(style).toContain(".providers-more .provider-grid { margin: 0 0 16px; align-items: start; }");
});

// --- 4. the cards that do need prose keep it -----------------------------

test("the card renderer drops a repeated line instead of showing it twice", () => {
  // A card appends reason, presence note and notice in order. When a presence
  // derives multiple slots from one copy block, the duplicate line must be
  // dropped so a card never prints the same sentence twice. This guard pins the
  // deduplicating Set in ui/app.js so future edits do not quietly revert it.
  expect(app).toContain("if (reason.textContent) card.append(reason);");
  expect(app).toContain("const shownLines = new Set([description.textContent, reason.textContent].filter(Boolean));");
  expect(app).toContain("if (presenceNode.textContent && !shownLines.has(presenceNode.textContent)) {");
  expect(app).toContain("shownLines.add(presenceNode.textContent);");
  expect(app).toContain("if (notice.textContent && !shownLines.has(notice.textContent)) card.append(notice);");
});

test("a local card keeps its own description and reason", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex"], plugins: { available: true, providers: [] } });
  const codex = view.providers.find((provider) => provider.id === "codex");
  expect(codex.presence).toBe("both");
  expect(Object.keys(codex.description).length).toBeGreaterThan(0);
});
