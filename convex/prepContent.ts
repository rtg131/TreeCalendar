import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";

export const source = v.union(v.literal("template"), v.literal("model"));
export const briefingValue = v.object({
  summary: v.string(),
  people: v.array(v.string()),
  questions: v.array(v.string()),
  tip: v.string(),
  source,
});
export const followupValue = v.object({
  recipient: v.string(),
  linkedin: v.string(),
  email: v.string(),
  source,
});
export type Briefing = Infer<typeof briefingValue>;
export type Followup = Infer<typeof followupValue>;

export const QUESTIONS = [
  "What problem are you most interested in working on next?",
  "What would make this event useful for you?",
  "What is one resource you would recommend to someone getting started?",
  "How do you decide which ideas are worth testing first?",
  "What is the biggest challenge in turning a prototype into something people use?",
  "What would you want to learn from a short project demo?",
];
export const TIPS = [
  "Prepare a short introduction and one concrete question. Check the official listing before you go.",
  "Choose one goal for the event, and ask permission before sending a follow-up.",
  "Keep your introduction brief and leave space for the other person to speak.",
  "For a hackathon, pick a small problem and plan a demo you can finish before adding features.",
  "For pitches and demos, prepare a one-sentence problem statement and one concrete example of progress.",
  "At a mixer, start with an open question and ask permission before exchanging contact details.",
];

export function fingerprint(event: Doc<"events">): string {
  return JSON.stringify([
    "prep-v3", event.title, event.description, event.startTime, event.endTime,
    event.timezone, event.city, event.venue, event.address, event.isOnline,
    event.organizer, event.hosts, event.tags, event.eventType, event.url, event.investorSignals,
  ]);
}

export function cleanRecipient(recipient: string): string {
  const cleaned = recipient.trim();
  if (!cleaned || cleaned.length > 120 || /[\r\n\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new Error("Recipient must be 1–120 characters on one line");
  }
  return cleaned;
}

export function templateBriefing(event: Doc<"events">): Briefing {
  const excerpts = event.description.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [];
  const people = excerpts
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\b(speakers?|keynotes?|judges?|judging|judged|sponsors?|sponsored|mentors?|partners?)\b/i.test(sentence));
  const excerpt = (label: string, text: string) => `${label}: “${text.length > 160 ? `${text.slice(0, 160)}…` : text}”`;
  const listing = [...new Set(people)].map((text) => excerpt("Listing", text));
  const hosts = [...new Set([...event.hosts, ...(event.organizer ? [event.organizer] : [])])];
  const signals = [...new Set(event.investorSignals)]
    .filter((text) => /\b(mentions\b|hosted by\b|sponsored by\b|judges?:|speakers?:)/i.test(text))
    .map((text) => excerpt("Inferred signal (not attendance)", text));
  const namedRoles = people.some((sentence) => /\b(speakers?|keynotes?|judges?|judging|judged|sponsors?|sponsored)\b/i.test(sentence));
  return {
    summary: `${event.title} — ${event.eventType.replace(/_/g, " ")} · ${event.isOnline ? "Online" : event.city}`.replace(/[\r\n]+/g, " "),
    people: [
      ...(hosts.length ? [excerpt("Hosts", hosts.join("; "))] : []),
      ...listing.slice(0, signals.length ? 1 : 2),
      ...signals.slice(0, 1),
      ...(namedRoles ? [] : ["Speakers, judges, and sponsors: not listed"]),
    ],
    questions: event.eventType === "hackathon" || event.eventType === "pitch_competition" || event.eventType === "demo_day"
      ? [QUESTIONS[0], QUESTIONS[3], QUESTIONS[5]]
      : QUESTIONS.slice(0, 3),
    tip: TIPS[event.eventType === "hackathon" ? 3 : event.eventType === "pitch_competition" || event.eventType === "demo_day" ? 4 : event.eventType === "networking" || event.eventType === "social" ? 5 : 0],
    source: "template",
  };
}

export function templateFollowup(event: Doc<"events">, recipient: string): Followup {
  return {
    recipient,
    linkedin: `Hi ${recipient}, I’m reaching out in connection with ${event.title}. I’d like to connect and learn more about your work, if you’re open to it.`,
    email: `Subject: Connecting around ${event.title.replace(/[\r\n]+/g, " ")}\n\nHi ${recipient},\n\nI’m reaching out in connection with ${event.title}. I’d be interested in learning more about your work and sharing what I’m working on. Would you be open to connecting?\n\nNo pressure if now isn’t a good time.\n\nBest,\n[Your name]`,
    source: "template",
  };
}
