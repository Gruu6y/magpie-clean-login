// F-4: the proxy dialog's apiErrorText() must name every server code the
// proxy routes can return, and `invalid_name` carries several distinct server
// messages ("required", "too long", "must not contain < or >") that one
// localized string cannot cover -- the server's own message wins when present.
// app.js runs only in the browser, so the message table, the code map and the
// function itself are lifted out of the source and evaluated, the same way
// the other UI tests read app.js as text.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8");

function literalAfter(marker) {
  const match = new RegExp(`${marker}\\s*=\\s*(\\{[\\s\\S]*?\\n\\};)`).exec(app);
  if (!match) throw new Error(`${marker} not found in ui/app.js`);
  return new Function(`return ${match[1].replace(/;$/, "")}`)();
}

const messages = literalAfter("const messages");
const errorKeys = literalAfter("const errorKeys");

const fnMatch = /function apiErrorText\(error\) \{[\s\S]*?\n\}/.exec(app);
if (!fnMatch) throw new Error("apiErrorText not found in ui/app.js");

// Rebuild the real function against a chosen locale table.
const apiErrorTextFor = (lang) =>
  new Function("text", "errorKeys", `${fnMatch[0]}; return apiErrorText;`)(
    messages[lang],
    errorKeys,
  );

const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja"];

describe("proxy apiErrorText covers every locale and code", () => {
  test("the four locale tables each define errorNameTaken", () => {
    for (const lang of LOCALES) {
      expect(typeof messages[lang].errorNameTaken).toBe("string");
      expect(messages[lang].errorNameTaken.length).toBeGreaterThan(0);
      // It must not be a lazy copy of the generic failure line.
      expect(messages[lang].errorNameTaken).not.toBe(messages[lang].errorGeneric);
    }
  });

  test("name_taken is mapped and renders the localized conflict, not the generic failure", () => {
    expect(errorKeys.name_taken).toBe("errorNameTaken");
    for (const lang of LOCALES) {
      const apiErrorText = apiErrorTextFor(lang);
      const rendered = apiErrorText({ code: "name_taken", serverMessage: "A proxy with that name already exists." });
      expect(rendered).toBe(messages[lang].errorNameTaken);
      expect(rendered).not.toBe(messages[lang].errorGeneric);
    }
  });

  test("invalid_name prefers the server's own message so '<' names do not read as 'enter a name'", () => {
    for (const lang of LOCALES) {
      const apiErrorText = apiErrorTextFor(lang);
      expect(
        apiErrorText({ code: "invalid_name", serverMessage: "Name must not contain < or >." }),
      ).toBe("Name must not contain < or >.");
      // With no server detail the localized fallback still applies.
      expect(apiErrorText({ code: "invalid_name" })).toBe(messages[lang].errorInvalidName);
      expect(apiErrorText({ code: "invalid_name", serverMessage: "" })).toBe(
        messages[lang].errorInvalidName,
      );
    }
  });

  test("unmapped codes still fall back to the generic failure", () => {
    for (const lang of LOCALES) {
      const apiErrorText = apiErrorTextFor(lang);
      expect(apiErrorText({ code: "something_new" })).toBe(messages[lang].errorGeneric);
      expect(apiErrorText({})).toBe(messages[lang].errorGeneric);
      expect(apiErrorText(undefined)).toBe(messages[lang].errorGeneric);
      // A string argument (serverErrorText also serves plain message strings)
      // must not throw.
      expect(apiErrorText("plain message")).toBe(messages[lang].errorGeneric);
    }
  });
});
