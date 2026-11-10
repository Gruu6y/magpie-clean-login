// Pure normalization and merging of provider sources.
//
// The provider list is derived at page load from magpie's `providers:list`
// read and then merged with this plugin's static local registry. Everything
// here is a pure function: no network, no storage, no magpie runtime. It is
// safe to unit-test in isolation.
//
// UNVERIFIED: magpie's binary declares exactly two reads
// (`usage:summary`, `providers:list`) and `providers:list` is documented there
// as "your providers' names". The real payload shape has NOT been verified on
// this machine, because no magpie runtime is mounted for the tests. The
// normalizer is therefore deliberately tolerant and accepts several plausible
// shapes. Anything it cannot recognize is reported as "not available", so the
// UI falls back to the local registry rather than inventing providers.
//
// UNVERIFIED (by design): `providers:list` carries names only. It cannot tell
// us how a provider signs in. The local registry is the curated first source
// for that, and the installed provider plugins (see lib/magpie-plugins.mjs)
// are a second, derived source. A provider that magpie lists but this plugin
// does not know gets a card with no add entry and an honest reason.

export const MAGPIE_PROVIDERS_READ = "providers:list";

import { projectPrompts, requiresFormInput, requiresSecretInput } from "./magpie-plugins.mjs";
import { methodInputFields } from "./method-inputs.mjs";

// Five presences. The first four only compare the local registry with
// magpie's own list. The fifth exists because an installed plugin can expose a
// provider that NEITHER source knows about:
//   both          in the local registry and in magpie's list
//   local-only    in the local registry, magpie's list was read and omits it
//   magpie-only   magpie's list was read and has it, the local registry does
//                 not
//   local-unknown magpie's list could not be read; only the local registry is
//                 known
//   plugin-only   NEITHER list has it, but an installed provider plugin
//                 exposes it. Unlike the other four it has no registry or list
//                 entry at all; its sign-in methods are derived from the
//                 installed plugin, and its card must say so.
export const PROVIDER_PRESENCES = Object.freeze([
  "both",
  "local-only",
  "magpie-only",
  "local-unknown",
  "plugin-only",
  "catalog",
]);

// Localized, honest notes, for the presences whose card has nothing else to
// say. A `magpie-only` card is deliberately not one of them: it always carries
// a door of its own (the installed plugin's method, or magpie's own
// `accounts add`), so it explains nothing and prints no note at all.
// A registry-only card sits in the "other providers" list, next to cards that
// print no prose at all, so it gets one line and no more: the curated notice,
// when the registry has one ("do not sign in through this plugin yet", plus the
// token import note for Claude). Its own description and the generic "magpie
// does not list it" note were two further paragraphs around that one sentence.
const PROSE_FREE_PRESENCES = Object.freeze(["local-only"]);

// A scan that BROKE is not a flow that was never implemented. When the
// installed-plugin scan fails with an error (the child process crashed, timed
// out, or printed junk), every card that depends on it must name the failure
// and carry its raw diagnostic. Reusing the "no browser sign-in flow" wording
// here would dress a broken scan up as missing work.
const PLUGIN_SCAN_FAILED = Object.freeze({
  en: "The installed-plugin scan failed ({error}). Because the scan itself broke, Clean Login cannot tell which sign-in way this provider offers, so this card has no add entry.",
  "zh-Hans": "已安装插件扫描失败（{error}）。由于扫描本身出错，干净登录无法判断这个供应商有哪些登录方式，因此这里没有添加入口。",
  "zh-Hant": "已安裝外掛掃描失敗（{error}）。由於掃描本身出錯，乾淨登入無法判斷這個供應商有哪些登入方式，因此這裡沒有新增入口。",
  ja: "インストール済みプラグインのスキャンに失敗しました（{error}）。スキャン自体が失敗したため、このプロバイダーのログイン方法を判別できず、ここに追加の入口はありません。",
});

