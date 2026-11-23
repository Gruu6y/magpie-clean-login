// The add-account dialog: its static wiring (no sandbox-hostile controls) and
// the pure request-shape helpers. Read-file style, like providers-ui.test.mjs.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  signInActive,
  signInAwaitingCode,
  signInCodePayload,
  signInInputs,
  signInMethodLabel,
  signInPayload,
  signInProxy,
  signInSettled,
} from "../ui/signin-state.js";
import { signInDoor, signInMethodFields } from "../ui/provider-state.js";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8");
const html = readFileSync(join(root, "ui", "index.html"), "utf8");

test("the sign-in dialog posts the card's signInProvider to /api/signin", () => {
  expect(app).toContain("provider: provider.signInProvider");
  expect(app).toContain("signInPayload(");
  expect(app).toContain("selectedSignInProxy()");
  expect(app).toContain("selectedSignInMethod()");
  expect(app).toContain("selectedSignInAccount()");
  expect(app).toContain('api("api/signin", {');
  expect(app).toContain('api(signInIsNative(context) ? "api/native-signin/cancel" : "api/signin/cancel", {');
  // The status poll is a GET of the same route.
  expect(app).toContain('const data = await api(signInIsNative(context) ? "api/native-signin" : "api/signin");');
  // The proxy list is re-read from GET /api/proxies when the dialog opens.
  expect(app).toContain('await api("api/proxies")');
});

test("a built-in provider's add entry goes through magpie's own command line", () => {
  // A provider magpie signs in itself has no plugin method to run, and a page
  // cannot reach magpie's API, so the service drives `magpie accounts add` and
  // the dialog has to talk to that door instead of the plugin one.
  expect(app).toContain("signInDoor(");
  // The door is read from the card. `context.provider` is the card's
  // `signInProvider`, which is null on exactly the native-only cards, so the
  // old `signInDoor(context.provider)` sent them to /api/signin with no
  // provider and a 400.
  expect(app).toContain('signInDoor(context.card) === "native"');
  expect(app).not.toContain("signInDoor(context.provider)");
  expect(app).toContain('api("api/native-signin", { method: "POST", body: { agent: nativeSignInAgent(context.card) } })');
  expect(app).toContain("return String(card?.agentId || card?.id || \"\");");
  expect(app).toContain('api("api/native-signin/paste", { method: "POST", body: { text: code } })');
  // The native states are folded onto the vocabulary the dialog already
  // renders, so a paste-back looks exactly like a one-time code.
  expect(app).toContain("const NATIVE_STATE_ALIAS = {");
  expect(app).toContain('"paste-required": "waiting-code",');
  expect(app).toContain("function nativeFlow(flow) {");
  // A native failure is a plain string; it is wrapped so serverErrorText shows
  // the reason instead of the generic fallback.
  expect(app).toContain('error: typeof flow.error === "string" && flow.error ? { serverMessage: flow.error } : "",');
  expect(app).toContain("statusDetail.textContent = serverErrorText(flow?.error);");
});

test("the dialog is sandbox-safe: type=button controls and no form submission", () => {
  const dialog = /<dialog id="signin-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(dialog).toContain('id="signin-proxy"');
  expect(dialog).toContain('id="signin-start"');
  expect(dialog).toContain('id="signin-cancel"');
  expect(dialog).toContain('id="signin-dialog"');
  // Every control is an explicit type=button; a submit control is silently
  // dead in magpie's allow-scripts-only frame.
  const buttons = dialog.match(/<button[^>]*>/g) || [];
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(button).toContain('type="button"');
  expect(dialog).not.toContain('type="submit"');
});

