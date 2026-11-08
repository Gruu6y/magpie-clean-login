// Merge-point release for the clean-login pull request queue.
//
// docs/releasing.md: the merger assigns the version on the pull request branch
// at the merge point, so a contributor branch never touches package.json. Done
// by hand that is a dozen steps, and every step is a chance to get the order
// wrong -- a tag created before the merge points at a SHA that the rebase threw
// away, a push is rejected because the author added a commit while the review
// ran, release.mjs refuses to run on a branch.
//
// This script performs the mechanical part of that sequence and nothing else:
//
//   node scripts/merge-release.mjs <pr> [options]
//
//     --version <x.y.z>   assign this version (implies --release; default: main's next patch)
//     --dry-run           print the plan; touch nothing
//     --no-tag            merge without tagging
//     --release           force a version bump even if the PR ships no code
//     --no-release        force no bump/tag even if the PR ships code
//     --keep-worktree     leave the review checkout in place
//     --timeout <sec>     how long to wait for CI (default 900)
//
// Without --release/--no-release, the PR's changed files decide: a docs, test
// or tooling PR is merged without inventing a version (see check-version-bump.mjs).
//
// It never force-pushes, never merges while a check is red or pending, never
// tags before the merge, and never writes outside a temporary worktree plus the
// tag ref. Reviewing the diff and the destructive checks are deliberately NOT
// here -- that is judgement, not mechanics.
//
// The gh and bun binaries are read from GH and BUN so a machine where they are
// not on PATH still works.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Conclusions that mean "this check will never be green".
const RED = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]);

// Must stay in sync with scripts/check-version-bump.mjs: a PR that touches none
// of these is a docs/test/tooling PR. Merging one must NOT invent a version or
// a tag -- that is exactly the kind of no-op release this script exists to avoid.
const RELEASE_PATTERNS = [/^lib\//, /^ui\//, /^page\//, /^index\.mjs$/];

export function needsRelease(files) {
  // An unreadable file list is treated as "assume it ships code": failing
  // closed here costs one extra version, failing open costs a missed update.
  if (!Array.isArray(files)) return true;
  return files.some((file) => {
    const path = typeof file === "string" ? file : file?.path;
    return typeof path === "string" && RELEASE_PATTERNS.some((pattern) => pattern.test(path));
  });
}

export class Stopped extends Error {
  constructor(stage, message) {
    super(message);
    this.name = "Stopped";
    this.stage = stage;
  }
}

export function nextPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? "").trim());
  if (!match) return null;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function versionOf(manifestText) {
  try {
    return JSON.parse(manifestText)?.version ?? null;
  } catch {
    return null;
  }
}

// `gh api .../check-runs` answers with an object; older endpoints answer with
// the bare array. Both shapes are accepted.
export function summarizeChecks(payload) {
  const list = Array.isArray(payload) ? payload : (payload?.check_runs ?? []);
  const failed = list.filter((c) => c.status === "completed" && RED.has(c.conclusion)).map((c) => c.name);
  const pending = list.filter((c) => c.status !== "completed").map((c) => c.name);
  return { total: list.length, failed, pending, green: list.length > 0 && failed.length === 0 && pending.length === 0 };
}

// The merge point adds exactly one line and removes exactly one line, in
// package.json. Anything else means the script is about to carry something it
// was never meant to carry.
export function checkVersionOnlyChange(numstat) {
  const lines = String(numstat ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    return { ok: false, reason: `the commit changes ${lines.length} files, expected only package.json` };
  }
  const match = /^(\d+)\t(\d+)\tpackage\.json$/.exec(lines[0]);
  if (!match) return { ok: false, reason: `expected package.json, saw ${JSON.stringify(lines[0])}` };
  if (match[1] !== "1" || match[2] !== "1") {
    return { ok: false, reason: `expected 1 insertion and 1 deletion, saw +${match[1]} -${match[2]}` };
  }
  return { ok: true };
}

