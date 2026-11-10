// Pure normalization and merge tests. No network and no magpie runtime: the
// real payload shape of `providers:list` has NOT been verified on this machine,
// so these tests pin down the tolerant behavior the code claims instead.

import { expect, test } from "bun:test";
import { listProviders, publicProvider } from "../lib/provider-registry.mjs";
import { providerCanSignIn, signInDoor } from "../ui/provider-state.js";
import {
  MAGPIE_PROVIDERS_READ,
  PROVIDER_PRESENCES,
  mergeProviderSources,
  normalizeMagpieProviders,
} from "../lib/provider-sources.mjs";

const LOCAL = listProviders();

function ids(items) {
  return items.map((item) => item.id);
}

test("the read name is the one magpie declares", () => {
  expect(MAGPIE_PROVIDERS_READ).toBe("providers:list");
});

// Regression test for a real defect: the local registry used to call Google
// Antigravity `google-antigravity` while magpie's own id is `antigravity`, so
// the merge reported a provider magpie really has as "not in magpie". Feeding
// magpie's actual id list now has to land every local provider in `both`.
// The list below is magpie's own `providers.json` id set at the time of
// writing; a future rename upstream will fail this test on purpose.
test("every local provider id lines up with magpie's own ids", () => {
  const magpieIds = [
    "workbuddy",
    "cursor",
    "antigravity",
    "codex",
    "zcode",
    "grok",
    "mimo-app",
    "llama-local",
    "devin",
    "yeta",
    "minimax-code",
    "workbuddy-ai",
    "qoder",
    "qoder-cn",
    "loomy",
  ];
  const view = mergeProviderSources({ local: LOCAL, magpie: magpieIds });
  const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
  expect(byId.antigravity.presence).toBe("both");
  expect(byId.codex.presence).toBe("both");
  // Claude is not one of magpie's provider ids (magpie signs in to Claude by
  // importing a token through POST /api/signin/claude-token), so it stays
  // local-only and the card says so.
  expect(byId.claude.presence).toBe("local-only");
  // The registry's notice has to survive the merge: it is the line that keeps a
  // sign-in this plugin should not run yet from looking like a normal one.
  expect(byId.codex.notice["zh-Hans"]).toContain("沙箱服务");
  expect(byId.claude.notice["zh-Hans"]).toContain("沙箱服务");
  expect(byId.antigravity.notice["zh-Hans"]).toContain("神仙来了也得封");
});

test("normalization accepts a bare string array", () => {
  const read = normalizeMagpieProviders(["antigravity", "codex"]);
  expect(read.available).toBe(true);
  expect(ids(read.items)).toEqual(["antigravity", "codex"]);
});

test("normalization accepts an array of { id, name } objects", () => {
  const read = normalizeMagpieProviders([
    { id: "codex", name: "Codex" },
    { id: "claude", name: "Claude" },
  ]);
  expect(read.available).toBe(true);
  expect(read.items).toEqual([
    { id: "codex", name: "Codex" },
    { id: "claude", name: "Claude" },
  ]);
});

test("normalization accepts a { providers: [...] } wrapper", () => {
  const read = normalizeMagpieProviders({ providers: [{ name: "Google Antigravity" }] });
  expect(read.available).toBe(true);
  // An entry carrying only a display name keys on the slug of that name, which
  // is NOT our registry id. That is why mergeProviderSources matches on both
  // the id and the name slug instead of comparing ids alone.
  expect(read.items).toEqual([{ id: "google-antigravity", name: "Google Antigravity" }]);
});

test("a name-only magpie entry still lines up with our registry id", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: [{ name: "Google Antigravity" }] });
  const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
  expect(byId.antigravity.presence).toBe("both");
  // It matched, so it must not also appear a second time as a magpie-only card.
  expect(view.counts.both).toBe(1);
  expect(view.counts.magpieOnly).toBe(0);
  expect(view.counts.total).toBe(LOCAL.length);
});

