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
    for (const shot of ["providers", "proxies", "accounts"]) {
      expect(markdown).toContain(`assets/screenshot-${shot}.png`);
    }
  }
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