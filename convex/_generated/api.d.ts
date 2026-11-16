/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapters_devpost from "../adapters/devpost.js";
import type * as adapters_eventbrite from "../adapters/eventbrite.js";
import type * as adapters_fixture from "../adapters/fixture.js";
import type * as adapters_ical from "../adapters/ical.js";
import type * as adapters_index from "../adapters/index.js";
import type * as adapters_jsonld from "../adapters/jsonld.js";
import type * as adapters_llm_adapter from "../adapters/llm/adapter.js";
import type * as adapters_llm_client from "../adapters/llm/client.js";
import type * as adapters_llm_extract from "../adapters/llm/extract.js";
import type * as adapters_llm_prompt from "../adapters/llm/prompt.js";
import type * as adapters_llm_strip from "../adapters/llm/strip.js";
import type * as adapters_llm_time from "../adapters/llm/time.js";
import type * as adapters_llm_validate from "../adapters/llm/validate.js";
import type * as adapters_llmExtract from "../adapters/llmExtract.js";
import type * as adapters_luma from "../adapters/luma.js";
import type * as adapters_mlh from "../adapters/mlh.js";
import type * as attendance from "../attendance.js";
import type * as attendanceModel from "../attendanceModel.js";
import type * as attendanceSeed from "../attendanceSeed.js";
import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as companies from "../companies.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as feed from "../feed.js";
import type * as feeds from "../feeds.js";
import type * as fixtures from "../fixtures.js";
import type * as friends from "../friends.js";
import type * as hosts from "../hosts.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as interests from "../interests.js";
import type * as investor from "../investor.js";
import type * as lib_account from "../lib/account.js";
import type * as lib_adapter from "../lib/adapter.js";
import type * as lib_connections from "../lib/connections.js";
import type * as lib_contact from "../lib/contact.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_fixtures from "../lib/fixtures.js";
import type * as lib_freeMail from "../lib/freeMail.js";
import type * as lib_friends from "../lib/friends.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_hostCompany from "../lib/hostCompany.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_interests from "../lib/interests.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_profile from "../lib/profile.js";
import type * as lib_ranking from "../lib/ranking.js";
import type * as lib_rawEvent from "../lib/rawEvent.js";
import type * as lib_robots from "../lib/robots.js";
import type * as lib_scouting from "../lib/scouting.js";
import type * as lib_store from "../lib/store.js";
import type * as lib_tagger from "../lib/tagger.js";
import type * as lib_time from "../lib/time.js";
import type * as links from "../links.js";
import type * as normalize_backfill from "../normalize/backfill.js";
import type * as normalize_dedupe from "../normalize/dedupe.js";
import type * as normalize_embed from "../normalize/embed.js";
import type * as normalize_enrich from "../normalize/enrich.js";
import type * as normalize_geocode from "../normalize/geocode.js";
import type * as normalize_index from "../normalize/index.js";
import type * as normalize_reassignEventRefs from "../normalize/reassignEventRefs.js";
import type * as prep from "../prep.js";
import type * as prepContent from "../prepContent.js";
import type * as prepReferences from "../prepReferences.js";
import type * as prepStore from "../prepStore.js";
import type * as qa from "../qa.js";
import type * as saves from "../saves.js";
import type * as seed from "../seed.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/devpost": typeof adapters_devpost;
  "adapters/eventbrite": typeof adapters_eventbrite;
  "adapters/fixture": typeof adapters_fixture;
  "adapters/ical": typeof adapters_ical;
  "adapters/index": typeof adapters_index;
  "adapters/jsonld": typeof adapters_jsonld;
  "adapters/llm/adapter": typeof adapters_llm_adapter;
  "adapters/llm/client": typeof adapters_llm_client;
  "adapters/llm/extract": typeof adapters_llm_extract;
  "adapters/llm/prompt": typeof adapters_llm_prompt;
  "adapters/llm/strip": typeof adapters_llm_strip;
  "adapters/llm/time": typeof adapters_llm_time;
  "adapters/llm/validate": typeof adapters_llm_validate;
  "adapters/llmExtract": typeof adapters_llmExtract;
  "adapters/luma": typeof adapters_luma;
  "adapters/mlh": typeof adapters_mlh;
  attendance: typeof attendance;
  attendanceModel: typeof attendanceModel;
  attendanceSeed: typeof attendanceSeed;
  auth: typeof auth;
  chat: typeof chat;
  companies: typeof companies;
  connections: typeof connections;
  crons: typeof crons;
  events: typeof events;
  feed: typeof feed;
  feeds: typeof feeds;
  fixtures: typeof fixtures;
  friends: typeof friends;
  hosts: typeof hosts;
  http: typeof http;
  ingest: typeof ingest;
  interests: typeof interests;
  investor: typeof investor;
  "lib/account": typeof lib_account;
  "lib/adapter": typeof lib_adapter;
  "lib/connections": typeof lib_connections;
  "lib/contact": typeof lib_contact;
  "lib/email": typeof lib_email;
  "lib/fixtures": typeof lib_fixtures;
  "lib/freeMail": typeof lib_freeMail;
  "lib/friends": typeof lib_friends;
  "lib/geo": typeof lib_geo;
  "lib/hostCompany": typeof lib_hostCompany;
  "lib/http": typeof lib_http;
  "lib/identity": typeof lib_identity;
  "lib/interests": typeof lib_interests;
  "lib/media": typeof lib_media;
  "lib/profile": typeof lib_profile;
  "lib/ranking": typeof lib_ranking;
  "lib/rawEvent": typeof lib_rawEvent;
  "lib/robots": typeof lib_robots;
  "lib/scouting": typeof lib_scouting;
  "lib/store": typeof lib_store;
  "lib/tagger": typeof lib_tagger;
  "lib/time": typeof lib_time;
  links: typeof links;
  "normalize/backfill": typeof normalize_backfill;
  "normalize/dedupe": typeof normalize_dedupe;
  "normalize/embed": typeof normalize_embed;
  "normalize/enrich": typeof normalize_enrich;
  "normalize/geocode": typeof normalize_geocode;
  "normalize/index": typeof normalize_index;
  "normalize/reassignEventRefs": typeof normalize_reassignEventRefs;
  prep: typeof prep;
  prepContent: typeof prepContent;
  prepReferences: typeof prepReferences;
  prepStore: typeof prepStore;
  qa: typeof qa;
  saves: typeof saves;
  seed: typeof seed;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
