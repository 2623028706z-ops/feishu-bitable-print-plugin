import { describe, expect, it } from 'vitest';
import {
  CURRENT_TEMPLATE_VERSION,
  A4_REQUIRED_COLUMN_IDS,
  createDefaultTemplate,
  migrateTemplateConfig,
  validateA4Columns,
  clampLabelElementToBounds,
} from './templates';

describe('versioned print templates', () => {
  it('creates separate label and A4 defaults', () => {
    const label = createDefaultTemplate('label');
    const a4 = createDefaultTemplate('a4');
    expect(label.type).toBe('label');
    expect(a4.type).toBe('a4');
    expect(label.version).toBe(CURRENT_TEMPLATE_VERSION);
    expect(a4.version).toBe(CURRENT_TEMPLATE_VERSION);
    expect(label).not.toHaveProperty('columns', A4_REQUIRED_COLUMN_IDS);
    expect(a4.columns.map((column) => column.id)).toEqual(A4_REQUIRED_COLUMN_IDS);
  });

  it('clamps every label field rectangle into the paper bounds', () => {
    const template = createDefaultTemplate('label');
    const element = clampLabelElementToBounds(
      { id: 'name', kind: 'name', x: 48, y: 29, width: 20, height: 10, visible: true },
      template,
    );
    expect(element.x + element.width).toBeLessThanOrEqual(template.paper.widthMm);
    expect(element.y + element.height).toBeLessThanOrEqual(template.paper.heightMm);
    expect(element.x).toBeGreaterThanOrEqual(0);
    expect(element.y).toBeGreaterThanOrEqual(0);
    expect(element.width).toBeGreaterThan(0);
    expect(element.height).toBeGreaterThan(0);
  });

  it('validates all required A4 columns and reports missing ids', () => {
    const columns = createDefaultTemplate('a4').columns.filter((column) => column.id !== 'note');
    expect(validateA4Columns(columns)).toEqual({ valid: false, missing: ['note'] });
    expect(validateA4Columns(createDefaultTemplate('a4').columns)).toEqual({ valid: true, missing: [] });
    const hiddenRequired = createDefaultTemplate('a4').columns.map((column) => column.id === 'material' ? { ...column, visible: false } : column);
    expect(validateA4Columns(hiddenRequired)).toEqual({ valid: false, missing: ['material'] });
  });

  it('migrates legacy label config and repairs invalid stored values', () => {
    const migrated = migrateTemplateConfig({
      width: 50,
      height: 30,
      columns: 2,
      rows: 8,
      labelDateOffsetDays: 2,
      fixedCopies: 10000,
      elements: [{ id: 'name', kind: 'name', x: 49, y: 29, width: 99, height: -3 }],
    }, 'label');
    expect(migrated.version).toBe(CURRENT_TEMPLATE_VERSION);
    expect(migrated.type).toBe('label');
    expect(migrated.labelDateOffsetDays).toBe(2);
    expect(migrated.fixedCopies).toBe(5000);
    expect(migrated.elements[0].x + migrated.elements[0].width).toBeLessThanOrEqual(50);
    expect(migrated.elements[0].y + migrated.elements[0].height).toBeLessThanOrEqual(30);
  });

  it('normalizes label paper, grid, and typography values to safe bounds', () => {
    const migrated = migrateTemplateConfig({
      paper: { widthMm: 1, heightMm: 1000 },
      grid: { columns: 99, rows: 0, gapXmm: 99, gapYmm: -1, marginXmm: 88, marginYmm: -2 },
      styles: { fontSize: 999, fontWeight: 9999, lineHeight: 99, padding: 99, contentGap: -3 },
    }, 'label');
    expect(migrated.paper).toEqual({ widthMm: 5, heightMm: 300 });
    expect(migrated.grid).toMatchObject({ columns: 20, rows: 1, gapXmm: 50, gapYmm: 0, marginXmm: 50, marginYmm: 0 });
    expect(migrated.styles).toMatchObject({ fontSize: 20, fontWeight: 900, lineHeight: 2.5, padding: 20, contentGap: 0 });
  });
});
