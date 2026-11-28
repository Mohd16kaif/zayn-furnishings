export type FeatureName = "newsletter" | "wishlist";

export const FEATURES: Record<FeatureName, boolean> = {
  // Enable only after a real newsletter backend with consent handling exists.
  newsletter: false,
  // Enable only after a real wishlist backend and page exist.
  wishlist: false,
};
