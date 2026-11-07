// A provider card wears magpie's own mark for that provider. Nothing here
// draws a logo: the names come from magpie's tables and the files come out of
// the installed magpie binary, read by `scripts/build-icons.mjs`. Every rule
// below keeps those two from drifting into a brand nobody chose.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ICON_URL_BASE,
  USER_ICON_NAME,
  USER_ICON_URL_BASE,
  iconNameCandidates,
  loadIconManifest,
  providerLogo,
  readIconRefs,
  userIcon,
  userIconType,
} from "../lib/provider-icons.mjs";
import { listProviders } from "../lib/provider-registry.mjs";

const root = join(import.meta.dirname, "..");
const shelf = { refs: new Map() };

// What the name rules alone reach, on a machine with no magpie tables at all.
// Each of these is a brand the user is shown on every run, so a silent miss is
// the one failure here worth failing over. `picture` and `mark` are magpie's own
// distinction: a `-color` name carries its colours, anything else is redrawn in
// the text colour so it reads in both themes.
const BY_NAME = {
  antigravity: ["antigravity-color", "picture"],
  codex: ["codex-color", "picture"],
  claude: ["claude-color", "picture"],
  openai: ["openai", "mark"],
  anthropic: ["anthropic", "mark"],
  gemini: ["gemini-color", "picture"],
  xai: ["xai", "mark"],
  github: ["github", "mark"],
  deepseek: ["deepseek-color", "picture"],
  minimax: ["minimax-color", "picture"],
  kiro: ["kiro-color", "picture"],
  "github-copilot": ["githubcopilot", "mark"],
  "sensenova-token-plan": ["sensenova-color", "picture"],
  "cloudflare-workers-ai": ["cloudflare-color", "picture"],
  "bedrock-sso": ["bedrock-color", "picture"],
  "trae-cn": ["trae", "mark"],
  "opencode-zen-free": ["opencode", "mark"],
  "xiaomi-mimo": ["xiaomimimo", "mark"],
};

describe("a provider finds magpie's mark for itself", () => {
  test("the names this plugin is responsible for are names on the shelf", () => {
    const manifest = loadIconManifest();
    for (const [id, [ref, kind]] of Object.entries(BY_NAME)) {
      const found = providerLogo({ id }, shelf);
      expect(found?.ref, `${id} should read as ${ref}`).toBe(ref);
      expect(found.kind, `${ref} should be drawn the way magpie draws it`).toBe(kind);
      expect(found.src).toBe(`${ICON_URL_BASE}${manifest.icons[ref].file}`);
    }
  });

  test("every provider this plugin ships reaches a logo", () => {
    for (const provider of listProviders()) {
      const found = providerLogo(provider, shelf);
      expect(found, `${provider.id} should not fall back to a letter`).not.toBeNull();
    }
  });

  test("an id nobody has a mark for is left without one, never given a stranger's", () => {
    expect(providerLogo({ id: "not-a-company-anywhere" }, shelf)).toBeNull();
    expect(providerLogo({}, shelf)).toBeNull();
    expect(providerLogo(null, shelf)).toBeNull();
  });

  test("magpie's own naming wins over what a rule could guess", () => {
    // magpie sells a Xiaomi offering under MiMo Code, not under Xiaomi's mark.
    // A reference in magpie's table is what the user sees in magpie, so the
    // page shows the same thing and never a name it made up itself.
    const refs = new Map([["xiaomi", { ref: "mimocode", origin: "preset" }]]);
    expect(providerLogo({ id: "xiaomi", name: "Xiaomi" }, { refs }).ref).toBe("mimocode");
    // A table entry for a brand nobody vendored costs a logo, not a guess: the
    // id's own name is still tried, and what is not on the shelf is not shown.
    expect(providerLogo({ id: "made-up-vendor", name: "Made Up Vendor" }, {
      refs: new Map([["made-up-vendor", { ref: "never-vendored", origin: "preset" }]]),
    })).toBeNull();
  });

  test("a picture magpie downloaded is used only while the file is there", () => {
    const tmp = mkdtempSync(join(tmpdir(), "clean-login-icon-missing-"));
    const refs = new Map([["someone", { ref: "file:0123456789abcdef.png", origin: "provider" }]]);
    expect(providerLogo({ id: "someone" }, { refs, iconsDir: join(tmp, "icons") })).toBeNull();
    mkdirSync(join(tmp, "icons"), { recursive: true });
    writeFileSync(join(tmp, "icons", "0123456789abcdef.png"), "not really a png");
    expect(providerLogo({ id: "someone" }, { refs, iconsDir: join(tmp, "icons") })).toEqual({
      src: `${USER_ICON_URL_BASE}0123456789abcdef.png`,
      kind: "picture",
      ref: "file:0123456789abcdef.png",
    });
  });

  test("a shelf that was never built costs every logo and nothing else", () => {
    expect(loadIconManifest(join(root, "test"))).toBeNull();
    expect(providerLogo({ id: "openai" }, { refs: new Map(), manifest: null })).toBeNull();
  });
});

