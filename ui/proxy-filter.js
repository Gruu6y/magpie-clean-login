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
  {
    regions = [],
    keywords = [],
    minLatency = null,
    maxLatency = null,
    latencyOf = null,
    search = "",
    status = "all",
    usage = "all",
    usedIds = null,
    statusOf = null,
  } = {},
) {
  const selected = selectionOf(regions);
  const chosen = selectionOf(keywords);
  const min = latencyBound(minLatency);
  const max = latencyBound(maxLatency);
  const latencyFilter = min !== null || max !== null;
  const searchWords =
    typeof search === "string"
      ? search
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
      : [];
  const wantedStatus =
    status === "ok" || status === "error" || status === "untested" ? status : "all";
  const wantedUsage = usage === "used" || usage === "unused" ? usage : "all";
  const usedSet =
    usedIds instanceof Set
      ? usedIds
      : Array.isArray(usedIds)
        ? new Set(usedIds)
        : EMPTY_SELECTION;

  return (Array.isArray(proxies) ? proxies : []).filter((proxy) => {
    if (!proxy) return false;
    if (selected.size > 0 && !selected.has(regionKey(proxy))) return false;
    // Keywords are an OR group (any selected tag matches) that ANDs with the
    // other filters, mirroring the regions.
    if (chosen.size > 0 && ![...chosen].some((keyword) => hasKeyword(proxy, keyword))) {
      return false;
    }
    if (wantedStatus !== "all") {
      const actualStatus =
        typeof statusOf === "function" ? statusOf(proxy) : proxy.status || "untested";
      if (actualStatus !== wantedStatus) return false;
    }
    if (wantedUsage !== "all") {
      const isUsed = Boolean(proxy.id && usedSet.has(proxy.id));
      if (wantedUsage === "used" && !isUsed) return false;
      if (wantedUsage === "unused" && isUsed) return false;
    }
    if (searchWords.length > 0) {
      const haystack = [
        proxy.name,
        proxy.host,
        proxy.port != null ? String(proxy.port) : "",
        proxy.region,
        proxy.exitIp,
        proxy.type,
      ]
        .filter((part) => typeof part === "string" && part)
        .join(" ")
        .toLowerCase();
      if (!searchWords.every((word) => haystack.includes(word))) return false;
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

const proxySortCollator = new Intl.Collator("zh-Hans", {
  numeric: true,
  sensitivity: "base",
});

function usageCountFor(proxy, usageCounts) {
  if (!usageCounts || !proxy?.id) return 0;
  const raw =
    typeof usageCounts.get === "function" ? usageCounts.get(proxy.id) : usageCounts[proxy.id];
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function sortProxies(
  proxies = [],
  sort = "default",
  { latencyOf = null, usageCounts = null } = {},
) {
  const list = Array.isArray(proxies) ? [...proxies] : [];
  if (!sort || sort === "default") return list;

  return list.sort((a, b) => {
    const aName = proxyName(a) || String(a?.id ?? "");
    const bName = proxyName(b) || String(b?.id ?? "");

    if (sort === "name") {
      return proxySortCollator.compare(aName, bName);
    }

    if (sort === "latency") {
      const aLat = typeof latencyOf === "function" ? latencyOf(a) : a?.latency;
      const bLat = typeof latencyOf === "function" ? latencyOf(b) : b?.latency;
      const aValid = typeof aLat === "number" && Number.isFinite(aLat);
      const bValid = typeof bLat === "number" && Number.isFinite(bLat);
      if (aValid && bValid && aLat !== bLat) return aLat - bLat;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return proxySortCollator.compare(aName, bName);
    }

    if (sort === "score") {
      const aScore = typeof a?.score === "number" && Number.isFinite(a.score) ? a.score : null;
      const bScore = typeof b?.score === "number" && Number.isFinite(b.score) ? b.score : null;
      if (aScore !== null && bScore !== null && aScore !== bScore) return bScore - aScore;
      if ((aScore !== null) !== (bScore !== null)) return aScore !== null ? -1 : 1;
      return proxySortCollator.compare(aName, bName);
    }

    if (sort === "usage") {
      const diff = usageCountFor(b, usageCounts) - usageCountFor(a, usageCounts);
      if (diff !== 0) return diff;
      return proxySortCollator.compare(aName, bName);
    }

    return 0;
  });
}