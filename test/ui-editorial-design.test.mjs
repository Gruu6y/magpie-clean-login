// Editorial design language — static guards for the UI port.
//
// These read the shipped markup and stylesheet as text (no DOM, no browser).
// They pin the four things an editorial re-skin must never quietly undo:
//   * no remote asset sneaks in (the page runs in a sandboxed frame offline),
//   * every control stays a real type="button" (no allow-forms in the sandbox),
//   * the palette tokens and their dark twin exist,
//   * the header and every data row share one set of column tracks (subgrid),
//   * and the entire appendix-A id contract survives, id by id.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");

// One CSS rule block, matched by its selector, up to the closing brace.
function rule(selector) {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

// --- 1. no remote resources ------------------------------------------------

test("the page references no remote stylesheet or asset", () => {
  // The reviewed page ships zero external fonts, stylesheets and images. The
  // real plugin keeps one LOCAL <link rel="stylesheet" href="style.css"> that
  // this task edits, so the guard is "nothing remote", not "no <link> at all".
  expect(html).not.toMatch(/https?:\/\//i);
  expect(html).not.toContain('href="http');
  expect(html).not.toContain("href='http");
  expect(html).not.toContain("//cdn");
  // Every stylesheet link it does carry must resolve next to the page.
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    expect(tag).toMatch(/rel="stylesheet"/i);
    expect(tag).toMatch(/href="(?!https?:|\/\/)[^"]+"/i);
  }
});

// --- 2. every button is sandbox-safe ---------------------------------------

test("every button is type=button and nothing submits", () => {
  const buttons = html.match(/<button\b[^>]*>/gi) || [];
  expect(buttons.length).toBeGreaterThan(30);
  for (const tag of buttons) {
    expect(tag).toMatch(/\btype="button"/);
  }
  // magpie's iframe has no allow-forms; a submit control would be dead.
  expect(html).not.toContain('type="submit"');
});

// --- 3. palette tokens + dark variant --------------------------------------

test("the editorial palette and its dark variant are defined", () => {
  const light = rule(":root {");
  for (const token of ["--paper:", "--ink:", "--red:", "--line:", "--muted:"]) {
    expect(light).toContain(token);
  }
  expect(css).toContain(':root[data-theme="dark"]');
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
  const darkBlock = dark.slice(0, dark.indexOf("}") + 1);
  for (const token of ["--paper:", "--ink:", "--red:"]) {
    expect(darkBlock).toContain(token);
  }
});

// --- 4. table alignment contract (subgrid) ---------------------------------

test("header and rows share one set of grid tracks", () => {
  // Columns live on the container, so the header and every row cannot compute
  // divergent tracks.
  expect(rule(".proxy-table,\n.tbl {")).toContain("display: grid");
  expect(rule(".tbl-proxy {")).toContain("grid-template-columns");
  expect(rule(".account-table {")).toContain("grid-template-columns");
  // The row groups collapse so rows are direct grid items.
  expect(rule("#proxies-list,\n#accounts-list,\n.tbl-body {")).toContain("display: contents");
  // The header and rows inherit the container's tracks rather than making their
  // own (this is the exact fix for the two-independent-grids misalignment).
  const aligned = rule(".proxy-table-head,\n.proxy-row,\n.tbl-head,\n.tbl-row {");
  expect(aligned).toContain("display: grid");
  expect(aligned).toContain("grid-column: 1 / -1");
  expect(aligned).toContain("grid-template-columns: subgrid");
});

// --- 4b. the pinned fingerprint keeps its own line --------------------------

test("the pinned fingerprint time gets its own line in the accounts table", () => {
  // The cell is `.proxy-address account-fingerprint`; the generic
  // `.proxy-address` rule never styles its <small>. As an inline element the
  // pin used to run into the id, and the old ellipsis style clipped it.
  const block = rule(".account-fingerprint small {");
  expect(block).toContain("display: block");
  expect(block).toContain("white-space: normal");
});

// --- 5. narrow-screen card fallback + section chrome -----------------------

test("the narrow-screen card fallback and section chrome survive", () => {
  expect(css).toContain("@media (max-width: 940px)");
  expect(css).toContain("content: attr(data-label)");
  // Editorial chrome added by this task.
  expect(html).toContain('class="spine"');
  expect(html).toContain('id="progress-line"');
  expect(html).toContain('class="rail"');
  expect(app).toContain("progress-line");
  // Theme respects a host-injected data-theme instead of clobbering it.
  expect(app).toContain("document.documentElement.dataset.theme");
});

// --- 6. the appendix-A id contract, id by id -------------------------------

test("every appendix-A id still ships", () => {
  const ids = [
    "page-title", "page-subtitle",
    "tab-providers", "tab-providers-label", "provider-count",
    "tab-proxies", "tab-proxies-label", "proxy-count",
    "tab-accounts", "tab-accounts-label", "account-count",
    "tab-guide", "tab-guide-label",
    "panel-providers", "providers-title", "providers-copy",
    "providers-search-label", "providers-search", "providers-search-status",
    "environment-setup", "environment-title", "environment-badge",
    "environment-copy", "environment-size-label", "environment-size-value",
    "environment-disk-label", "environment-disk-value",
    "environment-location-label", "environment-location-value",
    "environment-note", "environment-progress", "environment-progress-bar",
    "environment-progress-text", "environment-error", "environment-prepare",
    "environment-cancel", "environment-retry",
    "providers-empty", "providers-empty-title", "providers-empty-copy",
    "providers-list", "providers-more", "providers-more-title",
    "providers-more-count", "providers-more-hint", "providers-more-list",
    "provider-sources", "provider-sources-badge", "provider-sources-note",
    "panel-proxies", "proxies-title", "proxies-copy", "add-proxy",
    "add-proxy-label", "proxies-empty", "proxies-empty-title",
    "proxies-empty-copy", "add-proxy-empty",
    "proxy-filters", "filter-region-label", "filter-regions",
    "filter-keyword-group", "filter-keyword-label", "filter-keywords",
    "filter-latency-label", "filter-latency-min", "filter-latency-max",
    "filter-count", "filter-reset",
    "proxy-score-bar", "proxy-score-state", "score-cancel",
    "proxy-table", "col-name", "col-address", "col-region", "col-score",
    "col-status", "col-checked", "proxies-list",
    "panel-accounts", "accounts-title", "accounts-copy", "accounts-refresh",
    "accounts-notice", "account-toolbar", "account-search-label",
    "account-search", "account-sort-label", "account-sort",
    "account-sort-last-login", "account-sort-name", "account-sort-provider",
    "account-sort-grade", "account-filters", "account-filter-label",
    "account-filter-chips", "account-filter-all", "account-filter-all-label",
    "account-filter-all-count", "account-filter-signed-in",
    "account-filter-signed-in-label", "account-filter-signed-in-count",
    "account-filter-signed-out", "account-filter-signed-out-label",
    "account-filter-signed-out-count", "account-filter-count",
    "grade-legend", "grade-legend-label", "grade-a", "grade-b", "grade-c",
    "grade-d", "grade-disclaimer",
    "account-table", "account-col-name", "account-col-fingerprint",
    "account-col-last-login", "account-col-check", "account-col-status",
    "account-col-actions", "accounts-list", "accounts-empty",
    "accounts-empty-title", "accounts-empty-copy",
    "tab-assets", "tab-assets-label", "asset-count", "panel-assets",
    "assets-title", "assets-copy", "asset-total", "asset-add",
    "asset-add-label", "asset-add-empty", "asset-toolbar",
    "asset-search-label", "asset-search", "asset-filter-label", "asset-filter",
    "asset-filter-all", "asset-type-google-mail", "asset-type-microsoft-mail",
    "asset-type-cn-phone", "asset-type-apple-id", "asset-notice",
    "asset-table", "asset-col-type", "asset-col-account", "asset-col-note",
    "asset-col-created", "asset-col-actions", "assets-list",
    "assets-empty", "assets-empty-title", "assets-empty-copy",
    "asset-dialog", "asset-dialog-title", "asset-dialog-copy", "asset-close",
    "asset-type-label", "asset-type", "asset-type-option-google-mail",
    "asset-type-option-microsoft-mail", "asset-type-option-cn-phone",
    "asset-type-option-apple-id", "asset-account-label", "asset-account",
    "asset-note-label", "asset-note", "asset-note-hint", "asset-error",
    "asset-cancel", "asset-save",
    "asset-delete-dialog", "asset-delete-title", "asset-delete-copy",
    "asset-delete-close", "asset-delete-error", "asset-delete-cancel",
    "asset-delete-confirm",
    "panel-guide", "guide-title", "guide-copy", "guide-body",
    "service-state", "service-label", "version", "retry",
    "proxy-dialog", "proxy-form", "proxy-dialog-title", "proxy-dialog-copy",
    "proxy-close", "label-name", "proxy-name", "label-type", "proxy-type",
    "label-port", "proxy-port", "label-host", "proxy-host",
    "label-username", "username-label", "username-optional", "proxy-username",
    "label-password", "password-label", "password-optional", "proxy-password",
    "proxy-password-hint", "proxy-form-error", "proxy-test-result",
    "test-proxy", "proxy-cancel", "save-proxy",
    "signin-dialog", "signin-title", "signin-copy", "signin-close",
    "signin-provider", "signin-method-field", "signin-method-label",
    "signin-method", "signin-method-hint", "signin-inputs-field",
    "signin-inputs", "signin-inputs-hint", "signin-code-field",
    "signin-code-label", "signin-code", "signin-code-hint",
    "signin-account-field", "signin-account-label", "signin-account",
    "signin-account-hint", "signin-proxy-field", "signin-proxy-label",
    "signin-proxy", "signin-notice", "signin-error", "signin-status",
    "signin-status-state", "signin-status-detail", "signin-result",
    "signin-result-label", "signin-result-key", "signin-cancel",
    "signin-close-footer", "signin-submit-code", "signin-start",
    "confirm-dialog", "confirm-title", "confirm-copy", "confirm-close",
    "confirm-error", "confirm-cancel", "confirm-action",
    "account-detail-dialog", "account-detail-title", "account-detail-copy",
    "account-detail-close", "account-detail-facts",
    "account-detail-note-label", "account-detail-note",
    "account-detail-note-hint", "account-detail-note-status",
    "account-detail-error", "account-detail-history-title",
    "account-detail-history", "account-detail-dismiss",
    "account-detail-check", "account-detail-note-save",
    "account-check-dialog", "account-check-title", "account-check-copy",
    "account-check-close", "account-check-setup",
    "account-check-proxy-label", "account-check-proxy",
    "account-check-proxy-hint", "account-check-target-label",
    "account-check-eta-label", "account-check-eta-value",
    "account-check-identity-label", "account-check-identity",
    "account-check-note", "account-check-running",
    "account-check-progress-bar", "account-check-progress-text",
    "account-check-running-state", "account-check-result",
    "account-check-grade", "account-check-summary", "account-check-verdict",
    "account-check-grade-label", "account-check-grade-value",
    "account-check-exit-label", "account-check-exit",
    "account-check-time-label", "account-check-time", "account-check-lines",
    "account-check-result-note", "account-check-failed",
    "account-check-failed-title", "account-check-failed-detail",
    "account-check-failed-lines", "account-check-error",
    "account-check-dismiss", "account-check-cancel", "account-check-reexit",
    "account-check-details", "account-check-change-exit",
    "account-check-start", "account-check-again", "account-check-retry",
    "report-dialog", "report-title", "report-copy", "report-close",
    "report-card", "report-note-label", "report-note", "report-note-hint",
    "report-draft-label", "report-draft", "report-draft-hint",
    "report-error", "report-status", "report-cancel", "report-copy-body",
    "report-open", "toasts",
  ];
  for (const id of ids) {
    expect(html).toContain(`id="${id}"`);
  }
});
