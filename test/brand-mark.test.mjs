import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const html = read("ui/index.html");
const css = read("ui/style.css");
const pkg = JSON.parse(read("package.json"));

function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start));
}

describe("the editorial nameplate mark", () => {
  test("the page draws the mark inline instead of loading a theme-blind image", () => {
    // A currentColor mark inside an <img> resolves to black regardless of the
    // theme magpie passes to the page, so the wordmark has to live in the DOM.
    expect(html).not.toContain('src="assets/icon.svg"');
    expect(html).toContain('id="brand-mark-cl"');
    expect(html).toContain('id="brand-mark-rule"');
    expect((html.match(/class="brand-icon"/g) || []).length).toBe(1);
    // Every empty state keeps its mark (providers, proxies, accounts, assets).
    expect((html.match(/class="empty-mark"/g) || []).length).toBe(4);
  });

  test("ink and vermilion come from the theme tokens, not baked-in hexes", () => {
    expect(rule(".brand-icon")).toContain("color: var(--ink)");
    expect(css).toContain(".brand-mark-cl { color: inherit; }");
    expect(css).toContain(".brand-mark-rule { color: var(--red); }");
    const defs = html.slice(html.indexOf("brand-mark-cl"), html.indexOf("</defs>"));
    expect(defs).toContain('fill="currentColor"');
    expect(defs).not.toMatch(/#[0-9a-f]{3,8}/i);
    // The empty-state tile still uses the same hairline nameplate styling.
    expect(css).toContain(".empty img,\n.empty-mark {");
  });

  test("the rail icon lives inside page/ so magpie will serve it", () => {
    // magpie drops a page icon whose path escapes page/; that is why the old
    // assets/icon.svg entry showed a fallback glyph in the sidebar.
    const icon = pkg.magpie.page.icon;
    expect(icon.startsWith("page/")).toBe(true);
    expect(icon).not.toContain("..");
    expect(existsSync(join(root, icon))).toBe(true);
  });

  test("the rail icon stays line art, with no plate that only suits one theme", () => {
    const svg = read(pkg.magpie.page.icon);
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).not.toMatch(/fill="(?!none")/);
    expect(svg).toContain("stroke=");
    expect(svg).not.toContain("currentColor");
  });

  test("the marketplace icon keeps its opaque plate and self-contained colours", () => {
    expect(pkg.magpie.icon).toMatch(/^https:\/\//);
    const svg = read("assets/icon.svg");
    expect(svg).toContain('viewBox="0 0 128 128"');
    expect(svg).toMatch(/<rect width="128" height="128" fill="#/);
    expect(svg).not.toContain("currentColor");
    expect(svg).not.toContain("<image");
  });
});
