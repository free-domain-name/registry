# Community review threads

Every registry name can have one public GitHub Discussion in this repository.
The discussion is the review thread:

- 👍 / 👎 reactions on the discussion are the community score.
- Discussion comments are the public conversation, embedded with giscus.
- GitHub accounts provide identity, spam resistance and moderation.

The browser site's **Stumble** page reads the generated
[`index.json`](index.json), picks a random name, and embeds the discussion for
voting and comments. The project's [root site](https://free-domain-name.github.io/)
uses the same index for a rolling seven-day leaderboard.

## Data

`scripts/reviews.mjs` rebuilds `index.json` from the registry records and the
GitHub Discussions GraphQL API. The scheduled workflow runs every six hours and
on pushes to `main`. The page uses giscus for the inline thread; the app must be
installed on the repository once.

Each domain entry contains:

| Field | Meaning |
| --- | --- |
| `domain` | Registry name |
| `target_url` | Destination from the registry record |
| `owner_github` | Claimant from the registry record |
| `discussion` | GitHub Discussion number, or `null` |
| `url` | Public discussion URL |
| `up` / `down` | 👍 / 👎 reaction counts |
| `comments` | Discussion comment count |
| `score` | Percentage of 👍 among recorded votes, or `null` |
| `recent_up` / `recent_down` | 👍 / 👎 reactions created in the last seven days |
| `recent_votes` | `recent_up + recent_down` |
| `recent_comments` | Comments created in the last seven days |
| `recent_score` | Percentage of 👍 among recent votes, or `null` |
| `updated_at` | Last aggregation time |

`window_days` at the top of the index records the rolling window. "Recent" means
the reaction or comment is still present and was created in that window; it is
not a historical snapshot. If someone removes a vote it disappears from the
window, and an old vote ages out even if it remains on the discussion.

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

The automation creates the discussion body and aggregate index. It never writes
comments or votes; those must come from GitHub accounts. giscus handles the
inline GitHub sign-in and comment UI.
