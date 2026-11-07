// The "test target" work spans two pure modules: the service-side resolver
// that decides which host a probe may talk to, and the page-side projection
// that labels a latency number. These tests pin the boundaries: only https
// API origins are offered, the generic default is byte-for-byte the historical
// probe, an unknown target is a hard error, credentials never enter a probe,
// and a provider label can never display another target's number.

import { expect, test } from "bun:test";
import {
  GENERIC_TARGET,
  parseApiOrigin,
  providerTargets,
  resolveProxyTarget,
  targetHostLabel,
} from "../lib/proxy-target.mjs";
import {
  EMPTY_TARGETS,
  GENERIC_TARGET_ID,
  findTarget,
  normalizeProxyTargets,
  providerLatency,
  proxyForTarget,
  resolveTargetId,
  targetOptionLabel,
  targetStatusSuffix,
  withProbeResult,
} from "../ui/proxy-target.js";
import { filterProxies } from "../ui/proxy-filter.js";
import { formatSignInProxyOption } from "../ui/signin-state.js";
import { normalizeLatencyMap, publicProxy } from "../lib/proxies.mjs";

const PROVIDERS = [
  { id: "qoder", name: "Qoder", api: "https://api3.qoder.sh/v1", methods: ["oauth"] },
  { id: "qoder-cn", name: "Qoder CN", api: "https://gateway.qoder.com.cn" },
  { id: "bad", name: "Plain http", api: "http://insecure.example.com" },
  { id: "secret", name: "Credential in URL", api: "https://u:p@leak.example.com" },
  { id: "none", name: "No api" },
  { id: "qoder", name: "Duplicate", api: "https://duplicate.example.com" },
];

test("parseApiOrigin accepts only credential-free https origins", () => {
  expect(parseApiOrigin("https://api3.qoder.sh/v1/chat?x=1")).toEqual({
    host: "api3.qoder.sh",
    url: "https://api3.qoder.sh/",
  });
  expect(parseApiOrigin(" https://gateway.qoder.com.cn:8443/base ")).toEqual({
    host: "gateway.qoder.com.cn:8443",
    url: "https://gateway.qoder.com.cn:8443/",
  });
  expect(parseApiOrigin("http://api3.qoder.sh")).toBeNull();
  expect(parseApiOrigin("https://u:p@leak.example.com")).toBeNull();
  expect(parseApiOrigin("https://")).toBeNull();
  expect(parseApiOrigin("not a url")).toBeNull();
  expect(parseApiOrigin(`https://${"a".repeat(256)}.example.com`)).toBeNull();
  expect(parseApiOrigin(null)).toBeNull();
  expect(parseApiOrigin(42)).toBeNull();
});

test("providerTargets offers only distinct ids with a usable API host", () => {
  expect(providerTargets(PROVIDERS)).toEqual([
    { id: "qoder", name: "Qoder", host: "api3.qoder.sh", url: "https://api3.qoder.sh/" },
    { id: "qoder-cn", name: "Qoder CN", host: "gateway.qoder.com.cn", url: "https://gateway.qoder.com.cn/" },
  ]);
  expect(providerTargets()).toEqual([]);
  expect(providerTargets(null)).toEqual([]);
  expect(providerTargets([null, 1, "x", {}])).toEqual([]);
});

test("resolveProxyTarget keeps the generic default and rejects unknown ids", () => {
  expect(resolveProxyTarget("")).toEqual({ target: { ...GENERIC_TARGET }, error: null });
  expect(resolveProxyTarget(undefined)).toEqual({ target: { ...GENERIC_TARGET }, error: null });
  expect(resolveProxyTarget("qoder-cn", PROVIDERS)).toEqual({
    target: {
      kind: "provider",
      provider: "qoder-cn",
      host: "gateway.qoder.com.cn",
      url: "https://gateway.qoder.com.cn/",
    },
    error: null,
  });
  // A silent fallback here would label an ipinfo latency as the provider's.
  expect(resolveProxyTarget("ghost", PROVIDERS)).toEqual({ target: null, error: "unknown_target" });
  expect(resolveProxyTarget({ id: "qoder" }, PROVIDERS)).toEqual({ target: { ...GENERIC_TARGET }, error: null });
  expect(targetHostLabel(GENERIC_TARGET)).toBe("");
  expect(targetHostLabel({ host: "api3.qoder.sh" })).toBe("api3.qoder.sh");
  expect(targetHostLabel(null)).toBe("");
});

