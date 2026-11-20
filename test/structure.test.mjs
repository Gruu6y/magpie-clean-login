import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("uses the community page package shape", () => {
  expect(pkg.name).toBe("@gruu6y/page-clean-login");
  expect(pkg.license).toBe("MIT");
  expect(pkg.type).toBe("module");
  // A page plugin that runs a host service MUST name an entry file.
  // magpie assigns `magpie.page.service` only while `main` (or `exports`) is
  // present — internal/plugin/page.go: "a plugin that is only a page has none,
  // so its sandboxed page can't be handed a way to some other program's port".
  // Without it the page renders but nothing listens, so the frame shows
  // "127.0.0.1 refused to connect".
  //
  // The cost of naming it: github.go only reads a plugin's kind as "page" when
  // main and exports are BOTH absent, so Discover files this one under
  // providers rather than pages. A working service wins over the right shelf.
  expect(pkg.main).toBe("./index.mjs");
  expect(pkg.magpie.icon).toMatch(/^https:\/\//);
  expect(pkg.magpie.page.file).toBe("page/index.html");
  expect(pkg.magpie.page.service).toEqual({ port: 3492, option: "port" });
  expect(pkg.magpie.options.port).toBe(3492);
});

test("declares only the providers:list read it actually uses", () => {
  expect(pkg.magpie.permissions).toEqual(["providers:list"]);
});

test("ships every file the manifest names", () => {
  for (const file of [
    pkg.main,
    pkg.magpie.page.file,
    pkg.magpie.page.icon,
    "ui/index.html",
    "ui/style.css",
    "ui/app.js",
    "ui/account-view.js",
    "README.md",
    "LICENSE",
  ]) {
    expect(existsSync(join(root, file))).toBe(true);
  }
});

// A standalone repository has no community registry.json above it. The topic
// install channel instead requires the manifest to carry its own identity:
// an MIT license and a repository/bugs URL that point at this repository.
test("declares a standalone repository the topic channel can find", () => {
  expect(pkg.license).toBe("MIT");
  expect(pkg.repository.type).toBe("git");
  expect(pkg.repository.url).toBe("git+https://github.com/Gruu6y/magpie-clean-login.git");
  expect(pkg.bugs.url).toBe("https://github.com/Gruu6y/magpie-clean-login/issues");
  expect(pkg.keywords).toContain("magpie-plugin");
});

test("declares npm publish settings for the scoped package", () => {
  // The package name is @gruu6y/page-clean-login — a scoped name defaults to
  // restricted access, so npm publish would 402/403 without access: public.
  // Pin the registry too so a global .npmrc mirror can't redirect the release.
  expect(pkg.publishConfig).toEqual({
    access: "public",
    registry: "https://registry.npmjs.org/",
  });
});

test("declares a tag-triggered npm publish workflow", () => {
  // The tag `v<version>` pushed by merge-release.mjs is what reaches npm; the
  // workflow must exist under exactly this name — npmjs.com's trusted
  // publisher config matches on the workflow filename.
  const file = join(root, ".github/workflows/publish.yml");
  expect(existsSync(file)).toBe(true);
  const yml = readFileSync(file, "utf8");
  expect(yml).toContain("tags:");
  expect(yml).toContain("id-token: write");
  expect(yml).toContain("npm publish");
  // A mis-pushed tag must be caught before publish: the workflow compares the
  // pushed ref against package.json's version.
  expect(yml).toContain("refs/tags/v");
});

test("never hand the model directory to the host through the inert name", () => {
  // fpgen-js reads FPGEN_DATA_DIR. The old code wrote CAMOUFOX_FPGEN_DATA and
  // claimed the forked host read it back; that handoff is not the fix anymore.
  for (const name of readdirSync(join(root, "lib"))) {
    if (!name.endsWith(".mjs")) continue;
    const text = readFileSync(join(root, "lib", name), "utf8");
    expect(text.includes("CAMOUFOX_FPGEN_DATA")).toBe(false);
  }
});