// The diagnostic travels into a public API response, so keep it a bounded
// single line: no stack trace, no enormous plugin output.
const MAX_SCAN_ERROR_LENGTH = 200;

// Derived from the second layer: the provider plugins magpie has actually
// installed (see lib/magpie-plugins.mjs). A method marked `browser` opens a
// browser sign-in; the clean-login flow for it has NOT been implemented yet,
// so recognizing it still must not create an add action.
const BROWSER_METHOD_FOUND = Object.freeze({
  en: "An installed magpie plugin exposes a browser sign-in method for this provider. You can try it directly, and any failure is reported honestly. Feedback is welcome.",
  "zh-Hans": "已安装的 magpie 插件为这个供应商提供了浏览器登录方式。你可以直接尝试，失败会如实报错，也欢迎反馈问题。",
  "zh-Hant": "已安裝的 magpie 外掛為這個供應商提供了瀏覽器登入方式。你可以直接嘗試，失敗會如實回報，也歡迎回報問題。",
  ja: "インストール済みの magpie プラグインはこのプロバイダーのブラウザーログイン方法を公開しています。そのまま試せますし、失敗はそのまま表示されますので、問題の報告も歓迎します。",
});

// A distinct outcome: the installed plugin exposes an oauth method that asks
// the user to type details in (a Start URL, a region, a phone number). That is
// a fill-in form, not a bare browser hand-off, and it is named honestly rather
// than as "unknown".
const FORM_METHOD_FOUND = Object.freeze({
  en: "An installed magpie plugin exposes a sign-in method for this provider that needs details typed in (for example a Start URL, a region or a phone number). You can try it directly, and any failure is reported honestly.",
  "zh-Hans": "已安装的 magpie 插件为这个供应商提供了需要填写信息的登录方式（例如 Start URL、区域或手机号）。你可以直接尝试，失败会如实报错。",
  "zh-Hant": "已安裝的 magpie 外掛為這個供應商提供了需要填寫資訊的登入方式（例如 Start URL、區域或手機號）。你可以直接嘗試，失敗會如實回報。",
  ja: "インストール済みの magpie プラグインはこのプロバイダーの入力が必要なログイン方法（Start URL、リージョン、電話番号など）を公開しています。そのまま試せますし、失敗はそのまま表示されます。",
});

// A distinct outcome: the installed plugin exposes an oauth method that asks
// the user to paste a secret (a Personal Access Token or a token). That is a
// paste-a-key flow, not a bare browser hand-off, and it is named honestly
// rather than as "unknown".
const SECRET_METHOD_FOUND = Object.freeze({
  en: "An installed magpie plugin exposes a sign-in method for this provider that asks for a secret you paste in (a Personal Access Token or a token). You can try it directly, and any failure is reported honestly.",
  "zh-Hans": "已安装的 magpie 插件为这个供应商提供了需要粘贴密钥的登录方式（个人访问令牌或 token）。你可以直接尝试，失败会如实报错。",
  "zh-Hant": "已安裝的 magpie 外掛為這個供應商提供了需要貼上密鑰的登入方式（個人存取權杖或 token）。你可以直接嘗試，失敗會如實回報。",
  ja: "インストール済みの magpie プラグインはこのプロバイダーの、秘密の値を貼り付ける必要があるログイン方法（個人アクセストークンやトークン）を公開しています。そのまま試せますし、失敗はそのまま表示されます。",
});

