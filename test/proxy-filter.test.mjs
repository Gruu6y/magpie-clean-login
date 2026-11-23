// Pure client-side filtering for the Proxy IPs table: the distinct-region
// counts, the multi-select plus latency range, and the read-file wiring of the
// filter bar. No DOM is needed.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KEYWORD_TAGS,
  distinctKeywords,
  distinctRegions,
  filterProxies,
  hasKeyword,
  latencyBound,
  proxyName,
  regionKey,
  sortProxies,
} from "../ui/proxy-filter.js";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");

const proxies = [
  { id: "a", region: "中国/香港", latency: 120 },
  { id: "b", region: "日本/东京", latency: 45 },
  { id: "c", region: "中国/香港", latency: 260 },
  { id: "d", region: "", latency: null },
  { id: "e", region: "  ", latency: 90 },
  { id: "f", region: "日本/东京", latency: 45 },
];

test("distinctRegions counts each region and keeps untested apart and last", () => {
  expect(distinctRegions(proxies)).toEqual([
    { region: "中国/香港", count: 2 },
    { region: "日本/东京", count: 2 },
    { region: "", count: 2 },
  ]);
  // An absent or malformed list degrades to no regions instead of throwing.
  expect(distinctRegions()).toEqual([]);
  expect(distinctRegions([null, undefined, {}])).toEqual([{ region: "", count: 1 }]);
});

test("regionKey trims and tolerates missing regions", () => {
  expect(regionKey({ region: "  Japan  " })).toBe("Japan");
  expect(regionKey({ region: "" })).toBe("");
  expect(regionKey({})).toBe("");
  expect(regionKey()).toBe("");
});

test("filterProxies with no filter returns every proxy", () => {
  expect(filterProxies(proxies)).toEqual(proxies);
  expect(filterProxies(proxies, { regions: [], minLatency: "", maxLatency: "" })).toEqual(proxies);
});

test("regions are a multi-select and the untested region can stand alone", () => {
  const hongKong = filterProxies(proxies, { regions: ["中国/香港"] }).map((p) => p.id);
  expect(hongKong).toEqual(["a", "c"]);
  const both = filterProxies(proxies, { regions: ["中国/香港", "日本/东京"] }).map((p) => p.id);
  expect(both).toEqual(["a", "b", "c", "f"]);
  // Empty string selects only rows that have never been tested (region "").
  expect(filterProxies(proxies, { regions: [""] }).map((p) => p.id)).toEqual(["d", "e"]);
});

test("latency bounds apply only to numeric latencies and exclude null rows", () => {
  expect(filterProxies(proxies, { minLatency: 100 }).map((p) => p.id)).toEqual(["a", "c"]);
  expect(filterProxies(proxies, { maxLatency: 100 }).map((p) => p.id)).toEqual(["b", "e", "f"]);
  expect(filterProxies(proxies, { minLatency: 45, maxLatency: 120 }).map((p) => p.id)).toEqual(["a", "b", "e", "f"]);
  // A single bound still excludes the unknown-latency row.
  expect(filterProxies(proxies, { minLatency: 0 }).map((p) => p.id)).toEqual(["a", "b", "c", "e", "f"]);
});

test("region and latency filters combine", () => {
  const result = filterProxies(proxies, {
    regions: ["日本/东京"],
    minLatency: 50,
    maxLatency: 200,
  });
  expect(result.map((p) => p.id)).toEqual([]);
});

test("latencyBound ignores empty and nonsense input", () => {
  expect(latencyBound("")).toBeNull();
  expect(latencyBound("   ")).toBeNull();
  expect(latencyBound(null)).toBeNull();
  expect(latencyBound(undefined)).toBeNull();
  expect(latencyBound("abc")).toBeNull();
  expect(latencyBound(0)).toBe(0);
  expect(latencyBound("120")).toBe(120);
  expect(latencyBound(45.5)).toBe(45.5);
});

// The exit tags an operator types are only ever in the name, so the keyword
// filter reads the name. These fixtures mirror the real list (R1-1|香港-NF|HKT家宽).
const tagged = [
  { id: "k1", name: "R1-1|香港-NF|HKT家宽", region: "中国/香港", latency: 100 },
  { id: "k2", name: "R2-1|台湾-NF|HKT家宽", region: "中国/台湾", latency: 200 },
  { id: "k3", name: "R3-1|日本-NF|静态", region: "日本/东京", latency: 300 },
  { id: "k4", name: "R4-1|美国-NF|原生", region: "美国/加利福尼亚", latency: 400 },
  { id: "k5", name: "R5-1|nf|家宽", region: "美国/加利福尼亚", latency: 500 },
  { id: "k6", region: "", latency: null },
];

