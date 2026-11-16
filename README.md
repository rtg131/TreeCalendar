# Scout

Scout finds nearby startup events tied to what you care about. Students find hackathons, pitch competitions, and networking nights; investors find student events worth scouting. A Convex backend pulls listings from public sources into one feed, ranks it by interest match, soonness, and distance, and flags events where investors are likely to be in the room.

## Layout

```
app/                    Expo app (expo-router, TypeScript); Revyl config in app/.revyl/
convex/
  schema.ts             tables: feeds, fetch_log, raw_listings, events, users, interests, saves
  lib/rawEvent.ts       RawEvent type + validator (the adapter contract)
  lib/adapter.ts        Adapter interface: fetch(feed) -> RawEvent[]
  adapters/<source>.ts  one file per source (devpost, luma)
  normalize/            RawEvent -> events row: geo, Bay Area filter, rules tagger
  lib/tagger.ts         rules-based tags, event type, audience, investor score (Enricher seam for LLM tagging)
  ingest.ts             runDue (claims due feeds) / runFeed (dispatch via adapters/index.ts registry), store + fetch_log mutations
  feed.ts               ranked feed query
  crons.ts              due feeds every 30 min, daily demo seed refresh
  seed.ts               22 realistic Bay Area events so the feed is never empty
fixtures/<source>/      saved pages + expected RawEvent JSON for offline adapter tests
docs/tasks.md           task breakdown for the parallel build
```

`AGENTS.md`, `convex/adapters/AGENTS.md`, and `.capy/rules/convex.md` hold the rules every agent follows. Schema and contract changes (`schema.ts`, `lib/rawEvent.ts`, `lib/adapter.ts`) go through the owning PR and are named in its title.

## Setup

Requires Node 22+ and pnpm 10.

```bash
pnpm install
```

### Environment variables

| Variable | Where | Purpose |
| - | - | - |
| `CONVEX_DEPLOYMENT` | root `.env.local` (written by `npx convex dev`) | Which deployment the Convex CLI targets |
| `CONVEX_DEPLOY_KEY` | shell / CI secret, optional | Non-interactive CLI access to a cloud deployment (a `dev:` key for agents, `prod:` only in GitHub secrets) |
| `EXPO_PUBLIC_CONVEX_URL` | `app/.env.local` | Convex client URL the app connects to (`https://<name>.convex.cloud`, or `http://127.0.0.1:3210` locally) |
| `REVYL_API_KEY` | shell / CI secret | Revyl CLI auth for builds and test runs (or `revyl auth login`) |

Host work-email verification (`hosts.startVerification`) needs one of these on the Convex deployment (`npx convex env set`):

| Variable | Purpose |
| - | - |
| `RESEND_API_KEY` + `EMAIL_FROM` | Send verification codes through Resend. Takes priority when both are set. |
| `EMAIL_DEV_MODE=1` | Dev shell: sends nothing and returns the code to the app as `devCode` (also logged). |

> **Never set `EMAIL_DEV_MODE` on production.** A dev-verified host proves nothing about owning the address: anyone can verify any work email. Hosts verified this way are marked `workEmailVerifiedVia: "dev"` and `hosts.status` reports `verificationMode: "dev"`. With neither option set, verification throws `email_not_configured`.

Admin approvals run through the CLI with a deploy key: `pnpm verify:company <slug> [--by <name>] [--unverify]` for companies without a work domain, such as `.edu` clubs, and `pnpm approve:claim <claimId>` for pending event-hosting claims.

No source needs an API key today: Devpost's public hackathon JSON and Luma's public pages are read without auth.

## Run the backend

```bash
npx convex dev                       # pushes functions and watches; writes root .env.local
pnpm seed                            # feeds, interests, and demo events
pnpm ingest                          # fetch every feed now (the cron does this every 30 min)
```

With no Convex login and no deploy key, `npx convex dev` in a non-interactive shell starts an anonymous local backend on port 3210. `CONVEX_AGENT_MODE=anonymous npx convex dev` forces that mode. With `CONVEX_DEPLOY_KEY` set it pushes to that key's deployment instead.

Then point the app at it:

```bash
grep EXPO_PUBLIC_CONVEX_URL .env.local > app/.env.local   # cloud deployment
echo EXPO_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 > app/.env.local   # local backend
```