// A distinct outcome: the installed plugin exposes an oauth method with a real
// authorize() function, but nothing in the scan says what kind of flow it is
// (ZCode's per-site flows, Qoder's device code, MiniMax Code's device code).
// The scan cannot call authorize(), so the honest wording says the flow
// decides that at sign-in time. This is NOT a claim that a browser sign-in was
// identified, and it is NOT "nothing was found": a real, runnable method
// exists and is offered.
const PENDING_METHOD_FOUND = Object.freeze({
  en: "An installed magpie plugin exposes a sign-in method for this provider. Whether it opens a browser page is only known when the sign-in actually starts, so the page shown at sign-in is the source of truth.",
  "zh-Hans": "已安装的 magpie 插件为这个供应商提供了登录方式。它究竟是不是浏览器页面，只有真正开始登录时才知道，以登录时实际打开的页面为准。",
  "zh-Hant": "已安裝的 magpie 外掛為這個供應商提供了登入方式。它究竟是不是瀏覽器頁面，只有真正開始登入時才知道，以登入時實際開啟的頁面為準。",
  ja: "インストール済みの magpie プラグインはこのプロバイダーのログイン方法を公開しています。ブラウザーのページを開くかどうかは実際にログインを始めたときにだけ分かるため、ログイン時に開くページが基準になります。",
});

// The methods come from the scan with a typed `category`. Older fixtures only
// carry the boolean `browser`; treat that as the browser category so both
// shapes classify the same way.
function isBrowserMethod(method) {
  return method?.browser === true || method?.category === "browser";
}

function isFormMethod(method) {
  return method?.category === "form";
}

function isSecretMethod(method) {
  return method?.category === "secret";
}

// A method the user can actually run: an interactive oauth method that is not a
// local-session reuse and really carries an authorize function. The scan cannot
// tell a browser page from a device code or another hand-off, so all of those
// are signable and the real kind is reported at sign-in time.
function isSignableMethod(method) {
  if (method?.type !== "oauth") return false;
  if (methodCategoryOf(method) === "local") return false;
  // A method the scan saw without an authorize function cannot be run.
  return method?.runnable === true;
}

// The categories a card leads with. The scan can name a browser sign-in, a
// fill-in form, a pasted key and a local session outright. A runnable oauth
// method whose kind is not named by its label is `pending`: it IS offered, and
// its real kind is reported at sign-in time. The most specific kind found wins,
// so a provider that offers both a browser sign-in and a local session leads
// with the browser one.
const CATEGORY_PRIORITY = Object.freeze([
  "browser",
  "secret",
  "form",
  "pending",
  "local",
  "key",
]);

// The honest capability reason for a plugin-derived card, chosen by what the
// scan actually saw, most specific first. Returns null when no plugin method was
// found, so the caller keeps its own curated wording.
function pluginMethodReason({ primaryCategory }) {
  if (primaryCategory === "browser") return { ...BROWSER_METHOD_FOUND };
  if (primaryCategory === "secret") return { ...SECRET_METHOD_FOUND };
  if (primaryCategory === "form") return { ...FORM_METHOD_FOUND };
  if (primaryCategory === "pending") return { ...PENDING_METHOD_FOUND };
  return null;
}

// The localized reason for a scan that reported an error, with the raw
// diagnostic substituted into every language. Returns null when there is no
// error to report, so a scan that merely never ran keeps the "not verified"
// wording instead of claiming a failure it cannot prove.
function scanFailureReason(error) {
  if (typeof error !== "string" || !error.trim()) return null;
  const detail = error.replace(/\s+/g, " ").trim().slice(0, MAX_SCAN_ERROR_LENGTH);
  const reason = {};
  for (const [lang, message] of Object.entries(PLUGIN_SCAN_FAILED)) {
    reason[lang] = message.replace("{error}", detail);
  }
  return reason;
}

