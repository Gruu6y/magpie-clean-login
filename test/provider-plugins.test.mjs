// Three-source merge tests: local registry + magpie's list + the installed
// plugin scan. The plugin scan is always injected here; no provider plugin is
// imported and no child process is spawned.

import { expect, test } from "bun:test";
import { listProviders } from "../lib/provider-registry.mjs";
import { PROVIDER_PRESENCES, mergeProviderSources } from "../lib/provider-sources.mjs";
import { providerCanSignIn } from "../ui/provider-state.js";

const LOCAL = listProviders();
const LANGS = ["en", "zh-Hans", "zh-Hant", "ja"];

const PLUGINS = {
  available: true,
  providers: [
    {
      id: "codex",
      package: "@magpie-community/opencode-codex-auth",
      methods: [
        { type: "oauth", label: "Codex (browser)", browser: true, category: "browser", runnable: true },
        { type: "oauth", label: "codex's sign-in", browser: false, category: "local", runnable: true },
        { type: "api", label: "Codex API key", browser: false, category: "key", runnable: false },
      ],
    },
    {
      id: "cursor",
      package: "@magpie-community/opencode-cursor-auth",
      methods: [
        { type: "oauth", label: "Cursor (browser)", browser: true, category: "browser", runnable: true },
        { type: "oauth", label: "cursor-agent's sign-in", browser: false, category: "local", runnable: true },
      ],
    },
    {
      // No browser method at all: local session / key only.
      id: "antigravity",
      package: null,
      methods: [{ type: "api", label: "Antigravity key", browser: false, category: "key", runnable: false }],
    },
  ],
};

function byId(view) {
  return Object.fromEntries(view.providers.map((provider) => [provider.id, provider]));
}

test("the four presences and their counts survive a third source", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "cursor", "mystery-ai"], plugins: PLUGINS });
  expect(view.source).toBe("magpie");
  expect(view.magpie).toEqual({ available: true, count: 3 });
  expect(view.counts).toEqual({ total: 5, both: 1, localOnly: 2, magpieOnly: 2, pluginOnly: 0, catalogOnly: 0 });
  const map = byId(view);
  expect(map.antigravity.presence).toBe("local-only");
  expect(map.codex.presence).toBe("both");
  expect(map.claude.presence).toBe("local-only");
  expect(map.cursor.presence).toBe("magpie-only");
  expect(map["mystery-ai"].presence).toBe("magpie-only");
  for (const provider of view.providers) {
    expect(PROVIDER_PRESENCES).toContain(provider.presence);
    // The original `sources` shape is unchanged: the plugin layer is a
    // separate annotation, not a fourth presence.
    expect(provider.sources).toEqual({ local: Boolean(provider.sources.local), magpie: Boolean(provider.sources.magpie) });
  }
  expect(view.plugins).toEqual({ available: true, count: 3, browserMethods: 2, matched: 3 });
});

test("each card carries the derived methods and the browserMethod flag", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "cursor", "mystery-ai"], plugins: PLUGINS });
  const map = byId(view);
  expect(map.codex.browserMethod).toBe(true);
  expect(map.codex.authMethods).toEqual([
    { type: "oauth", label: "Codex (browser)", browser: true, category: "browser", prompts: [], runnable: true, fields: [] },
    { type: "oauth", label: "codex's sign-in", browser: false, category: "local", prompts: [], runnable: true, fields: [] },
    { type: "api", label: "Codex API key", browser: false, category: "key", prompts: [], runnable: false, fields: [] },
  ]);
  expect(map.codex.pluginPackage).toBe("@magpie-community/opencode-codex-auth");
  expect(map.antigravity.browserMethod).toBe(false);
  expect(map.antigravity.authMethods).toHaveLength(1);
  expect(map.cursor.browserMethod).toBe(true);
  // A provider with no plugin entry still gets an empty, typed annotation.
  expect(map.claude.authMethods).toEqual([]);
  expect(map.claude.browserMethod).toBe(false);
  expect(map.claude.pluginPackage).toBeNull();
  expect(map["mystery-ai"].authMethods).toEqual([]);
  expect(map["mystery-ai"].browserMethod).toBe(false);
});

test("a provider is matched by id or by the slug of its display name", () => {
  const plugins = {
    available: true,
    providers: [
      {
        id: "google-antigravity",
        package: "@magpie-community/opencode-antigravity-auth",
        methods: [{ type: "oauth", label: "Google Antigravity (browser)", browser: true }],
      },
    ],
  };
  const view = mergeProviderSources({ local: LOCAL, magpie: [], plugins });
  const card = byId(view).antigravity;
  expect(card.browserMethod).toBe(true);
  expect(card.pluginPackage).toBe("@magpie-community/opencode-antigravity-auth");
  // The card id is `antigravity`; the id the service loads the plugin by is the
  // installed entry's id, carried separately as `signInProvider`.
  expect(card.signInProvider).toBe("google-antigravity");
});