test("the generic target is frozen and never mutated by a resolution", () => {
  const first = resolveProxyTarget("", PROVIDERS).target;
  first.kind = "provider";
  expect(GENERIC_TARGET.kind).toBe("generic");
  expect(resolveProxyTarget("", PROVIDERS).target.kind).toBe("generic");
});

const CATALOGUE = normalizeProxyTargets({
  generic: { host: "ipinfo.io", url: "https://ipinfo.io/json" },
  targets: [
    { id: "qoder-cn", name: "Qoder CN", host: "gateway.qoder.com.cn", url: "https://gateway.qoder.com.cn/" },
    { id: "qoder-cn", name: "Duplicate", host: "duplicate.example.com" },
    { id: "", name: "No id", host: "blank.example.com" },
    { id: "broken", name: "No host", host: "" },
    null,
    { id: "qoder", name: "Qoder", host: "api3.qoder.sh", url: "https://api3.qoder.sh/" },
  ],
});

test("normalizeProxyTargets bounds the catalogue and drops unusable rows", () => {
  expect(CATALOGUE.generic).toEqual({ id: "", host: "ipinfo.io", url: "https://ipinfo.io/json" });
  expect(CATALOGUE.targets).toEqual([
    { id: "qoder-cn", name: "Qoder CN", host: "gateway.qoder.com.cn", url: "https://gateway.qoder.com.cn/" },
    { id: "qoder", name: "Qoder", host: "api3.qoder.sh", url: "https://api3.qoder.sh/" },
  ]);
  expect(normalizeProxyTargets(null)).toEqual(EMPTY_TARGETS);
  expect(normalizeProxyTargets({ targets: "oops" })).toEqual(EMPTY_TARGETS);
  expect(EMPTY_TARGETS.targets).toEqual([]);
  expect(GENERIC_TARGET_ID).toBe("");
});

test("a stale or unknown selection falls back to the generic option", () => {
  expect(findTarget(CATALOGUE, "qoder")).toMatchObject({ host: "api3.qoder.sh" });
  expect(findTarget(CATALOGUE, "")).toBeNull();
  expect(resolveTargetId("qoder-cn", CATALOGUE)).toBe("qoder-cn");
  expect(resolveTargetId("uninstalled", CATALOGUE)).toBe("");
  expect(resolveTargetId(null, CATALOGUE)).toBe("");
  expect(resolveTargetId("qoder", EMPTY_TARGETS)).toBe("");
  expect(targetOptionLabel(findTarget(CATALOGUE, "qoder-cn"), {})).toBe("Qoder CN · gateway.qoder.com.cn");
  expect(targetOptionLabel(null, {})).toBe("");
});

const RECORD = {
  id: "p1",
  status: "ok",
  latency: 41,
  latencyByProvider: {
    "qoder-cn": { ms: 233, host: "gateway.qoder.com.cn", at: "2026-11-08T00:00:00.000Z" },
  },
};

test("proxyForTarget never shows the generic number under a provider label", () => {
  expect(proxyForTarget(RECORD, "", CATALOGUE)).toBe(RECORD);
  expect(proxyForTarget(RECORD, "ghost", CATALOGUE)).toBe(RECORD);
  const decorated = proxyForTarget(RECORD, "qoder-cn", CATALOGUE);
  expect(decorated).toMatchObject({
    latency: 233,
    latencyTarget: {
      id: "qoder-cn",
      name: "Qoder CN",
      host: "gateway.qoder.com.cn",
      at: "2026-11-08T00:00:00.000Z",
    },
  });
  // The stored record keeps its original generic measurement.
  expect(RECORD.latency).toBe(41);
  expect(RECORD.latencyTarget).toBeUndefined();
  const unmeasured = proxyForTarget(RECORD, "qoder", CATALOGUE);
  expect(unmeasured.latency).toBeNull();
  expect(unmeasured.latencyTarget.host).toBe("api3.qoder.sh");
  expect(targetStatusSuffix(RECORD)).toBe("");
  expect(targetStatusSuffix(decorated)).toBe(" · qoder-cn");
});

