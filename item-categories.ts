export const ITEM_CATEGORIES = ["Other item", "Stallion breeding"] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export function isItemCategory(value: unknown): value is ItemCategory {
  return (
    typeof value === "string" &&
    ITEM_CATEGORIES.some((item) => item === value)
  );
}
