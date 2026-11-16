import { CATALOG_BY_ID, CatalogProduct } from "../shared/catalog.js";

export class CatalogValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "CatalogValidationError";
    this.statusCode = statusCode;
  }
}

export interface ResolvedOrder {
  productIds: string[];
  items: CatalogProduct[];
  amount: number;
  currency: "usd";
  planName: string;
}

const MAX_ITEMS_PER_ORDER = 5;

/**
 * Resolves and strictly validates product IDs against the server-owned allowlist.
 * Never trusts client-supplied amounts, currencies, or plan names.
 */
export function resolveOrderFromProductIds(rawProductIds: unknown): ResolvedOrder {
  if (!Array.isArray(rawProductIds)) {
    throw new CatalogValidationError("productIds must be an array of product IDs.");
  }

  if (rawProductIds.length === 0) {
    throw new CatalogValidationError("Cart cannot be empty. Select at least one item.");
  }

  if (rawProductIds.length > MAX_ITEMS_PER_ORDER) {
    throw new CatalogValidationError("Too many items in checkout request.");
  }

  const normalizedIds: string[] = [];
  const seen = new Set<string>();
  const items: CatalogProduct[] = [];

  for (const rawId of rawProductIds) {
    if (typeof rawId !== "string" || rawId.trim().length === 0) {
      throw new CatalogValidationError("Each productId must be a non-empty string.");
    }

    const id = rawId.trim();
    if (seen.has(id)) {
      throw new CatalogValidationError(`Duplicate product ID "${id}" is not allowed.`);
    }

    const product = CATALOG_BY_ID[id];
    if (!product) {
      throw new CatalogValidationError(`Unknown product ID "${id}".`);
    }

    seen.add(id);
    normalizedIds.push(id);
    items.push(product);
  }

  const hasPlan = items.some((item) => item.kind === "plan");
  const hasAddon = items.some((item) => item.kind === "addon");
  if (hasPlan && hasAddon) {
    throw new CatalogValidationError(
      'Invalid combination: "The Activation" cannot be combined with On-Demand Growth Menu items.'
    );
  }

  if (hasPlan && items.length > 1) {
    throw new CatalogValidationError("Only one standalone plan can be purchased per checkout.");
  }

  const amount = items.reduce((sum, item) => sum + item.priceCents, 0);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new CatalogValidationError("Calculated order amount is invalid.");
  }

  const planName =
    items[0].kind === "plan" ? items[0].name : "On-Demand Growth Menu";

  return {
    productIds: normalizedIds,
    items,
    amount,
    currency: "usd",
    planName,
  };
}
