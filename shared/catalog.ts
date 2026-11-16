export type ProductKind = "plan" | "addon";

export interface CatalogProduct {
  id: string;
  name: string;
  priceCents: number;
  currency: "usd";
  kind: ProductKind;
  parentPlanId?: "tier1";
  description?: string;
}

export const ACTIVATION_PRODUCT: CatalogProduct = {
  id: "activation",
  name: "The Activation",
  priceCents: 19900,
  currency: "usd",
  kind: "plan",
  description:
    '"We get your digital foundation poured so Google actually knows you exist in San Tan Valley."',
};

export const ON_DEMAND_ADDONS: CatalogProduct[] = [
  {
    id: "gap-report",
    name: 'The "Competition Gap" Report',
    priceCents: 4900,
    currency: "usd",
    kind: "addon",
    parentPlanId: "tier1",
    description:
      "A deep-dive audit showing exactly why your #1 local competitor is beating you and how to take their spot.",
  },
  {
    id: "review-pack",
    name: 'The "Review Response" Pack',
    priceCents: 2900,
    currency: "usd",
    kind: "addon",
    parentPlanId: "tier1",
    description:
      "Professional, SEO-optimized responses for your 5 most recent reviews to help you climb the Google Map Pack.",
  },
  {
    id: "local-pulse",
    name: 'The "Local Pulse" Post',
    priceCents: 2900,
    currency: "usd",
    kind: "addon",
    parentPlanId: "tier1",
    description:
      "One custom Google Business update (e.g., Monsoon Prep, Local Project Showcase) to keep your profile active.",
  },
  {
    id: "site-refresh",
    name: 'The "Site Refresh"',
    priceCents: 3900,
    currency: "usd",
    kind: "addon",
    parentPlanId: "tier1",
    description:
      'A quick update to your landing page—adding new "Before & After" photos or updating your service list.',
  },
];

export const ALL_CATALOG_PRODUCTS: CatalogProduct[] = [
  ACTIVATION_PRODUCT,
  ...ON_DEMAND_ADDONS,
];

export const CATALOG_BY_ID: Record<string, CatalogProduct> = Object.fromEntries(
  ALL_CATALOG_PRODUCTS.map((product) => [product.id, product])
);
