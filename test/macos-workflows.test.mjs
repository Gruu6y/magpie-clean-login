import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REQUIRED_WKWEBVIEW_SCENARIOS,
  collectHostDiagnostics,
  parseArgs,
  verifyWkWebViewReport,
} from "../scripts/macos-e2e.mjs";

const REPO_ROOT = join(import.meta.dir, "..");

function validWkWebViewFixture() {
  return {
    screenshotPath: "/tmp/wkwebview-wails-allow.png",
    screenshotBytes: 42_000,
    scenarios: {
      "wails-sandbox-allow": {
        href: "http://127.0.0.1:4123/?lang=en&theme=light",
        origin: "null",
        pageOrigin: "http://127.0.0.1:4123",
        ancestorOrigins: ["wails://wails"],
        topEqualsSelf: false,
        shellHidden: false,
        deniedHidden: true,
        deniedText: "",
        serviceState: "ready",
        timedOut: false,
      },
      "same-origin-web-allow": {
        href: "http://127.0.0.1:4124/?lang=en&theme=light",
        origin: "null",
        pageOrigin: "http://127.0.0.1:4124",
        ancestorOrigins: ["http://127.0.0.1:4124"],
        topEqualsSelf: false,
        shellHidden: false,
        deniedHidden: true,
        deniedText: "",
        serviceState: "ready",
        timedOut: false,
      },
      "foreign-http-deny": {
        href: "http://127.0.0.1:4123/?lang=en&theme=light",
        origin: "null",
        pageOrigin: "http://127.0.0.1:4123",
        ancestorOrigins: ["http://127.0.0.1:4125"],
        topEqualsSelf: false,
        shellHidden: true,
        deniedHidden: false,
        deniedText: "This page only works inside magpie.",
        serviceState: "connecting",
        timedOut: false,
      },
      "top-level-deny": {
        href: "http://127.0.0.1:4123/?lang=en&theme=light",
        origin: "http://127.0.0.1:4123",
        pageOrigin: "http://127.0.0.1:4123",
        ancestorOrigins: [],
        topEqualsSelf: true,
        shellHidden: true,
        deniedHidden: false,
        deniedText: "This page only works inside magpie.",
        serviceState: "connecting",
        timedOut: false,
      },
      "unsandboxed-frame-deny": {
        href: "http://127.0.0.1:4123/?lang=en&theme=light",
        origin: "http://127.0.0.1:4123",
        pageOrigin: "http://127.0.0.1:4123",
        ancestorOrigins: ["wails://wails"],
        topEqualsSelf: false,
        shellHidden: true,
        deniedHidden: false,
        deniedText: "This page only works inside magpie.",
        serviceState: "connecting",
        timedOut: false,
      },
    },
  };
}

test("macos-e2e.yml workflow declares macOS E2E triggers, paths, runner, and artifacts", () => {
  const yml = readFileSync(join(REPO_ROOT, ".github", "workflows", "macos-e2e.yml"), "utf8");
  expect(yml).toContain("name: macos-e2e");
  expect(yml).toContain("workflow_dispatch:");
  expect(yml).toContain("pull_request:");
  for (const watchedPath of [
    ".github/workflows/macos-e2e.yml",
    "scripts/macos-e2e.mjs",
    "scripts/macos-wkwebview-smoke.swift",
    "lib/camoufox-loader.mjs",
    "lib/browser-environment.mjs",
    "lib/browser-launcher.mjs",
    "ui/embed-gate.js",
    "lib/server.mjs",
  ]) {
    expect(yml).toContain(watchedPath);
  }
  expect(yml).toContain("runs-on: macos-latest");
  expect(yml).toContain("contents: read");
  expect(yml).toContain("actions/checkout@v6");
  expect(yml).toContain("oven-sh/setup-bun@v2");
  expect(yml).toContain("bun-version: 1.4.4");
  expect(yml).toContain("timeout-minutes:");
  expect(yml).toContain("bun scripts/macos-e2e.mjs");
  expect(yml).toContain("actions/upload-artifact@v4");
  expect(yml).toContain("if: always()");
});

test("macos-debug.yml enforces manual dispatch only, actor SSH lock, read-only perms, and zero secrets", () => {
  const yml = readFileSync(join(REPO_ROOT, ".github", "workflows", "macos-debug.yml"), "utf8");
  expect(yml).toContain("name: macos-debug");
  expect(yml).toContain("workflow_dispatch:");
  expect(yml).not.toMatch(/^\s*pull_request\s*:/m);
  expect(yml).not.toMatch(/^\s*push\s*:/m);
  expect(yml).toContain("runs-on: macos-latest");
  expect(yml).toContain("contents: read");
  expect(yml).not.toMatch(/:\s*write\b/);
  expect(yml).toContain("mxschmitt/action-tmate@v3");
  expect(yml).toContain("limit-access-to-actor: true");
  expect(yml).toContain("timeout-minutes:");
  expect(yml).not.toMatch(/\bsecrets\.[A-Za-z_]/);
  expect(yml).not.toContain("secrets.");
});

