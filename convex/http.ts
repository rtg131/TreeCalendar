import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { SCOUT_TEST_EVENT_PATH, scoutTestEventHtml } from "./lib/fixtures";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: SCOUT_TEST_EVENT_PATH,
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    if (process.env.ENABLE_TEST_FIXTURES !== "1") return new Response("Not found", { status: 404 });
    const html = scoutTestEventHtml(new URL(SCOUT_TEST_EVENT_PATH, request.url).toString(), Date.now());
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }),
});

export default http;
