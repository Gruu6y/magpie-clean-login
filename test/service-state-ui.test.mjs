// The footer's service-state indicator follows the API layer, not just the
// bootstrap. Read-file style, like the other UI guards: what is pinned is the
// wiring inside api() itself -- a fetch rejection or a 5xx flips the footer to
// "error" and shows Retry, the next 2xx restores "ready", and a refused
// request (4xx) or an aborted one is not treated as a dead service.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "ui", "app.js"), "utf8").replaceAll("\r\n", "\n");
const html = readFileSync(join(root, "ui", "index.html"), "utf8").replaceAll("\r\n", "\n");
const css = readFileSync(join(root, "ui", "style.css"), "utf8");

// The body of api(), from its declaration to the closing brace.
const apiBody = app.slice(app.indexOf("async function api("));
const body = apiBody.slice(0, apiBody.indexOf("\n}\n"));

test("api() marks the service down on a fetch rejection and back up on a 2xx", () => {
  // The only liveness signal the page has is its own request: api() is where
  // it must be read, not in bootstrap alone.
  expect(body).toContain("markServiceDown();");
  expect(body).toContain("markServiceUp();");
  // A rejected fetch is the network-failure path.
  const catchBlock = body.slice(body.indexOf("} catch (error) {"), body.indexOf("wrapped"));
  expect(catchBlock).toContain('error?.name === "AbortError"');
  expect(catchBlock).toContain("markServiceDown();");
  // A 5xx is a dead service; a 4xx is a refused request and changes nothing.
  expect(body).toContain("if (response.status >= 500) markServiceDown();");
  // The successful path is the last thing the function does before returning.
  expect(body).toMatch(/markServiceUp\(\);\s*\n\s*return data;/);
});

test("the error state is the one the stylesheet draws, with a retry affordance", () => {
  // The CSS paints data-state="error", never a "failed" state that nothing
  // would ever match.
  expect(app).toContain('setServiceState("error", text.failed)');
  expect(app).toContain('setServiceState("ready", text.ready)');
  expect(app).not.toContain('setServiceState("failed"');
  expect(css).toContain('.service-state[data-state="error"]');
  // Down shows Retry, up hides it.
  expect(app).toContain('byId("retry").hidden = false');
  expect(app).toContain('byId("retry").hidden = true');
});

test("the page carries an inline favicon so the sandbox never requests one", () => {
  // magpie's frame has no origin, so /favicon.ico used to 404 on every load.
  // A data-URL icon needs no request at all.
  expect(html).toMatch(/<link\b[^>]*rel="icon"[^>]*>/);
  expect(html).toMatch(/rel="icon"\s+href="data:image\/svg\+xml,/);
});
