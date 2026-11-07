// Vendor magpie's own provider logo set into this plugin.
//
// magpie's provider page draws a brand mark for every provider, and the only
// honest source for those marks is magpie itself: its icon files are embedded
// in magpie.exe and are not readable at runtime, and the plugin HTTP surface
// (the gateway port) does not serve them either. So the set is copied here once,
// with its provenance recorded in `assets/icons/index.json`, and the page never
// fetches a logo from anywhere else.
//
//   node scripts/build-icons.mjs --src <magpie tree> [--from-binary <magpie.exe>]
//   node scripts/build-icons.mjs --reclassify [--from-binary <magpie.exe>]
//
// The rendering rule is magpie's own, copied from its app.js: a name ending in
// `-color`, or one of the handful of raster marks, is drawn as a picture in its
// own colours; every other name is a black-and-white mark that is tinted by the
// text colour, so it follows the theme. That list is kept here as data, so a
// test can prove the two sides still agree.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// magpie's `pngIcons`: the marks that only exist as raster files.
export const PNG_ICONS = Object.freeze([
  "crush",
  "zcode",
  "alma",
  "hanako",
  "cindy",
  "lody",
  "typesafe",
  "atomcode",
  "snow",
  "mlx-serve",
  "mothx",
  "zoo-code",
  "kimi-code-desktop",
]);

// A logo is drawn as a picture when it carries its own colours; otherwise it is
// a mark that takes the text colour. magpie's rule for how a name is drawn, kept
// as data so a test can prove the two sides still agree. One thing that rule
// cannot see is inside the file: a drawing that carries its own colours cannot
// be redrawn in the text colour, and masking one turns a brand's art into a flat
// blob. Those are shown as pictures, which is what they are. A png can never be
// recoloured by CSS.
export function logoKind(name, body = null) {
  if (name.endsWith("-color") || PNG_ICONS.includes(name)) return "picture";
  if (body === null) return "picture";
  return body.includes("currentColor") ? "mark" : "picture";
}

const RULE =
  "a `-color` name, one of pngIcons, or a file that carries its own colours is a picture; anything else takes the text colour";

const TARGET = join(import.meta.dirname, "..", "assets", "icons");
const IGNORED = new Set(["README.md", "index.json"]);

function readArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// The commit is recorded when the source tree is a checkout; a plain directory
// costs nothing but the provenance line, so the build still runs.
// What this folder is, written for the person who has to decide whether it may
// ship. The builder writes it so the shelf and its notice cannot drift apart.
export const NOTICES_FILE = "NOTICES.md";
const NOTICES = `# Third-party brand marks in this folder

Every file here is a company's or project's own artwork. It was taken from the
icon set magpie itself ships - see \`source\` in \`index.json\` for the binary it
came out of, the revision that binary reports, and when it was built.

Clean Login draws these marks on one screen for one purpose: to show which
service a card is about, the way magpie's own page already does. Nothing here is
owned by this project, and this file grants nothing. Displaying a mark stays
inside the terms of its owner and of the copy of magpie you installed.

If you own a mark that should not be here, open an issue and it will be removed.
`;

function writeNotices(out) {
  writeFileSync(join(out, NOTICES_FILE), NOTICES);
}

function describeSource(src, info = {}) {
  return {
    project: "magpie",
    // The folder the builder actually read, which is also the prefix the
    // binary carries for every one of these names.
    path: info.path || "assets/icons",
    version: info.version || "",
    commit: info.commit || "",
    builtAt: info.builtAt || "",
    obtained: info.obtained || (src ? "a magpie work tree" : ""),
    // A note beside the shelf, not a promise about somebody else's tree.
    notices: NOTICES_FILE,
  };
}

export function collect(srcIcons) {
  const icons = {};
  for (const file of readdirSync(srcIcons).sort()) {
    if (IGNORED.has(file)) continue;
    const ext = file.slice(file.lastIndexOf("."));
    if (![".svg", ".png"].includes(ext)) continue;
    const name = file.slice(0, -ext.length);
    const raw = readFileSync(join(srcIcons, file));
    const digest = createHash("sha256").update(raw).digest("hex");
    icons[name] = {
      file,
      kind: logoKind(name, ext === ".svg" ? raw.toString("utf8") : null),
      bytes: raw.length,
      sha256: digest.slice(0, 16),
    };
  }
  return icons;
}

