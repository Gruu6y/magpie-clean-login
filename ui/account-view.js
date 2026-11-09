// Pure helpers for the accounts view: normalization, filtering, sorting,
// and formatting check summaries and exits. Keeping these helpers free of DOM
// dependencies allows comprehensive headless testing.

import { accountLabel } from "./account-state.js";
import { ALL_PROVIDERS, UNKNOWN_PROVIDER } from "./account-provider-filter.js";

export function accountView(account) {
  const value = account && typeof account === "object" ? account : {};
  const label = accountLabel(value);
  const name = (typeof value.name === "string" && value.name.trim()) || label;
  const provider = typeof value.provider === "string" ? value.provider : "";
  // The display name comes from the provider list the service returned; this
  // module never invents one. Callers pass it in as `providerLabel`.
  const providerLabel = typeof value.providerLabel === "string" && value.providerLabel
    ? value.providerLabel
    : provider;
  const key = String(value.key ?? "");
  const uid = typeof value.uid === "string" ? value.uid : "";
  const fp = value.fingerprint && typeof value.fingerprint === "object" ? value.fingerprint : {};
  const fingerprint = {
    id: typeof fp.id === "string" ? fp.id : null,
    pinnedAt: typeof fp.pinnedAt === "string" ? fp.pinnedAt : null,
  };
  const signedIn = Boolean(value.signedIn);
  const signedInAt = typeof value.signedInAt === "string" ? value.signedInAt : "";
  const lastLogin = value.lastLogin && typeof value.lastLogin === "object" ? value.lastLogin : null;
  // The exit the account is currently set to use; null means "follow the
  // provider". It is separate from lastLogin so a manual exit change shows up
  // without rewriting the sign-in history.
  const exit = value.exit && typeof value.exit === "object" ? value.exit : null;
  const checks = Array.isArray(value.checks) ? value.checks : [];
  const lastCheck = value.lastCheck && typeof value.lastCheck === "object"
    ? value.lastCheck
    : checks[0] || null;
  const note = typeof value.note === "string" ? value.note : "";
  const unverified = Boolean(value.unverified);
  const hosting = normalizeHosting(value.hosting);

  return {
    name,
    provider,
    providerLabel,
    key,
    uid,
    fingerprint,
    signedIn,
    signedInAt,
    lastLogin,
    exit,
    lastCheck,
    checks,
    note,
    unverified,
    hosting,
  };
}

// Hosted renewal is off until the user turns it on for one account, so a
// missing or malformed policy always reads as "off" -- never as enabled.
export function normalizeHosting(value) {
  const raw = value && typeof value === "object" ? value : {};
  const enabled = raw.enabled === true;
  const pausedReason = typeof raw.pausedReason === "string" && raw.pausedReason ? raw.pausedReason : null;
  // "paused" only means something for an account that was enabled and then
  // stopped itself; an account the user switched off is simply "off".
  const state = !enabled
    ? (pausedReason ? "paused" : "off")
    : raw.state === "running" ? "running" : "watching";
  // The service keeps hosting timestamps as epoch milliseconds, while the
  // ledger's own dates are ISO strings. Both are real times, so both are kept
  // and normalised to ISO here; dropping the numbers would make every enabled
  // account read as "no expiry" and "never renewed".
  const stamp = (input) => {
    if (typeof input === "string" && input) return input;
    if (typeof input === "number" && Number.isFinite(input) && input > 0) {
      const date = new Date(input);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
  };
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          at: stamp(item.at),
          outcome: typeof item.outcome === "string" ? item.outcome : "",
          code: typeof item.code === "string" ? item.code : null,
          message: typeof item.message === "string" ? item.message : "",
        }))
    : [];
  return {
    enabled,
    state,
    enabledAt: stamp(raw.enabledAt),
    updatedAt: stamp(raw.updatedAt),
    nextDueAt: stamp(raw.nextDueAt),
    lastAt: stamp(raw.lastAt),
    lastOutcome: typeof raw.lastOutcome === "string" ? raw.lastOutcome : null,
    lastCode: typeof raw.lastCode === "string" ? raw.lastCode : null,
    lastMessage: typeof raw.lastMessage === "string" ? raw.lastMessage : "",
    failStreak: Number.isFinite(raw.failStreak) && raw.failStreak > 0 ? Math.floor(raw.failStreak) : 0,
    pausedReason,
    expiresAt: stamp(raw.expiresAt),
    history,
  };
}

// The one line the accounts table shows under the signed-in badge. Pure so the
// wording rules can be tested without a DOM; the page supplies its own strings.
export function hostingStateLabel(hosting, labels = {}) {
  const value = normalizeHosting(hosting);
  const text = {
    off: "续期托管：关闭",
    watching: "续期托管：已开通",
    running: "续期托管：续期中…",
    paused: "续期托管：已暂停",
    ...labels,
  };
  return text[value.state] ?? text.off;
}

