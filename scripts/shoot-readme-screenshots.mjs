// Regenerate the README screenshots from the SHIPPED plugin, not from a mock.
//
//   bun scripts/shoot-readme-screenshots.mjs [--lang zh-Hans] [--theme light]
//
// What is real: lib/server.mjs started in-process, the shipped ui/*.js and
// ui/style.css served over HTTP, the shipped provider registry and its logos,
// and a real Chrome rendering the page at 2x. Nothing is drawn by hand and no
// markup is substituted.
//
// What is synthetic: the account ledgers, the proxy rows, and the two numbers
// the login-browser panel reads off the machine. They use the documentation-
// reserved ranges (203.0.113.x / 198.51.100.x / 192.0.2.x), invented account
// names, a machine-neutral install path and a round free-disk figure, because
// a public README must not carry the generating machine's OS account name or
// how much space its drive has left. The README says so beside the images.
//
// The probe seam is injected for the same reason: a real probe would dial a
// real proxy. Everything downstream of the seam -- storage, projection,
// rendering -- is the shipped code path.
//
// Needs a Chrome/Chromium executable. Set CLEAN_LOGIN_CHROME to point at one;
// otherwise the usual Windows install locations are tried.
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "../lib/server.mjs";
import { createEnvironmentManager } from "../lib/browser-environment.mjs";
import { writeAccountMeta, IDENTITY_FILE, safeSegment } from "../lib/account-identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const lang = option("lang", "zh-Hans");
const theme = option("theme", "light");

const chrome = [
  process.env.CLEAN_LOGIN_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path));
if (!chrome) {
  console.error("No Chrome found. Set CLEAN_LOGIN_CHROME to a Chrome/Chromium executable.");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "clean-login-readme-"));
const dataDir = join(tmp, "data");
const configDir = join(tmp, "magpie-config");
mkdirSync(dataDir, { recursive: true });
mkdirSync(configDir, { recursive: true });
const env = {
  ...process.env,
  MAGPIE_CONFIG_DIR: configDir,
  MAGPIE_CLEAN_LOGIN_DATA: dataDir,
  MAGPIE_CACHE_DIR: join(tmp, "cache"),
  NODE_ENV: "production",
};

// The login-browser panel shows the install path and the free space on that
// volume. Pointed at the real cache, those two strings would put this machine's
// OS account name (C:\Users\<name>\...) and how full its drive is into a public
// image. So the panel is driven through the operator seam the shipped code
// already offers -- an explicit browser root and a supplied free-byte figure --
// and the root is a shared, machine-neutral location that exists on every
// Windows install and is writable by design.
//
// A fresh directory means the panel reads as NOT prepared, which is what a
// first-time reader actually sees, so nothing about the state is invented: an
// empty browser root genuinely is not installed. Override with
// MAGPIE_CLEAN_LOGIN_BROWSER_DIR if you want a path of your own in the image.
const neutralBase = resolve(process.platform === "win32" ? "C:/Users/Public" : "/tmp");
const browserRoot = process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR
  ? resolve(process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR)
  : join(neutralBase, "clean-login-readme-demo", "camoufox");
// resolve() puts Windows paths in backslashes, so compare in one form.
const inside = (path) => path === neutralBase || path.startsWith(neutralBase + sep);
if (!inside(browserRoot) && !process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR) {
  throw new Error(`refusing a browser root outside the neutral base: ${browserRoot}`);
}
// A round 256 GiB: plausible, and not this machine's actual free space.
const NEUTRAL_FREE_BYTES = 256 * 1024 ** 3;
mkdirSync(browserRoot, { recursive: true });
const environment = createEnvironmentManager({ env, root: browserRoot, freeBytes: NEUTRAL_FREE_BYTES });

