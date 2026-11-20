// The orphan sweep against a REAL sign-in controller that sits in
// `waiting-code`. Everything lives under one temp root (data dir and magpie
// config dir), no browser is started and no provider plugin is imported.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIGNIN_FLOW_MARKER, accountDir } from "../lib/account-identity.mjs";
import { TOKEN_HEADER, startServer } from "../lib/server.mjs";
import { CALLBACK_TIMEOUT_MS, createSignInFlow } from "../lib/signin-flow.mjs";

const tmp = mkdtempSync(join(tmpdir(), "clean-login-prune-guard-"));
const env = {
  ...process.env,
  MAGPIE_CONFIG_DIR: join(tmp, "magpie-config"),
  MAGPIE_CLEAN_LOGIN_DATA: join(tmp, "data"),
  MAGPIE_CACHE_DIR: join(tmp, "magpie-cache"),
};
let service;
let token;
let signIn;

beforeAll(async () => {
  // A readable auth file with one unrelated key, so the sweep really runs
  // instead of bailing out on `auth_missing`.
  mkdirSync(env.MAGPIE_CONFIG_DIR, { recursive: true });
  writeFileSync(join(env.MAGPIE_CONFIG_DIR, "plugin-auth.json"), JSON.stringify({ other: { type: "oauth" } }));
  signIn = createSignInFlow({
    env,
    readKeys: () => new Set(["other"]),
    readEntries: () => ({}),
    random: () => 0.5,
    identityGenerator: async () => ({ tag: "pin" }),
    loadProvider: async () => ({
      methods: [
        {
          type: "oauth",
          label: "Phone code",
          authorize: async () => ({ url: "", instructions: "code sent", method: "code", callback: async () => ({ type: "failed" }) }),
        },
      ],
    }),
  });
  service = await startServer({
    port: 0,
    env,
    dataDir: env.MAGPIE_CLEAN_LOGIN_DATA,
    pluginScanner: { get: () => ({ available: false, providers: [] }), warm() {} },
    signIn,
  });
  await service.prune();
  const html = await (await fetch(`http://127.0.0.1:${service.port}/`)).text();
  token = /content="([0-9a-f]{64})"/.exec(html)?.[1];
});

afterAll(async () => {
  await signIn?.cancel();
  await service?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("POST /api/accounts/prune keeps the directory of a sign-in waiting for its code", async () => {
  const started = await signIn.startSignIn({ provider: "loomy" });
  expect(signIn.status().state).toBe("waiting-code");
  const dir = accountDir(env, "loomy", started.key);
  const marker = join(dir, SIGNIN_FLOW_MARKER);
  expect(existsSync(marker)).toBe(true);
  // The user is still typing the code, but the marker is older than the
  // window: by its age alone the sweep would call this directory abandoned.
  const old = (Date.now() - CALLBACK_TIMEOUT_MS - 60_000) / 1000;
  utimesSync(marker, old, old);
  // A real orphan beside it, so the sweep is shown to be running.
  const orphan = accountDir(env, "loomy", "loomy#orphan");
  mkdirSync(orphan, { recursive: true });

  const res = await fetch(`http://127.0.0.1:${service.port}/api/accounts/prune`, {
    method: "POST",
    headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
    body: "{}",
  });
  expect(res.status).toBe(200);
  const { report } = await res.json();
  expect(report.skipped).toBeNull();
  expect(report.skippedLive).toEqual([{ provider: "loomy", key: started.key }]);
  expect(report.removed).toEqual([{ provider: "loomy", key: "loomy#orphan" }]);
  expect(existsSync(dir)).toBe(true);
  expect(existsSync(join(dir, "identity.json"))).toBe(true);
  expect(existsSync(orphan)).toBe(false);
  expect(signIn.status().state).toBe("waiting-code");
});
