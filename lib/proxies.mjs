import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const PROXY_FILE_NAME = "proxies.json";
export const PROXY_TYPES = ["http", "https", "socks5"];
export const PROXY_STATUSES = ["untested", "testing", "ok", "error"];
export const PROXY_BULK_LIMIT = 200;

const CONTROL = /[\u0000-\u001f\u007f]/;
const NUL = /\u0000/;
const LIMITS = {
  name: 80,
  host: 255,
  username: 255,
  password: 255,
  region: 120,
  exitIp: 80,
  error: 240,
  errorCode: 48,
  scoreLabel: 40,
  scoreIp: 80,
  id: 128,
  timestamp: 40,
};

export class ProxyInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProxyInputError";
    this.code = code;
    this.status = status;
  }
}

function objectBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProxyInputError("invalid_body", "Request body must be a JSON object.");
  }
  return value;
}

function readText(value, { field, code, max, required = false, trim = true, control = true }) {
  if (value === undefined || value === null) {
    if (required) throw new ProxyInputError(code, `${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new ProxyInputError(code, `${field} must be text.`);
  const result = trim ? value.trim() : value;
  if (required && !result) throw new ProxyInputError(code, `${field} is required.`);
  if (result.length > max) throw new ProxyInputError(code, `${field} is too long.`);
  if (control && CONTROL.test(result)) {
    throw new ProxyInputError(code, `${field} must not contain control characters.`);
  }
  return result;
}

function readType(value, required = false) {
  const type = readText(value, {
    field: "Type",
    code: "invalid_type",
    max: 16,
    required,
  }).toLowerCase();
  if (!type) {
    if (required) throw new ProxyInputError("invalid_type", "Type is required.");
    return "";
  }
  if (!PROXY_TYPES.includes(type)) {
    throw new ProxyInputError("invalid_type", "Type must be http, https or socks5.");
  }
  return type;
}

function readHost(value, required = false) {
  let host = readText(value, {
    field: "Host",
    code: "invalid_host",
    max: LIMITS.host,
    required,
  });
  if (!host) {
    if (required) throw new ProxyInputError("invalid_host", "Host is required.");
    return "";
  }
  if (/\s/.test(host)) {
    throw new ProxyInputError("invalid_host", "Host must not contain spaces.");
  }
  // IPv6 literals are often pasted with brackets; store the bare address so
  // net.connect and SOCKS5 address encoding both see the real host.
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) throw new ProxyInputError("invalid_host", "Host is required.");
  return host;
}

function readPort(value, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ProxyInputError("invalid_port", "Port is required.");
    return null;
  }
  let port;
  if (typeof value === "number") {
    port = value;
  } else if (typeof value === "string" && /^\d{1,5}$/.test(value.trim())) {
    port = Number(value.trim());
  } else {
    throw new ProxyInputError("invalid_port", "Port must be a number between 1 and 65535.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ProxyInputError("invalid_port", "Port must be a number between 1 and 65535.");
  }
  return port;
}

function readUsername(value) {
  return readText(value, {
    field: "Username",
    code: "invalid_username",
    max: LIMITS.username,
    trim: true,
  });
}

function readPassword(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ProxyInputError("invalid_password", "Password must be text.");
  }
  if (value.length > LIMITS.password) {
    throw new ProxyInputError("invalid_password", "Password is too long.");
  }
  if (NUL.test(value)) {
    throw new ProxyInputError("invalid_password", "Password must not contain NUL characters.");
  }
  return value;
}

export function validateCreate(body) {
  const input = objectBody(body);
  return {
    name: readText(input.name, {
      field: "Name",
      code: "invalid_name",
      max: LIMITS.name,
      required: true,
    }),
    type: readType(input.type, true),
    host: readHost(input.host, true),
    port: readPort(input.port, true),
    username: readUsername(input.username),
    password: readPassword(input.password),
  };
}

export function validateUpdate(body) {
  const input = objectBody(body);
  const changes = {};
  if ("name" in input) {
    changes.name = readText(input.name, {
      field: "Name",
      code: "invalid_name",
      max: LIMITS.name,
      required: true,
    });
  }
  if ("type" in input) changes.type = readType(input.type, true);
  if ("host" in input) changes.host = readHost(input.host, true);
  if ("port" in input) changes.port = readPort(input.port, true);
  if ("username" in input) changes.username = readUsername(input.username);
  if ("password" in input) changes.password = readPassword(input.password);
  else if (input.clearPassword === true) changes.password = "";
  if (!Object.keys(changes).length) {
    throw new ProxyInputError("invalid_body", "No proxy fields were provided.");
  }
  return changes;
}

// The dialog can test values before they are saved. A stored proxy supplies
// the password when the form leaves it blank, exactly as PATCH does.
export function validateProbe(body, stored = null) {
  const input = objectBody(body);
  const base = stored || {};
  const type = "type" in input ? readType(input.type, true) : readType(base.type, true);
  const host = "host" in input ? readHost(input.host, true) : readHost(base.host, true);
  const port = "port" in input ? readPort(input.port, true) : readPort(base.port, true);
  return {
    name: base.name || "",
    type,
    host,
    port,
    username: "username" in input ? readUsername(input.username) : String(base.username || ""),
    password: "password" in input ? readPassword(input.password) : String(base.password || ""),
  };
}

export function proxyConnectionKey(proxy) {
  const type = typeof proxy?.type === "string" ? proxy.type.trim().toLowerCase() : "";
  let host = typeof proxy?.host === "string" ? proxy.host.trim().toLowerCase() : "";
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const port = Number(proxy?.port);
  const username = typeof proxy?.username === "string" ? proxy.username.trim() : "";
  return `${type}|${host}|${Number.isFinite(port) ? port : ""}|${username}`;
}

function safeDecodeComponent(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanLabelText(value) {
  return String(value ?? "").replace(/[<>\u0000-\u001f\u007f]/g, "").trim();
}

function uniqueProxyName(base, usedNames) {
  const clean = cleanLabelText(base).slice(0, LIMITS.name) || "proxy";
  if (!usedNames.has(clean)) {
    usedNames.add(clean);
    return clean;
  }
  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const tag = `-${suffix}`;
    const candidate = `${clean.slice(0, Math.max(1, LIMITS.name - tag.length))}${tag}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  return clean;
}

function splitLineLabel(line) {
  const match = /^(\S+)(?:\s+(.+))?$/.exec(line);
  if (!match) return { spec: line, label: "" };
  const spec = match[1];
  const label = cleanLabelText(match[2] ?? "");
  return { spec, label };
}

function parseHostPortAndAuth(spec, fallbackType = "http") {
  const atIndex = spec.lastIndexOf("@");
  let user = "";
  let pass = "";
  let target = spec;
  if (atIndex >= 0) {
    const authPart = spec.slice(0, atIndex);
    target = spec.slice(atIndex + 1);
    const colon = authPart.indexOf(":");
    if (colon < 0) return { ok: false, reason: "invalid_auth" };
    user = safeDecodeComponent(authPart.slice(0, colon));
    pass = safeDecodeComponent(authPart.slice(colon + 1));
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

function parseProxyLine(line, fallbackType = "http") {
  let working = line;
  let pipedLabel = "";
  const piped = /^([^|\s]+)\|([a-z][a-z0-9+.-]*:\/\/.+)$/i.exec(working);
  if (piped) {
    pipedLabel = cleanLabelText(piped[1]);
    working = piped[2];
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(working)) {
    const { spec, label: trailingLabel } = splitLineLabel(working);
    let parsed;
    try {
      parsed = new URL(spec);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    const rawScheme = parsed.protocol.slice(0, -1).toLowerCase();
    const type = rawScheme === "socks5h" ? "socks5" : rawScheme;
    if (!PROXY_TYPES.includes(type)) return { ok: false, reason: "invalid_type" };
    if (!parsed.port) return { ok: false, reason: "invalid_port" };
    const hashLabel = cleanLabelText(safeDecodeComponent(parsed.hash.replace(/^#/, "")));
    return {
      ok: true,
      type,
      host: parsed.hostname,
      port: parsed.port,
      username: safeDecodeComponent(parsed.username),
      password: safeDecodeComponent(parsed.password),
      label: pipedLabel || trailingLabel || hashLabel,
    };
  }

  const hashIdx = working.indexOf(" #");
  let body = working;
  let hashLabel = "";
  if (hashIdx >= 0) {
    body = working.slice(0, hashIdx).trim();
    hashLabel = cleanLabelText(working.slice(hashIdx + 2));
  }
  const { spec, label: spaceLabel } = splitLineLabel(body);
  const parsed = parseHostPortAndAuth(spec, fallbackType);
  if (!parsed.ok) return parsed;
  return { ...parsed, label: pipedLabel || spaceLabel || hashLabel };
}

// Parse plain-text proxy lines into validated create payloads without ever
// echoing raw passwords or lines back in duplicate/invalid reports.
export function parseBulkProxies(
  text,
  { defaultType = "http", prefix = "", existingNames = [], existingKeys = [], limit = PROXY_BULK_LIMIT } = {},
) {
  const normalizedDefault = String(defaultType ?? "http").trim().toLowerCase();
  const fallbackType = PROXY_TYPES.includes(normalizedDefault) ? normalizedDefault : "http";
  const maxItems = Number.isInteger(limit) && limit > 0 ? limit : PROXY_BULK_LIMIT;
  const safePrefix = cleanLabelText(prefix);
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
    const parsed = parseProxyLine(raw, fallbackType);
    if (!parsed.ok) {
      invalid.push({ line, reason: parsed.reason || "invalid_format" });
      continue;
    }
    const baseLabel = parsed.label
      ? (safePrefix ? `${safePrefix} ${parsed.label}` : parsed.label)
      : (() => {
          const hostDisplay = parsed.host.includes(":") && !parsed.host.startsWith("[")
            ? `[${parsed.host}]`
            : parsed.host;
          return safePrefix ? `${safePrefix}-${hostDisplay}:${parsed.port}` : `${hostDisplay}:${parsed.port}`;
        })();
    let validated;
    try {
      validated = validateCreate({
        name: "placeholder",
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
      });
    } catch (error) {
      invalid.push({
        line,
        reason: error instanceof ProxyInputError ? error.code : "invalid_format",
      });
      continue;
    }
    const key = proxyConnectionKey(validated);
    if (seenKeys.has(key)) {
      duplicates.push({ line, reason: "duplicate" });
      continue;
    }
    seenKeys.add(key);
    validated.name = uniqueProxyName(baseLabel, usedNames);
    items.push(validated);
  }

  return { items, duplicates, invalid, truncated };
}

export function publicProxy(record) {
  const status = PROXY_STATUSES.includes(record.status) ? record.status : "untested";
  const exitStatus = PROXY_STATUSES.includes(record.exitStatus) && record.exitStatus !== "testing"
    ? record.exitStatus
    : status === "testing" ? "untested" : status;
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    host: record.host,
    port: record.port,
    username: record.username || "",
    hasPassword: Boolean(record.password),
    region: record.region || "",
    exitIp: record.exitIp || "",
    status,
    exitStatus,
    latency: Number.isFinite(record.latency) ? record.latency : null,
    latencyByProvider: normalizeLatencyMap(record.latencyByProvider),
    probeByProvider: normalizeProbeByProvider(record.probeByProvider),
    lastCheckedAt: record.lastCheckedAt || null,
    error: record.error || "",
    errorCode: record.errorCode || "",
    // The Claude trust score. `score` is only ever a real 0..100 integer from
    // the page, or null; the label/IP/error fields describe the last attempt.
    score: validScore(record.score),
    scoreLabel: record.scoreLabel || "",
    scoreIp: record.scoreIp || "",
    scoreCheckedAt: record.scoreCheckedAt || null,
    scoreError: record.scoreError || "",
    scoreErrorCode: record.scoreErrorCode || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    connectionUpdatedAt: timestampOr(
      record.connectionUpdatedAt,
      record.updatedAt || record.createdAt || null,
    ),
  };
}

// A trust score is an integer from 0 to 100 inclusive. Anything else reads as
// "no score" rather than as a rounded or clamped fake.
function validScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function connectionKey(record) {
  return JSON.stringify([
    record.type,
    record.host,
    record.port,
    record.username || "",
    record.password || "",
  ]);
}

function textOr(value, max, fallback = "") {
  return typeof value === "string" && value.length <= max ? value : fallback;
}

// Per-provider probe results. Each entry is the last round trip measured to
// that provider's own API, so the page can show the latency for the host the
// operator picked without discarding the others. Keys are provider ids, not
// hosts; a host change in the registry never orphans the entry.
//
// `handshake: true` marks a number that is only a TLS handshake: the provider
// answered the probe with something that was not HTTP (a WAF or a JS challenge),
// so the round trip is a lower bound, not a real request time. The flag is
// absent for a normal measurement, which keeps every older entry unchanged.
export function normalizeLatencyMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!id || id.length > LIMITS.id || CONTROL.test(id)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const ms = Number(entry.ms);
    if (!Number.isFinite(ms) || ms < 0) continue;
    const normalized = {
      ms: Math.round(ms),
      host: textOr(entry.host, LIMITS.host),
      at: timestampOr(entry.at, ""),
    };
    if (entry.handshake === true) normalized.handshake = true;
    out[id] = normalized;
  }
  return out;
}

export function normalizeProbeByProvider(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!id || id.length > LIMITS.id || CONTROL.test(id)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const ok = entry.ok === true;
    const ms = Number(entry.ms);
    const item = {
      ok,
      ms: ok && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null,
      host: textOr(entry.host, LIMITS.host),
      at: timestampOr(entry.at, ""),
    };
    if (ok && entry.handshake === true) item.handshake = true;
    if (!ok) {
      item.error = textOr(entry.error, LIMITS.error);
      item.errorCode = textOr(entry.errorCode, LIMITS.errorCode);
    }
    out[id] = item;
  }
  return out;
}

function timestampOr(value, fallback) {
  return typeof value === "string" && value.length <= LIMITS.timestamp ? value : fallback;
}

function bumpTimestamp(previous) {
  const nowMs = Date.now();
  const prevMs = Date.parse(previous || "");
  return new Date(Number.isFinite(prevMs) && nowMs <= prevMs ? prevMs + 1 : nowMs).toISOString();
}

function normalizeStored(raw, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = textOr(raw.id, LIMITS.id);
  if (!id || CONTROL.test(id)) return null;
  try {
    const fields = validateCreate({
      name: raw.name,
      type: raw.type,
      host: raw.host,
      port: raw.port,
      username: raw.username,
      password: raw.password,
    });
    const status = PROXY_STATUSES.includes(raw.status) && raw.status !== "testing"
      ? raw.status
      : "untested";
    const exitStatus = PROXY_STATUSES.includes(raw.exitStatus) && raw.exitStatus !== "testing"
      ? raw.exitStatus
      : status;
    const createdAt = timestampOr(raw.createdAt, now);
    const updatedAt = timestampOr(raw.updatedAt, now);
    return {
      id,
      ...fields,
      region: textOr(raw.region, LIMITS.region),
      exitIp: textOr(raw.exitIp, LIMITS.exitIp),
      status,
      exitStatus,
      latency: Number.isFinite(raw.latency) && raw.latency >= 0 ? Math.round(raw.latency) : null,
      latencyByProvider: normalizeLatencyMap(raw.latencyByProvider),
      probeByProvider: normalizeProbeByProvider(raw.probeByProvider),
      lastCheckedAt: raw.lastCheckedAt ? timestampOr(raw.lastCheckedAt, null) : null,
      error: textOr(raw.error, LIMITS.error),
      errorCode: textOr(raw.errorCode, LIMITS.errorCode),
      score: validScore(raw.score),
      scoreLabel: textOr(raw.scoreLabel, LIMITS.scoreLabel),
      scoreIp: textOr(raw.scoreIp, LIMITS.scoreIp),
      scoreCheckedAt: raw.scoreCheckedAt ? timestampOr(raw.scoreCheckedAt, null) : null,
      scoreError: textOr(raw.scoreError, LIMITS.error),
      scoreErrorCode: textOr(raw.scoreErrorCode, LIMITS.errorCode),
      createdAt,
      updatedAt,
      connectionUpdatedAt: timestampOr(raw.connectionUpdatedAt, updatedAt || createdAt),
    };
  } catch {
    return null;
  }
}

export function createProxyStore({ dataDir }) {
  const file = join(dataDir, PROXY_FILE_NAME);
  let records = [];
  let loaded = false;
  let loading = null;
  let chain = Promise.resolve();
  // Set when a corrupt proxies.json was quarantined on load, so the API can
  // tell callers the store recovered instead of pretending it was empty.
  let recovered = null;

  async function ensureLoaded() {
    if (loaded) return;
    if (!loading) {
      loading = (async () => {
        const now = new Date().toISOString();
        let text;
        try {
          text = await readFile(file, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") {
            records = [];
            loaded = true;
            return;
          }
          throw error;
        }
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          // A corrupt file used to 500 every proxy API forever (loaded stayed
          // false and the error rethrew on every call). Quarantine it next to
          // the live file — the user's data stays on disk for manual salvage
          // — and continue with an empty store so the API works again.
          const corruptName = `${PROXY_FILE_NAME}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
          try {
            await rename(file, join(dataDir, corruptName));
            recovered = { corruptFile: corruptName };
          } catch {
            // If the rename itself fails, still recover: keep the data in
            // place (it may be a permissions issue) and mark the store as
            // recovered without a quarantined file name.
            recovered = { corruptFile: null };
          }
          records = [];
          loaded = true;
          return;
        }
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.proxies) ? parsed.proxies : [];
        const seen = new Set();
        records = [];
        for (const item of list) {
          const record = normalizeStored(item, now);
          if (!record || seen.has(record.id)) continue;
          seen.add(record.id);
          records.push(record);
        }
        loaded = true;
      })().finally(() => {
        loading = null;
      });
    }
    await loading;
  }

  function run(work) {
    const next = chain.then(async () => {
      await ensureLoaded();
      return work();
    });
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function writeAtomic() {
    const payload = `${JSON.stringify({ version: 1, proxies: records }, null, 2)}\n`;
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    try {
      await chmod(dataDir, 0o700);
    } catch {
      // Windows and some filesystems do not implement POSIX modes. The file
      // still lives in the plugin's private data directory.
    }
    const temp = join(dataDir, `.${PROXY_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await chmod(temp, 0o600);
      } catch {
        // See the directory-mode note above.
      }
      try {
        await rename(temp, file);
      } catch (error) {
        if (!["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"].includes(error?.code)) throw error;
        await rm(file, { force: true });
        await rename(temp, file);
      }
      try {
        await chmod(file, 0o600);
      } catch {
        // See the directory-mode note above.
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  return {
    file,
    // Non-null once a corrupt proxies.json was quarantined on load. Surfaces
    // through the proxy list routes so callers can warn instead of silently
    // treating the store as empty.
    recovered: () => recovered,
    list: () => run(() => records.map(publicProxy)),
    get: (id) => run(() => {
      const record = records.find((item) => item.id === id);
      return record ? { ...record } : null;
    }),
    create: (input) => run(async () => {
      // The name is shown verbatim in every row and dialog: angle brackets
      // are refused outright (the UI escapes, but a client rendering the
      // name elsewhere should not inherit markup), and a duplicate name
      // would make the list ambiguous to read.
      if (typeof input?.name === "string" && /[<>]/.test(input.name)) {
        throw new ProxyInputError("invalid_name", "Name must not contain < or >.");
      }
      if (records.some((item) => item.name === input?.name)) {
        throw new ProxyInputError("name_taken", "A proxy with that name already exists.", 409);
      }
      const now = new Date().toISOString();
      const record = {
        id: randomUUID(),
        ...input,
        region: "",
        exitIp: "",
        status: "untested",
        exitStatus: "untested",
        latency: null,
        latencyByProvider: {},
        probeByProvider: {},
        lastCheckedAt: null,
        error: "",
        errorCode: "",
        score: null,
        scoreLabel: "",
        scoreIp: "",
        scoreCheckedAt: null,
        scoreError: "",
        scoreErrorCode: "",
        createdAt: now,
        updatedAt: now,
        connectionUpdatedAt: now,
      };
      // randomUUID collisions are vanishingly unlikely, but ids are the API's
      // addressing scheme, so never let two records share one.
      while (records.some((item) => item.id === record.id)) record.id = randomUUID();
      const before = records;
      records = [...records, record];
      try {
        await writeAtomic();
      } catch (error) {
        records = before;
        throw error;
      }
      return { ...record };
    }),
    update: (id, changes) => run(async () => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const previous = records[index];
      if (typeof changes?.name === "string" && /[<>]/.test(changes.name)) {
        throw new ProxyInputError("invalid_name", "Name must not contain < or >.");
      }
      if (
        typeof changes?.name === "string" &&
        records.some((item) => item.id !== id && item.name === changes.name)
      ) {
        throw new ProxyInputError("name_taken", "A proxy with that name already exists.", 409);
      }
      const now = bumpTimestamp(previous.updatedAt);
      const next = { ...previous, ...changes, updatedAt: now };
      if (connectionKey(previous) !== connectionKey(next)) {
        next.region = "";
        next.exitIp = "";
        next.status = "untested";
        next.exitStatus = "untested";
        next.latency = null;
        next.latencyByProvider = {};
        next.probeByProvider = {};
        next.lastCheckedAt = null;
        next.error = "";
        next.errorCode = "";
        next.score = null;
        next.scoreLabel = "";
        next.scoreIp = "";
        next.scoreCheckedAt = null;
        next.scoreError = "";
        next.scoreErrorCode = "";
        next.connectionUpdatedAt = bumpTimestamp(previous.connectionUpdatedAt || previous.updatedAt);
      }
      const before = records;
      records = records.slice();
      records[index] = next;
      try {
        await writeAtomic();
      } catch (error) {
        records = before;
        throw error;
      }
      return { ...next };
    }),
    remove: (id) => run(async () => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const before = records;
      const removed = records[index];
      records = records.filter((item) => item.id !== id);
      try {
        await writeAtomic();
      } catch (error) {
        records = before;
        throw error;
      }
      return { ...removed };
    }),
    // A test result is applied only to the exact revision that was tested.
    // Deleting or editing the row while a probe is in flight therefore cannot
    // resurrect or overwrite it.
    applyTestResult: (id, result, expectedUpdatedAt) => run(async () => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const previous = records[index];
      const connectionRevision = previous.connectionUpdatedAt || previous.updatedAt;
      if (
        expectedUpdatedAt &&
        expectedUpdatedAt !== connectionRevision &&
        expectedUpdatedAt !== previous.updatedAt
      ) {
        return null;
      }
      const now = new Date().toISOString();
      const probe = result.target && typeof result.target === "object" ? result.target : null;
      // A two-leg probe stays a two-leg probe even when the provider leg
      // failed. Without this, a failed provider test would erase the exit IP
      // that the first leg (or an earlier test) successfully established.
      const providerProbe = Boolean(
        probe &&
          probe.kind === "provider" &&
          typeof probe.provider === "string" &&
          probe.provider,
      );
      const region = providerProbe || result.ok ? textOr(result.region, LIMITS.region) : "";
      const exitIp = providerProbe || result.ok ? textOr(result.exitIp, LIMITS.exitIp) : "";
      // For a two-leg probe the row's public `latency` stays the generic exit
      // measurement (its historical meaning); the provider round trip lives
      // in latencyByProvider. A legacy single-leg caller has no exitLatency,
      // so its result.latency is used exactly as before. A two-leg probe whose
      // exit leg failed has no exit number at all and must never borrow the
      // provider's, or switching the picker back to Generic would show the
      // provider round trip as the exit measurement.
      const exitLatency = providerProbe
        ? (Number.isFinite(result.exitLatency) ? result.exitLatency : null)
        : result.latency;
      const previousLatency = Number.isFinite(previous.latency) ? previous.latency : null;
      const checkedAt = timestampOr(result.checkedAt, now);
      const exitOk = providerProbe
        ? (result.exitOk === true
            ? true
            : result.exitOk === false
              ? false
              : Number.isFinite(result.exitLatency)
                ? true
                : null)
        : Boolean(result.ok);
      const previousExitStatus =
        PROXY_STATUSES.includes(previous.exitStatus) && previous.exitStatus !== "testing"
          ? previous.exitStatus
          : previous.status === "testing"
            ? "untested"
            : previous.status || "untested";
      const next = {
        ...previous,
        status: result.ok ? "ok" : "error",
        exitStatus: exitOk === true ? "ok" : exitOk === false ? "error" : previousExitStatus,
        latency: result.ok && Number.isFinite(exitLatency)
          ? Math.round(exitLatency)
          : providerProbe
            ? (Number.isFinite(exitLatency) ? Math.round(exitLatency) : previousLatency)
            : null,
        // A provider test is two legs: the provider round trip and the exit
        // lookup. When the exit lookup did not answer, keep what the row
        // already knew rather than erasing a good exit IP because the public
        // IP service happened to be unreachable.
        region: providerProbe && !region ? previous.region || "" : region,
        exitIp: providerProbe && !exitIp ? previous.exitIp || "" : exitIp,
        error: result.ok ? "" : textOr(result.error, LIMITS.error, "The proxy test failed."),
        errorCode: result.ok ? "" : textOr(result.errorCode, LIMITS.errorCode),
        lastCheckedAt: checkedAt,
        updatedAt: now,
      };
      if (providerProbe) {
        const probes = normalizeProbeByProvider(previous.probeByProvider);
        const probeEntry = {
          ok: result.ok === true,
          ms: result.ok === true && Number.isFinite(result.latency) ? Math.round(result.latency) : null,
          host: textOr(probe.host, LIMITS.host),
          at: checkedAt || "",
        };
        if (result.ok === true && result.tlsOnly === true) probeEntry.handshake = true;
        if (!probeEntry.ok) {
          probeEntry.error = next.error;
          probeEntry.errorCode = next.errorCode;
        }
        probes[probe.provider] = probeEntry;
        next.probeByProvider = probes;
      }
      if (providerProbe && result.ok && Number.isFinite(result.latency)) {
        const entries = normalizeLatencyMap(previous.latencyByProvider);
        const measured = {
          ms: Math.round(result.latency),
          host: textOr(probe.host, LIMITS.host),
          at: next.lastCheckedAt || "",
        };
        // A handshake-only number has to travel with its caveat, or the page
        // would show a WAF's TLS time as if it were a request round trip.
        if (result.tlsOnly === true) measured.handshake = true;
        entries[probe.provider] = measured;
        next.latencyByProvider = entries;
      }
      const before = records;
      records = records.slice();
      records[index] = next;
      try {
        await writeAtomic();
      } catch (error) {
        records = before;
        throw error;
      }
      return { ...next };
    }),
    // A trust score is applied only to the exact revision that was measured.
    // Editing the row while the page is open therefore cannot scribble the old
    // result onto the new connection. A failed attempt records its own error
    // and clears the score; it never leaves a stale number behind.
    applyScoreResult: (id, result, expectedUpdatedAt) => run(async () => {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const previous = records[index];
      const connectionRevision = previous.connectionUpdatedAt || previous.updatedAt;
      if (
        expectedUpdatedAt &&
        expectedUpdatedAt !== connectionRevision &&
        expectedUpdatedAt !== previous.updatedAt
      ) {
        return null;
      }
      const now = new Date().toISOString();
      const ok = result?.ok === true && validScore(result.score) !== null;
      const next = {
        ...previous,
        score: ok ? result.score : null,
        scoreLabel: ok ? textOr(result.label, LIMITS.scoreLabel) : "",
        scoreIp: ok ? textOr(result.ip, LIMITS.scoreIp) : "",
        scoreCheckedAt: timestampOr(result.checkedAt, now),
        scoreError: ok
          ? ""
          : textOr(result?.error, LIMITS.error, "The trust score check returned no usable score."),
        scoreErrorCode: ok
          ? ""
          : textOr(result?.errorCode, LIMITS.errorCode) || "score_missing",
        updatedAt: now,
      };
      const before = records;
      records = records.slice();
      records[index] = next;
      try {
        await writeAtomic();
      } catch (error) {
        records = before;
        throw error;
      }
      return { ...next };
    }),
  };
}
