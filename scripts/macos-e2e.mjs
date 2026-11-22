// End-to-end verification script for macOS (`darwin:arm64`), designed to run
// on GitHub Actions `macos-latest` (or any real macOS machine) with an isolated
// sandbox root so the host's real ~/.config/magpie is never touched.
//
// Exports pure helpers (`parseArgs`, `collectHostDiagnostics`,
// `verifyWkWebViewReport`, `runSymlinkMatrix`) so cross-platform unit tests can
// import and verify them without starting browsers or needing macOS.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { homedir, release as osRelease, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const WKWEBVIEW_SWIFT_PATH = join(HERE, "macos-wkwebview-smoke.swift");

export const REQUIRED_WKWEBVIEW_SCENARIOS = Object.freeze([
  "wails-sandbox-allow",
  "same-origin-web-allow",
  "foreign-http-deny",
  "top-level-deny",
  "unsandboxed-frame-deny",
]);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function safeRealpath(target) {
  if (!target) return null;
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  let artifactsDir = process.env.MACOS_E2E_ARTIFACTS_DIR || "macos-e2e-artifacts";
  let skipHeaded = false;
  let skipWkwebview = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifacts-dir") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--artifacts-dir requires a directory value");
      }
      artifactsDir = next;
      i += 1;
    } else if (arg === "--skip-headed") {
      skipHeaded = true;
    } else if (arg === "--skip-wkwebview") {
      skipWkwebview = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { artifactsDir, skipHeaded, skipWkwebview };
}

export function collectHostDiagnostics({
  env = process.env,
  home = homedir(),
  tmp = tmpdir(),
  sandboxDir = null,
} = {}) {
  const cachePath = join(home, "Library", "Caches", "camoufox");
  const cacheLink = {
    path: cachePath,
    exists: false,
    isSymbolicLink: false,
    isDirectory: false,
    readlinkTarget: null,
    realpath: null,
    error: null,
  };

  try {
    const lst = lstatSync(cachePath);
    cacheLink.isSymbolicLink = lst.isSymbolicLink();
    cacheLink.isDirectory = lst.isDirectory();
    cacheLink.exists = existsSync(cachePath);
    if (cacheLink.isSymbolicLink) {
      try {
        cacheLink.readlinkTarget = readlinkSync(cachePath);
      } catch (err) {
        cacheLink.error = String(err?.message ?? err);
      }
    }
    cacheLink.realpath = safeRealpath(cachePath);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      cacheLink.error = String(err?.message ?? err);
    }
  }

  return {
    platform: process.platform,
    arch: process.arch,
    release: osRelease(),
    nodeVersion: process.versions.node,
    bunVersion: process.versions.bun ?? null,
    envBrowserDir: env?.MAGPIE_CLEAN_LOGIN_BROWSER_DIR ?? null,
    homedir: home,
    tmpdir: tmp,
    realTmpdir: safeRealpath(tmp),
    sandboxDir,
    realSandboxDir: safeRealpath(sandboxDir),
    cacheLink,
  };
}

