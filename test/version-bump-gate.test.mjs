import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, parseVersion } from "../scripts/version-order.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(root, "scripts");
const gateSource = readFileSync(join(scriptsDir, "check-version-bump.mjs"), "utf8");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || "").trim()}`);
  }
  return String(result.stdout || "").trim();
}

function commit(cwd, message) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`git commit failed: ${String(result.stderr || "").trim()}`);
  }
}

function runGate(cwd) {
  return spawnSync(process.execPath, [join(cwd, "scripts", "check-version-bump.mjs"), "--base", "main"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

const manifest = (version) => `${JSON.stringify({ name: "fixture", version }, null, 2)}\n`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cl-version-gate-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "lib"));
  copyFileSync(join(scriptsDir, "check-version-bump.mjs"), join(dir, "scripts", "check-version-bump.mjs"));
  copyFileSync(join(scriptsDir, "version-order.mjs"), join(dir, "scripts", "version-order.mjs"));
  git(dir, ["init", "-q"]);
  git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  writeFileSync(join(dir, "package.json"), manifest("0.1.62"));
  writeFileSync(join(dir, "lib", "existing.mjs"), "export const a = 1;\n");
  git(dir, ["add", "-A"]);
  commit(dir, "base 0.1.62");
  return dir;
}

function withFixture(fn) {
  const dir = fixture();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("compareVersions orders patch, minor, major and equal versions", () => {
  expect(compareVersions("0.1.63", "0.1.62")).toBe(1);
  expect(compareVersions("0.2.0", "0.1.99")).toBe(1);
  expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  expect(compareVersions("0.1.68", "0.1.63")).toBe(1);
  expect(compareVersions("0.1.63", "0.1.68")).toBe(-1);
  expect(compareVersions("0.1.63", "0.1.63")).toBe(0);
  expect(compareVersions("0.1.70", "0.1.70")).toBe(0);
  // The old gate's blind spot: a lower patch number is not an update.
  expect(compareVersions("0.1.9", "0.1.10")).toBe(-1);
});

test("compareVersions handles prereleases, build metadata and bad input", () => {
  expect(compareVersions("0.1.70", "0.1.70-rc.1")).toBe(1);
  expect(compareVersions("0.1.70-rc.1", "0.1.70")).toBe(-1);
  expect(compareVersions("0.1.70-rc.2", "0.1.70-rc.1")).toBe(1);
  expect(compareVersions("0.1.70-rc.2", "0.1.70-rc.10")).toBe(-1);
  expect(compareVersions("0.1.70+build.5", "0.1.70+build.9")).toBe(0);
  expect(compareVersions("0.1.70", "nope")).toBeNull();
  expect(compareVersions("", "0.1.70")).toBeNull();
  expect(compareVersions(42, "0.1.70")).toBeNull();
  expect(parseVersion("1.2.3-rc.1+sha.abc").core).toEqual([1, 2, 3]);
  expect(parseVersion("1.2")).toBeNull();
});

test("the gate rejects a branch whose version is lower than the current main", () => {
  withFixture((dir) => {
    git(dir, ["checkout", "-q", "-b", "topic"]);
    writeFileSync(join(dir, "package.json"), manifest("0.1.63"));
    writeFileSync(join(dir, "lib", "existing.mjs"), "export const a = 2;\n");
    git(dir, ["add", "-A"]);
    commit(dir, "branch declares 0.1.63");

    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(join(dir, "package.json"), manifest("0.1.68"));
    git(dir, ["add", "-A"]);
    commit(dir, "main moves to 0.1.68");

    git(dir, ["checkout", "-q", "topic"]);
    const downgrade = runGate(dir);
    expect(downgrade.status).toBe(1);
    expect(downgrade.stderr).toContain("went backwards");
    expect(downgrade.stderr).toContain("0.1.68");
    expect(downgrade.stderr).toContain("0.1.63");

    // Fixing the version to one strictly above main makes the same branch pass.
    writeFileSync(join(dir, "package.json"), manifest("0.1.69"));
    git(dir, ["add", "-A"]);
    commit(dir, "rebase and bump to 0.1.69");
    const fixed = runGate(dir);
    expect(fixed.status).toBe(0);
    expect(fixed.stdout).toContain("[version-check] OK:");
  });
});

// The collision that actually happened four times: two branches, each started
// where main was 0.1.62, each declaring the next patch -- and main had already
// released that number. Being *equal* to main is not a downgrade, so the check
// above lets it through; it is a version nobody receives, which is worse.
test("the gate rejects a branch that declares the version main already released", () => {
  withFixture((dir) => {
    git(dir, ["checkout", "-q", "-b", "topic"]);
    writeFileSync(join(dir, "package.json"), manifest("0.1.63"));
    writeFileSync(join(dir, "lib", "existing.mjs"), "export const a = 2;\n");
    git(dir, ["add", "-A"]);
    commit(dir, "branch declares 0.1.63");

    // Someone else ships 0.1.63 while this branch sits open.
    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(join(dir, "package.json"), manifest("0.1.63"));
    git(dir, ["add", "-A"]);
    commit(dir, "0.1.63: release");

    git(dir, ["checkout", "-q", "topic"]);
    const taken = runGate(dir);
    expect(taken.status).toBe(1);
    expect(taken.stderr).toContain("already released 0.1.63");
    expect(taken.stderr).toContain("strictly greater");

    // The fix the message prescribes: one above what main shipped.
    writeFileSync(join(dir, "package.json"), manifest("0.1.64"));
    git(dir, ["add", "-A"]);
    commit(dir, "bump above the released number");
    const fixed = runGate(dir);
    expect(fixed.status).toBe(0);
    expect(fixed.stdout).toContain("[version-check] OK:");
  });
});

test("a docs-only branch with no version claim still passes when main moved on", () => {
  withFixture((dir) => {
    // Cut the PR while main was still 0.1.62, touching only README.md.
    git(dir, ["checkout", "-q", "-b", "docs"]);
    writeFileSync(join(dir, "README.md"), "docs only\n");
    git(dir, ["add", "-A"]);
    commit(dir, "docs only, no version change");

    // Main then advances to 0.1.68 without this branch knowing about it.
    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(join(dir, "package.json"), manifest("0.1.68"));
    git(dir, ["add", "-A"]);
    commit(dir, "main moves to 0.1.68");

    git(dir, ["checkout", "-q", "docs"]);
    const result = runGate(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no release-relevant files changed");
  });
});

test("a shipped-code change with an unchanged version still fails as before", () => {
  withFixture((dir) => {
    git(dir, ["checkout", "-q", "-b", "topic"]);
    writeFileSync(join(dir, "lib", "existing.mjs"), "export const a = 3;\n");
    git(dir, ["add", "-A"]);
    commit(dir, "change lib without a bump");
    const result = runGate(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("version is still 0.1.62");
  });
});

test("the gate script actually wires the ordering check into its decision", () => {
  expect(gateSource).toContain('import { compareVersions } from "./version-order.mjs";');
  expect(gateSource).toContain("const mainVersion = versionAt(baseCommit) || forkVersion;");
  expect(gateSource).toContain("order < 0");
  // A number equal to main's is refused by its own branch, not folded into the
  // downgrade message: the two need different advice.
  expect(gateSource).toContain("if (order === 0) {");
  expect(gateSource).toContain("already released");
  expect(gateSource).toContain("went backwards");
});
