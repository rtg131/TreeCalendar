import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { BAY_AREA_CITIES } from "./lib/geo";
import type { RawEvent } from "./lib/rawEvent";
import { ensureDefaults, upsertEvent } from "./lib/store";
import { toZonedIso, zonedToUtc } from "./lib/time";
import { normalize } from "./normalize";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TIMEZONE = "America/Los_Angeles";
type SeedEvent = {
  id: string;
  title: string;
  description: string;
  day: number;
  hour: number;
  hours: number;
  city: string;
  venue: string;
  offset?: [number, number];
  organizer: string;
  hosts?: string[];
  url: string;
};

const SEED: SeedEvent[] = [
  { id: "stanford-pitch-night", title: "Stanford Startup Pitch Night", description: "Ten student teams pitch to a judging panel of seed investors from Pear VC, Kleiner Perkins, and StartX alumni. Open to all Stanford students; investors welcome.", day: 2, hour: 18, hours: 3, city: "Stanford", venue: "Stanford GSB, Knight Management Center", organizer: "Stanford BASES", hosts: ["Stanford BASES", "Pear VC"], url: "https://bases.stanford.edu" },
  { id: "skydeck-demo-day", title: "Berkeley SkyDeck Demo Day", description: "The latest SkyDeck accelerator cohort presents to 300+ investors. Student founders can apply for the hot desk program on site.", day: 9, hour: 13, hours: 5, city: "Berkeley", venue: "Berkeley SkyDeck, 2150 Shattuck Ave", organizer: "Berkeley SkyDeck", url: "https://skydeck.berkeley.edu" },
  { id: "agents-hack-night", title: "AI Agents Hack Night", description: "Build an autonomous agent in one night. Mentors from OpenAI and Anthropic, prizes for the best demo, judges include partners at a16z.", day: 1, hour: 18, hours: 5, city: "San Francisco", venue: "Shack15, Ferry Building", organizer: "SF AI Builders", hosts: ["SF AI Builders"], url: "https://luma.com/ai" },
  { id: "treehacks-build-weekend", title: "TreeHacks Winter Build Weekend", description: "A 36-hour student hackathon at Stanford with tracks in AI, health, and climate. Travel reimbursement for students from other universities.", day: 12, hour: 10, hours: 36, city: "Stanford", venue: "Huang Engineering Center", organizer: "TreeHacks", url: "https://www.treehacks.com" },
  { id: "founders-funders-mixer", title: "Founders & Funders Mixer", description: "Casual networking for early-stage founders and seed investors. Drinks, short intros, and no stage program.", day: 3, hour: 18, hours: 3, city: "San Francisco", venue: "The Battery, 717 Battery St", organizer: "Pear VC", hosts: ["Pear VC"], url: "https://pear.vc" },
  { id: "climate-pitch-comp", title: "Bay Area Climate Tech Pitch Competition", description: "Climate startups compete for $50k in non-dilutive prizes. Judged by climate VCs and corporate venture partners.", day: 6, hour: 17, hours: 3, city: "Oakland", venue: "Oakland Impact Center", organizer: "Elemental Impact", url: "https://www.elementalimpact.com" },
  { id: "fintech-founders-breakfast", title: "Fintech Founders Breakfast", description: "Monthly breakfast for fintech founders and operators. This month: payments infra and stablecoin rails.", day: 4, hour: 8, hours: 2, city: "San Francisco", venue: "Stripe Office, 354 Oyster Point", organizer: "Fintech Founders SF", url: "https://luma.com/sf" },
  { id: "bio-ai-demo-day", title: "Bio x AI Demo Day", description: "Twelve biotech startups using machine learning for drug discovery demo to life sciences investors.", day: 15, hour: 14, hours: 4, city: "South San Francisco", venue: "Genentech Hall, Oyster Point", organizer: "IndieBio", url: "https://indiebio.co" },
  { id: "dorm-room-office-hours", title: "Student Founder Office Hours with Dorm Room Fund", description: "15-minute 1:1s with student partners at Dorm Room Fund. Bring a deck or just an idea. Undergrad and grad students only.", day: 5, hour: 16, hours: 3, city: "Berkeley", venue: "Haas School of Business, Cheit Hall", organizer: "Dorm Room Fund", hosts: ["Dorm Room Fund"], url: "https://dormroomfund.com" },
  { id: "robotics-hackathon", title: "Physical AI & Robotics Hackathon", description: "Two days of building with robot arms and humanoid platforms. Hardware provided. Teams of up to four.", day: 8, hour: 9, hours: 32, city: "Mountain View", venue: "Computer History Museum", organizer: "Bay Area Robotics Collective", url: "https://devpost.com/hackathons" },
  { id: "web3-builders-meetup", title: "Web3 Builders Meetup", description: "Lightning talks from onchain app builders and a demo table. Pizza provided.", day: 7, hour: 18, hours: 3, city: "San Francisco", venue: "Frontier Tower, 995 Market St", organizer: "SF Ethereum Community", url: "https://luma.com/crypto" },
  { id: "design-product-night", title: "Design + Product Night", description: "Portfolio reviews and a panel on designing AI-native products, with design leads from Figma and Linear.", day: 10, hour: 18, hours: 3, city: "San Francisco", venue: "Figma HQ, 760 Market St", organizer: "Design Buddies SF", url: "https://luma.com/sf" },
  { id: "startup-career-fair", title: "Startup Career Fair: Seed to Series B", description: "Meet 40+ venture-backed startups hiring interns and new grads. Resume reviews on site.", day: 11, hour: 11, hours: 5, city: "San Jose", venue: "SJSU Student Union Ballroom", organizer: "SJSU Career Center", url: "https://www.sjsu.edu/careercenter" },
  { id: "women-in-vc-panel", title: "Women in VC: How Partners Pick Seed Deals", description: "A fireside and panel with partners from Sequoia, Floodgate, and Felicis on what they look for in first-time founders.", day: 13, hour: 17, hours: 2, city: "Menlo Park", venue: "Rosewood Sand Hill", organizer: "All Raise", url: "https://allraise.org" },
  { id: "first-founder-fireside", title: "Fireside: From Dorm Room to Series A", description: "A YC founder on going from a class project to a $15M Series A, followed by Q&A and networking.", day: 2, hour: 19, hours: 2, city: "Palo Alto", venue: "Hanahaus, 456 University Ave", organizer: "Palo Alto Founders Club", url: "https://www.ycombinator.com/library" },
  { id: "healthtech-pitch-off", title: "Healthtech Pitch-Off at UCSF", description: "Student and resident founders pitch digital health startups. Judges from Rock Health and General Catalyst.", day: 16, hour: 17, hours: 3, city: "San Francisco", venue: "UCSF Mission Bay Conference Center", offset: [-0.004, 0.03], organizer: "UCSF Innovation Ventures", url: "https://innovation.ucsf.edu" },
  { id: "scu-venture-competition", title: "Santa Clara University Venture Competition Finals", description: "Final round of SCU's annual student venture competition. $25k prize pool, judged by angels and alumni investors.", day: 19, hour: 16, hours: 4, city: "Santa Clara", venue: "Leavey School of Business", organizer: "Ciocca Center for Innovation", url: "https://www.scu.edu/ciocca" },
  { id: "open-source-ai-summit", title: "Open Source AI Summit", description: "A one-day conference on open-weight models, inference infra, and evals. Student tickets discounted.", day: 21, hour: 9, hours: 9, city: "San Francisco", venue: "Fort Mason Festival Pavilion", offset: [0.03, 0.0], organizer: "Open Source AI Collective", url: "https://luma.com/ai" },
  { id: "angel-investing-101", title: "Angel Investing 101 Workshop", description: "A hands-on workshop for operators and students curious about angel investing: deal flow, SAFEs, and portfolio construction.", day: 14, hour: 18, hours: 2, city: "Palo Alto", venue: "Palo Alto Startup Garage", organizer: "SV Angel", hosts: ["SV Angel"], url: "https://svangel.com" },
  { id: "climate-hack-weekend", title: "Cal Climate Hack Weekend", description: "A student hackathon on energy, carbon, and climate resilience. Sponsored by Lowercarbon Capital.", day: 17, hour: 10, hours: 30, city: "Berkeley", venue: "Jacobs Hall, UC Berkeley", organizer: "Cal Hacks", url: "https://calhacks.io" },
  { id: "spc-demo-night", title: "South Park Commons Demo Night", description: "Members of the SPC founder fellowship demo what they've built this quarter. Investors and engineers welcome.", day: 20, hour: 18, hours: 3, city: "San Francisco", venue: "South Park Commons, 380 Brannan St", organizer: "South Park Commons", hosts: ["South Park Commons"], url: "https://www.southparkcommons.com" },
  { id: "hardware-meetup", title: "SF Hardware Meetup", description: "Show-and-tell for hardware startups: prototypes, manufacturing war stories, and a networking hour.", day: 6, hour: 18, hours: 3, city: "San Francisco", venue: "Bolt Fabrication, Dogpatch", offset: [-0.015, 0.03], organizer: "SF Hardware", url: "https://luma.com/tech" },
];

