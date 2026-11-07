// Provider logos, taken from magpie.
//
// magpie already draws a brand mark for every provider, and it keeps the two
// things this page needs: the icon set itself, vendored into `assets/icons/` by
// `scripts/build-icons.mjs` (whose `index.json` records the magpie commit it
// came from), and the table that says which mark a provider uses, in
// `<cache>/magpie/providers-state.json`. Nothing here invents a logo: a
// provider either has one in that table or in the vendored set, or its card
// keeps the letter tile it has always had.
//
// A reference is read in magpie's own order of closeness — the preset a
// provider came from, the plugin that declares it, the configured provider, the
// agent list — and an id with no entry is tried by name, the way magpie's own
// page tries one: the slug, then the slug with `-color`. A reference of the
// form `file:<hash>` is a picture magpie downloaded for a brand with no
// built-in mark; those bytes are served back from magpie's own icon folder and
// are never copied here.

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { magpieConfigDir } from "./paths.mjs";
import { magpieCacheDir, STATE_FILE } from "./magpie-catalog.mjs";

export const ICON_ROOT = join(import.meta.dirname, "..", "assets", "icons");
export const MANIFEST_FILE = "index.json";
// Where the page loads a vendored mark from. Relative, because the page is
// served by the same loopback service as everything else here.
export const ICON_URL_BASE = "assets/icons/";
// Not under `/api/`: that whole surface is behind the page token header, and an
// `<img>` cannot send one. This is served by the same handler that serves the
// page's own files, for one hash-named picture inside magpie's icon folder.
export const USER_ICON_URL_BASE = "provider-icon/";

// magpie names a downloaded icon by a 16 hex digit content hash. Anything else
// is not an icon file and is never opened.
export const USER_ICON_NAME = /^[0-9a-f]{16}\.(?:png|jpg|jpeg|webp|svg)$/;
const USER_ICON_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

let manifestCache = null;

// The vendored set, or null when it was never built. A missing manifest costs
// every logo and nothing else: the page falls back to the letter tile.
export function loadIconManifest(root = ICON_ROOT) {
  if (manifestCache && manifestCache.root === root) return manifestCache.manifest;
  let manifest = null;
  try {
    const parsed = JSON.parse(readFileSync(join(root, MANIFEST_FILE), "utf8"));
    if (parsed && parsed.icons && typeof parsed.icons === "object") manifest = parsed;
  } catch {
    manifest = null;
  }
  manifestCache = { root, manifest };
  return manifest;
}

// The manifest is cached per process; a test pointing at another directory has
// to drop what the last one read.
export function resetIconManifest() {
  manifestCache = null;
}

function text(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// id → magpie's own reference for it, plus where that reference came from.
// The file is magpie's, it changes when magpie learns something, and it is
// large enough that reading it for every card of every request would be
// wasteful: it is re-read when its size or mtime moves.
const refsCache = new Map();

export function readIconRefs(env = process.env) {
  const file = join(magpieCacheDir(env), STATE_FILE);
  let stamp = "";
  try {
    const info = lstatSync(file);
    stamp = `${info.size}:${Math.trunc(info.mtimeMs)}`;
  } catch {
    return { available: false, refs: new Map() };
  }
  const known = refsCache.get(file);
  if (known && known.stamp === stamp) return { available: known.refs.size > 0, refs: known.refs };
  let doc = null;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { available: false, refs: new Map() };
  }
  const state = doc && doc.providers && typeof doc.providers === "object" ? doc.providers : null;
  if (!state) return { available: false, refs: new Map() };
  const refs = new Map();
  const take = (rows, origin) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = text(row && row.id);
      const icon = text(row && row.icon);
      if (!id || !icon || icon === "generic") continue;
      if (!refs.has(id)) refs.set(id, { ref: icon, origin });
    }
  };
  take(state.presets, "preset");
  take(state.plugins, "plugin");
  take(state.providers, "provider");
  for (const row of Array.isArray(state.providers) ? state.providers : []) {
    if (!row || typeof row !== "object") continue;
    for (const agent of Array.isArray(row.agents) ? row.agents : []) {
      const id = text(agent && agent.id);
      const icon = text(agent && agent.icon);
      if (id && icon && icon !== "generic" && !refs.has(id)) refs.set(id, { ref: icon, origin: "agent" });
    }
  }
  const out = { available: refs.size > 0, refs };
  refsCache.set(file, { stamp, refs });
  return out;
}

