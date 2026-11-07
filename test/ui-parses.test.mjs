import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

// Every file the package ships, listed from the directories that hold them.
// `ui/` and `page/` are what a browser runs; `lib/`, `bin/` and `index.mjs` are
// the service. A browser only ever loads one module here (`ui/index.html` ->
// `ui/app.js`), so a single stray character in that file does not fail one
// feature: the page parses as nothing and every tab is blank.
// Slashes are written out rather than built with `join`, because this list is
// compared against strings in `ui/index.html` and asserted with `toContain`:
// on Windows `join` would produce `ui\app.js` and the guard would fail for a
// reason that has nothing to do with the file it names.
const listed = (dir, extension) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith(extension))
    .map((name) => `${dir}/${name}`);

const SHIPPED = [
  ...listed("ui", ".js"),
  ...listed("page", ".js"),
  ...listed("lib", ".mjs"),
  ...listed("bin", ".mjs"),
  "index.mjs",
];

// Reading the source is not the same as loading it. Most UI tests open
// `ui/app.js` as text and assert on the strings inside, which passes happily on
// a file no engine will parse -- a duplicated comma between two keys is
// invisible to `includes()`. So parse the real bytes instead, and do not
// execute them: the browser modules want a `document` and `location` that a
// test run does not have, and an executed UI module would fail for reasons that
// have nothing to do with syntax.
const transpiler = new Bun.Transpiler({ loader: "js" });

function parseError(file) {
  try {
    transpiler.transformSync(readFileSync(join(root, file), "utf8"));
    return null;
  } catch (error) {
    return String(error?.message ?? error).split("\n")[0];
  }
}

describe("shipped source parses", () => {
  test("the guard covers the files a user actually loads", () => {
    // Losing a directory from SHIPPED would silently un-guard the UI, so the
    // inventory itself is pinned: the browser entry point and the service entry
    // point must both be in the list.
    expect(SHIPPED).toContain("ui/app.js");
    expect(SHIPPED).toContain("page/boot.js");
    expect(SHIPPED).toContain("index.mjs");
    expect(SHIPPED.length).toBeGreaterThan(20);
  });

  test("every shipped module is syntactically loadable", () => {
    const broken = SHIPPED.map((file) => [file, parseError(file)]).filter(([, e]) => e);
    expect(broken.map(([file, error]) => `${file}: ${error}`)).toEqual([]);
  });

  test("the page loads exactly the modules that exist on disk", () => {
    const html = readFileSync(join(root, "ui", "index.html"), "utf8");
    const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(SHIPPED).toContain(`ui/${src}`);
    }
  });
});
