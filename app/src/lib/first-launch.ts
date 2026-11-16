export const INSTALL_MARKER_KEY = "cac.installed";

const CONVEX_AUTH_KEYS = ["__convexAuthJWT", "__convexAuthRefreshToken", "__convexAuthOAuthVerifier"];

export const convexAuthStorageKeys = (namespace: string) => {
  const escaped = namespace.replace(/[^a-zA-Z0-9]/g, "");
  return CONVEX_AUTH_KEYS.map((key) => `${key}_${escaped}`);
};

type Marker = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
type Keychain = { deleteItemAsync: (key: string) => Promise<void> };

export async function clearAuthOnFreshInstall(marker: Marker, keychain: Keychain, namespace: string) {
  if (await marker.getItem(INSTALL_MARKER_KEY)) return false;
  await Promise.all(convexAuthStorageKeys(namespace).map((key) => keychain.deleteItemAsync(key)));
  await marker.setItem(INSTALL_MARKER_KEY, "1");
  return true;
}
