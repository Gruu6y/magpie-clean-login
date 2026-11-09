// Pure logic for the assets page: the type enum, account normalization, form
// validation, list filtering and time formatting. No DOM and no browser.
import { expect, test } from "bun:test";
import {
  ASSET_NOTE_MAX,
  ASSET_TYPES,
  filterAssets,
  formatAssetTime,
  normalizeAssetAccount,
  validateAssetForm,
} from "../ui/asset-view.js";

test("the type enum is the four API types in picker order", () => {
  expect(ASSET_TYPES).toEqual(["google-mail", "microsoft-mail", "cn-phone", "apple-id"]);
});

test("a phone account is normalized to its bare eleven digits", () => {
  expect(normalizeAssetAccount("cn-phone", "138 0013 8000")).toBe("13800138000");
  expect(normalizeAssetAccount("cn-phone", "139-0013-8001")).toBe("13900138001");
  expect(normalizeAssetAccount("cn-phone", " 13800138000 ")).toBe("13800138000");
  expect(normalizeAssetAccount("cn-phone", 42)).toBe("");
});

test("an email account is only trimmed, never rewritten", () => {
  expect(normalizeAssetAccount("google-mail", "  Owner@Example.com  ")).toBe("Owner@Example.com");
  expect(normalizeAssetAccount("apple-id", "apple@example.com")).toBe("apple@example.com");
  expect(normalizeAssetAccount("microsoft-mail", undefined)).toBe("");
});

test("the three email types accept an email and reject a phone number", () => {
  for (const type of ["google-mail", "microsoft-mail", "apple-id"]) {
    expect(validateAssetForm({ type, account: "name@example.com", note: "" })).toBeNull();
    expect(validateAssetForm({ type, account: "13800138000", note: "" })).toBe("invalid_account");
    expect(validateAssetForm({ type, account: "missing@tld", note: "" })).toBe("invalid_account");
    expect(validateAssetForm({ type, account: "   ", note: "" })).toBe("invalid_account");
    expect(validateAssetForm({ type, account: "@example.com", note: "" })).toBe("invalid_account");
  }
});

test("cn-phone accepts a normalized mobile number and rejects others", () => {
  expect(validateAssetForm({ type: "cn-phone", account: "13800138000", note: "" })).toBeNull();
  expect(validateAssetForm({ type: "cn-phone", account: "138 0013 8000", note: "" })).toBeNull();
  expect(validateAssetForm({ type: "cn-phone", account: "139-0013-8001", note: "" })).toBeNull();
  for (const account of ["12345", "23800138000", "12800138000", "1380013800", "138001380000", "a@example.com"]) {
    expect(validateAssetForm({ type: "cn-phone", account, note: "" })).toBe("invalid_account");
  }
});

test("an unknown type is invalid before the account is looked at", () => {
  expect(validateAssetForm({ type: "bogus", account: "a@example.com", note: "" })).toBe("invalid_type");
  expect(validateAssetForm({ type: "", account: "a@example.com", note: "" })).toBe("invalid_type");
  expect(validateAssetForm({ type: undefined, account: "a@example.com", note: "" })).toBe("invalid_type");
});

test("a note is capped at 200 characters", () => {
  expect(ASSET_NOTE_MAX).toBe(200);
  expect(validateAssetForm({ type: "google-mail", account: "a@example.com", note: "n".repeat(200) })).toBeNull();
  expect(validateAssetForm({ type: "google-mail", account: "a@example.com", note: "n".repeat(201) })).toBe("invalid_note");
  expect(validateAssetForm({ type: "google-mail", account: "a@example.com" })).toBeNull();
});

test("filterAssets narrows by type and search together", () => {
  const rows = [
    { id: "1", type: "google-mail", account: "owner@example.com", note: "primary" },
    { id: "2", type: "cn-phone", account: "13800138000", note: "" },
    { id: "3", type: "apple-id", account: "apple@example.com", note: "app store" },
  ];
  expect(filterAssets(rows, {})).toHaveLength(3);
  expect(filterAssets(rows, { type: "all" })).toHaveLength(3);
  expect(filterAssets(rows, { type: "cn-phone" }).map((row) => row.id)).toEqual(["2"]);
  expect(filterAssets(rows, { query: "PRIMARY" }).map((row) => row.id)).toEqual(["1"]);
  expect(filterAssets(rows, { query: "1380" }).map((row) => row.id)).toEqual(["2"]);
  // The raw type id is searchable too, even though the picker shows a label.
  expect(filterAssets(rows, { query: "apple-id" }).map((row) => row.id)).toEqual(["3"]);
  expect(filterAssets(rows, { type: "google-mail", query: "app" })).toHaveLength(0);
  expect(filterAssets(rows, { query: "nothing" })).toHaveLength(0);
  // Non-objects and non-arrays never throw.
  expect(filterAssets(null, {})).toEqual([]);
  expect(filterAssets([null, "x", ...rows], {})).toHaveLength(3);
});

test("formatAssetTime uses the locale and falls back safely", () => {
  const iso = "2026-11-03T10:00:00.000Z";
  expect(formatAssetTime(iso, "en")).not.toBe("");
  expect(formatAssetTime(iso, "zh-Hans")).not.toBe("");
  expect(formatAssetTime("", "en")).toBe("");
  expect(formatAssetTime("not-a-date", "en")).toBe("");
  // An unknown locale tag falls back to the ISO string rather than throwing.
  expect(typeof formatAssetTime(iso, "!!")).toBe("string");
});
