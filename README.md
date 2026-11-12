# Free Domain Name registry

> **Disclaimer:** Names and destinations are public, third-party submissions.
> The maintainers do not operate, monitor, or endorse them. A record is not a
> verification of ownership, safety, or legality. Visit destinations at your own
> risk. Community scores and comments are opinions, not security audits. Read
> the full [disclaimer and community rules](DISCLAIMER.md).

This repository is the public, PR-governed source of truth for the Free Domain
Name browser. It is an experiment showing that a community registry can sit
alongside public DNS; it is not ICANN, a registrar, or a hosting provider. It lets a community claim **any** hostname — including names under
standard TLDs such as `google.com`, and names using TLDs that exist only here,
such as `hello.fdn` — and point it at a destination the claimant controls.

The browser reads this repository **on demand, one record at a time**, directly
from the GitHub raw CDN. There is no generated index and no central manifest.

## Sharded layout

Records are addressed by four one-character directories derived from the domain
with its dots removed:

```text
e/x/a/m/example.com.json
t/e/s/t/test.xyz.json
g/o/o/g/google.com.json
a/c/o/_/a.co.json          # short names are padded with "_"
```

The path is deterministic, so any client can compute the raw URL without an
index:

```text
https://raw.githubusercontent.com/free-domain-name/registry/main/<path>
```

Four levels give 37⁴ = 1,874,161 buckets (`a-z`, `0-9` and `_`), which keeps any
single directory small while remaining review-friendly. The full domain stays in
the filename, so a record is self-describing and a duplicate name cannot silently
land in two places.

## Record format

One record per file, exactly four fields:

```json
{
  "domain": "example.com",
  "target_url": "http://203.0.113.10:8080",
  "owner_github": "username",
  "ttl": 3600
}
```

| Field          | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `domain`       | Exact lowercase hostname, including its TLD. One record per name.        |
| `target_url`   | `http(s)` origin that serves the name. The requested path is appended.   |
| `owner_github` | GitHub handle accountable for the record.                                |
| `ttl`          | Client cache lifetime in seconds (60–86400).                             |

An IP literal is enough: no domain or DNS record is needed. Use `http://` for a
bare IP; HTTPS certificates are issued to names, not addresses (unless the
certificate has an IP SAN). A port is optional.

When `target_url` is an **IP literal**, the browser sends the free name as the
`Host` header, so one address can virtual-host many names. When it is a
**hostname**, the browser fetches that hostname as itself (normal CDN and TLS
behaviour) and still keeps the free name in its address bar.

### Target URL format

`target_url` is an **origin**, not a full page URL:

```text
http(s)://<ipv4 | [ipv6] | hostname>[:port][/]
```

Allowed:

- `http://203.0.113.10` — IPv4, port 80
- `http://203.0.113.10:8080` — IPv4, port 8080
- `http://[2001:db8::1]:8080` — IPv6
- `https://origin.example.net` — hostname, port 443

Rejected:

- `http://203.0.113.10/app` — a path; the browser supplies the path
- `http://203.0.113.10?x=1` — a query
- `http://203.0.113.10#top` — a fragment
- `http://user:pass@203.0.113.10` — credentials
- `http://203.0.113.10:0` — port 0

See [docs/target-url.md](docs/target-url.md) for the full grammar, Host
behaviour, IP/hostname trade-offs and examples.

## How the browser uses this repository

1. The user enters any URL or bare domain.
2. The browser computes the shard path and fetches the record, checking a
   thread-safe memory cache and a disk cache first.
3. **Record exists, public DNS does not resolve the name:** the browser loads
   `target_url` immediately and keeps the original name in the address bar.
4. **Record exists, public DNS also resolves the name:** the browser asks the
   user whether to visit the Free Registry destination or the public ICANN one,
   and remembers the choice for the session.
5. **No record and the name ends in `.fdn`:** the browser shows an **available**
   claim page instead of trying public DNS; `.fdn` is this registry's namespace.
