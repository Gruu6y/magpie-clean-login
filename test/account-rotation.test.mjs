// Asking an account for a SECOND fingerprint, and what happens to a pin that
// was drawn for an account which turned out to already own one.
//
// These are the two halves of one promise: a credential has exactly one
// machine, and the only way it gets a new one is by the user asking. Before
// this, the asking did not exist -- `ensureIdentity` refuses to redraw, and
// `removeAccountDir` refuses while magpie still holds the credential -- while
// the losing half (`reconcileAccountDir`) deleted a freshly drawn pin without
// telling anybody. Both halves are pinned here.
//
// camoufox is never imported: the generator is injected.
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IDENTITY_FILE,
  PROFILE_DIR_NAME,
  accountDir,
  accountProfileDir,
  ensureIdentity,
  readIdentity,
  reconcileAccountDir,
  rotateIdentity,
} from "../lib/account-identity.mjs";

const tempDirs = [];

async function tempEnv() {
  const root = await mkdtemp(join(tmpdir(), "clean-login-rotate-"));
  tempDirs.push(root);
  return { MAGPIE_CLEAN_LOGIN_DATA: root };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// A profile with something in it, so "cleared" cannot pass by being empty
// already: this is the session's cookies, the half of the machine a pin alone
// does not describe.
async function seedProfile(dir) {
  const profile = accountProfileDir(dir);
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "cookies.sqlite"), "old session");
  return profile;
}

test("rotateIdentity replaces the pin and takes the profile with it", async () => {
  const env = await tempEnv();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  const first = await ensureIdentity(dir, { generate: async () => ({ tag: "first" }) });
  expect(first.created).toBe(true);
  const profile = await seedProfile(dir);
  expect(existsSync(join(profile, "cookies.sqlite"))).toBe(true);

  const rotated = await rotateIdentity(dir, { generate: async () => ({ tag: "second" }) });
  expect(rotated.clearedProfile).toBe(true);
  expect(rotated.identity).toEqual({ tag: "second" });
  // The new pin is on disk, not just returned.
  expect(await readIdentity(dir)).toEqual({ tag: "second" });
  expect(JSON.parse(await readFile(join(dir, IDENTITY_FILE), "utf8"))).toEqual({ tag: "second" });
  // And the old session is gone: a new machine that still carried the old
  // cookies is the combination that looks most like a copied credential.
  expect(existsSync(join(profile, "cookies.sqlite"))).toBe(false);
  expect(existsSync(join(dir, PROFILE_DIR_NAME))).toBe(false);
});

test("ensureIdentity still refuses to redraw what rotateIdentity replaced", async () => {
  const env = await tempEnv();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(dir, { generate: async () => ({ tag: "first" }) });
  await rotateIdentity(dir, { generate: async () => ({ tag: "second" }) });
  const again = await ensureIdentity(dir, {
    generate: async () => {
      throw new Error("must not be called");
    },
  });
  // Rotation is an explicit action, not a mode the ordinary path can fall into.
  expect(again.created).toBe(false);
  expect(again.identity).toEqual({ tag: "second" });
});

test("rotateIdentity falls back to an OS-agnostic fingerprint like the first draw", async () => {
  const env = await tempEnv();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(dir, { generate: async () => ({ tag: "first" }) });
  const calls = [];
  const { identity } = await rotateIdentity(dir, {
    generate: async (options) => {
      calls.push(options);
      if (options.os) throw new Error("unknown os");
      return { tag: "generic" };
    },
  });
  expect(identity).toEqual({ tag: "generic" });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({});
});

test("a profile that cannot be cleared fails the rotation and keeps the old pin", async () => {
  const env = await tempEnv();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(dir, { generate: async () => ({ tag: "kept" }) });
  await expect(
    rotateIdentity(dir, {
      generate: async () => {
        throw new Error("the generator must not run after a failed clear");
      },
      remove: async () => {
        throw new Error("EBUSY: the profile is open in a browser");
      },
    }),
  ).rejects.toThrow(/EBUSY/);
  // Half a rotation is worse than none: the pin is still the old one.
  expect(await readIdentity(dir)).toEqual({ tag: "kept" });
});