test("macos-wkwebview-smoke.swift covers Wails scheme, subframe injection, snapshot, and 5 scenarios", () => {
  const swift = readFileSync(join(REPO_ROOT, "scripts", "macos-wkwebview-smoke.swift"), "utf8");
  expect(swift).toContain("WKURLSchemeHandler");
  expect(swift).toContain("setURLSchemeHandler");
  expect(swift).toContain('"wails"');
  expect(swift).toContain("WKUserScript");
  expect(swift).toContain("forMainFrameOnly: false");
  expect(swift).toContain("takeSnapshot");
  for (const name of REQUIRED_WKWEBVIEW_SCENARIOS) {
    expect(swift).toContain(`"${name}"`);
  }
});

test("parseArgs handles defaults, flags, and invalid inputs", () => {
  const prevEnv = process.env.MACOS_E2E_ARTIFACTS_DIR;
  delete process.env.MACOS_E2E_ARTIFACTS_DIR;
  try {
    expect(parseArgs([])).toEqual({
      artifactsDir: "macos-e2e-artifacts",
      skipHeaded: false,
      skipWkwebview: false,
    });
    expect(parseArgs(["--artifacts-dir", "/tmp/out", "--skip-headed", "--skip-wkwebview"])).toEqual({
      artifactsDir: "/tmp/out",
      skipHeaded: true,
      skipWkwebview: true,
    });
    expect(() => parseArgs(["--unknown"])).toThrow();
    expect(() => parseArgs(["unexpected"])).toThrow();
    expect(() => parseArgs(["--artifacts-dir"])).toThrow();
    expect(() => parseArgs(["--artifacts-dir", "--skip-headed"])).toThrow();
  } finally {
    if (prevEnv === undefined) delete process.env.MACOS_E2E_ARTIFACTS_DIR;
    else process.env.MACOS_E2E_ARTIFACTS_DIR = prevEnv;
  }
});

test("collectHostDiagnostics inspects a sandboxed home without touching real caches", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cl-macos-diag-"));
  try {
    const fakeHome = join(tmp, "home");
    const fakeSandbox = join(tmp, "browser");
    mkdirSync(fakeHome, { recursive: true });
    mkdirSync(fakeSandbox, { recursive: true });
    const diag = collectHostDiagnostics({
      env: { MAGPIE_CLEAN_LOGIN_BROWSER_DIR: fakeSandbox },
      home: fakeHome,
      tmp,
      sandboxDir: fakeSandbox,
    });
    expect(diag.platform).toBe(process.platform);
    expect(diag.arch).toBe(process.arch);
    expect(diag.homedir).toBe(fakeHome);
    expect(diag.sandboxDir).toBe(fakeSandbox);
    expect(diag.envBrowserDir).toBe(fakeSandbox);
    expect(diag.cacheLink).toEqual({
      path: join(fakeHome, "Library", "Caches", "camoufox"),
      exists: false,
      isSymbolicLink: false,
      isDirectory: false,
      readlinkTarget: null,
      realpath: null,
      error: null,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("verifyWkWebViewReport accepts a valid 5-scenario report and rejects embed-gate violations", () => {
  expect(verifyWkWebViewReport(validWkWebViewFixture())).toEqual({ ok: true, checked: 5 });

  const missing = validWkWebViewFixture();
  delete missing.scenarios["wails-sandbox-allow"];
  expect(() => verifyWkWebViewReport(missing)).toThrow(/wails-sandbox-allow/);

  const timedOut = validWkWebViewFixture();
  timedOut.scenarios["same-origin-web-allow"].timedOut = true;
  expect(() => verifyWkWebViewReport(timedOut)).toThrow(/timedOut/);

  const wailsDenied = validWkWebViewFixture();
  wailsDenied.scenarios["wails-sandbox-allow"].deniedHidden = false;
  wailsDenied.scenarios["wails-sandbox-allow"].serviceState = "connecting";
  expect(() => verifyWkWebViewReport(wailsDenied)).toThrow(/wails-sandbox-allow/);

  const evilAncestor = validWkWebViewFixture();
  evilAncestor.scenarios["wails-sandbox-allow"].ancestorOrigins = ["http://evil.test"];
  expect(() => verifyWkWebViewReport(evilAncestor)).toThrow(/http\(s\) entry/);

  const foreignAllowed = validWkWebViewFixture();
  foreignAllowed.scenarios["foreign-http-deny"].shellHidden = false;
  foreignAllowed.scenarios["foreign-http-deny"].serviceState = "ready";
  expect(() => verifyWkWebViewReport(foreignAllowed)).toThrow(/foreign-http-deny/);

  const topLevelSpoof = validWkWebViewFixture();
  topLevelSpoof.scenarios["top-level-deny"].topEqualsSelf = false;
  expect(() => verifyWkWebViewReport(topLevelSpoof)).toThrow(/top-level-deny/);

  const unsandboxedOpaque = validWkWebViewFixture();
  unsandboxedOpaque.scenarios["unsandboxed-frame-deny"].origin = "null";
  expect(() => verifyWkWebViewReport(unsandboxedOpaque)).toThrow(/unsandboxed-frame-deny/);
});
