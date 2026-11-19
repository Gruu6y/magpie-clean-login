// The browser installer's honest-status contract, exercised entirely through
// the manager's injected installers so CI performs no real download and never
// imports camoufox. The model installer is injected too: the default one would
// reach the network on a missing model.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_SHA256_ENV,
  BROWSER_URL_ENV,
  BROWSER_VERSION,
  DISK_MARGIN_BYTES,
  ENVIRONMENT_STATES,
  EXECUTABLE_ENV,
  EnvironmentError,
  MODEL_DIR_NAME,
  MODEL_DOWNLOAD_BYTES,
  MODEL_EXTRACTED_BYTES,
  MODEL_STAMP_FILE,
  createEnvironmentManager,
  defaultModelInstaller,
  directoryBytes,
  findExecutable,
  isFingerprintModelInstalled,
  platformAsset,
  requiredDiskBytes,
  resolveBrowserAsset,
} from "../lib/browser-environment.mjs";

const tempDirs = [];

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "clean-login-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function captureRejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

// A model installer that touches no network: it creates the model directory
// with a 7-byte marker so status() has a real size to report.
async function fakeModelInstaller({ dir, onProgress } = {}) {
  const modelDir = join(dir, MODEL_DIR_NAME);
  await mkdir(modelDir, { recursive: true });
  await writeFile(join(modelDir, "model.bin"), "1234567");
  onProgress?.({
    phase: "model",
    receivedBytes: MODEL_DOWNLOAD_BYTES,
    totalBytes: MODEL_DOWNLOAD_BYTES,
  });
  return { modelDir, modelBytes: 7, modelVerified: true, downloaded: true };
}

test("pins one slim asset per platform and derives the disk requirement", () => {
  const win = platformAsset("win32", "x64");
  expect(win.downloadBytes).toBe(176_170_139);
  expect(win.extractedBytes).toBe(432_909_728);
  expect(win.url.endsWith("camoufox-slim-win-x86_64-158.0.1-beta.41.zip")).toBe(true);
  expect(win.sha256).toBe("07bfbe8148b7b2b6a520074b6766b4aac493c6f2364e4d6af21c31b453026dd1");

  const lin64 = platformAsset("linux", "x64");
  expect(lin64.downloadBytes).toBe(158_977_343);
  expect(lin64.extractedBytes).toBe(394_738_736);
  expect(lin64.url.endsWith("camoufox-slim-lin-x86_64-158.0.1-beta.41.zip")).toBe(true);
  expect(lin64.sha256).toBe("e29ce75164fc1a139405c68633d5570befd5e88d9279cc5f5417211a87ed33fd");

  const linArm = platformAsset("linux", "arm64");
  expect(linArm.downloadBytes).toBe(152_903_916);
  expect(linArm.extractedBytes).toBe(371_229_773);
  expect(linArm.url.endsWith("camoufox-slim-lin-arm64-158.0.1-beta.41.zip")).toBe(true);
  expect(linArm.sha256).toBe("e17d5a340b1f50f0fb8899d21bb20e44310996c79a1d05a215e404c85ede9cc8");

  const macArm = platformAsset("darwin", "arm64");
  expect(macArm.downloadBytes).toBe(153_691_113);
  expect(macArm.extractedBytes).toBe(377_713_579);
  expect(macArm.url.endsWith("camoufox-slim-mac-arm64-158.0.1-beta.41.zip")).toBe(true);
  expect(macArm.sha256).toBe("516f3953623abda2790c42fe5685c5dc46b992bccede95b147ec478b91185381");

  const macX64 = platformAsset("darwin", "x64");
  expect(macX64.downloadBytes).toBe(161_709_470);
  expect(macX64.extractedBytes).toBe(397_653_777);
  expect(macX64.url.endsWith("camoufox-slim-mac-x86_64-158.0.1-beta.41.zip")).toBe(true);
  expect(macX64.sha256).toBe("e9e47eb0ea0c640a89c4d27d3d09057233873c4e574dc3c9013183b812c05bfb");

  for (const asset of [win, lin64, linArm, macArm, macX64]) expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(platformAsset("win32", "arm64")).toBeNull();

  expect(MODEL_DOWNLOAD_BYTES).toBe(1_564_571);
  expect(MODEL_EXTRACTED_BYTES).toBe(213_104_823);
  expect(DISK_MARGIN_BYTES).toBe(256 * 1024 * 1024);
  expect(requiredDiskBytes("linux", "x64")).toBe(
    158_977_343 + 394_738_736 + MODEL_DOWNLOAD_BYTES + MODEL_EXTRACTED_BYTES + DISK_MARGIN_BYTES,
  );
  expect(requiredDiskBytes("darwin", "arm64")).toBe(
    153_691_113 + 377_713_579 + MODEL_DOWNLOAD_BYTES + MODEL_EXTRACTED_BYTES + DISK_MARGIN_BYTES,
  );
  expect(requiredDiskBytes("win32", "x64")).toBe(
    176_170_139 + 432_909_728 + MODEL_DOWNLOAD_BYTES + MODEL_EXTRACTED_BYTES + DISK_MARGIN_BYTES,
  );
  expect(requiredDiskBytes("win32", "x64")).toBe(1_092_184_717);
  // An unsupported platform prices the asset at zero; prepare() still refuses
  // with unsupported_platform before the disk check is consulted.
  expect(requiredDiskBytes("win32", "arm64")).toBe(
    MODEL_DOWNLOAD_BYTES + MODEL_EXTRACTED_BYTES + DISK_MARGIN_BYTES,
  );
  expect(ENVIRONMENT_STATES).toContain("cancelled");
});

