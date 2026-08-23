import { describe, expect, it } from 'vitest';
import { filterOptionsByQuery, normalizeFilterOptions } from './filter-options';

describe('filter options', () => {
  it('trims, de-duplicates, and removes empty options', () => {
    expect(normalizeFilterOptions([' 天虹 ', '', '天虹', { value: ' 鲜花 ', label: ' 鲜花品类 ' }])).toEqual([
      { value: '天虹', label: '天虹' },
      { value: '鲜花', label: '鲜花品类' },
    ]);
  });

  it('searches labels and raw values without changing the source order', () => {
    const options = normalizeFilterOptions([
      { value: 'customer-1', label: '天虹' },
      { value: 'customer-2', label: '盒马' },
    ]);

    expect(filterOptionsByQuery(options, '虹')).toEqual([{ value: 'customer-1', label: '天虹' }]);
    expect(filterOptionsByQuery(options, 'CUSTOMER-2')).toEqual([{ value: 'customer-2', label: '盒马' }]);
    expect(filterOptionsByQuery(options, '')).toEqual(options);
  });
});
