// Static, auditable provider capability registry.
//
// This file describes what a provider would need before this plugin may add an
// account. It performs no sign-in, stores no credentials and contains no
// client ids, secrets or guessed endpoints. Auth hosts are hostnames only; the
// callback ports are reserved for the future isolated-browser flow and remain
// provisional until that flow is verified.
//
// `capability.state` is an internal branch marker only: provider-sources.mjs
// uses it to decide whether a failed plugin scan should replace a card's reason
// with the diagnostic. It is deliberately not rendered. The page used to show a
// "pending verification" badge for it, which read as permanent noise: the only
// thing that could ever move a card off `pending` is a real user attempt, and
// the plugin has no channel to learn the outcome of one. A badge that can never
// change is not information, so the page no longer shows it and the registry no
// longer writes a reason about it.

export const PROVIDER_CAPABILITY_STATES = Object.freeze(["pending", "ready", "blocked"]);
export const PROVIDER_NOTICE_TONES = Object.freeze(["warn", "danger"]);

// Google AGY family risk notice: unpaid accounts cannot avoid Google's ToS
// bans through this plugin, and using AGY providers through magpie is not
// recommended for now.
export const AGY_FAMILY_NOTICE = Object.freeze({
  en: "Heads-up: This plugin cannot ease ban risk on accounts without real paid billing, and using Google AGY providers through magpie is not recommended for now.",
  "zh-Hans": "提醒：未实付的账号无法通过本插件缓解你的封禁焦虑，且暂时不建议通过 magpie 使用 agy 供应商。",
  "zh-Hant": "提醒：未實付的帳號無法透過本外掛緩解你的封禁焦慮，且暫時不建議透過 magpie 使用 agy 供應商。",
  ja: "注意：実際に課金していないアカウントの BAN 不安はこのプラグインでは解消できず、当面は magpie 経由での agy プロバイダー利用もおすすめしません。",
});

// Claude family risk notice: users should use claude-cage instead of this plugin.
export const CLAUDE_NOTICE = Object.freeze({
  en: "Notice: Do not use Claude through this plugin. Please use claude-cage instead.",
  "zh-Hans": "提醒：请不要通过本插件来使用 Claude，请使用 claude-cage。",
  "zh-Hant": "提醒：請不要透過本外掛來使用 Claude，請使用 claude-cage。",
  ja: "注意：このプラグイン経由で Claude を使わないでください。代わりに claude-cage をご利用ください。",
});

function providerSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const AGY_ID_PATTERN = /^(?:google-)?(?:antigravity|agy)(?:-|$)/;
const AGY_TOKEN_PATTERN = /(?:^|-)(?:antigravity|agy)(?:-|$)/;
const CLAUDE_ID_PATTERN = /^(?:anthropic-)?claude(?:code)?(?:-|$)/;
const CLAUDE_TOKEN_PATTERN = /(?:^|-)claude(?:code)?(?:-|$)/;

// Curated family-level notices so plugin-derived and market cards (such as
// `agy-cli` or `claude-code`) inherit the same specialized warning as the
// built-in registry entries.
export function providerSpecialNotice(provider = {}) {
  if (!provider || typeof provider !== "object") return null;
  const ids = [provider.id, provider.agentId, provider.signInProvider]
    .map(providerSlug)
    .filter(Boolean);
  const name = providerSlug(provider.name);
  const pkg = providerSlug(provider.pluginPackage || provider.package);

  if (
    ids.some((id) => AGY_ID_PATTERN.test(id)) ||
    (name && AGY_TOKEN_PATTERN.test(name)) ||
    (pkg && AGY_TOKEN_PATTERN.test(pkg))
  ) {
    return { notice: { ...AGY_FAMILY_NOTICE }, noticeTone: "warn" };
  }

  if (
    ids.some((id) => CLAUDE_ID_PATTERN.test(id)) ||
    (name && CLAUDE_TOKEN_PATTERN.test(name)) ||
    (pkg && CLAUDE_TOKEN_PATTERN.test(pkg))
  ) {
    return { notice: { ...CLAUDE_NOTICE }, noticeTone: "danger" };
  }

  return null;
}