export function verifyWkWebViewReport(report) {
  if (!report || typeof report !== "object" || !report.scenarios || typeof report.scenarios !== "object") {
    throw new Error("WKWebView report must be an object with a scenarios map");
  }

  const failures = [];
  for (const name of REQUIRED_WKWEBVIEW_SCENARIOS) {
    const item = report.scenarios[name];
    if (!item || typeof item !== "object") {
      failures.push(`${name}: missing scenario result`);
      continue;
    }
    const fail = (reason) => failures.push(`${name}: ${reason} (got ${JSON.stringify(item)})`);

    if (item.timedOut === true) {
      fail("timedOut is true");
      continue;
    }
    if (item.navError) {
      fail(`navigation error: ${item.navError}`);
      continue;
    }

    if (name === "wails-sandbox-allow") {
      if (item.topEqualsSelf !== false) fail("expected topEqualsSelf === false");
      if (item.origin !== "null") fail('expected origin === "null"');
      if (item.shellHidden !== false) fail("expected shellHidden === false");
      if (item.deniedHidden !== true) fail("expected deniedHidden === true");
      if (item.serviceState !== "ready") fail('expected serviceState === "ready"');
      if (!Array.isArray(item.ancestorOrigins)) {
        fail("expected ancestorOrigins array");
      } else if (item.ancestorOrigins.some((entry) => /^https?:/i.test(String(entry)))) {
        fail("unexpected http(s) entry in wails ancestorOrigins");
      }
    } else if (name === "same-origin-web-allow") {
      if (item.topEqualsSelf !== false) fail("expected topEqualsSelf === false");
      if (item.origin !== "null") fail('expected origin === "null"');
      if (item.shellHidden !== false) fail("expected shellHidden === false");
      if (item.deniedHidden !== true) fail("expected deniedHidden === true");
      if (item.serviceState !== "ready") fail('expected serviceState === "ready"');
    } else if (name === "foreign-http-deny") {
      if (item.topEqualsSelf !== false) fail("expected topEqualsSelf === false");
      if (item.origin !== "null") fail('expected origin === "null"');
      if (item.shellHidden !== true) fail("expected shellHidden === true");
      if (item.deniedHidden !== false) fail("expected deniedHidden === false");
      if (typeof item.deniedText !== "string" || item.deniedText.trim().length === 0) {
        fail("expected non-empty deniedText");
      }
      if (item.serviceState === "ready") fail('expected serviceState !== "ready"');
    } else if (name === "top-level-deny") {
      if (item.topEqualsSelf !== true) fail("expected topEqualsSelf === true");
      if (item.shellHidden !== true) fail("expected shellHidden === true");
      if (item.deniedHidden !== false) fail("expected deniedHidden === false");
      if (typeof item.deniedText !== "string" || item.deniedText.trim().length === 0) {
        fail("expected non-empty deniedText");
      }
      if (item.serviceState === "ready") fail('expected serviceState !== "ready"');
    } else if (name === "unsandboxed-frame-deny") {
      if (item.topEqualsSelf !== false) fail("expected topEqualsSelf === false");
      if (typeof item.origin !== "string" || item.origin === "null") {
        fail('expected non-"null" origin for unsandboxed iframe');
      }
      if (item.shellHidden !== true) fail("expected shellHidden === true");
      if (item.deniedHidden !== false) fail("expected deniedHidden === false");
      if (typeof item.deniedText !== "string" || item.deniedText.trim().length === 0) {
        fail("expected non-empty deniedText");
      }
      if (item.serviceState === "ready") fail('expected serviceState !== "ready"');
    }
  }

  if (failures.length > 0) {
    throw new Error(`WKWebView embed-gate verification failed:\n- ${failures.join("\n- ")}`);
  }

  return { ok: true, checked: REQUIRED_WKWEBVIEW_SCENARIOS.length };
}

