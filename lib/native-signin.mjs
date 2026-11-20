// Sign-in for a provider magpie signs in itself.
//
// A provider that is a built-in of magpie (antigravity, codex, claude, grok…)
// has no plugin to scan, so this plugin cannot instantiate its `authorize()`.
// magpie also gives a page plugin no way to start a sign-in: a page's frame is
// sandboxed with `connect-src 'none'`, its reads are kept to `usage:summary`
// and `providers:list`, and `noFramedAPI` turns away every `/api/` request a
// frame sends. So the only door is magpie's own command line, which the docs
// describe as the same steps the window takes (`magpie accounts add <agent>`,
// `addAccount` in internal/cli/accounts_cli.go).
//
// That command prints the sign-in link instead of opening it whenever
// Settings › Privacy › Sign-in pages is off (`SignInLinkOnly`), which is
// exactly the setting a fingerprint-browser user keeps. This module drives it:
// it answers the risk prompt, reads the link and the device code out of the
// output, hands the link to the caller (which opens it in the account's own
// isolated browser and through the account's proxy), and passes back what the
// user pastes when the callback cannot reach this machine.

import { spawn as spawnChild } from "node:child_process";

export const NATIVE_SIGNIN_STATES = Object.freeze([
  "starting",
  "waiting",
  "paste-required",
  "done",
  "error",
  "cancelled",
]);

const TERMINAL = new Set(["done", "error", "cancelled"]);

// magpie's output is rendered with colour when it has a terminal; a piped
// child usually gets none, but the escape codes are stripped anyway so the
// parsers below never depend on that.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

const URL_LINE = /https?:\/\/[^\s"'<>]+/;
const CODE_LINE = /\bconfirm the code\s+([A-Z0-9][A-Z0-9-]{2,})\b/i;
const RISK_PROMPT = /sign in anyway\?\s*\[y\/N\]/i;
const PASTE_CODE = /paste the code the page shows here/i;
const PASTE_CALLBACK = /paste its whole address here/i;
const PASTE_ANY = /paste (?:its whole address|the code)/i;
const INSTALLING = /^installing /i;
const TIMED_OUT = /timed out|didn't finish/i;

export class NativeSignInError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "NativeSignInError";
    this.code = code;
    this.status = status;
  }
}

export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI, "");
}

// The agent id reaches an argument list, so it is held to the shape magpie's
// own agent ids have: a lowercase slug. Anything else is refused before a
// process is started.
export function normalizeAgent(value) {
  const agent = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(agent) ? agent : null;
}

export function magpieCli(env = process.env) {
  const own = typeof env.MAGPIE_CLI === "string" ? env.MAGPIE_CLI.trim() : "";
  if (own) return own;
  return process.platform === "win32" ? "magpie.exe" : "magpie";
}

// One line of `magpie accounts add` output, read for what the flow needs.
// Everything else is kept for the error text and nothing more.
export function readNativeLine(raw) {
  const line = stripAnsi(raw).replace(/\r$/, "");
  if (!line.trim()) return null;
  if (RISK_PROMPT.test(line)) return { kind: "risk" };
  if (PASTE_CODE.test(line)) return { kind: "paste", what: "code" };
  if (PASTE_CALLBACK.test(line)) return { kind: "paste", what: "callback" };
  if (PASTE_ANY.test(line)) return { kind: "paste", what: "callback" };
  if (INSTALLING.test(line.trim())) return { kind: "installing", text: line.trim() };
  const code = line.match(CODE_LINE);
  const url = line.match(URL_LINE);
  if (url) return { kind: "url", url: url[0], code: code ? code[1] : "" };
  if (code) return { kind: "code", code: code[1] };
  if (TIMED_OUT.test(line)) return { kind: "failed", text: line.trim() };
  return null;
}

function publicState(flow) {
  return {
    state: flow.state,
    agent: flow.agent,
    url: flow.url,
    code: flow.code,
    paste: flow.paste,
    error: flow.error,
    startedAt: flow.startedAt,
    finishedAt: flow.finishedAt,
  };
}

