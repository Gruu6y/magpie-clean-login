// Pure helpers for the provider sign-in dialog. Keeping them out of app.js
// lets the tests pin the request shape and the "is a flow still running?"
// decision without a DOM or a running service.

import { signInAccount } from "./account-state.js";
import { hasKeyword, proxyName } from "./proxy-filter.js";
import { formatAddress, statusView } from "./proxy-state.js";
import { targetStatusSuffix } from "./proxy-target.js";

// The sign-in dialog probes the candidate exits in the background so the user
// sees live latency right in the dropdown. A small cap keeps dozens of Clash
// listeners from all opening sockets at once.
export const SIGN_IN_PROXY_TEST_CONCURRENCY = 4;

const signInProxyNameCollator = new Intl.Collator("zh-Hans", {
  numeric: true,
  sensitivity: "base",
});

function rememberLogin(logins, login) {
  if (!login || typeof login !== "object") return;
  if (typeof login.proxyId === "string" && login.proxyId.trim()) {
    logins.ids.add(login.proxyId.trim());
  }
  if (typeof login.proxyName === "string" && login.proxyName.trim()) {
    logins.names.add(login.proxyName.trim().toLowerCase());
  }
}

// A proxy counts as used when any identity belonging to this provider has a
// successful login recorded through it. Match the stored id first, but also
// remember the node name: rebuilding the proxy list can allocate fresh ids
// for the same Clash exits. Direct logins have a null id and are not proxies.
export function usedSignInProxies(accounts = [], provider) {
  const logins = { ids: new Set(), names: new Set() };
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!account || account.provider !== provider) continue;
    for (const login of Array.isArray(account.loginHistory) ? account.loginHistory : []) {
      rememberLogin(logins, login);
    }
    rememberLogin(logins, account.lastLogin);
  }
  return logins;
}

// A first-time sign-in should prefer an exit this provider has not seen:
// static, then residential, then everything else. Used exits stay available,
// but move to the end. Names use natural numeric order (R2 before R10).
export function orderSignInProxies(proxies = [], accounts = [], provider) {
  const used = usedSignInProxies(accounts, provider);
  return (Array.isArray(proxies) ? proxies : [])
    .map((proxy, index) => ({ proxy, index }))
    .filter(({ proxy }) => proxy && typeof proxy === "object")
    .sort((a, b) => {
      const rank = (proxy) => {
        const id = typeof proxy.id === "string" ? proxy.id.trim() : "";
        const name = proxyName(proxy).trim().toLowerCase();
        if (used.ids.has(id) || (name && used.names.has(name))) return 3;
        if (hasKeyword(proxy, "静态")) return 0;
        if (hasKeyword(proxy, "家宽")) return 1;
        return 2;
      };
      const difference = rank(a.proxy) - rank(b.proxy);
      if (difference) return difference;
      const aName = proxyName(a.proxy).trim() || String(a.proxy.id ?? "");
      const bName = proxyName(b.proxy).trim() || String(b.proxy.id ?? "");
      return signInProxyNameCollator.compare(aName, bName) || a.index - b.index;
    })
    .map(({ proxy }) => proxy);
}

// The text of one `<option>` in the sign-in proxy picker. `<option>` only
// renders plain text, so the probe verdict (or its live testing state) sits at
// the end of the line where the user can compare exits before picking one.
export function formatSignInProxyOption(proxy = {}, labels = {}, testing = false) {
  const name = proxyName(proxy).trim() || String(proxy?.id ?? "");
  const base = `${name} · ${formatAddress(proxy)}`;
  const view = statusView(proxy, labels, testing);
  if (view.state === "testing") return `${base} · ${view.label}`;
  if (view.state === "ok") {
    // When the row was decorated for a provider target, the number belongs to
    // that provider. Name it so a generic measurement can never be mistaken
    // for a provider-specific one. Undecorated rows keep the exact old text.
    const target = targetStatusSuffix(proxy);
    return `${base} · ${view.detail || view.label}${target}`;
  }
  if (view.state === "error") return `${base} · ${view.label}`;
  return base;
}

