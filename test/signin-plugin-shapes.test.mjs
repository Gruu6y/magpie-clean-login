import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLoadProvider } from "../lib/signin-flow.mjs";

// The installed plugin is only ever imported at sign-in time, and the scan
// that fills the provider card is a different code path. These fixtures load
// real packages from a temporary plugin root so the two paths cannot drift
// apart again without a test going red.

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "cl-signin-shapes-"));
  roots.push(root);
  const dir = join(root, "plugins", "node_modules", "@fixture", "agy");
  mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(dir, name), source);
  }
  return { env: { MAGPIE_CONFIG_DIR: root } };
}

const scanner = {
  get: () => ({
    available: true,
    providers: [{ id: "agy-cli", package: "@fixture/agy", methods: [] }],
  }),
};

const manifest = JSON.stringify({
  name: "@fixture/agy",
  type: "module",
  main: "./opencode.mjs",
});

test("a host-shape-only plugin exposes its sign-in methods at sign-in time", async () => {
  // agy-cli's `main` is a shim that only re-exports the default host object,
  // so the module namespace carries no callable factory at all.
  const { env } = fixture({
    "package.json": manifest,
    "opencode.mjs": 'export { default } from "./index.mjs";\n',
    "index.mjs":
      'export default { id: "agy-cli", server: async () => ({ auth: { provider: "agy-cli", methods: [{ type: "oauth", label: "Sign in with Google" }] } }) };\n',
  });

  const loaded = await defaultLoadProvider({
    provider: "agy-cli",
    env,
    client: {},
    magpie: {},
    pluginScanner: scanner,
  });

  expect(loaded.package).toBe("@fixture/agy");
  expect(loaded.methods).toEqual([{ type: "oauth", label: "Sign in with Google" }]);
});

test("the host shape receives the real sign-in input, not the scanner stub", async () => {
  const { env } = fixture({
    "package.json": manifest,
    "opencode.mjs": 'export { default } from "./index.mjs";\n',
    "index.mjs": `
      export default {
        id: "agy-cli",
        server: async (input) => ({
          auth: {
            provider: "agy-cli",
            methods: [{
              type: "oauth",
              label: input.magpie?.kind === "real" && input.client?.kind === "real" && input.$ === undefined
                ? "real input"
                : "stub input",
            }],
          },
        }),
      };
    `,
  });

  const loaded = await defaultLoadProvider({
    provider: "agy-cli",
    env,
    client: { kind: "real" },
    magpie: { kind: "real" },
    pluginScanner: scanner,
  });

  expect(loaded.methods[0].label).toBe("real input");
});

test("a package with both shapes keeps the named factory's methods", async () => {
  const { env } = fixture({
    "package.json": manifest,
    "opencode.mjs": 'export * from "./index.mjs";\nexport { default } from "./index.mjs";\n',
    "index.mjs": `
      export async function AgyCliAuth() {
        return { auth: { provider: "agy-cli", methods: [{ type: "oauth", label: "from named factory" }] } };
      }
      export default {
        id: "agy-cli",
        server: async () => ({ auth: { provider: "agy-cli", methods: [{ type: "oauth", label: "from host shape" }] } }),
      };
    `,
  });

  const loaded = await defaultLoadProvider({
    provider: "agy-cli",
    env,
    client: {},
    magpie: {},
    pluginScanner: scanner,
  });

  expect(loaded.methods[0].label).toBe("from named factory");
});

test("exports that are neither factories nor host shapes still fail honestly", async () => {
  const { env } = fixture({
    "package.json": manifest,
    "opencode.mjs": 'export { default } from "./index.mjs";\n',
    "index.mjs": 'export default { id: "agy-cli" };\nexport const answer = 42;\n',
  });

  let failure = null;
  try {
    await defaultLoadProvider({
      provider: "agy-cli",
      env,
      client: {},
      magpie: {},
      pluginScanner: scanner,
    });
  } catch (error) {
    failure = error;
  }

  expect(failure?.code).toBe("plugin_load_failed");
  expect(failure?.status).toBe(502);
  expect(String(failure?.message)).toContain("exposes no sign-in method");
});
