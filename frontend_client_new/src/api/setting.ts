import { mockSettings } from "../mock/settingData";
import type { SettingRow, SettingToggleKey } from "../types/setting";

let inMemorySettings: SettingRow[] = [...mockSettings];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getSettings(): Promise<SettingRow[]> {
  await wait(150);
  return inMemorySettings;
}

export async function updateSettingToggle(
  key: SettingToggleKey,
  value: boolean
): Promise<{ success: boolean }> {
  await wait(120);

  inMemorySettings = inMemorySettings.map((item) =>
    item.settingKey === key ? { ...item, value } : item
  );

  return { success: true };
}

export async function signOut(): Promise<{ success: boolean }> {
  await wait(150);
  return { success: true };
}