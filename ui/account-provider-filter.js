// Pure helpers for the accounts page provider picker. The chips are a
// navigation aid built from the identities the service already returned, so
// the page needs no second endpoint, no pagination and no account mutation.
// Counts deliberately describe the whole account set, not the currently
// filtered rows: a chip must not move or disappear under the pointer while the
// user searches or switches status.

export const ALL_PROVIDERS = "all";
export const UNKNOWN_PROVIDER = "__unknown__";
export const PRIMARY_PROVIDER_LIMIT = 4;

function providerValue(account) {
  const value = account && typeof account === "object" ? account.provider : "";
  return typeof value === "string" ? value.trim() : "";
}

function catalogLabel(catalog, provider, unknownLabel) {
  if (!provider) return unknownLabel;
  const entry = (Array.isArray(catalog) ? catalog : []).find(
    (item) => item?.signInProvider === provider || item?.id === provider,
  );
  return entry?.name || provider;
}

function compareOptions(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  return a.label.localeCompare(b.label) || a.provider.localeCompare(b.provider);
}

export function accountProviderOptions(accounts = [], catalog = [], { unknownLabel = "Unknown" } = {}) {
  const counts = new Map();
  const list = Array.isArray(accounts) ? accounts : [];
  for (const account of list) {
    const key = providerValue(account) || UNKNOWN_PROVIDER;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts]
    .map(([provider, count]) => ({
      provider,
      count,
      label: provider === UNKNOWN_PROVIDER
        ? unknownLabel
        : catalogLabel(catalog, provider, unknownLabel),
    }))
    .sort(compareOptions);
}

export function normalizeSelectedAccountProvider(selected, options = []) {
  if (selected === ALL_PROVIDERS) return ALL_PROVIDERS;
  const provider = typeof selected === "string" ? selected.trim() : "";
  return (Array.isArray(options) ? options : []).some((item) => item?.provider === provider)
    ? provider
    : ALL_PROVIDERS;
}

export function partitionAccountProviders(options = [], selected = ALL_PROVIDERS, limit = PRIMARY_PROVIDER_LIMIT) {
  const list = Array.isArray(options) ? options : [];
  const size = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : PRIMARY_PROVIDER_LIMIT);
  const base = list.slice(0, Math.min(size, list.length));
  const selectedOption = selected === ALL_PROVIDERS
    ? null
    : list.find((item) => item?.provider === selected);
  if (!selectedOption || base.some((item) => item.provider === selectedOption.provider)) {
    return {
      primary: base,
      overflow: list.slice(base.length),
      promoted: null,
    };
  }
  const primary = [...base, selectedOption];
  return {
    primary,
    overflow: list.filter((item) => !primary.some((visible) => visible.provider === item.provider)),
    promoted: selectedOption,
  };
}

export function filterAccountProviderOptions(options = [], query = "") {
  const list = Array.isArray(options) ? options : [];
  const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!normalizedQuery) return list;
  return list.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const label = typeof item.label === "string" ? item.label : "";
    const provider = typeof item.provider === "string" ? item.provider : "";
    return `${label} ${provider}`.toLowerCase().includes(normalizedQuery);
  });
}

export function activeAccountFilterLabels({ provider = ALL_PROVIDERS, status = "all", query = "", allLabel, unknownLabel, providerLabel, statusLabels = {} } = {}) {
  const active = [];
  if (provider !== ALL_PROVIDERS) {
    active.push(providerLabel || (provider === UNKNOWN_PROVIDER ? unknownLabel : provider));
  }
  if (status !== "all") active.push(statusLabels[status] || status);
  const trimmedQuery = typeof query === "string" ? query.trim() : "";
  if (trimmedQuery) active.push(allLabel ? `${allLabel} “${trimmedQuery}”` : trimmedQuery);
  return active;
}
