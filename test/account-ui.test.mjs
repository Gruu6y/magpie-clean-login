// The pure helpers behind the account identity list and the "continue with an
// existing identity" picker. Read-file style like the other UI tests: the
// helpers are imported, the wiring is checked against app.js/index.html.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountCheckCancelPath,
  accountCheckPath,
  accountExitPath,
  accountIdentityPath,
  accountIdentityView,
  accountLabel,
  defaultAccountKey,
  retiredAccounts,
  signInAccount,
} from "../ui/account-state.js";
import { signInPayload } from "../ui/signin-state.js";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");

const accounts = [
  { provider: "workbuddy", key: "workbuddy", accountId: "signed-in", uid: "u-1", signedIn: true },
  { provider: "workbuddy", key: "workbuddy#a", accountId: "retired-a", uid: "u-2", signedInAt: "2026-11-02T09:00:00.000Z", signedIn: false },
  { provider: "workbuddy", key: "workbuddy#b", accountId: "", uid: "u-3", signedInAt: "2026-11-01T09:00:00.000Z", signedIn: false },
  { provider: "other", key: "other", accountId: "elsewhere", uid: "u-4", signedIn: false },
];

test("accountLabel prefers the account name, then the uid, then the key", () => {
  expect(accountLabel({ accountId: "me", uid: "u", key: "k" })).toBe("me");
  expect(accountLabel({ accountId: "  ", uid: "u", key: "k" })).toBe("u");
  expect(accountLabel({ accountId: "", uid: "", key: "k" })).toBe("k");
  expect(accountLabel({})).toBe("");
  expect(accountLabel(null)).toBe("");
});

test("retiredAccounts keeps only the provider's signed-out identities", () => {
  expect(retiredAccounts(accounts, "workbuddy").map((account) => account.key)).toEqual([
    "workbuddy#a",
    "workbuddy#b",
  ]);
  // The signed-in one and other providers are not offered.
  expect(retiredAccounts(accounts, "workbuddy").some((account) => account.signedIn === true)).toBe(false);
  expect(retiredAccounts(accounts, "nobody")).toEqual([]);
  expect(retiredAccounts(null, "workbuddy")).toEqual([]);
});

test("defaultAccountKey preselects only when there is exactly one identity", () => {
  const single = [{ provider: "p", key: "p#only", signedIn: false }];
  expect(defaultAccountKey(single, "p")).toBe("p#only");
  expect(defaultAccountKey(accounts, "workbuddy")).toBe("");
  expect(defaultAccountKey(accounts, "other")).toBe("other");
  expect(defaultAccountKey([], "p")).toBe("");
});

test("signInAccount carries only the key, and nothing when blank", () => {
  expect(signInAccount("workbuddy#a")).toEqual({ key: "workbuddy#a" });
  expect(signInAccount("  workbuddy#a  ")).toEqual({ key: "workbuddy#a" });
  expect(signInAccount("")).toBeNull();
  expect(signInAccount("   ")).toBeNull();
  expect(signInAccount(null)).toBeNull();
  expect(signInAccount({ key: "x" })).toBeNull();
});

test("signInPayload adds the account only when one was chosen", () => {
  expect(signInPayload("workbuddy", null)).toEqual({ provider: "workbuddy", proxy: null });
  expect(signInPayload("workbuddy", null, null, "")).toEqual({
    provider: "workbuddy",
    proxy: null,
  });
  expect(signInPayload("workbuddy", null, null, "workbuddy#a")).toEqual({
    provider: "workbuddy",
    proxy: null,
    account: { key: "workbuddy#a" },
  });
  // The account rides beside the method label, not instead of it.
  expect(signInPayload("workbuddy", null, "Browser", "workbuddy#a")).toEqual({
    provider: "workbuddy",
    proxy: null,
    methodLabel: "Browser",
    account: { key: "workbuddy#a" },
  });
});

