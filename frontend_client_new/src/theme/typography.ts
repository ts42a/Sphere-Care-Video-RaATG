import { colors } from "./colors";

export const typography = {
  pageTitle: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    color: colors.textPrimary,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    color: colors.textSecondary,
  },
  body: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  subText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  button: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: colors.surface,
  },
};