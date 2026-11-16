import { ConvexReactClient } from "convex/react";

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error("EXPO_PUBLIC_CONVEX_URL is not set. Run npx convex dev or copy .env.example to .env.local.");

export const convexUrl = url;
export const convex = new ConvexReactClient(url, { unsavedChangesWarning: false });