// The whole point of this step: a recognized browser method plus the installed
// plugin entry id is the sign-in gate, and capability readiness is not.
test("a recognized browser method creates the sign-in gate regardless of readiness", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "cursor"], plugins: PLUGINS });
  const map = byId(view);
  expect(providerCanSignIn(map.codex)).toBe(true);
  expect(providerCanSignIn(map.cursor)).toBe(true);
  // A key/local-session provider has no browser flow to drive.
  expect(providerCanSignIn(map.antigravity)).toBe(false);
  // A provider with no matched plugin entry has no id to load.
  expect(providerCanSignIn(map.claude)).toBe(false);
  // Readiness is not the gate: forcing one ready changes nothing.
  const forcedReady = { ...map.antigravity, capability: { ...map.antigravity.capability, state: "ready" } };
  expect(providerCanSignIn(forcedReady)).toBe(false);
  expect(JSON.stringify(view)).not.toMatch(/Add Account/);
});

test("the presences are worded apart in all four languages", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "cursor", "gemini", "mystery-ai"], plugins: PLUGINS });
  const map = byId(view);

  // (a) A card whose plugin layer found a browser method says so and invites a
  // try; it never claims the flow is unverified, because the plugin can never
  // learn the outcome of an attempt.
  const found = map.codex;
  expect(found.browserMethod).toBe(true);
  expect(found.capability.state).toBe("pending");
  expect(found.capability.reason.en).toContain("browser sign-in method");
  expect(found.capability.reason.en).toContain("try it directly");
  expect(found.capability.reason.en).not.toMatch(/not verified|unverified/i);
  for (const lang of LANGS) expect(found.capability.reason[lang]).toBeTruthy();

  // (b) A magpie-only card prints no paragraph, whichever way the scan went.
  // Built-in CLI agents without a plugin keep magpie's native door; custom
  // providers without a plugin do not get a dead native door.
  for (const provider of [map.cursor, map.gemini, map["mystery-ai"]]) {
    expect(provider.presence).toBe("magpie-only");
    expect(provider.description).toEqual({});
    expect(provider.capability.reason).toEqual({});
    expect(provider.notice).toBeNull();
    expect(provider.presenceNote).toBeNull();
  }
  expect(map.cursor.browserMethod).toBe(true);
  expect(providerCanSignIn(map.cursor)).toBe(true);
  expect(map.gemini.browserMethod).toBe(false);
  expect(map.gemini.nativeSignIn).toBe(true);
  expect(providerCanSignIn(map.gemini)).toBe(true);
  expect(map["mystery-ai"].browserMethod).toBe(false);
  expect(map["mystery-ai"].nativeSignIn).toBe(false);
  expect(providerCanSignIn(map["mystery-ai"])).toBe(false);

  // The local registry writes no verification reason at all. Claude is a
  // registry-only card, so it sits in the other-providers list and keeps only
  // its curated reminder: the description it used to carry repeated the same
  // token-import fact the reminder already states.
  const claude = map.claude;
  expect(claude.browserMethod).toBe(false);
  expect(claude.capability.reason).toEqual({});
  expect(claude.presence).toBe("local-only");
  expect(claude.description).toEqual({});
  expect(claude.presenceNote).toBeNull();
  expect(claude.notice.en).toContain("sandbox service is not ready");
});

test("an unavailable plugin scan degrades to the first layer with no false claims", () => {
  for (const plugins of [undefined, null, { available: false, providers: [] }, 42]) {
    const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "gemini", "mystery-ai"], plugins });
    expect(view.plugins.available).toBe(false);
    expect(view.plugins.count).toBe(0);
    const map = byId(view);
    for (const provider of view.providers) {
      expect(provider.browserMethod).toBe(false);
      expect(provider.authMethods).toEqual([]);
      expect(provider.pluginPackage).toBeNull();
    }
    // A scan that never ran has nothing to say about the installed plugins, so
    // the magpie-only cards say nothing rather than claiming an absence. Only
    // the built-in agent keeps magpie's native door.
    expect(map.gemini.capability.reason).toEqual({});
    expect(map.gemini.description).toEqual({});
    expect(map.gemini.notice).toBeNull();
    expect(map.gemini.nativeSignIn).toBe(true);
    expect(providerCanSignIn(map.gemini)).toBe(true);

    expect(map["mystery-ai"].capability.reason).toEqual({});
    expect(map["mystery-ai"].description).toEqual({});
    expect(map["mystery-ai"].notice).toBeNull();
    expect(map["mystery-ai"].nativeSignIn).toBe(false);
    expect(providerCanSignIn(map["mystery-ai"])).toBe(false);
    expect(view.counts).toEqual({ total: 5, both: 1, localOnly: 2, magpieOnly: 2, pluginOnly: 0, catalogOnly: 0 });
  }
});

