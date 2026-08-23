import { describe, expect, it } from 'vitest';
import { adjustPrintDate, aggregateOrders, applyQuantityFilter, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, formatSelectedDateRange, groupOrdersForWorkOrders, sampleOrders, splitCategoryValues } from './print-model';

describe('print model', () => {
  it('adjusts only the label date with T plus n', () => {
    expect(adjustPrintDate('2026/08/23', 2)).toBe('2026/08/25');
    expect(adjustPrintDate('2026/08/23', -1)).toBe('2026/08/22');
  });
  it('formats an explicit date context without ambiguous multiple-date text', () => {
    expect(formatSelectedDateRange({ ...defaultPrintFilter, dateMode: 'exact', exactDate: '2026-08-23' })).toBe('2026/08/23');
    expect(formatSelectedDateRange({ ...defaultPrintFilter, dateMode: 'range', startDate: '2026-08-23', endDate: '2026-08-25' })).toBe('2026/08/23 至 2026/08/25');
    expect(formatSelectedDateRange({ ...defaultPrintFilter, dateMode: 'all' }, sampleOrders)).toBe('2026/08/24');
    expect(formatSelectedDateRange({ ...defaultPrintFilter, dateMode: 'all' }, [...sampleOrders, { ...sampleOrders[0], shipDate: '2026/08/26' }])).toBe('2026/08/24 至 2026/08/26');
  });
  it('expands label copies from sales quantity only when enabled', () => {
    expect(expandLabelCopies(sampleOrders, defaultLabelConfig)).toHaveLength(2);
    expect(expandLabelCopies(sampleOrders, { ...defaultLabelConfig, copiesByQuantity: true })).toHaveLength(20);
    expect(expandLabelCopies([sampleOrders[0]], defaultLabelConfig, 5000)).toHaveLength(5000);
  });

  it('aggregates matching products and recalculates recipe totals', () => {
    const duplicate = { ...sampleOrders[0], recordId: 'sample-copy', quantity: 3, recipe: sampleOrders[0].recipe.map((line) => ({ ...line, totalStems: line.stemsPerBunch * 3 })) };
    const grouped = aggregateOrders([sampleOrders[0], duplicate]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].quantity).toBe(15);
    expect(grouped[0].recipe[0].totalStems).toBe(90);
  });
  it('keeps work orders separate by customer and ship date', () => {
    const sameProduct = sampleOrders[0];
    const groups = groupOrdersForWorkOrders([sameProduct, { ...sameProduct, recordId: 'other-customer', customer: '花众' }, { ...sameProduct, recordId: 'other-date', shipDate: '2026/08/25' }]);
    expect(groups).toHaveLength(3);
    expect(groups.every((group) => group.length === 1)).toBe(true);
  });

  it('filters by customer, product, and T plus n date', () => {
    const orders = [...sampleOrders, { ...sampleOrders[0], recordId: 'sample-3', customer: '花众', productName: '另一款花束', shipDate: '2026/08/25' }];
    expect(filterOrders(orders, { ...defaultPrintFilter, customers: ['天虹'] })).toHaveLength(2);
    expect(filterOrders(orders, { ...defaultPrintFilter, categories: ['鲜花花束'] })).toHaveLength(3);
    expect(filterOrders(orders, { ...defaultPrintFilter, products: ['另一款花束'] })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultPrintFilter, dateMode: 'offset', baseDate: '2026-08-23', offsetDays: 2 })).toHaveLength(1);
    expect(filterOrders([{ ...sampleOrders[0], category: '鲜花、礼盒' }], { ...defaultPrintFilter, categories: ['礼盒'] })).toHaveLength(1);
    expect(filterOrders([{ ...sampleOrders[0], category: '鲜花；\n礼盒' }], { ...defaultPrintFilter, categories: ['礼盒'] })).toHaveLength(1);
    expect(filterOrders([{ ...sampleOrders[0], category: ' 鲜花花束 ' }], { ...defaultPrintFilter, categories: ['鲜花花束'] })).toHaveLength(1);
  });

  it('normalizes common category separators and full-width characters', () => {
    expect(splitCategoryValues('鲜花； 礼盒|永生花\n干花')).toEqual(['鲜花', '礼盒', '永生花', '干花']);
    expect(splitCategoryValues('　鲜花花束　')).toEqual(['鲜花花束']);
  });

  it('applies a custom label quantity without mutating source orders', () => {
    const result = applyQuantityFilter(sampleOrders, { ...defaultPrintFilter, quantityMode: 'custom', customQuantity: 3 });
    expect(result.map((order) => order.quantity)).toEqual([3, 3]);
    expect(sampleOrders[0].quantity).toBe(12);
    expect(applyQuantityFilter(sampleOrders, { ...defaultPrintFilter, quantityMode: 'custom', customQuantity: 0 })[0].quantity).toBe(0);
  });
});