export function slugId(value) {
  return text(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The names to try when magpie's table says nothing about an id. magpie spells
// its own files both ways — `githubcopilot` and `github-copilot`-style ids come
// from different places — so a slug is also tried with its dashes removed, and
// a suffixed id (`trae-cn`, `opencode-zen-free`, the `hub-*` mirrors) is tried
// by dropping trailing segments, longest first. A dropped prefix has to be four
// characters or more, so a short tail cannot borrow another brand's mark.
export function iconNameCandidates(id, name) {
  const out = [];
  const push = (value) => {
    if (!value) return;
    for (const candidate of [value, `${value}-color`]) if (!out.includes(candidate)) out.push(candidate);
  };
  for (const value of [id, name]) {
    const key = slugId(value);
    if (!key) continue;
    push(key);
    push(key.replace(/-/g, ""));
    const parts = key.split("-");
    for (let kept = parts.length - 1; kept >= 1; kept -= 1) {
      const prefix = parts.slice(0, kept).join("-");
      if (prefix.length >= 4) push(prefix);
    }
  }
  return out;
}

// One entry of the vendored set by reference name, with the file checked to
// still be there. `kind` is magpie's own distinction: a `picture` carries its
// colours and is drawn as an image; a `mark` is black on transparent and is
// tinted by the text colour, so it reads in both themes.
function vendored(name, manifest) {
  const entry = manifest.icons[name];
  if (!entry || typeof entry.file !== "string" || !entry.file.startsWith(`${name}.`)) return null;
  if (!existsSync(join(ICON_ROOT, entry.file))) return null;
  return { src: `${ICON_URL_BASE}${encodeURI(entry.file)}`, kind: entry.kind, ref: name };
}

// A picture magpie downloaded for a brand with no built-in mark. The bytes stay
// in magpie's folder: this only answers whether they are there and under what
// address they are served. A symlink is refused, so the name cannot be steered
// out of the icon folder by whoever wrote the state file.
export function userIcon(reference, { env = process.env, iconsDir } = {}) {
  const name = String(reference || "").startsWith("file:")
    ? String(reference).slice(5)
    : String(reference || "");
  if (!USER_ICON_NAME.test(name)) return null;
  const dir = iconsDir || join(magpieConfigDir(env), "icons");
  const file = join(dir, name);
  try {
    if (!lstatSync(file).isFile()) return null;
    if (resolve(realpathSync(file)) !== resolve(file)) return null;
  } catch {
    return null;
  }
  return { src: `${USER_ICON_URL_BASE}${name}`, kind: "picture", ref: `file:${name}` };
}

// The logo for one provider card, or null to keep the letter tile.
export function providerLogo(
  provider,
  { refs, manifest = loadIconManifest(), env = process.env, iconsDir } = {},
) {
  if (!manifest) return null;
  const id = text(provider && provider.id);
  if (!id) return null;
  const declared = typeof refs?.get === "function" ? refs.get(id)?.ref : undefined;
  const candidates = [];
  if (declared) candidates.push(declared);
  for (const candidate of iconNameCandidates(id, provider?.name)) {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  for (const candidate of candidates) {
    if (candidate.startsWith("file:")) {
      const served = userIcon(candidate, { env, iconsDir });
      if (served) return served;
      continue;
    }
    const found = vendored(candidate, manifest);
    if (found) return found;
  }
  return null;
}

export function userIconType(name) {
  return USER_ICON_TYPES[extname(String(name || "")).toLowerCase()] || null;
}
