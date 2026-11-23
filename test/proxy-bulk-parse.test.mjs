// Headless checks for client-side bulk proxy parsing in ui/proxy-state.js.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROXY_BULK_LIMIT,
  parseBulkProxies,
  proxyConnectionKey,
} from "../ui/proxy-state.js";

const root = join(import.meta.dir, "..");

test("ui/proxy-state.js keeps zero DOM and zero ../lib imports", () => {
  const source = readFileSync(join(root, "ui", "proxy-state.js"), "utf8");
  expect(source).not.toMatch(/\.\.\/lib\//);
  expect(source).not.toContain("document.");
});

test("parseBulkProxies parses mixed schemes, host:port, user:pass, IPv6, piped names, and comments", () => {
  const text = [
    "# comment line",
    "// slash comment",
    "",
    "socks5://alice:secret@10.0.0.1:1080#HK-SOCKS",
    "HK-Pipe|https://bob:pass@10.0.0.2:8443",
    "10.0.0.3:8080 US-HTTP",
    "10.0.0.4:3128:user4:pass4",
    "[2001:db8::1]:9000",
    "10.0.0.5",
  ].join("\n");

  const parsed = parseBulkProxies(text, { defaultType: "http", prefix: "Edge" });
  expect(PROXY_BULK_LIMIT).toBe(200);
  expect(parsed.items).toEqual([
    {
      name: "Edge HK-SOCKS",
      type: "socks5",
      host: "10.0.0.1",
      port: 1080,
      username: "alice",
      password: "secret",
    },
    {
      name: "Edge HK-Pipe",
      type: "https",
      host: "10.0.0.2",
      port: 8443,
      username: "bob",
      password: "pass",
    },
    {
      name: "Edge US-HTTP",
      type: "http",
      host: "10.0.0.3",
      port: 8080,
      username: "",
      password: "",
    },
    {
      name: "Edge-10.0.0.4:3128",
      type: "http",
      host: "10.0.0.4",
      port: 3128,
      username: "user4",
      password: "pass4",
    },
    {
      name: "Edge-[2001:db8::1]:9000",
      type: "http",
      host: "2001:db8::1",
      port: 9000,
      username: "",
      password: "",
    },
  ]);
  expect(parsed.invalid).toEqual([{ line: 9, reason: "invalid_port" }]);
  expect(parsed.duplicates).toEqual([]);
  expect(parsed.truncated).toBe(0);
});

test("parseBulkProxies honors defaultType, deduplicates connections, disambiguates names, and caps at limit", () => {
  const existing = {
    type: "socks5",
    host: "127.0.0.1",
    port: 1080,
    username: "",
  };
  const text = [
    "127.0.0.1:1080",
    "127.0.0.2:1080 SameLabel",
    "127.0.0.3:1080 SameLabel",
    "127.0.0.4:1080 Extra",
  ].join("\n");

  const parsed = parseBulkProxies(text, {
    defaultType: "socks5",
    existingNames: ["SameLabel"],
    existingKeys: [proxyConnectionKey(existing)],
    limit: 2,
  });

  expect(parsed.duplicates).toEqual([{ line: 1, reason: "duplicate" }]);
  expect(parsed.items.map((item) => item.name)).toEqual(["SameLabel-2", "SameLabel-3"]);
  expect(parsed.items.every((item) => item.type === "socks5")).toBe(true);
  expect(parsed.truncated).toBe(1);
});
