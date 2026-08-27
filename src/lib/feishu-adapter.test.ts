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

  it('keeps category values when the column has a business suffix and lookup wrapping', async () => {
    const salesTable = {
      id: 'tbl_sales_category_suffix',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_product', name: '花束名称' },
        { id: 'fld_quantity', name: '销售数量' },
        { id: 'fld_category', name: '商品品类字段' },
      ]),
      getViewById: vi.fn().mockResolvedValue({
        getSelectedRecordIdList: vi.fn().mockResolvedValue([]),
        getName: vi.fn().mockResolvedValue('今日出货'),
      }),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [{
          recordId: 'rec_category_suffix',
          fields: {
            fld_product: '云间甜梦',
            fld_quantity: 1,
            fld_category: { value: [{ text: '鲜花花束' }, { name: '礼盒' }] },
          },
        }],
      }),
    };

    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({
      tableId: 'tbl_other',
      viewId: 'view_today',
      recordId: null,
      fieldId: null,
      baseId: 'base',
    });

    const result = await loadFeishuOrders();

    expect(result.orders[0].category).toBe('鲜花花束、礼盒');
  });

  it('reads the product code when the sales column was renamed to 成品编码', async () => {
    const salesTable = {
      id: 'tbl_sales_renamed_code',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_code', name: '成品编码' },
        { id: 'fld_product', name: '成品名称' },
        { id: 'fld_quantity', name: '销售数量（扎）' },
      ]),
      getViewById: vi.fn().mockResolvedValue({
        getSelectedRecordIdList: vi.fn().mockResolvedValue([]),
        getName: vi.fn().mockResolvedValue('今日出货'),
      }),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [{
          recordId: 'rec_renamed_code',
          fields: {
            fld_code: 'CP-001',
            fld_product: '云间甜梦',
            fld_quantity: 3,
          },
        }],
      }),
    };

    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({
      tableId: 'tbl_other',
      viewId: 'view_today',
      recordId: null,
      fieldId: null,
      baseId: 'base',
    });

    const result = await loadFeishuOrders();

    expect(result.orders[0].productCode).toBe('CP-001');
    expect(result.orders[0].issues).not.toContain('missing-code');
  });

  it('reads recipe material after 花材名称→配方花材名称 rename and dropped 规格 column', async () => {
    const salesTable = {
      id: 'tbl_sales_renamed_material',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_code', name: '成品编码' },
        { id: 'fld_product', name: '成品名称', property: { tableId: 'tbl_products' } },
        { id: 'fld_quantity', name: '销售数量（扎）' },
      ]),
      getViewById: vi.fn().mockResolvedValue({
        getSelectedRecordIdList: vi.fn().mockResolvedValue([]),
        getName: vi.fn().mockResolvedValue('今日出货'),
      }),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [{
          recordId: 'rec_renamed_material',
          fields: {
            fld_code: 'CP-002',
            fld_product: { text: '云间甜梦', recordIds: ['rec_product_1'] },
            fld_quantity: 2,
          },
        }],
      }),
    };
    const productTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'p_name', name: '成品名称' },
        { id: 'p_recipe', name: '成品配方', property: { tableId: 'tbl_recipe' } },
      ]),
      getRecordsByIds: vi.fn().mockResolvedValue([
        { fields: { p_name: '云间甜梦', p_recipe: { recordIds: ['rec_recipe_1'] } } },
      ]),
    };
    const recipeTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'r_material', name: '配方花材名称' },
        { id: 'r_stems', name: '花材用量（枝数）' },
        { id: 'r_note', name: '采购备注' },
      ]),
      getRecordsByIds: vi.fn().mockResolvedValue([
        { fields: { r_material: '向日葵', r_stems: 5, r_note: 'B级' } },
      ]),
    };

    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({
      tableId: 'tbl_other', viewId: 'view_today', recordId: null, fieldId: null, baseId: 'base',
    });
    vi.mocked(base.getTableById).mockImplementation(async (tableId) => {
      if (tableId === 'tbl_products') return productTable as never;
      if (tableId === 'tbl_recipe') return recipeTable as never;
      throw new Error(`unexpected table ${tableId}`);
    });

    const result = await loadFeishuOrders();

    expect(result.orders[0].recipe).toEqual([
      { material: '向日葵', stemsPerBunch: 5, unit: '支', totalStems: 10, note: 'B级' },
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

  it('finds a conventional product recipe table by code when the table is not named 成品汇总表', async () => {
    const salesTable = {
      id: 'tbl_sales_fallback',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_product', name: '花束名称' },
        { id: 'fld_code', name: '花束编码' },
        { id: 'fld_quantity', name: '销售数量' },
      ]),
      getViewById: vi.fn().mockResolvedValue({
        getSelectedRecordIdList: vi.fn().mockResolvedValue([]),
        getName: vi.fn().mockResolvedValue('今日出货'),
      }),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [{ recordId: 'rec_sales_fallback', fields: { fld_product: '名称可能不同', fld_code: 'CODE-001', fld_quantity: 2 } }],
      }),
    };
    const productTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'p_name', name: '花束名称' },
        { id: 'p_code', name: '成品编码' },
        { id: 'p_recipe', name: '成品配方', property: { tableId: 'tbl_recipe_fallback' } },
      ]),
      getRecordsByPage: vi.fn().mockResolvedValue({
        records: [{ fields: { p_name: '成品名称', p_code: 'CODE-001', p_recipe: { recordIds: ['rec_recipe_fallback'] } } }],
      }),
    };
    const recipeTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([{ id: 'r_material', name: '花材名称' }, { id: 'r_stems', name: '花材用量（枝数）' }]),
      getRecordsByIds: vi.fn().mockResolvedValue([{ fields: { r_material: '编码匹配花材', r_stems: 4 } }]),
    };
    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({ tableId: 'tbl_other', viewId: 'view_fallback', recordId: null, fieldId: null, baseId: 'base' });
    vi.mocked(base.getTableByName).mockImplementation(async (name) => {
      if (name === '成品配方表') return productTable as never;
      throw new Error('table not found');
    });
    vi.mocked(base.getTableById).mockResolvedValue(recipeTable as never);

    const result = await loadFeishuOrders();

    expect(result.orders[0].recipe[0]).toMatchObject({ material: '编码匹配花材', stemsPerBunch: 4, totalStems: 8 });
    expect(result.orders[0].issues).not.toContain('missing-recipe');
  });

  it('falls back to BOM fields on a product row when no recipe link column exists', async () => {
    const salesTable = {
      id: 'tbl_sales_product_bom',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_product', name: '花束名称' },
        { id: 'fld_code', name: '花束编码' },
        { id: 'fld_quantity', name: '销售数量' },
      ]),
      getViewById: vi.fn().mockResolvedValue({ getSelectedRecordIdList: vi.fn().mockResolvedValue([]), getName: vi.fn().mockResolvedValue('今日出货') }),
      getRecordsByPage: vi.fn().mockResolvedValue({ records: [{ recordId: 'rec_sales_product_bom', fields: { fld_product: '成品花束', fld_code: 'BOM-001', fld_quantity: 2 } }] }),
    };
    const productTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'p_name', name: '花束名称' },
        { id: 'p_code', name: '成品编码' },
        { id: 'p_material', name: '花材名称' },
        { id: 'p_stems', name: '花材用量（枝数）' },
      ]),
      getRecordsByPage: vi.fn().mockResolvedValue({ records: [{ recordId: 'rec_product_bom', fields: { p_name: '成品花束', p_code: 'BOM-001', p_material: '成品玫瑰', p_stems: 8 } }] }),
      getRecordsByIds: vi.fn(),
    };
    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({ tableId: 'tbl_other', viewId: 'view_product_bom', recordId: null, fieldId: null, baseId: 'base' });
    vi.mocked(base.getTableByName).mockImplementation(async (name) => name === '成品汇总表' ? productTable as never : Promise.reject(new Error('table not found')));

    const result = await loadFeishuOrders();

    expect(result.orders[0]?.recipe).toEqual([{ material: '成品玫瑰', stemsPerBunch: 8, unit: '支', totalStems: 16, note: '' }]);
    expect(result.orders[0]?.issues).not.toContain('missing-recipe');
  });

  it('reads every view page instead of silently stopping at the first 200 records', async () => {
    const pageOne = Array.from({ length: 200 }, (_, index) => ({ recordId: `rec-page-${index}`, fields: { product: `花束-${index}`, quantity: 1, material: '玫瑰', stems: 1 } }));
    const pageTwo = [{ recordId: 'rec-page-200', fields: { product: '花束-200', quantity: 1, material: '玫瑰', stems: 1 } }];
    const salesTable = {
      id: 'tbl_sales_pages',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'product', name: '花束名称' }, { id: 'quantity', name: '销售数量' }, { id: 'material', name: '花材名称' }, { id: 'stems', name: '花材用量（枝数）' },
      ]),
      getViewById: vi.fn().mockResolvedValue({ getSelectedRecordIdList: vi.fn().mockResolvedValue([]), getName: vi.fn().mockResolvedValue('全量视图') }),
      getRecordsByPage: vi.fn().mockImplementation(async ({ pageToken }: { pageToken?: number }) => pageToken === undefined ? { records: pageOne, hasMore: true, pageToken: 1 } : { records: pageTwo, hasMore: false }),
    };
    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({ tableId: 'tbl_other', viewId: 'view_pages', recordId: null, fieldId: null, baseId: 'base' });
    vi.mocked(base.getTableByName).mockRejectedValue(new Error('table not found'));

    const result = await loadFeishuOrders();

    expect(result.orders).toHaveLength(201);
    expect(salesTable.getRecordsByPage).toHaveBeenCalledTimes(2);
    expect(salesTable.getRecordsByPage).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 1 }));
  });

  it('chunks selected records at the SDK 1000-record limit', async () => {
    const selectedIds = Array.from({ length: 1001 }, (_, index) => `rec-selected-${index}`);
    const getRecordsByIds = vi.fn().mockImplementation(async (ids: string[]) => ids.map((recordId) => ({ recordId, fields: { product: '批量花束', quantity: 1 } })));
    const salesTable = {
      id: 'tbl_sales_selected',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([{ id: 'product', name: '花束名称' }, { id: 'quantity', name: '销售数量' }]),
      getViewById: vi.fn().mockResolvedValue({ getSelectedRecordIdList: vi.fn().mockResolvedValue(selectedIds), getName: vi.fn().mockResolvedValue('已选记录') }),
      getRecordsByIds,
      getRecordsByPage: vi.fn(),
    };
    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({ tableId: salesTable.id, viewId: 'view_selected', recordId: null, fieldId: null, baseId: 'base' });
    vi.mocked(base.getTableByName).mockRejectedValue(new Error('table not found'));

    const result = await loadFeishuOrders();

    expect(result.orders).toHaveLength(1001);
    expect(getRecordsByIds.mock.calls.map(([ids]) => ids.length)).toEqual([1000, 1]);
    expect(result.orders[1000]?.recordId).toBe('rec-selected-1000');
  });

  it('resolves linked product and recipe fields with business suffixes', async () => {
    const salesTable = {
      id: 'tbl_sales_suffix_links',
      getName: vi.fn().mockResolvedValue('花众销售订单汇总表'),
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'fld_product', name: '花束名称（关联）', property: { tableId: 'tbl_products_suffix' } },
        { id: 'fld_code', name: '花束编码数值' },
        { id: 'fld_quantity', name: '销售数量' },
      ]),
      getViewById: vi.fn().mockResolvedValue({ getSelectedRecordIdList: vi.fn().mockResolvedValue([]), getName: vi.fn().mockResolvedValue('今日出货') }),
      getRecordsByPage: vi.fn().mockResolvedValue({ records: [{ recordId: 'rec_sales_suffix', fields: { fld_product: { text: '后缀花束', recordIds: ['rec_product_suffix'] }, fld_code: 'SUFFIX-001', fld_quantity: 2 } }] }),
    };
    const productTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([
        { id: 'p_name', name: '花束名称（查找）' },
        { id: 'p_code', name: '花束编码数值' },
        { id: 'p_recipe', name: '成品配方（关联）', property: { tableId: 'tbl_recipe_suffix' } },
      ]),
      getRecordsByIds: vi.fn().mockResolvedValue([{ recordId: 'rec_product_suffix', fields: { p_name: '后缀花束', p_code: 'SUFFIX-001', p_recipe: { recordIds: ['rec_recipe_suffix'] } } }]),
      getRecordsByPage: vi.fn(),
    };
    const recipeTable = {
      getFieldMetaList: vi.fn().mockResolvedValue([{ id: 'r_material', name: '花材名称' }, { id: 'r_stems', name: '花材用量（枝数）' }]),
      getRecordsByIds: vi.fn().mockResolvedValue([{ recordId: 'rec_recipe_suffix', fields: { r_material: '后缀玫瑰', r_stems: 5 } }]),
    };
    vi.mocked(base.getActiveTable).mockResolvedValue(salesTable as never);
    vi.mocked(base.getSelection).mockResolvedValue({ tableId: 'tbl_other', viewId: 'view_suffix_links', recordId: null, fieldId: null, baseId: 'base' });
    vi.mocked(base.getTableById).mockImplementation(async (tableId) => {
      if (tableId === 'tbl_products_suffix') return productTable as never;
      if (tableId === 'tbl_recipe_suffix') return recipeTable as never;
      throw new Error(`unexpected table ${tableId}`);
    });

    const result = await loadFeishuOrders();

    expect(result.orders[0]?.recipe).toEqual([{ material: '后缀玫瑰', stemsPerBunch: 5, unit: '支', totalStems: 10, note: '' }]);
    expect(result.orders[0]?.issues).not.toContain('missing-recipe');
  });
});