// Provider ids, names and API hosts are the real ones this plugin reads from an
// installed magpie; only the account and proxy records below are invented.
const scanner = {
  get: () => ({
    available: true,
    scanned: true,
    stale: false,
    scanning: false,
    error: null,
    providers: [
      { id: "workbuddy", name: "WorkBuddy", api: "https://api.workbuddy.ai", package: "@magpie-community/opencode-workbuddy-auth", methods: [{ type: "oauth", label: "WorkBuddy (browser)", category: "browser" }] },
      { id: "workbuddy-ai", name: "WorkBuddy AI", api: "https://api.workbuddy.ai", package: "@magpie-community/opencode-workbuddy-auth", methods: [{ type: "oauth", label: "WorkBuddy AI (browser)", category: "browser" }] },
      { id: "qoder-cn", name: "Qoder CN", api: "https://gateway.qoder.com.cn", package: "@magpie-community/opencode-qoder-auth", methods: [{ type: "oauth", label: "Qoder CN (browser)", category: "browser" }] },
      { id: "qoder", name: "Qoder", api: "https://api3.qoder.sh", package: "@magpie-community/opencode-qoder-auth", methods: [{ type: "oauth", label: "Qoder (browser)", category: "browser" }] },
      { id: "minimax-code", name: "MiniMax Code", api: "https://api.minimaxi.com", package: "@magpie-community/opencode-minimax-auth", methods: [{ type: "oauth", label: "MiniMax (browser)", category: "browser" }] },
      { id: "qwenwork", name: "QwenWork", api: "https://api.qwen.ai", package: "@magpie-community/opencode-qwen-auth", methods: [{ type: "oauth", label: "QwenWork (browser)", category: "browser" }] },
      { id: "zcode", name: "ZCode", api: "https://api.zcode.ai", package: "@magpie-community/opencode-zcode-auth", methods: [{ type: "oauth", label: "ZCode (browser)", category: "browser" }] },
      { id: "loomy", name: "Loomy", api: "https://api.loomy.ai", package: "@magpie-community/opencode-loomy-auth", methods: [{ type: "oauth", label: "Loomy (browser)", category: "browser" }] },
    ],
  }),
  warm: () => {},
};

const exits = [
  { name: "HK 家宽 01", type: "http", host: "203.0.113.11", port: 8080, ip: "203.0.113.20", region: "中国/香港", generic: 41, provider: 233 },
  { name: "HK 家宽 02", type: "http", host: "203.0.113.12", port: 8080, ip: "203.0.113.21", region: "中国/香港", generic: 44, provider: 268 },
  { name: "JP 静态 01", type: "http", host: "198.51.100.7", port: 3128, ip: "198.51.100.30", region: "日本/东京", generic: 78, provider: 512, handshake: true },
  { name: "SG 静态 01", type: "socks5", host: "192.0.2.9", port: 1080, ip: "192.0.2.40", region: "新加坡", generic: 96, provider: 301 },
  { name: "US 家宽 01", type: "http", host: "192.0.2.15", port: 8888, ip: "192.0.2.50", region: "美国/洛杉矶", generic: 152, provider: 640 },
];

const proxyTester = async (proxy, options) => {
  const row = exits.find((entry) => entry.port === proxy.port && entry.host === proxy.host) || exits[0];
  if (options.target?.kind === "provider") {
    return {
      ok: true,
      provider: options.target.provider,
      host: options.target.host,
      statusCode: row.handshake ? 0 : 401,
      tlsOnly: Boolean(row.handshake),
      latency: row.provider,
      checkedAt: "2026-11-08T02:10:00.000Z",
    };
  }
  return { ok: true, exitIp: row.ip, region: row.region, latency: row.generic, checkedAt: "2026-11-08T02:10:00.000Z" };
};

const service = await startServer({
  port: 0,
  dataDir,
  env,
  proxyEndpoint: "https://ipinfo.io/json",
  proxyTimeoutMs: 500,
  proxyTester,
  environment,
  pluginScanner: scanner,
});

