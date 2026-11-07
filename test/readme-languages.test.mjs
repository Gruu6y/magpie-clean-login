import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The README is the front door. Most readers arrive speaking Chinese, so the
// default file must be Chinese and the English one must stay reachable -- and
// neither may rot into dead links or a table of contents that goes nowhere.
const root = join(import.meta.dir, "..");
const read = (name) => readFileSync(join(root, name), "utf8").replaceAll("\r\n", "\n");
const zh = read("README.md");
const en = read("README.en.md");

// GitHub turns "## Command line and agents" into #command-line-and-agents.
// Explicit <a id="..."> anchors win, which is what the Chinese file uses.
function anchorsOf(markdown) {
  const ids = new Set();
  for (const match of markdown.matchAll(/<a\s+id="([^"]+)"\s*><\/a>/g)) ids.add(match[1]);
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    ids.add(
      match[1]
        .toLowerCase()
        .replace(/[`*_]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-"),
    );
  }
  return ids;
}

// Every markdown link target, ignoring the image inside a badge.
function targetsOf(markdown) {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

test("the default README is Chinese and the English one is one click away", () => {
  expect(zh).toContain("**简体中文** · [English](README.en.md)");
  expect(en).toContain("[简体中文](README.md) · **English**");
  // The default file really is Chinese prose, not an English page with a
  // translated title.
  expect(zh).toContain("## 为什么用它");
  expect(zh).toContain("## 快速开始");
  expect(zh).toContain("## 排查问题");
  expect(en).toContain("## Why");
  expect(en).toContain("## Quick start");
});

test("both READMEs keep the same title, badges and screenshots", () => {
  for (const markdown of [zh, en]) {
    expect(markdown.startsWith("# Magpie Clean Login · 干净登录\n")).toBe(true);
    expect(markdown).toContain("img.shields.io/github/v/tag/Gruu6y/magpie-clean-login");
    expect(markdown).toContain("actions/workflows/ci.yml/badge.svg");
    for (const shot of ["providers", "proxies", "accounts", "guide"]) {
      expect(markdown).toContain(`assets/screenshot-${shot}.png`);
    }
  }
});

// The screenshots show invented accounts on documentation-reserved IPs. That
// is fine -- publishing a real user's accounts and exits would not be -- but
// only while the page says so. A future edit must not be able to quietly drop
// the disclosure and let demo data read as somebody's real setup.
test("both READMEs disclose that the screenshot records are demo data", () => {
  expect(zh).toContain("演示数据");
  expect(en).toContain("demo data");
  for (const markdown of [zh, en]) {
    // The reserved ranges themselves, so the claim is checkable, not vague.
    expect(markdown).toContain("203.0.113");
    expect(markdown).toContain("198.51.100");
    expect(markdown).toContain("192.0.2");
    // And the generator, so a reader can reproduce the images rather than
    // take the claim on trust.
    expect(markdown).toContain("scripts/shoot-readme-screenshots.mjs");
  }
  expect(existsSync(join(root, "scripts/shoot-readme-screenshots.mjs"))).toBe(true);
  for (const shot of ["providers", "proxies", "accounts", "guide"]) {
    expect(existsSync(join(root, "assets", `screenshot-${shot}.png`)), `screenshot-${shot}.png`).toBe(true);
  }
});

// The generator must not become a way to publish somebody's real setup: it
// seeds only reserved ranges and demo credentials, and it writes into a
// throwaway directory rather than the user's config.
test("the screenshot generator seeds reserved ranges into a throwaway directory", () => {
  const source = read("scripts/shoot-readme-screenshots.mjs");
  expect(source).toContain("mkdtempSync");
  expect(source).toContain("MAGPIE_CLEAN_LOGIN_DATA");
  expect(source).toContain("MAGPIE_CONFIG_DIR");
  expect(source).toContain("not-a-real-password");
  expect(source).toContain("demo-not-a-real-token");
  for (const range of ["203.0.113.", "198.51.100.", "192.0.2."]) {
    expect(source).toContain(range);
  }
  // It renders the shipped page; it must not assemble its own markup.
  expect(source).toContain("startServer");
  expect(source).not.toContain("setContent");
  expect(source).not.toContain("innerHTML");
});

// The login-browser panel prints two strings straight off the machine: the
// install path and the free space on its volume. Left alone, a regenerated
// screenshot publishes the OS account name (C:\Users\<name>\...) and how full
// the author's drive is. The generator must therefore drive that panel through
// the operator seam with a neutral root and a supplied free-byte figure, and
// both READMEs must say those two values are neutral rather than real.
test("the browser panel in the screenshots cannot publish the generating machine", () => {
  const source = read("scripts/shoot-readme-screenshots.mjs");
  // The seam, not a hand-drawn panel: the shipped manager still computes the
  // badge, the download size and the required space.
  expect(source).toContain("createEnvironmentManager");
  expect(source).toContain("freeBytes: NEUTRAL_FREE_BYTES");
  expect(source).toContain("root: browserRoot");
  // A shared, machine-neutral base -- never the user's own profile directory.
  expect(source).toContain('"C:/Users/Public"');
  expect(source).not.toContain("LOCALAPPDATA");
  // And it refuses to publish a path that still names an account.
  expect(source).toContain("machine-specific path");
  for (const markdown of [zh, en]) {
    expect(markdown).toContain("C:\\Users\\Public");
    expect(markdown).toContain("256 GB");
  }
  expect(zh).toContain("中性值");
  expect(en).toContain("neutral values");
});

test("every relative link in either README points at a file that exists", () => {
  for (const [name, markdown] of [["README.md", zh], ["README.en.md", en]]) {
    for (const target of targetsOf(markdown)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, ...
      if (target.startsWith("#")) continue; // checked below
      const path = target.split("#")[0];
      expect(existsSync(join(root, path)), `${name} -> ${target}`).toBe(true);
    }
  }
});

test("every in-page link lands on a real heading or anchor", () => {
  for (const [name, markdown] of [["README.md", zh], ["README.en.md", en]]) {
    const ids = anchorsOf(markdown);
    const inPage = targetsOf(markdown).filter((target) => target.startsWith("#"));
    expect(inPage.length, `${name} has a table of contents`).toBeGreaterThan(5);
    for (const target of inPage) {
      expect(ids.has(decodeURIComponent(target.slice(1))), `${name} -> ${target}`).toBe(true);
    }
  }
});

test("the two languages carry the same factual limits", () => {
  // A translation that quietly drops a platform or a disk figure is worse than
  // no translation, so the load-bearing numbers are pinned in both files.
  for (const markdown of [zh, en]) {
    expect(markdown).toContain("Windows x64");
    expect(markdown).toContain("1.4.2");
    expect(markdown).toContain("170 MB");
    expect(markdown).toContain("616 MB");
    expect(markdown).toContain("1.02 GB");
    expect(markdown).toContain("127.0.0.1:3492");
    expect(markdown).toContain("MAGPIE_CLEAN_LOGIN_DATA");
    expect(markdown).toContain("MAGPIE_CLEAN_LOGIN_BROWSER_DIR");
    expect(markdown).toContain("ip.net.coffee/claude");
    expect(markdown).toContain("who.1ms.dog");
    expect(markdown).toContain("GET /api/agent");
    expect(markdown).toContain("?wait=<ms>");
  }
});

// A rewrite for beginners must not quietly drop a feature that already ships.
// "Renew fingerprint" is the one that is easy to lose, because the whole point
// of the page is that identities are KEPT -- so the escape hatch has to be
// spelled out, in both languages, under the label the UI actually uses.
test("both READMEs still document renewing a fingerprint", () => {
  expect(zh).toContain("更换指纹");
  expect(en).toContain("Renew fingerprint");
  const app = read("ui/app.js");
  // The labels above must be the shipped ones, not invented prose.
  expect(app).toContain('accountRotate: "Renew fingerprint"');
  expect(app).toContain('accountRotate: "更换指纹"');
  // And the distinction that makes the feature understandable: an ordinary
  // sign-in again keeps the old fingerprint.
  expect(zh).toContain("沿用旧指纹");
  expect(en).toContain("reuses the old fingerprint");
});