function toRaw(seed: SeedEvent, now: number): RawEvent {
  const city = BAY_AREA_CITIES.find((c) => c.name === seed.city) ?? BAY_AREA_CITIES[0];
  const today = new Date(toZonedIso(now, TIMEZONE).slice(0, 10) + "T00:00:00Z");
  const day = new Date(today.getTime() + seed.day * DAY);
  const start = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), seed.hour, 0, TIMEZONE);
  const [dLat, dLng] = seed.offset ?? [0, 0];
  return {
    source: "seed",
    sourceId: seed.id,
    title: seed.title,
    description: seed.description,
    url: seed.url,
    startsAt: toZonedIso(start, TIMEZONE),
    endsAt: toZonedIso(start + seed.hours * HOUR, TIMEZONE),
    timezone: TIMEZONE,
    location: { online: false, name: seed.venue, city: city.name, lat: city.lat + dLat, lng: city.lng + dLng },
    organizer: seed.organizer,
    hosts: seed.hosts ?? [],
  };
}

export const run = internalMutation({
  args: {},
  returns: v.object({ seeded: v.number() }),
  handler: async (ctx) => {
    await ensureDefaults(ctx);
    const now = Date.now();
    let seeded = 0;
    for (const seed of SEED) {
      const event = await normalize(toRaw(seed, now));
      if (!event) continue;
      await upsertEvent(ctx, event);
      seeded++;
    }
    return { seeded };
  },
});