describe("the name rules that reach a mark magpie never wrote down", () => {
  test("a suffix that belongs to another brand is never split off it", () => {
    // "opencode-zen-free" is OpenCode's free tier; "zen" alone is a different
    // company. Dropping a tail has to stop at a whole word.
    expect(iconNameCandidates("opencode-zen-free", "")).toContain("opencode");
    expect(iconNameCandidates("opencode-zen-free", "")).not.toContain("zen");
    expect(iconNameCandidates("sensenova-token-plan", "")).toContain("sensenova");
    expect(iconNameCandidates("sensenova-token-plan", "")).not.toContain("token");
  });

  test("a dropped tail of four characters or more may borrow, a short one may not", () => {
    expect(iconNameCandidates("xiaomi-mimo", "")).toContain("xiaomi");
    expect(iconNameCandidates("agy-cli", "")).not.toContain("agy");
    expect(iconNameCandidates("qhl25133", "")).not.toContain("qhl");
  });

  test("an official spaced name reaches the hyphenated icon name", () => {
    expect(iconNameCandidates("made-up-id", "GitHub Copilot")).toContain("githubcopilot");
    expect(iconNameCandidates("mimo-app", "Xiaomi MiMo")).toContain("xiaomimimo");
    expect(providerLogo({ id: "mimo-app", name: "Xiaomi MiMo" }, shelf).ref).toBe("xiaomimimo");
    expect(providerLogo({ id: "agy-cli", name: "Antigravity (local agy)" }, shelf).ref).toBe("antigravity-color");
  });

  test("nothing a stranger's brand could be is tried for an unknown name", () => {
    expect(iconNameCandidates("", "")).toEqual([]);
    expect(providerLogo({ id: "totally-made-up-xyz", name: "Totally Made Up" }, shelf)).toBeNull();
  });
});