let browser;
try {
  const base = `http://127.0.0.1:${service.port}`;
  const pageHtml = await (await fetch(`${base}/`)).text();
  const token = /name="clean-login-token" content="([0-9a-f]+)"/.exec(pageHtml)?.[1];
  if (!token) throw new Error("page token missing");

  const api = async (path, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "x-clean-login-token": token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
    return response.json();
  };

  // Proxy rows go through the real routes, so the stored shape is the shipped one.
  const proxyIds = {};
  for (const row of exits) {
    const { proxy } = await api("/api/proxies", "POST", {
      name: row.name,
      type: row.type,
      host: row.host,
      port: row.port,
      username: "demo",
      password: "not-a-real-password",
    });
    proxyIds[row.name] = proxy.id;
    await api(`/api/proxies/${encodeURIComponent(proxy.id)}/test`, "POST");
    await api(`/api/proxies/${encodeURIComponent(proxy.id)}/test`, "POST", { provider: "qoder-cn" });
  }

  // Account ledgers, written after start-up so the orphan sweep has already
  // run, and paired with auth keys so each row reads as signed in.
  const accounts = [
    { provider: "qoder-cn", key: "qoder-cn#demo01", accountId: "demo-qoder-01", at: "2026-11-08T02:08:00.000Z", proxy: "HK 家宽 01", grade: "A" },
    { provider: "qoder-cn", key: "qoder-cn#demo02", accountId: "demo-qoder-02", at: "2026-11-08T02:07:00.000Z", proxy: "HK 家宽 02", grade: "B" },
    { provider: "workbuddy", key: "workbuddy#demo01", accountId: "demo-workbuddy-01", at: "2026-11-07T14:25:00.000Z", proxy: "SG 静态 01", grade: "A" },
    { provider: "workbuddy-ai", key: "workbuddy-ai#demo01", accountId: "demo-workbuddy-ai-01", at: "2026-11-07T09:41:00.000Z", proxy: "US 家宽 01", grade: "C" },
    { provider: "minimax-code", key: "minimax-code#demo01", accountId: "demo-minimax-01", at: "2026-11-06T07:45:00.000Z", proxy: "JP 静态 01", grade: "A" },
    { provider: "qwenwork", key: "qwenwork#demo01", accountId: "demo-qwen-01", at: "2026-11-06T21:37:00.000Z", proxy: "HK 家宽 01", grade: null },
  ];
  const authKeys = {};
  for (const account of accounts) {
    // Directory names are percent-encoded by the shipped safeSegment; writing
    // the raw key (it contains '#') would make decodeSegment reject the row.
    const dir = join(dataDir, "accounts", safeSegment(account.provider), safeSegment(account.key));
    mkdirSync(dir, { recursive: true });
    const exit = exits.find((entry) => entry.name === account.proxy);
    await writeAccountMeta(dir, {
      accountId: account.accountId,
      signedInAt: account.at,
      lastLogin: {
        at: account.at,
        proxyId: proxyIds[account.proxy],
        proxyName: account.proxy,
        region: exit.region,
        exitIp: exit.ip,
      },
      loginHistory: [],
      checks: account.grade
        ? [{
            at: account.at,
            grade: account.grade,
            proxyId: proxyIds[account.proxy],
            proxyName: account.proxy,
            region: exit.region,
            exposure: account.grade === "A" ? "low" : account.grade === "B" ? "medium" : "high",
            summary: [],
          }]
        : [],
      note: "",
    });
    // A pin the page can name. The bytes are invented; the id shown is the
    // shipped sha256 projection of them, exactly as a real pin is derived.
    writeFileSync(
      join(dir, IDENTITY_FILE),
      `${JSON.stringify({ demo: true, account: account.accountId, seed: account.key }, null, 2)}\n`,
    );
    authKeys[account.key] = { access_token: "demo-not-a-real-token", refresh_token: "demo-not-a-real-token" };
  }
  writeFileSync(join(configDir, "plugin-auth.json"), `${JSON.stringify(authKeys, null, 2)}\n`);

  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${base}/?theme=${theme}&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const shots = [];
  const shoot = async (name, tab, prepare) => {
    await page.click(`#tab-${tab}`);
    await page.waitForTimeout(350);
    if (prepare) await prepare();
    await page.screenshot({ path: join(root, "assets", name), fullPage: false });
    shots.push(name);
  };

  await shoot("screenshot-providers.png", "providers");
  await shoot("screenshot-proxies.png", "proxies", async () => {
    await page.waitForSelector("#proxy-test-target option[value='qoder-cn']", { state: "attached", timeout: 10000 });
    await page.selectOption("#proxy-test-target", "qoder-cn");
    await page.waitForTimeout(250);
  });
  await shoot("screenshot-accounts.png", "accounts");
  await shoot("screenshot-guide.png", "guide");

  const counts = await page.evaluate(() => ({
    tabs: document.querySelectorAll(".tab").length,
    guideSections: document.querySelectorAll(".guide-section").length,
    // What the browser panel actually renders, so a leak shows up in the
    // printed result rather than only in the pixels.
    environment: {
      badge: document.querySelector("#environment-badge")?.textContent || "",
      location: document.querySelector("#environment-location-value")?.textContent || "",
      disk: document.querySelector("#environment-disk-value")?.textContent || "",
    },
  }));
  const secrets = [/Administrator/i, /C:\\Users\\(?!Public)/i, /\/home\/(?!www)/];
  const leaked = secrets.filter((pattern) => pattern.test(counts.environment.location));
  if (leaked.length) {
    throw new Error(`the browser panel would publish a machine-specific path: ${counts.environment.location}`);
  }
  console.log(JSON.stringify({ lang, theme, chrome, shots, counts, browserRoot }, null, 2));
  await page.close();
} finally {
  if (browser) await browser.close();
  await service.close();
  rmSync(tmp, { recursive: true, force: true });
  if (!process.env.MAGPIE_CLEAN_LOGIN_BROWSER_DIR) {
    rmSync(join(neutralBase, "clean-login-readme-demo"), { recursive: true, force: true });
  }
}