export async function runSymlinkMatrix({ baseDir, foreignBaseDir = process.cwd() }) {
  const { CamoufoxSandboxError, ensureDarwinInstallSymlink, isInsideSandbox } = await import(
    "../lib/camoufox-loader.mjs"
  );

  mkdirSync(baseDir, { recursive: true });
  const cases = [];

  // Case 1: fresh ENOENT -> creates <sandbox>/camoufox and symlink
  const home1 = join(baseDir, "home-fresh");
  const sandbox1 = join(baseDir, "sandbox-1");
  ensureDarwinInstallSymlink(sandbox1, { home: home1 });
  const link1 = join(home1, "Library", "Caches", "camoufox");
  assert.equal(lstatSync(link1).isSymbolicLink(), true, "fresh link must be a symlink");
  assert.equal(realpathSync(link1), realpathSync(join(sandbox1, "camoufox")));
  cases.push("fresh-enoent");

  // Case 2: idempotent repeat call on same sandbox
  ensureDarwinInstallSymlink(sandbox1, { home: home1 });
  assert.equal(realpathSync(link1), realpathSync(join(sandbox1, "camoufox")));
  cases.push("idempotent");

  // Case 3: dangling symlink -> deleted old target repaired to new sandbox
  rmSync(join(sandbox1, "camoufox"), { recursive: true, force: true });
  const sandbox2 = join(baseDir, "sandbox-2");
  ensureDarwinInstallSymlink(sandbox2, { home: home1 });
  assert.equal(lstatSync(link1).isSymbolicLink(), true);
  assert.equal(realpathSync(link1), realpathSync(join(sandbox2, "camoufox")));
  cases.push("dangling-link");

  // Case 4: live symlink pointing into another directory inside os.tmpdir() -> repaired
  const staleTmpTarget = join(baseDir, "stale-tmpdir-target");
  mkdirSync(staleTmpTarget, { recursive: true });
  const home4 = join(baseDir, "home-tmpdir-stale");
  mkdirSync(join(home4, "Library", "Caches"), { recursive: true });
  const link4 = join(home4, "Library", "Caches", "camoufox");
  symlinkSync(staleTmpTarget, link4, "dir");
  const sandbox4 = join(baseDir, "sandbox-4");
  ensureDarwinInstallSymlink(sandbox4, { home: home4 });
  assert.equal(realpathSync(link4), realpathSync(join(sandbox4, "camoufox")));
  cases.push("tmpdir-stale-link");

  // Case 5: pre-existing real directory -> migrated into sandbox & linked
  const home5 = join(baseDir, "home-migrate");
  const real5 = join(home5, "Library", "Caches", "camoufox");
  mkdirSync(real5, { recursive: true });
  writeFileSync(join(real5, "sentinel.txt"), "kept\n", "utf8");
  const sandbox5 = join(baseDir, "sandbox-5");
  ensureDarwinInstallSymlink(sandbox5, { home: home5 });
  assert.equal(lstatSync(real5).isSymbolicLink(), true);
  assert.equal(readFileSync(join(sandbox5, "camoufox", "sentinel.txt"), "utf8"), "kept\n");
  assert.equal(readFileSync(join(real5, "sentinel.txt"), "utf8"), "kept\n");
  cases.push("migrate-real-dir");

  // Case 6: live foreign symlink outside os.tmpdir() -> refused with target in message
  const anchorOutsideTmp = !isInsideSandbox(foreignBaseDir, tmpdir()) ? foreignBaseDir : process.cwd();
  const foreignRoot = mkdtempSync(join(resolve(anchorOutsideTmp), ".cl-foreign-symlink-"));
  try {
    const foreignTarget = join(foreignRoot, "real-camoufox-cache");
    mkdirSync(foreignTarget, { recursive: true });
    const home6 = join(baseDir, "home-foreign");
    mkdirSync(join(home6, "Library", "Caches"), { recursive: true });
    const link6 = join(home6, "Library", "Caches", "camoufox");
    symlinkSync(foreignTarget, link6, "dir");
    const sandbox6 = join(baseDir, "sandbox-6");
    let caught = null;
    try {
      ensureDarwinInstallSymlink(sandbox6, { home: home6 });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof CamoufoxSandboxError, "foreign link must throw CamoufoxSandboxError");
    assert.match(caught.message, /somewhere else/);
    assert.ok(caught.message.includes(foreignTarget), "refusal message must name foreign target");
    cases.push("foreign-symlink-refused");
  } finally {
    rmSync(foreignRoot, { recursive: true, force: true });
  }

  return { ok: true, cases };
}

