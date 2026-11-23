// The sign-in egress: the proxy a sign-in must leave through.
//
// No network request is made here. The fetch installed by the module is driven
// through a recorder that stands in for Bun's fetch, so these tests check the
// decision (which request gets which proxy) and nothing about the wire.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  currentSignInEgress,
  isLocalRequest,
  signInProxyUrl,
  withSignInEgress,
} from "../lib/signin-egress.mjs";

const originalFetch = globalThis.fetch;
const calls = [];

// One recorder for the whole file: the module wraps whatever fetch is current
// the first time a sign-in needs it, so swapping the recorder between tests
// would leave the wrapper pointing at a fetch nothing calls any more.
const recorderFetch = async (input, init) => {
  calls.push({ input: String(input), init });
  return { ok: true, status: 200 };
};

beforeAll(() => {
  globalThis.fetch = recorderFetch;
});

beforeEach(() => {
  calls.length = 0;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const record = (overrides = {}) => ({
  id: "p1",
  type: "http",
  host: "10.1.2.3",
  port: 18118,
  username: "",
  ...overrides,
});

test("a proxy record becomes a URL Bun's fetch understands", () => {
  expect(signInProxyUrl(record())).toBe("http://10.1.2.3:18118");
  expect(signInProxyUrl(record({ type: "https", port: 8080 }))).toBe("https://10.1.2.3:8080");
  expect(signInProxyUrl(record({ host: "proxy.example", port: 3128 }))).toBe(
    "http://proxy.example:3128",
  );
  expect(signInProxyUrl(record({ host: "::1", port: 18118 }))).toBe("http://[::1]:18118");
  expect(signInProxyUrl(record({ host: "[::1]", port: 18118 }))).toBe("http://[::1]:18118");
});

test("credentials are carried, and escaped", () => {
  // Built from parts so the test file never spells a credential out.
  const password = ["p@ss", "word"].join(" ");
  expect(signInProxyUrl(record({ username: "user", password }))).toBe(
    `http://user:${encodeURIComponent(password)}@10.1.2.3:18118`,
  );
  // A username without a password still authenticates.
  expect(signInProxyUrl(record({ username: "user" }))).toBe("http://user:@10.1.2.3:18118");
});

test("the dialog's direct option means no proxy at all", () => {
  expect(signInProxyUrl(null)).toBe("");
  expect(signInProxyUrl(undefined)).toBe("");
});

test("a record Bun cannot use is reported, not silently dropped", () => {
  // Bun's fetch proxy rejects SOCKS with UnsupportedProxyProtocol, so a SOCKS
  // record must not be handed to it: the sign-in would fail for a reason the
  // user cannot see.
  expect(signInProxyUrl(record({ type: "socks5" }))).toBeUndefined();
  expect(signInProxyUrl(record({ type: "socks4" }))).toBeUndefined();
  expect(signInProxyUrl(record({ host: "" }))).toBeUndefined();
  expect(signInProxyUrl(record({ port: 0 }))).toBeUndefined();
  expect(signInProxyUrl(record({ port: 70000 }))).toBeUndefined();
  expect(signInProxyUrl("10.1.2.3:18118")).toBeUndefined();
});

test("loopback is never routed to a remote proxy", () => {
  expect(isLocalRequest("http://127.0.0.1:3492/api/proxies")).toBe(true);
  expect(isLocalRequest("http://localhost:3492/")).toBe(true);
  expect(isLocalRequest(new URL("http://[::1]:3492/"))).toBe(true);
  expect(isLocalRequest("http://magpie.localhost:8080/")).toBe(true);
  expect(isLocalRequest("https://account.xfinfr.com/login/phone/sendMsgCode")).toBe(false);
  expect(isLocalRequest("not a url")).toBe(false);
});

test("a request made inside a sign-in leaves through the picked proxy", async () => {
  await withSignInEgress(record(), () => fetch("https://vendor.example/signin"));
  expect(calls).toHaveLength(1);
  expect(calls[0].init?.proxy).toBe("http://10.1.2.3:18118");
});

test("the direct option asks for no proxy, not for magpie's", async () => {
  await withSignInEgress(null, () => fetch("https://vendor.example/signin"));
  expect(calls[0].init?.proxy).toBe("");
});

test("a request outside a sign-in is left exactly as it was", async () => {
  await fetch("https://vendor.example/other", { method: "POST" });
  expect(calls[0].init).toEqual({ method: "POST" });
});

test("a request that already names a proxy keeps it", async () => {
  await withSignInEgress(record(), () =>
    fetch("https://vendor.example/signin", { proxy: "http://10.9.9.9:9999" }),
  );
  expect(calls[0].init?.proxy).toBe("http://10.9.9.9:9999");
});

test("a local request stays local even inside a sign-in", async () => {
  await withSignInEgress(record(), () => fetch("http://127.0.0.1:3492/api/proxies"));
  expect(calls[0].init).toBeUndefined();
});

test("the proxy is in force only while the call runs", async () => {
  expect(currentSignInEgress()).toBeUndefined();
  await withSignInEgress(record(), async () => {
    expect(currentSignInEgress()).toBe("http://10.1.2.3:18118");
    // The store follows the async chain, so a request made after an await still
    // sees it.
    await Promise.resolve();
    expect(currentSignInEgress()).toBe("http://10.1.2.3:18118");
    await fetch("https://vendor.example/late");
  });
  expect(currentSignInEgress()).toBeUndefined();
  expect(calls[0].init?.proxy).toBe("http://10.1.2.3:18118");
});

test("a record Bun cannot use does not run the call under a wrong exit", async () => {
  let ran = false;
  await withSignInEgress(record({ type: "socks5" }), () => {
    ran = true;
    expect(currentSignInEgress()).toBeUndefined();
  });
  expect(ran).toBe(true);
});

test("the picked proxy is still in force after an await inside the call", async () => {
  // The plugin's callback runs after authorize() returns, so the wrapper must
  // not depend on being nested inside a single synchronous block.
  const seen = [];
  await withSignInEgress(record(), async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    seen.push(currentSignInEgress());
  });
  expect(seen).toEqual(["http://10.1.2.3:18118"]);
});
