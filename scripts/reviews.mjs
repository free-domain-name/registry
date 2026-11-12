#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Create one public review thread per registry name and publish an index of
 * community votes/comments for the browser site's Stumble page.
 *
 * GitHub Issues are the database:
 *   - the issue is the domain's comment thread
 *   - +1 / -1 reactions are the score
 *   - GitHub accounts are the identity layer
 *
 * The generated index lives at reviews/index.json. Scores are opinions, not
 * security audits. No AI-generated comments or domain lists are allowed; see
 * DISCLAIMER.md.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/reviews.mjs
 *   DRY_RUN=1 node scripts/reviews.mjs
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToDomain } from "./shard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = process.env.GITHUB_REPOSITORY || "free-domain-name/registry";
const token = process.env.GITHUB_TOKEN;
const dryRun = process.env.DRY_RUN === "1";
const apiBase = "https://api.github.com";
const outputFile = path.join(root, "reviews", "index.json");
const skippedDirectories = new Set([
  ".git",
  ".github",
  "node_modules",
  "reviews",
  "scripts",
]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || skippedDirectories.has(entry.name)) {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

async function loadRecords() {
  const records = [];
  for (const file of (await walk(root)).sort()) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative.split("/").length !== 5) continue;

    const domain = pathToDomain(relative);
    if (!domain) continue;

    const record = JSON.parse(await readFile(file, "utf8"));
    if (record?.domain !== domain) {
      throw new Error(`${relative}: record domain does not match filename`);
    }

    records.push({
      domain,
      target_url: record.target_url,
      owner_github: record.owner_github,
      relative,
    });
  }
  records.sort((a, b) => a.domain.localeCompare(b.domain));
  return records;
}

async function loadIssueState() {
  try {
    const data = JSON.parse(await readFile(outputFile, "utf8"));
    if (!Array.isArray(data?.domains)) return new Map();
    return new Map(data.domains.map((entry) => [entry.domain, entry]));
  } catch {
    return new Map();
  }
}

async function github(method, endpoint, body) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required unless DRY_RUN=1");
  }

  const response = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const error = new Error(
      `${method} ${endpoint}: HTTP ${response.status} ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

function issueTitle(domain) {
  const title = `Review: ${domain}`;
  return title.length <= 256 ? title : `${title.slice(0, 253)}...`;
}

function issueBody(record) {
  const recordUrl = `https://github.com/${repository}/blob/main/${record.relative}`;
  const disclaimerUrl = `https://github.com/${repository}/blob/main/DISCLAIMER.md`;
  return `<!-- fdn-review:${record.domain} -->
## Community review: \`${record.domain}\`

This issue is the community review thread for a name in the Free Domain Name
registry. It is public. The issue is not an endorsement.

- **Registry record:** [\`${record.domain}\`](${recordUrl})
- **Destination:** \`${record.target_url}\`
- **Claimed by:** @${record.owner_github}

### How to review

- React with 👍 if the destination is worth visiting, or 👎 if it is not.
- Leave a comment about the site: what it does, whether it loaded, accessibility,
  safety concerns, or anything useful to the next person.
- One vote per person. Do not vote from multiple accounts or spam the thread.
- **Human-written only.** No AI-generated reviews, AI-generated domain lists,
  automated comments, or promotional text. Comments that appear automated or
  abusive may be removed.

> **Disclaimer:** The registry does not operate, monitor, or endorse this
> destination. Content is third-party and may be unsafe. Visit at your own risk.
> Scores are opinions, not security audits. See the
> [full disclaimer and community rules](${disclaimerUrl}).
`;
}

async function findExistingIssue(record, state) {
  const known = state.get(record.domain);
  if (known?.issue) {
    try {
      const issue = await github(
        "GET",
        `/repos/${repository}/issues/${known.issue}`,
      );
      if (!issue?.pull_request) return issue;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }

  if (dryRun) return null;

  // State can be lost if a previous run failed between creating an issue and
  // committing the index. Look the title up before creating a duplicate.
  const query = `repo:${repository} is:issue in:title "${issueTitle(record.domain)}"`;
  const found = await github(
    "GET",
    `/search/issues?q=${encodeURIComponent(query)}&per_page=20`,
  );
  return (
    (found?.items || []).find(
      (issue) =>
        !issue.pull_request && issue.title === issueTitle(record.domain),
    ) || null
  );
}

async function createIssue(record) {
  return github("POST", `/repos/${repository}/issues`, {
    title: issueTitle(record.domain),
    body: issueBody(record),
  });
}

async function countReactions(issueNumber) {
  let up = 0;
  let down = 0;

  for (let page = 1; page <= 5; page += 1) {
    const reactions = await github(
      "GET",
      `/repos/${repository}/issues/${issueNumber}/reactions?per_page=100&page=${page}`,
    );
    if (!Array.isArray(reactions)) break;

    for (const reaction of reactions) {
      if (reaction.content === "+1") up += 1;
      else if (reaction.content === "-1") down += 1;
    }
    if (reactions.length < 100) break;
  }

  return { up, down };
}

async function syncRecord(record, state) {
  let issue = await findExistingIssue(record, state);
  let created = false;

  if (!issue) {
    if (dryRun) {
      console.error(`[dry-run] would create a review issue for ${record.domain}`);
    } else {
      issue = await createIssue(record);
      created = true;
      console.log(`created review issue #${issue.number} for ${record.domain}`);
    }
  }

  if (!issue) {
    return {
      domain: record.domain,
      target_url: record.target_url,
      owner_github: record.owner_github,
      issue: null,
      url: null,
      up: 0,
      down: 0,
      comments: 0,
      score: null,
      updated_at: new Date().toISOString(),
    };
  }

  const { up, down } = await countReactions(issue.number);
  const total = up + down;
  if (!created) {
    console.log(
      `synced #${issue.number} ${record.domain}: ${up} up, ${down} down, ${
        issue.comments ?? 0
      } comments`,
    );
  }

  return {
    domain: record.domain,
    target_url: record.target_url,
    owner_github: record.owner_github,
    issue: issue.number,
    url: issue.html_url,
    up,
    down,
    comments: issue.comments ?? 0,
    score: total === 0 ? null : Math.round((up / total) * 100),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const records = await loadRecords();
  const state = await loadIssueState();
  const domains = [];

  for (const record of records) {
    domains.push(await syncRecord(record, state));
  }

  const index = {
    generated_at: new Date().toISOString(),
    repository,
    scoring:
      "percentage of positive (+1) reactions among +1 and -1 reactions; null until at least one vote",
    domains,
  };

  if (dryRun) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(root, outputFile)} (${domains.length} names)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