// `spawn` and `now` are injectable so the tests never start a real magpie.
export function createNativeSignIn({
  spawn = spawnChild,
  now = Date.now,
  cli = magpieCli(),
  openUrl = null,
  timeoutMs = 16 * 60 * 1000,
  env = process.env,
} = {}) {
  let current = null;

  function fail(flow, message) {
    if (!flow || TERMINAL.has(flow.state)) return;
    flow.state = "error";
    flow.error = message;
    flow.finishedAt = now();
    flow.timer && clearTimeout(flow.timer);
    flow.timer = null;
  }

  function finish(flow) {
    if (!flow || TERMINAL.has(flow.state)) return;
    flow.state = "done";
    flow.finishedAt = now();
    flow.timer && clearTimeout(flow.timer);
    flow.timer = null;
  }

  function onLine(flow, raw) {
    flow.output.push(raw);
    if (flow.output.length > 200) flow.output.shift();
    const read = readNativeLine(raw);
    if (!read) return;
    switch (read.kind) {
      case "risk":
        // The risk note (antigravity, claude, workbuddy) is answered yes: the
        // user pressed this provider's own add entry, so the sign-in is what
        // they asked for. The note is carried to the page instead of being
        // silently swallowed.
        flow.risk = true;
        flow.child.stdin.write("y\n");
        return;
      case "url":
        if (!flow.url) {
          flow.url = read.url;
          if (read.code) flow.code = read.code;
          flow.state = "waiting";
          if (typeof openUrl === "function") {
            Promise.resolve()
              .then(() => openUrl(read.url, flow))
              .catch((error) => fail(flow, String(error?.message || error)));
          }
        } else if (read.code && !flow.code) {
          flow.code = read.code;
        }
        return;
      case "code":
        if (!flow.code) flow.code = read.code;
        return;
      case "paste":
        flow.state = "paste-required";
        flow.paste = read.what;
        return;
      case "installing":
        flow.installing = read.text;
        return;
      case "failed":
        fail(flow, read.text);
        return;
      default:
        return;
    }
  }

  async function start({ agent, proxy = null } = {}) {
    const id = normalizeAgent(agent);
    if (!id) throw new NativeSignInError("invalid_agent", "A provider id is required.", 400);
    if (current && !TERMINAL.has(current.state)) {
      // One sign-in at a time, the same rule magpie's own flow keeps: a second
      // start would race the first one's callback port.
      throw new NativeSignInError("busy", "A sign-in is already running.", 409);
    }
    const flow = {
      agent: id,
      proxy,
      state: "starting",
      url: "",
      code: "",
      paste: "",
      installing: "",
      risk: false,
      error: "",
      output: [],
      startedAt: now(),
      finishedAt: 0,
      timer: null,
      child: null,
    };
    current = flow;

    let child;
    try {
      child = spawn(cli, ["accounts", "add", id], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env,
      });
    } catch (error) {
      fail(flow, String(error?.message || error));
      throw new NativeSignInError("spawn_failed", "magpie could not be started.", 500);
    }
    flow.child = child;
    // Writing to a child that already exited raises EPIPE on the socket, and
    // an unhandled 'error' event would take the whole process down. The
    // flow's own close/timeout path owns the outcome, so stdin errors are
    // swallowed here.
    child.stdin?.on?.("error", () => {});

    const read = (chunk) => {
      const text = String(chunk ?? "");
      flow.pending = (flow.pending ?? "") + text;
      const parts = flow.pending.split(/\r?\n/);
      flow.pending = parts.pop() ?? "";
      for (const part of parts) onLine(flow, part);
    };
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("error", (error) => fail(flow, String(error?.message || error)));
    child.on("close", (code) => {
      if (flow.pending) onLine(flow, flow.pending);
      flow.pending = "";
      if (TERMINAL.has(flow.state)) return;
      if (code === 0) finish(flow);
      else fail(flow, `magpie exited with ${code}.`);
    });
    flow.timer = setTimeout(() => {
      fail(flow, "The sign-in timed out; start it again.");
      try { child.kill(); } catch { /* already gone */ }
    }, timeoutMs);
    flow.timer.unref?.();
    return publicState(flow);
  }

  function paste(text) {
    const flow = current;
    if (!flow || TERMINAL.has(flow.state)) {
      throw new NativeSignInError("no_signin", "No sign-in is waiting.", 409);
    }
    const value = typeof text === "string" ? text.trim() : "";
    if (!value) throw new NativeSignInError("empty_paste", "Nothing was pasted.", 400);
    try {
      if (flow.child.stdin?.writable === false) {
        throw new NativeSignInError("paste_failed", "The sign-in process is no longer accepting input.", 500);
      }
      flow.child.stdin.write(`${value}\n`);
    } catch (error) {
      throw new NativeSignInError("paste_failed", String(error?.message || error), 500);
    }
    flow.paste = "";
    flow.state = "waiting";
    return publicState(flow);
  }

  function cancel() {
    const flow = current;
    if (!flow) return { state: "idle" };
    if (TERMINAL.has(flow.state)) return publicState(flow);
    flow.state = "cancelled";
    flow.finishedAt = now();
    flow.timer && clearTimeout(flow.timer);
    flow.timer = null;
    try { flow.child.kill(); } catch { /* already gone */ }
    return publicState(flow);
  }

  function status() {
    return current ? publicState(current) : { state: "idle" };
  }

  return { states: NATIVE_SIGNIN_STATES, start, paste, cancel, status };
}
