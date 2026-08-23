import { bitable } from '@lark-base-open/js-sdk';
import type { IGridView } from '@lark-base-open/js-sdk';
import type { PrintOrder, RecipeLine } from './print-model';

type RawRecord = { recordId?: string; fields?: Record<string, unknown> };

const FIELD_ALIASES = {
  orderNo: ['订单编号'],
  shipDate: ['出货日期'],
  productCode: ['花束编码'],
  customer: ['客户名称', '客户'],
  category: ['品类', '类别', '花束品类'],
  careInstructions: ['养护说明'],
  productName: ['花束名称', '商品名称', '成品名称'],
  quantity: ['销售数量（扎）', '销售数量', '扎数', '数量'],
  note: ['备注'],
  recipeText: ['配方明细'],
  recipeLink: ['配方', '成品配方'],
  material: ['花材名称', '花材'],
  stems: ['花材用量（枝数）', '支数'],
  unit: ['规格', '单位'],
  recipeNote: ['采购备注', '装箱备注'],
} as const;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return text(item.text ?? item.name ?? item.value ?? item.displayValue ?? item.id);
  }
  return '';
}

function number(value: unknown): number {
  const parsed = Number(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function findField(fields: Record<string, unknown>, names: readonly string[], labels: Record<string, string>): unknown {
  for (const name of names) {
    const fieldId = labels[name];
    if (fieldId && fieldId in fields) return fields[fieldId];
    if (name in fields) return fields[name];
  }
  return undefined;
}

function normalizeDate(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const numeric = typeof value === 'number' ? value : Number(raw);
  const date = Number.isFinite(numeric) && numeric > 100000000000 ? new Date(numeric) : new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('zh-CN');
}

function recipeFromRecord(fields: Record<string, unknown>, labels: Record<string, string>, quantity: number): RecipeLine[] {
  const material = text(findField(fields, FIELD_ALIASES.material, labels));
  const stems = number(findField(fields, FIELD_ALIASES.stems, labels));
  const unit = text(findField(fields, FIELD_ALIASES.unit, labels)) || '支';
  const note = text(findField(fields, FIELD_ALIASES.recipeNote, labels));
  if (material || stems) return [{ material: material || '未命名花材', stemsPerBunch: stems, unit, totalStems: stems * quantity, note }];

  const recipeText = text(findField(fields, FIELD_ALIASES.recipeText, labels));
  if (!recipeText) return [];
  return recipeText.split(/\n|；|;/).map((line) => line.trim()).filter(Boolean).map((line) => ({
    material: line,
    stemsPerBunch: 0,
    unit: '支',
    totalStems: 0,
    note: '',
  }));
}

function linkedRecordIds(value: unknown): { tableId: string; recordIds: string[] } | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = linkedRecordIds(item);
      if (nested) return nested;
    }
    return null;
  }
  const link = value as Record<string, unknown>;
  const tableId = text(link.tableId ?? link.table_id);
  const rawRecordIds = link.recordIds ?? link.record_ids;
  const recordIds = Array.isArray(rawRecordIds) ? rawRecordIds.map(text).filter(Boolean) : [];
  return tableId && recordIds.length ? { tableId, recordIds } : null;
}

async function recipeFromProductTable(productName: string, quantity: number): Promise<RecipeLine[]> {
  if (!productName) return [];
  try {
    const productTable = await bitable.base.getTableByName('成品汇总表');
    const productMeta = await productTable.getFieldMetaList();
    const productLabels = Object.fromEntries(productMeta.map((meta) => [meta.name, meta.id]));
    const productNameField = productLabels['花束名称'] ?? productLabels['成品名称'] ?? productLabels['商品名称'];
    const recipeField = productLabels['配方'] ?? productLabels['成品配方'];
    if (!productNameField || !recipeField) return [];
    const response = await productTable.getRecordsByPage({ pageSize: 200, stringValue: false });
    const productRecords = response.records.filter((record) => text(record.fields[productNameField]).trim() === productName.trim());
    const grouped = new Map<string, RecipeLine>();
    for (const productRecord of productRecords) {
      const recipeLink = linkedRecordIds(productRecord.fields[recipeField]);
      if (!recipeLink) continue;
      const recipeTable = await bitable.base.getTableById(recipeLink.tableId);
      const recipeRecords = await recipeTable.getRecordsByIds(recipeLink.recordIds, true);
      const recipeMeta = await recipeTable.getFieldMetaList();
      const recipeLabels = Object.fromEntries(recipeMeta.map((meta) => [meta.name, meta.id]));
      for (const recipeRecord of recipeRecords) {
        const material = text(findField(recipeRecord.fields, FIELD_ALIASES.material, recipeLabels)) || '未命名花材';
        const stemsPerBunch = number(findField(recipeRecord.fields, FIELD_ALIASES.stems, recipeLabels));
        const unit = text(findField(recipeRecord.fields, FIELD_ALIASES.unit, recipeLabels)) || '支';
        const note = text(findField(recipeRecord.fields, FIELD_ALIASES.recipeNote, recipeLabels));
        const current = grouped.get(material);
        if (current) current.totalStems += stemsPerBunch * quantity;
        else grouped.set(material, { material, stemsPerBunch, unit, totalStems: stemsPerBunch * quantity, note });
      }
    }
    return [...grouped.values()];
  } catch {
    return [];
  }
}