// The derived flags every plugin-derived card carries. `primaryCategory` is the
// kind the card leads with; `unconfirmedMethod` marks an oauth method whose
// kind the scan cannot know (ZCode's per-site flows). It is deliberately
// separate from `unknownMethod`, which is now reserved for a method type the
// scan does recognize but cannot classify.
function methodFlags(methods) {
  const categories = methods
    .filter(isPlainObject)
    .map((method) => methodCategoryOf(method))
    .filter((category) => CATEGORY_PRIORITY.includes(category));
  let primaryCategory = null;
  for (const category of CATEGORY_PRIORITY) {
    if (categories.includes(category)) {
      primaryCategory = category;
      break;
    }
  }
  return {
    primaryCategory,
    browserMethod: methods.some(isBrowserMethod),
    formMethod: methods.some(isFormMethod),
    secretMethod: methods.some(isSecretMethod),
    signableMethod: methods.some(isSignableMethod),
    unconfirmedMethod: methods.some(
      (method) => method?.type === "oauth" && methodCategoryOf(method) === "pending",
    ),
    unknownMethod: methods.some(
      (method) => method?.type === "oauth" && methodCategoryOf(method) === "unknown",
    ),
    // The runnable methods the user may choose between, in the plugin's own
    // order. ZCode exposes several (one per site), and signing in to the
    // wrong site yields the wrong token, so the dialog offers a choice
    // instead of silently taking the first one. Only the label travels: it is
    // the exact key the service looks the method up by.
    signInMethods: methods
      .filter(isSignableMethod)
      .map((method) => (typeof method.label === "string" ? method.label : ""))
      .filter((label) => label.length > 0),
  };
}

// The category of one scanned method, tolerating the older shapes: the typed
// `category` first, then the boolean `browser`, then the method type.
function methodCategoryOf(method) {
  const category = typeof method?.category === "string" ? method.category : "";
  if (CATEGORY_PRIORITY.includes(category) || category === "unknown") return category;
  if (method?.browser === true) return "browser";
  if (method?.type === "api" || method?.type === "key") return "key";
  return "unknown";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The scanned methods as the card carries them: unchanged, plus the fields the
// dialog must collect before a method can start. The projection drops defaults,
// placeholders, entered values and every function a plugin declared, so the card
// payload can say what to ask without carrying an answer or executable code.
function cardMethods(methods) {
  if (!Array.isArray(methods)) return [];
  return methods.map((method) =>
    isPlainObject(method) ? { ...method, fields: methodInputFields(method) } : method,
  );
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function itemFromEntry(entry) {
  if (typeof entry === "string") {
    const id = slug(entry);
    return id ? { id, name: entry.trim() } : null;
  }
  if (!isPlainObject(entry)) return null;
  const rawId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "";
  const rawName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "";
  const id = slug(rawId || rawName);
  if (!id) return null;
  return { id, name: rawName || rawId || id };
}

function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

function unavailable() {
  return { available: false, items: [] };
}

function recognized(items) {
  return { available: true, items: dedupe(items) };
}

function normalizeList(payload) {
  if (payload === null || payload === undefined) return unavailable();
  if (typeof payload === "string") {
    const item = itemFromEntry(payload);
    return item ? recognized([item]) : unavailable();
  }
  if (Array.isArray(payload)) {
    return recognized(payload.map(itemFromEntry).filter(Boolean));
  }
  if (isPlainObject(payload)) {
    if (Array.isArray(payload.providers)) return normalizeList(payload.providers);
    if (Array.isArray(payload.names)) return normalizeList(payload.names);
    if (Array.isArray(payload.items)) return normalizeList(payload.items);
    const item = itemFromEntry(payload);
    if (item) return recognized([item]);
  }
  return unavailable();
}

// Accepts the raw magpie value, the { ok, value } envelope written by
// page/boot.js, or a plain { ok, providers } style object. Returns
// { available, items } where `available` means "we recognized an actual list".
// The catalogue layer is a flat list of provider ids magpie's market offers.
// A shape this version does not recognise yields `available: false` rather
// than an empty list, so the page can tell "nothing offered" apart from
// "nothing readable".
function normalizeCatalog(raw) {
  if (!raw || typeof raw !== "object" || raw.available === false) return { available: false, items: [] };
  const rows = Array.isArray(raw.providers) ? raw.providers : [];
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 120) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof row.name === "string" && row.name.trim()
      ? row.name.trim().slice(0, 120)
      : id;
    items.push({
      id,
      name,
      package: typeof row.package === "string" ? row.package.slice(0, 160) : "",
    });
  }
  return { available: true, items };
}

