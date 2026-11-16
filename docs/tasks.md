# Task breakdown

Six threads run at once in wave 1 because each owns separate files and builds against the committed contracts. Wave 2 waits for those merges, since it consumes their output.

| # | Task | Wave | Depends on | Done when |
| - | - | - | - | - |
| 0 | Contracts: schema, `RawEvent`, `Adapter`, fixtures, `AGENTS.md`, setup | 0 (a person) | — | Merged to main; pnpm test runs |
| 1 | iCal adapter: university calendars, Luma calendars, Google Calendar, Meetup groups | 1 | 0 | Passes fixtures for 3 calendar platforms |
| 2 | JSON-LD adapter: Eventbrite, Luma, Meetup event pages, Partiful page metadata | 1 | 0 | Passes fixtures for 4 sites |
| 3 | Devpost + MLH adapter | 1 | 0 | In-person hackathons parsed with dates and city |
| 4 | Open-model extraction adapter for club pages (gpt-oss-20b, schema validation, one retry) | 1 | 0 | 90%+ field accuracy on the 30-page test set |
| 5 | Expo app shell: onboarding, interest picker, feed list, event detail, against a mocked feed | 1 | 0 | Runs on a cloud phone |
| 6 | Feeds table, seed list loader, crons, `fetch_log`, robots.txt cache | 1 | 0 | Cron runs a due feed end to end locally |
| 7 | Normalize: geocode, dedupe, tag + embed, upsert to events | 2 | 1–4, 6 | Same event from two sources becomes one row |
| 8 | Ranked feed query + wire the app to it | 2 | 5, 7 | App shows a live ranked feed |
| 9 | Paste-a-link: app form + action that routes a URL through the tiers | 2 | 1–4, 5 | A Partiful and a Luma link both land in the feed |
| 10 | Mobile E2E on a Revyl cloud phone: sign up, pick interests, feed loads, save, submit link | 3 | 8, 9 | Flow passes on iPhone and Android |
| 11 | Full crawl of the seed list + data QA | 3 | 7 | Demo targets met (300+ events, under 5% duplicates) |
