# Community review threads

Every registry name can have one public GitHub Issue in this repository. The
issue is the review thread:

- 👍 / 👎 reactions on the issue are the community score.
- Issue comments are the public discussion.
- GitHub accounts provide identity, spam resistance and moderation.

The browser site's **Stumble** page reads the generated
[`index.json`](index.json), picks a random name, and links back to the issue for
voting and comments.

## Data

`scripts/reviews.mjs` rebuilds `index.json` from the registry records and the
GitHub Issues API. The scheduled workflow runs every six hours and on pushes to
`main`.

Each domain entry contains:

| Field | Meaning |
| --- | --- |
| `domain` | Registry name |
| `target_url` | Destination from the registry record |
| `owner_github` | Claimant from the registry record |
| `issue` | GitHub Issue number, or `null` |
| `url` | Public issue URL |
| `up` / `down` | 👍 / 👎 reaction counts |
| `comments` | Issue comment count |
| `score` | Percentage of 👍 among recorded votes, or `null` |
| `updated_at` | Last aggregation time |

Scores are **opinions**, not security audits. A score of 100% with two votes is
not proof that a site is safe.

## Rules

- **Human-written only.** No AI-generated comments, AI-generated domain lists,
  bulk promotions, or automated reviews.
- One vote per person. Do not use multiple accounts.
- Keep comments relevant, civil and useful to the next visitor.
- The registry disclaimer applies: destinations are third-party content, and
  the project does not operate or endorse them. See
  [`../DISCLAIMER.md`](../DISCLAIMER.md).
- Maintainers may remove comments, lock threads, or remove records for abuse.

The automation creates the issue body and aggregate index. It never writes
comments or votes; those must come from GitHub accounts.
