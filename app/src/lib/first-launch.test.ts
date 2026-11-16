import { expect, test } from "vitest";
import { INSTALL_MARKER_KEY, clearAuthOnFreshInstall, convexAuthStorageKeys } from "./first-launch";

const fakes = (marker: Record<string, string>, keychain: Record<string, string>) => ({
  marker: {
    getItem: async (key: string) => marker[key] ?? null,
    setItem: async (key: string, value: string) => void (marker[key] = value),
  },
  keychain: { deleteItemAsync: async (key: string) => void delete keychain[key] },
});

const URL = "https://small-mouse-123.convex.cloud";

test("auth keys use Convex Auth's escaped namespace", () => {
  expect(convexAuthStorageKeys(URL)).toEqual([
    "__convexAuthJWT_httpssmallmouse123convexcloud",
    "__convexAuthRefreshToken_httpssmallmouse123convexcloud",
    "__convexAuthOAuthVerifier_httpssmallmouse123convexcloud",
  ]);
});

test("first launch after install clears the surviving keychain session and sets the marker", async () => {
  const marker: Record<string, string> = {};
  const keychain: Record<string, string> = Object.fromEntries(convexAuthStorageKeys(URL).map((k) => [k, "stale"]));
  keychain.unrelated = "keep";
  const { marker: m, keychain: k } = fakes(marker, keychain);
  expect(await clearAuthOnFreshInstall(m, k, URL)).toBe(true);
  expect(keychain).toEqual({ unrelated: "keep" });
  expect(marker[INSTALL_MARKER_KEY]).toBe("1");
});

test("later launches keep the session", async () => {
  const marker: Record<string, string> = { [INSTALL_MARKER_KEY]: "1" };
  const keychain: Record<string, string> = Object.fromEntries(convexAuthStorageKeys(URL).map((k) => [k, "live"]));
  const { marker: m, keychain: k } = fakes(marker, keychain);
  expect(await clearAuthOnFreshInstall(m, k, URL)).toBe(false);
  expect(Object.keys(keychain)).toHaveLength(3);
});