describe("the shelf itself", () => {
  const list = JSON.parse(readFileSync(join(root, "assets", "icons", "index.json"), "utf8"));

  test("every entry names a file that sits beside the list", () => {
    expect(list.icons).toBeObject();
    // magpie's whole set is a little over half a megabyte; a shelf that lost
    // most of it would still pass "is an object" and cost every logo quietly.
    expect(Object.keys(list.icons).length).toBe(list.count);
    expect(list.count).toBeGreaterThan(150);
    for (const [name, entry] of Object.entries(list.icons)) {
      expect(existsSync(join(root, "assets", "icons", entry.file))).toBe(true);
      expect(entry.file.startsWith(`${name}.`)).toBe(true);
      expect(name).toBe(name.toLowerCase());
      // A name becomes a URL segment, so it may carry magpie's hyphens and
      // nothing that could walk out of the folder.
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    // The other direction. A file the list does not know about is a file no
    // card can ask for, and a listed name the folder does not hold is a card
    // that quietly loses its mark: the same mistake, so both fail.
    const onDisk = readdirSync(join(root, "assets", "icons"))
      .filter((file) => /\.(?:svg|png)$/.test(file))
      .sort();
    expect(onDisk).toEqual(Object.values(list.icons).map((entry) => entry.file).sort());
  });

  test("the two marks a content guess dropped are on the shelf", () => {
    // Carving the binary by `<svg ... </svg>` lost exactly these two: one wraps
    // a base64 png, one is a tile, and both read as the UI artwork around them.
    // The builder follows magpie's own embed records now, so they stay.
    for (const name of ["liveagent-color", "openmausbot"]) {
      const entry = list.icons[name];
      expect(entry, name).toBeObject();
      expect(entry.kind, name).toBe("picture");
      expect(entry.bytes, name).toBeGreaterThan(1000);
    }
  });

  test("every mark can be recoloured, which is the only reason it is a mark", () => {
    for (const [name, entry] of Object.entries(list.icons)) {
      if (entry.kind !== "mark") continue;
      expect(entry.file.endsWith(".svg"), name).toBe(true);
      const svg = readFileSync(join(root, "assets", "icons", entry.file), "utf8");
      expect(svg, `${name} should be a shape drawn in the text colour`).toContain("currentColor");
      expect(svg).not.toMatch(/#([0-9a-f]{3,8})\b/i);
    }
  });

  test("a picture is a picture because that is how the file is drawn", () => {
    for (const [name, entry] of Object.entries(list.icons)) {
      // magpie's own rule — a `-color` name or one of the raster marks — plus
      // the one thing that rule cannot see: whether the file carries colours
      // of its own. Masking those would paint a brand's art flat.
      const expected =
        name.endsWith("-color") || list.pngIcons.includes(name) || !entry.file.endsWith(".svg")
          ? "picture"
          : undefined;
      if (expected) expect(entry.kind, name).toBe("picture");
      else expect(["picture", "mark"], name).toContain(entry.kind);
    }
  });

  test("where the shelf came from is written down, and can be checked", () => {
    expect(list.source.project).toBe("magpie");
    // The prefix magpie's own binary carries for every one of these names: the
    // builder refuses to write a manifest the binary does not agree to.
    expect(list.source.path).toBe("assets/icons");
    expect(list.source.notices).toBe("NOTICES.md");
    expect(existsSync(join(root, "assets", "icons", list.source.notices))).toBe(true);
    // 40 hex, because that is what a Go build info revision is; a short hash
    // here would be a somebody-typed number, not the one the binary reports.
    expect(list.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(list.source.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(list.source.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(list.count).toBe(Object.keys(list.icons).length);
    for (const [name, entry] of Object.entries(list.icons)) {
      const file = readFileSync(join(root, "assets", "icons", entry.file));
      expect(entry.bytes).toBe(file.length);
      // The digest is truncated in the list, and that is enough: it is here to
      // notice a file that changed under the manifest, not to sign it.
      expect(entry.sha256.length).toBeGreaterThan(7);
      expect(createHash("sha256").update(file).digest("hex").startsWith(entry.sha256)).toBe(true);
    }
  });

  test("nothing on the shelf is a wordmark", () => {
    // A tile this small cannot hold a readable word, and simple-icons' word
    // variants are the ones that break when recoloured.
    for (const name of Object.keys(list.icons)) expect(name.endsWith("text")).toBe(false);
  });
});

describe("magpie's downloaded pictures are only read from magpie's icon folder", () => {
  const tmp = mkdtempSync(join(tmpdir(), "clean-login-icon-files-"));
  const icons = join(tmp, "icons");
  mkdirSync(icons, { recursive: true });
  writeFileSync(join(icons, "0123456789abcdef.png"), "png");
  writeFileSync(join(icons, "fedcba9876543210.svg"), "<svg/>");
  let linked = true;
  try {
    symlinkSync(join(icons, "0123456789abcdef.png"), join(icons, "aaaaaaaaaaaaaaaa.png"));
  } catch {
    linked = false;
  }

  test("only the hash form magpie uses is a name at all", () => {
    expect(USER_ICON_NAME.test("0123456789abcdef.png")).toBe(true);
    for (const rejected of ["../../etc/passwd", "0123456789abcdef.exe", "notes.txt", "", "0123456789abcde.png"]) {
      expect(USER_ICON_NAME.test(rejected), rejected).toBe(false);
    }
  });

  test("a picture is served as a picture, whatever it is made of", () => {
    expect(userIcon("file:0123456789abcdef.png", { iconsDir: icons })).toEqual({
      src: `${USER_ICON_URL_BASE}0123456789abcdef.png`,
      kind: "picture",
      ref: "file:0123456789abcdef.png",
    });
    // An SVG magpie downloaded is shown as magpie downloaded it. Redrawing it
    // in ink is only ever done to a mark whose colours are known.
    expect(userIcon("file:fedcba9876543210.svg", { iconsDir: icons }).kind).toBe("picture");
    expect(userIconType("fedcba9876543210.svg")).toBe("image/svg+xml");
    expect(userIconType("0123456789abcdef.png")).toBe("image/png");
    expect(userIconType("0123456789abcdef.exe")).toBeNull();
  });

  test("a name that points anywhere but here is refused", () => {
    expect(userIcon("file:../0123456789abcdef.png", { iconsDir: icons })).toBeNull();
    expect(userIcon("file:0123456789abcdef.png", { iconsDir: join(tmp, "nowhere") })).toBeNull();
    expect(userIcon("not-a-file-reference", { iconsDir: icons })).toBeNull();
  });

  test("a link is not magpie's file, even when it lands on one", { skip: !linked }, () => {
    expect(userIcon("file:aaaaaaaaaaaaaaaa.png", { iconsDir: icons })).toBeNull();
  });

  test("magpie's table is re-read only when it moved", () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-login-icon-state-"));
    expect(readIconRefs({ MAGPIE_CACHE_DIR: dir }).available).toBe(false);
    const write = (icon) => writeFileSync(
      join(dir, "providers-state.json"),
      JSON.stringify({ providers: { providers: [{ id: "someone", name: "Some One", icon }] } }),
    );
    write("openai");
    const first = readIconRefs({ MAGPIE_CACHE_DIR: dir });
    expect(first.available).toBe(true);
    expect(first.refs.get("someone")).toEqual({ ref: "openai", origin: "provider" });
    // The same bytes again cost nothing: this file is magpie's and it is big.
    expect(readIconRefs({ MAGPIE_CACHE_DIR: dir }).refs.get("someone")).toBe(first.refs.get("someone"));
    // A longer second name, on purpose: the re-read is keyed on the file's size
    // and mtime, and two writes of the same length inside one clock tick would
    // otherwise test the cache instead of the change.
    write("gemini-pro");
    expect(readIconRefs({ MAGPIE_CACHE_DIR: dir }).refs.get("someone").ref).toBe("gemini-pro");
  });

  test("magpie's own `generic` is magpie saying it has no mark", () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-login-icon-generic-"));
    writeFileSync(
      join(dir, "providers-state.json"),
      JSON.stringify({ providers: { providers: [{ id: "someone", icon: "generic" }, { id: "else", icon: "" }] } }),
    );
    const { refs } = readIconRefs({ MAGPIE_CACHE_DIR: dir });
    expect(refs.has("someone")).toBe(false);
    expect(refs.has("else")).toBe(false);
  });

  test("a machine with no magpie table still gets its marks by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-login-icon-cold-"));
    const { available, refs } = readIconRefs({ MAGPIE_CACHE_DIR: dir });
    expect(available).toBe(false);
    expect(refs.size).toBe(0);
    expect(providerLogo({ id: "codex" }, { refs }).ref).toBe("codex-color");
  });
});

