// The accounts page provider picker: the pure partition/count/search helpers,
// the provider dimension of filterAccounts, and the read-file wiring that keeps
// the collapsed catalog exhaustive. No DOM and no browser is needed.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PROVIDERS,
  PRIMARY_PROVIDER_LIMIT,
  UNKNOWN_PROVIDER,
  accountProviderOptions,
  activeAccountFilterLabels,
  filterAccountProviderOptions,
  normalizeSelectedAccountProvider,
  partitionAccountProviders,
} from "../ui/account-provider-filter.js";
import { filterAccounts, sortAccounts } from "../ui/account-view.js";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");

const catalog = [
  { signInProvider: "qoder-cn", name: "Qoder CN" },
  { signInProvider: "workbuddy", name: "WorkBuddy" },
  { id: "cursor", name: "Cursor" },
];

// Six providers, deliberately uneven so the four-chip cut and the promoted
// selection are both exercised. Two accounts have no provider at all.
const accounts = [
  ...Array.from({ length: 6 }, (_, i) => ({ provider: "qoder-cn", key: `q${i}`, signedIn: i % 2 === 0 })),
  ...Array.from({ length: 5 }, (_, i) => ({ provider: "workbuddy", key: `w${i}`, signedIn: true })),
  ...Array.from({ length: 4 }, (_, i) => ({ provider: "minimax-code", key: `m${i}`, signedIn: false })),
  ...Array.from({ length: 3 }, (_, i) => ({ provider: "cursor", key: `c${i}`, signedIn: true })),
  { provider: "zcode", key: "z0", signedIn: true },
  { provider: "loomy", key: "l0", signedIn: false },
  { provider: "", key: "u0", signedIn: true },
  { key: "u1", signedIn: false },
];

test("accountProviderOptions counts the whole set and resolves catalog names", () => {
  const options = accountProviderOptions(accounts, catalog, { unknownLabel: "Unknown provider" });
  expect(options.map((item) => item.provider)).toEqual([
    "qoder-cn", "workbuddy", "minimax-code", "cursor", UNKNOWN_PROVIDER, "loomy", "zcode",
  ]);
  expect(options.map((item) => item.count)).toEqual([6, 5, 4, 3, 2, 1, 1]);
  // The label comes from the catalog the service already returned; an id that
  // is not listed keeps its own id rather than inventing a name.
  expect(options[0].label).toBe("Qoder CN");
  expect(options[2].label).toBe("minimax-code");
  expect(options[3].label).toBe("Cursor");
  expect(options[4].label).toBe("Unknown provider");
  // Every account is counted exactly once, including the two with no provider.
  expect(options.reduce((sum, item) => sum + item.count, 0)).toBe(accounts.length);
});

test("accountProviderOptions never throws on a missing or malformed list", () => {
  expect(accountProviderOptions()).toEqual([]);
  expect(accountProviderOptions(null, null)).toEqual([]);
  expect(accountProviderOptions([null, undefined, 7, "x"], [])).toEqual([
    { provider: UNKNOWN_PROVIDER, count: 4, label: "Unknown" },
  ]);
  // A whitespace-only provider is the same bucket as an absent one.
  expect(accountProviderOptions([{ provider: "  " }, { provider: "" }], [])[0].count).toBe(2);
});

test("ties break by label then id so the chip order is stable across refreshes", () => {
  const tied = [{ provider: "b" }, { provider: "a" }, { provider: "c" }];
  const first = accountProviderOptions(tied, []).map((item) => item.provider);
  const second = accountProviderOptions([...tied].reverse(), []).map((item) => item.provider);
  expect(first).toEqual(["a", "b", "c"]);
  expect(second).toEqual(first);
});

test("partitionAccountProviders keeps four in the main row and the rest collapsed", () => {
  const options = accountProviderOptions(accounts, catalog);
  const { primary, overflow, promoted } = partitionAccountProviders(options, ALL_PROVIDERS);
  expect(PRIMARY_PROVIDER_LIMIT).toBe(4);
  expect(primary.map((item) => item.provider)).toEqual(["qoder-cn", "workbuddy", "minimax-code", "cursor"]);
  expect(overflow.map((item) => item.provider)).toEqual([UNKNOWN_PROVIDER, "loomy", "zcode"]);
  expect(promoted).toBeNull();
  // Nothing is lost by the split: main row plus collapsed region is the whole set.
  expect(primary.length + overflow.length).toBe(options.length);
});

