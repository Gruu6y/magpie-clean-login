#!/usr/bin/env node
// Build a "slim" Camoufox archive from an upstream release zip by stripping the
// bundled font bundle while preserving the single stock sentinel font file.
//
// Upstream archives carry a per-OS fonts/ bundle (Windows zip: top-level
// fonts/, ~860 MB uncompressed; macOS zip:
// Camoufox.app/Contents/Resources/fonts/, ~2.1 GB uncompressed) that Camoufox
// activates only when spoofing a *foreign* OS. For a native identity these
// fonts are dead weight, so the plugin ships slim archives that keep exactly
// the stock sentinel font (`twemojimozilla.ttf` on Windows — upstream ships it
// under a randomized leaf name such as TwemojiMozilla.ttf — required by
// font-hijacker.patch's IsStockBundledFontFile check) and drop everything
// else.
//
// The rebuild is byte-deterministic: compressed payloads are copied verbatim
// (no recompression), entry order is lexicographic, DOS timestamps are pinned
// to 1980-01-01, no extra fields or ZIP64 records are emitted.
//
// Usage:
//   node scripts/build-slim-artifact.mjs --in <upstream.zip> --out <slim.zip> \
//     --fonts-prefix <zip path prefix> --keep <fonts/leaf> [--report <file>]
//
// `--fonts-prefix` for macOS is "Camoufox.app/Contents/Resources/fonts/"; for
// Windows it is "fonts/". `--keep` is the randomized stock-font leaf name.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename } from "node:path";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`build-slim-artifact: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const inputPath = args.in;
const outputPath = args.out;
const fontsPrefix = args["fonts-prefix"];
const keepLeaf = args.keep;
const reportPath = args.report;
if (!inputPath || !outputPath || !fontsPrefix || !keepLeaf) {
  fail("required: --in --out --fonts-prefix --keep [--report]");
}
const keepPath = fontsPrefix + keepLeaf;

const buf = readFileSync(inputPath);
if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
  fail(`${inputPath} is not a zip archive`);
}

// --- locate EOCD (end of central directory) ---
let eocdOffset = -1;
for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i -= 1) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocdOffset = i;
    break;
  }
}
if (eocdOffset < 0) fail("EOCD record not found");
const cdCount = buf.readUInt16LE(eocdOffset + 10);
const cdSize = buf.readUInt32LE(eocdOffset + 12);
const cdOffset = buf.readUInt32LE(eocdOffset + 16);
if (cdOffset + cdSize > buf.length) fail("central directory out of bounds");

// --- parse central directory ---
const entries = [];
let p = cdOffset;
for (let i = 0; i < cdCount; i += 1) {
  if (buf.readUInt32LE(p) !== 0x02014b50) {
    fail(`bad central directory signature at entry ${i}`);
  }
  const flags = buf.readUInt16LE(p + 8);
  const method = buf.readUInt16LE(p + 10);
  const crc = buf.readUInt32LE(p + 16);
  const compSize = buf.readUInt32LE(p + 20);
  const uncompSize = buf.readUInt32LE(p + 24);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const commentLen = buf.readUInt16LE(p + 32);
  const extAttrs = buf.readUInt32LE(p + 38);
  const localOffset = buf.readUInt32LE(p + 42);
  const versionMadeBy = buf.readUInt16LE(p + 4);
  const name = buf.subarray(p + 46, p + 46 + nameLen);
  const nameStr = name.toString(flags & 0x800 ? "utf8" : "latin1");
  entries.push({
    name,
    nameStr,
    flags,
    method,
    crc,
    compSize,
    uncompSize,
    extAttrs,
    localOffset,
    versionMadeBy,
  });
  p += 46 + nameLen + extraLen + commentLen;
}

// --- select entries ---
const kept = [];
const dropped = [];
for (const e of entries) {
  if (e.nameStr.startsWith(fontsPrefix) && e.nameStr !== fontsPrefix && e.nameStr !== keepPath) {
    dropped.push(e);
  } else {
    kept.push(e);
  }
}
kept.sort((a, b) => Buffer.compare(a.name, b.name));

// --- emit the slim zip: raw payload copies + rewritten headers ---
const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0x0000;
const chunks = [];
const central = [];
let offset = 0;

for (const e of kept) {
  // Read the local header of the source entry to find its payload.
  const lo = e.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) {
    fail(`bad local header for ${e.nameStr}`);
  }
  const lNameLen = buf.readUInt16LE(lo + 26);
  const lExtraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + lNameLen + lExtraLen;
  const payload = buf.subarray(dataStart, dataStart + e.compSize);
  if (payload.length !== e.compSize) {
    fail(`truncated payload for ${e.nameStr}`);
  }

  // Normalize flags: keep the UTF-8 bit only if already set; drop data-
  // descriptor / encryption bits (upstream never sets them anyway).
  const flags = e.flags & 0x0800;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(e.method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(e.crc, 14);
  local.writeUInt32LE(e.compSize, 18);
  local.writeUInt32LE(e.uncompSize, 22);
  local.writeUInt16LE(e.name.length, 26);
  local.writeUInt16LE(0, 28); // no extra

  chunks.push(local, e.name, payload);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  // version made by: keep the source's host-OS byte (upper byte) so the
  // external attributes' meaning is preserved (0=DOS/fat, 3=Unix).
  cd.writeUInt16LE(e.versionMadeBy, 4);
  cd.writeUInt16LE(20, 6); // version needed
  cd.writeUInt16LE(flags, 8);
  cd.writeUInt16LE(e.method, 10);
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(e.crc, 16);
  cd.writeUInt32LE(e.compSize, 20);
  cd.writeUInt32LE(e.uncompSize, 24);
  cd.writeUInt16LE(e.name.length, 28);
  // extra/comment/disk/int-attr lengths all zero
  cd.writeUInt32LE(e.extAttrs, 38); // host-specific attrs incl. Unix mode bits
  cd.writeUInt32LE(offset, 42);
  central.push(cd, e.name);

  offset += 30 + e.name.length + e.compSize;
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(kept.length, 8);
eocd.writeUInt16LE(kept.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
chunks.push(cdBuf, eocd);

const out = Buffer.concat(chunks);
writeFileSync(outputPath, out);

const sha256 = createHash("sha256").update(out).digest("hex");
// Report filename may contain path separators only via --report.
const report = {
  input: basename(inputPath),
  input_bytes: statSync(inputPath).size,
  output: basename(outputPath),
  output_bytes: out.length,
  output_sha256: sha256,
  fonts_prefix: fontsPrefix,
  kept_entries: kept.length,
  dropped_entries: dropped.length,
  kept_font_entry: keepPath,
  entry_names: kept.map((e) => e.nameStr),
};
writeFileSync(reportPath ?? `${outputPath}.inventory.json`, JSON.stringify(report, null, 2));
console.log(`slim: ${kept.length} kept / ${dropped.length} dropped; ${out.length} bytes; sha256 ${sha256}`);
