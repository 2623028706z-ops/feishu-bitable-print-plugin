import { describe, expect, it, vi } from 'vitest';

const { base } = vi.hoisted(() => ({
  base: {
    getActiveTable: vi.fn(),
    getSelection: vi.fn(),
    getTableById: vi.fn(),
    getTableByName: vi.fn(),
  },
}));

vi.mock('@lark-base-open/js-sdk', () => ({ bitable: { base } }));

import { extractLinkedRecordGroups, loadFeishuOrders, text } from './feishu-adapter';

describe('feishu link value parsing', () => {
  it('extracts visible text from select and lookup wrappers', () => {
    expect(text({ text: '', value: { option: '鲜花花束' } })).toBe('鲜花花束');
    expect(text([{ label: '鲜花' }, { displayName: '礼盒' }])).toBe('鲜花、礼盒');
  });

  it('reads the SDK link shape', () => {
    expect(
      extractLinkedRecordGroups({
        text: '云间甜梦',
        tableId: 'tbl_product',
        recordIds: ['rec_product_1'],
      }),
    ).toEqual([{ tableId: 'tbl_product', recordIds: ['rec_product_1'] }]);
  });

  it('supports legacy keys and combines nested link values', () => {
    expect(
      extractLinkedRecordGroups([
        { table_id: 'tbl_recipe', record_ids: ['rec_1'] },
        { tableId: 'tbl_recipe', recordIds: ['rec_2', 'rec_1'] },
      ]),
    ).toEqual([{ tableId: 'tbl_recipe', recordIds: ['rec_1', 'rec_2'] }]);
  });

  it('uses the link field target table when the value only contains record ids', () => {
    expect(
      extractLinkedRecordGroups(
        { recordIds: ['rec_product_1', 'rec_product_2'] },
        'tbl_product',
      ),
    ).toEqual([{ tableId: 'tbl_product', recordIds: ['rec_product_1', 'rec_product_2'] }]);
  });

  it('reads wrapped record objects with a target table fallback', () => {
    expect(
      extractLinkedRecordGroups(
        { value: [{ record_id: 'rec_recipe_1' }, { recordId: 'rec_recipe_2' }] },
        'tbl_recipe',
      ),
    ).toEqual([{ tableId: 'tbl_recipe', recordIds: ['rec_recipe_1', 'rec_recipe_2'] }]);
  });

  it('returns no link when there are no usable record ids', () => {
    expect(extractLinkedRecordGroups('云间甜梦', 'tbl_product')).toEqual([]);
  });

  it('loads a recipe through the sales, product, and recipe tables', async () => {
    const salesTable = {
      id: 'tbl_sales',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_order', name: '订单编号' },
        { id: 'fld_date', name: '出货日期' },
        { id: 'fld_code', name: '花束编码' },
        { id: 'fld_customer', name: '客户名称' },
        { id: 'fld_product', name: '花束名称', property: { tableId: 'tbl_products' } },
        { id: 'fld_quantity', name: '销售数量（扎）' },
        { id: 'fld_category', name: '品类（关联）' },
        { id: 'fld_care', name: '养护说明' },
      ]),
      getViewById: vi.fn().mockResolvedValue({
        getSelectedRecordIdList: vi.fn().mockResolvedValue([]),
        getName: vi.fn().mockResolvedValue('今日出货'),
      }),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [
          {
            recordId: 'rec_sales_1',
            fields: {
              fld_order: 'HZ-001',
              fld_date: 1787443200000,
              fld_code: 'HZ001',
              fld_customer: '花众',
              fld_product: { text: '云间甜梦', recordIds: ['rec_product_1'] },
              fld_quantity: 2,
              fld_category: '鲜花花束',
              fld_care: '保持花泥湿润',
            },
          },
        ],
      }),
    };
    const productTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'p_name', name: '花束名称' },
        { id: 'p_recipe', name: '配方', property: { tableId: 'tbl_recipe' } },
      ]),
      getRecordsByIds: vi.fn().mockResolvedValue([
        {
          fields: {
            p_name: '云间甜梦',
            p_recipe: { recordIds: ['rec_recipe_1'] },
          },
        },
      ]),
    };
    const recipeTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'r_material', name: '花材名称' },
        { id: 'r_stems', name: '花材用量（枝数）' },
        { id: 'r_unit', name: '规格' },
        { id: 'r_note', name: '采购备注' },
      ]),
      getRecordsByIds: vi.fn().mockResolvedValue([
        {
          fields: {
            r_material: '玫瑰',
            r_stems: 6,
            r_unit: '支',
            r_note: 'A级',
          },
        },
      ]),
    };

    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({
      tableId: 'tbl_other',
      viewId: 'view_today',
      recordId: null,
      fieldId: null,
      baseId: 'base',
    });
    vi.mocked(base.getTableById).mockImplementation(async (tableId) => {
      if (tableId === 'tbl_products') return productTable as never;
      if (tableId === 'tbl_recipe') return recipeTable as never;
      throw new Error(`unexpected table ${tableId}`);
    });

    const result = await loadFeishuOrders();

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].productName).toBe('云间甜梦');
    expect(result.orders[0].category).toBe('鲜花花束');
    expect(result.orders[0].recipe).toEqual([
      { material: '玫瑰', stemsPerBunch: 6, unit: '支', totalStems: 12, note: 'A级' },
    ]);
    expect(result.orders[0].issues).not.toContain('missing-recipe');
  });

  it('prefers a direct sales-order recipe link when present', async () => {
    const directSalesTable = {
      id: 'tbl_sales_direct',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_product', name: '花束名称' },
        { id: 'fld_quantity', name: '销售数量（扎）' },
        { id: 'fld_code', name: '花束编码' },
        { id: 'fld_recipe', name: '配方', property: { tableId: 'tbl_recipe' } },
      ]),
      getViewById: vi.fn().mockResolvedValue({
        getSelectedRecordIdList: vi.fn().mockResolvedValue([]),
        getName: vi.fn().mockResolvedValue('今日出货'),
      }),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [
          {
            recordId: 'rec_sales_direct',
            fields: {
              fld_product: '云间甜梦',
              fld_quantity: 3,
              fld_code: 'HZ001',
              fld_recipe: { recordIds: ['rec_recipe_direct'] },
            },
          },
        ],
      }),
    };
    const recipeTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'r_material', name: '花材名称' },
        { id: 'r_stems', name: '花材用量（枝数）' },
      ]),
      getRecordsByIds: vi.fn().mockResolvedValue([
        { fields: { r_material: '直接配方花材', r_stems: 7 } },
      ]),
    };

    vi.mocked(base.getActiveTable).mockResolvedValue(directSalesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({
      tableId: 'tbl_other',
      viewId: 'view_today',
      recordId: null,
      fieldId: null,
      baseId: 'base',
    });
    vi.mocked(base.getTableById).mockResolvedValue(recipeTable as never);

    const result = await loadFeishuOrders();

    expect(result.orders[0].recipe).toEqual([
      { material: '直接配方花材', stemsPerBunch: 7, unit: '支', totalStems: 21, note: '' },
    ]);
    expect(result.orders[0].issues).not.toContain('missing-recipe');
  });
});