test("a rotation travels only as a boolean true beside a real key", () => {
  expect(signInAccount("workbuddy#a", true)).toEqual({ key: "workbuddy#a", rotate: true });
  // A plain continue sends exactly what it always sent.
  expect(signInAccount("workbuddy#a")).toEqual({ key: "workbuddy#a" });
  expect(signInAccount("workbuddy#a", false)).toEqual({ key: "workbuddy#a" });
  // Truthy is not consent: replacing an account's machine is deliberate.
  for (const rotate of ["true", "yes", 1, {}, null, undefined]) {
    expect(signInAccount("workbuddy#a", rotate)).toEqual({ key: "workbuddy#a" });
  }
  // No key, no rotation -- there is no account to give a machine to.
  for (const key of ["", "   ", null, { key: "x" }]) {
    expect(signInAccount(key, true)).toBeNull();
  }
});

test("signInPayload carries a rotation beside the account and the method", () => {
  expect(signInPayload("workbuddy", null, "Browser", "workbuddy#a", null, true)).toEqual({
    provider: "workbuddy",
    proxy: null,
    methodLabel: "Browser",
    account: { key: "workbuddy#a", rotate: true },
  });
  // Without an account the flag has nowhere to go and is dropped entirely.
  expect(signInPayload("workbuddy", null, null, "", null, true)).toEqual({
    provider: "workbuddy",
    proxy: null,
  });
  // The five-argument call every existing caller makes is unchanged.
  expect(signInPayload("workbuddy", null, null, "workbuddy#a")).toEqual({
    provider: "workbuddy",
    proxy: null,
    account: { key: "workbuddy#a" },
  });
});

