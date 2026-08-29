import { describe, expect, it } from 'vitest';
import type { PrintOrder, RecipeLine } from '../../lib/print-model';
import { flattenWorkOrderGroups, paginateWorkOrderRows } from './work-order-pagination';

function order(recordId: string, recipeCount = 1): PrintOrder {
  const recipe: RecipeLine[] = Array.from({ length: recipeCount }, (_, index) => ({
    material: `${recordId}-material-${index}`,
    stemsPerBunch: 1,
    unit: '支',
    totalStems: 1,
    note: '',
  }));
  return {
    recordId,
    orderNo: recordId,
    shipDate: '2026/08/29',
    customer: '客户',
    category: '花束',
    careInstructions: '',
    productName: recordId,
    productCode: recordId,
    quantity: 1,
    note: '',
    recipe,
    issues: [],
  };
}

describe('work order pagination model', () => {
  it('flattens one row per recipe line and keeps bouquet boundaries', () => {
    const rows = flattenWorkOrderGroups([[order('a', 2), order('b')]]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'a:1', 'b']);
    expect(rows.map((row) => row.bouquetStart)).toEqual([true, false, true]);
  });

  it('keeps exact-fit rows on the current page', () => {
    const pages = paginateWorkOrderRows([[order('a'), order('b')]], {
      pageBodyHeightMm: 60,
      rowHeightMm: () => 30,
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('moves a complete bouquet to a fresh page when the remainder is too small', () => {
    const pages = paginateWorkOrderRows([[order('a'), order('b', 2)]], {
      pageBodyHeightMm: 80,
      rowHeightMm: () => 30,
    });
    expect(pages.map((page) => page.rows.map((row) => row.id))).toEqual([
      ['a'],
      ['b', 'b:1'],
    ]);
  });

  it('splits an oversized bouquet only between recipe rows and marks continuation', () => {
    const pages = paginateWorkOrderRows([[order('long', 3)]], {
      pageBodyHeightMm: 60,
      rowHeightMm: () => 30,
    });
    expect(pages.map((page) => page.rows.map((row) => [row.id, row.continued]))).toEqual([
      [['long', false], ['long:1', false]],
      [['long:2', true]],
    ]);
    expect(pages[1].rows[0].order.productName).toBe('long');
  });

  it('emits an over-height row and preserves the final row exactly once', () => {
    const pages = paginateWorkOrderRows([[order('a'), order('long'), order('last')]], {
      pageBodyHeightMm: 50,
      rowHeightMm: (row) => row.id === 'long' ? 70 : 20,
    });
    const ids = pages.flatMap((page) => page.rows.map((row) => row.id));
    expect(ids).toEqual(['a', 'long', 'last']);
    expect(ids.filter((id) => id === 'last')).toHaveLength(1);
    expect(pages.map((page) => page.total)).toEqual([3, 3, 3]);
  });

  it('returns no pages for empty input and reserves repeated header space', () => {
    expect(paginateWorkOrderRows([], { pageBodyHeightMm: 100 })).toEqual([]);
    const pages = paginateWorkOrderRows([[order('a'), order('b')]], {
      pageBodyHeightMm: 100,
      headerHeightMm: 40,
      tableHeaderHeightMm: 20,
      rowHeightMm: () => 20,
    });
    expect(pages.map((page) => page.rows.map((row) => row.id))).toEqual([['a', 'b']]);
  });
});
