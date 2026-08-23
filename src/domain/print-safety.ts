export const MIN_FIXED_COPIES = 1;
export const MAX_FIXED_COPIES = 500;
export const MAX_TOTAL_PRINT_ITEMS = 5000;
export const MAX_PREVIEW_ITEMS = 100;

export function clampFixedCopies(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return MIN_FIXED_COPIES;
  return Math.min(MAX_FIXED_COPIES, Math.max(MIN_FIXED_COPIES, Math.round(parsed)));
}

export function validatePrintTotal(total: unknown):
  | { valid: true; total: number }
  | { valid: false; total: number; reason: 'total-exceeds-limit' } {
  const parsed = Number(total);
  const normalized = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  if (normalized > MAX_TOTAL_PRINT_ITEMS) return { valid: false, total: normalized, reason: 'total-exceeds-limit' };
  return { valid: true, total: normalized };
}

export function limitPreviewItems<T>(items: T[]): { items: T[]; total: number; truncated: boolean } {
  const total = items.length;
  return { items: items.slice(0, MAX_PREVIEW_ITEMS), total, truncated: total > MAX_PREVIEW_ITEMS };
}
