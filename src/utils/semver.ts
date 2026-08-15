// Minimal semver helpers for plugin manifests. Only the subset used by the
// plugin host is implemented: compare and coerce, no ranges.
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export const parseSemver = (
  value: string
): [number, number, number] | null => {
  const match = (value || "").trim().match(SEMVER);
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
};

/** Negative when a < b, positive when a > b, 0 when equal. Null versions sort lowest. */
export const compareSemver = (a: string, b: string): number => {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
};

/** Whether the running app satisfies a plugin's minAppVersion requirement. */
export const satisfiesMinVersion = (
  appVersion: string,
  minAppVersion: string
): boolean => {
  if (!minAppVersion) return true;
  return compareSemver(appVersion, minAppVersion) >= 0;
};
