import type { Infer } from "convex/values";
import type { audience, eventType } from "../schema";

export type EventType = Infer<typeof eventType>;
export type Audience = Infer<typeof audience>;

export type TaggerInput = {
  title: string;
  description: string;
  organizer?: string;
  hosts: string[];
  sourceTags: string[];
  sourceEventType?: string;
};

export type Enrichment = {
  tags: string[];
  eventType: EventType;
  audience: Audience[];
  investorScore: number;
  investorSignals: string[];
};

export interface Enricher {
  enrich(input: TaggerInput): Promise<Enrichment>;
}

const TYPE_RULES: [EventType, RegExp][] = [
  ["demo_day", /\bdemo ?(days?|nights?)\b/i],
  ["pitch_competition", /\b(pitch(es|ing)?|pitch[- ]?(off|night|competition|comp)|startup competition|shark tank|venture competition)\b/i],
  ["hackathon", /\b(hackathons?|hack ?(night|day|week)|buildathon|build ?night|game jam|codefest)\b/i],
  ["career_fair", /\b(career fair|job fair|career expo|recruiting (night|event|mixer)|internship fair)\b/i],
  ["conference", /\b(summit|conference|symposium|expo|[a-z]+\/con|con 20\d\d)\b/i],
  ["workshop", /\b(workshop|bootcamp|office hours|masterclass|hands-on|tutorial|clinic)\b/i],
  ["talk", /\b(fireside|panel|talk|lecture|keynote|ama|book club|in conversation|speaker series)\b/i],
  ["networking", /\b(networking|mixer|meetup|happy hour|dinner|brunch|breakfast|coffee|founders at the table|after hours|industry night|community night|roundtable)\b/i],
  ["social", /\b(rave|golf|vinyl|party|yoga|concert|ceramics|run club|wine|karaoke)\b/i],
];

const TAG_RULES: [string, RegExp][] = [
  ["hackathons", /\b(hackathons?|hack ?(night|day|week)|buildathon|build ?night|devpost|game jam)\b/i],
  ["pitch", /\b(pitch(es|ing)?|demo ?(days?|nights?)|startup competition|venture competition|shark tank)\b/i],
  ["vc", /\b(vcs?|venture|investors?|angels?|fundrais\w*|seed round|series [ab]|term sheets?|lps?)\b/i],
  ["networking", /\b(networking|mixer|meetup|happy hour|dinner|brunch|coffee chat|community|roundtable|industry night)\b/i],
  ["founders", /\b(founders?|startups?|entrepreneur\w*|fireside|ceos?|yc)\b/i],
  ["ai", /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llms?|gpt|agents?|agentic|genai|deep learning|inference|openai|anthropic|backprop|neural)\b/i],
  ["fintech", /\b(fintech|payments?|banking|finance|financial|stripe|insurtech)\b/i],
  ["climate", /\b(climate|sustainab\w*|energy|carbon|cleantech|planetary|decarboni\w*)\b/i],
  ["health", /\b(health\w*|bio\w*|medical|medtech|clinical|life sciences?|genomics?)\b/i],
  ["crypto", /\b(crypto\w*|web3|blockchain|ethereum|solana|bitcoin|defi|onchain)\b/i],
  ["hardware", /\b(hardware|robot\w*|physical ai|iot|embedded|drones?|ar\/vr|vr|xr)\b/i],
  ["design", /\b(design\w*|ux|ui\/ux|figma|product management|creative)\b/i],
  ["careers", /\b(careers?|internships?|interns?|recruit\w*|hiring|jobs?|resume)\b/i],
];

const VC_FIRMS = [
  "Y Combinator", "YC", "a16z", "Andreessen Horowitz", "Sequoia", "Accel", "Greylock", "Kleiner Perkins",
  "Lightspeed", "Index Ventures", "General Catalyst", "Founders Fund", "Pear VC", "SV Angel",
  "First Round Capital", "Khosla Ventures", "Bessemer", "Jackson Square Ventures", "Initialized Capital",
  "Dorm Room Fund", "South Park Commons", "8VC", "Floodgate", "Felicis", "Lux Capital", "Redpoint",
  "Menlo Ventures", "CRV", "Uncork Capital", "Afore Capital", "Village Global", "BoxGroup", "Soma Capital",
  "The House Fund", "StartX", "Berkeley SkyDeck", "SkyDeck",
];

