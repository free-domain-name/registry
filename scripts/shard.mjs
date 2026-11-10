/**
 * Deterministic shard layout for the Free Domain Name registry.
 *
 * Every record is one JSON file, addressed by four one-character directories
 * derived from the domain with dots removed:
 *
 *   example.com  -> e/x/a/m/example.com.json
 *   test.xyz     -> t/e/s/t/test.xyz.json
 *   google.com   -> g/o/o/g/google.com.json
 *   a.co         -> a/c/o/_/a.co.json
 *
 * The four levels give 37^4 = 1,874,161 buckets (37 = a-z, 0-9 and "_") and
 * keep any single directory small. Short domains are padded with "_" so the
 * path is always exactly four directories deep.
 *
 * The browser does not need this file at runtime: it computes the same path
 * and fetches the raw file from the CDN on demand.
 */
export const SHARD_DEPTH = 4;
export const PAD = "_";
export const LAYOUT = "shard4-v1";

export function normalizeDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

export function domainSlug(domain) {
  const slug = normalizeDomain(domain).replace(/\./g, "");
  if (slug.length === 0) {
    throw new Error("domain has no characters");
  }
  return slug.padEnd(SHARD_DEPTH, PAD);
}

export function shardDirectories(domain) {
  const slug = domainSlug(domain);
  return Array.from({ length: SHARD_DEPTH }, (_, index) => slug[index]);
}

export function recordPath(domain) {
  const normalized = normalizeDomain(domain);
  return `${shardDirectories(normalized).join("/")}/${normalized}.json`;
}

/** Inverse of recordPath; returns null when the path is not a shard record. */
export function pathToDomain(relativePath) {
  const parts = relativePath.split("/");
  if (parts.length !== SHARD_DEPTH + 1) return null;
  const file = parts[parts.length - 1];
  if (!file.endsWith(".json")) return null;
  return file.slice(0, -".json".length);
}