// magpie ships no readable folder and no package.json: what its icons were
// built from is baked into the binary as Go build info, and every icon's path is
// baked in beside its bytes. Reading the binary here means the manifest states a
// provenance the same command checked, rather than one somebody typed in.
export function readBinary(path, icons = null, folder = "assets/icons") {
  if (!path) return {};
  const text = readFileSync(path).toString("latin1");
  const revision = /vcs\.revision=([0-9a-f]{7,40})/.exec(text)?.[1] ?? "";
  if (!revision) throw new Error(`${path}: no Go build info (vcs.revision) to read provenance from`);
  const builtAt = /vcs\.time=([0-9T:.Z+-]{10,40})/.exec(text)?.[1] ?? "";
  if (icons) {
    const missing = Object.values(icons).filter((entry) => !text.includes(`${folder}/${entry.file}`));
    if (missing.length) {
      const names = missing.slice(0, 5).map((entry) => entry.file).join(", ");
      throw new Error(`${path} does not carry ${missing.length} of ${Object.keys(icons).length} name(s): ${names}`);
    }
  }
  return { commit: revision, builtAt, obtained: `the installed magpie binary ${basename(path)}` };
}

// Reading the icons out of the installed binary, by its own table rather than
// by guessing where a picture starts. Go's embed.FS keeps one record per file -
// {name, data, hash} - and both strings point into the image: the name into the
// `assets/icons/...` text, the data into the bytes. Following those pointers is
// the difference between a shelf of 195 and a shelf of 193: two of these files
// (liveagent-color.svg wraps a base64 png, openmausbot.svg is a tile) look
// enough like the surrounding UI artwork that carving by `<svg ... </svg>`
// dropped them without a word. A name that cannot be resolved stops the build.
export function readEmbeddedIcons(path, folder = "assets/icons") {
  const exe = readFileSync(path);
  if (exe.toString("ascii", 0, 2) !== "MZ") throw new Error(`${path}: not a Windows binary; use --src with a magpie work tree`);
  const pe = exe.readUInt32LE(0x3c);
  if (exe.toString("ascii", pe, pe + 2) !== "PE") throw new Error(`${path}: no PE header`);
  const count = exe.readUInt16LE(pe + 6);
  const optSize = exe.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const base = exe.readUInt16LE(opt) === 0x20b ? exe.readBigUInt64LE(opt + 24) : BigInt(exe.readUInt32LE(opt + 28));
  const sections = [];
  for (let i = 0; i < count; i += 1) {
    const at = opt + optSize + i * 40;
    sections.push({ va: exe.readUInt32LE(at + 12), vsize: exe.readUInt32LE(at + 8), raw: exe.readUInt32LE(at + 20), rawSize: exe.readUInt32LE(at + 16) });
  }
  const toVA = (off) => {
    for (const s of sections) if (off >= s.raw && off < s.raw + s.rawSize) return base + BigInt(s.va + off - s.raw);
    return null;
  };
  const toOffset = (va) => {
    const rva = va - base;
    for (const s of sections) if (rva >= BigInt(s.va) && rva < BigInt(s.va + s.vsize)) return s.raw + Number(rva - BigInt(s.va));
    return null;
  };
  const text = exe.toString("latin1");
  const names = new Map();
  const pattern = new RegExp(`${folder}/([A-Za-z0-9][A-Za-z0-9._-]*\\.(?:svg|png))`, "g");
  for (const match of text.matchAll(pattern)) if (!names.has(match[1])) names.set(match[1], { at: match.index, length: match[0].length });
  if (!names.size) throw new Error(`${path}: no ${folder}/ names to read`);
  const files = [];
  const unresolved = [];
  for (const [name, info] of names) {
    const va = toVA(info.at);
    const needle = Buffer.alloc(16);
    if (va !== null) {
      needle.writeBigUInt64LE(va, 0);
      needle.writeBigUInt64LE(BigInt(info.length), 8);
    }
    let at = va === null ? -1 : exe.indexOf(needle);
    const second = at === -1 ? -1 : exe.indexOf(needle, at + 1);
    if (at === -1 || second !== -1) {
      unresolved.push(name);
      continue;
    }
    const dataPtr = exe.readBigUInt64LE(at + 16);
    const length = Number(exe.readBigUInt64LE(at + 24));
    const start = toOffset(dataPtr);
    if (start === null || length <= 0 || start + length > exe.length) {
      unresolved.push(name);
      continue;
    }
    files.push({ file: name, raw: exe.subarray(start, start + length) });
  }
  if (unresolved.length) {
    throw new Error(`${path}: ${unresolved.length} of ${names.size} icon(s) have no readable embed record: ${unresolved.slice(0, 5).join(", ")}`);
  }
  return files.sort((a, b) => (a.file < b.file ? -1 : 1));
}