test("hasKeyword reads the name and ignores case", () => {
  expect(proxyName({ name: "R1-1|HKT家宽" })).toBe("R1-1|HKT家宽");
  expect(proxyName({})).toBe("");
  expect(proxyName()).toBe("");
  expect(hasKeyword({ name: "R1-1|香港-NF|HKT家宽" }, "家宽")).toBe(true);
  expect(hasKeyword({ name: "R1-1|香港-NF|HKT家宽" }, "静态")).toBe(false);
  // NF and nf are the same tag in practice, so the match must ignore case.
  expect(hasKeyword({ name: "R5-1|nf|家宽" }, "NF")).toBe(true);
  expect(hasKeyword({ name: "" }, "家宽")).toBe(false);
  expect(hasKeyword({}, "家宽")).toBe(false);
  // A missing name or keyword never throws and never matches.
  expect(hasKeyword(undefined, "家宽")).toBe(false);
  expect(hasKeyword({ name: "家宽" }, "")).toBe(false);
  expect(hasKeyword({ name: "家宽" }, undefined)).toBe(false);
});

test("distinctKeywords counts each curated tag in the declared order", () => {
  expect(distinctKeywords(tagged)).toEqual([
    { keyword: "家宽", count: 3 },
    { keyword: "静态", count: 1 },
  ]);
  // A zero count is still returned; the page decides whether to render it.
  expect(distinctKeywords([])).toEqual([
    { keyword: "家宽", count: 0 },
    { keyword: "静态", count: 0 },
  ]);
  expect(distinctKeywords()).toEqual([
    { keyword: "家宽", count: 0 },
    { keyword: "静态", count: 0 },
  ]);
  expect(Object.isFrozen(KEYWORD_TAGS)).toBe(true);
});

test("keywords are an OR group that ANDs with regions and latency", () => {
  expect(filterProxies(tagged, { keywords: ["家宽"] }).map((p) => p.id)).toEqual(["k1", "k2", "k5"]);
  expect(filterProxies(tagged, { keywords: ["静态"] }).map((p) => p.id)).toEqual(["k3"]);
  // Two selected tags are a union, not an intersection.
  expect(filterProxies(tagged, { keywords: ["家宽", "静态"] }).map((p) => p.id)).toEqual([
    "k1",
    "k2",
    "k3",
    "k5",
  ]);
  // An unknown tag matches nothing rather than everything.
  expect(filterProxies(tagged, { keywords: ["不存在"] }).map((p) => p.id)).toEqual([]);
  // Keywords combine with the region and latency filters.
  expect(
    filterProxies(tagged, { keywords: ["家宽"], regions: ["美国/加利福尼亚"] }).map((p) => p.id),
  ).toEqual(["k5"]);
  expect(filterProxies(tagged, { keywords: ["家宽"], minLatency: 150 }).map((p) => p.id)).toEqual([
    "k2",
    "k5",
  ]);
});