// macOS slim assets measured on a Devin macOS 26.6.2 Apple Silicon VM from the
// upstream camoufox-158.0.1-beta.41 zips; digests recorded in the release's
// inventory.json. The (platform, arch) -> asset contract is covered by the
// per-platform table test above; this test covers the resolver behaviour.
test("resolveBrowserAsset selects per platform and resolves null unsupported", () => {
  const mac = resolveBrowserAsset({}, "darwin", "arm64");
  const macAsset = platformAsset("darwin", "arm64");
  expect(mac.url).toBe(macAsset.url);
  expect(mac.sha256).toBe(macAsset.sha256);
  expect(mac.source).toBe("default");

  // An env override always wins, whatever the platform.
  const overridden = resolveBrowserAsset(
    { [BROWSER_URL_ENV]: "https://example.test/browser.zip" },
    "win32",
    "arm64",
  );
  expect(overridden.source).toBe("override");

  // An explicitly unsupported platform resolves to null instead of guessing.
  expect(resolveBrowserAsset({}, "win32", "arm64")).toBeNull();
});

test("the model constants match the installed fpgen-js pin", async () => {
  const { MODEL_PIN } = await import("fpgen-js");
  expect(MODEL_PIN.tag).toBe("model-2/2026");
  expect(MODEL_DOWNLOAD_BYTES).toBe(MODEL_PIN.size);
  expect(MODEL_STAMP_FILE).toBe(".pinned-model");
});

test("isFingerprintModelInstalled follows the pin's stamp and members", async () => {
  const { MODEL_PIN } = await import("fpgen-js");
  const dir = await tempRoot();
  expect(await isFingerprintModelInstalled(dir, MODEL_PIN)).toBe(false);
  await writeFile(join(dir, MODEL_STAMP_FILE), `${MODEL_PIN.sha256}\n`);
  for (const name of MODEL_PIN.files) await writeFile(join(dir, name), "x");
  expect(await isFingerprintModelInstalled(dir, MODEL_PIN)).toBe(true);
  await rm(join(dir, MODEL_PIN.files[0]));
  expect(await isFingerprintModelInstalled(dir, MODEL_PIN)).toBe(false);
});

test("default asset carries its digest; an override without one does not", () => {
  const hostAsset = platformAsset();
  const fallback = resolveBrowserAsset({});
  expect(hostAsset).not.toBeNull();
  expect(fallback.url).toBe(hostAsset.url);
  expect(fallback.url.endsWith(hostAsset.url.split("/").pop())).toBe(true);
  expect(fallback.sha256).toBe(hostAsset.sha256);
  expect(fallback.source).toBe("default");
  expect(resolveBrowserAsset({})).toEqual(resolveBrowserAsset({}));

  // An explicitly unsupported platform resolves to null instead of guessing.
  expect(resolveBrowserAsset({}, "win32", "arm64")).toBeNull();

  const overridden = resolveBrowserAsset({
    [BROWSER_URL_ENV]: "https://example.test/browser.zip",
  });
  expect(overridden.url).toBe("https://example.test/browser.zip");
  expect(overridden.sha256).toBeNull();
  expect(overridden.source).toBe("override");

  const pinned = resolveBrowserAsset({
    [BROWSER_URL_ENV]: "https://example.test/browser.zip",
    [BROWSER_SHA256_ENV]: "AB".repeat(32),
  });
  expect(pinned.sha256).toBe("ab".repeat(32));
});

