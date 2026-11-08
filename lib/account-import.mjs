// Account import: turn the accounts that already live in magpie into
// magpie-clean-login account directories, without ever reading, echoing or
// persisting a credential.
//
// magpie has two stores and both are read: `plugin-auth.json` (the plugins) and
// `logins.json` (every agent, including the built-in ones that exist nowhere
// else). Importing from the first alone silently dropped every built-in
// account -- see `magpie-logins.mjs`.
//
// The shape mirrors `scripts/backfill-account-meta.mjs`: an account that has no
// ledger is a "new" account and gets a directory, a pin and a ledger; an
// account that already has a ledger is left completely alone. The module is
// split in two so the read-only preview and the write path speak the same
// report:
//
//   * `planImport` is pure: it classifies entries, never touches disk and never
//     lets a credential field escape into its output.
//   * `planImportFromDisk` reads both stores and the ledgers, and returns the
//     plan. The preview route and the write path both go through it, so they
//     cannot drift into answering different questions.
//   * `importAccounts` plans, then writes the pin and the ledger for every
//     `new` item only.
//
// The whole point of `importAccounts` is that an import is NOT a sign-in: the
// ledger it writes carries `signedInAt: null`, because the auth file does not
// record when the account signed in. Claiming otherwise would be a lie the UI
// then displays.
import {
  accountDir,
  listAccountDirsWithMeta,
  writeAccountMeta as defaultWriteAccountMeta,
  ensureIdentity,
} from "./account-identity.mjs";
import { providerOf, readAuthKeysResult } from "./account-keys.mjs";
import { readNativeLoginsResult } from "./magpie-logins.mjs";
import { readAuthEntries } from "./signin-writeback.mjs";

// The report is built from a strict whitelist of non-credential fields. An
// entry may carry `access`, `refresh`, `metadata.token`, ... and every one of
// them must be dropped here, not merely hidden by the caller. This is the one
// function that turns an auth entry into something that leaves the module.
function identityOf(entry) {
  const accountId = typeof entry?.accountId === "string" ? entry.accountId : null;
  const uid = typeof entry?.uid === "string" ? entry.uid : null;
  // `email` is a display name, not a secret. `readAuthEntries` already moves
  // `metadata.email` up; a raw entry handed straight to `planImport` gets the
  // same fallback. `metadata` itself (which can hold a token) is never kept.
  const email =
    typeof entry?.email === "string"
      ? entry.email
      : typeof entry?.metadata?.email === "string"
        ? entry.metadata.email
        : null;
  return { accountId, uid, email };
}

function credentialTypeOf(entry) {
  return typeof entry?.type === "string"
    ? entry.type
    : typeof entry?.credentialType === "string"
      ? entry.credentialType
      : null;
}

// `classify(entry)` is best-effort: a provider with no known re-login path, an
// unknown provider and a throwing classifier all have to degrade to the same
// honest answer -- there is no re-login path -- rather than abort the import.
const NO_RELOGIN_REASON = "no re-login path is available for this account";

function normalizeClassify(result, fallbackReason) {
  const relogin = result && typeof result.relogin === "string" ? result.relogin : "none";
  if (relogin !== "none") return { relogin };
  const reason =
    typeof result?.reason === "string" && result.reason.length > 0
      ? result.reason
      : fallbackReason || NO_RELOGIN_REASON;
  return { relogin, reason };
}

function classifyEntry(entry, classify, fallbackReason) {
  try {
    return normalizeClassify(classify ? classify(entry) : undefined, fallbackReason);
  } catch (error) {
    // A classifier is a hint, not the import. A crash in it becomes a stated
    // "none" with the failure preserved, never a failed import.
    return { relogin: "none", reason: `classifier failed: ${String(error?.message ?? error)}` };
  }
}

// Read-only classification. Returns the report the preview route serves and the
// write path acts on:
//
//   existing  the key already owns a ledger (matched by `meta.key`); nothing
//             about it must be touched.
//   skipped   no identity field (accountId/uid/email) at all, so there is
//             nothing to attribute the directory to.
//   new       everything else.
//
// `authKeys` is accepted for the route's benefit (a caller can restrict the
// plan to keys that still exist in the auth file); classification itself is
// driven by the ledger and the identity fields.
export function planImport({ entries, ledgers, authKeys, classify, sources = null } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const ledgerKeys = new Set();
  for (const ledger of Array.isArray(ledgers) ? ledgers : []) {
    const key = ledger?.meta?.key ?? ledger?.key;
    if (typeof key === "string") ledgerKeys.add(key);
  }

  const items = [];
  const counts = { new: 0, existing: 0, skipped: 0 };

  for (const entry of list) {
    const key = typeof entry?.key === "string" ? entry.key : String(entry?.key ?? "");
    const provider = providerOf(key);
    const { accountId, uid, email } = identityOf(entry);
    const credentialType = credentialTypeOf(entry);

    let state;
    if (ledgerKeys.has(key)) {
      state = "existing";
    } else if (accountId === null && uid === null && email === null) {
      state = "skipped";
    } else {
      state = "new";
    }

    counts[state] += 1;

    if (state === "skipped") {
      // A skipped entry can never be re-logged-in into: it has no identity to
      // sign in as. Say so, with a reason, rather than pretending.
      items.push({
        provider,
        key,
        accountId,
        uid,
        email,
        credentialType,
        state,
        relogin: "none",
        reason: "no account identity (accountId, uid or email) to import",
      });
      continue;
    }

    const decision = classifyEntry(entry, classify, NO_RELOGIN_REASON);
    const item = {
      provider,
      key,
      accountId,
      uid,
      email,
      credentialType,
      state,
      relogin: decision.relogin,
    };
    // `reason` is only ever allowed when relogin is "none"; a "plugin"/"native"
    // item has the exact pinned shape and no extra key.
    if (decision.relogin === "none") item.reason = decision.reason;
    items.push(item);
  }

  // `sources` states which stores the plan actually saw, so "no built-in
  // accounts" and "the built-in ledger was not there to read" stay visibly
  // different instead of both rendering as an empty list.
  return { items, counts, sources };
}