test("normalization accepts a single string or object", () => {
  expect(normalizeMagpieProviders("codex")).toEqual({
    available: true,
    items: [{ id: "codex", name: "codex" }],
  });
  expect(normalizeMagpieProviders({ id: "codex", name: "Codex" })).toEqual({
    available: true,
    items: [{ id: "codex", name: "Codex" }],
  });
});

test("normalization deduplicates by id", () => {
  const read = normalizeMagpieProviders(["codex", { id: "codex", name: "Codex again" }]);
  expect(read.items).toEqual([{ id: "codex", name: "codex" }]);
});

test("normalization treats null, undefined and junk as unavailable", () => {
  for (const value of [null, undefined, 42, true, {}, { nope: [] }]) {
    expect(normalizeMagpieProviders(value).available).toBe(false);
    expect(normalizeMagpieProviders(value).items).toEqual([]);
  }
});

test("normalization understands the boot envelope", () => {
  expect(normalizeMagpieProviders({ v: 1, ok: false }).available).toBe(false);
  expect(normalizeMagpieProviders({ v: 1, ok: true, value: [] }).available).toBe(true);
  expect(normalizeMagpieProviders({ v: 1, ok: true, value: null }).available).toBe(false);
  expect(normalizeMagpieProviders({ v: 1, ok: true, value: ["codex"] }).items).toEqual([
    { id: "codex", name: "codex" },
  ]);
});

test("an empty magpie list still counts as derived from magpie", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: [] });
  expect(view.source).toBe("magpie");
  expect(view.magpie).toEqual({ available: true, count: 0 });
  expect(view.counts.total).toBe(LOCAL.length);
  expect(view.counts.both).toBe(0);
  expect(view.counts.localOnly).toBe(LOCAL.length);
  expect(view.counts.magpieOnly).toBe(0);
});

test("case a: a provider in both sources is normal and carries the local sign-in mode", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["antigravity", "codex", "claude"] });
  expect(view.source).toBe("magpie");
  expect(view.counts).toEqual({ total: 3, both: 3, localOnly: 0, magpieOnly: 0, pluginOnly: 0, catalogOnly: 0 });
  for (const provider of view.providers) {
    expect(provider.presence).toBe("both");
    expect(provider.presenceNote).toBeNull();
    expect(provider.sources).toEqual({ local: true, magpie: true });
    // The sign-in mechanism is always the local declaration.
    const local = LOCAL.find((item) => item.id === provider.id);
    expect(provider.signInMode).toBe(local.signInMode);
  }
});

test("case b: a magpie-only provider has a card, a door and no paragraph", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "mystery-ai"] });
  const card = view.providers.find((provider) => provider.id === "mystery-ai");
  expect(card).toBeTruthy();
  expect(card.presence).toBe("magpie-only");
  expect(card.sources).toEqual({ local: false, magpie: true });
  expect(card.capability.state).toBe("pending");
  // The card always carries a door: with no installed plugin covering it, that
  // door is magpie's own command line. So it prints no paragraph claiming it
  // has none — and no note repeating that claim.
  expect(card.nativeSignIn).toBe(true);
  expect(card.description).toEqual({});
  expect(card.capability.reason).toEqual({});
  expect(card.notice).toBeNull();
  expect(card.presenceNote).toBeNull();
  // It carries none of the local capabilities, so nothing can be promoted.
  expect(card.agentId).toBe("mystery-ai");
  expect(card.authHosts).toEqual([]);
  expect(card.callbackPort).toBeNull();
  expect(view.counts).toEqual({ total: 4, both: 1, localOnly: 2, magpieOnly: 1, pluginOnly: 0, catalogOnly: 0 });
});

