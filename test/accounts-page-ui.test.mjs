// Read-file checks for the accounts page v2: the markup, the app wiring, the
// four language tables and the mobile label stylesheet. No DOM and no browser
// is needed — the real UI is served to the launcher frame, not started here.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buttonIds } from "./button-ids.mjs";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");
const view = readFileSync(join(root, "ui", "account-view.js"), "utf8");
const state = readFileSync(join(root, "ui", "account-state.js"), "utf8");

// Every <button> id in ui/index.html. The list lives in test/button-ids.mjs so
// this suite and test/server.test.mjs cannot drift into two copies only one of
// which a pull request updated.

test("the accounts tab and panel ship every control", () => {
  for (const id of [
    "tab-accounts", "tab-accounts-label", "account-count", "panel-accounts",
    "accounts-title", "accounts-copy", "accounts-refresh", "accounts-notice",
    "account-toolbar", "account-search", "account-search-label",
    "account-sort", "account-sort-label", "account-sort-last-login",
    "account-sort-name", "account-sort-provider", "account-sort-grade",
    "account-filters", "account-filter-label", "account-filter-chips",
    "account-filter-count", "grade-legend", "grade-legend-label",
    "grade-a", "grade-b", "grade-c", "grade-d", "grade-disclaimer",
    "account-table", "accounts-list", "accounts-empty",
    "account-col-name", "account-col-fingerprint", "account-col-last-login",
    "account-col-check", "account-col-status", "account-col-actions",
    "toasts",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
  for (const value of ["all", "signedIn", "signedOut"]) {
    expect(html).toContain(`data-account-filter="${value}"`);
  }
  // Six columns, in the contract's order.
  const head = /<div class="proxy-table-head account-table-head"[\s\S]*?<\/div>/.exec(html)?.[0] || "";
  for (const id of [
    "account-col-name", "account-col-fingerprint", "account-col-last-login",
    "account-col-check", "account-col-status", "account-col-actions",
  ]) {
    expect(head).toContain(`id="${id}"`);
  }
  expect(html).toContain('id="account-detail-dialog"');
  expect(html).toContain('id="account-check-dialog"');
  expect(html).toContain('id="account-hosting-dialog"');
  expect(html).toContain('id="account-check-proxy"');
  expect(html).toContain('id="account-detail-note"');
  expect(html).toContain('id="account-detail-exit"');
  expect(html).toContain('id="account-detail-exit-label"');
  expect(html).toContain('id="account-detail-exit-hint"');
  expect(html).toContain('id="account-detail-exit-status"');
  expect(html).toContain('id="account-detail-exit-save"');
  expect(html).toContain('id="toasts"');
});

test("both dialogs ship their four check states and real footer controls", () => {
  for (const id of [
    "account-check-setup", "account-check-running", "account-check-result",
    "account-check-failed", "account-check-error", "account-check-grade",
    "account-check-summary", "account-check-verdict", "account-check-lines",
    "account-check-exit", "account-check-time", "account-check-failed-title",
    "account-check-failed-detail", "account-check-failed-lines",
    "account-detail-facts", "account-detail-history", "account-detail-error",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
});

test("every button is type=button, has an id, and is really wired", () => {
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  expect(buttons.length).toBe(buttonIds.length);
  for (const tag of buttons) {
    expect(tag).toContain('type="button"');
    expect(tag).not.toContain('type="submit"');
  }
  for (const id of buttonIds) {
    expect(html).toContain(`id="${id}"`);
    if (id !== "save-proxy") {
      expect(app).toContain(`byId("${id}").addEventListener`);
    }
  }
  // No demonstration markup, no injection sink, no placeholder actions.
  expect(html).not.toMatch(/innerHTML|mock|preview|data-add|account-menu/i);
  expect(app).not.toMatch(/innerHTML|\bmock\b|simulat|preview|example\.com|data-add/i);
  expect(view).not.toMatch(/innerHTML|\bmock\b|simulat|preview/i);
  expect(state).not.toMatch(/innerHTML|\bmock\b|simulat|preview/i);
});

test("the page only reads real endpoints and never invents a verdict", () => {
  for (const needle of [
    'api("api/accounts")',
    'api("api/proxies")',
    'api("api/accounts")',
    'method: "PATCH"',
    'method: "POST"',
    'body: { note }',
    'body: { proxyId }',
    "accountCheckPath(context.provider, context.key)",
    "accountExitPath(",
    'byId("account-detail-exit-save").addEventListener',
    "loadAccountExit",
    "saveAccountExit",
    "${accountCheckPath(context.provider, context.key)}/cancel",
    "ACCOUNT_CHECK_POLL_MS = 800",
    "serverErrorText(error)",
    "loadAccountIdentities()",
    "renderAccounts()",
    "formatCheckSummary(job",
    "formatExit(",
    "filterAccounts(accountIdentities",
    "sortAccounts(",
    "openSignInDialog(provider, { accountKey: view.key })",
    "askClearIdentity(account)",
  ]) {
    expect(app).toContain(needle);
  }
  // Failure never overwrites the last verdict: the server is re-read.
  expect(app).toContain("renderCheckFailed(context.job, context.lastCheck)");
  expect(app).toContain("accountCheckFailedNoVerdict");
  expect(app).toContain("accountCheckFailedKeepPrevious");
});

test("mobile cells show their own field labels", () => {
  expect(app).toContain('setAttribute("data-label", label)');
  expect(css).toContain("@media (max-width: 940px)");
  expect(css).toContain("content: attr(data-label)");
});

test("every new string exists in all four language tables", () => {
  const keys = [
    "accounts", "accountsTitle", "accountsCopy", "accountsRefresh",
    "accountsRefreshing", "accountsRefreshed",
    "accountsImport", "accountsImportTitle", "accountsImportCopy",
    "accountsImportNew", "accountsImportExisting", "accountsImportSkipped",
    "accountsImportReloginPlugin", "accountsImportReloginNative",
    "accountsImportReloginNone", "accountsImportConfirm", "accountsImportCancel",
    "accountsImportBusy", "accountsImported", "accountsImportFailed",
    "accountsImportEmpty", "accountsImportNothing",
    "accountSearchLabel", "accountSearchPlaceholder", "accountSortLabel", "accountSortLastLogin",
    "accountSortName", "accountSortProvider", "accountSortGrade",
    "accountFilterLabel", "accountFilterAll", "accountFilterSignedIn",
    "accountFilterSignedOut", "accountFilterCount", "accountEmpty",
    "accountEmptyCopy", "accountNoMatch", "accountColName",
    "accountColFingerprint", "accountColLastLogin", "accountColCheck",
    "accountColStatus", "accountColActions",
    "accountSignedIn", "accountSignedOut",
    "accountCheckNone", "accountChecking", "accountFingerprintPinned",
    "accountFingerprintNone", "accountExitDirect", "accountLastLoginAt",
    "accountCheckExposure", "accountRelogin", "accountReloginTitle",
    "accountCheck", "accountDetail", "accountClear", "accountCheckBusy",
    "gradeLegendLabel", "gradeA", "gradeB", "gradeC", "gradeD",
    "gradeDisclaimer", "gradeMeaningA", "gradeMeaningB", "gradeMeaningC",
    "gradeMeaningD", "accountDetailTitle", "accountDetailProvider",
    "accountDetailKey", "accountDetailFingerprint", "accountDetailPinnedAt",
    "accountDetailLastLoginExit", "accountDetailStatus", "accountDetailNote",
    "accountDetailNoteSave", "accountDetailNoteSaving", "accountDetailNoteHint",
    "accountDetailNoteEmpty", "accountDetailSaved",
    "accountDetailNoteTooLong", "accountDetailSigninHint",
    "accountDetailRetiredHint", "accountDetailHistoryTitle",
    "accountDetailHistoryEmpty", "accountDetailHistoryLine",
    "accountDetailDismiss", "accountCheckFailedExit", "accountCheckTitle",
    "accountCheckCopy", "accountCheckProxyLabel", "accountCheckProxyDirect",
    "accountCheckProxyHint", "accountCheckTargetLabel", "accountCheckEtaLabel",
    "accountCheckEtaValue", "accountCheckExitLabel", "accountCheckTimeLabel",
    "accountCheckGradeLabel", "accountCheckIdentityLabel", "accountCheckNote",
    "accountCheckStart", "accountCheckRunningOpening",
    "accountCheckRunningReading", "accountCheckElapsed", "accountCheckCancel",
    "accountCheckCancelled", "accountCheckSummary", "accountCheckNoExposure",
    "accountCheckResultNote", "accountCheckAgain", "accountCheckReexit",
    "accountCheckDetails", "accountCheckFailedTitle",
    "accountCheckFailedDetail", "accountCheckFailedNoVerdict",
    "accountCheckFailedKeepPrevious", "accountCheckFailedNoPrevious",
    "accountCheckRetry", "accountCheckChangeExit", "accountCheckDismiss",
    "checkErrorBrowserMissing", "checkErrorExecutableMissing",
    "checkErrorIdentityMissing", "checkErrorLaunchFailed",
    "checkErrorLaunchTimeout", "checkErrorPageTimeout",
    "checkErrorVerdictMissing", "checkErrorCancelled",
    "checkErrorProxyNotFound", "checkErrorAccountNotFound",
    "checkErrorCheckBusy", "checkErrorInternal", "checkErrorUnknown",
    "errorInvalidNote", "toastNoteSaved", "toastCheckDone",
    "toastCheckCancelled", "toastRefreshed",
  ];
  for (const key of keys) {
    const count = (app.match(new RegExp(`\\b${key}:`, "g")) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  }
  // The four tables carry exactly the same key set: no language is missing a
  // new string and no stray key was added to only one table.
  const tables = [...app.matchAll(/^  (?:en|"zh-Hans"|"zh-Hant"|ja): \{([\s\S]*?)^  \},$/gm)]
    .map((match) => new Set([...match[1].matchAll(/^    ([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1])));
  expect(tables.length).toBe(4);
  for (const table of tables) expect(table).toEqual(tables[0]);
  expect(tables[0].size).toBeGreaterThan(280);
});

test("a paused hosted renewal raises a page-wide banner", () => {
  // The one thing the page must say without being asked: hosting switched
  // itself off, so this account will not be renewed again until someone looks.
  expect(html).toContain('id="hosting-alert"');
  expect(html).toContain('id="hosting-alert-text"');
  expect(html).toContain('role="status"');
  expect(app).toContain("function renderHostingAlert()");
  expect(app).toContain("renderHostingAlert();");
  expect(app).toContain("text.hostingAlertText.replace(");
  for (const key of ["hostingAlertText", "hostingAlertOpen", "hostingAlertDismiss"]) {
    expect((app.match(new RegExp(key + ":", "g")) || []).length).toBe(4);
  }
  expect(css).toContain(".hosting-alert");
  expect(css).toContain(".hosting-alert-text");
});

test("the list exit cell prefers the current exit and the detail picker reuses the sign-in list", () => {
  // The last-login cell shows the exit the account is set to use now; only a
  // missing current exit falls back to the exit of the last login.
  expect(app).toContain("formatExit(view.exit ?? view.lastLogin, text.accountExitDirect)");
  // The detail dropdown draws its nodes in the sign-in order and through the
  // sign-in option formatter, so live latency and verdicts match that picker.
  expect(app).toContain("orderSignInProxies(\n    detailExitProxies,\n    accountIdentities,\n    accountDetailContext?.provider,\n  )");
  expect(app).toContain("formatSignInProxyOption(\n      proxyForTarget(proxy, detailExitTarget(), proxyTargets),");
  expect(app).toContain("detailExitTesting.has(proxy.id) || rowTests.has(proxy.id)");
  // Opening the detail probes every candidate in the background; closing the
  // dialog aborts the sweep and clears its in-flight state.
  expect(app).toContain("await probeSignInProxies(");
  expect(app).toContain("signal: controller.signal,");
  expect(app).toContain("detailExitProxyGuard.cancel();");
  expect(app).toContain("detailExitController.abort();");
  expect(app).toContain("detailExitTesting.clear();");
});

test("both exits pickers fold probe answers through one shared helper", () => {
  // One probe request and one answer fold for both dialogs: the sign-in picker
  // and the account detail picker must not grow two copies again.
  expect(app).toContain("function probeProxy(proxy, target, signal) {");
  expect(app).toContain("function foldProbeAnswer(list, proxy, data, networkErrorText) {");
  expect(app).toContain("foldProbeAnswer(proxies, proxy, data, text.errorNetwork)");
  expect(app).toContain("foldProbeAnswer(detailExitProxies, proxy, data, text.errorNetwork)");
  // Both probe callbacks go through the shared request builder.
  expect(
    (app.match(/\(proxy, \{ signal \}\) => probeProxy\(proxy, target, signal\)/g) || []).length,
  ).toBe(2);
  // The sign-in sweep is only the guard, the shared fold and the redraws; the
  // old hand-rolled data?.proxy branch is gone.
  const signInSweep = /async function refreshSignInProxies\(\)[\s\S]*?\n}\n/.exec(app)?.[0] || "";
  expect(signInSweep).toContain("foldProbeAnswer(proxies, proxy, data, text.errorNetwork)");
  expect(signInSweep).not.toContain("data?.proxy");
  const detailSweep = /async function loadAccountExit\(context\)[\s\S]*?\n}\n/.exec(app)?.[0] || "";
  expect(detailSweep).toContain("foldProbeAnswer(detailExitProxies, proxy, data, text.errorNetwork)");
  expect(detailSweep).not.toContain("data?.proxy");
});

test("the detail picker keeps the user's mode across probe redraws", () => {
  // The <select> is static markup, so remember which account it was drawn for;
  // otherwise a value left by the previous dialog looks like a user choice.
  expect(app).toContain("let detailExitRenderedFor = null;");
  expect(app).toContain('const key = accountDetailContext ? accountDetailContext.provider + "\\u0000" + accountDetailContext.key : "";');
  expect(app).toContain('const previous = detailExitRenderedFor === key ? select.value : "";');
  // Mode options are rebuilt every draw too, so the retention condition covers
  // them and not just node ids.
  for (const mode of ["__inherit__", "__direct__", "__custom__"]) {
    expect(app).toContain(`previous === "${mode}" ||`);
  }
  expect(app).toContain("ordered.some((proxy) => proxy.id === previous)");
  expect(app).toContain("detailExitRenderedFor = key;");
  expect(app).toContain("detailExitRenderedFor = null;");
  // Detail probes write into their own shallow copy, never the global list the
  // sign-in dialog still uses.
  expect(app).toContain("detailExitProxies = proxies.map((proxy) => ({ ...proxy }));");
});