// The method picker for a plugin with several runnable oauth methods (ZCode's
// per-site flows). It is a plain select, so it needs no submit, and the whole
// dialog stays free of alert/confirm/window.open/localStorage.
test("the dialog offers a method picker for a plugin with several sign-in methods", () => {
  const dialog = /<dialog id="signin-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(dialog).toContain('id="signin-method"');
  expect(dialog).toContain('id="signin-method-field"');
  expect(dialog).toContain('id="signin-method-hint"');
  // A select needs no form submission, so it is sandbox-safe as it is.
  expect(dialog).not.toContain('type="submit"');
  // The forbidden browser APIs never appear in the sign-in code.
  const signInCode = /function renderSignInMethods[\s\S]*?function openSignInDialog/.exec(app)?.[0] || "";
  expect(signInCode).not.toMatch(/alert\(|confirm\(|window\.open|localStorage/);
  // The picker is filled from the card's signInMethods and its choice is sent.
  expect(app).toContain("provider?.signInMethods");
  expect(app).toContain("selectedSignInMethod()");
  expect(app).toContain("signInMethodHint");
});

test("signInPayload carries the chosen method label, and omits it when there is none", () => {
  expect(
    signInPayload("zcode", null, "ZCode: BigModel (智谱) GLM Coding Plan"),
  ).toEqual({
    provider: "zcode",
    proxy: null,
    methodLabel: "ZCode: BigModel (智谱) GLM Coding Plan",
  });
  // No choice made: the field is absent, so the service picks as before.
  expect(signInPayload("zcode", null)).toEqual({ provider: "zcode", proxy: null });
  expect(signInPayload("zcode", null, "")).toEqual({ provider: "zcode", proxy: null });
  expect(signInPayload("zcode", null, "   ")).toEqual({ provider: "zcode", proxy: null });
  expect(signInMethodLabel("  ZCode  ")).toBe("ZCode");
  expect(signInMethodLabel("")).toBeNull();
  expect(signInMethodLabel(null)).toBeNull();
  expect(signInMethodLabel(42)).toBeNull();
});

// A method that asks something before it starts (ZCode's team picker, Qoder
// CN's VPC instance, a PAT) declares prompts. The dialog renders them from the
// card's already-projected fields and sends the answers with the request, so a
// method never starts with a silent default.
test("the dialog renders the chosen method's declared fields and sends the answers", () => {
  const dialog = /<dialog id="signin-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(dialog).toContain('id="signin-inputs-field"');
  expect(dialog).toContain('id="signin-inputs"');
  expect(dialog).toContain('id="signin-inputs-hint"');
  // Still no submit control: the fields are plain inputs in an allow-scripts frame.
  expect(dialog).not.toContain('type="submit"');

  expect(app).toContain("function renderSignInInputs(provider)");
  expect(app).toContain("function selectedSignInInputs()");
  expect(app).toContain("signInMethodFields(provider, selectedSignInMethod())");
  expect(app).toContain("selectedSignInInputs(),");
  // Switching the method rebuilds the fields from that method's own prompts.
  expect(app).toContain('byId("signin-method").addEventListener("change"');
  expect(app).toContain("renderSignInInputs(signInContext.card)");
  // A masked answer stays masked, and a select carries the plugin's own options.
  expect(app).toContain('item.type === "password" ? "password" : "text"');
  expect(app).toContain("node.value = option.value");
  const inputsCode =
    /function renderSignInInputs[\s\S]*?function selectedSignInInputs[\s\S]*?\n\}/.exec(app)?.[0] || "";
  expect(inputsCode).not.toMatch(/alert\(|confirm\(|window\.open|localStorage|innerHTML/);
});

test("signInMethodFields picks the fields of the chosen method only", () => {
  const card = {
    signInMethods: ["Provider team", "Provider PAT"],
    authMethods: [
      {
        type: "oauth",
        label: "Provider team",
        runnable: true,
        category: "browser",
        fields: [
          {
            type: "select",
            key: "site",
            message: "Where is the plan?",
            options: [{ label: "Z.ai", value: "zai" }],
          },
        ],
      },
      {
        type: "oauth",
        label: "Provider PAT",
        runnable: true,
        category: "secret",
        fields: [{ type: "password", key: "pat", message: "Your token", options: [] }],
      },
    ],
  };
  expect(signInMethodFields(card, "Provider PAT")).toEqual([
    { type: "password", key: "pat", message: "Your token", options: [] },
  ]);
  // No explicit pick: the first method the dialog would run.
  expect(signInMethodFields(card)).toEqual([
    {
      type: "select",
      key: "site",
      message: "Where is the plan?",
      options: [{ label: "Z.ai", value: "zai" }],
    },
  ]);
  // A method with no prompts, an unknown label, and an empty card.
  expect(signInMethodFields({ authMethods: [{ label: "x", fields: [] }] }, "x")).toEqual([]);
  expect(signInMethodFields(card, "nope")).toEqual([]);
  expect(signInMethodFields({})).toEqual([]);
});

test("signInPayload sends only the filled answers, and omits the key when none", () => {
  expect(signInPayload("zcode", null, "team", null, { site: "bigmodel" })).toEqual({
    provider: "zcode",
    proxy: null,
    methodLabel: "team",
    inputs: { site: "bigmodel" },
  });
  expect(signInPayload("zcode", null, "team", null, { site: "  " })).toEqual({
    provider: "zcode",
    proxy: null,
    methodLabel: "team",
  });
  expect(signInPayload("zcode", null, "team", null, {})).toEqual({
    provider: "zcode",
    proxy: null,
    methodLabel: "team",
  });
  expect(signInInputs({ site: " zai ", pat: 42, "": "x" })).toEqual({ site: "zai" });
  expect(signInInputs(null)).toBeNull();
  expect(signInInputs(["site"])).toBeNull();
});

test("the dialog shows the required opened message and stops polling on close", () => {
  expect(app).toContain("text.signInOpened");
  expect(app).toContain("已在隔离浏览器窗口打开登录页，请在那个窗口里完成登录");
  // Closing the dialog cancels a still-running flow and always stops polling.
  expect(app).toContain("function stopSignInPolling()");
  expect(app).toContain("function cleanupSignInDialog()");
  expect(app).toContain("signInActive(signInContext.flow?.state)");
  const cleanup = /function cleanupSignInDialog\(\) \{[\s\S]*?\n\}/.exec(app)?.[0] || "";
  expect(cleanup).toContain("stopSignInPolling()");
});

test("a sign-in error shows the server's own code and message", () => {
  expect(app).toContain("error?.serverMessage");
  expect(app).toContain("serverErrorText(flow?.error)");
  // Never collapsed into a generic \"unknown error\" for a server reply.
  expect(app).not.toContain("signInUnknownError");
});

test("a waiting-login navigation warning keeps the state label and shows a localised hint", () => {
  const rendered = /function renderSignIn\(\) \{[\s\S]*?\n\}/.exec(app)?.[0] || "";
  expect(rendered).toContain("statusState.textContent = signInStateLabel(state)");
  expect(rendered).toContain('state === "waiting-login"');
  expect(rendered).toContain('navigationWarningText(flow?.warning, "signInNavigationWarning")');
  expect(rendered).toContain("statusDetail.hidden = !warning");
  expect(app).toContain("const NAVIGATION_WARNING_CODE = \"navigation_failed\";");
  expect(app).toContain("return warning?.code === NAVIGATION_WARNING_CODE ? text[key] : \"\";");
  expect((app.match(/\bsignInNavigationWarning:/g) || []).length).toBeGreaterThanOrEqual(4);
});

test("signInProxy keeps only public fields and never a password", () => {
  const payload = signInPayload("workbuddy", {
    id: "p1",
    name: "SG · 01",
    type: "http",
    host: "1.2.3.4",
    port: 8080,
    username: "user",
    password: "s3cret",
    hasPassword: true,
  });
  expect(payload).toEqual({
    provider: "workbuddy",
    proxy: { id: "p1", type: "http", host: "1.2.3.4", port: 8080, username: "user" },
  });
  expect(payload.proxy).not.toHaveProperty("password");
  expect(JSON.stringify(payload)).not.toContain("s3cret");
});

test("signInProxy sends null for the no-proxy selection", () => {
  expect(signInPayload("workbuddy", null)).toEqual({ provider: "workbuddy", proxy: null });
  expect(signInPayload("workbuddy", {})).toEqual({ provider: "workbuddy", proxy: null });
  expect(signInPayload("workbuddy", { id: "" })).toEqual({ provider: "workbuddy", proxy: null });
  expect(signInProxy(undefined)).toBeNull();
});

test("signInActive and signInSettled partition the state machine", () => {
  for (const state of ["authorizing", "waiting-login", "waiting-code", "finishing"]) {
    expect(signInActive(state)).toBe(true);
    expect(signInSettled(state)).toBe(false);
  }
  for (const state of ["done", "error", "cancelled"]) {
    expect(signInActive(state)).toBe(false);
    expect(signInSettled(state)).toBe(true);
  }
  for (const state of ["idle", "", undefined]) {
    expect(signInActive(state)).toBe(false);
    expect(signInSettled(state)).toBe(false);
  }
});

// A plugin whose sign-in is a one-time code it sends itself: the page must
// offer the code box and post the code to its own route.
test("the dialog carries a code step for a plugin that sends a one-time code", () => {
  const dialog = /<dialog id="signin-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(dialog).toContain('id="signin-inputs"');
  expect(dialog).toContain('id="signin-code-field"');
  expect(dialog).toContain('id="signin-code"');
  expect(dialog).toContain('id="signin-code-label"');
  expect(dialog).toContain('id="signin-submit-code"');
  expect(dialog).toContain('type="button"');
  expect(app).toContain("renderSignInInputs(");
  expect(app).toContain("selectedSignInInputs()");
  expect(app).toContain("function submitSignInCode()");
  expect(app).toContain('api("api/signin/code", { method: "POST", body: signInCodePayload(code) })');
  expect(app).toContain("byId(\"signin-submit-code\").addEventListener");
  expect(app).toContain("signInAwaitingCode");
  // The code box only appears while the plugin is waiting for a code.
  expect(app).toContain("codeField.hidden = !awaitingCode;");
});

test("signInPayload carries the typed form values, and omits them when empty", () => {
  const withValues = signInPayload(
    "loomy",
    null,
    null,
    null,
    { phone: " 13800138000 ", blank: "   ", nope: 42 },
  );
  expect(withValues).toEqual({ provider: "loomy", proxy: null, inputs: { phone: "13800138000" } });
  for (const inputs of [null, undefined, {}, [], "phone", { phone: "" }, { phone: 42 }]) {
    expect(signInPayload("loomy", null, null, null, inputs)).toEqual({
      provider: "loomy",
      proxy: null,
    });
  }
});

test("signInCodePayload carries only the trimmed code", () => {
  expect(signInCodePayload(" 123456 ")).toEqual({ code: "123456" });
  expect(signInCodePayload(null)).toEqual({ code: "" });
  expect(signInCodePayload(123456)).toEqual({ code: "" });
});

test("signInAwaitingCode marks exactly the waiting-code state", () => {
  expect(signInAwaitingCode("waiting-code")).toBe(true);
  for (const state of ["idle", "authorizing", "waiting-login", "finishing", "done", "error", "cancelled", "", undefined]) {
    expect(signInAwaitingCode(state)).toBe(false);
  }
});

test("a native-only card opens the native door; its signInProvider would not", () => {
  // The shape a built-in (codex, antigravity) card has when no plugin covers it.
  const card = { id: "codex", agentId: "codex", nativeSignIn: true, signInProvider: null };
  expect(signInDoor(card)).toBe("native");
  // What the dialog used to pass: the card's signInProvider, null here.
  expect(signInDoor(card.signInProvider)).toBe("none");
  // The dialog keeps the whole card next to the plugin id.
  const opened = /function openSignInDialog[\s\S]*?signInContext = \{[\s\S]*?\n {2}\};/.exec(app)?.[0] || "";
  expect(opened).toContain("provider: provider.signInProvider,");
  expect(opened).toContain("card: provider,");
});

test("the sign-in dialog mirrors a card's specialized risk notice and clears it on close", () => {
  const dialog = /<dialog id="signin-dialog"[\s\S]*?<\/dialog>/.exec(html)?.[0] || "";
  expect(dialog).toContain('id="signin-provider-notice"');
  expect(app).toContain("renderSignInProviderNotice(provider);");
  expect(app).toContain("function renderSignInProviderNotice(provider)");
  expect(app).toContain('byId("signin-provider-notice")');
  const cleanup = /function cleanupSignInDialog\(\) \{[\s\S]*?\n\}/.exec(app)?.[0] || "";
  expect(cleanup).toContain("renderSignInProviderNotice(null);");
});
