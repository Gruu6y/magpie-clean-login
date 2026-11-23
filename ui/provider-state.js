// Pure helpers for provider cards. The Host owns the capability registry; the
// page only decides how to present its public fields.

export function localizedText(value, lang = "en") {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value[lang] === "string" && value[lang]) return value[lang];
  if (typeof value.en === "string" && value.en) return value.en;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return "";
}

// A card offers the add-account entry when the installed plugin scan exposed a
// signable sign-in method AND the merge carried the installed plugin entry id
// the service loads the provider by (`signInProvider`), or when magpie itself
// can sign the provider in (`nativeSignIn`: the provider is in magpie's own
// list, so `magpie accounts add <agent>` is a door). Capability readiness is
// deliberately NOT a gate: an unverified flow is exactly the one users should
// be able to try so they can report what happens. Pure, so the rule is testable
// without a DOM.
//
// The native door matters for the providers magpie ships itself. A built-in
// has no plugin to scan, so a rule that reads only the plugin layer hides the
// entry on exactly the providers a user cannot add any other way.
//
// "Signable" is broader than "browser": the scan cannot call authorize(), so it
// cannot tell a browser page from a device code. A method whose kind is only
// knowable at sign-in time (ZCode's per-site flows) is still offered; the page
// shown at sign-in is the source of truth.
export function providerCanSignIn(provider) {
  if (provider?.nativeSignIn === true) return true;
  // The new flag decides when the card carries it: a method is offered when it
  // is runnable, whatever kind it turns out to be. Older cards only carry the
  // boolean `browser`.
  if (typeof provider?.signableMethod === "boolean") {
    return provider.signableMethod && Boolean(provider?.signInProvider);
  }
  return Boolean(provider?.browserMethod && provider?.signInProvider);
}

// Which door the add entry opens. A plugin method is tried first because it is
// the one that can carry a form, a code and this plugin's own isolated browser;
// the native door is the fallback that keeps a built-in provider reachable.
export function signInDoor(provider) {
  if (typeof provider?.signableMethod === "boolean" ? provider.signableMethod && provider?.signInProvider : provider?.browserMethod && provider?.signInProvider) {
    return "plugin";
  }
  return provider?.nativeSignIn === true ? "native" : "none";
}

// --- the main list and the one collapsed catalog -------------------------
//
// The page shows what a user can sign in to right now in the main list and
// keeps every other subscription provider in a single collapsed region. The
// split is drawn from card fields only: a later account read may reorder the
// main list, but it never moves a card from one region to the other.
//
// "Usable now" needs two things, and neither of them is capability readiness:
// magpie has the provider enabled (its list carried the id, so the merge says
// `both` or `magpie-only`) and the installed-plugin scan exposed a runnable
// sign-in method. A provider magpie does not know about cannot receive the
// account the plugin writes, so a signable card for one waits in the collapsed
// region until magpie has it.
export function providerIsPrimary(provider = {}) {
  const presence = provider?.presence;
  const knownToMagpie = presence === "both" || presence === "magpie-only";
  return knownToMagpie && providerCanSignIn(provider);
}

// The collapsed region is the page's completeness promise: every subscription
// service the local data knows about appears there, including the magpie-native
// ones this plugin has no sign-in flow for. A local model runner is a chat
// endpoint on this computer, not a subscription to sign in to, and magpie's
// `providers:list` carries names only (no kind), so the handful of
// non-subscription ids are named here instead of guessed from a name.
export const NON_SUBSCRIPTION_PROVIDER_IDS = Object.freeze(["llama-local"]);

export function providerIsSubscription(provider = {}) {
  const id = String(provider?.id || "").trim().toLowerCase();
  if (!id) return false;
  return !NON_SUBSCRIPTION_PROVIDER_IDS.includes(id);
}