const firmPattern = (firm: string) => new RegExp(`(^|[^A-Za-z0-9])${firm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`);

const TYPE_BASE: Record<EventType, number> = {
  demo_day: 75,
  pitch_competition: 70,
  conference: 30,
  networking: 30,
  hackathon: 25,
  talk: 20,
  career_fair: 10,
  workshop: 10,
  social: 5,
  other: 5,
};

const RELEVANT_TYPES: EventType[] = ["hackathon", "pitch_competition", "demo_day", "career_fair", "networking", "conference"];

const isEventType = (s: string | undefined): s is EventType => !!s && s in TYPE_BASE;

export function classify(raw: TaggerInput): Enrichment {
  const people = [raw.organizer ?? "", ...raw.hosts].join(" · ");
  const text = [raw.title, raw.description, people, raw.sourceTags.join(" ")].join(" \n ");

  const eventType = (isEventType(raw.sourceEventType) ? raw.sourceEventType : undefined) ?? TYPE_RULES.find(([, re]) => re.test(raw.title))?.[0] ?? TYPE_RULES.find(([, re]) => re.test(text))?.[0] ?? "other";

  const tags = new Set(TAG_RULES.filter(([, re]) => re.test(text)).map(([tag]) => tag));
  if (eventType === "hackathon") tags.add("hackathons");
  if (eventType === "pitch_competition" || eventType === "demo_day") tags.add("pitch");
  if (eventType === "career_fair") tags.add("careers");
  if (eventType === "networking") tags.add("networking");

  const signals: string[] = [];
  let score = TYPE_BASE[eventType];
  if (eventType === "demo_day") signals.push("Demo day format");
  if (eventType === "pitch_competition") signals.push("Pitch competition format");

  const hostedBy = VC_FIRMS.find((f) => firmPattern(f).test(people));
  const mentioned = VC_FIRMS.find((f) => firmPattern(f).test(text));
  if (hostedBy) {
    score += 30;
    signals.push(`Hosted by ${hostedBy}`);
  } else if (mentioned) {
    score += 20;
    signals.push(`Mentions ${mentioned}`);
  }
  if (/\b(investors?|vcs?|venture capital(ists?)?|angels?|partners at)\b/i.test(text)) {
    score += 15;
    signals.push("Investors mentioned in listing");
  }
  if (/\b(judges?|judged by|judging panel)\b/i.test(text)) {
    score += 10;
    signals.push("Has a judging panel");
  }
  if (/\b(accelerator|incubator|cohort|batch|fellowship)\b/i.test(text)) {
    score += 10;
    signals.push("Accelerator or fellowship involved");
  }
  const investorScore = Math.min(100, score);
  if (investorScore >= 60 || hostedBy) tags.add("vc");

  const audience = new Set<Audience>();
  if (eventType === "hackathon") audience.add("students").add("developers");
  if (eventType === "pitch_competition" || eventType === "demo_day") audience.add("founders").add("investors");
  if (investorScore >= 50) audience.add("investors");
  if (/\b(students?|university|college|campus|undergrad\w*|stanford|berkeley|uc |mba)\b/i.test(text)) audience.add("students");
  if (tags.has("founders")) audience.add("founders");
  if (tags.has("careers")) audience.add("students");
  if (audience.size === 0) audience.add("general");

  return { tags: [...tags], eventType, audience: [...audience], investorScore, investorSignals: signals };
}

export function isRelevant(e: Enrichment): boolean {
  return e.tags.some((t) => t !== "networking") || RELEVANT_TYPES.includes(e.eventType);
}

export const rulesEnricher: Enricher = {
  enrich: async (raw) => classify(raw),
};
