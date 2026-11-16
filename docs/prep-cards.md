# Prep cards

Event detail offers a cached, listing-grounded briefing before an event and editable-recipient follow-up drafts after its end time (or the feed's default three-hour duration). Drafts are never sent. Copy uses Expo Clipboard. Anonymous device IDs follow the app's existing trust model; they are not authenticated accounts.

Prep only uses public event fields and the recipient the user types. It does not copy profile names, email addresses, phone numbers, LinkedIn URLs, affiliations, work-email verification fields, or connection contacts into cards or model requests. Signing in adopts the account's existing device profile through the app's bridge; prep does not introduce a separate identity mechanism.

The shared event-reference transaction hook rekeys follow-ups when dedupe replaces an event and deletes prep rows during fixture purge. Dedupe drops both briefing caches and rebuilds follow-up text from the merged survivor and retained recipient, preferring the survivor's existing draft on user/event collisions. No orphan references or stale merged-listing drafts are retained.

## Demo

After deploying these modules and seeding events, run:

```sh
pnpm seed
pnpm exec convex run prepStore:preGenerateSeed
```

The second command pre-generates deterministic briefings for all `source: seed` events and is idempotent. No model connection or key is needed during the demo. Convex must still be reachable; this is not an offline database cache. Running the seed command again changes dates, so rerun pre-generation afterward.

For the follow-up flow, open a past saved event. The Revyl test `app/.revyl/tests/prep-and-followup.yaml` requires a past saved fixture in its test deployment. Do not alter real listing dates to manufacture a past event.

## Optional model access

The Convex plugin's agent skill requires Convex Cloud 1.45+ and a paid plan for its no-provider-key AI Gateway. This workspace uses an anonymous **local** backend, which the same skill explicitly excludes. The shared machine `MODEL_*` credentials are not copied into Convex or used by this feature.

Set these deployment variables through Convex's environment-variable tools or `convex env set` with securely supplied runtime values:

- `PREP_API_KEY`: a dedicated provider key (optional).
- `PREP_BASE_URL`: an OpenAI-compatible base URL ending in `/v1`; defaults to `https://api.openai.com/v1`.
- `PREP_MODEL`: the provider's model ID; defaults to `gpt-4o-mini`.

Never pass a key in chat, source, a command literal, or a client-prefixed variable. Without a key, on provider failure, or after an eight-second timeout, actions cache the deterministic template. A cached template is intentionally not regenerated just because a key becomes available. Event edits invalidate both briefing and follow-up caches.

The model can only select indexes into curated question prompts. It cannot write names, modify the format tip, or invent attendance. Names stay in quoted listing/host/inferred-signal excerpts; inferred signals are labeled as such. Follow-up text is deterministic from the event title and the user-entered recipient, and doesn't invent a past conversation. Each registered device has six cache misses per rolling minute across both actions; cache hits are free. Follow-ups are isolated by user and event.

## Verification

`pnpm typecheck`, `pnpm test`, and `pnpm lint` cover the changes. Convex tests mock all model calls and exercise provider failures, malformed output, prompt-injection output, invalid input, cache invalidation, user isolation, concurrent rate limiting, and seed pre-generation. A live provider call requires the dedicated key above; mocked success is not a live-model verification.
