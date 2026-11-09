// Read-file checks for the assets page: the markup, the app wiring, the four
// language tables and the mobile label stylesheet. No DOM and no browser is
// needed — the real UI is served to the launcher frame, not started here.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buttonIds } from "./button-ids.mjs";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");
const view = readFileSync(join(root, "ui", "asset-view.js"), "utf8");

test("the assets tab is the fourth tab and ships its own panel", () => {
  const tabs = [...html.matchAll(/id="tab-(providers|proxies|accounts|assets|guide)"/g)].map((m) => m[1]);
  expect(tabs).toEqual(["providers", "proxies", "accounts", "assets", "guide"]);
  for (const id of [
    "rail-assets", "rail-assets-label", "tab-assets", "tab-assets-label",
    "asset-count", "panel-assets", "assets-title", "assets-copy", "asset-total",
    "asset-add", "asset-add-label", "asset-toolbar", "asset-search-label",
    "asset-search", "asset-filter-label", "asset-filter", "asset-filter-all",
    "asset-type-google-mail", "asset-type-microsoft-mail", "asset-type-cn-phone",
    "asset-type-apple-id", "asset-notice", "asset-table", "asset-col-type",
    "asset-col-account", "asset-col-note", "asset-col-created",
    "asset-col-actions", "assets-list", "assets-empty", "assets-empty-title",
    "assets-empty-copy", "asset-add-empty", "toasts",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
  // The tab carries role=tab and points at the panel by id.
  const tab = /<button class="tab" id="tab-assets"[\s\S]*?<\/button>/.exec(html)?.[0] || "";
  expect(tab).toContain('type="button"');
  expect(tab).toContain('role="tab"');
  expect(tab).toContain('aria-controls="panel-assets"');
  // Five columns, in the contract's order.
  const head = /<div class="proxy-table-head" aria-hidden="true">\s*<span id="asset-col-type"[\s\S]*?<\/div>/.exec(html)?.[0] || "";
  for (const id of [
    "asset-col-type", "asset-col-account", "asset-col-note",
    "asset-col-created", "asset-col-actions",
  ]) {
    expect(head).toContain(`id="${id}"`);
  }
  const filter = /<select id="asset-filter">[\s\S]*?<\/select>/.exec(html)?.[0] || "";
  for (const value of ["all", "google-mail", "microsoft-mail", "cn-phone", "apple-id"]) {
    expect(filter).toContain(`value="${value}"`);
  }
});

test("the add/edit dialog and the delete dialog ship every control", () => {
  for (const id of [
    "asset-dialog", "asset-dialog-title", "asset-dialog-copy", "asset-close",
    "asset-type-label", "asset-type", "asset-account-label", "asset-account",
    "asset-note-label", "asset-note", "asset-note-hint", "asset-error",
    "asset-cancel", "asset-save",
    "asset-delete-dialog", "asset-delete-title", "asset-delete-copy",
    "asset-delete-close", "asset-delete-error", "asset-delete-cancel",
    "asset-delete-confirm",
  ]) {
    expect(html).toContain(`id="${id}"`);
  }
  // The note is capped in the markup as well as in the validator.
  const note = /<textarea id="asset-note"[^>]*>/.exec(html)?.[0] || "";
  expect(note).toContain('maxlength="200"');
  // Save is an explicit click control; no form submission anywhere.
  expect(html).not.toContain('type="submit"');
  // The page still keeps exactly one <details> (the provider catalog).
  expect((html.match(/<details\b/g) || []).length).toBe(1);
});

test("every asset button is type=button and really wired", () => {
  const assetButtons = [
    "tab-assets", "asset-add", "asset-add-empty", "asset-close", "asset-cancel",
    "asset-save", "asset-delete-close", "asset-delete-cancel", "asset-delete-confirm",
  ];
  for (const id of assetButtons) {
    expect(buttonIds).toContain(id);
    const tag = new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`).exec(html)?.[0]
      || new RegExp(`<button\\b[^>]*>\\s*<span[^>]*id="${id}"`).exec(html)?.[0]
      || "";
    expect(tag).toContain('type="button"');
    expect(app).toContain(`byId("${id}").addEventListener`);
  }
  // The two dialog titles are swapped at open time for add vs edit.
  expect(app).toContain("text.assetDialogTitle");
  expect(app).toContain("text.assetDialogEditTitle");
});

test("the page only reads the real assets endpoints and validates first", () => {
  for (const needle of [
    'api("api/assets")',
    "method: \"PATCH\"",
    "method: \"POST\"",
    "method: \"DELETE\"",
    "validateAssetForm(values)",
    "normalizeAssetAccount(values.type, values.account)",
    "filterAssets(assets, { query: assetQuery, type: assetFilterType })",
    "formatAssetTime(asset?.createdAt, langKey)",
    "assetErrorText(error)",
    "serverErrorText(error)",
    "loadAssets()",
    "renderAssets()",
    'selectTab("assets")',
  ]) {
    expect(app).toContain(needle);
  }
  // The list is loaded on startup as well as on the tab click.
  expect((app.match(/loadAssets\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  // No injection sink and no invented data.
  expect(html).not.toMatch(/innerHTML|mock|preview|data-add/i);
  expect(app).not.toMatch(/innerHTML|\bmock\b|simulat|preview|data-add/i);
  expect(view).not.toMatch(/innerHTML|\bmock\b|simulat|preview/i);
});

test("mobile cells show their own field labels", () => {
  expect(app).toContain('setAttribute("data-label", label)');
  expect(css).toContain(".asset-table .asset-row");
  expect(css).toContain("content: attr(data-label)");
});

test("every new asset string exists in all four language tables", () => {
  const keys = [
    "assets", "assetsTitle", "assetsCopy", "assetTotal", "assetAdd",
    "assetSearchLabel", "assetSearchPlaceholder", "assetFilterLabel",
    "assetFilterAll", "assetTypeGoogleMail", "assetTypeMicrosoftMail",
    "assetTypeCnPhone", "assetTypeAppleId", "assetColType", "assetColAccount",
    "assetColNote", "assetColCreated", "assetColActions", "assetEmpty",
    "assetEmptyCopy", "assetNoMatch", "assetEdit", "assetDelete",
    "assetDialogTitle", "assetDialogEditTitle", "assetDialogCopy",
    "assetTypeLabel", "assetAccountLabel", "assetAccountPlaceholder",
    "assetNoteLabel", "assetNoteHint", "assetSave", "assetSaving", "assetCancel",
    "assetDeleteTitle", "assetDeleteCopy", "assetDeleteConfirm",
    "errorInvalidAssetType", "errorInvalidAssetAccount", "errorInvalidAssetNote",
    "errorInvalidAssetBody", "errorAssetNotFound", "toastAssetSaved",
    "toastAssetDeleted", "assetLoadFailed",
  ];
  for (const key of keys) {
    const count = (app.match(new RegExp(`\\b${key}:`, "g")) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  }
  // The four tables carry exactly the same key set.
  const tables = [...app.matchAll(/^  (?:en|"zh-Hans"|"zh-Hant"|ja): \{([\s\S]*?)^  \},$/gm)]
    .map((match) => new Set([...match[1].matchAll(/^    ([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1])));
  expect(tables.length).toBe(4);
  for (const table of tables) expect(table).toEqual(tables[0]);
  expect(tables[0].size).toBeGreaterThan(280);
});

test("applyText injects every static asset label", () => {
  for (const id of [
    "tab-assets-label", "rail-assets-label", "assets-title", "assets-copy",
    "asset-add-label", "asset-add-empty", "asset-search-label", "asset-filter-label",
    "asset-filter-all", "assets-empty-title", "assets-empty-copy",
    "asset-dialog-title", "asset-dialog-copy", "asset-type-label",
    "asset-account-label", "asset-note-label", "asset-note-hint",
    "asset-save", "asset-cancel", "asset-delete-title", "asset-delete-confirm",
    "asset-delete-cancel",
  ]) {
    expect(app).toContain(`byId("${id}")`);
  }
});