export function normalizeMagpieProviders(payload) {
  if (isPlainObject(payload) && typeof payload.ok === "boolean") {
    if (!payload.ok) return unavailable();
    if ("value" in payload) return normalizeList(payload.value);
    // A payload such as { ok: true, providers: [...] } is treated as raw.
  }
  return normalizeList(payload);
}

function magpieOnlyProvider(item, pluginItem, scanFailure) {
  const methods = pluginItem ? pluginItem.methods : [];
  const flags = methodFlags(methods);
  // A card for a provider magpie lists always carries a door: the installed
  // plugin's own method when the scan found one, magpie's `accounts add`
  // otherwise. So the card explains nothing about what it lacks — its method
  // list and its entry already say what it can do — and the one line it may
  // print is a broken scan's own diagnostic, the single case where staying
  // silent would hide a failure the user needs to act on. (A static "this
  // plugin has no browser login" sentence used to sit here and contradicted
  // cards that listed a browser method while claiming there was no add entry.)
  const reason = scanFailure ? { ...scanFailure } : {};
  return {
    id: item.id,
    name: item.name,
    mark: { kind: "letter", text: item.name.slice(0, 1).toUpperCase(), tone: "neutral" },
    description: {},
    agentId: item.id,
    signInMode: "unknown",
    linkOnly: true,
    authHosts: [],
    callbackPort: null,
    notice: null,
    capability: { state: "pending", reason },
    presence: "magpie-only",
    presenceNote: null,
    sources: { local: false, magpie: true },
    // Second-layer derivation. `browserMethod` only reports what was found;
    // the page decides whether to offer the add entry from the signable flags
    // plus `signInProvider` (see ui/provider-state.js). The plugin entry id is
    // carried explicitly because the card id may come from magpie's list or a
    // display-name slug and need not equal the installed plugin entry's id,
    // while the service loads the plugin by `scan.providers[].id`.
    authMethods: cardMethods(methods),
    ...flags,
    signInProvider: pluginItem ? pluginItem.id : null,
    pluginPackage: pluginItem ? pluginItem.package : null,
    // magpie signs this provider in itself, so its own command line is a door:
    // `magpie accounts add <agent>` runs the provider's own browser OAuth.
    // Only when no installed plugin covers it, because a plugin that does is
    // the door the user gets, and a plugin that offers only a key or a local
    // session is not something this entry should quietly turn into a browser
    // sign-in.
    nativeSignIn: !pluginItem,
  };
}

// A card for a provider that exists only in the installed-plugin scan. It has
// no registry or magpie-list entry, so it borrows no local capability fields.
// Like a magpie-only card it prints no prose: the origin tag says where the
// provider came from, the method list says what it can do, and the source line
// names the layer. Any sentence repeating those three facts was noise on a
// card that had nothing else to explain.
function pluginOnlyProvider(item) {
  const methods = item.methods;
  const flags = methodFlags(methods);
  // One plugin can expose several providers, so the card is named after the
  // provider the plugin declared, never after the package it came from.
  const name = item.name || item.id;
  return {
    id: item.id,
    name,
    mark: { kind: "letter", text: name.slice(0, 1).toUpperCase(), tone: "neutral" },
    description: {},
    agentId: item.id,
    signInMode: "unknown",
    linkOnly: true,
    authHosts: [],
    callbackPort: null,
    notice: null,
    capability: { state: "pending", reason: {} },
    presence: "plugin-only",
    presenceNote: null,
    sources: { local: false, magpie: false },
    authMethods: cardMethods(methods),
    ...flags,
    // A plugin-only card is keyed by the plugin entry itself, so its id is
    // already the id the service loads the provider by.
    signInProvider: item.id,
    pluginPackage: item.package,
    // magpie's list did not carry it, so `magpie accounts add` is not a door
    // this card may offer.
    nativeSignIn: false,
  };
}