test("providerLatency rejects malformed entries", () => {
  expect(providerLatency(RECORD, "qoder-cn")).toEqual({
    ms: 233,
    host: "gateway.qoder.com.cn",
    at: "2026-11-08T00:00:00.000Z",
  });
  expect(providerLatency(RECORD, "")).toBeNull();
  expect(providerLatency(RECORD, "missing")).toBeNull();
  expect(providerLatency({ latencyByProvider: { x: { ms: -1 } } }, "x")).toBeNull();
  expect(providerLatency({ latencyByProvider: { x: { ms: Infinity } } }, "x")).toBeNull();
  expect(providerLatency({ latencyByProvider: [] }, "x")).toBeNull();
});

test("withProbeResult folds a provider sweep result into the local record", () => {
  const result = {
    ok: true,
    latency: 188,
    checkedAt: "2026-11-08T01:00:00.000Z",
    target: { kind: "provider", provider: "qoder", host: "api3.qoder.sh" },
  };
  const next = withProbeResult(RECORD, result);
  expect(next.latencyByProvider.qoder).toEqual({
    ms: 188,
    host: "api3.qoder.sh",
    at: "2026-11-08T01:00:00.000Z",
  });
  expect(next.latencyByProvider["qoder-cn"].ms).toBe(233);
  expect(RECORD.latencyByProvider.qoder).toBeUndefined();
  expect(withProbeResult(RECORD, { ...result, ok: false })).toBe(RECORD);
  expect(withProbeResult(RECORD, { ...result, target: { kind: "generic" } })).toBe(RECORD);
  expect(withProbeResult(RECORD, { ...result, latency: NaN })).toBe(RECORD);
});

test("the sign-in option keeps its historical text when no target is selected", () => {
  const labels = { statusOk: "Available", statusUntested: "Never tested", statusTesting: "Testing…", statusError: "Failed" };
  const plain = { id: "p1", name: "HK", host: "127.0.0.1", port: 7890, status: "ok", latency: 41 };
  const expected = "HK · 127.0.0.1:7890 · 41 ms";
  expect(formatSignInProxyOption(plain, labels)).toBe(expected);
  const decorated = proxyForTarget(RECORD, "qoder-cn", CATALOGUE);
  const labelled = formatSignInProxyOption({ ...plain, ...decorated }, labels);
  expect(labelled).toBe("HK · 127.0.0.1:7890 · 233 ms · qoder-cn");
});

test("the latency filter follows the selected target without changing the default", () => {
  const rows = [
    { id: "a", latency: 30, latencyByProvider: { "qoder-cn": { ms: 500, host: "gateway.qoder.com.cn" } } },
    { id: "b", latency: 400, latencyByProvider: { "qoder-cn": { ms: 80, host: "gateway.qoder.com.cn" } } },
    { id: "c", latency: null, latencyByProvider: {} },
  ];
  const byProvider = (proxy) => proxyForTarget(proxy, "qoder-cn", CATALOGUE).latency;
  expect(filterProxies(rows, { minLatency: "100" }).map((row) => row.id)).toEqual(["b"]);
  expect(filterProxies(rows, { minLatency: "100", latencyOf: byProvider }).map((row) => row.id)).toEqual(["a"]);
  expect(filterProxies(rows, { maxLatency: "100", latencyOf: byProvider }).map((row) => row.id)).toEqual(["b"]);
  // An unmeasured provider row is excluded rather than treated as 0 ms.
  expect(filterProxies(rows, { minLatency: "1", latencyOf: byProvider }).map((row) => row.id)).toEqual(["a", "b"]);
});

test("the stored latency map is bounded and survives a public projection", () => {
  const entries = normalizeLatencyMap({
    good: { ms: 12.6, host: "api3.qoder.sh", at: "2026-11-08T00:00:00.000Z" },
    bad: { ms: -3, host: "x" },
    "": { ms: 1, host: "x" },
    "has\ncontrol": { ms: 1, host: "x" },
    array: [1],
    [String("x".repeat(200))]: { ms: 1 },
  });
  expect(Object.keys(entries)).toEqual(["good"]);
  expect(entries.good.ms).toBe(13);
  const publicRow = publicProxy({
    id: "p1", name: "HK", type: "http", host: "127.0.0.1", port: 7890,
    status: "ok", latency: 41, latencyByProvider: entries,
    createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
  });
  expect(publicRow.latency).toBe(41);
  expect(publicRow.latencyByProvider).toEqual(entries);
  expect(JSON.stringify(publicRow)).not.toContain("password");
});
