#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only */
/* Copyright (C) 2026 Free Domain Name contributors */
/**
 * Create one public Discussion per registry name and publish an index of
 * community votes/comments for the browser site's Stumble page.
 *
 * GitHub Discussions are the database and giscus is the inline UI:
 *   - the discussion is the domain's comment thread
 *   - THUMBS_UP / THUMBS_DOWN reactions are the score
 *   - GitHub accounts are the identity layer
 *
 * The generated index lives at reviews/index.json. Scores are opinions, not
 * security audits. No AI-generated comments or domain lists are allowed; see
 * DISCLAIMER.md.
 *
 * The action uses the GitHub GraphQL API. It does not install the giscus app;
 * that is a one-time repository setting the maintainer must enable.
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
const [owner, name] = repository.split("/");
const token = process.env.GITHUB_TOKEN;
const dryRun = process.env.DRY_RUN === "1";
const apiBase = "https://api.github.com";
const outputFile = path.join(root, "reviews", "index.json");
const categoryName = process.env.REVIEW_CATEGORY || "General";
const skippedDirectories = new Set([
  ".git",
  ".github",
  "node_modules",
  "reviews",
  "scripts",
]);

const DISCUSSION_FIELDS = `
  number
  title
  url
  comments { totalCount }
  reactionGroups {
    content
    users { totalCount }
  }
`;

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

async function graphql(query, variables = {}) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required unless DRY_RUN=1");
  }

  const response = await fetch(`${apiBase}/graphql`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.errors?.length) {
    const details = payload?.errors?.map((error) => error.message).join("; ");
    const error = new Error(
      `GraphQL request failed: HTTP ${response.status} ${details || "unknown error"}`,
    );
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

async function loadDiscussionContext() {
  const data = await graphql(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        discussionCategories(first: 50) {
          nodes { id name }
        }
      }
    }`,
    { owner, name },
  );

  const repo = data.repository;
  if (!repo) throw new Error(`Repository ${repository} was not found`);
  const category = repo.discussionCategories.nodes.find(
    (item) => item.name === categoryName,
  );
  if (!category) {
    throw new Error(
      `Discussion category "${categoryName}" was not found in ${repository}. ` +
        "Create it in repository Settings → Discussions, or set REVIEW_CATEGORY.",
    );
  }
  return { repositoryId: repo.id, categoryId: category.id };
}

async function loadDiscussions(categoryId) {
  const byTitle = new Map();
  let after = null;

  for (let page = 0; page < 20; page += 1) {
    const data = await graphql(
      `query($owner: String!, $name: String!, $categoryId: ID!, $after: String) {
        repository(owner: $owner, name: $name) {
          discussions(first: 100, categoryId: $categoryId, after: $after) {
            nodes { ${DISCUSSION_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { owner, name, categoryId, after },
    );

    const discussions = data.repository.discussions;
    for (const discussion of discussions.nodes) {
      byTitle.set(discussion.title, discussion);
    }
    if (!discussions.pageInfo.hasNextPage) break;
    after = discussions.pageInfo.endCursor;
  }

  return byTitle;
}

function discussionBody(record) {
  const recordUrl = `https://github.com/${repository}/blob/main/${record.relative}`;
  const disclaimerUrl = `https://github.com/${repository}/blob/main/DISCLAIMER.md`;
  return `<!-- fdn-review:${record.domain} -->
## Community review: \`${record.domain}\`

This discussion is the community review thread for a name in the Free Domain
Name registry. It is public. It is not an endorsement.

- **Registry record:** [\`${record.domain}\`](${recordUrl})
- **Destination:** \`${record.target_url}\`
- **Claimed by:** @${record.owner_github}

### How to review

- React with 👍 if the destination is worth visiting, or 👎 if it is not.
- Leave a comment about the site: what it does, whether it loaded,
  accessibility, safety concerns, or anything useful to the next person.
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

async function createDiscussion(context, record) {
  const data = await graphql(
    `mutation($input: CreateDiscussionInput!) {
      createDiscussion(input: $input) {
        discussion { ${DISCUSSION_FIELDS} }
      }
    }`,
    {
      input: {
        repositoryId: context.repositoryId,
        categoryId: context.categoryId,
        title: record.domain,
        body: discussionBody(record),
      },
    },
  );
  return data.createDiscussion.discussion;
}

function reactionCounts(discussion) {
  let up = 0;
  let down = 0;
  for (const group of discussion.reactionGroups || []) {
    if (group.content === "THUMBS_UP") up = group.users.totalCount;
    else if (group.content === "THUMBS_DOWN") down = group.users.totalCount;
  }
  return { up, down };
}

function entryFor(record, discussion) {
  const { up, down } = reactionCounts(discussion);
  const total = up + down;
  return {
    domain: record.domain,
    target_url: record.target_url,
    owner_github: record.owner_github,
    discussion: discussion.number,
    url: discussion.url,
    up,
    down,
    comments: discussion.comments?.totalCount ?? 0,
    score: total === 0 ? null : Math.round((up / total) * 100),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const records = await loadRecords();

  if (dryRun) {
    const domains = records.map((record) => ({
      domain: record.domain,
      target_url: record.target_url,
      owner_github: record.owner_github,
      discussion: null,
      url: null,
      up: 0,
      down: 0,
      comments: 0,
      score: null,
      updated_at: new Date().toISOString(),
    }));
    console.log(
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          repository,
          category: categoryName,
          scoring:
            "percentage of THUMBS_UP among THUMBS_UP and THUMBS_DOWN reactions; null until at least one vote",
          domains,
        },
        null,
        2,
      ),
    );
    return;
  }

  const context = await loadDiscussionContext();
  const existing = await loadDiscussions(context.categoryId);
  const domains = [];

  for (const record of records) {
    let discussion = existing.get(record.domain);
    if (!discussion) {
      discussion = await createDiscussion(context, record);
      existing.set(record.domain, discussion);
      console.log(`created discussion #${discussion.number} for ${record.domain}`);
    }

    const entry = entryFor(record, discussion);
    domains.push(entry);
    console.log(
      `synced #${entry.discussion} ${record.domain}: ${entry.up} up, ${entry.down} down, ${entry.comments} comments`,
    );
  }

  const index = {
    generated_at: new Date().toISOString(),
    repository,
    category: categoryName,
    scoring:
      "percentage of THUMBS_UP among THUMBS_UP and THUMBS_DOWN reactions; null until at least one vote",
    domains,
  };

  // Do not create a commit just because the clock moved. Compare the data
  // fields, not generated_at/updated_at, so a scheduled run with no new votes
  // leaves the published index untouched.
  const previousRaw = await readFile(outputFile, "utf8").catch(() => null);
  if (previousRaw) {
    try {
      const previous = JSON.parse(previousRaw);
      const dataOnly = (items) =>
        (Array.isArray(items) ? items : []).map(({ updated_at, ...rest }) => rest);
      if (
        JSON.stringify(dataOnly(previous.domains)) ===
        JSON.stringify(dataOnly(domains))
      ) {
        console.log("Review index is unchanged.");
        return;
      }
    } catch {
      // A malformed previous index is replaced with a fresh one.
    }
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(root, outputFile)} (${domains.length} names)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
