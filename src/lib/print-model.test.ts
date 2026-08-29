import { describe, expect, it } from 'vitest';
import { adjustPrintDate, aggregateOrders, applyQuantityFilter, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, formatSelectedDateRange, groupOrdersForWorkOrders, labelPrintLayout, labelPrintPageMetrics, labelPrintPageStyle, sampleOrders, splitCategoryValues } from './print-model';

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

  it('keeps physical label pages at the configured size regardless of legacy grid values', () => {
    expect(labelPrintPageMetrics({ width: 70, height: 40 })).toEqual({
      widthMm: 70,
      heightMm: 40,
      orientation: 'landscape',
      columns: 1,
      rows: 1,
      gapXmm: 0,
      gapYmm: 0,
      marginXmm: 0,
      marginYmm: 0,
    });
    expect(labelPrintPageMetrics({ width: 40, height: 70 }).orientation).toBe('portrait');
    const pageStyle = labelPrintPageStyle({ width: 70, height: 40 });
    expect(pageStyle).toContain('@page { size: 70mm 40mm; margin: 0; }');
    expect(pageStyle).toContain('@page label-sheet-page { size: 70mm 40mm; margin: 0; }');
    expect(pageStyle).toContain('width: 70mm !important; height: 40mm !important;');
    expect(pageStyle).toContain('min-width: 0 !important; min-height: 0 !important;');
    expect(pageStyle).toContain('.label-sheet { width: 70mm !important; min-width: 70mm !important; max-width: 70mm !important; height: 40mm !important; min-height: 40mm !important; max-height: 40mm !important; box-sizing: border-box !important; }');
  });

  it('rotates the whole card and swaps page size so content fills after printer rotation', () => {
    // card 恒为设计尺寸 50×30 铺满内容；90°/270° 时页面(@page)交换成竖版 30×50，
    // 整张 card 旋转后填满交换后的页面，打印机再转回来 = 50×30 横排铺满
    const base = { width: 50, height: 30 };
    expect(labelPrintLayout({ ...base, printRotation: 0 })).toMatchObject({ pageW: 50, pageH: 30, cardW: 50, cardH: 30, transform: 'none' });
    expect(labelPrintLayout({ ...base, printRotation: 180 })).toMatchObject({ pageW: 50, pageH: 30, cardW: 50, cardH: 30, transform: 'translate(50mm, 30mm) rotate(180deg)' });
    expect(labelPrintLayout({ ...base, printRotation: 90 })).toMatchObject({ pageW: 30, pageH: 50, cardW: 50, cardH: 30, transform: 'translateX(30mm) rotate(90deg)' });
    expect(labelPrintLayout({ ...base, printRotation: 270 })).toMatchObject({ pageW: 30, pageH: 50, cardW: 50, cardH: 30, transform: 'translateY(50mm) rotate(270deg)' });
  });

  it('swaps @page size to portrait for 90/270 so the printer receives the rotated page', () => {
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 0 })).toContain('@page { size: 50mm 30mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 0 })).toContain('@page label-sheet-page { size: 50mm 30mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 90 })).toContain('@page { size: 30mm 50mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 90 })).toContain('@page label-sheet-page { size: 30mm 50mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 270 })).toContain('@page { size: 30mm 50mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 270 })).toContain('@page label-sheet-page { size: 30mm 50mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 180 })).toContain('@page { size: 50mm 30mm; margin: 0; }');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 180 })).toContain('@page label-sheet-page { size: 50mm 30mm; margin: 0; }');
  });

  it('emits a concrete card size for each rotation so print iframes do not depend on CSS variables', () => {
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 90 })).toContain('.label-card { width: 50mm !important; height: 30mm !important;');
    expect(labelPrintPageStyle({ width: 50, height: 30, printRotation: 270 })).toContain('.label-card { width: 50mm !important; height: 30mm !important;');
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
