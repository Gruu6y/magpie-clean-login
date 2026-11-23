// Headless checks for Wave 2 account view helpers in ui/account-view.js.
import { expect, test } from "bun:test";
import {
  EXPIRING_SOON_MS,
  accountView,
  countAccountsByProxy,
  filterAccounts,
  formatExpiryBadge,
  isHostingPaused,
} from "../ui/account-view.js";

test("accountView surfaces email, methodLabel, and normalized expiresAt", () => {
  const view = accountView({
    provider: "workbuddy",
    key: "workbuddy#1",
    email: "alice@example.com",
    methodLabel: "OAuth",
    expiresAt: Date.parse("2026-11-30T00:00:00.000Z"),
  });
  expect(view.email).toBe("alice@example.com");
  expect(view.methodLabel).toBe("OAuth");
  expect(view.expiresAt).toBe("2026-11-30T00:00:00.000Z");
});

test("formatExpiryBadge classifies expired, expiring soon, ok, and absent timestamps", () => {
  const now = Date.parse("2026-11-23T00:00:00.000Z");
  expect(formatExpiryBadge(null, now)).toEqual({ state: "none", label: "", tone: "none" });
  expect(formatExpiryBadge(now - 1000, now)).toMatchObject({ state: "expired", tone: "bad" });
  expect(formatExpiryBadge(now + EXPIRING_SOON_MS / 2, now)).toMatchObject({ state: "soon", tone: "warn" });
  expect(formatExpiryBadge(now + 5 * 86_400_000, now)).toMatchObject({ state: "ok", tone: "good" });
});

test("countAccountsByProxy, isHostingPaused, and filterAccounts new filter modes work accurately", () => {
  const now = Date.parse("2026-11-23T00:00:00.000Z");
  const accounts = [
    {
      provider: "workbuddy",
      key: "wb#1",
      email: "paused@example.com",
      signedIn: true,
      exit: { proxyId: "p-1" },
      lastLogin: { proxyId: "p-old" },
      hosting: { enabled: false, pausedReason: "signed_out" },
      expiresAt: now + 3 * 3_600_000,
    },
    {
      provider: "qoder",
      key: "q#1",
      email: "active@example.com",
      signedIn: true,
      lastLogin: { proxyId: "p-1" },
      hosting: { enabled: true },
      expiresAt: now + 10 * 86_400_000,
    },
    {
      provider: "codex",
      key: "c#1",
      signedIn: false,
      exit: { proxyId: null },
    },
  ];

  expect(countAccountsByProxy(accounts)).toEqual({ "p-1": 2 });
  expect(isHostingPaused(accounts[0])).toBe(true);
  expect(isHostingPaused(accounts[1])).toBe(false);

  expect(filterAccounts(accounts, { filter: "hostingPaused" }).map((a) => a.key)).toEqual(["wb#1"]);
  expect(filterAccounts(accounts, { filter: "hostingActive" }).map((a) => a.key)).toEqual(["q#1"]);
  expect(filterAccounts(accounts, { filter: "expiringSoon", nowMs: now }).map((a) => a.key)).toEqual(["wb#1"]);
  expect(filterAccounts(accounts, { query: "active@example.com" }).map((a) => a.key)).toEqual(["q#1"]);
});
