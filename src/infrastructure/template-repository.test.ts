import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTemplate, type PrintTemplate } from '../domain/templates';
import { TemplateRepository } from './template-repository';

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
});
