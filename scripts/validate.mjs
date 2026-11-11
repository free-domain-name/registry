#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Validate the sharded registry with no npm dependencies.
 *
 * Checks:
 *   - every record lives at the deterministic four-level shard path
 *   - `domain` matches the filename and is a lowercase DNS name with a dot
 *   - records contain exactly domain, target_url, owner_github and ttl
 *   - target_url is an http(s) origin without credentials, path, query or fragment
 *   - ttl is an integer inside [60, 86400]
 *   - no two files claim the same domain
 *   - no record points at another registry name (redirect loop)
 *
 * Usage: node scripts/validate.mjs
 */
import { isIP } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordPath } from "./shard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REQUIRED = ["domain", "target_url", "owner_github", "ttl"];

function fail(message) {
  errors.push(message);
}

async function shardFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await shardFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function checkTarget(relative, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${relative}: target_url is not a valid URL`);
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(`${relative}: target_url must be http(s)`);
  }
  if (!url.hostname) fail(`${relative}: target_url has no hostname`);
  if (url.username || url.password) fail(`${relative}: target_url must not contain credentials`);
  if (url.port === "0") fail(`${relative}: target_url port 0 is not allowed`);
  if (url.search || url.hash) {
    fail(`${relative}: target_url must not contain a query or fragment`);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    fail(
      `${relative}: target_url must be an origin without a path; the browser supplies the request path`,
    );
  }
  return url;
}

const files = (await shardFiles(root))
  .filter((file) => path.relative(root, file).split(path.sep).length === 5)
  .sort();

const records = new Map();

for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  let record;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`${relative}: invalid JSON (${error.message})`);
    continue;
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail(`${relative}: record must be an object`);
    continue;
  }

  const keys = Object.keys(record).sort();
  if (keys.join(",") !== [...REQUIRED].sort().join(",")) {
    fail(`${relative}: expected exactly ${REQUIRED.join(", ")}; got ${keys.join(", ") || "(none)"}`);
    continue;
  }

  const domain = record.domain;
  if (typeof domain !== "string" || !DOMAIN_RE.test(domain)) {
    fail(`${relative}: domain is not a lowercase DNS name with a dot`);
    continue;
  }

  const expected = recordPath(domain);
  if (relative !== expected) {
    fail(`${relative}: expected ${expected} for ${domain}`);
    continue;
  }
  if (records.has(domain)) {
    fail(`${relative}: duplicate domain ${domain}`);
    continue;
  }

  if (typeof record.owner_github !== "string" || !OWNER_RE.test(record.owner_github)) {
    fail(`${relative}: owner_github is not a GitHub handle`);
  }
  if (!Number.isInteger(record.ttl) || record.ttl < 60 || record.ttl > 86400) {
    fail(`${relative}: ttl must be an integer between 60 and 86400`);
  }

  const target = checkTarget(relative, record.target_url);
  records.set(domain, { relative, target });
}

for (const [domain, { relative, target }] of records) {
  if (!target) continue;
  const host = target.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host) === 0 && records.has(host)) {
    fail(`${relative}: target ${host} is also a registry name; loop`);
  }
}

if (records.size === 0) {
  fail("no records found; expected <a>/<b>/<c>/<d>/<domain>.json");
}

if (errors.length > 0) {
  console.error(`FAIL registry: ${errors.length} problem(s)`);
  for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
  if (errors.length > 50) console.error(`  ... and ${errors.length - 50} more`);
  process.exit(1);
}

console.log(`OK registry: ${records.size} record(s) in ${files.length} shard file(s)`);