export function planText({ pr, version, tag, release = true, worktreePath, timeoutMs }) {
  const head = [
    `merge-release plan for PR #${pr}${release ? "" : "  (no release: no version bump, no tag)"}`,
    `  1. fetch origin; require the PR to be OPEN, MERGEABLE and based on the current main`,
    `  2. check out the PR head into ${worktreePath} and run bun install`,
  ];
  if (!release) {
    return [
      ...head,
      `  3. no shipped-code files (lib/, ui/, page/, index.mjs): leave the version alone`,
      `  4. run the full bun test suite on the PR head`,
      `  5. no branch push: the contributor's head is already the final head`,
      `  6. wait up to ${Math.round(timeoutMs / 1000)}s for the PR checks to go green`,
      `  7. rebase-merge the PR and delete the branch`,
      `  8. no tag`,
      `  9. sync the local main`,
    ].join("\n");
  }
  return [
    ...head,
    `  3. assign version ${version} in package.json (one line) and commit it`,
    `  4. run the full bun test suite on that final head`,
    `  5. push to the PR branch -- a rejected (non fast-forward) push stops here, never forces`,
    `  6. wait up to ${Math.round(timeoutMs / 1000)}s for the PR checks to go green`,
    `  7. rebase-merge the PR and delete the branch`,
    tag ? `  8. tag v${version} on the new main tip (annotated), push the tag` : `  8. --no-tag: stop after the merge`,
    tag ? `  9. wait for the main push checks, then sync the local main` : `  9. sync the local main`,
  ].join("\n");
}

function short(sha) {
  return String(sha ?? "").slice(0, 10);
}

// A git/gh/bun failure that is not a Stopped still needs to name the stage it
// happened in; otherwise the operator sees "unexpected" and has to guess.
export async function runMergeRelease(options, deps) {
  const stages = [];
  try {
    return await mergeReleaseCore(options, deps, stages);
  } catch (error) {
    if (error instanceof Stopped) throw error;
    throw new Stopped(stages[stages.length - 1] ?? "start", error?.message ?? String(error));
  }
}