// Root cause 3 regression: a scan that failed WITH an error used to be worded
// exactly like "this plugin has not verified the flow yet", which dresses a
// broken scan up as an unimplemented feature. The reason must name the failure
// and carry the raw diagnostic, on magpie-only cards and on local cards whose
// verdict still depends on the scan.
test("a failed plugin scan is worded as a failure, not as an unverified flow", () => {
  const failure = { available: false, providers: [], error: "dirent is not defined", scanned: true };
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "mystery-ai"], plugins: failure });
  const map = byId(view);
  for (const provider of [map.codex, map["mystery-ai"]]) {
    expect(provider.capability.reason.en).toContain("The installed-plugin scan failed");
    expect(provider.capability.reason.en).toContain("dirent is not defined");
    expect(provider.capability.reason.en).not.toMatch(/not verified|unverified/i);
    for (const lang of LANGS) {
      expect(provider.capability.reason[lang]).toBeTruthy();
      expect(provider.capability.reason[lang]).toContain("dirent is not defined");
    }
  }
  // That one diagnostic is the only line this magpie-only card prints: no
  // second copy of it, and no static sentence beside it.
  expect(map["mystery-ai"].presenceNote).toBeNull();
  expect(map["mystery-ai"].notice).toBeNull();
  expect(map["mystery-ai"].description).toEqual({});
  // The reason stays bounded even when the child reports a huge error.
  const huge = byId(mergeProviderSources({
    local: LOCAL,
    magpie: ["codex"],
    plugins: { available: false, providers: [], error: "x".repeat(5000), scanned: true },
  })).codex;
  expect(huge.capability.reason.en.length).toBeLessThan(600);
  // A scan that never ran has no failure to report, so it must NOT claim one.
  const never = byId(mergeProviderSources({
    local: LOCAL,
    magpie: ["gemini", "mystery-ai"],
    plugins: { available: false, providers: [] },
  }));
  expect(never.gemini.capability.reason).toEqual({});
  expect(never.gemini.nativeSignIn).toBe(true);
  expect(providerCanSignIn(never.gemini)).toBe(true);
  expect(never["mystery-ai"].capability.reason).toEqual({});
  expect(never["mystery-ai"].nativeSignIn).toBe(false);
  expect(providerCanSignIn(never["mystery-ai"])).toBe(false);
});

// A method that asks something before it starts carries the questions on the
// card, already projected: the dialog renders them and the answers travel back
// with the request. Nothing typed, defaulted or executable survives the card.
test("a method's declared prompts reach the card as projected fields", () => {
  const plugins = {
    available: true,
    providers: [
      {
        id: "qoder-cn",
        package: "@magpie-community/opencode-qoder-auth",
        methods: [
          {
            type: "oauth",
            label: "Sign in with Qoder CN",
            browser: false,
            category: "browser",
            runnable: true,
            prompts: [],
          },
          {
            type: "oauth",
            label: "Sign in with Qoder CN Enterprise (VPC)",
            browser: false,
            category: "form",
            runnable: true,
            prompts: [
              {
                type: "text",
                key: "vpc",
                message: "Your enterprise's VPC instance",
                placeholder: "https://vpc.example.com",
                default: "preset",
                validate: () => true,
              },
            ],
          },
        ],
      },
    ],
  };
  const view = mergeProviderSources({ local: LOCAL, magpie: ["qoder-cn"], plugins });
  const card = byId(view)["qoder-cn"];
  expect(card.authMethods[0].fields).toEqual([]);
  expect(card.authMethods[1].fields).toEqual([
    { type: "text", key: "vpc", message: "Your enterprise's VPC instance", options: [] },
  ]);
  const serialized = JSON.stringify(card);
  for (const leak of ["preset", "vpc.example.com", "validate"]) {
    expect(serialized).not.toContain(leak);
  }
  // A method with no prompts reports an empty list, so the dialog can tell
  // "nothing to ask" from "not projected".
  expect(card.authMethods[0].fields).toHaveLength(0);
});

