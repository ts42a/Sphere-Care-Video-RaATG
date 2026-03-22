import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "spherecare_access_token";
const USER_KEY = "spherecare_user";

async function setItem(key: string, value: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string) {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string) {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

export async function saveSession(token: string, user?: unknown) {
  await setItem(ACCESS_TOKEN_KEY, token);

  if (user) {
    await setItem(USER_KEY, JSON.stringify(user));
  }
}

export async function getAccessToken() {
  return getItem(ACCESS_TOKEN_KEY);
}

export async function getStoredUser<T>() {
  const raw = await getItem(USER_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await deleteItem(ACCESS_TOKEN_KEY);
  await deleteItem(USER_KEY);
}