// The read is documented as "your providers' names", so we cannot assume an
// entry carries magpie's id. Match on every key an entry could key on: its id
// and the slug of its display name. `slug("Google Antigravity")` is
// `google-antigravity` while our registry id is `antigravity`, and a name-only
// payload would otherwise be reported as "not in magpie" for a provider magpie
// really has.
function matchKeys(id, name) {
  const keys = new Set();
  if (typeof id === "string" && id.trim()) keys.add(slug(id));
  if (typeof name === "string" && name.trim()) keys.add(slug(name));
  keys.delete("");
  return keys;
}

// Normalize the plugin scan (the second layer) into `{ available, items }`.
// `browser` is trusted only when it is literally `true`; every method is
// projected to public strings, a typed category and the public-safe `prompts`
// shape, so no authorize function and no entered value can leak. An
// absent/unknown scan degrades to unavailable without throwing.
function pluginMethods(entry) {
  if (!Array.isArray(entry.methods)) return [];
  return entry.methods
    .filter((method) => isPlainObject(method))
    .map((method) => {
      const type = typeof method.type === "string" ? method.type : "";
      const browser = method.browser === true;
      const prompts = projectPrompts(method.prompts);
      // Whether the plugin's method really carries an authorize function.
      // The scan never calls it, but it can see that it is there, and that is
      // what makes a method runnable at sign-in time. A legacy fixture without
      // the flag falls back to the browser marker, which only ever became true
      // for an oauth method that had one.
      const runnable = typeof method.runnable === "boolean" ? method.runnable : browser;
      // Production scans arrive categorized; fixtures may only carry the
      // boolean and/or raw prompts. Fall back to those so a form or a key
      // method never reads as unknown, and a runnable method whose kind the
      // label does not name reads as pending (offered, kind unconfirmed).
      const category =
        typeof method.category === "string" && method.category
          ? method.category
          : browser
            ? "browser"
            : requiresSecretInput(prompts)
              ? "secret"
              : requiresFormInput(prompts)
                ? "form"
                : type === "api" || type === "key"
                  ? "key"
                  : runnable
                    ? "pending"
                    : "unknown";
      return {
        type,
        label: typeof method.label === "string" ? method.label : "",
        browser,
        category,
        prompts,
        runnable,
      };
    });
}

function normalizePlugins(payload) {
  if (!isPlainObject(payload) || payload.available !== true || !Array.isArray(payload.providers)) {
    const error = isPlainObject(payload) && typeof payload.error === "string" ? payload.error : "";
    return { available: false, items: [], error: error || null };
  }
  const seen = new Set();
  const items = [];
  for (const entry of payload.providers) {
    if (!isPlainObject(entry)) continue;
    const id = slug(typeof entry.id === "string" ? entry.id : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      // A package can expose several providers; each keeps the name the scan
      // read for that provider id.
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 120) : null,
      package: typeof entry.package === "string" && entry.package ? entry.package : null,
      methods: pluginMethods(entry),
    });
  }
  return { available: true, items, error: null };
}

// Plugin entries key on the provider id magpie's runtime uses, so the same
// tolerant matchKeys() comparison that lines local cards up with magpie's
// list is reused here.
function pluginIndex(items) {
  const map = new Map();
  for (const item of items) {
    for (const key of matchKeys(item.id, null)) {
      if (!map.has(key)) map.set(key, item);
    }
  }
  return map;
}

function pluginFor(provider, index) {
  for (const key of matchKeys(provider.id, provider.name)) {
    const item = index.get(key);
    if (item) return item;
  }
  return null;
}