function accountCountOf(accountCounts, id) {
  if (!accountCounts) return 0;
  const raw = typeof accountCounts.get === "function" ? accountCounts.get(id) : accountCounts[id];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Pure split, so the rule is testable without a DOM. `accountCounts` only
// orders the main list (the exits with the most accounts first); it never
// decides which region a card lands in. When magpie's list could not be read
// nothing can be called "usable now", and hiding every card behind a closed
// fold would be worse than the old single grid, so the split then degrades to
// "everything in the main list".
//
// A catalogue card is the one exception to that degradation: it is an offer
// (nothing on this machine can sign into it yet, so it carries no add entry),
// and magpie's market offers dozens of them. Promoting those to the main list
// would fill "what I can use now" with things I cannot use, so they wait in
// the collapsed region whatever the state of magpie's list.
export function partitionProviders(items = [], accountCounts = {}) {
  const cards = (Array.isArray(items) ? items : []).filter((item) => item && item.id);
  const magpieKnown = cards.some(
    (item) => item.presence === "both" || item.presence === "magpie-only",
  );
  const primary = [];
  const other = [];
  for (const provider of cards) {
    if (!providerIsSubscription(provider)) continue;
    if (provider.presence === "catalog") {
      other.push(provider);
      continue;
    }
    if (!magpieKnown || providerIsPrimary(provider)) primary.push(provider);
    else other.push(provider);
  }
  primary.sort(
    (left, right) =>
      accountCountOf(accountCounts, right.id) - accountCountOf(accountCounts, left.id) ||
      String(left.name || left.id).localeCompare(String(right.name || right.id)),
  );
  return { primary, other };
}

// A provider card's add entry comes from the installed-plugin scan, and that
// scan starts on the first /api/provider-sources read. The first answer
// therefore says `scanning: true` and carries no sign-in methods, so without a
// follow-up read every card would sit on "waiting for verification" with no
// entry until the user reloads the page by hand. The page follows the scan
// with a bounded number of extra reads; these are the bounds, and they are
// exported so the bound itself is testable.
export const PLUGIN_SCAN_POLL_INTERVAL_MS = 1200;
export const PLUGIN_SCAN_POLL_MAX_ATTEMPTS = 24;

// Pure decision: is there still a scan in flight whose result the cards need?
// A settled scan (`scanning: false`), including one that failed with an error,
// must not keep the loop alive.
export function shouldPollPluginScan(pluginScan) {
  return pluginScan?.scanning === true;
}

// The kinds a card marker can name. "pending" does not mean "nothing was
// found": it means the method is runnable but its kind is only confirmed when
// authorize() runs, so the card says "way to confirm" instead of "unknown".
// "device" is a real, confirmed kind (a device code the user confirms in the
// browser) and gets its own wording rather than falling back to "unknown".
export const METHOD_CATEGORY_TAGS = Object.freeze([
  "browser",
  "device",
  "form",
  "key",
  "local",
  "pending",
  "secret",
  "unknown",
]);

// The category of one scanned method. Prefer the scan's typed category; older
// shapes only carry the boolean `browser` and the type, so derive it from those.
export function methodCategory(method = {}) {
  const category = typeof method?.category === "string" ? method.category : "";
  if (METHOD_CATEGORY_TAGS.includes(category)) return category;
  if (method?.browser === true) return "browser";
  if (method?.type === "api" || method?.type === "key") return "key";
  return "unknown";
}

// The fields the chosen sign-in method asks for before it can start. The card
// already carries them, projected from the plugin's declared prompts (type, key,
// the plugin's own question and a select's options), so this only picks the
// right method's list. A method with no declared prompts yields an empty list
// and the dialog shows no extra fields.
export function signInMethodFields(provider = {}, label = "") {
  const methods = Array.isArray(provider?.authMethods) ? provider.authMethods : [];
  const wanted = typeof label === "string" ? label.trim() : "";
  const known = Array.isArray(provider?.signInMethods) ? provider.signInMethods : [];
  const fallback = typeof known[0] === "string" ? known[0].trim() : "";
  const method = wanted
    ? methods.find((item) => item?.label === wanted)
    : methods.find((item) => item?.label === fallback) ||
      methods.find(
        (item) =>
          item?.type === "oauth" && item?.runnable === true && methodCategory(item) !== "local",
      );
  const fields = Array.isArray(method?.fields) ? method.fields : [];
  return fields.filter((field) => field && typeof field.key === "string" && field.key);
}

// The marker text for one category, in the page's language. Kept next to
// methodCategory() so the kind -> wording mapping is testable without a DOM.
export function methodCategoryText(category, text = {}) {
  if (category === "browser") return text.providerMethodBrowserTag || "browser";
  if (category === "device") return text.providerMethodDeviceTag || "device code";
  if (category === "form") return text.providerMethodFormTag || "needs details";
  if (category === "key") return text.providerMethodKeyTag || "key";
  if (category === "local") return text.providerMethodLocalTag || "local session";
  if (category === "secret") return text.providerMethodSecretTag || "paste a token";
  if (category === "pending") return text.providerMethodPendingTag || "way to confirm";
  return text.providerMethodUnknownTag || "way to confirm";
}

// --- finding one card -----------------------------------------------------
//
// The tab holds two grids: what the user already signs in to, and everything
// else behind one collapsed section. Search has to cover both, because a
// provider that cannot be found is the same as a provider that is missing.
//
// A card matches when every word of the query appears in something the card
// says about itself: its name, the id the service knows it by, the id magpie
// uses for it, the plugin package that provides its sign-in, its description,
// or the label of a sign-in method. A blank query is not a search — it means
// "show everything", never "nothing matched".

function searchWords(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function providerSearchText(provider = {}, lang = "en") {
  const card = provider && typeof provider === "object" ? provider : {};
  const methods = Array.isArray(card.signInMethods) ? card.signInMethods : [];
  const details = Array.isArray(card.signInMethodDetails) ? card.signInMethodDetails : [];
  const parts = [
    card.id,
    card.name,
    card.agentId,
    card.signInProvider,
    // The description in the page's language, and in English as well: people
    // type a provider's English name on a Chinese page all the time, and a
    // search that refuses that is a search they stop using.
    localizedText(card.description, lang),
    localizedText(card.description, "en"),
    ...methods,
    ...details.map((detail) => detail?.label),
  ];
  return parts
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .toLowerCase();
}

export function providerMatchesQuery(provider, query, lang = "en") {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = providerSearchText(provider, lang);
  return words.every((word) => haystack.includes(word));
}

export function filterProviders(items, query, lang = "en") {
  const list = Array.isArray(items) ? items : [];
  const words = searchWords(query);
  if (words.length === 0) return list;
  return list.filter((provider) => providerMatchesQuery(provider, query, lang));
}

export function countAccountsByProvider(accounts = []) {
  const counts = {};
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!account || typeof account !== "object") continue;
    const provider = typeof account.provider === "string" ? account.provider.trim() : "";
    if (!provider) continue;
    counts[provider] = (counts[provider] || 0) + 1;
  }
  return counts;
}

export function filterProvidersByCategory(items = [], category = "all", accountCounts = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!category || category === "all") return list;
  if (category === "signable") return list.filter((item) => providerCanSignIn(item));
  if (category === "hasAccounts") {
    return list.filter((item) => item && accountCountOf(accountCounts, item.id) > 0);
  }
  if (category === "catalog") return list.filter((item) => item?.presence === "catalog");
  return list;
}
