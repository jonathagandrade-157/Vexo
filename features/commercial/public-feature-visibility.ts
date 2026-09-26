export const PUBLIC_FEATURE_KEYS = new Set([
  "storefront",
  "products",
  "categories",
  "orders",
  "inventory",
  "variants",
  "shipping",
  "shipping_real",
  "payment_mercadopago",
  "basic_customization",
  "advanced_customization",
  "themes",
  "multiple_images",
]);

export interface PublicFeatureCandidate {
  key: string;
  name: string;
}

export function visiblePublicFeatureNames(features: PublicFeatureCandidate[]): string[] {
  return features.filter((feature) => PUBLIC_FEATURE_KEYS.has(feature.key)).map((feature) => feature.name);
}
