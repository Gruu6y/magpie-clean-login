// Headless checks for provider account counting and category filtering in ui/provider-state.js.
import { expect, test } from "bun:test";
import {
  countAccountsByProvider,
  filterProvidersByCategory,
} from "../ui/provider-state.js";

test("countAccountsByProvider counts accounts per provider safely", () => {
  expect(
    countAccountsByProvider([
      { provider: "workbuddy", key: "workbuddy" },
      { provider: "workbuddy", key: "workbuddy#1" },
      { provider: "codex", key: "codex" },
      null,
      {},
    ]),
  ).toEqual({ workbuddy: 2, codex: 1 });
});

test("filterProvidersByCategory filters all, signable, hasAccounts, and catalog cards", () => {
  const providers = [
    { id: "workbuddy", signableMethod: true, signInProvider: "workbuddy", presence: "both" },
    { id: "codex", signableMethod: false, nativeSignIn: true, presence: "magpie-only" },
    { id: "key-only", signableMethod: false, nativeSignIn: false, presence: "both" },
    { id: "cat-only", signableMethod: false, nativeSignIn: false, presence: "catalog" },
  ];
  const counts = { workbuddy: 2, "key-only": 1 };

  expect(filterProvidersByCategory(providers, "all", counts)).toHaveLength(4);
  expect(filterProvidersByCategory(providers, "signable", counts).map((p) => p.id)).toEqual(["workbuddy", "codex"]);
  expect(filterProvidersByCategory(providers, "hasAccounts", counts).map((p) => p.id)).toEqual(["workbuddy", "key-only"]);
  expect(filterProvidersByCategory(providers, "catalog", counts).map((p) => p.id)).toEqual(["cat-only"]);
});
