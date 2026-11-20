// H-5: camoufox freezes INSTALL_DIR at module-evaluation time, so the sandbox
// redirect must be in place BEFORE the first import. These tests verify the
// contract both ways: the pure path helper, and a real subprocess whose first
// camoufox import goes through the sandboxed loader (the parent process may
// already have camoufox evaluated, so the load-path proof needs a clean module
// cache).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInsideSandbox } from "../lib/camoufox-loader.mjs";

test("isInsideSandbox accepts the sandbox itself and its children only", () => {
  const sandbox = join(tmpdir(), "cl-sandbox-x");
  expect(isInsideSandbox(sandbox, sandbox)).toBe(true);
  expect(isInsideSandbox(join(sandbox, "camoufox"), sandbox)).toBe(true);
  expect(isInsideSandbox(join(sandbox, "camoufox", "bin"), sandbox)).toBe(true);
  expect(isInsideSandbox(`${sandbox}-evil`, sandbox)).toBe(false);
  expect(isInsideSandbox(join(sandbox, "..", "outside"), sandbox)).toBe(false);
  expect(isInsideSandbox(null, sandbox)).toBe(false);
  expect(isInsideSandbox("/anywhere", null)).toBe(false);
});

// A clean Bun process: no test in this file (or a sibling file that Bun may
// run first) can have evaluated camoufox yet. The first import MUST see the
// redirected cache root, so INSTALL_DIR lands inside the sandbox directory.
test("loadCamoufoxSandboxed pins INSTALL_DIR inside the sandbox (fresh process)", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "cl-camoufox-loader-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `import { loadCamoufoxSandboxed } from ${JSON.stringify(join(import.meta.dir, "..", "lib", "camoufox-loader.mjs").replace(/\\\\/g, "/"))};
         const dir = ${JSON.stringify(sandbox.replace(/\\\\/g, "/"))};
         const camoufox = await loadCamoufoxSandboxed(dir);
         console.log(JSON.stringify({ installDir: camoufox.INSTALL_DIR ?? null, homedir: process.env.HOME ?? null }));`,
      ],
      { cwd: join(import.meta.dir, ".."), encoding: "utf8", timeout: 30_000 },
    );
    if (result.error?.code === "ENOENT" || result.status === null && /not found/i.test(result.stderr ?? "")) {
      // camoufox not installed in this environment: skip with a named reason.
      console.log("skip: camoufox package not available in test environment");
      return;
    }
    expect(result.status).toBe(0);
    const { installDir, homedir } = JSON.parse(result.stdout.trim().split("\n").pop());
    if (!isInsideSandbox(installDir, sandbox)) {
      // Diagnose before asserting: which of the two paths escaped the sandbox?
      console.log(`installDir=${installDir} homedir=${homedir} sandbox=${sandbox}`);
    }
    expect(installDir).toBeTruthy();
    expect(isInsideSandbox(installDir, sandbox)).toBe(true);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