test("defaultModelInstaller skips an installed model and never downloads", async () => {
  const { MODEL_PIN } = await import("fpgen-js");
  const dir = await tempRoot();
  const modelDir = join(dir, MODEL_DIR_NAME);
  await mkdir(modelDir, { recursive: true });
  await writeFile(join(modelDir, MODEL_STAMP_FILE), `${MODEL_PIN.sha256}\n`);
  for (const name of MODEL_PIN.files) await writeFile(join(modelDir, name), "x");

  const calls = { setModelDir: [], ensureModel: 0 };
  const env = {};
  const result = await defaultModelInstaller({
    dir,
    env,
    fpgen: {
      MODEL_PIN,
      setModelDir: (value) => calls.setModelDir.push(value),
      ensureModel: async () => {
        calls.ensureModel += 1;
      },
    },
  });

  expect(calls.ensureModel).toBe(0);
  expect(calls.setModelDir).toEqual([modelDir]);
  expect(env.FPGEN_DATA_DIR).toBe(modelDir);
  expect(env.CAMOUFOX_FPGEN_DATA).toBeUndefined();
  expect(result.downloaded).toBe(false);
  expect(result.modelDir).toBe(modelDir);
});

test("defaultModelInstaller installs a missing model and reports the model phase", async () => {
  const { MODEL_PIN } = await import("fpgen-js");
  const dir = await tempRoot();
  const modelDir = join(dir, MODEL_DIR_NAME);
  const phases = [];
  const setModelDir = [];

  const result = await defaultModelInstaller({
    dir,
    env: {},
    onProgress: (progress) => phases.push(progress.phase),
    fpgen: {
      MODEL_PIN,
      setModelDir: (value) => setModelDir.push(value),
      ensureModel: async ({ dir: target }) => {
        await mkdir(target, { recursive: true });
        await writeFile(join(target, MODEL_STAMP_FILE), `${MODEL_PIN.sha256}\n`);
        for (const name of MODEL_PIN.files) await writeFile(join(target, name), "x");
      },
    },
  });

  expect(setModelDir).toEqual([modelDir]);
  expect(result.downloaded).toBe(true);
  expect(result.modelDir).toBe(modelDir);
  expect(result.modelVerified).toBe(true);
  expect(phases).toContain("model");
});

test("defaultModelInstaller maps model failures to model codes", async () => {
  const { MODEL_PIN } = await import("fpgen-js");
  const dir = await tempRoot();
  const base = (ensureModel) => ({
    dir,
    env: {},
    fpgen: { MODEL_PIN, setModelDir() {}, ensureModel },
  });

  const download = await captureRejection(() =>
    defaultModelInstaller(base(async () => {
      throw new Error("fpgen model download failed: HTTP 500");
    })),
  );
  expect(download).toBeInstanceOf(EnvironmentError);
  expect(download.code).toBe("model_download_failed");

  const verify = await captureRejection(() =>
    defaultModelInstaller(base(async () => {
      const error = new Error("size mismatch");
      error.name = "ModelVerificationError";
      throw error;
    })),
  );
  expect(verify.code).toBe("model_checksum_mismatch");
});

test("status() reports honest defaults for a missing install", async () => {
  const root = await tempRoot();
  const asset = platformAsset();
  const manager = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    now: () => "2026-01-01T00:00:00.000Z",
    idFactory: () => "job-1",
  });

  const status = await manager.status();
  expect(status.state).toBe("missing");
  expect(status.ready).toBe(false);
  expect(status.installed).toBe(false);
  expect(status.modelInstalled).toBe(false);
  expect(status.modelBytes).toBe(0);
  expect(status.modelDir).toBe(join(root, MODEL_DIR_NAME));
  expect(status.target).toBe(BROWSER_VERSION);
  expect(status.version).toBeNull();
  expect(status.executablePath).toBeNull();
  expect(status.installDir).toBe(root);
  expect(status.downloadBytes).toBe(asset.downloadBytes + MODEL_DOWNLOAD_BYTES);
  expect(status.extractedBytes).toBe(asset.extractedBytes + MODEL_EXTRACTED_BYTES);
  expect(status.modelDownloadBytes).toBe(MODEL_DOWNLOAD_BYTES);
  expect(status.modelExtractedBytes).toBe(MODEL_EXTRACTED_BYTES);
  expect(status.requiredDiskBytes).toBe(requiredDiskBytes());
  expect(status.installedBytes).toBe(0);
  expect(status.freeBytes).toBe(requiredDiskBytes() + 1);
  expect(status.checksumVerified).toBe(false);
  expect(status.checksumStatus).toBe("unavailable");
  expect(status.assetOverride).toBe(false);
});

