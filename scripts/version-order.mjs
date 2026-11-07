// Semantic-version ordering for the release gate.
//
// The gate used to accept any *changed* version string. A branch opened before
// main moved on could declare 0.1.63 while main was already at 0.1.68; the
// gate saw "0.1.63 != 0.1.68" and passed, and merging silently downgraded the
// version magpie offers to users. This module is deliberately tiny and has no
// imports so both the CLI and its tests can use it without pulling in git.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a version into comparable parts, or null when it is not semver. */
export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/**
 * Return 1 when left > right, -1 when left < right, 0 when equal, and null
 * when either side is not a parseable semver (callers then fall back to a
 * plain string comparison rather than inventing an ordering).
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  // A release outranks its own prerelease: 0.1.70 > 0.1.70-rc.1.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) > Number(y) ? 1 : -1;
    if (xNum) return -1;
    if (yNum) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
