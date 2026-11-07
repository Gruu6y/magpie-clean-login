import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { GUIDE, guideSections } from "../ui/guide-content.js";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");
const app = readFileSync(join(root, "ui", "app.js"), "utf8");

const LANGS = ["en", "zh-Hans", "zh-Hant", "ja"];

describe("the user guide tab and in-page manual", () => {
  test("static files exist and the module ships in the package", () => {
    expect(existsSync(join(root, "ui", "guide-content.js"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    // Package.json ships "ui" as a folder, so new files under ui/ are published.
    expect(pkg.files).toContain("ui");
  });

  test("the fourth tab and its panel are wired into index.html and app.js", () => {
    expect(html).toContain('id="tab-guide"');
    expect(html).toContain('id="tab-guide-label"');
    expect(html).toContain('id="rail-guide"');
    expect(html).toContain('id="rail-guide-label"');
    expect(html).toContain('id="panel-guide"');
    expect(html).toContain('id="guide-title"');
    expect(html).toContain('id="guide-copy"');
    expect(html).toContain('id="guide-body"');

    // Tab button is type=button, accessible, and has an aria-controls pair.
    expect(html).toMatch(/<button[^>]+id="tab-guide"[^>]+type="button"/);
    expect(html).toContain('aria-controls="panel-guide"');
    expect(html).toContain('aria-labelledby="tab-guide"');

    // Wired into selectTab and click listener.
    expect(app).toContain('["guide", "tab-guide", "panel-guide"]');
    expect(app).toContain('byId("tab-guide").addEventListener("click"');
    expect(app).toContain('byId("rail-guide-label").textContent = text.guide');
    expect(app).toContain('byId("tab-guide-label").textContent = text.guide');
  });

  test("the manual is rendered with DOM nodes and textContent only", () => {
    expect(app).toContain("function renderGuide()");
    expect(app).toContain('document.createElement("section")');
    expect(app).toContain('document.createElement("dl")');
    expect(app).toContain('document.createElement("dt")');
    expect(app).toContain('document.createElement("dd")');
    // Absolute rule: no injection sink.
    expect(app).not.toMatch(/innerHTML/);
    expect(html).not.toMatch(/innerHTML/);
  });

  test("guide-content.js covers all four languages with identical section shapes", () => {
    const langs = ["en", "zh-Hans", "zh-Hant", "ja"];
    expect(Object.keys(GUIDE).sort()).toEqual([...langs].sort());

    const expectedNumbers = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];

    for (const lang of langs) {
      const sections = GUIDE[lang];
      expect(sections.length).toBe(11);
      expect(sections.map((s) => s.n)).toEqual(expectedNumbers);

      for (const section of sections) {
        expect(typeof section.title).toBe("string");
        expect(section.title.length).toBeGreaterThan(0);
        expect(Array.isArray(section.blocks)).toBe(true);
        expect(section.blocks.length).toBeGreaterThan(0);

        for (const block of section.blocks) {
          expect(["p", "ol", "ul", "terms", "note"]).toContain(block.t);
          if (block.t === "p" || block.t === "note") {
            expect(typeof block.text).toBe("string");
            expect(block.text.length).toBeGreaterThan(0);
          } else if (block.t === "ol" || block.t === "ul") {
            expect(Array.isArray(block.items)).toBe(true);
            expect(block.items.length).toBeGreaterThan(0);
            for (const item of block.items) {
              expect(typeof item).toBe("string");
              expect(item.length).toBeGreaterThan(0);
            }
          } else if (block.t === "terms") {
            expect(Array.isArray(block.items)).toBe(true);
            expect(block.items.length).toBeGreaterThan(0);
            for (const item of block.items) {
              expect(typeof item.k).toBe("string");
              expect(typeof item.v).toBe("string");
              expect(item.k.length).toBeGreaterThan(0);
              expect(item.v.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }

    // Unknown language falls back to English.
    expect(guideSections("unknown")).toEqual(GUIDE.en);
    expect(guideSections("fr")).toEqual(GUIDE.en);
    expect(guideSections("zh-Hans")).toEqual(GUIDE["zh-Hans"]);
  });

  test("the manual repeats the who.1ms.dog disclaimer verbatim and keeps the two score sources apart", () => {
    const verbatim = {
      en: "This is a verdict from the third-party site who.1ms.dog. It is not a provider risk-control conclusion, and it is not a fingerprint score of our own.",
      "zh-Hans": "这是第三方站点 who.1ms.dog 的判定，不等于供应商风控结论，也不是我们自建的指纹评分。",
      "zh-Hant": "這是第三方站點 who.1ms.dog 的判定，不等於供應商風控結論，也不是我們自建的指紋評分。",
      ja: "これはサードパーティサイト who.1ms.dog の判定であり、プロバイダーのリスク管理結論でも、独自の指紋スコアでもありません。",
    };

    for (const [lang, want] of Object.entries(verbatim)) {
      const section = GUIDE[lang].find((s) => s.n === "07");
      const note = section.blocks.find((b) => b.t === "note");
      expect(note?.text).toBe(want);

      // Section 04 explicitly names Claude Trust Score and ip.net.coffee.
      const proxySection = GUIDE[lang].find((s) => s.n === "04");
      const proxyNote = proxySection.blocks.find((b) => b.t === "note");
      expect(proxyNote?.text).toContain("ip.net.coffee");
      expect(proxyNote?.text).toContain("Claude Trust Score");
    }
  });

  test("section 01 states why the plugin exists and keeps its boundary", () => {
    // The reason the plugin exists at all: magpie does not hide multi-account
    // use, so a provider can link accounts through sign-in and renewal. The
    // manual says that plainly and then says what the plugin will not do.
    const boundary = {
      en: ["one account, one fingerprint, one exit", "does not bypass verification", "does not register accounts"],
      "zh-Hans": ["一个账号、一个指纹、一个出口", "不绕过任何验证", "不替你注册账号"],
      "zh-Hant": ["一個帳號、一個指紋、一個出口", "不繞過任何驗證", "不替你註冊帳號"],
      ja: ["1 アカウント = 1 指紋 = 1 出口", "認証の回避も", "アカウントの登録も行いません"],
    };

    for (const [lang, phrases] of Object.entries(boundary)) {
      const section = GUIDE[lang].find((s) => s.n === "01");
      expect(section).toBeDefined();
      expect(section.lead).toContain("magpie");
      const prose = [section.lead, ...section.blocks.flatMap((b) => (b.t === "terms" ? b.items.map((i) => `${i.k}${i.v}`) : b.items || b.text || ""))].join("\n");
      for (const phrase of phrases) {
        expect(prose).toContain(phrase);
      }
    }
  });

  test("section 09 points a stuck beginner at the shipped command line", () => {
    for (const lang of Object.keys(GUIDE)) {
      const section = GUIDE[lang].find((s) => s.n === "09");
      expect(section).toBeDefined();
      const prose = [section.lead, ...section.blocks.flatMap((b) => b.items || b.text || "")].join("\n");
      // The real entry point, not a promise of one.
      expect(prose).toContain("clean-login.mjs");
      expect(prose).toContain("--wait");
      expect(prose.toLowerCase()).toContain("agent");
    }
  });

  test("the guide intro counts the sections it actually renders", () => {
    // A number in the intro is a claim about the manual. It went stale once
    // when sections were added, so the count is derived from GUIDE, not typed.
    const spoken = { en: ["eleven", 11], "zh-Hans": ["十一节", 11], "zh-Hant": ["十一節", 11], ja: ["11 項目", 11] };
    const copies = [...app.matchAll(/guideCopy: "([^"]+)"/g)].map((m) => m[1]);
    expect(copies.length).toBe(4);
    LANGS.forEach((lang, index) => {
      const [word, number] = spoken[lang];
      expect(GUIDE[lang].length).toBe(number);
      expect(copies[index]).toContain(word);
    });
  });

  test("hosts in the manual are written without schemes to stay safe in a sandboxed page", () => {
    const content = readFileSync(join(root, "ui", "guide-content.js"), "utf8");
    // Index.html has strict tests against http(s)://; the guide follows the
    // same rule so it cannot appear to invite clicks from an iframe.
    expect(content).not.toMatch(/https?:\/\//);
  });

  test("styles define the guide typography and mobile fallback using existing tokens", () => {
    expect(css).toContain(".guide-section");
    expect(css).toContain(".guide-num");
    expect(css).toContain(".guide-main");
    expect(css).toContain(".guide-lead");
    expect(css).toContain(".guide-steps");
    expect(css).toContain(".guide-terms");
    expect(css).toContain(".guide-note");
    // Uses tokens, not arbitrary hexes.
    expect(css).toContain("color: var(--red)");
    expect(css).toContain("font: 500 11px/1.9 var(--mono)");
    // Mobile query stacks the number above the heading.
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*?\.guide-section\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