test("a selection from the collapsed region is promoted, never duplicated or dropped", () => {
  const options = accountProviderOptions(accounts, catalog);
  const { primary, overflow, promoted } = partitionAccountProviders(options, "zcode");
  expect(promoted?.provider).toBe("zcode");
  expect(primary.map((item) => item.provider)).toEqual([
    "qoder-cn", "workbuddy", "minimax-code", "cursor", "zcode",
  ]);
  expect(overflow.map((item) => item.provider)).toEqual([UNKNOWN_PROVIDER, "loomy"]);
  expect(primary.length + overflow.length).toBe(options.length);
  expect(new Set([...primary, ...overflow].map((item) => item.provider)).size).toBe(options.length);
  // Selecting one that is already in the main row changes nothing.
  const unchanged = partitionAccountProviders(options, "qoder-cn");
  expect(unchanged.promoted).toBeNull();
  expect(unchanged.primary).toHaveLength(4);
  expect(unchanged.overflow).toHaveLength(3);
});

test("partitionAccountProviders degrades safely on a short or empty list", () => {
  expect(partitionAccountProviders([], ALL_PROVIDERS)).toEqual({ primary: [], overflow: [], promoted: null });
  expect(partitionAccountProviders()).toEqual({ primary: [], overflow: [], promoted: null });
  const two = [{ provider: "a", count: 2, label: "A" }, { provider: "b", count: 1, label: "B" }];
  expect(partitionAccountProviders(two, ALL_PROVIDERS).overflow).toEqual([]);
  // A stale selection that is not in the list must not add a phantom chip.
  expect(partitionAccountProviders(two, "gone").primary).toEqual(two);
});

test("normalizeSelectedAccountProvider falls back to all when the provider is gone", () => {
  const options = accountProviderOptions(accounts, catalog);
  expect(normalizeSelectedAccountProvider("qoder-cn", options)).toBe("qoder-cn");
  expect(normalizeSelectedAccountProvider(UNKNOWN_PROVIDER, options)).toBe(UNKNOWN_PROVIDER);
  expect(normalizeSelectedAccountProvider("deleted-provider", options)).toBe(ALL_PROVIDERS);
  expect(normalizeSelectedAccountProvider(ALL_PROVIDERS, [])).toBe(ALL_PROVIDERS);
  expect(normalizeSelectedAccountProvider(undefined, options)).toBe(ALL_PROVIDERS);
  expect(normalizeSelectedAccountProvider(null, null)).toBe(ALL_PROVIDERS);
});

test("the collapsed search matches the display name and the raw id", () => {
  const options = accountProviderOptions(accounts, catalog, { unknownLabel: "Unknown provider" });
  expect(filterAccountProviderOptions(options, "qoder").map((item) => item.provider)).toEqual(["qoder-cn"]);
  // The human name is not the id: searching the name must still find it.
  expect(filterAccountProviderOptions(options, "QODER CN").map((item) => item.provider)).toEqual(["qoder-cn"]);
  expect(filterAccountProviderOptions(options, "unknown").map((item) => item.provider)).toEqual([UNKNOWN_PROVIDER]);
  expect(filterAccountProviderOptions(options, "  work  ").map((item) => item.provider))
    .toEqual(["workbuddy"]);
  // An empty query is the exhaustive list, not an empty one.
  expect(filterAccountProviderOptions(options, "")).toEqual(options);
  expect(filterAccountProviderOptions(options, "   ")).toEqual(options);
  expect(filterAccountProviderOptions(options, "no-such-provider")).toEqual([]);
  expect(filterAccountProviderOptions(null, "x")).toEqual([]);
});

test("filterAccounts narrows by provider and still combines with status and search", () => {
  const only = filterAccounts(accounts, { provider: "qoder-cn" });
  expect(only).toHaveLength(6);
  expect(only.every((item) => item.provider === "qoder-cn")).toBe(true);
  // Provider and status are ANDed, not ORed.
  expect(filterAccounts(accounts, { provider: "qoder-cn", filter: "signedIn" })).toHaveLength(3);
  expect(filterAccounts(accounts, { provider: "qoder-cn", filter: "signedOut" })).toHaveLength(3);
  // All three at once.
  expect(filterAccounts(accounts, { provider: "qoder-cn", filter: "signedIn", query: "q0" }))
    .toEqual([accounts[0]]);
  expect(filterAccounts(accounts, { provider: "qoder-cn", query: "w0" })).toEqual([]);
  // The unknown bucket is exactly the accounts with no provider.
  expect(filterAccounts(accounts, { provider: UNKNOWN_PROVIDER }).map((item) => item.key))
    .toEqual(["u0", "u1"]);
  // Omitting the dimension keeps the previous behaviour byte for byte.
  expect(filterAccounts(accounts, {})).toHaveLength(accounts.length);
  expect(filterAccounts(accounts, { provider: ALL_PROVIDERS })).toHaveLength(accounts.length);
  expect(filterAccounts(accounts, { filter: "signedIn" }))
    .toEqual(filterAccounts(accounts, { filter: "signedIn", provider: ALL_PROVIDERS }));
});

