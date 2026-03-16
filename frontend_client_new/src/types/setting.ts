export type SettingToggleKey = "darkMode" | "biometricLock";

export type SettingRowType = "toggle" | "link" | "danger";

export type SettingRow = {
  id: string;
  section: "appearance" | "security" | "support" | "account";
  type: SettingRowType;
  title: string;
  subtitle?: string;
  icon:
    | "moon"
    | "lock"
    | "fingerprint"
    | "shield"
    | "help"
    | "document"
    | "info"
    | "logout";
  value?: boolean;
  settingKey?: SettingToggleKey;
  route?: string;
};