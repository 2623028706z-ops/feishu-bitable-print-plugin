import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTemplate, type PrintTemplate } from '../domain/templates';
import { TemplateConflictError, TemplateRepository } from './template-repository';

type StoredRecord = { recordId: string; fields: Record<string, unknown> };

function stored(template: PrintTemplate, recordId: string): StoredRecord {
  return {
    recordId,
    fields: {
      模板ID: template.id,
      模板名称: template.name,
      模板类型: template.type,
      模板JSON: JSON.stringify(template),
      版本号: template.version,
      是否默认: template.isDefault,
    },
  };
}

function fixture(options?: { extraDefaults?: boolean; failRecordIds?: string[] }) {
  const oldDefault = { ...createDefaultTemplate('label'), id: 'label-old', name: '旧默认', isDefault: true };
  const target = { ...createDefaultTemplate('label'), id: 'label-target', name: '新模板', isDefault: false };
  const anotherDefault = { ...createDefaultTemplate('label'), id: 'label-another', name: '另一个默认', isDefault: true };
  const records = [stored(oldDefault, 'rec-old'), stored(target, 'rec-target')];
  if (options?.extraDefaults) records.push(stored(anotherDefault, 'rec-another'));
  const events: string[] = [];
  const failRecordIds = new Set(options?.failRecordIds ?? []);
  const table = {
    getFieldMetaList: vi.fn(async () => Object.keys(records[0].fields).map((name) => ({ id: name, name }))),
    getRecordsByPage: vi.fn(async () => ({ records })),
    setRecord: vi.fn(async (recordId: string, values: Record<string, unknown>) => {
      events.push(`set:${recordId}`);
      if (failRecordIds.has(recordId)) throw new Error(`write failed for ${recordId}`);
      const record = records.find((item) => item.recordId === recordId);
      if (record) Object.assign(record.fields, values);
      return recordId;
    }),
    addRecord: vi.fn(),
  };
  const base = { getTableByName: vi.fn(async () => table) };
  return { base, table, records, events, target };
}

describe('TemplateRepository default switching', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes the target default before clearing the previous default', async () => {
    const fixtureData = fixture();
    const repository = new TemplateRepository(fixtureData.base);

    const saved = await repository.setDefault(fixtureData.target.id);

    expect(saved.isDefault).toBe(true);
    expect(fixtureData.events).toEqual(['set:rec-target', 'set:rec-old']);
    expect(fixtureData.records.find((record) => record.recordId === 'rec-target')?.fields.是否默认).toBe(true);
    expect(fixtureData.records.find((record) => record.recordId === 'rec-old')?.fields.是否默认).toBe(false);
  });

  it('keeps the new default when cleanup fails and continues best-effort cleanup', async () => {
    const fixtureData = fixture({ extraDefaults: true, failRecordIds: ['rec-old'] });
    const repository = new TemplateRepository(fixtureData.base);

    await expect(repository.setDefault(fixtureData.target.id)).resolves.toMatchObject({ id: fixtureData.target.id, isDefault: true });

    expect(fixtureData.events).toEqual(['set:rec-target', 'set:rec-old', 'set:rec-another']);
    expect(fixtureData.records.find((record) => record.recordId === 'rec-target')?.fields.是否默认).toBe(true);
    expect(fixtureData.records.filter((record) => record.fields.是否默认 === true)).toHaveLength(2);
    expect(repository.getLastDefaultCleanupFailures()).toHaveLength(1);
    expect(repository.getLastDefaultCleanupFailures()[0]?.recordId).toBe('rec-old');
  });

  it('does not start cleanup when writing the target default fails', async () => {
    const fixtureData = fixture({ failRecordIds: ['rec-target'] });
    const repository = new TemplateRepository(fixtureData.base);

    await expect(repository.setDefault(fixtureData.target.id)).rejects.toThrow('write failed for rec-target');
    expect(fixtureData.events).toEqual(['set:rec-target']);
    expect(repository.getLastDefaultCleanupFailures()).toEqual([]);
  });

  it('rejects a stale version instead of silently overwriting a shared template', async () => {
    const fixtureData = fixture();
    const repository = new TemplateRepository(fixtureData.base);
    const current = fixtureData.records.find((record) => record.recordId === 'rec-target');
    if (current) current.fields.版本号 = 2;

    await expect(repository.save({ ...fixtureData.target, isDefault: true }, 0)).rejects.toBeInstanceOf(TemplateConflictError);
    expect(fixtureData.events).toEqual([]);
  });

  it('uses numeric SDK field types when initializing the shared template table', async () => {
    const fixtureData = fixture();
    const addTable = vi.fn().mockResolvedValue({ tableId: 'tbl_templates', index: 0 });
    const base = {
      getTableByName: vi.fn()
        .mockRejectedValueOnce(new Error('table not found'))
        .mockResolvedValue(fixtureData.table),
      addTable,
    };
    const repository = new TemplateRepository(base);

    await expect(repository.initialize()).resolves.toBe(true);

    expect(addTable).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining([
        expect.objectContaining({ name: '模板ID', type: 1 }),
        expect.objectContaining({ name: '版本号', type: 2 }),
        expect.objectContaining({ name: '是否默认', type: 7 }),
      ]),
    }));
  });

  it('reads every template configuration page', async () => {
    const first = stored({ ...createDefaultTemplate('label'), id: 'label-page-1', isDefault: true }, 'rec-page-1');
    const second = stored({ ...createDefaultTemplate('a4'), id: 'a4-page-2', isDefault: false }, 'rec-page-2');
    const table = {
      getFieldMetaList: vi.fn(async () => Object.keys(first.fields).map((name) => ({ id: name, name }))),
      getRecordsByPage: vi.fn().mockImplementation(async ({ pageToken }: { pageToken?: string }) => pageToken ? { records: [second], hasMore: false } : { records: [first], hasMore: true, pageToken: 'next-page' }),
    };
    const repository = new TemplateRepository({ getTableByName: vi.fn(async () => table) });

    const templates = await repository.list();

    expect(templates.map((template) => template.id)).toEqual(['label-page-1', 'a4-page-2']);
    expect(table.getRecordsByPage).toHaveBeenCalledTimes(2);
    expect(table.getRecordsByPage).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'next-page' }));
  });
});