test("a verified install writes the record and exports the executable path", async () => {
  const root = await tempRoot();
  const exe = join(root, "camoufox.exe");
  await writeFile(exe, "exe");
  const env = {};
  const manager = createEnvironmentManager({
    root,
    env,
    freeBytes: requiredDiskBytes() + 1,
    installer: async () => ({
      version: BROWSER_VERSION,
      executablePath: exe,
      bytes: platformAsset().extractedBytes,
      checksumVerified: true,
    }),
    modelInstaller: fakeModelInstaller,
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const started = await manager.prepare();
  expect(started.started).toBe(true);
  await manager.whenSettled();

  const status = await manager.status();
  expect(status.state).toBe("ready");
  expect(status.ready).toBe(true);
  expect(status.installed).toBe(true);
  expect(status.modelInstalled).toBe(true);
  expect(status.checksumVerified).toBe(true);
  expect(status.checksumStatus).toBe("verified");
  expect(status.installedBytes).toBe(platformAsset().extractedBytes + 7);
  expect(status.modelBytes).toBe(7);
  expect(status.executablePath).toBe(exe);
  expect(env[EXECUTABLE_ENV]).toBe(exe);
  // The last progress stage is the model, so the user sees what is being
  // downloaded after the browser.
  expect(manager.job().progress.phase).toBe("model");

  const record = JSON.parse(await readFile(join(root, "install.json"), "utf8"));
  expect(record.checksumVerified).toBe(true);
  expect(record.modelDir).toBe(join(root, MODEL_DIR_NAME));
  expect(record.modelVerified).toBe(true);
});

test("an override without a digest is never reported as verified", async () => {
  const root = await tempRoot();
  const exe = join(root, "camoufox.exe");
  await writeFile(exe, "exe");
  const env = { [BROWSER_URL_ENV]: "https://example.test/browser.zip" };
  const manager = createEnvironmentManager({
    root,
    env,
    freeBytes: requiredDiskBytes() + 1,
    installer: async () => ({
      version: BROWSER_VERSION,
      executablePath: exe,
      bytes: 1,
      checksumVerified: false,
    }),
    modelInstaller: fakeModelInstaller,
  });

  await manager.prepare();
  await manager.whenSettled();

  const status = await manager.status();
  expect(status.installed).toBe(true);
  expect(status.assetOverride).toBe(true);
  expect(status.checksumVerified).toBe(false);
  expect(status.checksumStatus).toBe("unavailable");
});

test("a model failure is classified apart from a browser failure", async () => {
  const root = await tempRoot();
  const exe = join(root, "camoufox.exe");
  await writeFile(exe, "exe");
  const modelManager = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    installer: async () => ({
      version: BROWSER_VERSION,
      executablePath: exe,
      bytes: 1,
      checksumVerified: true,
    }),
    modelInstaller: async () => {
      throw new EnvironmentError("model_download_failed", "model", 502);
    },
  });
  await modelManager.prepare();
  await modelManager.whenSettled();
  expect(modelManager.job().error.code).toBe("model_download_failed");
  expect((await modelManager.status()).state).toBe("error");

  const browserManager = createEnvironmentManager({
    root: await tempRoot(),
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    installer: async () => {
      throw new EnvironmentError("download_failed", "browser", 502);
    },
    modelInstaller: async () => {
      throw new Error("the model must not run after a browser failure");
    },
  });
  await browserManager.prepare();
  await browserManager.whenSettled();
  expect(browserManager.job().error.code).toBe("download_failed");
  expect(browserManager.job().error.code).not.toBe(modelManager.job().error.code);
});

test("a model failure keeps a previously written browser record", async () => {
  const root = await tempRoot();
  const exe = join(root, "camoufox.exe");
  await writeFile(exe, "exe");
  const browserInstaller = async () => ({
    version: BROWSER_VERSION,
    executablePath: exe,
    bytes: 1,
    checksumVerified: true,
  });

  const good = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    installer: browserInstaller,
    modelInstaller: fakeModelInstaller,
  });
  await good.prepare();
  await good.whenSettled();
  expect((await good.status()).installed).toBe(true);

  // Remove the model so the second attempt has something to fail on while the
  // browser record is still on disk.
  await rm(join(root, MODEL_DIR_NAME), { recursive: true, force: true });

  const failing = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    installer: browserInstaller,
    modelInstaller: async () => {
      throw new EnvironmentError("model_download_failed", "model", 502);
    },
  });
  await failing.prepare();
  await failing.whenSettled();

  const status = await failing.status();
  expect(status.installed).toBe(true);
  expect(status.state).toBe("error");
  expect(failing.job().error.code).toBe("model_download_failed");
  // The browser record on disk is still readable, so a retry can reuse it.
  const record = JSON.parse(await readFile(join(root, "install.json"), "utf8"));
  expect(record.executablePath).toBe(exe);
});

