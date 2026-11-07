// Pure client-side filtering for the Proxy IPs table. The page keeps the
// filter state in memory (the magpie page frame is an opaque origin, so
// localStorage is not available) and only calls these helpers while rendering;
// no filter ever sends a request.
//
// A proxy's `region` may be an empty string when the connection has never been
// tested. The empty string is a real key here, so "untested" can be selected
// on its own instead of being folded into "all regions".

export const UNTESTED_REGION = "";

export function regionKey(proxy = {}) {
  return typeof proxy?.region === "string" ? proxy.region.trim() : "";
}

// Distinct regions in a stable order: named regions alphabetically, the
// untested/empty region last so it never looks like a normal country.
export function distinctRegions(proxies = []) {
  const counts = new Map();
  for (const proxy of Array.isArray(proxies) ? proxies : []) {
    if (!proxy) continue;
    const key = regionKey(proxy);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => {
      if (a.region === UNTESTED_REGION && b.region !== UNTESTED_REGION) return 1;
      if (b.region === UNTESTED_REGION && a.region !== UNTESTED_REGION) return -1;
      if (a.region === b.region) return 0;
      return a.region < b.region ? -1 : 1;
    });
}

// A latency input is a bound only when it is a finite number. An empty string
// (the normal empty input value) means "no bound"; a nonsense string is
// ignored rather than treated as 0.
export function latencyBound(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const EMPTY_SELECTION = new Set();

function selectionOf(regions) {
  if (regions instanceof Set) return regions;
  if (Array.isArray(regions)) return new Set(regions);
  return EMPTY_SELECTION;
}

// A proxy name is free text the operator types, and in practice it is where
// the exit tags live (`R2-1|香港-NF|HKT家宽`). The bar offers a short curated
// list instead of parsing the names: whether an exit is residential or static
// is exactly what decides if an account is safe to sign in on, so those tags
// earn a dedicated filter. Matching is a case-insensitive substring test
// because a name may spell the same tag in different case (`NF` / `nf`).
export const KEYWORD_TAGS = Object.freeze(["家宽", "静态"]);

export function proxyName(proxy = {}) {
  return typeof proxy?.name === "string" ? proxy.name : "";
}

export function hasKeyword(proxy, keyword) {
  if (typeof keyword !== "string" || keyword === "") return false;
  return proxyName(proxy).toLowerCase().includes(keyword.toLowerCase());
}

// Keyword counts in the curated order, so the chips never reshuffle as the
// list changes. A keyword with no match is still returned with a zero count;
// the page decides whether to show it.
export function distinctKeywords(proxies = [], keywords = KEYWORD_TAGS) {
  const list = Array.isArray(proxies) ? proxies : [];
  const wanted = Array.isArray(keywords) ? keywords : [];
  return wanted
    .filter((keyword) => typeof keyword === "string" && keyword !== "")
    .map((keyword) => ({
      keyword,
      count: list.filter((proxy) => proxy && hasKeyword(proxy, keyword)).length,
    }));
}

export function filterProxies(
  proxies = [],
  { regions = [], keywords = [], minLatency = null, maxLatency = null, latencyOf = null } = {},
) {
  const selected = selectionOf(regions);
  const chosen = selectionOf(keywords);
  const min = latencyBound(minLatency);
  const max = latencyBound(maxLatency);
  const latencyFilter = min !== null || max !== null;
  return (Array.isArray(proxies) ? proxies : []).filter((proxy) => {
    if (!proxy) return false;
    if (selected.size > 0 && !selected.has(regionKey(proxy))) return false;
    // Keywords are an OR group (any selected tag matches) that ANDs with the
    // other filters, mirroring the regions.
    if (chosen.size > 0 && ![...chosen].some((keyword) => hasKeyword(proxy, keyword))) {
      return false;
    }
    if (latencyFilter) {
      // A selected probe target can supply its own latency. Without one this is
      // exactly the record's own number, so the historical filter is unchanged.
      const latency = typeof latencyOf === "function" ? latencyOf(proxy) : proxy.latency;
      // Only real numeric latencies participate. With a bound set, a row whose
      // latency is null/unknown is excluded rather than passing as 0.
      if (typeof latency !== "number" || !Number.isFinite(latency)) return false;
      if (min !== null && latency < min) return false;
      if (max !== null && latency > max) return false;
    }
    return true;
  });
}