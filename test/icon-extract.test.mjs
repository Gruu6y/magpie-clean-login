// The shelf is read out of the installed magpie binary by following magpie's
// own embed records, not by guessing where a picture starts. A guess is what
// dropped two icons without a word; these tests pin the difference. The binary
// here is built by hand so the rule can be checked on a machine - and in CI -
// that has no magpie installed at all.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEmbeddedIcons } from "../scripts/build-icons.mjs";

const BASE = 0x140000000n;
const RAW = 0x200;
const VA = 0x1000;

// One section, so a file offset and an address are the same sum everywhere.
// `entries` are {name, body, record}: `record: false` writes the name and the
// bytes but leaves the record out, which is the failure worth catching.
function binary(entries) {
  const exe = Buffer.alloc(0x2000);
  exe.write("MZ", 0, "ascii");
  const pe = 0x80;
  exe.writeUInt32LE(pe, 0x3c);
  exe.write("PE\0\0", pe, "ascii");
  exe.writeUInt16LE(1, pe + 6); // one section
  exe.writeUInt16LE(240, pe + 20); // size of the optional header
  const opt = pe + 24;
  exe.writeUInt16LE(0x20b, opt); // PE32+
  exe.writeBigUInt64LE(BASE, opt + 24);
  const section = opt + 240;
  exe.writeUInt32LE(0x1000, section + 8); // virtual size
  exe.writeUInt32LE(VA, section + 12);
  exe.writeUInt32LE(0x1000, section + 16); // raw size
  exe.writeUInt32LE(RAW, section + 20);
  let nameAt = RAW;
  let bodyAt = RAW + 0x400;
  let recordAt = RAW + 0x800;
  for (const entry of entries) {
    const full = `assets/icons/${entry.name}`;
    exe.write(full, nameAt, "ascii");
    exe.write(entry.body, bodyAt, "ascii");
    if (entry.record !== false) {
      exe.writeBigUInt64LE(BASE + BigInt(VA + nameAt - RAW), recordAt);
      exe.writeBigUInt64LE(BigInt(full.length), recordAt + 8);
      exe.writeBigUInt64LE(BASE + BigInt(VA + bodyAt - RAW), recordAt + 16);
      exe.writeBigUInt64LE(BigInt(Buffer.byteLength(entry.body)), recordAt + 24);
      recordAt += 32;
    }
    nameAt += full.length + 1;
    bodyAt += Buffer.byteLength(entry.body) + 1;
  }
  const file = join(mkdtempSync(join(tmpdir(), "clean-login-icons-")), "magpie.exe");
  writeFileSync(file, exe);
  return file;
}

describe("reading magpie's icon shelf out of the binary", () => {
  test("a file's bytes are the ones its own record points at", () => {
    const body = '<svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>';
    const file = binary([{ name: "probe.svg", body }]);
    const read = readEmbeddedIcons(file);
    expect(read.length).toBe(1);
    expect(read[0].file).toBe("probe.svg");
    expect(read[0].raw.toString("utf8")).toBe(body);
  });

  test("a picture that only looks like UI artwork is still read", () => {
    // The two that a content guess dropped: an svg wrapping a raster, and a
    // tile. Neither is special to this reader, which is the point.
    const wrapped = '<svg viewBox="0 0 64 64"><image href="data:image/png;base64,iVBORw0K"/></svg>';
    const tile = '<svg viewBox="0 0 1024 1024"><defs><clipPath id="tile"/></defs></svg>';
    const read = readEmbeddedIcons(binary([{ name: "wrapped-color.svg", body: wrapped }, { name: "tile.svg", body: tile }]));
    expect(read.map((entry) => entry.file)).toEqual(["tile.svg", "wrapped-color.svg"]);
    expect(read.find((entry) => entry.file === "wrapped-color.svg").raw.toString("utf8")).toBe(wrapped);
  });

  test("a name with no record stops the read instead of shrinking the shelf", () => {
    const file = binary([
      { name: "kept.svg", body: "<svg/>" },
      { name: "lost.svg", body: "<svg/>", record: false },
    ]);
    expect(() => readEmbeddedIcons(file)).toThrow(/1 of 2 icon\(s\) have no readable embed record: lost\.svg/);
  });

  test("a file that is not a Windows binary says so", () => {
    const file = join(mkdtempSync(join(tmpdir(), "clean-login-icons-")), "magpie");
    writeFileSync(file, "#!/bin/sh\necho not a binary\n");
    expect(() => readEmbeddedIcons(file)).toThrow(/not a Windows binary/);
  });

  test("a binary with no icon names says so", () => {
    expect(() => readEmbeddedIcons(binary([]))).toThrow(/no assets\/icons\/ names to read/);
  });
});