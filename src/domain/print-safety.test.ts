import { describe, expect, it } from 'vitest';
import {
  MAX_PREVIEW_ITEMS,
  MAX_TOTAL_PRINT_ITEMS,
  clampFixedCopies,
  limitPreviewItems,
  validatePrintTotal,
} from './print-safety';

describe('print safety domain', () => {
  it('clamps fixed label copies to the supported 1-500 range', () => {
    expect(clampFixedCopies(0)).toBe(1);
    expect(clampFixedCopies(3.6)).toBe(4);
    expect(clampFixedCopies(500)).toBe(500);
    expect(clampFixedCopies(10000)).toBe(500);
    expect(clampFixedCopies('bad')).toBe(1);
  });

  it('rejects totals above 5000 before rendering or printing', () => {
    expect(validatePrintTotal(MAX_TOTAL_PRINT_ITEMS)).toEqual({ valid: true, total: MAX_TOTAL_PRINT_ITEMS });
    expect(validatePrintTotal(MAX_TOTAL_PRINT_ITEMS + 1)).toEqual({
      valid: false,
      total: MAX_TOTAL_PRINT_ITEMS + 1,
      reason: 'total-exceeds-limit',
    });
  });

  it('limits screen previews to 100 items and reports truncation', () => {
    const result = limitPreviewItems(Array.from({ length: 150 }, (_, index) => index));
    expect(result.items).toHaveLength(MAX_PREVIEW_ITEMS);
    expect(result.total).toBe(150);
    expect(result.truncated).toBe(true);
    expect(limitPreviewItems([1, 2])).toEqual({ items: [1, 2], total: 2, truncated: false });
  });
});
