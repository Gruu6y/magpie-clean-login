// The one place the service hands a URL to the operating system. These tests
// assert the shape of that hand-off: an allowlist before anything spawns, a
// single argv entry instead of a shell string, and no wait on a GUI program.

import { EventEmitter } from "node:events";
import { expect, test } from "bun:test";
import { describeOpen, isAllowedSignInUrl, openCommand, openExternal } from "../lib/open-external.mjs";
import { ISSUE_NEW_URL } from "../lib/issue-report.mjs";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.unrefed = false;
  }
  unref() {
    this.unrefed = true;
  }
}

function fakeSpawn(outcome = "spawn") {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    queueMicrotask(() => {
      if (outcome === "error") child.emit("error", new Error("spawn ENOENT"));
      else child.emit("spawn");
    });
    return child;
  };
  return { spawnImpl, calls };
}

const url = `${ISSUE_NEW_URL}?title=a&body=b%20c`;

test("each platform gets its own opener, and the URL is one argv entry", () => {
  expect(openCommand("win32", url)).toEqual({ command: "explorer.exe", args: [url] });
  expect(openCommand("darwin", url)).toEqual({ command: "open", args: [url] });
  expect(openCommand("linux", url)).toEqual({ command: "xdg-open", args: [url] });
  // The query string is passed through untouched: `&` must not become a shell
  // separator, which is why win32 does not go through `cmd /c start`.
  expect(openCommand("win32", url).args).toHaveLength(1);
  expect(describeOpen("linux", url)).toBe(`xdg-open ${url}`);
});

test("a URL outside the allowlist never reaches spawn", async () => {
  const { spawnImpl, calls } = fakeSpawn();
  for (const bad of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://github.com/someone-else/clean-login/issues/new",
    "https://github.com/Gruu6y/magpie-clean-login/issues",
  ]) {
    await expect(openExternal(bad, { spawnImpl })).rejects.toMatchObject({
      code: "url-not-allowed",
      status: 400,
    });
  }
  expect(calls).toHaveLength(0);
});

test("the allowed URL is spawned detached and unreferenced", async () => {
  const { spawnImpl, calls } = fakeSpawn("spawn");
  const opened = await openExternal(url, { spawnImpl, platform: "win32" });
  expect(opened).toMatchObject({ ok: true, command: "explorer.exe", url });
  expect(calls).toHaveLength(1);
  expect(calls[0].command).toBe("explorer.exe");
  expect(calls[0].args).toEqual([url]);
  expect(calls[0].options).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true });
});

test("a spawn failure becomes a readable 502, not an unhandled error", async () => {
  const { spawnImpl } = fakeSpawn("error");
  await expect(openExternal(url, { spawnImpl })).rejects.toMatchObject({
    code: "spawn-failed",
    status: 502,
  });
});

test("the native sign-in door opens a provider's https sign-in page", async () => {
  const { spawnImpl, calls } = fakeSpawn();
  const oauth = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A1455&state=s";
  // The issue-report default still refuses it: that path is not widened.
  await expect(openExternal(oauth, { spawnImpl })).rejects.toMatchObject({ code: "url-not-allowed" });
  expect(calls).toHaveLength(0);
  const opened = await openExternal(oauth, { spawnImpl, platform: "linux", allowAnyHttps: true });
  expect(opened).toEqual({ ok: true, command: "xdg-open", url: oauth });
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual([oauth]);
});

test("allowAnyHttps still refuses every non-https or credentialed URL", async () => {
  const { spawnImpl, calls } = fakeSpawn();
  for (const bad of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://accounts.google.com/o/oauth2/auth",
    "https://user:pass@accounts.google.com/",
    "data:text/html,<script>1</script>",
    "not a url",
    "",
  ]) {
    expect(isAllowedSignInUrl(bad)).toBe(false);
    await expect(openExternal(bad, { spawnImpl, allowAnyHttps: true })).rejects.toMatchObject({
      code: "url-not-allowed",
      status: 400,
    });
  }
  expect(isAllowedSignInUrl(undefined)).toBe(false);
  expect(calls).toHaveLength(0);
});
