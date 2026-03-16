import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "spherecare_access_token";
const USER_KEY = "spherecare_user";

export async function saveSession(token: string, user?: unknown) {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);

  if (user) {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  }
}

export async function getAccessToken() {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getStoredUser<T>() {
  const raw = await SecureStore.getItemAsync(USER_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}