// Tone for that line: a renewal in flight is active, a self-paused policy needs
// attention, an enabled one is good, and "off" stays neutral -- it is the
// default, not a problem.
export function hostingTone(hosting) {
  const state = normalizeHosting(hosting).state;
  if (state === "running") return "active";
  if (state === "paused") return "warn";
  if (state === "watching") return "good";
  return "none";
}

export function formatExit(login, directText = "直连") {
  if (!login || typeof login !== "object") return directText;
  if (login.proxyId === null) return directText;
  const region = typeof login.region === "string" ? login.region.trim() : "";
  const name = typeof login.proxyName === "string"
    ? login.proxyName.trim()
    : typeof login.name === "string" ? login.name.trim() : "";
  if (!region && !name) return directText;
  if (name === "直连" || name === directText) return directText;
  if (region && name) {
    if (name.includes(region)) return name;
    return `${region} · ${name}`;
  }
  return name || region || directText;
}

// The check job's exposure/summary as display lines. `labels.exposure` is a
// template containing {count}; `labels.clean` is the zero-exposure wording.
// The page passes its own localized strings; the defaults keep this helper
// usable on its own (and testable without a DOM).
export function formatCheckSummary(check, labels = {}) {
  if (!check || typeof check !== "object") return [];
  const exposureTemplate = labels.exposure || "{count} 处可能暴露你";
  const cleanText = labels.clean || "站点没有标出任何矛盾";
  const lines = [];
  if (typeof check.exposure === "number") {
    lines.push(check.exposure > 0
      ? exposureTemplate.replace("{count}", String(check.exposure))
      : cleanText);
  }
  if (Array.isArray(check.summary)) {
    for (const item of check.summary) {
      if (typeof item === "string" && item.trim()) {
        lines.push(item.trim());
      }
    }
  } else if (typeof check.summary === "string" && check.summary.trim()) {
    lines.push(check.summary.trim());
  }
  return lines;
}

export function filterAccounts(accounts, { query = "", filter = "all", provider = ALL_PROVIDERS } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";

  return list.filter((account) => {
    const view = accountView(account);
    if (filter === "signedIn" && !view.signedIn) return false;
    if (filter === "signedOut" && view.signedIn) return false;
    if (provider !== ALL_PROVIDERS) {
      const accountProvider = typeof view.provider === "string" ? view.provider.trim() : "";
      if (provider === UNKNOWN_PROVIDER) {
        if (accountProvider) return false;
      } else if (accountProvider !== provider) {
        return false;
      }
    }

    if (!normalizedQuery) return true;

    const searchable = [
      view.name,
      view.key,
      view.uid,
      view.provider,
      view.providerLabel,
      view.note,
      view.fingerprint.id,
      formatExit(view.lastLogin, ""),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  });
}

const GRADE_RANK = { A: 4, B: 3, C: 2, D: 1 };

export function sortAccounts(accounts, sort = "lastLogin") {
  const list = Array.isArray(accounts) ? [...accounts] : [];

  return list.sort((a, b) => {
    const viewA = accountView(a);
    const viewB = accountView(b);

    if (sort === "name") {
      const cmp = viewA.name.localeCompare(viewB.name);
      if (cmp !== 0) return cmp;
      return viewA.key.localeCompare(viewB.key);
    }

    if (sort === "provider") {
      const cmp = viewA.providerLabel.localeCompare(viewB.providerLabel);
      if (cmp !== 0) return cmp;
      return viewA.name.localeCompare(viewB.name);
    }

    if (sort === "grade") {
      const rankA = GRADE_RANK[viewA.lastCheck?.grade] || 0;
      const rankB = GRADE_RANK[viewB.lastCheck?.grade] || 0;
      if (rankB !== rankA) return rankB - rankA;
      const timeA = viewA.lastCheck?.at || "";
      const timeB = viewB.lastCheck?.at || "";
      if (timeB !== timeA) return timeB.localeCompare(timeA);
      return viewA.name.localeCompare(viewB.name);
    }

    // Default: "lastLogin"
    const timeA = viewA.lastLogin?.at || viewA.signedInAt || "";
    const timeB = viewB.lastLogin?.at || viewB.signedInAt || "";
    if (timeB && timeA) {
      const cmp = timeB.localeCompare(timeA);
      if (cmp !== 0) return cmp;
    } else if (timeB && !timeA) {
      return 1;
    } else if (!timeB && timeA) {
      return -1;
    }
    return viewA.name.localeCompare(viewB.name);
  });
}
