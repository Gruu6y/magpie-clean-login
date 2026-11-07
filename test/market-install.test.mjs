import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMarketInstaller,
  marketPackageSet,
  packageName,
  readInstalledPackages,
} from "../lib/market-install.mjs";

test("packageName strips @latest and semver versions but keeps scopes intact", () => {
  expect(packageName("@magpie-community/opencode-agnes-auth@latest")).toBe(
    "@magpie-community/opencode-agnes-auth",
  );
  expect(packageName("@magpie-community/opencode-agnes-auth@1.2.3")).toBe(
    "@magpie-community/opencode-agnes-auth",
  );
  expect(packageName("@magpie-community/opencode-agnes-auth")).toBe(
    "@magpie-community/opencode-agnes-auth",
  );
  expect(packageName("plain-package@latest")).toBe("plain-package");
  expect(packageName("plain-package")).toBe("plain-package");
  expect(packageName("")).toBe("");
  expect(packageName(null)).toBe("");
});

test("readInstalledPackages parses plugins.json and returns a set of package names", () => {
  const dir = mkdtempSync(join(tmpdir(), "cl-inst-test-"));
  try {
    writeFileSync(
      join(dir, "plugins.json"),
      JSON.stringify({
        plugins: [
          { spec: "@magpie-community/opencode-cursor-auth@latest" },
          { spec: "@roadkid/opencode-loomy-auth@1.0.0" },
        ],
      }),
    );
    const set = readInstalledPackages({ MAGPIE_CONFIG_DIR: dir });
    expect(set.has("@magpie-community/opencode-cursor-auth")).toBe(true);
    expect(set.has("@roadkid/opencode-loomy-auth")).toBe(true);
    expect(set.has("@magpie-community/opencode-agnes-auth")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createMarketInstaller refuses packages outside the market allowlist", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "cl-inst-data-"));
  try {
    const installer = createMarketInstaller({
      dataDir,
      allowedPackages: () => new Set(["@magpie-community/opencode-agnes-auth"]),
      isInstalled: () => false,
    });
    expect(() => installer.start("malicious-package")).toThrow(/market/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("createMarketInstaller short-circuits to done when package is already installed", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "cl-inst-data-"));
  try {
    let spawned = false;
    const installer = createMarketInstaller({
      dataDir,
      allowedPackages: () => new Set(["@magpie-community/opencode-agnes-auth"]),
      isInstalled: (name) => name === "@magpie-community/opencode-agnes-auth",
      spawn: () => {
        spawned = true;
        return { unref: () => {}, pid: 1234 };
      },
    });
    const state = installer.start("@magpie-community/opencode-agnes-auth");
    expect(state.state).toBe("done");
    expect(state.alreadyInstalled).toBe(true);
    expect(spawned).toBe(false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("createMarketInstaller spawns magpie plugin add detached and writes state", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "cl-inst-data-"));
  try {
    const calls = [];
    const installer = createMarketInstaller({
      dataDir,
      cli: "magpie.exe",
      allowedPackages: () => new Set(["@magpie-community/opencode-agnes-auth"]),
      isInstalled: () => false,
      spawn: (cmd, args, options) => {
        calls.push({ cmd, args, options });
        return { unref: () => {}, pid: 4321 };
      },
    });
    const state = installer.start("@magpie-community/opencode-agnes-auth@latest");
    expect(state.state).toBe("running");
    expect(state.package).toBe("@magpie-community/opencode-agnes-auth");
    expect(state.pid).toBe(4321);
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe("magpie.exe");
    expect(calls[0].args).toEqual(["plugin", "add", "@magpie-community/opencode-agnes-auth"]);
    expect(calls[0].options.detached).toBe(true);

    // Reading while still running returns the running state
    const read = installer.read();
    expect(read.package).toBe("@magpie-community/opencode-agnes-auth");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("createMarketInstaller transitions to done when package appears installed", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "cl-inst-data-"));
  try {
    let installed = false;
    const installer = createMarketInstaller({
      dataDir,
      allowedPackages: () => new Set(["@magpie-community/opencode-agnes-auth"]),
      isInstalled: () => installed,
      spawn: () => ({ unref: () => {}, pid: 4321 }),
    });
    installer.start("@magpie-community/opencode-agnes-auth");
    installed = true;
    const updated = installer.read();
    expect(updated.state).toBe("done");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("createMarketInstaller refuses second install while one is running", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "cl-inst-data-"));
  try {
    const installer = createMarketInstaller({
      dataDir,
      allowedPackages: () => new Set(["@magpie-community/opencode-agnes-auth"]),
      isInstalled: () => false,
      isAlive: () => true,
      spawn: () => ({ unref: () => {}, pid: 4321 }),
    });
    installer.start("@magpie-community/opencode-agnes-auth");
    expect(() => installer.start("@magpie-community/opencode-agnes-auth")).toThrow(/already/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
