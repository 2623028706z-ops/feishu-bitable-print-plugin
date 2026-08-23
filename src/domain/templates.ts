export const CURRENT_TEMPLATE_VERSION = 1;

export const A4_REQUIRED_COLUMN_IDS = ['bouquet', 'material', 'bunchQuantity', 'stemsPerBunch', 'totalStems', 'note'] as const;
export type TemplateType = 'label' | 'a4';
export type LabelElementKind = 'name' | 'barcode' | 'code' | 'date' | 'customer' | 'careInstructions' | 'care';
export type TextAlign = 'left' | 'center' | 'right';

export type LabelElement = {
  id: string;
  kind: LabelElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  fontFamily?: string;
  fontSizeMm?: number;
  /** Legacy editor aliases retained while templates migrate to the mm naming. */
  fontSize?: number;
  fontWeight?: number;
  textAlign?: TextAlign;
  align?: TextAlign;
};

export type LabelTemplate = {
  version: number;
  type: 'label';
  id: string;
  name: string;
  isDefault: boolean;
  paper: { widthMm: number; heightMm: number };
  grid: { columns: number; rows: number; gapXmm: number; gapYmm: number; marginXmm: number; marginYmm: number };
  elements: LabelElement[];
  labelDateOffsetDays: number;
  fixedCopies: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  lineHeight: number;
  padding: number;
  contentGap: number;
  copiesByQuantity: boolean;
  showName: boolean;
  showCode: boolean;
  showDate: boolean;
  showCustomer: boolean;
  showCareInstructions: boolean;
  styles: { fontFamily: string; fontSize: number; fontWeight: number; align: TextAlign; lineHeight: number; padding: number; contentGap: number };
  // Legacy flat keys make migration and existing App integration painless.
  width: number; height: number; columns: number; rows: number; gapX: number; gapY: number; marginX: number; marginY: number;
};

export type A4Column = { id: string; label: string; width: number; visible: boolean; align: TextAlign };
export type A4Presentation = {
  kicker: string;
  showCustomer: boolean;
  showShipDate: boolean;
  showOrderCount: boolean;
  footerText: string;
  showPageNumber: boolean;
  titleSizeMm: number;
  metaSizeMm: number;
  customerSizeMm?: number;
  lineHeight: number;
  cellPaddingMm: number;
  headerBackground: string;
};
export type A4Template = {
  version: number; type: 'a4'; id: string; name: string; isDefault: boolean; orientation: 'landscape' | 'portrait';
  margins: { top: number; right: number; bottom: number; left: number };
  title: string; titleVisible: boolean; headerVisible: boolean; footerVisible: boolean; repeatHeader: boolean;
  fontFamily: string; fontSize: number; fontWeight: number; textAlign: TextAlign; rowHeight: number; padding: number;
  borderVisible: boolean; borderWidth: number; borderStyle: 'solid' | 'dashed' | 'dotted'; borderColor: string;
  columns: A4Column[]; presentation?: A4Presentation;
};

export type PrintTemplate = LabelTemplate | A4Template;

const defaultFont = 'Microsoft YaHei, 微软雅黑, sans-serif';

function safeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 160 && !/[{};<>"']/.test(trimmed) ? trimmed : fallback;
}

function labelDefaults(): LabelTemplate {
  const elements: LabelElement[] = [
    { id: 'name', kind: 'name', x: 3, y: 2, width: 44, height: 6, visible: true },
    { id: 'barcode', kind: 'barcode', x: 5, y: 9, width: 40, height: 9, visible: true },
    { id: 'code', kind: 'code', x: 5, y: 18, width: 40, height: 4, visible: true },
    { id: 'date', kind: 'date', x: 3, y: 23, width: 20, height: 4, visible: true },
    { id: 'customer', kind: 'customer', x: 27, y: 23, width: 20, height: 4, visible: true },
    { id: 'careInstructions', kind: 'careInstructions', x: 3, y: 27, width: 44, height: 2, visible: false },
  ];
  return {
    version: CURRENT_TEMPLATE_VERSION, type: 'label', id: 'system-label-default', name: '标准标签', isDefault: true,
    paper: { widthMm: 50, heightMm: 30 }, grid: { columns: 2, rows: 8, gapXmm: 2, gapYmm: 2, marginXmm: 5, marginYmm: 5 }, elements,
    labelDateOffsetDays: 0, fixedCopies: 1, fontFamily: defaultFont, fontSize: 3.2, fontWeight: 600, textAlign: 'center', lineHeight: 1.2, padding: 2.2, contentGap: .5, copiesByQuantity: false,
    showName: true, showCode: true, showDate: true, showCustomer: true, showCareInstructions: false,
    styles: { fontFamily: defaultFont, fontSize: 3.2, fontWeight: 600, align: 'center', lineHeight: 1.2, padding: 2.2, contentGap: .5 },
    width: 50, height: 30, columns: 2, rows: 8, gapX: 2, gapY: 2, marginX: 5, marginY: 5,
  };
}

