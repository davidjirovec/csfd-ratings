# ČSFD ratings export

This repository exports all public ratings from the ČSFD profile
[`115923-bon-go`](https://www.csfd.cz/uzivatel/115923-bon-go/hodnoceni/) to
`data/csfd-ratings.json`.

The GitHub Action runs daily at 03:17 UTC and can also be started manually from
**Actions → Export ČSFD ratings → Run workflow**. It uses the unofficial
[`node-csfd-api`](https://github.com/bartholomej/node-csfd-api) scraper and
fetches and validates each pagination page independently.

The export contains the original and normalized title, year, content type,
canonical ČSFD URL and ID, personal rating, and rating date. A monitoring task
can read it at:

```text
https://raw.githubusercontent.com/davidjirovec/csfd-ratings/main/data/csfd-ratings.json
```

## Safety checks

- All profile pages are fetched independently, with a 5–6.5-second randomized
  delay between successful requests.
- Empty, unexpectedly short, or repeated pages are retried after progressively
  longer delays instead of restarting the complete export.
- A failed or suspiciously small export never replaces the last good file.
- The first export must contain at least 1,300 ratings.
- A later export may not lose more than 1% of the preceding ratings unless
  `ALLOW_RATING_DROP=true` is explicitly supplied for an intentional cleanup.
- The workflow commits only when the rating data changes.

No credentials or GitHub secrets are required. Because the intended raw URL is
public, the exported rating history is public too.
