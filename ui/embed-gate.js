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
// All inputs are passed in so the rule is testable without a DOM.
export function embedAllowed({ top, self, origin, ancestorOrigins } = {}) {
  try {
    // A real top-level document was opened directly. magpie never does that.
    if (top === self) return false;
    // A framed page that kept its own http(s) origin is framed WITHOUT the
    // sandbox; its parent could read the token right out of the DOM.
    if (typeof origin === "string" && origin !== "null") return false;
    // Chromium reports the embedding chain even from an opaque origin. The
    // launcher is always sandboxed, so an http(s) parent is a foreign page.
    const chain = ancestorOrigins;
    if (chain && chain.length > 0 && /^https?:/i.test(String(chain[0]))) return false;
    return true;
  } catch {
    // A host too old to answer these questions keeps the legacy behavior:
    // the API stays token-gated either way.
    return true;
  }
}