test("case c: a local provider magpie omits is annotated, not removed", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex"] });
  const card = view.providers.find((provider) => provider.id === "claude");
  expect(card.presence).toBe("local-only");
  expect(card.sources).toEqual({ local: true, magpie: false });
  // One line, and it is the registry's own reminder: the card sits in the
  // other-providers list, where the tag and the source line already say where
  // it came from, so the description and the "magpie does not list it" note
  // were two more paragraphs around one sentence.
  expect(card.description).toEqual({});
  expect(card.presenceNote).toBeNull();
  for (const lang of ["en", "zh-Hans", "zh-Hant", "ja"]) {
    expect(card.notice[lang]).toBeTruthy();
  }
  expect(card.notice["zh-Hans"]).toContain("暂时不建议使用本插件登录");
  expect(view.counts).toEqual({ total: 3, both: 1, localOnly: 2, magpieOnly: 0, pluginOnly: 0, catalogOnly: 0 });
});

test("an unavailable magpie list degrades to the local registry without false claims", () => {
  for (const magpie of [undefined, null, { v: 1, ok: false }, 42]) {
    const view = mergeProviderSources({ local: LOCAL, magpie });
    expect(view.source).toBe("local");
    expect(view.magpie.available).toBe(false);
    expect(view.counts).toEqual({ total: LOCAL.length, both: 0, localOnly: 0, magpieOnly: 0, pluginOnly: 0, catalogOnly: 0 });
    for (const provider of view.providers) {
      expect(provider.presence).toBe("local-unknown");
      // We must not claim magpie lacks a provider when we never read the list.
      expect(provider.presenceNote).toBeNull();
    }
  }
});

test("an unreadable magpie list cannot take away a built-in provider's sign-in entry", () => {
  // Regression for the card that showed only "report a problem": the native
  // door was gated on `inMagpie`, so a failed `providers:list` handover removed
  // the only entry antigravity has. That door is `magpie accounts add <agent>`,
  // which never reads the list, so the entry has to survive the failed read.
  const view = mergeProviderSources({ local: LOCAL, magpie: undefined });
  const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
  expect(byId.antigravity.nativeSignIn).toBe(true);
  expect(providerCanSignIn(byId.antigravity)).toBe(true);
  expect(signInDoor(byId.antigravity)).toBe("native");
  expect(byId.codex.nativeSignIn).toBe(true);
  // A token-import provider is not a browser door: nothing is invented for it.
  expect(byId.claude.nativeSignIn).toBe(false);
  // The card still says honestly that magpie's list was never read.
  expect(byId.antigravity.presence).toBe("local-unknown");
  expect(byId.antigravity.presenceNote).toBeNull();
});

test("a magpie list that WAS read keeps the final say over the native door", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["workbuddy"] });
  const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
  expect(byId.antigravity.nativeSignIn).toBe(false);
  expect(providerCanSignIn(byId.antigravity)).toBe(false);
  expect(byId.antigravity.presence).toBe("local-only");
});

test("an installed plugin still wins over the native door when the list is unreadable", () => {
  const view = mergeProviderSources({
    local: LOCAL,
    magpie: undefined,
    plugins: {
      available: true,
      providers: [
        { id: "antigravity", package: "@x/antigravity", methods: [{ type: "oauth", label: "Antigravity (browser)", category: "browser", runnable: true }] },
      ],
    },
  });
  const card = view.providers.find((provider) => provider.id === "antigravity");
  expect(card.nativeSignIn).toBe(false);
  expect(signInDoor(card)).toBe("plugin");
});

test("signInProvider carries the installed plugin entry id the service loads", () => {
  const plugins = {
    available: true,
    providers: [
      { id: "workbuddy", package: "@x/workbuddy", methods: [{ type: "oauth", label: "WorkBuddy (browser)", category: "browser" }] },
      { id: "google-antigravity", package: "@x/antigravity", methods: [{ type: "oauth", label: "Antigravity (browser)", category: "browser" }] },
      { id: "kiro", package: "@x/kiro", methods: [{ type: "oauth", label: "Kiro (browser)", category: "browser" }] },
    ],
  };
  const view = mergeProviderSources({
    local: LOCAL,
    magpie: ["workbuddy", { name: "Google Antigravity" }],
    plugins,
  });
  const byId = Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));

  // magpie-only: the card id and the installed plugin entry id line up.
  expect(byId.workbuddy.presence).toBe("magpie-only");
  expect(byId.workbuddy.signInProvider).toBe("workbuddy");

  // Matched by the slug of the display name: the local card id is
  // `antigravity` while the installed plugin entry (and therefore the id the
  // service passes to defaultLoadProvider) is `google-antigravity`.
  expect(byId.antigravity.presence).toBe("both");
  expect(byId.antigravity.signInProvider).toBe("google-antigravity");

  // plugin-only: the card is the plugin entry itself.
  expect(byId.kiro.presence).toBe("plugin-only");
  expect(byId.kiro.signInProvider).toBe("kiro");

  // No matched plugin entry: nothing is fabricated.
  expect(byId.claude.pluginPackage).toBeNull();
  expect(byId.claude.signInProvider).toBeNull();
});

