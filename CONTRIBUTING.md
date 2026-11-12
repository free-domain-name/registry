# Contributing

> **Human submissions only.** Do not use AI or other automation to generate
> domain lists, registry records, review comments, issue text, or scores. Submit
> names you personally control or have a real reason to map. Maintainers may
> remove bulk, automated, abusive, or promotional contributions. Read
> [DISCLAIMER.md](DISCLAIMER.md) before contributing.

- One logical change per PR.
- Add exactly one JSON file at `<a>/<b>/<c>/<d>/<domain>.json`; never add a
  central index or a second file for the same name.
- Compute the path with
  `node -e "import('./scripts/shard.mjs').then(m => console.log(m.recordPath('your.name')))"`.
- Run `node scripts/validate.mjs` before pushing.
- Set `owner_github` to your GitHub handle. A record you cannot justify will be
  removed.
- A record must contain all four fields and nothing else:
  `domain`, `target_url`, `owner_github`, `ttl`.
- `domain` is an exact lowercase hostname with at least one dot. Wildcards and
  whole-TLD claims such as `*.com` are rejected.
- `target_url` is an `http(s)` origin, optionally including a port. The browser
  appends the requested path and sends the original domain as `Host`.
- `ttl` is the client cache lifetime in seconds, between 60 and 86400.
- Any domain is allowed, including real domains such as `google.com`. Expect
  extra review for those: the browser shows a public-DNS conflict prompt.
- Two different names may share an IP or a port; only the name must be unique.
- Do not point a record at another registry name; CI rejects loops.
- Do not add credentials, query strings or fragments to `target_url`.
- Do not claim names for other people, brands you do not own, or illegal content.
- Security fixes (removing a malicious record) should reference the incident in
  the PR description and may be fast-tracked by maintainers.
- CI must pass.
