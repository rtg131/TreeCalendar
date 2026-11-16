export const INTERESTS = [
  { id: "hackathons", label: "Hackathons", emoji: "💻" },
  { id: "pitch", label: "Pitch competitions", emoji: "🎤" },
  { id: "vc", label: "VC & fundraising", emoji: "💸" },
  { id: "networking", label: "Networking", emoji: "🤝" },
  { id: "founders", label: "Founder talks", emoji: "🚀" },
  { id: "ai", label: "AI & ML", emoji: "🧠" },
  { id: "fintech", label: "Fintech", emoji: "🏦" },
  { id: "climate", label: "Climate", emoji: "🌱" },
  { id: "health", label: "Health & bio", emoji: "🧬" },
  { id: "crypto", label: "Crypto & web3", emoji: "⛓️" },
  { id: "hardware", label: "Hardware & robotics", emoji: "🤖" },
  { id: "design", label: "Design & product", emoji: "🎨" },
  { id: "careers", label: "Internships & careers", emoji: "🎓" },
] as const;

export type InterestId = (typeof INTERESTS)[number]["id"];

export const INTEREST_IDS: string[] = INTERESTS.map((i) => i.id);
