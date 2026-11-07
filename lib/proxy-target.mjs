// Which host a proxy test measures.
//
// Historically every probe measured one public endpoint (ipinfo.io), so the
// number showed "this exit -> ipinfo". That is not the path an account
// actually uses: a provider whose API sits on another continent can be far
// slower than the IP lookup suggests. A target names the host to measure, so
// the same exit can be compared against the provider it will really talk to.
//
// Two kinds of target exist:
//   generic  - the historical endpoint (ipinfo.io); the reply also yields the
//              exit IP and region, which the list and the sign-in dropdown
//              still need.
//   provider - one provider's own API origin, read from magpie's plugin
//              registry. Only its reachability and round trip are measured.
//
// This module performs no I/O and never reads the registry itself: the caller
// passes the provider rows it already has, and tests pass a fixture.

const MAX_ID = 128;
const MAX_NAME = 120;
const MAX_HOST = 255;
const MAX_API = 512;

// The historical target. Kept as a frozen object so callers can compare by
// reference and never mutate the shared value.
export const GENERIC_TARGET = Object.freeze({
  kind: "generic",
  provider: "",
  host: "",
  url: "",
});

function text(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : "";
}

// Parses a provider's declared API base into an origin this plugin is willing
// to probe.
//
// https only: a provider's own API is https in practice, and requiring it is
// what makes the probe honest. Through a proxy, an https target is always a
// CONNECT tunnel followed by TLS, so a proxy that cannot reach the provider
// fails at the tunnel or the handshake. A plain http target could instead
// receive the proxy's own error page as a normal HTTP status, which would be
// reported as "the provider answered".
export function parseApiOrigin(value) {
  const raw = text(value, MAX_API);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname || url.username || url.password) return null;
  if (url.hostname.length > MAX_HOST) return null;
  return { host: url.host, url: `${url.origin}/` };
}

// The providers the page may offer as test targets: an id, a display name and
// the origin to probe. A provider without a usable API host is left out rather
// than offered with a target that can never work.
export function providerTargets(providers = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(providers) ? providers : []) {
    if (!row || typeof row !== "object") continue;
    const id = text(row.id, MAX_ID);
    if (!id || seen.has(id)) continue;
    const parsed = parseApiOrigin(row.api);
    if (!parsed) continue;
    seen.add(id);
    out.push({
      id,
      name: text(row.name, MAX_NAME) || id,
      host: parsed.host,
      url: parsed.url,
    });
  }
  return out;
}

// Resolves a request's optional `provider` field into a target.
//
// Returns `{ target, error }`. A missing provider means the generic endpoint,
// which is exactly what every earlier version did, so an unmodified caller
// keeps its behaviour. A named provider this scan does not know is an error
// rather than a silent fallback: reporting an ipinfo latency as if it were the
// provider's would be worse than saying the target is unknown.
export function resolveProxyTarget(provider, providers = []) {
  const id = text(provider, MAX_ID);
  if (!id) return { target: { ...GENERIC_TARGET }, error: null };
  const match = providerTargets(providers).find((item) => item.id === id);
  if (!match) return { target: null, error: "unknown_target" };
  return {
    target: { kind: "provider", provider: match.id, host: match.host, url: match.url },
    error: null,
  };
}

// The host shown next to a latency number. Only ever the host, never the full
// URL: the number is about the network path, and the page labels it locally.
export function targetHostLabel(target) {
  return target && typeof target === "object" ? text(target.host, MAX_HOST) : "";
}
