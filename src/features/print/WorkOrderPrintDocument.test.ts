import { describe, expect, it } from 'vitest';
import { createDefaultWorkOrderTemplate, normalizeWorkOrderTemplate } from './WorkOrderPrintDocument';

describe('work order template normalization', () => {
  it('normalizes visible A4 column widths to the printable table width', () => {
    const template = createDefaultWorkOrderTemplate();
    const normalized = normalizeWorkOrderTemplate({
      ...template,
      columns: template.columns.map((column) => ({ ...column, width: 60 })),
    });

    expect(normalized.columns.filter((column) => column.visible).reduce((sum, column) => sum + column.width, 0)).toBeCloseTo(100, 5);
  });

  it('always keeps the required BOM columns visible after normalization', () => {
    const template = createDefaultWorkOrderTemplate();
    const normalized = normalizeWorkOrderTemplate({
      ...template,
      columns: template.columns.map((column) => ({ ...column, visible: false })),
    });

    expect(normalized.columns.filter((column) => column.required).every((column) => column.visible)).toBe(true);
  });
});