// Probes the candidate exits in display order with a small worker pool. The
// caller's `signal` cancels every still-queued or in-flight probe when the
// dialog closes or a fresh pass starts, and `onResult` lets the dropdown
// redraw as each exit finishes instead of waiting for the slowest timeout.
export async function probeSignInProxies(
  proxies = [],
  probe,
  { concurrency = SIGN_IN_PROXY_TEST_CONCURRENCY, signal, onStart, onResult } = {},
) {
  if (typeof probe !== "function") return;
  const seen = new Set();
  const queue = [];
  for (const proxy of Array.isArray(proxies) ? proxies : []) {
    const id = typeof proxy?.id === "string" ? proxy.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    queue.push(proxy);
  }
  if (queue.length === 0 || signal?.aborted) return;
  const limit = Math.max(1, Math.min(queue.length, Math.trunc(Number(concurrency) || 1)));
  let cursor = 0;
  const worker = async () => {
    while (!signal?.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      const proxy = queue[index];
      onStart?.(proxy);
      try {
        const result = await probe(proxy, { signal });
        if (signal?.aborted) return;
        onResult?.(proxy, result, null);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return;
        onResult?.(proxy, null, error);
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

// The proxy value sent to `POST /api/signin`. It deliberately carries only the
// public proxy fields; the stored password never leaves the service. The
// service resolves the record by `id` and fills in the credential itself. A
// null/blank selection means "no proxy (direct)".
export function signInProxy(proxy) {
  if (!proxy || typeof proxy !== "object" || typeof proxy.id !== "string" || !proxy.id) {
    return null;
  }
  return {
    id: proxy.id,
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username || "",
  };
}

// The exact label of the method the user picked, when the plugin exposes
// several (ZCode's per-site oauth methods). The service looks the method up
// by this label, so it must match exactly; an empty selection means "let the
// service choose".
export function signInMethodLabel(label) {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  return trimmed ? trimmed : null;
}

// The answers to a method's declared prompts, as the service accepts them: a
// plain object of non-empty trimmed strings. Blank fields are dropped so a
// select left on "choose" falls back to the plugin's own default, and an object
// with nothing filled in is not sent at all.
export function signInInputs(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  const inputs = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof key !== "string" || !key) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    inputs[key] = trimmed;
  }
  return Object.keys(inputs).length > 0 ? inputs : null;
}
export function signInPayload(provider, proxy, methodLabel = null, account = null, inputs = null) {
  const payload = { provider: String(provider || ""), proxy: signInProxy(proxy) };
  const label = signInMethodLabel(methodLabel);
  if (label) payload.methodLabel = label;
  // An existing identity to continue. Only the account key travels; the
  // service looks the directory up and verifies its ledger.
  const claim = signInAccount(account);
  if (claim) payload.account = claim;
  // The answers the chosen method asked for (a team's site, an enterprise VPC
  // instance or domain, a Personal Access Token). They travel once, with the
  // request, and the flow never returns them.
  const answers = signInInputs(inputs);
  if (answers) payload.inputs = answers;
  return payload;
}

// The body of `POST /api/signin/code`: the one-time code the plugin sent.
export function signInCodePayload(code) {
  return { code: typeof code === "string" ? code.trim() : "" };
}

// A flow is still running until it reaches one of the terminal states. Used to
// decide whether closing the dialog must cancel the flow first.
export function signInActive(state) {
  return (
    state === "authorizing" ||
    state === "waiting-login" ||
    state === "waiting-code" ||
    state === "finishing"
  );
}

// A flow is waiting for the user to type the one-time code the plugin sent.
// The dialog swaps the browser note for a code box in exactly this state.
export function signInAwaitingCode(state) {
  return state === "waiting-code";
}

// The terminal states the UI must stop polling on.
export function signInSettled(state) {
  return state === "done" || state === "error" || state === "cancelled";
}
