import { bitable } from '@lark-base-open/js-sdk';
import type { IGridView } from '@lark-base-open/js-sdk';
import type { PrintOrder, RecipeLine } from './print-model';

type RawRecord = { recordId?: string; fields?: Record<string, unknown> };
type RawFieldMeta = {
  id: string;
  name: string;
  property?: unknown;
};
type LinkedRecordGroup = { tableId: string; recordIds: string[] };

const FIELD_ALIASES = {
  orderNo: ['订单编号'],
  shipDate: ['出货日期'],
  productCode: ['成品编码', '花束编码', '花束编码数值', '编码数值', '花束编码（数值）', '成品编码数值', '商品编码', '产品编码'],
  customer: ['客户名称', '客户'],
  category: ['品类', '类别', '花束品类', '品类名称', '商品品类', '花束类别', '商品分类', '花束分类', '产品分类', '产品品类', '分类'],
  careInstructions: ['养护说明'],
  productName: ['花束名称', '商品名称', '成品名称'],
  quantity: ['销售数量（扎）', '销售数量', '扎数', '数量'],
  note: ['备注'],
  recipeText: ['配方明细'],
  recipeLink: ['配方', '成品配方'],
  material: ['配方花材名称', '花材名称', '花材'],
  stems: ['花材用量（枝数）', '支数'],
  unit: ['规格', '单位'],
  recipeNote: ['采购备注', '装箱备注'],
} as const;

const PRODUCT_TABLE_NAMES = ['成品汇总表', '成品配方表', '成品配方', '成品库', '产品库'] as const;
const PRODUCT_CODE_ALIASES = ['花束编码', '花束编码数值', '编码数值', '成品编码', '商品编码', '产品编码'] as const;

export function text(value: unknown, depth = 0): string {
  if (depth > 6) return '';
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map((item) => text(item, depth + 1)).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    // Single-select, multi-select, lookup and formula wrappers use different
    // display keys depending on the host/API version. Prefer the first value
    // that resolves to visible text; an empty `text` must not hide `value`.
    for (const key of ['text', 'name', 'label', 'title', 'value', 'option', 'displayValue', 'display_name', 'displayName', 'id']) {
      const candidate = text(item[key], depth + 1);
      if (candidate) return candidate;
    }
  }
  return '';
}

function normalizedFieldName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').trim().toLocaleLowerCase();
}

function comparableFieldName(value: string): string {
  return normalizedFieldName(value).replace(/[（(].*?[）)]/g, '');
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
  const normalizedLabels = Object.entries(labels);
  for (const name of names) {
    const target = normalizedFieldName(name);
    const match = normalizedLabels.find(([label]) => normalizedFieldName(label) === target);
    if (match && match[1] in fields) return fields[match[1]];
  }
  for (const name of names) {
    const target = comparableFieldName(name);
    const match = normalizedLabels.find(([label]) => comparableFieldName(label) === target);
    if (match && match[1] in fields) return fields[match[1]];
  }
  // Bases often append a type marker to business fields, for example
  // "品类（查找）" or "商品品类字段". If the exact/parenthesis-insensitive
  // match above misses, accept a unique contains match for the semantic
  // aliases so the field remains usable across renamed columns.
  for (const name of names) {
    const target = comparableFieldName(name);
    if (target.length < 2) continue;
    const matches = normalizedLabels.filter(([label, id]) => {
      const comparable = comparableFieldName(label);
      return id in fields && (comparable.includes(target) || target.includes(comparable));
    });
    if (matches.length === 1) return fields[matches[0][1]];
  }
  return undefined;
}