test("sorting by provider uses the display name the row prints", () => {
  // Raw ids sort cursor < qoder-cn < workbuddy; display names sort
  // Cursor < Qoder CN < WorkBuddy too, but "zcode" vs "ZCode" is the real case:
  // the label is what the user reads, so it must drive the order.
  const labelled = [
    { provider: "aaa", providerLabel: "Zebra", key: "1" },
    { provider: "zzz", providerLabel: "Alpha", key: "2" },
  ];
  expect(sortAccounts(labelled, "provider").map((item) => item.providerLabel)).toEqual(["Alpha", "Zebra"]);
  // Filtering on the display name works because the page passes the label in.
  expect(filterAccounts(labelled, { query: "zebra" })).toHaveLength(1);
});

test("activeAccountFilterLabels names every narrowing and nothing when there is none", () => {
  expect(activeAccountFilterLabels()).toEqual([]);
  expect(activeAccountFilterLabels({ provider: ALL_PROVIDERS, status: "all", query: "  " })).toEqual([]);
  expect(activeAccountFilterLabels({
    provider: "qoder-cn",
    providerLabel: "Qoder CN",
    status: "signedIn",
    statusLabels: { signedIn: "Signed in", signedOut: "Signed out" },
    query: "work",
    allLabel: "Search",
  })).toEqual(["Qoder CN", "Signed in", "Search “work”"]);
  // Without a resolved label the raw id is still shown, never an empty chip.
  expect(activeAccountFilterLabels({ provider: "qoder-cn" })).toEqual(["qoder-cn"]);
  expect(activeAccountFilterLabels({ provider: UNKNOWN_PROVIDER, unknownLabel: "Unknown provider" }))
    .toEqual(["Unknown provider"]);
});

test("the picker ships every control and the collapsed region stays exhaustive", () => {
  for (const id of [
    "account-provider-group", "account-provider-filter-label", "account-provider-filter-hint",
    "account-provider-chips", "account-provider-more-wrap", "account-provider-more-toggle",
    "account-provider-more-label", "account-provider-more-count", "account-provider-panel",
    "account-provider-search-label", "account-provider-search", "account-provider-options",
    "account-provider-empty", "account-active-filters", "account-filter-reset",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
  // The page is hosted in a sandboxed frame and the markup contract allows
  // exactly one <details>; the catalog is a button plus a hidden panel instead.
  expect((html.match(/<details\b/g) || []).length).toBe(1);
  expect(html).toContain('aria-controls="account-provider-panel"');
  expect(html).toContain('aria-expanded="false"');
  // The catalog lists every provider, including the promoted ones: the "all"
  // entry is prepended to the full option list, not to the overflow slice.
  expect(app).toContain("filterAccountProviderOptions([all, ...options], accountProviderQuery)");
  expect(app).toContain("renderAccountProviderOptions(options)");
});

test("the picker is wired to real state and never invents a second data source", () => {
  for (const needle of [
    'byId("account-provider-more-toggle").addEventListener',
    'byId("account-provider-search").addEventListener',
    'byId("account-filter-reset").addEventListener',
    "accountProviderOptions(accountIdentities, providerCatalog",
    "normalizeSelectedAccountProvider(accountProvider, options)",
    "partitionAccountProviders(options, accountProvider)",
    "filterAccounts(accountIdentities.map(accountForList)",
    "provider: accountProvider,",
    "renderAccountFilterSummary()",
    "resetAccountFilters()",
  ]) {
    expect(app).toContain(needle);
  }
  // Chips are built from the identities already on the page: no extra fetch,
  // no storage, no injection sink.
  expect(app).not.toMatch(/innerHTML|localStorage|sessionStorage/);
  expect(app).toContain('button.type = "button"');
  expect(app).toContain('button.setAttribute("aria-pressed", String(active))');
  // A provider picked out of the collapsed list joins the main row and is
  // marked, so the current filter is visible without reopening the catalog.
  expect(app).toContain('button.classList.toggle("is-selected-extra", Boolean(extra));');
  expect(app).toContain("promoted?.provider === option.provider");
  expect(css).toContain(".provider-chip.is-selected-extra {");
  // A dismissed popover must not trap the keyboard.
  expect(app).toContain('nativeEvent.key !== "Escape"');
  expect(app).toContain('byId("account-provider-more-wrap").contains(nativeEvent.target)');
});

test("the picker survives a narrow viewport and both themes", () => {
  // Every colour comes from a token, so the host theme switch reaches it.
  const block = css.slice(css.indexOf("/* --- account provider navigation"), css.indexOf("/* --- score bar"));
  expect(block.length).toBeGreaterThan(0);
  expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(block).toContain("var(--paper)");
  expect(block).toContain("var(--ink)");
  expect(block).toContain("var(--red)");
  // The popover is re-anchored on a phone instead of hanging off the edge.
  const mobile = css.slice(css.indexOf("@media (max-width: 780px)"));
  expect(mobile).toContain(".account-provider-group { flex: 1 1 100%; }");
  expect(mobile).toContain(".provider-more-panel { left: 0; right: 0; width: auto; }");
  expect(mobile).toContain(".active-filter-summary { max-width: none; text-align: left; }");
});