function a4Defaults(): A4Template {
  const labels: Record<string, string> = { bouquet: '花束', material: '花材', bunchQuantity: '加工扎数', stemsPerBunch: '单束用量', totalStems: '总支数', note: '备注' };
  return {
    version: CURRENT_TEMPLATE_VERSION, type: 'a4', id: 'system-a4-default', name: '标准加工单', isDefault: true, orientation: 'landscape',
    margins: { top: 10, right: 12, bottom: 8, left: 12 }, title: '花束加工单', titleVisible: true, headerVisible: true, footerVisible: true, repeatHeader: true,
    fontFamily: defaultFont, fontSize: 2.8, fontWeight: 400, textAlign: 'left', rowHeight: 10, padding: 2, borderVisible: true, borderWidth: .25, borderStyle: 'solid', borderColor: '#9da9a4',
    presentation: { kicker: '花众生产打印', showCustomer: true, showShipDate: true, showOrderCount: true, footerText: '加工扎数取销售数量（扎），同花束按订单合并。', showPageNumber: true, titleSizeMm: 7, metaSizeMm: 2.5, lineHeight: 1.35, cellPaddingMm: 2, headerBackground: '#e8f3f7' },
    columns: A4_REQUIRED_COLUMN_IDS.map((id, index) => ({ id, label: labels[id], width: [23, 22, 12, 10, 12, 21][index], visible: true, align: index === 0 || index === 1 || index === 5 ? 'left' : 'center' })),
  };
}

export function createDefaultTemplate(type: 'label'): LabelTemplate;
export function createDefaultTemplate(type: 'a4'): A4Template;
export function createDefaultTemplate(type: TemplateType): PrintTemplate;
export function createDefaultTemplate(type: TemplateType): PrintTemplate {
  return type === 'label' ? labelDefaults() : a4Defaults();
}

export function clampLabelElementToBounds(element: LabelElement, template: LabelTemplate): LabelElement {
  const widthMm = Math.max(.5, Math.min(Number(element.width) || .5, template.paper.widthMm));
  const heightMm = Math.max(.5, Math.min(Number(element.height) || .5, template.paper.heightMm));
  const x = Math.max(0, Math.min(Number(element.x) || 0, template.paper.widthMm - widthMm));
  const y = Math.max(0, Math.min(Number(element.y) || 0, template.paper.heightMm - heightMm));
  return { ...element, x, y, width: widthMm, height: heightMm, visible: element.visible !== false };
}

export function validateA4Columns(columns: A4Column[]): { valid: boolean; missing: string[] } {
  const ids = new Set(columns.filter((column) => column.visible !== false).map((column) => column.id));
  const missing = A4_REQUIRED_COLUMN_IDS.filter((id) => !ids.has(id));
  return { valid: missing.length === 0, missing: [...missing] };
}