function normalizeCategory(value: unknown): string {
  return text(value)
    .split(/[、,，;/；|｜\n\r\t]+/)
    .map((item) => item.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('、');
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

function fieldTargetTableIds(metas: readonly RawFieldMeta[]): Record<string, string> {
  return Object.fromEntries(
    metas
      .map((meta) => {
        const property = meta.property && typeof meta.property === 'object' ? (meta.property as Record<string, unknown>) : {};
        return [meta.id, text(property.tableId ?? property.table_id)] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

function resolveFieldId(labels: Record<string, string>, names: readonly string[]): string | undefined {
  for (const name of names) {
    if (labels[name]) return labels[name];
  }

  const entries = Object.entries(labels);
  for (const name of names) {
    const target = normalizedFieldName(name);
    const match = entries.find(([label]) => normalizedFieldName(label) === target);
    if (match) return match[1];
  }

  for (const name of names) {
    const target = comparableFieldName(name);
    const match = entries.find(([label]) => comparableFieldName(label) === target);
    if (match) return match[1];
  }

  // Field names in production bases often carry a unique suffix such as
  // "（关联）" or "数值". Accept that suffix only when the match is
  // unambiguous, so two similarly named fields cannot be selected randomly.
  for (const name of names) {
    const target = comparableFieldName(name);
    if (target.length < 2) continue;
    const matches = entries.filter(([label]) => {
      const comparable = comparableFieldName(label);
      return comparable.includes(target) || target.includes(comparable);
    });
    if (matches.length === 1) return matches[0][1];
  }
  return undefined;
}

function fieldId(labels: Record<string, string>, names: readonly string[]): string | undefined {
  return resolveFieldId(labels, names);
}

function recordId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  return text(item.recordId ?? item.record_id ?? item.id);
}

function fallbackRecordId(): string {
  const cryptoApi = globalThis.crypto as Crypto & { randomUUID?: () => string } | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * SDK normally returns one IOpenLink object. Older hosts and lookup/formula
 * wrappers can return nested values, so keep parsing independent of the
 * concrete wrapper while using field metadata as the table-id fallback.
 */
export function extractLinkedRecordGroups(value: unknown, fallbackTableId = ''): LinkedRecordGroup[] {
  const grouped = new Map<string, Set<string>>();

  const add = (tableId: string, recordIds: string[]) => {
    if (!tableId || !recordIds.length) return;
    const ids = grouped.get(tableId) ?? new Set<string>();
    recordIds.forEach((id) => id && ids.add(id));
    grouped.set(tableId, ids);
  };

  const visit = (candidate: unknown, inheritedTableId: string): void => {
    if (!candidate || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      const scalarIds = candidate.map(recordId).filter(Boolean);
      if (inheritedTableId && scalarIds.length) add(inheritedTableId, scalarIds);
      candidate.forEach((item) => visit(item, inheritedTableId));
      return;
    }

    const item = candidate as Record<string, unknown>;
    const tableId =
      text(item.tableId ?? item.table_id ?? item.targetTableId ?? item.target_table_id) || inheritedTableId;
    const rawRecordIds = item.recordIds ?? item.record_ids;
    if (Array.isArray(rawRecordIds)) {
      add(tableId, rawRecordIds.map(recordId).filter(Boolean));
    }
    const directId = recordId(item);
    if (directId) add(tableId, [directId]);

    for (const key of ['value', 'link', 'data', 'items', 'records']) {
      if (key in item) visit(item[key], tableId);
    }
  };

  visit(value, fallbackTableId);
  return [...grouped.entries()].map(([tableId, recordIds]) => ({ tableId, recordIds: [...recordIds] }));
}

type PageResult = {
  records?: RawRecord[];
  hasMore?: boolean;
  pageToken?: unknown;
};

type PagedRecordTable = {
  getRecordsByPage: (options: Record<string, unknown>) => Promise<PageResult>;
};

/** Read every page while guarding against a broken host repeating its token. */
async function allRecordsByPage(table: PagedRecordTable, options: Record<string, unknown>): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  const seenTokens = new Set<string>();
  let pageToken: unknown;

  for (;;) {
    const response = await table.getRecordsByPage({
      ...options,
      pageSize: options.pageSize ?? 200,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    records.push(...(response.records ?? []));
    if (!response.hasMore) break;
    if (response.pageToken === undefined || response.pageToken === null) throw new Error('飞书分页响应缺少 pageToken');

    const tokenKey = String(response.pageToken);
    if (seenTokens.has(tokenKey)) throw new Error('飞书分页响应返回重复 pageToken');
    seenTokens.add(tokenKey);
    pageToken = response.pageToken;
  }
  return records;
}

const MAX_RECORD_IDS_PER_REQUEST = 1000;

type RecordByIdTable = {
  getRecordsByIds: (recordIds: string[], refreshLinkValue?: boolean) => Promise<RawRecord[]>;
};

/** The SDK caps getRecordsByIds at 1000 ids; preserve requested order across chunks. */
async function recordsByIds(table: RecordByIdTable, recordIds: string[], refreshLinkValue = true): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  for (let start = 0; start < recordIds.length; start += MAX_RECORD_IDS_PER_REQUEST) {
    const chunk = recordIds.slice(start, start + MAX_RECORD_IDS_PER_REQUEST);
    const chunkRecords = await table.getRecordsByIds(chunk, refreshLinkValue);
    if (chunkRecords.length === chunk.length) {
      chunkRecords.forEach((record, index) => {
        if (!record.recordId) record.recordId = chunk[index];
      });
    }
    records.push(...chunkRecords);
  }

  const byId = new Map(records.map((record) => [record.recordId, record]));
  if (recordIds.every((id) => byId.has(id))) return recordIds.map((id) => byId.get(id)!);
  return records;
}

const recipeLinkCache = new Map<string, Promise<RecipeLine[]>>();

async function loadRecipeLinesFromLinks(links: LinkedRecordGroup[], quantity: number): Promise<RecipeLine[]> {
  const grouped = new Map<string, RecipeLine>();
  for (const link of links) {
    const recipeTable = await bitable.base.getTableById(link.tableId);
    const recipeRecords = await recordsByIds(recipeTable, link.recordIds, true);
    const recipeMeta = await recipeTable.getFieldMetaList();
    const recipeLabels = Object.fromEntries(recipeMeta.map((meta) => [meta.name, meta.id]));
    for (const recipeRecord of recipeRecords) {
      const fields = recipeRecord.fields ?? {};
      const material = text(findField(fields, FIELD_ALIASES.material, recipeLabels)) || '未命名花材';
      const stemsPerBunch = number(findField(fields, FIELD_ALIASES.stems, recipeLabels));
      const unit = text(findField(fields, FIELD_ALIASES.unit, recipeLabels)) || '支';
      const note = text(findField(fields, FIELD_ALIASES.recipeNote, recipeLabels));
      const current = grouped.get(material);
      if (current) current.totalStems += stemsPerBunch * quantity;
      else grouped.set(material, { material, stemsPerBunch, unit, totalStems: stemsPerBunch * quantity, note });
    }
  }
  return [...grouped.values()];
}

function recipeLinesFromLinks(links: LinkedRecordGroup[], quantity: number): Promise<RecipeLine[]> {
  const key = `${quantity}|${links.map((link) => `${link.tableId}:${[...link.recordIds].sort().join(',')}`).sort().join('|')}`;
  const cached = recipeLinkCache.get(key);
  if (cached) return cached;
  const pending = loadRecipeLinesFromLinks(links, quantity);
  recipeLinkCache.set(key, pending);
  return pending;
}

type ProductTableLike = {
  getFieldMetaList: () => Promise<RawFieldMeta[]>;
  getRecordsByPage: (options: Record<string, unknown>) => Promise<PageResult>;
  getRecordsByIds: (recordIds: string[], refreshLinkValue?: boolean) => Promise<RawRecord[]>;
};

async function findProductTableUncached(): Promise<ProductTableLike | undefined> {
  const base = bitable.base as unknown as {
    getTableByName?: (name: string) => Promise<ProductTableLike>;
    getTableMetaList?: () => Promise<Array<{ id: string; name: string }>>;
    getTableById?: (id: string) => Promise<ProductTableLike>;
  };
  for (const name of PRODUCT_TABLE_NAMES) {
    try {
      const table = await base.getTableByName?.(name);
      if (table) return table;
    } catch {
      // A base may not contain every conventional table name.
    }
  }
  try {
    const metas = await base.getTableMetaList?.();
    const target = metas?.find((meta) => PRODUCT_TABLE_NAMES.includes(meta.name as (typeof PRODUCT_TABLE_NAMES)[number]));
    return target && base.getTableById ? await base.getTableById(target.id) : undefined;
  } catch {
    return undefined;
  }
}

let productTablePromise: Promise<ProductTableLike | undefined> | undefined;
function findProductTable(): Promise<ProductTableLike | undefined> {
  if (!productTablePromise) {
    productTablePromise = findProductTableUncached().catch((error) => {
      productTablePromise = undefined;
      throw error;
    });
  }
  return productTablePromise;
}

const productRecipeCache = new Map<string, Promise<RecipeLine[]>>();

async function loadRecipeFromProductTable(productName: string, productCode: string, quantity: number): Promise<RecipeLine[]> {
  if (!productName && !productCode) return [];
  try {
    const productTable = await findProductTable();
    if (!productTable) return [];
    const productMeta = await productTable.getFieldMetaList();
    const productLabels = Object.fromEntries(productMeta.map((meta) => [meta.name, meta.id]));
    const productTargets = fieldTargetTableIds(productMeta);
    const productNameField = fieldId(productLabels, FIELD_ALIASES.productName);
    const recipeField = fieldId(productLabels, FIELD_ALIASES.recipeLink);
    const productCodeField = fieldId(productLabels, PRODUCT_CODE_ALIASES);
    if (!productNameField && !productCodeField) return [];
    const productRecords = (await allRecordsByPage(productTable, { pageSize: 200, stringValue: false })).filter((record) => {
      const fields = record.fields ?? {};
      const recordName = productNameField ? text(fields[productNameField]).trim() : '';
      const recordCode = productCodeField ? text(fields[productCodeField]).trim() : '';
      return Boolean((productCode && recordCode && recordCode === productCode.trim()) || (productName && recordName === productName.trim()));
    });
    const grouped = new Map<string, RecipeLine>();
    for (const productRecord of productRecords) {
      const fields = productRecord.fields ?? {};
      const recipeLinks = recipeField
        ? extractLinkedRecordGroups(fields[recipeField], productTargets[recipeField])
        : [];
      const recipeLines = recipeLinks.length ? await recipeLinesFromLinks(recipeLinks, quantity) : recipeFromRecord(fields, productLabels, quantity);
      for (const line of recipeLines) {
        const current = grouped.get(line.material);
        if (current) current.totalStems += line.totalStems;
        else grouped.set(line.material, { ...line });
      }
    }
    return [...grouped.values()];
  } catch {
    return [];
  }
}

function recipeFromProductTable(productName: string, productCode: string, quantity: number): Promise<RecipeLine[]> {
  const key = `${productCode.trim()}|${productName.trim()}|${quantity}`;
  const cached = productRecipeCache.get(key);
  if (cached) return cached;
  const pending = loadRecipeFromProductTable(productName, productCode, quantity);
  productRecipeCache.set(key, pending);
  return pending;
}

function clearRecipeCaches(): void {
  recipeLinkCache.clear();
  productRecipeCache.clear();
  productTablePromise = undefined;
}

async function linkedRecipe(
  fields: Record<string, unknown>,
  labels: Record<string, string>,
  quantity: number,
  targets: Record<string, string>,
): Promise<RecipeLine[]> {
  const directRecipeField = fieldId(labels, FIELD_ALIASES.recipeLink);
  const directRecipeLinks = extractLinkedRecordGroups(
    directRecipeField ? fields[directRecipeField] : undefined,
    directRecipeField ? targets[directRecipeField] : '',
  );
  if (directRecipeLinks.length) {
    try {
      const directRecipe = await recipeLinesFromLinks(directRecipeLinks, quantity);
      if (directRecipe.length) return directRecipe;
    } catch {
      // Continue with the product link/name fallbacks when the direct field is unavailable.
    }
  }

  const productName = text(findField(fields, FIELD_ALIASES.productName, labels));
  const productCode = text(findField(fields, FIELD_ALIASES.productCode, labels));
  const productField = fieldId(labels, FIELD_ALIASES.productName);
  const productLinks = extractLinkedRecordGroups(
    productField ? fields[productField] : undefined,
    productField ? targets[productField] : '',
  );
  if (!productLinks.length) {
    const fallbackRecipe = await recipeFromProductTable(productName, productCode, quantity);
    return fallbackRecipe.length ? fallbackRecipe : recipeFromRecord(fields, labels, quantity);
  }
  try {
    const productContexts = await Promise.all(
      productLinks.map(async (productLink) => {
        const productTable = await bitable.base.getTableById(productLink.tableId);
        const productRecords = await recordsByIds(productTable, productLink.recordIds, true);
        const productMeta = await productTable.getFieldMetaList();
        return {
          productRecords,
          productLabels: Object.fromEntries(productMeta.map((meta) => [meta.name, meta.id])),
          productTargets: fieldTargetTableIds(productMeta),
        };
      }),
    );
    const recipeLinks = productContexts.flatMap(({ productRecords, productLabels, productTargets }) => {
      const recipeField = fieldId(productLabels, FIELD_ALIASES.recipeLink);
      return recipeField
        ? productRecords.flatMap((record) =>
            extractLinkedRecordGroups(record.fields?.[recipeField], productTargets[recipeField]),
          )
        : [];
    });
    const linkedRecipeLines = await recipeLinesFromLinks(recipeLinks, quantity);
    if (linkedRecipeLines.length) return linkedRecipeLines;
    const fallbackRecipe = await recipeFromProductTable(productName, productCode, quantity);
    return fallbackRecipe.length ? fallbackRecipe : recipeFromRecord(fields, labels, quantity);
  } catch {
    const fallbackRecipe = await recipeFromProductTable(productName, productCode, quantity);
    return fallbackRecipe.length ? fallbackRecipe : recipeFromRecord(fields, labels, quantity);
  }
}

async function normalizeRecord(
  record: RawRecord,
  labels: Record<string, string>,
  targets: Record<string, string>,
): Promise<PrintOrder> {
  const fields = record.fields ?? {};
  const quantity = number(findField(fields, FIELD_ALIASES.quantity, labels));
  const productCode = text(findField(fields, FIELD_ALIASES.productCode, labels));
  const recipe = await linkedRecipe(fields, labels, quantity, targets);
  const issues = [] as PrintOrder['issues'];
  if (!productCode) issues.push('missing-code');
  if (quantity <= 0) issues.push('missing-quantity');
  if (!recipe.length) issues.push('missing-recipe');
  return {
    recordId: record.recordId ?? fallbackRecordId(),
    orderNo: text(findField(fields, FIELD_ALIASES.orderNo, labels)),
    shipDate: normalizeDate(findField(fields, FIELD_ALIASES.shipDate, labels)),
    customer: text(findField(fields, FIELD_ALIASES.customer, labels)),
    category: normalizeCategory(findField(fields, FIELD_ALIASES.category, labels)),
    careInstructions: text(findField(fields, FIELD_ALIASES.careInstructions, labels)),
    productName: text(findField(fields, FIELD_ALIASES.productName, labels)) || '未命名花束',
    productCode,
    quantity,
    note: text(findField(fields, FIELD_ALIASES.note, labels)),
    recipe,
    issues,
  };
}

async function fieldLabels(
  table: Awaited<ReturnType<typeof bitable.base.getActiveTable>>,
): Promise<{ labels: Record<string, string>; targets: Record<string, string> }> {
  const metas = await table.getFieldMetaList();
  return {
    labels: Object.fromEntries(metas.map((meta) => [meta.name, meta.id])),
    targets: fieldTargetTableIds(metas),
  };
}

export async function loadFeishuOrders(): Promise<{ orders: PrintOrder[]; source: string; tableName: string }> {
  clearRecipeCaches();
  const table = await bitable.base.getActiveTable();
  const { labels, targets } = await fieldLabels(table);
  const selection = await bitable.base.getSelection();
  const activeName = await table.getName();

  const view = selection.viewId ? await table.getViewById(selection.viewId) : await table.getActiveView();
  const selectedIds = await (view as IGridView).getSelectedRecordIdList().catch(() => [] as string[]);
  if (selection.tableId === table.id && selectedIds.length) {
    const records = await recordsByIds(table, selectedIds, true);
    return { orders: await Promise.all(records.map((record, index) => normalizeRecord({ ...record, recordId: record.recordId ?? selectedIds[index] }, labels, targets))), source: `已选 ${selectedIds.length} 条记录`, tableName: activeName };
  }
  if (selection.tableId === table.id && selection.recordId) {
    const record = await table.getRecordById(selection.recordId, true);
    return { orders: [await normalizeRecord({ ...record, recordId: selection.recordId }, labels, targets)], source: '当前选中记录', tableName: activeName };
  }

  // Keep structured link values (tableId/recordIds) so product recipes can be expanded.
  const records = await allRecordsByPage(table, { pageSize: 200, viewId: view.id, stringValue: false });
  return {
    orders: await Promise.all(records.map((record) => normalizeRecord(record, labels, targets))),
    source: `当前视图 · ${await view.getName()}`,
    tableName: activeName,
  };
}
