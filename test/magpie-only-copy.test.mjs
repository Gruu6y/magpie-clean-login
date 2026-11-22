// A magpie-only card used to print three sentences that argued with each
// other: "magpie lists this provider, but this plugin has no browser sign-in
// flow for it" in the description, "an installed plugin DOES expose a browser
// sign-in method for it" as the reason, and "there is no add entry here" as
// the notice — on a card that carried a browser method and an add entry.
//
// The fix is to stop explaining: a magpie-only card always has a door (the
// installed plugin's method, or magpie's own `accounts add`), so it prints no
// prose at all. The single exception is a broken plugin scan, whose diagnostic
// is the one line the card is allowed to show, because staying silent there
// would hide a failure the user needs to act on.
//
// These guards read the shipped source as text and also build real cards
// through the merge, so both the copy and the renderer stay honest.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listProviders } from "../lib/provider-registry.mjs";
import { mergeProviderSources } from "../lib/provider-sources.mjs";
import { localizedText, providerCanSignIn } from "../ui/provider-state.js";

const root = join(import.meta.dir, "..");
const sources = readFileSync(join(root, "lib", "provider-sources.mjs"), "utf8").replaceAll("\r\n", "\n");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const LOCAL = listProviders();
const LANGS = ["en", "zh-Hans", "zh-Hant", "ja"];

function cardLines(card, lang) {
  return [
    localizedText(card.description, lang),
    localizedText(card.capability.reason, lang),
    localizedText(card.presenceNote, lang),
    localizedText(card.notice, lang),
  ].filter(Boolean);
}

function magpieOnlyCard(magpie, plugins, id) {
  const view = mergeProviderSources({ local: LOCAL, magpie, plugins });
  return view.providers.find((provider) => provider.id === id && provider.presence === "magpie-only");
}

// --- 1. the static copy that contradicted the card is gone ---------------

test("the magpie-only static copy and the no-browser-method sentence are removed", () => {
  expect(sources).not.toContain("const MAGPIE_ONLY = Object.freeze({");
  expect(sources).not.toContain("const NO_BROWSER_METHOD = Object.freeze({");
  expect(sources).not.toContain("This plugin has no browser sign-in flow for it");
  expect(sources).not.toContain("no browser sign-in flow for it, so there is no add entry");
});

test("a magpie-only card is built with empty prose slots", () => {
  expect(sources).toContain("const reason = scanFailure ? { ...scanFailure } : {};");
  // The old three-way duplication is gone; the only prose left is the
  // scan failure diagnostic itself, never a copy of it in a second slot.
  expect(sources).not.toContain("presenceNote = pluginAvailable ? null : { ...reason }");
});

// --- 2. the renderer does not append an empty paragraph -------------------

test("the renderer skips a card's empty description", () => {
  expect(app).toContain("if (description.textContent) card.append(description);");
  expect(app).toContain("if (reason.textContent) card.append(reason);");
  expect(app).not.toContain("card.append(head, description);");
});

// --- 3. real cards: no prose, in every language, whatever the scan found ---

test("a magpie-only card whose plugin exposes a browser method prints no prose", () => {
  const card = magpieOnlyCard(["demo-ai"], {
    available: true,
    providers: [
      {
        id: "demo-ai",
        package: "@example/demo-ai-auth",
        methods: [{ type: "oauth", label: "Demo (browser)", browser: true, category: "browser", runnable: true }],
      },
    ],
  }, "demo-ai");
  expect(card).toBeTruthy();
  expect(card.browserMethod).toBe(true);
  expect(card.signInProvider).toBe("demo-ai");
  // The door is the plugin's own method, not magpie's command line.
  expect(card.nativeSignIn).toBe(false);
  expect(providerCanSignIn(card)).toBe(true);
  // The method is still listed; it is the prose that is gone.
  expect(card.authMethods.length).toBeGreaterThan(0);
  for (const lang of LANGS) expect(cardLines(card, lang)).toEqual([]);
});

test("a magpie-only card no plugin covers prints no prose and offers magpie's door only for built-in agents", () => {
  const builtin = magpieOnlyCard(["gemini"], { available: true, providers: [] }, "gemini");
  expect(builtin).toBeTruthy();
  expect(builtin.browserMethod).toBe(false);
  expect(builtin.signInProvider).toBeNull();
  expect(builtin.nativeSignIn).toBe(true);
  expect(providerCanSignIn(builtin)).toBe(true);
  for (const lang of LANGS) expect(cardLines(builtin, lang)).toEqual([]);

  const custom = magpieOnlyCard(["mystery-ai"], { available: true, providers: [] }, "mystery-ai");
  expect(custom).toBeTruthy();
  expect(custom.browserMethod).toBe(false);
  expect(custom.signInProvider).toBeNull();
  expect(custom.nativeSignIn).toBe(false);
  expect(providerCanSignIn(custom)).toBe(false);
  for (const lang of LANGS) expect(cardLines(custom, lang)).toEqual([]);
});

test("a scan that never ran prints no prose and claims no failure", () => {
  const builtin = magpieOnlyCard(["gemini"], { available: false, providers: [] }, "gemini");
  expect(builtin).toBeTruthy();
  expect(builtin.nativeSignIn).toBe(true);
  expect(providerCanSignIn(builtin)).toBe(true);
  for (const lang of LANGS) expect(cardLines(builtin, lang)).toEqual([]);

  const custom = magpieOnlyCard(["mystery-ai"], { available: false, providers: [] }, "mystery-ai");
  expect(custom).toBeTruthy();
  expect(custom.nativeSignIn).toBe(false);
  expect(providerCanSignIn(custom)).toBe(false);
  for (const lang of LANGS) expect(cardLines(custom, lang)).toEqual([]);
});

// --- 4. the one line a magpie-only card may print: a broken scan ----------

test("a failed plugin scan is the single line on a magpie-only card, in every language", () => {
  const scanFailure = {
    available: false,
    providers: [],
    error: "dirent is not defined",
    scanned: true,
  };
  const builtin = magpieOnlyCard(["gemini"], scanFailure, "gemini");
  expect(builtin).toBeTruthy();
  expect(builtin.nativeSignIn).toBe(true);
  expect(providerCanSignIn(builtin)).toBe(true);

  const custom = magpieOnlyCard(["mystery-ai"], scanFailure, "mystery-ai");
  expect(custom).toBeTruthy();
  expect(custom.nativeSignIn).toBe(false);
  expect(providerCanSignIn(custom)).toBe(false);

  for (const card of [builtin, custom]) {
    for (const lang of LANGS) {
      const lines = cardLines(card, lang);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("dirent is not defined");
      expect(lines[0]).not.toMatch(/not verified|unverified/i);
    }
    expect(card.capability.reason.en).toContain("The installed-plugin scan failed");
  }
});
