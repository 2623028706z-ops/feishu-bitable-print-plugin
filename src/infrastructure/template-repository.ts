import { bitable } from '@lark-base-open/js-sdk';
import { createDefaultTemplate, migrateTemplateConfig, type PrintTemplate, type TemplateType } from '../domain/templates';

export const TEMPLATE_TABLE_NAME = '打印模板配置';
export const TEMPLATE_FIELD_NAMES = { id: '模板ID', name: '模板名称', type: '模板类型', paper: '纸张规格', json: '模板JSON', version: '版本号', isDefault: '是否默认', status: '状态', updatedBy: '更新人', updatedAt: '更新时间' } as const;

export class TemplatePermissionError extends Error {
  code = 'permission-denied';
  constructor(message = '没有编辑打印模板配置表的权限') { super(message); this.name = 'TemplatePermissionError'; }
}
export class TemplateConflictError extends Error {
  code = 'version-conflict';
  constructor(message = '模板已被其他成员更新，请重新载入或复制为新模板') { super(message); this.name = 'TemplateConflictError'; }
}

type BaseLike = { getTableByName: (name: string) => Promise<any>; addTable?: (config: any) => Promise<any> };
type RepositorySnapshot = { templates: PrintTemplate[]; available: boolean; editable: boolean; reason?: 'missing-table' | 'permission-denied' };

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['text', 'name', 'label', 'value', 'id']) { const text = display(object[key]); if (text) return text; }
  }
  return '';
}

function isMissingTable(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /not.?found|不存在|找不到|table.*(missing|invalid)/i.test(text);
}
function isPermission(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /permission|forbidden|denied|权限|无权/i.test(text);
}
function asBool(value: unknown): boolean { return display(value).toLocaleLowerCase() === 'true' || display(value) === '1' || display(value) === '是'; }

export class TemplateRepository {
  private readonly base: BaseLike;
  private readonly tableName: string;
  private table: any;
  private fields: Record<string, string> = {};

  constructor(base?: BaseLike, tableName = TEMPLATE_TABLE_NAME) {
    this.base = base ?? (bitable?.base as unknown as BaseLike | undefined) ?? {
      getTableByName: async () => { throw new Error('飞书 SDK 尚未就绪'); },
    };
    this.tableName = tableName;
  }

  private async getTable(): Promise<any | null> {
    if (this.table) return this.table;
    try { this.table = await this.base.getTableByName(this.tableName); } catch (error) { if (isMissingTable(error)) return null; if (isPermission(error)) throw new TemplatePermissionError(); throw error; }
    const metas = await this.table.getFieldMetaList();
    this.fields = Object.fromEntries(metas.map((meta: any) => [meta.name, meta.id]));
    return this.table;
  }

  private field(name: string): string { return this.fields[name] || name; }

  private async readRecords(): Promise<any[]> {
    const table = await this.getTable(); if (!table) return [];
    try { const response = await table.getRecordsByPage({ pageSize: 200, stringValue: false }); return response.records || []; } catch (error) { if (isPermission(error)) throw new TemplatePermissionError(); throw error; }
  }

  private decode(record: any): PrintTemplate | null {
    const fields = record.fields || {}; const json = display(fields[this.field(TEMPLATE_FIELD_NAMES.json)]);
    try { const parsed = json ? JSON.parse(json) : {}; const type = (display(fields[this.field(TEMPLATE_FIELD_NAMES.type)]) || parsed.type) as TemplateType; if (type !== 'label' && type !== 'a4') return null; const migrated = migrateTemplateConfig({ ...parsed, id: display(fields[this.field(TEMPLATE_FIELD_NAMES.id)]) || parsed.id, name: display(fields[this.field(TEMPLATE_FIELD_NAMES.name)]) || parsed.name, isDefault: asBool(fields[this.field(TEMPLATE_FIELD_NAMES.isDefault)]) || parsed.isDefault, version: Number(display(fields[this.field(TEMPLATE_FIELD_NAMES.version)])) || parsed.version }, type); return migrated; } catch { return null; }
  }

  async load(): Promise<RepositorySnapshot> {
    try { const table = await this.getTable(); if (!table) return { templates: [createDefaultTemplate('label'), createDefaultTemplate('a4')], available: false, editable: false, reason: 'missing-table' }; const templates = (await this.readRecords()).map((record) => this.decode(record)).filter((template): template is PrintTemplate => Boolean(template)); return { templates, available: true, editable: true }; } catch (error) { if (error instanceof TemplatePermissionError) return { templates: [], available: true, editable: false, reason: 'permission-denied' }; throw error; }
  }

  async list(): Promise<PrintTemplate[]> { return (await this.load()).templates; }
  async get(id: string): Promise<PrintTemplate | undefined> { return (await this.list()).find((template) => template.id === id); }