const definitions = [
  {
    // magpie's own provider id is `antigravity`; matching it is what lets the
    // runtime-derived list line up with this registry instead of reporting a
    // provider magpie has as "not in magpie".
    id: "antigravity",
    name: "Google Antigravity",
    mark: { kind: "letter", text: "A", tone: "blue" },
    description: {
      en: "Google's agent-first coding IDE. Sign-in will use Google's own account page in an isolated browser.",
      "zh-Hans": "Google 的智能体编程 IDE。登录将在隔离浏览器中使用 Google 自己的账号页面。",
      "zh-Hant": "Google 的代理式程式設計 IDE。登入將在隔離瀏覽器中使用 Google 自己的帳號頁面。",
      ja: "Google のエージェント型コーディング IDE。ログインは隔離されたブラウザーで Google のアカウントページを使用します。",
    },
    agentId: "antigravity",
    signInMode: "browser-oauth",
    linkOnly: true,
    authHosts: ["accounts.google.com"],
    callbackPort: 45171,
    notice: { ...AGY_FAMILY_NOTICE },
    noticeTone: "warn",
    capability: { state: "pending", reason: {} },
  },
  {
    id: "codex",
    name: "Codex",
    mark: { kind: "letter", text: "Cx", tone: "green" },
    description: {
      en: "OpenAI's Codex coding agent. Sign-in will use OpenAI's account flow in an isolated browser.",
      "zh-Hans": "OpenAI 的 Codex 编程智能体。登录将在隔离浏览器中使用 OpenAI 的账号流程。",
      "zh-Hant": "OpenAI 的 Codex 程式設計代理。登入將在隔離瀏覽器中使用 OpenAI 的帳號流程。",
      ja: "OpenAI の Codex コーディングエージェント。ログインは隔離されたブラウザーで OpenAI のアカウントフローを使用します。",
    },
    agentId: "codex",
    signInMode: "browser-oauth",
    linkOnly: true,
    authHosts: ["auth.openai.com"],
    callbackPort: 45172,
    notice: {},
    noticeTone: null,
    capability: { state: "pending", reason: {} },
  },
  {
    id: "claude",
    name: "Claude",
    mark: { kind: "letter", text: "Cl", tone: "clay" },
    description: {
      en: "Anthropic's Claude.",
      "zh-Hans": "Anthropic 的 Claude。",
      "zh-Hant": "Anthropic 的 Claude。",
      ja: "Anthropic の Claude。",
    },
    agentId: "claude",
    // magpie signs in to Claude with `POST /api/signin/claude-token`, which
    // imports a token. It is not a browser OAuth flow, so there is no web auth
    // host and no callback port to claim.
    signInMode: "token-import",
    linkOnly: true,
    authHosts: [],
    callbackPort: null,
    notice: { ...CLAUDE_NOTICE },
    noticeTone: "danger",
    capability: { state: "pending", reason: {} },
  },
];

export const PROVIDERS = Object.freeze(definitions);

// The API deliberately projects a fixed allowlist. Adding a field here is the
// only way for it to become public, so credentials and future private
// implementation details cannot leak by accident.
export const PROVIDER_PUBLIC_FIELDS = Object.freeze([
  "id",
  "name",
  "mark",
  "description",
  "agentId",
  "signInMode",
  "linkOnly",
  "authHosts",
  "callbackPort",
  "notice",
  "noticeTone",
  "capability",
]);

export function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.name,
    mark: { ...provider.mark },
    description: { ...provider.description },
    agentId: provider.agentId,
    signInMode: provider.signInMode,
    linkOnly: Boolean(provider.linkOnly),
    authHosts: [...provider.authHosts],
    callbackPort: provider.callbackPort,
    notice: { ...provider.notice },
    noticeTone: PROVIDER_NOTICE_TONES.includes(provider.noticeTone) ? provider.noticeTone : null,
    capability: {
      state: provider.capability.state,
      reason: { ...provider.capability.reason },
    },
  };
}

export function listProviders() {
  return PROVIDERS.map(publicProvider);
}