// The filter bar is asserted against the real markup, not against indentation.
// `htmlDivById` returns the outer HTML of the first <div> carrying the id, with
// nested divs balanced. `jsFunctionBody` returns a top-level function's body
// (string literals and comments skipped) so the chip wiring is asserted where
// it actually lives.
function htmlDivById(source, id) {
  const open = new RegExp(`<div\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(source);
  if (!open) return "";
  const tags = /<div\b[^>]*>|<\/div\s*>/gi;
  tags.lastIndex = open.index;
  let depth = 0;
  let match;
  while ((match = tags.exec(source)) !== null) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return source.slice(open.index, tags.lastIndex);
  }
  return "";
}

function jsFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return "";
  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) return "";
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const character = source[i];
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (character === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i + 2);
      i = newline === -1 ? source.length : newline;
      continue;
    }
    if (character === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 1;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  return "";
}

test("the filter bar is wired to the pure helpers and every chip is a button", () => {
  const renderList = jsFunctionBody(app, "renderProxies");
  const renderChips = jsFunctionBody(app, "renderFilterChips");
  const renderKeywords = jsFunctionBody(app, "renderKeywordChips");
  const reset = jsFunctionBody(app, "resetProxyFilters");
  expect(renderList).not.toBe("");
  expect(renderChips).not.toBe("");
  expect(renderKeywords).not.toBe("");
  expect(reset).not.toBe("");

  // The list uses the pure filter; the chips come from the pure helpers.
  expect(renderList).toContain("filterProxies(proxies, proxyFilter)");
  expect(renderList).toContain("renderFilterChips()");
  expect(renderChips).toContain("distinctRegions(proxies)");
  expect(renderChips).toContain('byId("filter-regions")');
  // The keyword chips have their own function, so each factory keeps exactly
  // the two buttons it owns: the "All" chip and one tile per value.
  expect(renderChips).toContain("renderKeywordChips()");
  expect(renderKeywords).toContain("distinctKeywords(proxies)");
  expect(renderKeywords).toContain('byId("filter-keywords")');
  expect(renderKeywords).toContain('byId("filter-keyword-group")');

  // Exactly two button factories per group. All of them are
  // <button type="button"> appended to their group's chip wrap.
  expect(renderChips.match(/document\.createElement\("button"\)/g) ?? []).toHaveLength(2);
  expect(renderKeywords.match(/document\.createElement\("button"\)/g) ?? []).toHaveLength(2);
  expect(renderChips).toContain('all.type = "button"');
  expect(renderChips).toContain('chip.type = "button"');
  expect(renderKeywords).toContain('all.type = "button"');
  expect(renderKeywords).toContain('chip.type = "button"');
  expect(renderChips).toContain("wrap.append(all)");
  expect(renderChips).toContain("wrap.append(chip)");
  expect(renderKeywords).toContain("wrap.append(all)");
  expect(renderKeywords).toContain("wrap.append(chip)");
  expect(renderChips).not.toContain('createElement("a")');
  expect(renderChips).not.toContain('createElement("input")');
  expect(renderChips).not.toContain('type = "submit"');
  expect(renderKeywords).not.toContain('createElement("a")');
  expect(renderKeywords).not.toContain('type = "submit"');

  expect(reset).toContain("proxyFilter.regions.clear()");
  expect(reset).toContain("proxyFilter.keywords.clear()");
  expect(reset).toContain('byId("filter-latency-min").value = ""');
  expect(reset).toContain('byId("filter-latency-max").value = ""');
  expect(reset).toContain("renderProxies()");

  const filterBar = htmlDivById(html, "proxy-filters");
  expect(filterBar).not.toBe("");
  // The chip containers are empty markup: every chip is built as a button in JS.
  expect(filterBar).toMatch(/<div class="filter-chips" id="filter-regions"><\/div>/);
  expect(filterBar).toMatch(/<div class="filter-chips" id="filter-keywords"><\/div>/);
  expect(filterBar).toContain('id="filter-keyword-label"');
  expect(filterBar).toContain('id="filter-keyword-group"');
  expect(filterBar).toContain('id="filter-latency-min"');
  expect(filterBar).toContain('id="filter-latency-max"');
  expect(filterBar).toContain('id="filter-count"');
  expect(filterBar).not.toContain('type="submit"');
  expect(filterBar).not.toContain("<form");

  const resetTag = /<button\b[^>]*\bid="filter-reset"[^>]*>/.exec(filterBar)?.[0] ?? "";
  expect(resetTag).toContain('type="button"');
  expect(html.indexOf('id="proxy-filters"')).toBeLessThan(html.indexOf('id="proxy-score-bar"'));
});

test("the table shows a filtered count and an explicit no-match note", () => {
  expect(app).toContain("text.filterCount");
  expect(app).toContain("text.filterNoMatch");
  expect(app).toContain('byId("filter-count").textContent');
});

test("filter state is in memory, never localStorage", () => {
  expect(app).not.toContain("localStorage");
  expect(app).not.toContain("sessionStorage");
  expect(app).toContain('regions: new Set()');
  expect(app).toContain('keywords: new Set()');
});

test("filterProxies supports search, status, usage filtering and sortProxies preserves input", () => {
  const rows = [
    { id: "p1", name: "HK-1", type: "http", host: "10.0.0.1", port: 8080, region: "香港", exitIp: "1.1.1.1", status: "ok", latency: 120, score: 75 },
    { id: "p2", name: "JP-2", type: "socks5", host: "10.0.0.2", port: 1080, region: "日本", exitIp: "2.2.2.2", status: "error", latency: null, score: 92 },
    { id: "p3", name: "US-10", type: "https", host: "10.0.0.3", port: 443, region: "", exitIp: "", status: "untested", latency: 45, score: null },
  ];
  const usedIds = new Set(["p2"]);

  expect(filterProxies(rows, { search: "10.0.0.2" }).map((p) => p.id)).toEqual(["p2"]);
  expect(filterProxies(rows, { search: "香港 socks5" })).toEqual([]);
  expect(filterProxies(rows, { status: "ok" }).map((p) => p.id)).toEqual(["p1"]);
  expect(filterProxies(rows, { status: "error" }).map((p) => p.id)).toEqual(["p2"]);
  expect(filterProxies(rows, { usage: "used", usedIds }).map((p) => p.id)).toEqual(["p2"]);
  expect(filterProxies(rows, { usage: "unused", usedIds }).map((p) => p.id)).toEqual(["p1", "p3"]);

  expect(sortProxies(rows, "latency").map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  expect(sortProxies(rows, "score").map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
  expect(sortProxies(rows, "usage", { usageCounts: { p3: 3, p1: 1 } }).map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
  expect(rows.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
});
