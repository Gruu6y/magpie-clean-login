// The isolated login browser's host process.
//
// It is forked by `launchSignInBrowser` and reads its JSON payload from
// stdin. It imports camoufox, opens the persistent profile and the
// sign-in URL, tells the parent it is ready, and then stays alive holding the
// browser until the parent asks it to close. Everything that imports the
// browser stack lives here, not in the service process.

import { navigationWarning, openSignInBrowser } from "./browser-launcher.mjs";

// The launch input arrives on stdin, not as a file path: it can carry a proxy
// credential, and a credential never belongs in a file inside the profile
// directory. The parent ends the stream after one JSON line.
async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const line = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(line.trim() || "{}");
}

function send(message) {
  try {
    process.send?.(message);
  } catch {
    // The parent is gone; the process is about to exit anyway.
  }
}

async function main() {
  let handle;
  try {
    const payload = await readPayload();
    handle = await openSignInBrowser(payload);
  } catch (error) {
    send({
      type: "error",
      code: typeof error?.code === "string" ? error.code : "launch_failed",
      status: Number.isFinite(error?.status) ? error.status : 502,
      message: String(error?.message ?? error),
    });
    process.exitCode = 1;
    return;
  }

  const warning = navigationWarning(handle?.navigationError);
  send({ type: "ready", pid: process.pid, ...(warning ? { warning } : {}) });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await handle.close();
    process.exit(0);
  };
  // A persistent Firefox profile holds a lock while the window is open; a
  // forced exit leaves it behind, so close it first whenever we can.
  process.on("message", (message) => {
    if (message?.type === "close") shutdown();
  });
  process.on("disconnect", shutdown);
  handle.context?.on?.("close", () => process.exit(0));
}

main();
