import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  NATIVE_SIGNIN_STATES,
  NativeSignInError,
  createNativeSignIn,
  magpieCli,
  normalizeAgent,
  readNativeLine,
  stripAnsi,
} from "../lib/native-signin.mjs";

// A stand-in for `magpie accounts add`: the flow under test only ever talks to
// it through stdout, stderr, stdin and the close event, so a plain emitter with
// two pass-through streams is enough and no magpie is started.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.written = [];
  child.killed = false;
  child.stdin = {
    write(chunk) {
      child.written.push(String(chunk));
      return true;
    },
  };
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

function harness({ openUrl = null } = {}) {
  const children = [];
  const spawn = () => {
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const controller = createNativeSignIn({ spawn, openUrl, timeoutMs: 60_000, cli: "magpie" });
  const say = (index, text) => children[index].stdout.write(text);
  const end = (index, code = 0) => children[index].emit("close", code);
  return { controller, children, say, end, spawn };
}

test("the state list covers the whole lifecycle", () => {
  expect([...NATIVE_SIGNIN_STATES]).toEqual([
    "starting",
    "waiting",
    "paste-required",
    "done",
    "error",
    "cancelled",
  ]);
});

test("an agent id reaches an argument list, so only a slug is accepted", () => {
  expect(normalizeAgent("antigravity")).toBe("antigravity");
  expect(normalizeAgent("  Codex ")).toBe("codex");
  expect(normalizeAgent("workbuddy-ai")).toBe("workbuddy-ai");
  for (const bad of ["", null, undefined, 7, "a b", "-x", "x;rm -rf /", "x\u0000", "a".repeat(65)]) {
    expect(normalizeAgent(bad)).toBeNull();
  }
});

test("the command line is magpie, overridable for a machine that keeps it elsewhere", () => {
  expect(magpieCli({ MAGPIE_CLI: "" })).toMatch(/^magpie(\.exe)?$/);
  expect(magpieCli({ MAGPIE_CLI: " /opt/magpie " })).toBe("/opt/magpie");
});

test("colour codes never reach the parsers", () => {
  expect(stripAnsi("\u001b[32mOpen this link\u001b[0m")).toBe("Open this link");
  expect(readNativeLine("\u001b[2mhttps://accounts.google.com/o/oauth2/auth?x=1\u001b[0m")).toEqual({
    kind: "url",
    url: "https://accounts.google.com/o/oauth2/auth?x=1",
    code: "",
  });
});

test("each line the command prints is read for what it asks", () => {
  expect(readNativeLine("Sign in anyway? [y/N] ")).toEqual({ kind: "risk" });
  expect(readNativeLine("Paste the code the page shows here and press Enter:")).toEqual({
    kind: "paste",
    what: "code",
  });
  expect(readNativeLine("Paste its whole address here and press Enter:")).toEqual({
    kind: "paste",
    what: "callback",
  });
  expect(readNativeLine("Installing Codex, which codex is used through…")).toEqual({
    kind: "installing",
    text: "Installing Codex, which codex is used through…",
  });
  expect(readNativeLine("  and confirm the code ABCD-1234")).toEqual({
    kind: "code",
    code: "ABCD-1234",
  });
  expect(
    readNativeLine("Finish signing in in your browser. If it didn't open, go to:"),
  ).toBeNull();
  expect(readNativeLine("the sign-in timed out; start it again")).toEqual({
    kind: "failed",
    text: "the sign-in timed out; start it again",
  });
  expect(readNativeLine("")).toBeNull();
  expect(readNativeLine("Signed in as a@b.c")).toBeNull();
});

test("a link-only sign-in hands the link out and answers the risk prompt", async () => {
  const opened = [];
  const { controller, say, children } = harness({ openUrl: (url) => opened.push(url) });

  const started = await controller.start({ agent: "antigravity" });
  expect(started.state).toBe("starting");
  expect(started.agent).toBe("antigravity");

  say(0, "! Antigravity signs in through Google's own page.\n");
  say(0, "Sign in anyway? [y/N] ");
  say(0, "Open this link in the browser you sign in with:\n");
  say(0, "https://accounts.google.com/o/oauth2/auth?client=1\n");
  say(0, "and confirm the code ABCD-1234\n");

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(children[0].written).toEqual(["y\n"]);
  const state = controller.status();
  expect(state.state).toBe("waiting");
  expect(state.url).toBe("https://accounts.google.com/o/oauth2/auth?client=1");
  expect(state.code).toBe("ABCD-1234");
  expect(opened).toEqual(["https://accounts.google.com/o/oauth2/auth?client=1"]);
});

test("a callback the page cannot deliver asks for the address and passes it on", async () => {
  const { controller, say, children, end } = harness();

  await controller.start({ agent: "codex" });
  say(0, "Open this link in the browser you sign in with:\n");
  say(0, "http://127.0.0.1:1455/auth/callback\n");
  say(0, "! Windows keeps port 1455, where the sign-in comes back, for Hyper-V.\n");
  say(0, "Paste its whole address here and press Enter:\n");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(controller.status().state).toBe("paste-required");
  expect(controller.status().paste).toBe("callback");

  const pasted = controller.paste("  http://localhost:1455/auth/callback?code=xyz  ");
  expect(pasted.state).toBe("waiting");
  expect(children[0].written).toEqual(["http://localhost:1455/auth/callback?code=xyz\n"]);

  end(0, 0);
  expect(controller.status().state).toBe("done");
});

test("a failed command is reported, not read as a success", async () => {
  const { controller, say, end } = harness();

  await controller.start({ agent: "grok" });
  say(0, "Signed in as a@b.c\n");
  end(0, 3);

  const state = controller.status();
  expect(state.state).toBe("error");
  expect(state.error).toContain("3");
});

test("a link-only run that exits cleanly is done even with no link seen", async () => {
  const { controller, end } = harness();

  await controller.start({ agent: "claude" });
  end(0, 0);

  expect(controller.status().state).toBe("done");
});

test("a second sign-in is refused while one runs", async () => {
  const { controller } = harness();

  await controller.start({ agent: "antigravity" });
  await expect(controller.start({ agent: "codex" })).rejects.toBeInstanceOf(NativeSignInError);
  await expect(controller.start({ agent: "codex" })).rejects.toMatchObject({ code: "busy", status: 409 });
});

test("an unusable agent id is refused before any process starts", async () => {
  const { controller } = harness();

  await expect(controller.start({ agent: "x; rm -rf /" })).rejects.toMatchObject({
    code: "invalid_agent",
    status: 400,
  });
});

test("pasting into nothing, or nothing into a flow, is refused", async () => {
  const { controller } = harness();

  expect(() => controller.paste("abc")).toThrow(NativeSignInError);
  await controller.start({ agent: "codex" });
  expect(() => controller.paste("   ")).toThrow(NativeSignInError);
  expect(controller.status().state).toBe("starting");
});

test("cancelling stops the process and keeps the state settled", async () => {
  const { controller, children } = harness();

  await controller.start({ agent: "codex" });
  const cancelled = controller.cancel();

  expect(cancelled.state).toBe("cancelled");
  expect(children[0].killed).toBe(true);
  expect(controller.status().state).toBe("cancelled");
  // A late close never turns a cancelled flow into a finished one.
  children[0].emit("close", 0);
  expect(controller.status().state).toBe("cancelled");
  expect(controller.cancel().state).toBe("cancelled");
});

test("status is idle before anything runs", () => {
  const { controller } = harness();
  expect(controller.status()).toEqual({ state: "idle" });
});

// M-14: writing to a child whose stdin already died must not raise an
// unhandled EPIPE that kills the whole process (the fake child's stdin emits
// an 'error' the way a real socket does after the child exited).
test("a paste after the child's stdin died is an error, not a process crash", async () => {
  const { controller, children } = harness();
  await controller.start({ agent: "codex" });
  const child = children[0];
  // Simulate a dead pipe: mark it unwritable and fire the error a real
  // socket would raise. The flow's own listeners must swallow it.
  child.stdin.writable = false;
  child.stdin.on = (event, listener) => {
    if (event === "error") listener(new Error("EPIPE"));
    return child.stdin;
  };
  child.stdin.write = () => {
    throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  };
  child.stdout.write("Paste its whole address here and press Enter:\n");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controller.status().state).toBe("paste-required");
  expect(() => controller.paste("http://localhost/x")).toThrow(NativeSignInError);
});
