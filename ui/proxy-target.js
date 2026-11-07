// Pure helpers for the "test target" picker in the Proxy IPs table.
//
// GET /api/proxy-targets exposes a generic endpoint plus one entry per
// provider whose API base magpie declared. The page sees only ids, display
// names and hostnames; accounts and credentials never leave the service.
// Keeping the projection and the latency lookup here lets the tests cover the
// behaviour without a DOM, and keeps the selector's default (generic) exactly
// equal to the historical single-leg probe.

const MAX_ID = 128;
const MAX_NAME = 120;
const MAX_HOST = 255;
const MAX_URL = 512;

function short(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const GENERIC_TARGET_ID = "";

export function normalizeProxyTargets(payload = {}) {
  const generic = payload?.generic && typeof payload.generic === "object" ? payload.generic : {};
  const rows = Array.isArray(payload?.targets) ? payload.targets : [];
  const targets = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = short(row.id, MAX_ID);
    const host = short(row.host, MAX_HOST);
    // A target without a host cannot be labelled honestly, and a duplicate id
    // would make two options mean the same thing.
    if (!id || !host || seen.has(id)) continue;
    seen.add(id);
    targets.push({
      id,
      name: short(row.name, MAX_NAME),
      host,
      url: short(row.url, MAX_URL),
    });
  }
  return {
    generic: {
      id: GENERIC_TARGET_ID,
      host: short(generic.host, MAX_HOST),
      url: short(generic.url, MAX_URL),
    },
    targets,
  };
}

export const EMPTY_TARGETS = Object.freeze(
  normalizeProxyTargets({ generic: {}, targets: [] }),
);

export function findTarget(catalogue, id) {
  if (!id || !catalogue || !Array.isArray(catalogue.targets)) return null;
  return catalogue.targets.find((target) => target.id === id) || null;
}

// An unknown (or vanished) id falls back to the generic target rather than
// posting a provider the service cannot resolve. That keeps a stale selection
// from producing a 400 after an uninstall.
export function resolveTargetId(value, catalogue) {
  return findTarget(catalogue, typeof value === "string" ? value : "")?.id || GENERIC_TARGET_ID;
}

export function targetOptionLabel(target, labels = {}) {
  if (!target) return "";
  const name = target.name || target.id;
  return target.host ? `${name} · ${target.host}` : name;
}

export function providerLatency(proxy, provider) {
  const entries = proxy?.latencyByProvider;
  if (!provider || !entries || typeof entries !== "object" || Array.isArray(entries)) return null;
  const entry = entries[provider];
  if (!entry || typeof entry !== "object") return null;
  const ms = Number(entry.ms);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return {
    ms: Math.round(ms),
    host: short(entry.host, MAX_HOST),
    at: short(entry.at, 40),
  };
}

// The row and the sign-in dropdown render through statusView(), which reads
// `proxy.latency`. Decorating a shallow copy means the stored record keeps its
// generic measurement while the chosen target sees its own number. With a
// provider selected but not yet measured, the latency is deliberately null:
// showing the generic number under a provider label would be a lie.
export function proxyForTarget(proxy, provider, catalogue) {
  if (!proxy || typeof proxy !== "object" || !provider) return proxy;
  const target = findTarget(catalogue, provider);
  if (!target) return proxy;
  const measured = providerLatency(proxy, provider);
  return {
    ...proxy,
    latency: measured ? measured.ms : null,
    latencyTarget: {
      id: target.id,
      name: target.name,
      host: measured?.host || target.host,
      at: measured?.at || "",
    },
  };
}

export function targetStatusSuffix(proxy) {
  const target = proxy?.latencyTarget;
  return target?.id ? ` · ${target.id}` : "";
}

// A sweep result carries the target it measured. Folding it into the local
// record lets the dropdown update even when the service reports no persisted
// proxy (a draft, or a row edited mid-flight).
export function withProbeResult(proxy, result) {
  const target = result?.target;
  if (
    !proxy ||
    result?.ok !== true ||
    !target ||
    target.kind !== "provider" ||
    typeof target.provider !== "string" ||
    !target.provider
  ) {
    return proxy;
  }
  const ms = Number(result.latency);
  if (!Number.isFinite(ms) || ms < 0) return proxy;
  const previous = proxy.latencyByProvider;
  const entries = previous && typeof previous === "object" && !Array.isArray(previous)
    ? { ...previous }
    : {};
  entries[target.provider] = {
    ms: Math.round(ms),
    host: short(target.host, MAX_HOST),
    at: short(result.checkedAt, 40),
  };
  return { ...proxy, latencyByProvider: entries };
}
