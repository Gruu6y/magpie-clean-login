// Pure helpers for the assets page: the type enum, account normalization,
// form validation, list filtering and time formatting. Keeping these helpers
// free of DOM dependencies makes them testable without a browser; app.js
// imports them for the real page.

// The four asset types the API accepts, in the order the picker shows them.
export const ASSET_TYPES = ["google-mail", "microsoft-mail", "cn-phone", "apple-id"];

// The three types whose account must be an email address. `cn-phone` is the
// only one that is not.
const EMAIL_TYPES = new Set(["google-mail", "microsoft-mail", "apple-id"]);

// Deliberately permissive: the service is the authority, this only catches the
// obvious typos before a round trip. It requires a local part, an "@" and a
// dotted domain, with no whitespace.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A mainland mobile number: 11 digits, first digit 1, second digit 3-9.
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export const ASSET_NOTE_MAX = 200;
// The account cap mirrors the service's own limit so the page rejects an
// overlong account before the round trip instead of surfacing invalid_account.
export const ASSET_ACCOUNT_MAX = 254;

// The account stored for a phone number is its bare 11 digits: the service
// normalizes the same way, so the page must too or an edit would submit a
// number the service still accepts but would rewrite.
export function normalizeAssetAccount(type, account) {
  const value = typeof account === "string" ? account : "";
  if (type === "cn-phone") return value.replace(/[\s-]/g, "");
  return value.trim();
}

// Returns null when the form is valid, otherwise the first error code. The
// codes mirror the service's own so the page can show the same wording.
export function validateAssetForm({ type, account, note } = {}) {
  const normalizedType = typeof type === "string" ? type : "";
  if (!ASSET_TYPES.includes(normalizedType)) return "invalid_type";
  const normalizedAccount = normalizeAssetAccount(normalizedType, account);
  if (!normalizedAccount) return "invalid_account";
  if (normalizedAccount.length > ASSET_ACCOUNT_MAX) return "invalid_account";
  if (normalizedType === "cn-phone") {
    if (!PHONE_PATTERN.test(normalizedAccount)) return "invalid_account";
  } else if (!EMAIL_PATTERN.test(normalizedAccount)) {
    return "invalid_account";
  }
  const noteValue = typeof note === "string" ? note : "";
  if (noteValue.length > ASSET_NOTE_MAX) return "invalid_note";
  return null;
}

// The search and the type picker are independent: `type` is "all" or one of
// ASSET_TYPES, `query` matches the account, the note and the raw type id.
export function filterAssets(assets, { query = "", type = "all" } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  return list.filter((asset) => {
    if (!asset || typeof asset !== "object") return false;
    if (type && type !== "all" && asset.type !== type) return false;
    if (!normalizedQuery) return true;
    const searchable = [asset.account, asset.note, asset.type]
      .filter((value) => typeof value === "string" && value)
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedQuery);
  });
}

// Matches the page's existing formatTime: the same locale, the same fallback
// to the raw ISO string when Intl refuses the tag. Returns "" for no time.
export function formatAssetTime(iso, lang) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(lang || undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