async function mergeReleaseCore(options, deps, stages) {
  const { gitText, gitRun, ghJson, run, log, sleep, worktreePath, timeoutMs, pollMs } = deps;
  const { pr, tag = true, keepWorktree = false } = options;
  const step = (name) => {
    stages.push(name);
    log(`== ${name}`);
  };
  const stage = () => stages[stages.length - 1] ?? "start";
  // Unlike a fire-and-forget gitRun, this one refuses to continue past a
  // failure. Only the branch push and the cleanup are allowed to fail.
  const must = (args, cwd) => {
    const result = gitRun(args, cwd);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    return result;
  };
  const out = { pr, stages, version: null, release: null, mergeCommit: null, tag: null, testSummary: null };

  step("preflight");
  must(["fetch", "--prune", "origin"]);
  const info = ghJson(["pr", "view", String(pr), "--json", "state,headRefName,headRefOid,mergeable,mergeStateStatus,baseRefOid,title,files"]);
  if (info.state !== "OPEN") throw new Stopped(stage(), `PR #${pr} is ${info.state}`);
  if (info.mergeable !== "MERGEABLE") throw new Stopped(stage(), `PR #${pr} is ${info.mergeable}/${info.mergeStateStatus}`);
  const mainSha = gitText(["rev-parse", "origin/main"]);
  if (info.baseRefOid !== mainSha) {
    throw new Stopped(stage(), `PR #${pr} is based on ${short(info.baseRefOid)} but main is ${short(mainSha)}; rebase it before releasing`);
  }
  const mainVersion = versionOf(gitText(["show", "origin/main:package.json"]));
  // --release / --no-release override the automatic decision; --version also
  // implies a release. Otherwise the PR's own file list decides. A PR that does
  // not ship code must not invent a version or a tag.
  const release = options.release ?? (options.version != null || needsRelease(info.files));
  const version = release ? (options.version ?? nextPatch(mainVersion)) : null;
  if (release && !version) throw new Stopped(stage(), `cannot derive a version from main's ${JSON.stringify(mainVersion)}`);
  out.release = release;
  log(`   ${release ? `release-relevant files found; assigning ${version}` : "no release-relevant files; merge without a version or tag"}`);

  step("checkout");
  // A previous failed run may have left this worktree behind. Clearing it here
  // makes a retry safe; adding it is still the step that must succeed.
  gitRun(["worktree", "remove", "--force", worktreePath], undefined, { allowFail: true });
  gitRun(["worktree", "prune"], undefined, { allowFail: true });
  must(["worktree", "add", "--detach", worktreePath, info.headRefOid]);
  const inWorktree = { cwd: worktreePath };

  step("install");
  const installed = run("install", inWorktree);
  if (installed.code !== 0) throw new Stopped(stage(), "bun install failed in the review worktree");

  let bumpSha = info.headRefOid;
  if (release) {
    step("version");
    const manifestPath = join(worktreePath, "package.json");
    const manifest = readFileSync(manifestPath, "utf8");
    if (versionOf(manifest) === version) {
      // A previous run already pushed this exact version and then stopped (for
      // example while waiting for CI). Replacing the line with itself leaves
      // nothing to commit, so reuse the head that is already there. The full
      // suite below still runs on it, and CI still has to go green.
      log(`   the PR head already carries ${version}; reusing it`);
    } else {
      const bumped = manifest.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
      if (bumped === manifest) throw new Stopped(stage(), `package.json in the PR head has no version line to replace`);
      writeFileSync(manifestPath, bumped);
      must(["add", "package.json"], inWorktree);
      must(["commit", "-m", `chore(release): assign ${version} at the merge point`], inWorktree);
      bumpSha = gitText(["rev-parse", "HEAD"], inWorktree);
      const guard = checkVersionOnlyChange(gitText(["show", "--numstat", "--format=", "HEAD"], inWorktree));
      if (!guard.ok) throw new Stopped(stage(), `the merge-point commit is not version-only: ${guard.reason}`);
    }
  } else {
    step("version-skipped");
  }

  step("tests");
  const tested = run("test", inWorktree);
  if (tested.code !== 0) throw new Stopped(stage(), `the full test suite failed on the final head`);
  out.testSummary = tested.summary ?? null;

  if (release) {
    step("push");
    const pushed = gitRun(["push", "origin", `HEAD:${info.headRefName}`], inWorktree, { allowFail: true });
    if (pushed.code !== 0) {
      const behind = gitText(["log", "--oneline", `${bumpSha}..origin/${info.headRefName}`], { allowFail: true });
      throw new Stopped(
        stage(),
        `the push was rejected -- the branch moved while this ran. Never forced. The author's new commits:\n${behind || "(could not read them; fetch again)"}`,
      );
    }
  } else {
    step("push-skipped");
  }

  step("wait-for-ci");
  const deadline = deps.now() + timeoutMs;
  let checks = null;
  for (;;) {
    // The branch ref is authoritative: `git push` updates it synchronously,
    // while `gh pr view --json headRefOid` can keep answering with the old head
    // for a while afterwards. Reading that lagging value here once reported
    // "someone pushed" for the bump commit this script had just pushed itself.
    const remote = gitText(["ls-remote", "origin", `refs/heads/${info.headRefName}`]);
    const branchSha = String(remote ?? "").split(/\s+/)[0] || null;
    if (branchSha !== bumpSha) {
      throw new Stopped(stage(), `the branch is now ${short(branchSha)}, not the reviewed head ${short(bumpSha)}; someone pushed while this ran`);
    }
    checks = summarizeChecks(ghJson(["api", `repos/__REPO__/commits/${bumpSha}/check-runs`]));
    if (checks.failed.length > 0) throw new Stopped(stage(), `checks failed: ${checks.failed.join(", ")}`);
    if (checks.green) {
      // `gh pr merge --rebase` merges whatever the PR points at, and that ref
      // lags the branch we just pushed. Merging before it catches up would
      // silently drop the version commit, so wait for the two to agree.
      const head = ghJson(["pr", "view", String(pr), "--json", "headRefOid"]);
      if (head?.headRefOid === bumpSha) break;
      if (deps.now() >= deadline) {
        throw new Stopped(stage(), `checks are green but the PR head is still ${short(head?.headRefOid)}, not ${short(bumpSha)}; refusing to merge a head without the version`);
      }
      log(`   checks green; waiting for the PR head to reach ${short(bumpSha)}`);
      await sleep(pollMs);
      continue;
    }
    if (deps.now() >= deadline) throw new Stopped(stage(), `timed out waiting for: ${checks.pending.join(", ") || "no checks reported"}`);
    log(`   waiting on ${checks.pending.join(", ") || "no checks reported"}`);
    await sleep(pollMs);
  }

  step("merge");
  ghJson(["pr", "merge", String(pr), "--rebase", "--delete-branch"]);
  must(["fetch", "--prune", "origin"]);
  out.mergeCommit = gitText(["rev-parse", "origin/main"]);

  if (tag && release) {
    step("tag");
    const existing = gitText(["ls-remote", "--tags", "origin", `refs/tags/v${version}`]);
    if (existing) throw new Stopped(stage(), `tag v${version} already exists on origin; pick a version explicitly`);
    must(["tag", "-a", `v${version}`, "-m", `v${version}`, out.mergeCommit]);
    must(["push", "origin", `refs/tags/v${version}`]);
    out.tag = `v${version}`;
    step("wait-for-main-ci");
    const mainDeadline = deps.now() + timeoutMs;
    for (;;) {
      const status = summarizeChecks(ghJson(["api", `repos/__REPO__/commits/${out.mergeCommit}/check-runs`]));
      if (status.failed.length > 0) throw new Stopped(stage(), `main pushed with failing checks: ${status.failed.join(", ")}`);
      if (status.green) break;
      if (deps.now() >= mainDeadline) throw new Stopped(stage(), `timed out waiting for main's checks: ${status.pending.join(", ")}`);
      await sleep(pollMs);
    }
  } else {
    step("tag-skipped");
  }

  step("cleanup");
  if (!keepWorktree) {
    gitRun(["worktree", "remove", "--force", worktreePath], undefined, { allowFail: true });
    gitRun(["worktree", "prune"], undefined, { allowFail: true });
  }
  const dirty = gitText(["status", "--porcelain"], { allowFail: true }) ?? "";
  if (dirty.trim() === "") {
    gitRun(["checkout", "main"], undefined, { allowFail: true });
    gitRun(["reset", "--hard", "origin/main"], undefined, { allowFail: true });
  } else {
    log("   the main checkout has local changes; skipped syncing it");
  }
  out.version = version;
  out.release = release;
  return out;
}