function runCommandAsync(command, args, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Already exited.
      }
      rejectRun(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(err);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({
        status: code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function startLocalServer(handler) {
  const server = createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error(`scripts/macos-e2e.mjs only runs on darwin (got ${process.platform})`);
  }

  const args = parseArgs();
  const artifactsDir = resolve(args.artifactsDir);
  mkdirSync(artifactsDir, { recursive: true });

  const sandboxRoot = mkdtempSync(join(tmpdir(), "cl-macos-e2e-"));
  const configDir = join(sandboxRoot, "config");
  const dataDir = join(sandboxRoot, "data");
  const cacheDir = join(sandboxRoot, "cache");
  const browserDir = join(sandboxRoot, "browser");
  const accountsDir = join(sandboxRoot, "accounts");
  const profilesDir = join(sandboxRoot, "profiles");
  for (const dir of [configDir, dataDir, cacheDir, browserDir, accountsDir, profilesDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const preExistingCacheLink = collectHostDiagnostics({ sandboxDir: browserDir }).cacheLink;

  // Point every runtime env var into the sandbox BEFORE dynamically importing
  // server/identity/launcher modules so nothing reads real user directories.
  process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR = browserDir;
  process.env.MAGPIE_CONFIG_DIR = configDir;
  process.env.MAGPIE_CLEAN_LOGIN_DATA = dataDir;
  process.env.MAGPIE_CACHE_DIR = cacheDir;
  const sandboxEnv = {
    ...process.env,
    MAGPIE_CLEAN_LOGIN_BROWSER_DIR: browserDir,
    MAGPIE_CONFIG_DIR: configDir,
    MAGPIE_CLEAN_LOGIN_DATA: dataDir,
    MAGPIE_CACHE_DIR: cacheDir,
  };

  const report = {
    startedAt: new Date().toISOString(),
    args,
    preExistingCacheLink,
    stages: {},
    diagnostics: null,
  };

  let service = null;
  let testServer = null;
  let sameOriginProxy = null;
  let foreignServer = null;
  let failedError = null;

  try {
    const [
      { startServer, TOKEN_HEADER },
      { ensureIdentity },
      { openSignInBrowser, launchSignInBrowser },
      { findExecutable, fingerprintModelDir },
      { isInsideSandbox },
    ] = await Promise.all([
      import("../lib/server.mjs"),
      import("../lib/account-identity.mjs"),
      import("../lib/browser-launcher.mjs"),
      import("../lib/browser-environment.mjs"),
      import("../lib/camoufox-loader.mjs"),
    ]);

    // Stage 1: Real-filesystem darwin symlink matrix (all inside isolated homes)
    const t1 = Date.now();
    report.stages.symlinkMatrix = await runSymlinkMatrix({
      baseDir: join(sandboxRoot, "symlink-matrix"),
      foreignBaseDir: artifactsDir,
    });
    report.stages.symlinkMatrix.durationMs = Date.now() - t1;

    // Stage 2: Live server + real /api/environment/prepare (darwin:arm64 slim + fpgen)
    const t2 = Date.now();
    service = await startServer({
      port: 0,
      dataDir,
      env: sandboxEnv,
      pluginScanner: {
        get: () => ({ available: false, scannedAt: null, providers: [] }),
        warm: () => {},
      },
    });
    const pageResp = await fetch(`http://127.0.0.1:${service.port}/`);
    assert.equal(pageResp.status, 200, "GET / must return 200");
    const pageHtml = await pageResp.text();
    const tokenMatch = /name="clean-login-token"\s+content="([0-9a-f]+)"/.exec(pageHtml);
    assert.ok(tokenMatch?.[1], "GET / must contain clean-login-token meta tag");
    const token = tokenMatch[1];

    const prepResp = await fetch(`http://127.0.0.1:${service.port}/api/environment/prepare`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: token },
    });
    const prepJson = await prepResp.json();
    assert.equal(prepResp.status, 202, `POST /api/environment/prepare expected 202: ${JSON.stringify(prepJson)}`);
    assert.equal(prepJson.started, true, "prepare job must start");

    const deadline = Date.now() + 6 * 60_000;
    let finalJob = prepJson.job;
    while (Date.now() < deadline) {
      const pollResp = await fetch(`http://127.0.0.1:${service.port}/api/environment/job?wait=30000`, {
        headers: { [TOKEN_HEADER]: token },
        signal: AbortSignal.timeout(45_000),
      });
      assert.equal(pollResp.status, 200, "GET /api/environment/job must return 200");
      const pollJson = await pollResp.json();
      finalJob = pollJson.job;
      if (finalJob?.state === "ready" || finalJob?.state === "error" || finalJob?.state === "cancelled") {
        break;
      }
      await sleep(1_000);
    }
    if (finalJob?.state !== "ready") {
      throw new Error(`Environment prepare did not reach ready: ${JSON.stringify(finalJob)}`);
    }

    const envResp = await fetch(`http://127.0.0.1:${service.port}/api/environment`, {
      headers: { [TOKEN_HEADER]: token },
    });
    const envJson = await envResp.json();
    const envStatus = envJson.environment;
    assert.equal(envStatus.state, "ready");
    assert.equal(envStatus.ready, true);
    assert.equal(envStatus.installed, true);
    assert.equal(envStatus.modelInstalled, true);
    assert.equal(envStatus.checksumVerified, true);

    const executablePath = await findExecutable(browserDir, "darwin");
    assert.ok(executablePath, "darwin Camoufox executable must be found");
    assert.equal(isInsideSandbox(executablePath, browserDir), true, `executable escaped sandbox: ${executablePath}`);

    const realCachePath = join(homedir(), "Library", "Caches", "camoufox");
    assert.equal(lstatSync(realCachePath).isSymbolicLink(), true, "~/Library/Caches/camoufox must be a symlink");
    assert.equal(
      realpathSync(realCachePath),
      realpathSync(join(browserDir, "camoufox")),
      "~/Library/Caches/camoufox must resolve inside sandbox browserDir",
    );

    report.stages.environmentPrepare = {
      ok: true,
      durationMs: Date.now() - t2,
      platform: envStatus.platform,
      arch: envStatus.arch,
      version: envStatus.version,
      installedBytes: envStatus.installedBytes,
      modelBytes: envStatus.modelBytes,
      checksumVerified: envStatus.checksumVerified,
      modelVerified: envStatus.modelVerified,
      executableInsideSandbox: true,
    };

    // Local test page for Camoufox headless + headed runs
    const visitedUrls = [];
    testServer = await startLocalServer((req, res) => {
      visitedUrls.push(req.url || "/");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Clean Login Mac E2E</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; padding: 32px;">
  <h1 id="headline">Clean Login E2E · 干净登录 🚀</h1>
  <p id="mode">${req.url || "/"}</p>
  <pre id="script-probe" data-ok="false"></pre>
  <script>
    const el = document.getElementById("script-probe");
    el.dataset.ok = "true";
    el.textContent = JSON.stringify({ ok: true, ua: navigator.userAgent, platform: navigator.platform });
  </script>
</body>
</html>`);
    });
    const testPageUrl = `http://127.0.0.1:${testServer.port}/smoke`;

    // Stage 3: Ensure fingerprint identity + launch headless Camoufox (proxy: null)
    const t3 = Date.now();
    const { identity, created } = await ensureIdentity(join(accountsDir, "e2e-smoke"));
    assert.equal(created, true, "ensureIdentity must create a fresh identity");
    assert.ok(identity && typeof identity === "object", "identity must be an object");

    const modelDir = fingerprintModelDir(sandboxEnv);
    const headlessHandle = await openSignInBrowser({
      executablePath,
      url: testPageUrl,
      profileDir: join(profilesDir, "headless"),
      identity,
      proxy: null,
      modelDir,
      headless: true,
    });
    let headlessEval = null;
    try {
      assert.equal(headlessHandle.navigationError, null, "headless navigationError must be null");
      // Camoufox evaluates Playwright scripts in an isolated sandbox world, so
      // read page-script proof via DOM attributes/text rather than window.* expandos.
      headlessEval = await headlessHandle.page.evaluate(() => {
        const probeEl = document.getElementById("script-probe");
        let parsed = null;
        try {
          parsed = probeEl?.textContent ? JSON.parse(probeEl.textContent) : null;
        } catch {
          parsed = null;
        }
        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          title: document.title,
          probeOk: probeEl?.dataset?.ok === "true" && parsed?.ok === true,
          fontsCount: document.fonts?.size ?? 0,
          text: document.getElementById("headline")?.textContent ?? "",
        };
      });
      assert.equal(headlessEval.probeOk, true, `headless DOM probe failed: ${JSON.stringify(headlessEval)}`);
      assert.equal(headlessEval.title, "Clean Login Mac E2E");
      const headlessShot = join(artifactsDir, "camoufox-headless.png");
      await headlessHandle.page.screenshot({ path: headlessShot });
      const shotBytes = statSync(headlessShot).size;
      assert.ok(shotBytes > 1000, `camoufox-headless.png too small (${shotBytes} bytes)`);
      report.stages.camoufoxHeadless = {
        ok: true,
        durationMs: Date.now() - t3,
        ...headlessEval,
        screenshotBytes: shotBytes,
      };
    } finally {
      await headlessHandle.close();
    }

    // Stage 4: Headed Camoufox via forked signin-browser-host + clean close
    if (args.skipHeaded) {
      report.stages.camoufoxHeaded = { skipped: true };
    } else {
      const t4 = Date.now();
      const headedHandle = await launchSignInBrowser({
        executablePath,
        url: `${testPageUrl}?mode=headed`,
        profileDir: join(profilesDir, "headed"),
        identity,
        proxy: null,
        modelDir,
        headless: false,
        env: sandboxEnv,
        platform: "darwin",
      });

      const hitDeadline = Date.now() + 15_000;
      let hitHeaded = false;
      while (Date.now() < hitDeadline) {
        if (visitedUrls.some((u) => u.includes("mode=headed"))) {
          hitHeaded = true;
          break;
        }
        await sleep(200);
      }
      assert.equal(hitHeaded, true, "headed Camoufox did not request local test page within 15s");
      await sleep(500);

      const desktopShot = join(artifactsDir, "macos-desktop-headed.png");
      const capture = await runCommandAsync("screencapture", ["-x", desktopShot], { timeoutMs: 10_000 }).catch(
        (err) => ({ status: -1, stdout: "", stderr: String(err?.message ?? err) }),
      );
      const desktopShotBytes = existsSync(desktopShot) ? statSync(desktopShot).size : 0;

      await headedHandle.close();
      await Promise.race([headedHandle.closed, sleep(15_000)]);

      let pidDead = false;
      const exitWait = Date.now() + 3_000;
      while (Date.now() < exitWait) {
        try {
          process.kill(headedHandle.pid, 0);
          await sleep(100);
        } catch (err) {
          if (err?.code === "ESRCH") {
            pidDead = true;
            break;
          }
          break;
        }
      }
      assert.equal(pidDead, true, `headed host process ${headedHandle.pid} still alive after close`);

      report.stages.camoufoxHeaded = {
        ok: true,
        durationMs: Date.now() - t4,
        pid: headedHandle.pid,
        warning: headedHandle.warning,
        screencapture: {
          ok: capture.status === 0 && desktopShotBytes > 1000,
          status: capture.status,
          bytes: desktopShotBytes,
          stderr: capture.stderr.trim(),
        },
      };
    }

    // Stage 5: Real Apple WKWebView + WKURLSchemeHandler (`wails://wails`) embed-gate smoke
    if (args.skipWkwebview) {
      report.stages.wkwebviewEmbedGate = { skipped: true };
    } else {
      const t5 = Date.now();
      sameOriginProxy = await startLocalServer((req, res) => {
        if ((req.url || "/").startsWith("/__magpie_host__")) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(
            '<!doctype html><html><head><meta charset="utf-8"><title>Magpie Web</title></head>' +
              '<body style="margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;">' +
              '<iframe id="plugin" sandbox="allow-scripts" src="/?lang=en&theme=light" style="width:100%;height:100%;border:0;"></iframe>' +
              "</body></html>",
          );
          return;
        }
        const headers = { ...req.headers, host: `127.0.0.1:${service.port}` };
        const proxyReq = httpRequest(
          {
            host: "127.0.0.1",
            port: service.port,
            path: req.url || "/",
            method: req.method,
            headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxyReq.on("error", (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
          }
          res.end(String(err?.message ?? err));
        });
        req.pipe(proxyReq);
      });

      foreignServer = await startLocalServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(
          '<!doctype html><html><head><meta charset="utf-8"><title>Foreign Host</title></head>' +
            `<body style="margin:0;"><iframe id="plugin" sandbox="allow-scripts" src="http://127.0.0.1:${service.port}/?lang=en&theme=light" style="width:100vw;height:100vh;border:0;"></iframe></body></html>`,
        );
      });

      const wkBin = join(sandboxRoot, "wkwebview-smoke");
      const compile = await runCommandAsync(
        "swiftc",
        ["-framework", "AppKit", "-framework", "WebKit", "-o", wkBin, WKWEBVIEW_SWIFT_PATH],
        { cwd: REPO_ROOT, timeoutMs: 120_000 },
      );
      if (compile.status !== 0) {
        throw new Error(`swiftc failed (${compile.status}):\n${compile.stderr}\n${compile.stdout}`);
      }

      const wkReportPath = join(artifactsDir, "wkwebview-report.json");
      const wkShotPath = join(artifactsDir, "wkwebview-wails-allow.png");
      const wkRun = await runCommandAsync(
        wkBin,
        [
          "--plugin-port",
          String(service.port),
          "--same-origin-port",
          String(sameOriginProxy.port),
          "--foreign-port",
          String(foreignServer.port),
          "--out",
          wkReportPath,
          "--screenshot",
          wkShotPath,
        ],
        { cwd: REPO_ROOT, timeoutMs: 120_000 },
      );
      if (wkRun.status !== 0) {
        throw new Error(`wkwebview-smoke failed (${wkRun.status}):\n${wkRun.stderr}\n${wkRun.stdout}`);
      }

      const wkReport = JSON.parse(readFileSync(wkReportPath, "utf8"));
      const verified = verifyWkWebViewReport(wkReport);
      const wkShotBytes = existsSync(wkShotPath) ? statSync(wkShotPath).size : 0;
      assert.ok(wkShotBytes > 1000, `wkwebview-wails-allow.png too small (${wkShotBytes} bytes)`);

      report.stages.wkwebviewEmbedGate = {
        ok: true,
        durationMs: Date.now() - t5,
        verified,
        screenshotBytes: wkShotBytes,
        scenarios: wkReport.scenarios,
      };
    }

    // Stage 6: Non-fatal Rosetta 2 probe
    const rosetta = await runCommandAsync("arch", ["-x86_64", "/usr/bin/true"], { timeoutMs: 10_000 }).catch(
      (err) => ({ status: -1, stdout: "", stderr: String(err?.message ?? err) }),
    );
    report.stages.rosettaProbe = {
      available: rosetta.status === 0,
      status: rosetta.status,
      stderr: rosetta.stderr.trim(),
    };

    report.ok = true;
  } catch (error) {
    failedError = error;
    report.ok = false;
    report.error = String(error?.stack || error?.message || error);
  } finally {
    await foreignServer?.close().catch(() => {});
    await sameOriginProxy?.close().catch(() => {});
    await testServer?.close().catch(() => {});
    await service?.close().catch(() => {});

    report.finishedAt = new Date().toISOString();
    report.diagnostics = collectHostDiagnostics({ env: sandboxEnv, sandboxDir: browserDir });
    try {
      writeFileSync(join(artifactsDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    } catch {
      // Best-effort diagnostics write.
    }

    // Leave the runner's ~/Library/Caches/camoufox clean if it didn't exist before
    // and now points into our temporary sandboxRoot.
    if (!preExistingCacheLink.exists && !preExistingCacheLink.isSymbolicLink) {
      const realCachePath = join(homedir(), "Library", "Caches", "camoufox");
      try {
        if (lstatSync(realCachePath).isSymbolicLink()) {
          const target = readlinkSync(realCachePath);
          const resolvedSandbox = safeRealpath(sandboxRoot) ?? resolve(sandboxRoot);
          const resolvedTarget = safeRealpath(target) ?? resolve(target);
          if (
            resolvedTarget === resolvedSandbox ||
            resolvedTarget.startsWith(`${resolvedSandbox}/`)
          ) {
            rmSync(realCachePath, { force: true });
          }
        }
      } catch {
        // Ignore cleanup errors.
      }
    }

    rmSync(sandboxRoot, { recursive: true, force: true });
  }

  if (failedError) {
    console.error("[macos-e2e] FAILED. Host diagnostics:");
    console.error(JSON.stringify(report.diagnostics, null, 2));
    console.error(failedError);
    process.exit(1);
  }

  console.log("[macos-e2e] ALL STAGES PASSED");
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[macos-e2e] fatal:", error);
    process.exit(1);
  });
}