test("rotateIdentity works on an account that has a directory but no pin yet", async () => {
  const env = await tempEnv();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await mkdir(dir, { recursive: true });
  const { identity, clearedProfile } = await rotateIdentity(dir, {
    generate: async () => ({ tag: "fresh" }),
  });
  expect(identity).toEqual({ tag: "fresh" });
  expect(clearedProfile).toBe(true);
});

test("rotateIdentity needs a directory", async () => {
  await expect(rotateIdentity("")).rejects.toThrow(/account directory is required/);
});

test("reconcileAccountDir carries a fresh pin onto the account's real key", async () => {
  const env = await tempEnv();
  const from = accountDir(env, "workbuddy", "workbuddy#new");
  const to = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(from, { generate: async () => ({ tag: "drawn" }) });
  await seedProfile(from);

  const result = await reconcileAccountDir(env, "workbuddy", "workbuddy#new", "workbuddy");
  expect(result).toEqual({ moved: true, removed: false, discarded: false });
  expect(await readIdentity(to)).toEqual({ tag: "drawn" });
  expect(existsSync(join(accountProfileDir(to), "cookies.sqlite"))).toBe(true);
  expect(existsSync(from)).toBe(false);
});

test("reconcileAccountDir keeps the account's own pin and reports the discarded draw", async () => {
  const env = await tempEnv();
  const from = accountDir(env, "workbuddy", "workbuddy#new");
  const to = accountDir(env, "workbuddy", "workbuddy");
  // The credential already owns a machine.
  await ensureIdentity(to, { generate: async () => ({ tag: "owned" }) });
  await seedProfile(to);
  // This sign-in drew a second one before the write-back recognised the account.
  await ensureIdentity(from, { generate: async () => ({ tag: "drawn" }) });

  const result = await reconcileAccountDir(env, "workbuddy", "workbuddy#new", "workbuddy");
  // The invariant holds -- one credential, one machine -- but the caller can
  // now SEE that a draw was thrown away, which is what the page has to say.
  expect(result).toEqual({ moved: false, removed: true, discarded: true });
  expect(await readIdentity(to)).toEqual({ tag: "owned" });
  expect(existsSync(join(accountProfileDir(to), "cookies.sqlite"))).toBe(true);
  expect(existsSync(from)).toBe(false);
});

test("reconcileAccountDir does nothing when both keys are the same", async () => {
  const env = await tempEnv();
  const dir = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(dir, { generate: async () => ({ tag: "owned" }) });
  // This is the path a claimed or rotated identity takes: there is no move to
  // make, so nothing can be discarded.
  expect(await reconcileAccountDir(env, "workbuddy", "workbuddy", "workbuddy")).toEqual({
    moved: false,
    removed: false,
    discarded: false,
  });
  expect(await readIdentity(dir)).toEqual({ tag: "owned" });
});

test("reconcileAccountDir does nothing without both keys", async () => {
  const env = await tempEnv();
  for (const [from, to] of [
    ["", "workbuddy"],
    ["workbuddy#new", ""],
    [null, "workbuddy"],
  ]) {
    expect(await reconcileAccountDir(env, "workbuddy", from, to)).toEqual({
      moved: false,
      removed: false,
      discarded: false,
    });
  }
});

test("a target that cannot be stated never costs the freshly drawn pin", async () => {
  const env = await tempEnv();
  const from = accountDir(env, "workbuddy", "workbuddy#new");
  const to = accountDir(env, "workbuddy", "workbuddy");
  await ensureIdentity(from, { generate: async () => ({ tag: "drawn" }) });
  await ensureIdentity(to, { generate: async () => ({ tag: "owned" }) });

  // Permissions, a failing disk, an antivirus lock: the question "does this
  // account already have a directory?" went unanswered. Reading that as "yes"
  // would delete the draw, and reading it as "no" would move a pin on top of a
  // directory that may well be there. Neither is evidence, so nothing moves.
  const seen = [];
  const result = await reconcileAccountDir(env, "workbuddy", "workbuddy#new", "workbuddy", {
    probe: async (path) => {
      seen.push(path);
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    },
  });
  expect(seen).toEqual([to]);
  expect(result).toEqual({
    moved: false,
    removed: false,
    discarded: false,
    error: "target_unreadable",
  });
  expect(await readIdentity(from)).toEqual({ tag: "drawn" });
  expect(await readIdentity(to)).toEqual({ tag: "owned" });
});