describe("the page swaps the letter for the mark, and only for the mark", () => {
  const app = readFileSync(join(root, "ui", "app.js"), "utf8");
  const css = readFileSync(join(root, "ui", "style.css"), "utf8");
  const server = readFileSync(join(root, "lib", "server.mjs"), "utf8");

  test("a card builds its mark from the logo the service named", () => {
    expect(app).toContain("providerLogoElement(provider.logo");
    expect(app).toContain('mark.className = "provider-mark has-logo"');
    // The letter is written first and replaced only once a mark exists, so a
    // card never renders empty.
    expect(app).toMatch(/mark\.textContent = provider\.mark\?\.text[\s\S]{0,700}if \(logo\) \{/);
  });

  test("a mark is drawn in the text colour, a picture is shown as it came", () => {
    expect(app).toContain('glyph.className = "provider-logo glyph"');
    expect(app).toContain('image.className = "provider-logo"');
    expect(css).toContain("-webkit-mask: var(--logo) center / contain no-repeat;");
    expect(css).toContain("mask: var(--logo) center / contain no-repeat;");
    expect(css).toContain("background: currentColor;");
    expect(css).toContain("object-fit: contain;");
    // The tile the letter used is the tile the mark gets: one column of marks.
    expect(css).toContain(".provider-mark.has-logo");
  });

  test("the cards the page draws carry their mark", () => {
    expect(server).toMatch(/providers: withLogos\(listProviders\(\)\)/);
    expect(server).toMatch(/providers: withLogos\(merged\.providers\)/);
    expect(ICON_URL_BASE).toBe("assets/icons/");
  });

  test("the service hands out magpie's picture and nothing else from that folder", () => {
    // It answers before the page token gate, because an `<img>` cannot carry
    // that header — which is why the accepted name is one hash in one folder.
    const at = server.indexOf("url.pathname.startsWith(`/${USER_ICON_URL_BASE}`)");
    const gate = server.indexOf('url.pathname.startsWith("/api/") && !tokenMatches');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(gate);
    expect(server).toContain("decodeUserIconName");
    expect(server).toContain('"x-content-type-options": "nosniff"');
    expect(server).toContain('"referrer-policy": "no-referrer"');
  });
});