// Merge the local registry with a (possibly unrecognized) magpie list.
// `local` must already be the public projection of local providers. The
// result is JSON-serializable and carries:
//   source   "magpie" when the magpie list was recognized (even if empty),
//            "local" when it was not available and we degraded to the local
//            registry;
//   magpie   { available, count };
//   plugins  { available, count, browserMethods, matched } for the installed
//            plugin layer;
//   counts   { total, both, localOnly, magpieOnly, pluginOnly };
//   providers  the merged cards, each tagged with `presence`, `presenceNote`,
//            `sources`, and the second-layer `authMethods` / `browserMethod` /
//            `unknownMethod` / `pluginPackage`.
export function mergeProviderSources({ local = [], magpie, plugins, catalog } = {}) {
  const read = normalizeMagpieProviders(magpie);
  const catalogRead = normalizeCatalog(catalog);
  const available = read.available;
  const pluginRead = normalizePlugins(plugins);
  // A scan that reported an error is a broken scan, not an unimplemented flow;
  // every card that is still waiting on it says so with its raw diagnostic.
  const pluginScanFailure = pluginRead.available ? null : scanFailureReason(pluginRead.error);
  const pluginByKey = pluginIndex(pluginRead.items);
  const magpieKeys = new Set();
  for (const item of read.items) {
    for (const key of matchKeys(item.id, item.name)) magpieKeys.add(key);
  }
  const consumed = new Set();
  // Plugin entries already attached to a local or magpie-only card. Whatever
  // is left and is in neither list becomes a fifth-presence plugin-only card.
  const consumedPlugins = new Set();

  const providers = [];
  let both = 0;
  let localOnly = 0;
  let magpieOnly = 0;
  let pluginOnly = 0;
  let matchedPlugins = 0;
  let browserMethodPlugins = 0;
  for (const item of pluginRead.items) {
    if (item.methods.some(isBrowserMethod)) browserMethodPlugins += 1;
  }

  for (const provider of local) {
    const keys = [...matchKeys(provider.id, provider.name)];
    const inMagpie = available && keys.some((key) => magpieKeys.has(key));
    if (inMagpie) {
      for (const item of read.items) {
        const itemKeys = [...matchKeys(item.id, item.name)];
        if (itemKeys.some((key) => keys.includes(key))) consumed.add(item);
      }
    }
    let presence;
    let presenceNote;
    if (!available) {
      presence = "local-unknown";
      presenceNote = null;
    } else if (inMagpie) {
      presence = "both";
      presenceNote = null;
    } else {
      presence = "local-only";
      presenceNote = null;
    }
    if (inMagpie) both += 1;
    else if (available) localOnly += 1;

    const pluginItem = pluginFor(provider, pluginByKey);
    const methods = pluginItem ? pluginItem.methods : [];
    const flags = methodFlags(methods);
    if (pluginItem) {
      matchedPlugins += 1;
      consumedPlugins.add(pluginItem);
    }

    // The local registry's own reason is curated per provider; keep it. Only a
    // recognized plugin method (a browser one, a form one, or one whose kind is
    // only knowable at sign-in time) replaces it with the honest plugin-layer
    // wording. A local card with none keeps its existing per-provider reason,
    // UNLESS the plugin scan itself failed: a provider whose verdict is still
    // pending then says the scan broke, because "not verified yet" would hide
    // the failure that actually explains the missing add entry. A card the
    // registry already decided (ready/blocked) keeps its verdict.
    const pluginReason = pluginMethodReason(flags);
    const capability = pluginReason
      ? { state: provider.capability.state, reason: pluginReason }
      : pluginScanFailure && provider.capability.state === "pending"
        ? { state: provider.capability.state, reason: { ...pluginScanFailure } }
        : provider.capability;

    providers.push({
      ...provider,
      // In the other-providers list the notice is the only prose: the origin
      // line and the registry's own notice say everything the description and
      // the presence note used to repeat.
      description: PROSE_FREE_PRESENCES.includes(presence) ? {} : provider.description,
      capability,
      presence,
      presenceNote,
      sources: { local: true, magpie: inMagpie },
      authMethods: cardMethods(methods),
      ...flags,
      signInProvider: pluginItem ? pluginItem.id : null,
      pluginPackage: pluginItem ? pluginItem.package : null,
      // magpie's own command line is the only door left for a built-in
      // provider — one magpie ships, with no plugin to scan. That door must
      // not hang on this read: `magpie accounts add <agent>` never consults
      // magpie's provider list, so when the `providers:list` handover failed
      // the registry's own `browser-oauth` entries keep their entry instead of
      // losing the only door they have (the plugin layer below is not gated on
      // that read either, for the same reason). A list that WAS read keeps the
      // final say: not in it means no native door. A token-import provider is
      // not a browser door, so nothing is invented for it.
      nativeSignIn: !pluginItem && (inMagpie || (!available && provider.signInMode === "browser-oauth")),
    });
  }

  if (available) {
    for (const item of read.items) {
      if (consumed.has(item)) continue;
      const pluginItem = pluginFor(item, pluginByKey);
      if (pluginItem) {
        matchedPlugins += 1;
        consumedPlugins.add(pluginItem);
      }
      providers.push(magpieOnlyProvider(item, pluginItem, pluginScanFailure));
      magpieOnly += 1;
    }
  }

  // Fifth presence: a provider in neither the local registry nor magpie's
  // recognized list that an installed plugin exposes. An installed plugin is
  // evidence on its own, so this layer is NOT gated on magpie's list being
  // readable: gating it there silently deleted every plugin card whenever that
  // list was missing, which is exactly the state the launcher hands over. What
  // the list being unreadable changes is only the claim: "plugin-only" says
  // magpie's list omits it, and that claim is dropped when nobody read the
  // list.
  if (pluginRead.available) {
    for (const pluginItem of pluginRead.items) {
      if (consumedPlugins.has(pluginItem)) continue;
      providers.push(pluginOnlyProvider(pluginItem));
      pluginOnly += 1;
      matchedPlugins += 1;
    }
  }

  // Sixth presence: magpie's market declares the provider but nothing on this
  // machine can sign into it. It is listed last and carries no methods, so it
  // never looks like a working entry. The origin tag already says "not
  // installed", so the card prints no paragraph explaining that again; the
  // source line names the market it came from.
  let catalogOnly = 0;
  if (catalogRead.available) {
    const covered = new Set();
    for (const provider of providers) {
      for (const key of matchKeys(provider.id, provider.name)) covered.add(key);
    }
    for (const item of catalogRead.items) {
      const keys = [...matchKeys(item.id, item.name)];
      if (keys.some((key) => covered.has(key))) continue;
      for (const key of keys) covered.add(key);
      const flags = methodFlags([]);
      providers.push({
        id: item.id,
        name: item.name,
        mark: { kind: "letter", text: item.name.slice(0, 1).toUpperCase(), tone: "neutral" },
        description: {},
        agentId: item.id,
        signInMode: "unknown",
        linkOnly: true,
        authHosts: [],
        callbackPort: null,
        notice: null,
        capability: { state: "pending", reason: {} },
        presence: "catalog",
        presenceNote: null,
        sources: { local: false, magpie: false, market: true },
        authMethods: [],
        ...flags,
        signInProvider: null,
        pluginPackage: item.package || null,
      });
      catalogOnly += 1;
    }
  }

  return {
    source: available ? "magpie" : "local",
    magpie: { available, count: read.items.length },
    plugins: {
      available: pluginRead.available,
      count: pluginRead.items.length,
      browserMethods: browserMethodPlugins,
      matched: matchedPlugins,
    },
    catalog: { available: catalogRead.available, count: catalogRead.items.length },
    counts: { total: providers.length, both, localOnly, magpieOnly, pluginOnly, catalogOnly },
    providers,
  };
}
