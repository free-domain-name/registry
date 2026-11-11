# `target_url` format

`target_url` is the **HTTP(S) origin** the browser connects to when a registry
name is opened. It is deliberately not a complete page URL: the path and query
come from the browser's request and are added to this origin.

In other words, a record is closer to a DNS A/AAAA record than to a bookmark.
The name is the thing users type; `target_url` is the server that answers.

## Grammar

```text
target_url = scheme "://" host [ ":" port ] [ "/" ]
scheme     = "http" / "https"
host       = ipv4-address / "[" ipv6-address "]" / dns-name
port       = 1*5DIGIT          ; 1-65535; port 0 is rejected
```

The trailing `/` is optional and has no effect.

### Allowed

| Value                          | Meaning                                  |
| ------------------------------ | ---------------------------------------- |
| `http://203.0.113.10`          | IPv4 literal, default port 80            |
| `http://203.0.113.10:8080`      | IPv4 literal, custom port                |
| `http://[2001:db8::1]:8080`     | IPv6 literal, custom port                |
| `https://origin.example.net`   | DNS hostname, default port 443           |
| `https://origin.example.net:8443` | DNS hostname, custom port             |
| `https://origin.example.net/`  | Same as above; trailing slash is ignored |

### Rejected

| Value                          | Why                                      |
| ------------------------------ | ---------------------------------------- |
| `http://203.0.113.10/app`      | Path; the browser supplies the path      |
| `http://203.0.113.10?x=1`      | Query; the browser supplies the query    |
| `http://203.0.113.10#top`      | Fragment; never sent to a server         |
| `http://user:pass@203.0.113.10` | Credentials are not allowed            |
| `http://203.0.113.10:0`        | Port 0 is not a usable TCP port          |
| `//203.0.113.10`               | Missing scheme                           |
| `ftp://203.0.113.10`           | Only HTTP and HTTPS are supported        |

The registry validator and schema enforce these rules. The browser re-checks a
record before using it, so an invalid record fails closed instead of being used
as a partial URL.

## How the request path is used

A browser request for:

```text
https://deneme.fdn/docs/start?lang=en
```

becomes:

```text
target_url origin + "/docs/start" + "?lang=en"
```

For the record `"target_url": "http://203.0.113.10:8080"`, the upstream request
is:

```text
GET /docs/start?lang=en HTTP/1.1
Host: deneme.fdn
```

This is why a path in `target_url` is rejected: it would silently be discarded
by the path supplied by the browser. If your application is served under a
subpath, expose it at the origin's root (a reverse-proxy rewrite is usually one
line) or use a hostname whose root already serves it. Base paths are not
supported by the current proxy.

## IP or hostname?

| `target_url` host | TCP connection       | HTTP `Host` header | Good for |
| ----------------- | -------------------- | ------------------ | -------- |
| IP literal        | that IP and port     | the free name      | a VPS, a home server, one IP serving many names |
| DNS hostname      | resolved hostname    | that hostname      | a CDN, managed hosting, normal TLS |

An IP literal is the simplest registration and needs **no domain or DNS record**.
For a bare IP use `http://`: public CAs issue certificates to names, not
addresses, so `https://203.0.113.10` normally fails certificate validation unless
the certificate contains an IP SAN.

When the target is an IP, the browser sends the **free name** as `Host`, so one
server can virtual-host many registry names. Make sure the server answers for
that name (a default `server` block is enough) or it may return a 404.

When the target is a hostname, the browser fetches that hostname as itself. This
is the right choice for Cloudflare, a CDN, or any service whose TLS certificate
is issued to its own name.

## Why not a separate `target_ip` field?

An origin is the smallest value that covers the real cases:

- `http` vs `https` (a raw IP cannot say which scheme to use),
- a non-default port,
- a hostname target for CDNs and normal TLS.

A `target_ip` plus optional `target_uri` pair would duplicate the host, make
port-only records awkward, and break the four-field record format. If you only
need an IP, write `http://<ip>`; the IP is still the only address you have to
know.

## Validation rules

- Exactly four fields: `domain`, `target_url`, `owner_github`, `ttl`.
- `target_url` must be `http(s)` and an origin:
  - no credentials, path, query or fragment,
  - port 0 rejected, at most five digits,
  - maximum 2048 characters.
- The shard path must match `domain`.
- `owner_github` must be a GitHub handle.
- `ttl` must be an integer in `[60, 86400]`.
- A hostname target must not be another registry name (redirect loop).

Run `node scripts/validate.mjs` before opening a pull request.

## Examples by use case

| Situation | `target_url` |
| --------- | ------------ |
| VPS serving HTTP on port 8080 | `http://203.0.113.10:8080` |
| Static server on port 80 | `http://203.0.113.10` |
| IPv6-only server | `http://[2001:db8::1]:8080` |
| App behind Cloudflare | `https://app.example.com` |
| Managed host with HTTPS on 443 | `https://origin.example.net` |

`203.0.113.0/24`, `192.0.2.0/24` and `2001:db8::/32` are documentation ranges;
replace them with real addresses.