// Both stores with a verdict. `readAuthEntries` deliberately swallows a read
// failure into `{}`; the import must not: an unreadable auth file is not "no
// accounts", it is "cannot answer", and the routes turn this into a 409.
function readAuthFromDisk(env) {
  const result = readAuthKeysResult(env);
  if (!result.ok) {
    const error = new Error(`plugin-auth.json could not be read (${result.reason})`);
    error.code = result.reason;
    throw error;
  }

  const native = readNativeLoginsResult(env);
  // A magpie that has never recorded a login has no `logins.json`; that is a
  // real "no built-in accounts" state, and refusing the whole import over it
  // would break every plugin-only install. Every *other* failure is a refusal:
  // an unreadable or malformed ledger must never be mistaken for "this user
  // has no built-in accounts". Missing is ENOENT and nothing else.
  if (!native.ok && native.reason !== "logins_missing") {
    const error = new Error(`logins.json could not be read (${native.reason})`);
    error.code = native.reason;
    throw error;
  }

  const nativeEntries = native.ok ? native.entries : [];
  const authKeys = new Set(result.keys);
  for (const key of native.ok ? native.keys : []) authKeys.add(key);

  return {
    entries: [...entriesToArray(readAuthEntries(env)), ...nativeEntries],
    authKeys,
    sources: { auth: "ok", logins: native.ok ? "ok" : "missing" },
  };
}

function entriesToArray(entriesObject) {
  return Object.entries(entriesObject ?? {}).map(([key, value]) => ({ ...(value ?? {}), key }));
}

function restrictToKeys(entries, authKeys, keys) {
  if (keys === undefined || keys === null) return { entries, authKeys };
  const wanted = new Set(
    (Array.isArray(keys) ? keys : [...keys]).filter((key) => typeof key === "string"),
  );
  return {
    entries: entries.filter((entry) => wanted.has(entry.key)),
    authKeys: new Set([...authKeys].filter((key) => wanted.has(key))),
  };
}

// The one read path both routes share: both stores, the ledgers already on
// disk, and the plan. `keys` narrows the plan to a caller's selection *after*
// the merge, so selecting a built-in account cannot silently drop it.
export async function planImportFromDisk(env = process.env, { classify, keys } = {}) {
  const auth = readAuthFromDisk(env);
  const dirs = await listAccountDirsWithMeta(env);
  const ledgers = dirs.map((account) => account.meta).filter(Boolean);
  const selected = restrictToKeys(auth.entries, auth.authKeys, keys);
  return planImport({
    entries: selected.entries,
    ledgers,
    authKeys: selected.authKeys,
    classify,
    sources: auth.sources,
  });
}

// Plan, then materialize every `new` item: create the account directory, draw
// the initial pin via `ensureIdentity` (which is a no-op once a pin exists) and
// write the ledger. `existing` and `skipped` items are never written to.
//
// Every dependency is injectable with a real default: `generate` for the pin,
// `classify`, `writeAccountMeta`, `readEntries`, `keys` and `now`. The returned
// report is exactly the `planImport` report.
export async function importAccounts(env = process.env, deps = {}) {
  const {
    generate,
    classify,
    writeAccountMeta: writeMeta = defaultWriteAccountMeta,
    readEntries,
    keys,
  } = deps;
  // `deps.now` is accepted for callers that want a deterministic clock, but the
  // import deliberately records `signedInAt: null` (an import is not a
  // sign-in), so the clock is never consulted here.
  void deps.now;

  let plan;
  if (typeof readEntries === "function") {
    const entriesObject = await readEntries(env);
    const dirs = await listAccountDirsWithMeta(env);
    const selected = restrictToKeys(
      entriesToArray(entriesObject),
      new Set(Object.keys(entriesObject ?? {})),
      keys,
    );
    plan = planImport({
      entries: selected.entries,
      ledgers: dirs.map((account) => account.meta).filter(Boolean),
      authKeys: selected.authKeys,
      classify,
      // An injected reader replaces the disk read entirely; saying "ok" about
      // stores that were never opened would be a claim this path cannot make.
      sources: { auth: "injected", logins: "injected" },
    });
  } else {
    plan = await planImportFromDisk(env, { classify, keys });
  }

  for (const item of plan.items) {
    if (item.state !== "new") continue;
    const dir = accountDir(env, item.provider, item.key);
    await ensureIdentity(dir, generate ? { generate } : {});
    await writeMeta(dir, {
      version: 1,
      provider: item.provider,
      key: item.key,
      accountId: item.accountId,
      uid: item.uid,
      // Honest: importing is not a sign-in and the auth file does not record
      // when the account last signed in.
      signedInAt: null,
    });
  }

  return plan;
}
