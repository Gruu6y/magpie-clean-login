// Sign-in egress.
//
// A sign-in has two legs. The browser leg already goes through the proxy the
// dialog picked (browser-launcher.mjs). The other leg is the plugin's own
// network work: it mints the link, sends the SMS, exchanges the code. That code
// runs inside magpie's plugin host, whose fetch wrapper
//
//   host.js:504  async function sent(input, init) {
//                  if (init && "proxy" in init) return bunFetch(input, init)...
//                  const p = await proxyFor(input);
//                  if (!p) return bunFetch(input, init)...
//                  return bunFetch(input, { ...init, proxy: p })...
//                }
//
// only uses the proxy the plugin host decided on (the account's, then the
// subscription's, then magpie's global one). A plugin cannot ask for another
// one: the `magpie` object it receives has no proxy API, and the host runs
// plugin hooks outside its own AsyncLocalStorage. So a sign-in started from this
// plugin reached the provider through magpie's exit, not the one on the card.
//
// We cannot reach magpie's proxy machinery, but we are in the same process as
// the plugin, and the host deliberately hands a request that carries its own
// `proxy` straight to Bun. So: while a plugin's sign-in callback runs, we run it
// under an AsyncLocalStorage that remembers the picked proxy, and the fetch we
// install in front of the host's reads it back and fills `proxy` in.
//
// Two rules keep this narrow:
//   * only requests made inside the store are touched, so nothing else in the
//     host changes;
//   * loopback is left alone, because the local magpie API and the plugin's own
//     server must never be sent through a remote proxy.
import { AsyncLocalStorage } from "node:async_hooks";

// The picked proxy, per sign-in call. A string is the proxy URL, "" means "no
// proxy at all" (what the dialog's direct option says), undefined means "we are
// not inside a sign-in, do not touch this request".
const egress = new AsyncLocalStorage();

// Marks the wrapper we installed, so a later call does not wrap our own wrapper
// again. Another module replacing fetch afterwards is wrapped on top of, which
// keeps the picked proxy in force either way.
const EGRESS_MARK = Symbol.for("clean-login.signin-egress");

// A URL Bun's fetch can use, or "" for a direct request, or undefined when the
// record cannot be used. Bun's fetch proxy understands http:// and https://
// (TLS to the proxy); it rejects socks with UnsupportedProxyProtocol, so a
// SOCKS record is reported as unusable instead of silently breaking the
// sign-in.
export function signInProxyUrl(proxy) {
  if (proxy === null || proxy === undefined) return "";
  if (typeof proxy !== "object") return undefined;
  const type = typeof proxy.type === "string" ? proxy.type.toLowerCase() : "http";
  if (type === "socks5" || type === "socks4" || type === "socks") return undefined;
  const rawHost = typeof proxy.host === "string" ? proxy.host.trim() : "";
  const port = Number(proxy.port);
  if (!rawHost || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  const host = rawHost.includes(":") && !rawHost.startsWith("[") ? `[${rawHost}]` : rawHost;
  const scheme = type === "https" ? "https" : "http";
  const user = typeof proxy.username === "string" ? proxy.username : "";
  const password = typeof proxy.password === "string" ? proxy.password : "";
  const auth = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
    : "";
  return `${scheme}://${auth}${host}:${port}`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function requestUrl(input) {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
  } catch {
    // Fall through: an input we cannot read is left to the host.
  }
  return "";
}

// Loopback and unix sockets stay out of this: the local magpie API, this
// plugin's own server and any IPC socket must not be routed to a remote proxy.
export function isLocalRequest(input) {
  const url = requestUrl(input);
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (parsed.protocol === "unix:") return true;
  return false;
}

function install() {
  const base = globalThis.fetch;
  if (typeof base !== "function") return;
  if (base[EGRESS_MARK]) return;
  const wrapped = function fetch(input, init) {
    const target = egress.getStore();
    if (typeof target !== "string") return base(input, init);
    // The plugin asked for something specific; the host gives that priority too.
    if (init && typeof init === "object" && "proxy" in init) return base(input, init);
    if (isLocalRequest(input)) return base(input, init);
    const next = init && typeof init === "object" ? { ...init } : {};
    next.proxy = target;
    return base(input, next);
  };
  wrapped[EGRESS_MARK] = true;
  globalThis.fetch = Object.assign(wrapped, base);
}

// Run `fn` with the picked proxy in force. `proxy` is a stored proxy record (or
// null for the dialog's direct option). Returns fn's promise unchanged.
export function withSignInEgress(proxy, fn) {
  const target = signInProxyUrl(proxy);
  if (typeof target !== "string") return fn();
  install();
  return egress.run(target, fn);
}

// The proxy in force for the current call, for tests and for the report the
// server hands back. undefined outside a sign-in.
export function currentSignInEgress() {
  return egress.getStore();
}
