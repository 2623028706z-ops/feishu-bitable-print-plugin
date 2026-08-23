import { describe, expect, it } from 'vitest';
import { aggregateOrders, defaultLabelConfig, expandLabelCopies, sampleOrders } from './print-model';

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
});