test("a plugin-only provider gets a fifth-presence card with its derived methods", () => {
  const plugins = {
    available: true,
    providers: [
      { id: "kiro", package: "@magpie-community/opencode-kiro-auth", methods: [
        { type: "oauth", label: "Kiro (Google, GitHub, AWS Builder ID)", browser: false, category: "pending", runnable: true },
        { type: "api", label: "Kiro API key", browser: false, category: "key", runnable: false },
      ] },
    ],
  };
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex"], plugins });
  // A provider that is in neither the local registry nor magpie's recognized
  // list still gets a card, tagged with the fifth presence.
  expect(view.counts).toEqual({ total: 4, both: 1, localOnly: 2, magpieOnly: 0, pluginOnly: 1, catalogOnly: 0 });
  expect(view.plugins).toEqual({ available: true, count: 1, browserMethods: 0, matched: 1 });
  const kiro = byId(view).kiro;
  expect(kiro).toBeTruthy();
  expect(kiro.presence).toBe("plugin-only");
  expect(kiro.sources).toEqual({ local: false, magpie: false });
  expect(kiro.pluginPackage).toBe("@magpie-community/opencode-kiro-auth");
  expect(kiro.authMethods).toEqual([
    { type: "oauth", label: "Kiro (Google, GitHub, AWS Builder ID)", browser: false, category: "pending", prompts: [], runnable: true, fields: [] },
    { type: "api", label: "Kiro API key", browser: false, category: "key", prompts: [], runnable: false, fields: [] },
  ]);  expect(kiro.browserMethod).toBe(false);
  expect(kiro.unconfirmedMethod).toBe(true);
  expect(kiro.capability.state).toBe("pending");
  // The card prints no prose: the 第三方插件 tag says where it came from, the
  // chips repeat the plugin's own labels, and the source line names the layer.
  // The pending state survives in the projection even without a sentence.
  expect(kiro.description).toEqual({});
  expect(kiro.notice).toBeNull();
  expect(kiro.presenceNote).toBeNull();
  expect(kiro.capability.reason).toEqual({});
  for (const lang of LANGS) expect(kiro.description[lang]).toBeUndefined();
  // The scan cannot tell what this flow does, but it IS a runnable method, so
  // the card offers the add entry: the page shown at sign-in is the truth.
  expect(providerCanSignIn(kiro)).toBe(true);
  expect(providerCanSignIn({ ...kiro, capability: { ...kiro.capability, state: "ready" } })).toBe(true);
  expect(PROVIDER_PRESENCES).toContain("plugin-only");
});

// A plugin-only provider with a browser-labelled method keeps the same wording
// as everywhere else and becomes signable through its own entry id.
test("a plugin-only provider with a browser method names the method, not a verification state", () => {
  const plugins = {
    available: true,
    providers: [
      { id: "loomy", package: "@roadkid/opencode-loomy-auth", methods: [
        { type: "oauth", label: "Sign in with Loomy (browser)", browser: true, category: "browser", runnable: true },
      ] },
    ],
  };
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex"], plugins });
  const loomy = byId(view).loomy;
  expect(loomy.presence).toBe("plugin-only");
  expect(loomy.browserMethod).toBe(true);
  expect(loomy.signInProvider).toBe("loomy");
  expect(providerCanSignIn(loomy)).toBe(true);
  // The method label is the plugin's own, and the card adds nothing around it:
  // no claim about a verification state, no prose at all.
  expect(loomy.authMethods.map((method) => method.label)).toEqual(["Sign in with Loomy (browser)"]);
  expect(loomy.capability.reason).toEqual({});
  for (const lang of LANGS) expect(loomy.capability.reason[lang]).toBeUndefined();
});

// Defect 3 regression: an ambiguous oauth provider (here ZCode's GLM Coding
// Plan) on a magpie-only card must not claim a browser method was identified,
// and must not be called "unknown" in the sense of "nothing was found": the
// flow's real kind is only knowable when authorize() runs.
test("an ambiguous oauth method on a magpie-only card is offered as signable, never as a browser method", () => {
  const plugins = {
    available: true,
    providers: [
      { id: "zcode", package: "@magpie-community/opencode-zcode-auth", methods: [
        { type: "oauth", label: "ZCode: Z.ai GLM Coding Plan", browser: false, category: "pending", runnable: true },
      ] },
    ],
  };
  const view = mergeProviderSources({ local: LOCAL, magpie: ["zcode"], plugins });
  const zcode = byId(view).zcode;
  expect(zcode.presence).toBe("magpie-only");
  expect(zcode.browserMethod).toBe(false);
  expect(zcode.unconfirmedMethod).toBe(true);
  expect(zcode.signableMethod).toBe(true);
  // The card prints no paragraph at all, so the honesty lives in the projected
  // flags: the kind is marked as decided at sign-in time, and the card never
  // claims a browser method was identified. The wording for this case is still
  // exercised on a plugin-only card below.
  expect(zcode.capability.reason).toEqual({});
  expect(zcode.description).toEqual({});
  expect(zcode.presenceNote).toBeNull();
  expect(zcode.notice).toBeNull();
  expect(providerCanSignIn(zcode)).toBe(true);
});

test("the third-source merge stays public and leak-free", () => {
  const view = mergeProviderSources({ local: LOCAL, magpie: ["codex", "cursor", "mystery-ai"], plugins: PLUGINS });
  expect(JSON.stringify(view)).not.toMatch(
    /client[_-]?secret|client[_-]?id|access[_-]?token|refresh[_-]?token|api[_-]?key|password|authorize/i,
  );
});