async function linkedRecipe(fields: Record<string, unknown>, labels: Record<string, string>, quantity: number): Promise<RecipeLine[]> {
  const productName = text(findField(fields, FIELD_ALIASES.productName, labels));
  const productLink = linkedRecordIds(findField(fields, FIELD_ALIASES.productName, labels));
  if (!productLink) {
    const fallbackRecipe = await recipeFromProductTable(productName, quantity);
    return fallbackRecipe.length ? fallbackRecipe : recipeFromRecord(fields, labels, quantity);
  }
  try {
    const productTable = await bitable.base.getTableById(productLink.tableId);
    const productRecords = await productTable.getRecordsByIds(productLink.recordIds, true);
    const productMeta = await productTable.getFieldMetaList();
    const productLabels = Object.fromEntries(productMeta.map((meta) => [meta.name, meta.id]));
    const recipeLinks = productRecords.flatMap((record) => {
      const recipeField = productLabels['配方'] ?? productLabels['成品配方'];
      return recipeField ? [linkedRecordIds(record.fields[recipeField])].filter(Boolean) as Array<{ tableId: string; recordIds: string[] }> : [];
    });
    const grouped = new Map<string, RecipeLine>();
    for (const link of recipeLinks) {
      const recipeTable = await bitable.base.getTableById(link.tableId);
      const recipeRecords = await recipeTable.getRecordsByIds(link.recordIds, true);
      const recipeMeta = await recipeTable.getFieldMetaList();
      const recipeLabels = Object.fromEntries(recipeMeta.map((meta) => [meta.name, meta.id]));
      for (const recipeRecord of recipeRecords) {
        const material = text(findField(recipeRecord.fields, FIELD_ALIASES.material, recipeLabels)) || '未命名花材';
        const stemsPerBunch = number(findField(recipeRecord.fields, FIELD_ALIASES.stems, recipeLabels));
        const unit = text(findField(recipeRecord.fields, FIELD_ALIASES.unit, recipeLabels)) || '支';
        const note = text(findField(recipeRecord.fields, FIELD_ALIASES.recipeNote, recipeLabels));
        const current = grouped.get(material);
        if (current) current.totalStems += stemsPerBunch * quantity;
        else grouped.set(material, { material, stemsPerBunch, unit, totalStems: stemsPerBunch * quantity, note });
      }
    }
    return [...grouped.values()];
  } catch {
    return recipeFromRecord(fields, labels, quantity);
  }
}

async function normalizeRecord(record: RawRecord, labels: Record<string, string>): Promise<PrintOrder> {
  const fields = record.fields ?? {};
  const quantity = number(findField(fields, FIELD_ALIASES.quantity, labels));
  const productCode = text(findField(fields, FIELD_ALIASES.productCode, labels));
  const recipe = await linkedRecipe(fields, labels, quantity);
  const issues = [] as PrintOrder['issues'];
  if (!productCode) issues.push('missing-code');
  if (quantity <= 0) issues.push('missing-quantity');
  if (!recipe.length) issues.push('missing-recipe');
  return {
    recordId: record.recordId ?? crypto.randomUUID(),
    orderNo: text(findField(fields, FIELD_ALIASES.orderNo, labels)),
    shipDate: normalizeDate(findField(fields, FIELD_ALIASES.shipDate, labels)),
    customer: text(findField(fields, FIELD_ALIASES.customer, labels)),
    category: text(findField(fields, FIELD_ALIASES.category, labels)),
    careInstructions: text(findField(fields, FIELD_ALIASES.careInstructions, labels)),
    productName: text(findField(fields, FIELD_ALIASES.productName, labels)) || '未命名花束',
    productCode,
    quantity,
    note: text(findField(fields, FIELD_ALIASES.note, labels)),
    recipe,
    issues,
  };
}

async function fieldLabels(table: Awaited<ReturnType<typeof bitable.base.getActiveTable>>): Promise<Record<string, string>> {
  const metas = await table.getFieldMetaList();
  return Object.fromEntries(metas.map((meta) => [meta.name, meta.id]));
}

export async function loadFeishuOrders(): Promise<{ orders: PrintOrder[]; source: string; tableName: string }> {
  const table = await bitable.base.getActiveTable();
  const labels = await fieldLabels(table);
  const selection = await bitable.base.getSelection();
  const activeName = await table.getName();

  const view = selection.viewId ? await table.getViewById(selection.viewId) : await table.getActiveView();
  const selectedIds = await (view as IGridView).getSelectedRecordIdList().catch(() => [] as string[]);
  if (selection.tableId === table.id && selectedIds.length) {
    const records = await table.getRecordsByIds(selectedIds, true);
    return { orders: await Promise.all(records.map((record, index) => normalizeRecord({ ...record, recordId: selectedIds[index] }, labels))), source: `已选 ${selectedIds.length} 条记录`, tableName: activeName };
  }
  if (selection.tableId === table.id && selection.recordId) {
    const record = await table.getRecordById(selection.recordId, true);
    return { orders: [await normalizeRecord({ ...record, recordId: selection.recordId }, labels)], source: '当前选中记录', tableName: activeName };
  }

  // Keep structured link values (tableId/recordIds) so product recipes can be expanded.
  const response = await table.getRecordsByPage({ pageSize: 200, viewId: view.id, stringValue: false });
  return {
    orders: await Promise.all(response.records.map((record) => normalizeRecord(record, labels))),
    source: `当前视图 · ${await view.getName()}`,
    tableName: activeName,
  };
}
