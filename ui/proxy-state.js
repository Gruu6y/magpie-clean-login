// Small pure helpers used by the page. Keeping them out of app.js lets the
// tests exercise confirmation and stale-result behaviour without a DOM.

import { latencyMarker } from "./proxy-target.js";

export function normalizeProxyForm(values = {}) {
  return {
    name: String(values.name ?? "").trim(),
    type: String(values.type ?? "").toLowerCase(),
    host: String(values.host ?? "").trim(),
    port: String(values.port ?? "").trim(),
    username: String(values.username ?? "").trim(),
    password: String(values.password ?? ""),
  };
}

// Only connection fields matter when deciding whether a test result still
// describes the values that will be saved.
export function proxyFingerprint(values = {}) {
  const form = normalizeProxyForm(values);
  return JSON.stringify([form.type, form.host, form.port, form.username, form.password]);
}

export function formatAddress(proxy = {}) {
  const host = String(proxy.host ?? "");
  const shown = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${shown}:${proxy.port ?? ""}`;
}

export function statusView(proxy = {}, labels = {}, testing = false) {
  if (testing) {
    return { state: "testing", label: labels.statusTesting || "Testing…", detail: "" };
  }
  if (proxy.status === "ok") {
    // A provider measurement that only reached the TLS handshake is a lower
    // bound, so it prints as `~233 ms`. Every other row keeps its old text.
    return {
      state: "ok",
      label: labels.statusOk || "Available",
      detail: Number.isFinite(proxy.latency)
        ? `${latencyMarker(proxy)}${proxy.latency} ms`
        : "",
    };
  }
  if (proxy.status === "error") {
    return {
      state: "error",
      label: labels.statusError || "Failed",
      detail: proxy.error || "",
    };
  }
  return { state: "untested", label: labels.statusUntested || "Never tested", detail: "" };
}

// A guard for async work tied to a dialog or row. cancel() invalidates every
// token handed out before it, so a late response cannot touch newer state.
export function createRequestGuard() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    cancel() {
      current += 1;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}

// Delete is a two-step action: ask() only remembers the row. A cancelled
// dialog clears it without touching data; take() is the only way to obtain a
// target for the actual DELETE request.
export function createConfirmController() {
  let pending = null;
  return {
    ask(id, name) {
      pending = { id: String(id), name: String(name ?? "") };
      return { ...pending };
    },
    cancel() {
      const previous = pending;
      pending = null;
      return previous;
    },
    peek() {
      return pending ? { ...pending } : null;
    },
    take(id) {
      if (!pending || pending.id !== String(id)) return null;
      const target = pending;
      pending = null;
      return target;
    },
  };
}

export const PROXY_BULK_LIMIT = 200;

const BULK_TYPES = ["http", "https", "socks5"];
const BULK_LIMITS = {
  name: 80,
  host: 255,
  username: 255,
  password: 255,
};

function cleanBulkLabel(value) {
  return String(value ?? "").replace(/[<>\u0000-\u001f\u007f]/g, "").trim();
}

function safeDecode(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function proxyConnectionKey(proxy = {}) {
  const type = typeof proxy?.type === "string" ? proxy.type.trim().toLowerCase() : "";
  let host = typeof proxy?.host === "string" ? proxy.host.trim().toLowerCase() : "";
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const port = Number(proxy?.port);
  const username = typeof proxy?.username === "string" ? proxy.username.trim() : "";
  return `${type}|${host}|${Number.isFinite(port) ? port : ""}|${username}`;
}

function splitBulkLabel(line) {
  const match = /^(\S+)(?:\s+(.+))?$/.exec(line);
  if (!match) return { spec: line, label: "" };
  return { spec: match[1], label: cleanBulkLabel(match[2] ?? "") };
}

function normalizeDefaultType(raw) {
  const lower = String(raw ?? "http").trim().toLowerCase();
  return BULK_TYPES.includes(lower) ? lower : "http";
}

function parseBulkHostPortAndAuth(spec, fallbackType) {
  const atIndex = spec.lastIndexOf("@");
  let user = "";
  let pass = "";
  let target = spec;
  if (atIndex >= 0) {
    const authPart = spec.slice(0, atIndex);
    target = spec.slice(atIndex + 1);
    const colon = authPart.indexOf(":");
    if (colon < 0) return { ok: false, reason: "invalid_auth" };
    user = safeDecode(authPart.slice(0, colon));
    pass = safeDecode(authPart.slice(colon + 1));
  }

  if (target.startsWith("[")) {
    const bracket = /^\[([^\]]+)\]:(\d{1,5})(?::([^:]*):(.*))?$/.exec(target);
    if (!bracket) return { ok: false, reason: "invalid_port" };
    return {
      ok: true,
      type: fallbackType,
      host: bracket[1],
      port: bracket[2],
      username: atIndex >= 0 ? user : bracket[3] ?? "",
      password: atIndex >= 0 ? pass : bracket[4] ?? "",
    };
  }

  const parts = target.split(":");
  if (parts.length === 2) {
    return { ok: true, type: fallbackType, host: parts[0], port: parts[1], username: user, password: pass };
  }
  if (atIndex < 0 && parts.length >= 4 && /^\d{1,5}$/.test(parts[1])) {
    if (parts.length > 4 && !parts[0].includes(".")) {
      return { ok: false, reason: "invalid_host" };
    }
    return {
      ok: true,
      type: fallbackType,
      host: parts[0],
      port: parts[1],
      username: parts[2],
      password: parts.slice(3).join(":"),
    };
  }
  return { ok: false, reason: parts.length === 1 ? "invalid_port" : "invalid_format" };
}

function parseSingleBulkLine(line, fallbackType) {
  let working = line;
  let pipedLabel = "";
  const piped = /^([^|\s]+)\|([a-z][a-z0-9+.-]*:\/\/.+)$/i.exec(working);
  if (piped) {
    pipedLabel = cleanBulkLabel(piped[1]);
    working = piped[2];
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(working)) {
    const { spec, label: trailingLabel } = splitBulkLabel(working);
    let parsed;
    try {
      parsed = new URL(spec);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    const rawScheme = parsed.protocol.slice(0, -1).toLowerCase();
    const type = rawScheme === "socks5h" ? "socks5" : rawScheme;
    if (!BULK_TYPES.includes(type)) return { ok: false, reason: "invalid_type" };
    if (!parsed.port) return { ok: false, reason: "invalid_port" };
    const hashLabel = cleanBulkLabel(safeDecode(parsed.hash.replace(/^#/, "")));
    return {
      ok: true,
      type,
      host: parsed.hostname,
      port: parsed.port,
      username: safeDecode(parsed.username),
      password: safeDecode(parsed.password),
      label: pipedLabel || trailingLabel || hashLabel,
    };
  }

  const hashIdx = working.indexOf(" #");
  let body = working;
  let hashLabel = "";
  if (hashIdx >= 0) {
    body = working.slice(0, hashIdx).trim();
    hashLabel = cleanBulkLabel(working.slice(hashIdx + 2));
  }
  const { spec, label: spaceLabel } = splitBulkLabel(body);
  const parsed = parseBulkHostPortAndAuth(spec, fallbackType);
  if (!parsed.ok) return parsed;
  return { ...parsed, label: pipedLabel || spaceLabel || hashLabel };
}

function validateBulkItem(parsed) {
  let host = String(parsed.host ?? "").trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1).trim();
  if (!host || host.length > BULK_LIMITS.host || /[<>\s\u0000-\u001f\u007f]/.test(host)) {
    return { ok: false, reason: "invalid_host" };
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: "invalid_port" };
  }
  const username = String(parsed.username ?? "").trim();
  const password = String(parsed.password ?? "");
  if (username.length > BULK_LIMITS.username || /[\u0000-\u001f\u007f]/.test(username)) {
    return { ok: false, reason: "invalid_username" };
  }
  if (password.length > BULK_LIMITS.password || /\u0000/.test(password)) {
    return { ok: false, reason: "invalid_password" };
  }
  if (!BULK_TYPES.includes(parsed.type)) {
    return { ok: false, reason: "invalid_type" };
  }
  return {
    ok: true,
    item: {
      name: "",
      type: parsed.type,
      host,
      port,
      username,
      password,
    },
  };
}

function uniqueBulkName(base, usedNames) {
  const clean = cleanBulkLabel(base).slice(0, BULK_LIMITS.name) || "proxy";
  if (!usedNames.has(clean)) {
    usedNames.add(clean);
    return clean;
  }
  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const tag = `-${suffix}`;
    const candidate = `${clean.slice(0, Math.max(1, BULK_LIMITS.name - tag.length))}${tag}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  return clean;
}

