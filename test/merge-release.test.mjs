// The merge-point script drives pushes and tags, so its guards are tested with
// injected git/gh/bun instead of a live repository. Each guard has a test that
// breaks the condition and asserts the run stops before the destructive step.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Stopped,
  checkVersionOnlyChange,
  needsRelease,
  nextPatch,
  planText,
  runMergeRelease,
  summarizeChecks,
  versionOf,
} from "../scripts/merge-release.mjs";

const MAIN = "dbdb7caafedcba00112233445566778899aabbcc";
const BUMP = "0f69cdb4e47434725fbfdf6972cd54a1f140b011";
const MERGED = "6accca8f32d595effed2ec455538f055275bbc5a";
const dirs = [];

function fixture(overrides = {}) {
  const worktreePath = mkdtempSync(join(tmpdir(), "cl-merge-release-test-"));
  dirs.push(worktreePath);
  writeFileSync(join(worktreePath, "package.json"), '{\n  "name": "fixture",\n  "version": "0.1.91"\n}\n');
  const calls = { gh: [], git: [], run: [], tags: [], merges: [] };
  let merged = false;
  const checks = overrides.checks ?? [
    { name: "test", status: "completed", conclusion: "success" },
    { name: "version-bump", status: "completed", conclusion: "success" },
  ];
  const info = {
    state: "OPEN",
    headRefName: "cindy-xh2xyp/fixture",
    headRefOid: BUMP,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    baseRefOid: overrides.baseRefOid ?? MAIN,
    title: "fixture PR",
  };
  const deps = {
    log: () => {},
    sleep: async () => {},
    now: typeof overrides.now === "function" ? overrides.now : () => overrides.now ?? 1_000,
    pollMs: 1,
    timeoutMs: overrides.timeoutMs ?? 1_000,
    worktreePath,
    gitText: (args) => {
      const key = args.join(" ");
      if (key.startsWith("rev-parse origin/main")) return merged ? MERGED : MAIN;
      if (key.startsWith("show origin/main:package.json")) return '{"version":"0.1.91"}';
      if (key.startsWith("rev-parse HEAD")) return BUMP;
      if (key.startsWith("show --numstat")) return overrides.numstat ?? "1\t1\tpackage.json";
      if (key.startsWith("log --oneline")) return "51bcac6 author's CI fix";
      if (key.startsWith("status --porcelain")) return "";
      return "";
    },
    gitRun: (args) => {
      calls.git.push(args);
      if (args[0] === "push" && overrides.pushFails) return { code: 1, stdout: "", stderr: "rejected: non-fast-forward" };
      if (args[0] === "tag") calls.tags.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
    ghJson: (args) => {
      calls.gh.push(args);
      if (args[0] === "pr" && args[1] === "view" && args.at(-1).includes("headRefOid") && !args.at(-1).includes("state")) {
        return { headRefOid: overrides.headAfterBump ?? BUMP };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        calls.merges.push(args);
        merged = true;
        return null;
      }
      if (args[0] === "api") return overrides.checksPayload ?? { check_runs: checks };
      return info;
    },
    run: (kind) => {
      calls.run.push(kind);
      return { code: kind === "test" && overrides.testFails ? 1 : 0, summary: "996 pass / 0 fail" };
    },
  };
  return { deps, calls, worktreePath, info };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

test("nextPatch and versionOf handle the versions this repo uses", () => {
  expect(nextPatch("0.1.91")).toBe("0.1.92");
  expect(nextPatch("0.1.9")).toBe("0.1.10");
  expect(nextPatch("0.2.99")).toBe("0.2.100");
  expect(nextPatch("not-semver")).toBeNull();
  expect(nextPatch(null)).toBeNull();
  expect(versionOf('{"version":"0.1.91"}')).toBe("0.1.91");
  expect(versionOf("not json")).toBeNull();
});

test("summarizeChecks accepts both gh payload shapes and refuses red or pending sets", () => {
  const green = [
    { name: "test", status: "completed", conclusion: "success" },
    { name: "version-bump", status: "completed", conclusion: "success" },
  ];
  expect(summarizeChecks({ check_runs: green })).toEqual({ total: 2, failed: [], pending: [], green: true });
  expect(summarizeChecks(green)).toEqual({ total: 2, failed: [], pending: [], green: true });
  expect(summarizeChecks([]).green).toBe(false);
  expect(summarizeChecks([{ name: "test", status: "in_progress", conclusion: null }]).pending).toEqual(["test"]);
  expect(summarizeChecks([{ name: "test", status: "completed", conclusion: "failure" }]).failed).toEqual(["test"]);
  expect(summarizeChecks([{ name: "test", status: "completed", conclusion: "cancelled" }]).failed).toEqual(["test"]);
});

test("checkVersionOnlyChange accepts one line changed in package.json and nothing else", () => {
  expect(checkVersionOnlyChange("1\t1\tpackage.json\n")).toEqual({ ok: true });
  expect(checkVersionOnlyChange("1\t1\tpackage.json\n3\t0\tlib/server.mjs\n").ok).toBe(false);
  expect(checkVersionOnlyChange("2\t2\tpackage.json\n").ok).toBe(false);
  expect(checkVersionOnlyChange("1\t1\tREADME.md\n").ok).toBe(false);
  expect(checkVersionOnlyChange("").ok).toBe(false);
});

test("the release patterns stay in sync with check-version-bump.mjs", () => {
  const repoRoot = join(import.meta.dir, "..");
  const gate = readFileSync(join(repoRoot, "scripts", "check-version-bump.mjs"), "utf8");
  const runner = readFileSync(join(repoRoot, "scripts", "merge-release.mjs"), "utf8");
  const patternLine = /const RELEASE_PATTERNS = (\[[^\n]+\]);/.exec(gate)?.[1];
  expect(patternLine).toBeTruthy();
  expect(runner).toContain(`const RELEASE_PATTERNS = ${patternLine};`);
});

test("planText states that a rejected push stops instead of forcing", () => {
  const plan = planText({ pr: 64, version: "0.1.92", tag: true, worktreePath: "/tmp/wt", timeoutMs: 900_000 });
  expect(plan).toContain("PR #64");
  expect(plan).toContain("never forces");
  expect(plan).toContain("bun install");
  expect(plan).toContain("tag v0.1.92 on the new main tip");
});

test("needsRelease matches the version gate's release patterns", () => {
  expect(needsRelease([])).toBe(false);
  expect(needsRelease([{ path: "docs/releasing.md" }, { path: "test/a.test.mjs" }])).toBe(false);
  expect(needsRelease([{ path: "scripts/merge-release.mjs" }])).toBe(false);
  expect(needsRelease([{ path: "lib/server.mjs" }])).toBe(true);
  expect(needsRelease([{ path: "ui/app.js" }])).toBe(true);
  expect(needsRelease([{ path: "page/boot.js" }])).toBe(true);
  expect(needsRelease([{ path: "index.mjs" }])).toBe(true);
  expect(needsRelease(["lib/a.mjs"])).toBe(true);
  // An unreadable list must not silently skip a release.
  expect(needsRelease(undefined)).toBe(true);
  expect(needsRelease(null)).toBe(true);
});

test("planText for a no-release PR has no version, no push and no tag", () => {
  const plan = planText({ pr: 65, version: null, tag: true, release: false, worktreePath: "/tmp/wt", timeoutMs: 900_000 });
  expect(plan).toContain("no release");
  expect(plan).toContain("leave the version alone");
  expect(plan).toContain("no branch push");
  expect(plan).toContain("no tag");
  expect(plan).not.toContain("tag v");
});

test("a docs-only PR merges without a version commit, push or tag", async () => {
  const { deps, calls, worktreePath } = fixture();
  deps.ghJson = ((original) => (args) => {
    if (args[0] === "pr" && args[1] === "view" && args.at(-1).includes("state")) {
      return {
        state: "OPEN", headRefName: "cindy-default/tooling", headRefOid: BUMP, mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN", baseRefOid: MAIN, title: "tooling PR",
        files: [{ path: "docs/releasing.md" }, { path: "scripts/tooling.mjs" }, { path: "test/tooling.test.mjs" }],
      };
    }
    return original(args);
  })(deps.ghJson);
  const result = await runMergeRelease({ pr: 65 }, deps);
  expect(result.release).toBe(false);
  expect(result.version).toBeNull();
  expect(result.tag).toBeNull();
  expect(result.mergeCommit).toBe(MERGED);
  expect(JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf8")).version).toBe("0.1.91");
  expect(calls.run).toEqual(["install", "test"]);
  expect(calls.git.filter((a) => a[0] === "commit").length).toBe(0);
  expect(calls.git.filter((a) => a[0] === "push").length).toBe(0);
  expect(calls.tags.length).toBe(0);
  expect(calls.merges.length).toBe(1);
  expect(result.stages).toContain("version-skipped");
  expect(result.stages).toContain("push-skipped");
  expect(result.stages).toContain("tag-skipped");
});

test("--release forces a bump even when the PR ships no code", async () => {
  const { deps, calls } = fixture();
  deps.ghJson = ((original) => (args) => {
    if (args[0] === "pr" && args[1] === "view" && args.at(-1).includes("state")) {
      return {
        state: "OPEN", headRefName: "cindy-default/tooling", headRefOid: BUMP, mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN", baseRefOid: MAIN, title: "tooling PR", files: [{ path: "docs/releasing.md" }],
      };
    }
    return original(args);
  })(deps.ghJson);
  const result = await runMergeRelease({ pr: 65, release: true }, deps);
  expect(result.release).toBe(true);
  expect(result.version).toBe("0.1.92");
  expect(calls.tags.length).toBe(1);
});

test("an unreadable PR file list fails closed and still releases", async () => {
  const { deps, calls } = fixture();
  deps.ghJson = ((original) => (args) => {
    if (args[0] === "pr" && args[1] === "view" && args.at(-1).includes("state")) {
      return {
        state: "OPEN", headRefName: "cindy-default/tooling", headRefOid: BUMP, mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN", baseRefOid: MAIN, title: "tooling PR",
      };
    }
    return original(args);
  })(deps.ghJson);
  const result = await runMergeRelease({ pr: 65 }, deps);
  expect(result.release).toBe(true);
  expect(result.version).toBe("0.1.92");
  expect(calls.tags.length).toBe(1);
});

test("the happy path bumps one line, tests the final head, merges, then tags", async () => {
  const { deps, calls, worktreePath } = fixture();
  const result = await runMergeRelease({ pr: 64, tag: true }, deps);
  expect(result.version).toBe("0.1.92");
  expect(result.mergeCommit).toBe(MERGED);
  expect(result.tag).toBe("v0.1.92");
  expect(JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf8")).version).toBe("0.1.92");
  expect(calls.run).toEqual(["install", "test"]);
  expect(calls.merges).toEqual([["pr", "merge", "64", "--rebase", "--delete-branch"]]);
  expect(calls.tags).toEqual([["tag", "-a", "v0.1.92", "-m", "v0.1.92", MERGED]]);
  expect(result.stages.indexOf("merge")).toBeLessThan(result.stages.indexOf("tag"));
  expect(result.stages.indexOf("tests")).toBeLessThan(result.stages.indexOf("push"));
  // No force push, ever.
  expect(calls.git.filter((a) => a[0] === "push" && a.includes("--force")).length).toBe(0);
  expect(calls.git.filter((a) => a[0] === "push" && a.includes("-f")).length).toBe(0);
});

test("a PR based on an older main stops before anything is pushed", async () => {
  const { deps, calls } = fixture({ baseRefOid: "0000000000000000000000000000000000000000" });
  await expect(runMergeRelease({ pr: 64 }, deps)).rejects.toBeInstanceOf(Stopped);
  expect(calls.merges.length).toBe(0);
  expect(calls.tags.length).toBe(0);
  expect(calls.git.filter((a) => a[0] === "push").length).toBe(0);
});

test("a red check stops the merge", async () => {
  const { deps, calls } = fixture({ checks: [{ name: "test", status: "completed", conclusion: "failure" }] });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("wait-for-ci");
  expect(calls.merges.length).toBe(0);
  expect(calls.tags.length).toBe(0);
});

test("a pending check that never turns green times out instead of merging", async () => {
  let clock = 0;
  const { deps, calls } = fixture({
    checks: [{ name: "test", status: "in_progress", conclusion: null }],
    now: () => (clock += 2_000),
  });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("wait-for-ci");
  expect(calls.merges.length).toBe(0);
});

test("a rejected push stops and reports the author's new commits; it never forces", async () => {
  const { deps, calls } = fixture({ pushFails: true });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("push");
  expect(error.message).toContain("Never forced");
  expect(error.message).toContain("51bcac6 author's CI fix");
  expect(calls.merges.length).toBe(0);
  expect(calls.git.filter((a) => a[0] === "push" && (a.includes("--force") || a.includes("-f"))).length).toBe(0);
});

test("someone pushing after the bump is detected before the merge", async () => {
  const { deps, calls } = fixture({ headAfterBump: "1111111111111111111111111111111111111111" });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("wait-for-ci");
  expect(calls.merges.length).toBe(0);
});

test("a merge-point commit that touches more than package.json is refused", async () => {
  const { deps, calls } = fixture({ numstat: "1\t1\tpackage.json\n2\t0\tlib/server.mjs\n" });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("version");
  expect(calls.git.filter((a) => a[0] === "push").length).toBe(0);
  expect(calls.merges.length).toBe(0);
});

test("a failing test suite stops the push", async () => {
  const { deps, calls } = fixture({ testFails: true });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("tests");
  expect(calls.git.filter((a) => a[0] === "push").length).toBe(0);
});

test("--no-tag merges but creates no tag and does not wait on main CI", async () => {
  const { deps, calls } = fixture();
  const result = await runMergeRelease({ pr: 64, tag: false }, deps);
  expect(result.tag).toBeNull();
  expect(calls.tags.length).toBe(0);
  expect(result.stages).toContain("tag-skipped");
  expect(result.stages).not.toContain("wait-for-main-ci");
});

test("an explicit version is used instead of main's next patch", async () => {
  const { deps, worktreePath } = fixture();
  const result = await runMergeRelease({ pr: 64, version: "0.2.0", tag: true }, deps);
  expect(result.version).toBe("0.2.0");
  expect(JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf8")).version).toBe("0.2.0");
});

test("a tag that already exists on origin stops before creating it", async () => {
  const { deps, calls } = fixture();
  deps.gitText = ((original) => (args) =>
    args.join(" ").startsWith("ls-remote --tags") ? "91195edc3541 refs/tags/v0.1.92" : original(args))(deps.gitText);
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("tag");
  expect(calls.tags.length).toBe(0);
});

test("a failing bun install stops before the version commit", async () => {
  const { deps, calls } = fixture();
  deps.run = (kind) => {
    calls.run.push(kind);
    return { code: kind === "install" ? 1 : 0 };
  };
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("install");
  expect(calls.git.filter((a) => a[0] === "commit").length).toBe(0);
});

test("a git failure is reported with the stage it happened in", async () => {
  const { deps } = fixture();
  deps.gitRun = (args) => (args[0] === "add" ? { code: 1, stdout: "", stderr: "cannot add" } : { code: 0 });
  const error = await runMergeRelease({ pr: 64 }, deps).catch((e) => e);
  expect(error).toBeInstanceOf(Stopped);
  expect(error.stage).toBe("version");
  expect(error.message).toContain("cannot add");
});

test("a previous failed run's worktree is cleared before checkout", async () => {
  const { deps, calls, worktreePath } = fixture();
  await runMergeRelease({ pr: 64, keepWorktree: true }, deps);
  const removes = calls.git.filter((a) => a[0] === "worktree" && a[1] === "remove");
  expect(removes.length).toBe(1);
  expect(removes[0]).toContain(worktreePath);
  expect(calls.git.some((a) => a[0] === "worktree" && a[1] === "add")).toBe(true);
});