test("the merged projection stays public and leak-free", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "mystery-ai"] });
  expect(JSON.stringify(view)).not.toMatch(
    /client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key|password/i,
  );
  for (const provider of view.providers) {
    expect(PROVIDER_PRESENCES).toContain(provider.presence);
  }
  // The local projection used here is exactly the public one.
  expect(LOCAL).toEqual(listProviders());
  expect(LOCAL[0]).toEqual(publicProvider(LOCAL[0]));
});

// The catalogue layer is what makes "scan the user's magpie" true: the cards
// come from files on the user's machine, so a provider magpie adds later shows
// up without a release. What it must never do is offer a sign-in entry for a
// provider whose plugin is not installed.
test("catalogue providers magpie offers but nothing can sign into become catalog cards", () => {
  const merged = mergeProviderSources({
    local: LOCAL,
    magpie: { ok: true, value: ["Antigravity", "Codex"] },
    plugins: { available: true, providers: [{ id: "workbuddy-ai", name: "WorkBuddy AI", package: "@magpie-community/opencode-workbuddy-auth", methods: [{ kind: "browser" }] }] },
    catalog: {
      available: true,
      providers: [
        { id: "workbuddy-ai", name: "WorkBuddy AI", package: "@magpie-community/opencode-workbuddy-auth" },
        { id: "opencode-zen-free", name: "OpenCode Zen Free", package: "@magpie-community/opencode-zen-auth" },
      ],
    },
  });
  const catalogCards = merged.providers.filter((item) => item.presence === "catalog");
  expect(ids(catalogCards)).toEqual(["opencode-zen-free"]);
  expect(merged.counts.catalogOnly).toBe(1);
  // An already covered provider must not be listed twice.
  expect(ids(merged.providers).filter((id) => id === "workbuddy-ai")).toHaveLength(1);
});

test("a catalog card offers no sign-in entry and prints no paragraph about it", () => {
  const merged = mergeProviderSources({
    local: [],
    magpie: { ok: true, value: [] },
    plugins: { available: true, providers: [] },
    catalog: { available: true, providers: [{ id: "solo", name: "Solo", package: "pkg" }] },
  });
  const card = merged.providers[0];
  expect(card.presence).toBe("catalog");
  expect(card.signInProvider).toBeNull();
  expect(card.authMethods).toEqual([]);
  expect(card.browserMethod).toBe(false);
  expect(card.linkOnly).toBe(true);
  expect(card.pluginPackage).toBe("pkg");
  // The 未安装 tag and the market source line carry the whole story. A
  // paragraph repeating "the plugin is not installed" was three lines of noise
  // on a card whose only action is 报告问题.
  expect(card.description).toEqual({});
  expect(card.notice).toBeNull();
  expect(card.capability.reason).toEqual({});
  expect(card.sources).toEqual({ local: false, magpie: false, market: true });
});

test("an unavailable catalog adds nothing rather than an empty claim", () => {
  const merged = mergeProviderSources({
    local: LOCAL,
    magpie: { ok: true, value: [] },
    plugins: { available: true, providers: [] },
    catalog: { available: false, providers: [] },
  });
  expect(merged.providers.every((item) => item.presence !== "catalog")).toBe(true);
  expect(merged.counts.catalogOnly).toBe(0);
  expect(merged.catalog).toEqual({ available: false, count: 0 });
});
