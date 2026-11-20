// The management UI only exists inside magpie: its launcher frame navigates
// here from an opaque-origin sandbox, so a live page is always framed and
// always opaque-origin itself. The document embeds the per-process API token,
// so anything that loads it another way -- a plain browser tab, or a
// readable (non-sandboxed) foreign iframe -- is given a stub instead of a
// working UI. A sandboxed foreign iframe still receives the document, but its
// fetch carries `Origin: null` and has no way to learn the token, so the API
// stays closed to it; on Chromium the ancestor chain below also refuses the
// render, which is the only signal a foreign sandboxed parent cannot spoof.
//
// `frame-ancestors` cannot do this job: the launcher document is itself
// opaque-origin, which matches no ancestor source, so any list would block
// magpie too.
//
// Two http(s) ancestors are trusted rather than foreign:
// - `wails.localhost` / `tauri.localhost`: the desktop webview transport on
//   Windows. Wails serves magpie's window at http://wails.localhost there
//   (macOS and Linux use wails://, which never reaches this check). No
//   browser on Windows resolves these names, so a web page cannot claim
//   them; only a native webview can be that parent.
// - the page's own URL origin: under `magpie web` the window is a real
//   http(s) page and this UI is served through the same server's service
//   prefix. A parent on our own origin is a document our service itself
//   served -- it could already hold the token, so it gains nothing here.
//
// All inputs are passed in so the rule is testable without a DOM.
// `pageOrigin` is the URL's origin (location.origin): inside a sandbox it
// still reports the served origin where `origin` reports "null".
const TRUSTED_WEBVIEW_HOSTS = new Set(["wails.localhost", "tauri.localhost"]);

function trustedAncestor(entry, pageOrigin) {
  const text = String(entry).trim().toLowerCase();
  if (!/^https?:/.test(text)) return true; // not an http(s) ancestor
  let u;
  try {
    u = new URL(text);
  } catch {
    return false; // an http(s)-looking entry that does not parse: refuse it
  }
  if (TRUSTED_WEBVIEW_HOSTS.has(u.hostname.replace(/\.$/, ""))) return true;
  return typeof pageOrigin === "string" && pageOrigin !== "null" && u.origin === pageOrigin;
}

export function embedAllowed({ top, self, origin, ancestorOrigins, pageOrigin } = {}) {
  try {
    // A real top-level document was opened directly. magpie never does that.
    if (top === self) return false;
    // A framed page that kept its own http(s) origin is framed WITHOUT the
    // sandbox; its parent could read the token right out of the DOM.
    if (typeof origin === "string" && origin !== "null") return false;
    // Chromium reports the embedding chain even from an opaque origin. Every
    // http(s) entry must be a trusted host or our own origin; a foreign
    // http(s) ancestor anywhere in the chain refuses the render.
    const chain = ancestorOrigins;
    if (chain && chain.length > 0) {
      for (let i = 0; i < chain.length; i += 1) {
        if (!trustedAncestor(chain[i], pageOrigin)) return false;
      }
    }
    return true;
  } catch {
    // A host too old to answer these questions keeps the legacy behavior:
    // the API stays token-gated either way.
    return true;
  }
}