  private fieldsFor(template: PrintTemplate): Record<string, unknown> {
    return { [this.field(TEMPLATE_FIELD_NAMES.id)]: template.id, [this.field(TEMPLATE_FIELD_NAMES.name)]: template.name, [this.field(TEMPLATE_FIELD_NAMES.type)]: template.type, [this.field(TEMPLATE_FIELD_NAMES.paper)]: template.type === 'label' ? `${template.paper.widthMm}×${template.paper.heightMm}mm` : `A4 ${template.orientation === 'landscape' ? '横向' : '纵向'}`, [this.field(TEMPLATE_FIELD_NAMES.json)]: JSON.stringify(template), [this.field(TEMPLATE_FIELD_NAMES.version)]: template.version, [this.field(TEMPLATE_FIELD_NAMES.isDefault)]: template.isDefault, [this.field(TEMPLATE_FIELD_NAMES.status)]: '启用' };
  }

  private async clearDefault(type: TemplateType, exceptId?: string): Promise<void> {
    for (const record of await this.readRecords()) { const current = this.decode(record); if (current?.type === type && current.isDefault && current.id !== exceptId) { const next = { ...current, isDefault: false }; await this.table.setRecord(record.recordId, this.fieldsFor(next)); } }
  }

  async save(template: PrintTemplate, expectedVersion?: number): Promise<PrintTemplate> {
    const table = await this.getTable(); if (!table) throw new Error('未找到打印模板配置表，请先初始化');
    const currentRecords = await this.readRecords(); const currentRecord = currentRecords.find((record) => this.decode(record)?.id === template.id); const current = currentRecord ? this.decode(currentRecord) : undefined;
    if (expectedVersion !== undefined && current && current.version !== expectedVersion) throw new TemplateConflictError();
    const next = { ...migrateTemplateConfig(template, template.type), version: (current?.version || template.version || 0) + 1 } as PrintTemplate;
    try { if (next.isDefault) await this.clearDefault(next.type, next.id); if (currentRecord) await table.setRecord(currentRecord.recordId, this.fieldsFor(next)); else await table.addRecord(this.fieldsFor(next)); } catch (error) { if (isPermission(error)) throw new TemplatePermissionError(); throw error; }
    return next;
  }

  async create(type: TemplateType, name?: string): Promise<PrintTemplate> { const template = createDefaultTemplate(type); return this.save({ ...template, id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: name?.trim() || template.name, isDefault: false } as PrintTemplate, 0); }
  async copy(template: PrintTemplate, name?: string): Promise<PrintTemplate> { return this.save({ ...template, id: `${template.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: name?.trim() || `${template.name} 副本`, isDefault: false, version: 0 }, 0); }

  async setDefault(id: string): Promise<PrintTemplate> { const template = await this.get(id); if (!template) throw new Error('模板不存在'); return this.save({ ...template, isDefault: true }, template.version); }

  async remove(id: string): Promise<void> { const table = await this.getTable(); if (!table) throw new Error('未找到打印模板配置表'); const records = await this.readRecords(); const record = records.find((item) => this.decode(item)?.id === id); const template = record && this.decode(record); if (!record || !template) return; if (template.isDefault) throw new Error('默认模板不能直接删除，请先设置其他模板为默认'); try { await table.deleteRecord(record.recordId); } catch (error) { if (isPermission(error)) throw new TemplatePermissionError(); throw error; } }

  async initialize(): Promise<boolean> {
    if (!this.base.addTable) return false;
    if (await this.getTable()) return true;
    try { await this.base.addTable({ name: this.tableName, fields: [{ name: TEMPLATE_FIELD_NAMES.id, type: 'Text' }, { name: TEMPLATE_FIELD_NAMES.name, type: 'Text' }, { name: TEMPLATE_FIELD_NAMES.type, type: 'Text' }, { name: TEMPLATE_FIELD_NAMES.paper, type: 'Text' }, { name: TEMPLATE_FIELD_NAMES.json, type: 'Text' }, { name: TEMPLATE_FIELD_NAMES.version, type: 'Number' }, { name: TEMPLATE_FIELD_NAMES.isDefault, type: 'Checkbox' }, { name: TEMPLATE_FIELD_NAMES.status, type: 'Text' }] }); this.table = undefined; await this.getTable(); await this.save(createDefaultTemplate('label')); await this.save(createDefaultTemplate('a4')); return true; } catch (error) { if (isPermission(error)) throw new TemplatePermissionError('没有创建打印模板配置表的权限'); throw error; }
  }
}

export function createTemplateRepository(base?: BaseLike, tableName = TEMPLATE_TABLE_NAME): TemplateRepository { return new TemplateRepository(base, tableName); }