6. **No record for any other name:** the browser falls back to the normal public
   web.

Because lookup is per request, the repository can grow to millions of records
without any client having to download a global index. There is deliberately no
`client.json`: a single generated index was the previous, wrong iteration.

## Community reviews and scores

Each domain can have a public GitHub Issue in this repository for discussion.
The issue is the review thread: people react with 👍 or 👎 and leave comments
about the destination. The browser site's [**Stumble** page](https://free-domain-name.github.io/tauri-browser/stumble.html)
picks a random name, shows its aggregate score and recent comments, and links to
the issue for voting and replying.

The issue threads and the generated [reviews/index.json](reviews/index.json) are
maintained by [`scripts/reviews.mjs`](scripts/reviews.mjs). See
[reviews/README.md](reviews/README.md) for the data format and moderation rules.

**Human-written only.** No AI-generated domain lists, AI-written comments, bulk
promotions, or automated reviews. This is a rule, not a technical guarantee:
GitHub identity and maintainer moderation are the enforcement boundary. Scores
are opinions, not security audits. See [DISCLAIMER.md](DISCLAIMER.md).

## Collisions and ownership

A name maps to exactly one path. CI rejects duplicate names and files outside
their derived path, so a second record for `abc.com` cannot silently win.
Changing a record is a normal PR that edits that one file; protect `main`, require
review, and treat an `owner_github` change as a security change. The validator
cannot know whether a PR author is the owner — GitHub review is the authorization
boundary.

## Constraints

- Lowercase DNS names with at least one dot. Wildcards and whole-TLD claims are
  not supported by the current schema.
- `target_url` must be an `http(s)` **origin**: no credentials, path, query or
  fragment. A port is allowed and first-class. It must not point at another
  registry name (loop).
- A target may be an IP address or a hostname. A path belongs to the browser
  request, not to the record.
- Real domains may be claimed. Owners of the corresponding public domain should
  expect extra review; users always get the public/registry choice.
- No malware, phishing, hate speech, or names you do not control.

## Adding a name

1. Fork this repository.
2. Compute the path:

   ```bash
   node -e "import('./scripts/shard.mjs').then(m => console.log(m.recordPath('your.name')))"
   ```

3. Add `<a>/<b>/<c>/<d>/your.name.json` with the four fields above.
4. Run `node scripts/validate.mjs`.
5. Open a Pull Request. CI validates paths, fields, TTLs and loops.
6. A maintainer reviews ownership, target safety and accuracy.

By opening a PR you confirm you control the target and accept that maintainers may
remove records for abuse, phishing, malware, or trademark issues.

## Sample records

| Name           | Target                        | Purpose                                    |
| -------------- | ----------------------------- | ------------------------------------------ |
| `hello.fdn`    | `http://example.com`          | Ordinary registry-only name.               |
| `docs.fdn`     | `http://example.org`          | Second registry-only example.              |
| `insecure.fdn` | `http://203.0.113.10:8080`    | Plain HTTP and non-default port.           |
| `abc.fdn`      | `http://203.0.113.10`         | Shared IP, different port from `xyz.fdn`.  |
| `xyz.fdn`      | `http://203.0.113.10:8080`    | Same IP, different port; allowed.          |
| `ipmap.info`   | `http://ipmap.vitrn.com`      | Hostname target.                           |
| `abc.com`      | `http://89.58.37.84:9094`     | Real-domain override.                      |
| `google.com`   | `http://example.com`          | Conflict-flow demo; remove before launch.  |

`203.0.113.0/24` is TEST-NET-3 and is not reachable from the public internet.

## Local validation

```bash
node scripts/validate.mjs
npx --yes -p ajv-cli@5 -p ajv-formats ajv validate -c ajv-formats \
  -s schema.json -d "*/*/*/*/*.json" --spec=draft2020 --strict=false
```

## License

GPL-3.0-only; see [LICENSE](LICENSE).
