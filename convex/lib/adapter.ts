import type { Doc } from "../_generated/dataModel";
import type { RawEvent } from "./rawEvent";

export type Feed = Pick<Doc<"feeds">, "source" | "name" | "url">;

export type Http = {
  text(url: string, accept?: string, headers?: Record<string, string>): Promise<string>;
};

export interface Adapter {
  source: string;
  fetch(feed: Feed, http: Http): Promise<RawEvent[]>;
}