test("prepare refuses when free space is below the requirement", async () => {
  const root = await tempRoot();
  const manager = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() - 1,
  });

  let error;
  try {
    await manager.prepare();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(EnvironmentError);
  expect(error.code).toBe("insufficient_disk");
  expect(error.status).toBe(507);
  expect((await manager.status()).state).toBe("missing");
});

test("cancel moves the job to cancelled", async () => {
  const root = await tempRoot();
  const manager = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    installer: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      }),
    modelInstaller: fakeModelInstaller,
  });

  const started = await manager.prepare();
  expect(started.started).toBe(true);
  const cancelled = manager.cancel();
  expect(cancelled.cancelled).toBe(true);
  await manager.whenSettled();

  const status = await manager.status();
  expect(status.state).toBe("cancelled");
  expect(status.installed).toBe(false);
  expect(manager.job().state).toBe("cancelled");
});

test("a missing executable maps to install_failed", async () => {
  const root = await tempRoot();
  const manager = createEnvironmentManager({
    root,
    env: {},
    freeBytes: requiredDiskBytes() + 1,
    installer: async () => ({
      version: BROWSER_VERSION,
      executablePath: join(root, "nope.exe"),
      bytes: 1,
      checksumVerified: true,
    }),
    modelInstaller: fakeModelInstaller,
  });

  await manager.prepare();
  await manager.whenSettled();

  expect((await manager.status()).state).toBe("error");
  const job = manager.job();
  expect(job.state).toBe("error");
  expect(job.error.code).toBe("install_failed");
});

test("distinguishes asset_not_found and rate_limited from download_failed", async () => {
  for (const [code, status] of [
    ["asset_not_found", 404],
    ["rate_limited", 429],
  ]) {
    const root = await tempRoot();
    const manager = createEnvironmentManager({
      root,
      env: {},
      freeBytes: requiredDiskBytes() + 1,
      installer: async () => {
        throw new EnvironmentError(code, "boom", status);
      },
      modelInstaller: fakeModelInstaller,
    });

    await manager.prepare();
    await manager.whenSettled();

    const job = manager.job();
    expect(job.state).toBe("error");
    expect(job.error.code).toBe(code);
  }
});

test("findExecutable finds the launcher and directoryBytes sums it", async () => {
  const root = await tempRoot();
  const nested = join(root, "a", "b");
  await mkdir(nested, { recursive: true });
  const exe = join(nested, "camoufox.exe");
  await writeFile(exe, "12345");

  expect(await findExecutable(root, "win32")).toBe(exe);
  expect(await directoryBytes(root)).toBe(5);
});

test("findExecutable finds the linux launcher at the extracted root", async () => {
  const root = await tempRoot();
  // The slim linux zip puts both launcher names at the archive root; the
  // shallow-first search must see them without descending.
  const exe = join(root, "camoufox-bin");
  await writeFile(exe, "bin");
  expect(await findExecutable(root, "linux")).toBe(exe);
  await writeFile(join(root, "camoufox"), "sh");
  // Either root-level name is a valid hit; it must not descend or miss them.
  const found = await findExecutable(root, "linux");
  expect([join(root, "camoufox"), exe]).toContain(found);
});

test("prepare refuses an unsupported platform before the disk check", async () => {
  const root = await tempRoot();
  const manager = createEnvironmentManager({
    root,
    env: {},
    platform: "win32",
    arch: "arm64",
    // Zero free bytes would trip insufficient_disk if the platform check did
    // not run first; the installer must never be reached either way.
    freeBytes: 0,
    installer: async () => {
      throw new Error("the installer must not run on an unsupported platform");
    },
  });

  const error = await captureRejection(() => manager.prepare());
  expect(error).toBeInstanceOf(EnvironmentError);
  expect(error.code).toBe("unsupported_platform");
  expect(error.status).toBe(422);
  expect(manager.job()).toBeNull();

  const status = await manager.status();
  expect(status.state).toBe("missing");
  expect(status.downloadBytes).toBe(MODEL_DOWNLOAD_BYTES);
  expect(status.extractedBytes).toBe(MODEL_EXTRACTED_BYTES);
  expect(status.requiredDiskBytes).toBe(requiredDiskBytes("win32", "arm64"));
});