function cwdOf(options) {
  return typeof options === "string" ? options : (options?.cwd ?? root);
}

function realDeps(pr) {
  const GH = process.env.GH || "gh";
  const BUN = process.env.BUN || "bun";
  const sh = (args, cwd, options = {}) => {
    try {
      const stdout = execFileSync(args[0], args.slice(1), {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      return { code: 0, stdout: stdout.trim(), stderr: "" };
    } catch (error) {
      return { code: error?.status ?? 1, stdout: String(error?.stdout ?? "").trim(), stderr: String(error?.stderr ?? error?.message ?? "").trim() };
    }
  };
  return {
    gitText: (args, options = {}) => {
      const result = sh(["git", ...args], cwdOf(options), options);
      if (result.code !== 0 && !options.allowFail) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
      return result.code === 0 ? result.stdout : null;
    },
    gitRun: (args, options = {}, extra = {}) => sh(["git", ...args], cwdOf(options), extra),
    ghJson: (args, options = {}) => {
      const expanded = args.map((a) => (a.includes("__REPO__") ? a.replace("__REPO__", process.env.CL_REPO || repoSlug()) : a));
      const result = sh([GH, ...expanded], cwdOf(options));
      if (result.code !== 0) throw new Error(`gh ${args.join(" ")} failed: ${result.stderr}`);
      const text = result.stdout;
      if (!text) return null;
      // `gh pr merge` prints human-readable text, not JSON. Only the --json
      // calls need parsing; a command succeeded when gh exited 0.
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    run: (kind, cwd) => {
      const result = sh([BUN, ...(kind === "test" ? ["test"] : ["install", "--ignore-scripts"])], cwdOf(cwd));
      const summary = kind === "test" ? (result.stdout.match(/\d+ pass\b.*|\d+ fail\b.*/g) ?? []).slice(0, 2).join(" / ") : null;
      return { ...result, summary };
    },
    log: (line) => console.log(`[merge-release] ${line}`),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    worktreePath: join(tmpdir(), `cl-merge-release-${pr}`),
  };
}

function repoSlug() {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const match = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error(`cannot read a GitHub slug from ${remote}`);
  return match[1];
}

function parseArgs(argv) {
  const options = { pr: null, version: null, tag: true, release: null, keepWorktree: false, dryRun: false, timeoutMs: 900_000, pollMs: 15_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") options.version = argv[++index] ?? null;
    else if (arg === "--no-tag") options.tag = false;
    else if (arg === "--release") options.release = true;
    else if (arg === "--no-release") options.release = false;
    else if (arg === "--keep-worktree") options.keepWorktree = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--timeout") options.timeoutMs = Number(argv[++index]) * 1000;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (/^\d+$/.test(arg)) options.pr = arg;
    else throw new Stopped("args", `unknown argument ${arg}`);
  }
  return options;
}

// Works when invoked by both `node` and `bun`: node has no import.meta.main.
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.pr) {
    console.error("usage: node scripts/merge-release.mjs <pr> [--version x.y.z] [--dry-run] [--no-tag] [--release|--no-release] [--keep-worktree] [--timeout sec]");
    process.exit(options.help ? 0 : 2);
  }
  const deps = realDeps(options.pr);
  if (options.dryRun) {
    // A dry run must be read-only: it reads the local origin/main ref and never
    // fetches, so it cannot change even the remote-tracking refs. `gh pr view`
    // is a read too.
    const mainVersion = versionOf(deps.gitText(["show", "origin/main:package.json"]));
    let files;
    try {
      files = deps.ghJson(["pr", "view", String(options.pr), "--json", "files"])?.files;
    } catch {
      files = undefined; // unreadable file list fails closed: needsRelease(undefined) === true
    }
    const release = options.release ?? (options.version != null || needsRelease(files));
    console.log(
      planText({
        pr: options.pr,
        version: release ? (options.version ?? nextPatch(mainVersion)) : null,
        release,
        tag: options.tag,
        worktreePath: deps.worktreePath,
        timeoutMs: options.timeoutMs,
      }),
    );
    console.log(`dry run: nothing was fetched, written, committed, merged or tagged. Release: ${release ? (files ? "shipped-code files found" : "assumed (PR file list unreadable)") : "no release-relevant files"}.`);
  } else {
    try {
      const result = await runMergeRelease(options, deps);
      console.log(`[merge-release] merged PR #${result.pr} as ${short(result.mergeCommit)}; ${result.release ? `version ${result.version}` : "no version (no shipped-code files)"}${result.tag ? `; tag ${result.tag}` : ""}`);
      if (result.testSummary) console.log(`[merge-release] local suite: ${result.testSummary}`);
    } catch (error) {
      const where = error instanceof Stopped ? error.stage : "unexpected";
      console.error(`[merge-release] STOPPED at ${where}: ${error.message}`);
      process.exit(1);
    }
  }
}