// A shelf written straight out of the binary, with nothing guessed in between.
export function extract({ binary, out = TARGET, path = "assets/icons", version = "" }) {
  const files = readEmbeddedIcons(binary, path);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of files) writeFileSync(join(out, entry.file), entry.raw);
  writeNotices(out);
  const icons = collect(out);
  if (Object.keys(icons).length !== files.length) {
    throw new Error(`${binary}: read ${files.length} icon(s) but the shelf holds ${Object.keys(icons).length}`);
  }
  const manifest = {
    source: describeSource("", { path, ...readBinary(binary, icons, path), version }),
    rule: RULE,
    pngIcons: [...PNG_ICONS],
    count: files.length,
    icons,
  };
  writeFileSync(join(out, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function build({ src, out = TARGET, path = "assets/icons", binary = "", version = "" }) {
  const srcIcons = join(src, path);
  const icons = collect(srcIcons);
  const files = Object.values(icons).map((entry) => entry.file);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of files) writeFileSync(join(out, file), readFileSync(join(srcIcons, file)));
  writeNotices(out);
  const manifest = {
    source: describeSource(src, { path, ...readBinary(binary, icons, path), version }),
    rule: RULE,
    pngIcons: [...PNG_ICONS],
    count: files.length,
    icons,
  };
  writeFileSync(join(out, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// The rule can be corrected without magpie's files moving. This re-derives the
// kind of every entry of the shelf that is already here, and can re-read where
// it came from, but never touches the icon bytes.
export function reclassify(out = TARGET, { binary = "", version = "", path = "" } = {}) {
  const list = join(out, "index.json");
  const manifest = JSON.parse(readFileSync(list, "utf8"));
  const changed = [];
  for (const [name, entry] of Object.entries(manifest.icons)) {
    const raw = readFileSync(join(out, entry.file));
    const kind = logoKind(name, entry.file.endsWith(".svg") ? raw.toString("utf8") : null);
    if (kind === entry.kind) continue;
    changed.push(`${name}: ${entry.kind} -> ${kind}`);
    entry.kind = kind;
  }
  // The prefix the binary carries for every one of these names. It is what gets
  // checked, so it is also what gets written down.
  const folder = path || "assets/icons";
  const read = readBinary(binary, manifest.icons, folder);
  // Rebuilt through the same writer a fresh shelf uses, so a repaired list and a
  // built one cannot disagree about what a source looks like.
  manifest.source = describeSource("", {
    ...manifest.source,
    path: folder,
    ...read,
    version: version || manifest.source.version || "",
  });
  manifest.rule = RULE;
  writeNotices(out);
  writeFileSync(list, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, changed };
}

if (process.argv[1] && process.argv[1].endsWith("build-icons.mjs")) {
  const args = readArgs(process.argv.slice(2));
  const binary = typeof args["from-binary"] === "string" ? args["from-binary"] : "";
  const version = typeof args["magpie-version"] === "string" ? args["magpie-version"] : "";
  const given = (value, name) => {
    if (value) return value;
    console.error(`${name}: not given, and the manifest would say nothing about it`);
    process.exit(2);
  };
  if (args.reclassify) {
    const { manifest, changed } = reclassify(TARGET, {
      binary,
      version,
      path: typeof args.path === "string" ? args.path : "",
    });
    console.log(`[icons] reclassified ${changed.length} of ${manifest.count} entry(ies) in assets/icons`);
    for (const line of changed) console.log(`[icons]   ${line}`);
    console.log(`[icons] magpie@${given(manifest.source.commit, "commit")} built ${manifest.source.builtAt || "?"} version ${manifest.source.version || "?"}`);
    process.exit(0);
  }
  if (args.extract) {
    const from = given(binary, "--from-binary");
    const manifest = extract({ binary: from, version, path: typeof args.path === "string" ? args.path : "assets/icons" });
    const bytes = Object.values(manifest.icons).reduce((total, entry) => total + entry.bytes, 0);
    console.log(`[icons] extracted ${manifest.count} file(s), ${bytes} bytes from magpie@${given(manifest.source.commit, "commit")} -> assets/icons`);
    process.exit(0);
  }
  if (!args.src) {
    console.error("usage: node scripts/build-icons.mjs --extract --from-binary <magpie.exe> [--magpie-version <x.y.z>]");
    console.error("       node scripts/build-icons.mjs --src <dir holding assets/icons> [--from-binary <magpie.exe>] [--magpie-version <x.y.z>]");
    console.error("       node scripts/build-icons.mjs --reclassify [--from-binary <magpie.exe>] [--magpie-version <x.y.z>]");
    process.exit(2);
  }
  const manifest = build({ src: args.src, path: typeof args.path === "string" ? args.path : "assets/icons", binary, version });
  const bytes = Object.values(manifest.icons).reduce((total, entry) => total + entry.bytes, 0);
  console.log(
    `[icons] ${manifest.count} file(s), ${bytes} bytes from magpie@${given(manifest.source.commit, "commit")} -> assets/icons`,
  );
}