export function parseBulkProxies(
  text,
  {
    defaultType = "http",
    prefix = "",
    existingNames = [],
    existingKeys = [],
    limit = PROXY_BULK_LIMIT,
  } = {},
) {
  const fallbackType = normalizeDefaultType(defaultType);
  const maxItems = Number.isInteger(limit) && limit > 0 ? limit : PROXY_BULK_LIMIT;
  const safePrefix = cleanBulkLabel(prefix);
  const usedNames = new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .filter((name) => typeof name === "string")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const seenKeys = new Set(
    (Array.isArray(existingKeys) ? existingKeys : []).filter(
      (key) => typeof key === "string" && key,
    ),
  );
  const items = [];
  const duplicates = [];
  const invalid = [];
  let truncated = 0;

  const lines = typeof text === "string" ? text.split(/\r?\n/) : [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) continue;
    const line = index + 1;
    if (items.length >= maxItems) {
      truncated += 1;
      continue;
    }
    const parsed = parseSingleBulkLine(raw, fallbackType);
    if (!parsed.ok) {
      invalid.push({ line, reason: parsed.reason || "invalid_format" });
      continue;
    }
    const validated = validateBulkItem(parsed);
    if (!validated.ok) {
      invalid.push({ line, reason: validated.reason });
      continue;
    }
    const key = proxyConnectionKey(validated.item);
    if (seenKeys.has(key)) {
      duplicates.push({ line, reason: "duplicate" });
      continue;
    }
    seenKeys.add(key);
    const hostDisplay =
      validated.item.host.includes(":") && !validated.item.host.startsWith("[")
        ? `[${validated.item.host}]`
        : validated.item.host;
    const baseLabel = parsed.label
      ? safePrefix
        ? `${safePrefix} ${parsed.label}`
        : parsed.label
      : safePrefix
        ? `${safePrefix}-${hostDisplay}:${validated.item.port}`
        : `${hostDisplay}:${validated.item.port}`;
    validated.item.name = uniqueBulkName(baseLabel, usedNames);
    items.push(validated.item);
  }

  return { items, duplicates, invalid, truncated };
}