## Run the app

```bash
pnpm app            # expo start; press i for an iOS simulator, a for Android
```

Location uses `expo-location`, so a development build (`npx expo run:ios`) or a Revyl build is needed for the device-location path; picking a city works everywhere.

## Checks

```bash
pnpm typecheck      # convex, tests, and app
pnpm test           # vitest + convex-test, fully offline against fixtures/
pnpm lint
```

## Revyl tests

Revyl config lives in `app/.revyl/config.yaml`, with the iOS app `Scout iOS` linked to the `preview` and `development` profiles. Each user flow has one test in `app/.revyl/tests/`, and all of them are grouped in the `scout-e2e` Revyl workflow:

| Test | Flow |
| --- | --- |
| `smoke-onboarding-feed` | Quick smoke: onboarding, feed, detail, save, open link |
| `student-onboarding-feed` | Student onboarding through to the feed and tab bar |
| `feed-filters` | The Investors likely, This week and All filter chips |
| `event-detail-save-unsave` | Event detail, save, then unsave |
| `saved-screen` | Saved tab: empty state, a saved event, unsave with Undo |
| `profile-edit` | Profile tab: edit interests, area and distance; feed follows |
| `investor-onboarding-home` | Investor onboarding, the Scouting tab, investor event detail |
| `paste-a-link` | Add an event by link: validation errors, then the dev fixture `https://nautical-sheep-358.convex.site/fixtures/scout-test-event` (needs `ENABLE_TEST_FIXTURES=1` on the deployment) |

Most tests start with the shared `onboard-student` module (`app/.revyl/modules/`). It taps Get started on the welcome screen, picks Talent, signs up on About you, and lands on the feed near Palo Alto. Sign-up needs a new email on every fresh install, so the `e2e-email` script (`app/.revyl/scripts/e2e-email.sh`) mints `scout-e2e+<time><random>@example.com` into the `{{email}}` variable at the start of each run. These test accounts live on the dev deployment only.

```bash
curl -fsSL https://revyl.com/install.sh | sh   # then: export PATH=$HOME/.revyl/bin:$PATH
export REVYL_API_KEY=...                        # or: revyl auth login
cd app
revyl build --profile preview --platform ios
revyl workflow run scout-e2e                    # the whole suite (2 devices at once on the current plan)
revyl test run feed-filters                     # one test
revyl test share feed-filters                   # public link to the latest report
```

Release builds bundle the JS, so rebuild after any app change. The Convex URL comes from `build.env` in the config; pass `--env EXPO_PUBLIC_CONVEX_URL=...` to point a build at another deployment. A backend-only change needs only a rerun. To keep the copies saved in Revyl in step for dashboard runs, run `revyl test push <name> --force` after editing a test, and `revyl module update onboard-student --from-file .revyl/modules/onboard-student.yaml` after editing the module.

Pull requests run on Revyl itself, with no GitHub Actions secret needed. The Revyl GitHub App is installed on this repo, and the `pr_review` block in `app/.revyl/config.yaml` builds every non-draft PR that touches `app/` with the `pull-request` profile. It then runs the 3-test `scout-smoke` workflow (smoke-onboarding-feed, investor-onboarding-home, map-discovery) against that build; run the full `scout-e2e` suite on builds of main and posts a Proof of changes comment on the PR. Draft PRs are skipped until they're marked ready. Comment `@revyl proof` to prove a PR on demand.

`run_test_definitions_from_git` is on, so runs use the test and module files on the PR's own branch. Edit the YAML in the repo, not in the Revyl dashboard. Locally, `revyl test run <name> --from-checkout` runs your uncommitted files. After a change to `pr_review`, run `revyl config validate`, then `revyl config push`; once this file is on `main`, Git owns the published config.

## Sources

| Source | Tier | What we read |
| - | - | - |
| Devpost | public JSON API | `devpost.com/api/hackathons` (in-person and online, paged) |
| Luma | structured data in the page | `__NEXT_DATA__` on public city and calendar pages (`luma.com/sf`, community calendars) |

Requests are spaced at least one second apart per domain and identify as `CAC-EventsBot`. Only public listings are read; no attendee data is stored, and fixtures are trimmed to the fields the parsers read.
