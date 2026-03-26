import {
  getSettings,
  updateSettingToggle,
  signOut,
} from "../api/setting";

export const settingService = {
  getSettings,
  updateToggle: updateSettingToggle,
  signOut,
};