import { describe, expect, it } from 'vitest';
import { aggregateOrders, applyQuantityFilter, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, sampleOrders } from './print-model';

describe('print model', () => {
  it('expands label copies from sales quantity only when enabled', () => {
    expect(expandLabelCopies(sampleOrders, defaultLabelConfig)).toHaveLength(2);
    expect(expandLabelCopies(sampleOrders, { ...defaultLabelConfig, copiesByQuantity: true })).toHaveLength(20);
  });

  it('aggregates matching products and recalculates recipe totals', () => {
    const duplicate = { ...sampleOrders[0], recordId: 'sample-copy', quantity: 3, recipe: sampleOrders[0].recipe.map((line) => ({ ...line, totalStems: line.stemsPerBunch * 3 })) };
    const grouped = aggregateOrders([sampleOrders[0], duplicate]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].quantity).toBe(15);
    expect(grouped[0].recipe[0].totalStems).toBe(90);
  });

  it('filters by customer, product, and T plus n date', () => {
    const orders = [...sampleOrders, { ...sampleOrders[0], recordId: 'sample-3', customer: '花众', productName: '另一款花束', shipDate: '2026/08/25' }];
    expect(filterOrders(orders, { ...defaultPrintFilter, customers: ['天虹'] })).toHaveLength(2);
    expect(filterOrders(orders, { ...defaultPrintFilter, categories: ['鲜花花束'] })).toHaveLength(3);
    expect(filterOrders(orders, { ...defaultPrintFilter, products: ['另一款花束'] })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultPrintFilter, dateMode: 'offset', baseDate: '2026-08-23', offsetDays: 2 })).toHaveLength(1);
  });

  it('applies a custom label quantity without mutating source orders', () => {
    const result = applyQuantityFilter(sampleOrders, { ...defaultPrintFilter, quantityMode: 'custom', customQuantity: 3 });
    expect(result.map((order) => order.quantity)).toEqual([3, 3]);
    expect(sampleOrders[0].quantity).toBe(12);
    expect(applyQuantityFilter(sampleOrders, { ...defaultPrintFilter, quantityMode: 'custom', customQuantity: 0 })[0].quantity).toBe(0);
  });
});