test("a signed-in account can ask for a new machine, and the dialog says which it will do", () => {
  // The gap this closes: clearing an identity is refused while magpie holds the
  // credential, so a signed-in account had no door at all.
  expect(app).toContain("if (view.signedIn) {");
  expect(app).toContain("openSignInDialog(view.provider, { accountKey: view.key, rotate: true })");
  expect(app).toContain("rotate.title = text.accountRotateTitle");
  expect(app).toContain("rotate: options.rotate === true");
  expect(app).toContain("context.rotate === true,");
  // The picker cannot fall back to 'new account' mid-renewal, which would send
  // no key and quietly turn the request into an ordinary sign-in.
  expect(app).toContain("select.disabled = signInContext?.rotate === true");
  expect(app).toContain("function signInIdentityHint()");
  // Three outcomes, three sentences: a discarded pin must not read like a
  // renewed one.
  expect(app).toContain("flow?.rotated");
  expect(app).toContain("flow?.pinDiscarded");
  for (const key of [
    "accountRotate",
    "accountRotateTitle",
    "signInRotateHint",
    "signInDoneRotated",
    "signInDoneKeptPin",
  ]) {
    const count = (app.match(new RegExp(`\\b${key}:`, "g")) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  }
});

test("accountIdentityPath URL-encodes both segments", () => {
  expect(accountIdentityPath("workbuddy", "workbuddy#ab12")).toBe(
    "api/accounts/workbuddy/workbuddy%23ab12",
  );
  expect(accountIdentityPath("a/b", "c d")).toBe("api/accounts/a%2Fb/c%20d");
});

test("accountExitPath URL-encodes both segments", () => {
  expect(accountExitPath("workbuddy", "workbuddy#ab12")).toBe(
    "api/accounts/workbuddy/workbuddy%23ab12/exit",
  );
  expect(accountExitPath("a/b", "c d")).toBe("api/accounts/a%2Fb/c%20d/exit");
});

test("accountIdentityView exposes no fingerprint and no path", () => {
  const view = accountIdentityView(accounts[1]);
  expect(view).toEqual({
    label: "retired-a",
    uid: "u-2",
    retiredAt: "2026-11-02T09:00:00.000Z",
    provider: "workbuddy",
    key: "workbuddy#a",
    signedIn: false,
    note: "",
    lastLogin: null,
    lastCheck: null,
  });
  // Still never a fingerprint, a path, or a credential.
  expect(Object.keys(view).some((key) => /fingerprint|path|password|host|port/i.test(key))).toBe(false);
  expect(accountIdentityView({}).label).toBe("");
});

test("the check endpoints URL-encode both segments", () => {
  expect(accountCheckPath("workbuddy", "workbuddy#ab12")).toBe(
    "api/accounts/workbuddy/workbuddy%23ab12/check",
  );
  expect(accountCheckCancelPath("a/b", "c d")).toBe(
    "api/accounts/a%2Fb/c%20d/check/cancel",
  );
});

test("the sign-in dialog offers the identity picker and posts the chosen key", () => {
  const dialog = /<dialog id="signin-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(dialog).toContain('id="signin-account"');
  expect(dialog).toContain('id="signin-account-field"');
  expect(dialog).toContain('id="signin-account-hint"');
  expect(app).toContain("retiredAccounts(accountIdentities, provider)");
  expect(app).toContain("defaultAccountKey(accountIdentities, provider)");
  expect(app).toContain("selectedSignInAccount()");
});

test("kept identities are managed on the accounts page, not a providers card", () => {
  // The old identities card sat on the Providers tab and duplicated the
  // accounts table; it is gone, and the clear entry now lives in the table.
  expect(html).not.toContain('id="account-identities"');
  expect(html).not.toContain('id="account-identities-list"');
  expect(html).not.toContain('id="identities-retry"');
  expect(app).not.toContain("function renderIdentities()");
  expect(app).not.toContain("function identityRow(account)");
  // Clearing an identity is still a real two-step action that reloads the list.
  expect(app).toContain("function askClearIdentity(account)");
  expect(app).toContain('api("api/accounts")');
  expect(app).toContain("accountIdentityPath(account.provider, account.key)");
  expect(app).toContain('method: "DELETE"');
  expect(app).toContain("loadAccountIdentities()");
  expect(app).toContain("clear.disabled = clearingAccount");
  // Every new string exists in all four language tables.
  for (const key of [
    "identitiesLastSignedIn",
    "identitiesClearTitle",
    "identitiesClearCopy",
    "identitiesClearConfirm",
    "accountsCleared",
    "signInAccountLabel",
    "signInAccountHint",
    "signInAccountNew",
    // accounts page v2 copy, also counted in all four tables
    "accountsTitle",
    "accountSearchLabel",
    "accountFilterAll",
    "gradeDisclaimer",
    "accountDetailNoteSave",
    "accountCheckFailedNoVerdict",
    "checkErrorInternal",
    "toastNoteSaved",
  ]) {
    const count = (app.match(new RegExp(`\\b${key}:`, "g")) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  }
});

test("the accounts tab and its dialogs are wired to real requests", () => {
  expect(html).toContain('id="tab-accounts"');
  expect(html).toContain('id="panel-accounts"');
  expect(html).toContain('id="account-detail-dialog"');
  expect(html).toContain('id="account-check-dialog"');
  expect(app).toContain('byId("tab-accounts").addEventListener');
  expect(app).toContain('byId("account-check-start").addEventListener');
  expect(app).toContain("openSignInDialog(provider, { accountKey: view.key })");
  expect(app).toContain("accountCheckPath(context.provider, context.key)");
  expect(app).toContain('method: "PATCH"');
});

test("the list shows the account's current exit and the detail picker reuses the sign-in node list", () => {
  // The list's last-login cell shows the account's current exit, falling back
  // to the exit of the last login only when no current one is set.
  expect(app).toContain(
    "formatExit(view.exit ?? view.lastLogin, text.accountExitDirect, accountExitLabels())",
  );
  // The detail dropdown orders its nodes like the sign-in dialog and formats
  // each option through the same live latency helper.
  expect(app).toContain("orderSignInProxies(");
  expect(app).toContain("formatSignInProxyOption(");
  expect(app).toContain("detailExitTarget()");
  expect(app).toContain("detailExitTesting.has(proxy.id) || rowTests.has(proxy.id)");
  // Opening the detail probes the nodes in the background, and closing aborts
  // the sweep and clears its testing state.
  expect(app).toContain("await probeSignInProxies(");
  expect(app).toContain("detailExitController.abort()");
  expect(app).toContain("detailExitTesting.clear()");
});

test("both exits pickers share one probe request and one answer fold", () => {
  expect(app).toContain("function probeProxy(proxy, target, signal) {");
  expect(app).toContain("function foldProbeAnswer(list, proxy, data, networkErrorText) {");
  expect(app).toContain("foldProbeAnswer(proxies, proxy, data, text.errorNetwork)");
  expect(app).toContain("foldProbeAnswer(detailExitProxies, proxy, data, text.errorNetwork)");
  expect(
    (app.match(/\(proxy, \{ signal \}\) => probeProxy\(proxy, target, signal\)/g) || []).length,
  ).toBe(2);
});

test("the detail picker keeps the user's mode across probe redraws", () => {
  // The mode options are rebuilt on every probe redraw, so the picker must
  // preserve the user's choice as well as node ids. The key guard keeps a
  // value left by the previous dialog from counting as this dialog's choice.
  expect(app).toContain("let detailExitRenderedFor = null;");
  expect(app).toContain('const key = accountDetailContext ? accountDetailContext.provider + "\\u0000" + accountDetailContext.key : "";');
  expect(app).toContain('const previous = detailExitRenderedFor === key ? select.value : "";');
  for (const mode of ["__inherit__", "__direct__", "__custom__"]) {
    expect(app).toContain(`previous === "${mode}" ||`);
  }
  expect(app).toContain("ordered.some((proxy) => proxy.id === previous)");
  expect(app).toContain("detailExitRenderedFor = key;");
  expect(app).toContain("detailExitRenderedFor = null;");
  // A detail probe mutates only its own shallow copy of the node list.
  expect(app).toContain("detailExitProxies = proxies.map((proxy) => ({ ...proxy }));");
});

test("account rows and detail dialog wire fingerprint browser open/close, exitChanged, and all error codes", () => {
  // Detail dialog exposes the browser button and status/notice region.
  const detail = /<dialog id="account-detail-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(detail).toContain('id="account-detail-browser"');
  expect(detail).toContain('id="account-detail-browser-box"');
  expect(detail).toContain('id="account-detail-browser-status"');
  expect(detail).toContain('id="account-detail-browser-notice"');

  // Row and detail dialog call real GET/POST/DELETE /api/accounts/:provider/:key/browser routes.
  expect(app).toContain("accountBrowserPath(provider, key)");
  expect(app).toContain('api(accountBrowserPath(provider, key), { method: "POST", body: {} })');
  expect(app).toContain('api(accountBrowserPath(provider, key), { method: "DELETE" })');
  expect(app).toContain("api(accountBrowserPath(context.provider, context.key))");
  expect(app).toContain('byId("account-detail-browser").addEventListener("click", toggleBrowserFromDetail)');

  // Per-account loading/disabled state and no-fingerprint guard.
  expect(app).toContain("const accountBrowserBusy = new Map();");
  expect(app).toContain("(!browserOpen && !hasFingerprint)");
  expect(app).toContain("(!open && !hasFingerprint)");
  expect(app).toContain("browserStateSummary(view.browser, accountBrowserLabels())");

  // Opening detail refreshes browser state; saving exit immediately redraws browser status/exitChanged.
  const openDetail = /function openAccountDetail\(account\)[\s\S]*?\n}\n/.exec(app)?.[0] || "";
  expect(openDetail).toContain("renderDetailBrowser();");
  expect(openDetail).toContain("void loadAccountBrowser(accountDetailContext);");
  const saveExit = /async function saveAccountExit\(\)[\s\S]*?\n}\n/.exec(app)?.[0] || "";
  expect(saveExit).toContain("renderDetailBrowser();");
  expect(saveExit.indexOf("accountIdentities[index] = data.account")).toBeLessThan(
    saveExit.indexOf("renderDetailBrowser();"),
  );

  // All backend error codes are mapped in accountBrowserErrorKeys, and browser_open
  // is also mapped in shared error/account/hosting error tables.
  const browserErrorsBlock = /const accountBrowserErrorKeys = \{[\s\S]*?\};/.exec(app)?.[0] || "";
  for (const code of [
    "identity_missing",
    "executable_missing",
    "runtime_missing",
    "browser_already_open",
    "browser_open",
    "signin_running",
    "renewal_running",
    "providers_invalid",
    "providers_unreadable",
    "invalid_exit_url",
    "exit_missing",
    "exit_unknown",
    "launch_failed",
    "launch_timeout",
  ]) {
    expect(browserErrorsBlock).toContain(`${code}:`);
  }
  expect(app).toContain('browser_open: "errorAccountBrowserOpen"');
});
