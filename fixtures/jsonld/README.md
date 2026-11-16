# JSON-LD adapter fixtures

Each folder holds one public event page, fetched once on 2026-11-15 after checking the site's robots.txt, and the RawEvent[] the adapter must return for it.

- `source.json`: the page URL and fetch date.
- `page.html`: the page trimmed to its `<title>`, `<meta>` tags, canonical link, `application/ld+json` blocks and `<time>` elements. Everything else, including app state scripts that can carry guest lists, was dropped before committing.
- `expected.json`: the expected adapter output.

`partiful-meta` is the `partiful` page with its JSON-LD block removed. Partiful now ships schema.org Event JSON-LD, so this variant is what exercises the OpenGraph/meta fallback.