function numberValue(value: unknown, fallback: number, min = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

export function migrateTemplateConfig(raw: unknown, type: 'label'): LabelTemplate;
export function migrateTemplateConfig(raw: unknown, type: 'a4'): A4Template;
export function migrateTemplateConfig(raw: unknown, type: TemplateType): PrintTemplate;
export function migrateTemplateConfig(raw: unknown, type: TemplateType): PrintTemplate {
  const source = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const base = (type === 'label' ? labelDefaults() : a4Defaults()) as any;
  if (type === 'a4') {
    const presentation = { ...base.presentation, ...(source.presentation || {}) };
    const result = { ...base, ...source, version: CURRENT_TEMPLATE_VERSION, type: 'a4', margins: { ...base.margins, ...(source.margins || {}) }, presentation, columns: Array.isArray(source.columns) ? source.columns : base.columns };
    result.columns = result.columns.map((column: any) => ({ ...column, width: numberValue(column.width, 10, 1), visible: column.visible !== false, align: ['left', 'center', 'right'].includes(column.align) ? column.align : 'left' }));
    if (!validateA4Columns(result.columns).valid) result.columns = base.columns;
    return result;
  }
  const width = Math.min(300, Math.max(5, numberValue(source.paper?.widthMm ?? source.width, base.width, 5)));
  const height = Math.min(300, Math.max(5, numberValue(source.paper?.heightMm ?? source.height, base.height, 5)));
  const styles = { ...base.styles, ...(source.styles || {}) };
  const result: LabelTemplate = { ...base, ...source, version: CURRENT_TEMPLATE_VERSION, type: 'label', paper: { widthMm: width, heightMm: height }, grid: { ...base.grid, ...(source.grid || {}) }, elements: Array.isArray(source.elements) ? source.elements : base.elements, width, height, styles };
  result.columns = Math.min(20, Math.max(1, Math.round(numberValue(source.columns ?? result.grid.columns, base.columns, 1))));
  result.rows = Math.min(20, Math.max(1, Math.round(numberValue(source.rows ?? result.grid.rows, base.rows, 1))));
  result.gapX = Math.min(50, numberValue(source.gapX ?? result.grid.gapXmm, base.gapX)); result.gapY = Math.min(50, numberValue(source.gapY ?? result.grid.gapYmm, base.gapY));
  result.marginX = Math.min(50, numberValue(source.marginX ?? result.grid.marginXmm, base.marginX)); result.marginY = Math.min(50, numberValue(source.marginY ?? result.grid.marginYmm, base.marginY));
  result.grid = { columns: result.columns, rows: result.rows, gapXmm: result.gapX, gapYmm: result.gapY, marginXmm: result.marginX, marginYmm: result.marginY };
  result.fixedCopies = Math.min(5000, Math.max(1, Math.round(numberValue(source.fixedCopies, 1, 1))));
  result.labelDateOffsetDays = Math.min(3650, Math.max(0, Math.round(numberValue(source.labelDateOffsetDays, 0, 0))));
  result.styles = { fontFamily: safeFontFamily(result.styles.fontFamily, base.styles.fontFamily), fontSize: Math.min(20, numberValue(result.styles.fontSize, base.styles.fontSize, 1)), fontWeight: Math.min(900, numberValue(result.styles.fontWeight, base.styles.fontWeight, 100)), align: ['left', 'center', 'right'].includes(result.styles.align) ? result.styles.align : base.styles.align, lineHeight: Math.min(2.5, Math.max(.8, numberValue(result.styles.lineHeight, base.styles.lineHeight, .8))), padding: Math.min(20, numberValue(result.styles.padding, base.styles.padding)), contentGap: Math.min(20, numberValue(result.styles.contentGap, base.styles.contentGap)) };
  result.fontFamily = result.styles.fontFamily; result.fontSize = result.styles.fontSize; result.fontWeight = result.styles.fontWeight; result.textAlign = result.styles.align;
  result.elements = result.elements.map((element: any) => { const align = element.textAlign ?? element.align ?? result.styles.align; return clampLabelElementToBounds({ ...element, kind: element.kind === 'care' ? 'care' : element.kind, width: numberValue(element.width, 1, .5), height: numberValue(element.height, 1, .5), fontFamily: safeFontFamily(element.fontFamily, result.styles.fontFamily), fontSize: numberValue(element.fontSize ?? element.fontSizeMm, result.styles.fontSize, 1), fontSizeMm: numberValue(element.fontSizeMm ?? element.fontSize, result.styles.fontSize, 1), align, textAlign: align }, result); });
  return result;
}
