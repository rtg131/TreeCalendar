import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: (ctx) => ctx.db.query("interests").collect().then((rows) => rows.sort((a, b) => a.order - b.order)),
});
