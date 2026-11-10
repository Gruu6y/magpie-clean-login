import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const ASSET_FILE_NAME = "assets.json";
// The four kinds of asset this registry knows how to label. A type is part of
// the data contract with the page and is validated again on read, so a hand
// edited file cannot smuggle in a fifth kind.
export const ASSET_TYPES = ["google-mail", "microsoft-mail", "cn-phone", "apple-id"];
// The account cap the page mirrors in its markup and its own validator.
export const ASSET_ACCOUNT_MAX = 254;

const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CN_PHONE = /^1[3-9]\d{9}$/;
const LIMITS = {
  account: ASSET_ACCOUNT_MAX,
  note: 200,
  id: 128,
  timestamp: 40,
};

export class AssetInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AssetInputError";
    this.code = code;
    this.status = status;
  }
}

function objectBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssetInputError("invalid_body", "Request body must be a JSON object.");
  }
  return value;
}

function readText(value, { field, code, max, required = false, trim = true, control = true }) {
  if (value === undefined || value === null) {
    if (required) throw new AssetInputError(code, `${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new AssetInputError(code, `${field} must be text.`);
  const result = trim ? value.trim() : value;
  if (required && !result) throw new AssetInputError(code, `${field} is required.`);
  if (result.length > max) throw new AssetInputError(code, `${field} is too long.`);
  if (control && CONTROL.test(result)) {
    throw new AssetInputError(code, `${field} must not contain control characters.`);
  }
  return result;
}

function readType(value, required = false) {
  const type = readText(value, {
    field: "Type",
    code: "invalid_type",
    max: 32,
    required,
  }).toLowerCase();
  if (!type) {
    if (required) throw new AssetInputError("invalid_type", "Type is required.");
    return "";
  }
  if (!ASSET_TYPES.includes(type)) {
    throw new AssetInputError("invalid_type", `Type must be one of ${ASSET_TYPES.join(", ")}.`);
  }
  return type;
}

// Format and canonicalise an account for its type. Email-shaped types keep the
// address verbatim (already trimmed by the caller); a phone number is stored
// as the bare 11 digits so the page never has to guess at spacing. The page
// carries its own copy of this rule; the two deliberately do not share a file.
export function normalizeAssetAccount(type, account) {
  if (!ASSET_TYPES.includes(type)) {
    throw new AssetInputError("invalid_type", `Type must be one of ${ASSET_TYPES.join(", ")}.`);
  }
  if (typeof account !== "string") {
    throw new AssetInputError("invalid_account", "Account must be text.");
  }
  if (type === "cn-phone") {
    const digits = account.replace(/[\s-]/g, "");
    if (!CN_PHONE.test(digits)) {
      throw new AssetInputError(
        "invalid_account",
        "Account must be a Chinese mainland mobile number.",
      );
    }
    return digits;
  }
  if (!EMAIL.test(account)) {
    throw new AssetInputError("invalid_account", "Account must be an email address.");
  }
  return account;
}

function readAccount(value, type, required = false) {
  const account = readText(value, {
    field: "Account",
    code: "invalid_account",
    max: LIMITS.account,
    required,
  });
  if (!account) {
    if (required) throw new AssetInputError("invalid_account", "Account is required.");
    return "";
  }
  return normalizeAssetAccount(type, account);
}

function readNote(value) {
  return readText(value, {
    field: "Note",
    code: "invalid_note",
    max: LIMITS.note,
  });
}

export function validateCreate(body) {
  const input = objectBody(body);
  const type = readType(input.type, true);
  const account = readAccount(input.account, type, true);
  const note = readNote(input.note);
  return { type, account, note };
}

export function validateUpdate(body) {
  const input = objectBody(body);
  const changes = {};
  if ("type" in input) changes.type = readType(input.type, true);
  if ("account" in input) {
    // Only the shape and bounds are checked here. The format depends on the
    // final type, which the caller knows after merging a type change, so the
    // route re-runs normalizeAssetAccount on the merged record.
    changes.account = readText(input.account, {
      field: "Account",
      code: "invalid_account",
      max: LIMITS.account,
      required: true,
    });
  }
  if ("note" in input) changes.note = readNote(input.note);
  if (!Object.keys(changes).length) {
    throw new AssetInputError("invalid_body", "No asset fields were provided.");
  }
  return changes;
}

export function publicAsset(record) {
  return {
    id: record.id,
    type: record.type,
    account: record.account,
    note: record.note || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function timestampOr(value, fallback) {
  return typeof value === "string" && value.length <= LIMITS.timestamp ? value : fallback;
}

// A stored row is re-validated through the same `validateCreate` the API uses,
// so a file that was edited by hand, or written by an older build, loses only
// the entries it can no longer vouch for instead of failing the whole load.
function normalizeStored(raw, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id =
    typeof raw.id === "string" && raw.id && raw.id.length <= LIMITS.id && !CONTROL.test(raw.id)
      ? raw.id
      : "";
  if (!id) return null;
  try {
    const fields = validateCreate({ type: raw.type, account: raw.account, note: raw.note });
    return {
      id,
      ...fields,
      createdAt: timestampOr(raw.createdAt, now),
      updatedAt: timestampOr(raw.updatedAt, now),
    };
  } catch {
    return null;
  }
}

export function createAssetStore({ dataDir }) {
  const file = join(dataDir, ASSET_FILE_NAME);
  let records = [];
  let loaded = false;
  let loading = null;
  let chain = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    if (!loading) {
      loading = (async () => {
        const now = new Date().toISOString();
        let text;
        try {
          text = await readFile(file, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") {
            records = [];
            loaded = true;
            return;
          }
          throw error;
        }
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("The asset data file is not valid JSON.");
        }
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : [];
        const seen = new Set();
        records = [];
        for (const item of list) {
          const record = normalizeStored(item, now);
          if (!record || seen.has(record.id)) continue;
          seen.add(record.id);
          records.push(record);
        }
        loaded = true;
      })().finally(() => {
        loading = null;
      });
    }
    await loading;
  }

  function run(work) {
    const next = chain.then(async () => {
      await ensureLoaded();
      return work();
    });
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function writeAtomic() {
    const payload = `${JSON.stringify({ version: 1, assets: records }, null, 2)}\n`;
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    try {
      await chmod(dataDir, 0o700);
    } catch {
      // Windows and some filesystems do not implement POSIX modes. The file
      // still lives in the plugin's private data directory.
    }
    const temp = join(dataDir, `.${ASSET_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await chmod(temp, 0o600);
      } catch {
        // See the directory-mode note above.
      }
      try {
        await rename(temp, file);
      } catch (error) {
        if (!["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"].includes(error?.code)) throw error;
        await rm(file, { force: true });
        await rename(temp, file);
      }
      try {
        await chmod(file, 0o600);
      } catch {
        // See the directory-mode note above.
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  return {
    file,
    // Newest first. The timestamp is fixed at creation, so the order is
    // stable for rows that were created in the same millisecond.
    list: () =>
      run(() =>
        records
          .map(publicAsset)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
      ),
    get: (id) =>
      run(() => {
        const record = records.find((item) => item.id === id);
        return record ? { ...record } : null;
      }),
    create: (input) =>
      run(async () => {
        const now = new Date().toISOString();
        const record = {
          id: randomUUID(),
          type: input.type,
          account: input.account,
          note: input.note || "",
          createdAt: now,
          updatedAt: now,
        };
        // randomUUID collisions are vanishingly unlikely, but ids are the
        // API's addressing scheme, so never let two records share one.
        while (records.some((item) => item.id === record.id)) record.id = randomUUID();
        const before = records;
        records = [...records, record];
        try {
          await writeAtomic();
        } catch (error) {
          records = before;
          throw error;
        }
        return { ...record };
      }),
    update: (id, changes) =>
      run(async () => {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) return null;
        const previous = records[index];
        const now = new Date().toISOString();
        const next = { ...previous, ...changes, updatedAt: now };
        const before = records;
        records = records.slice();
        records[index] = next;
        try {
          await writeAtomic();
        } catch (error) {
          records = before;
          throw error;
        }
        return { ...next };
      }),
    remove: (id) =>
      run(async () => {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) return null;
        const before = records;
        const removed = records[index];
        records = records.filter((item) => item.id !== id);
        try {
          await writeAtomic();
        } catch (error) {
          records = before;
          throw error;
        }
        return { ...removed };
      }),
  };
}
