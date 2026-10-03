export const FEATURE_FLAGS = {
  premiumBanner: false,
  qualityOptions: false,
  vipUpsell: false,
} as const;

export function isFeatureEnabled(flag: keyof typeof FEATURE_FLAGS) {
  return FEATURE_FLAGS[flag];
}
