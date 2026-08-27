import { useMemo, useState } from 'react';
import { Button, Select } from '@douyinfe/semi-ui';
import { filterOptionsByQuery, normalizeFilterOptions, type FilterOptionInput } from './filter-options';

export type SearchMultiSelectProps = {
  label: string;
  options: readonly FilterOptionInput[];
  value: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptyMessage?: string;
  noOptionsMessage?: string;
  maxMenuHeight?: number;
};

export function SearchMultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = '搜索并选择',
  disabled = false,
  className,
  emptyMessage = '暂无可选项',
  noOptionsMessage = '没有匹配项',
  maxMenuHeight = 240,
}: SearchMultiSelectProps) {
  const [query, setQuery] = useState('');
  const normalizedOptions = useMemo(() => normalizeFilterOptions(options), [options]);
  const selectedValues = useMemo(() => new Set(value), [value]);
  // 保留已选项，即便被搜索过滤掉也不丢标签。
  const visibleOptions = useMemo(() => {
    const matched = filterOptionsByQuery(normalizedOptions, query);
    const optionMap = new Map(normalizedOptions.map((option) => [option.value, option]));
    const extras = value
      .filter((item) => !matched.some((option) => option.value === item))
      .map((item) => optionMap.get(item) ?? { value: item, label: item });
    return [...matched, ...extras];
  }, [normalizedOptions, query, value]);
  const searchMatches = useMemo(() => filterOptionsByQuery(normalizedOptions, query), [normalizedOptions, query]);
  const canSelectAll = searchMatches.length > 0 && searchMatches.some((option) => !selectedValues.has(option.value));

  const selectAllVisible = () => {
    const next = [...value];
    for (const option of searchMatches) {
      if (!selectedValues.has(option.value)) next.push(option.value);
    }
    onChange(next);
  };

  return (
    <div className={className}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 500 }}>{label}</label>
        <span aria-live="polite" style={{ color: 'var(--brand)', fontSize: 10 }}>
          {value.length ? `已选 ${value.length}` : '未选择'}
        </span>
      </div>
      <Select
        aria-label={label}
        multiple
        filter
        remote
        disabled={disabled}
        style={{ width: '100%' }}
        placeholder={placeholder}
        maxHeight={maxMenuHeight}
        value={[...value]}
        onChange={(next) => onChange((next as string[]) ?? [])}
        onSearch={(input) => setQuery(input)}
        onDropdownVisibleChange={(visible) => { if (!visible) setQuery(''); }}
        optionList={visibleOptions}
        emptyContent={normalizedOptions.length ? noOptionsMessage : emptyMessage}
        maxTagCount={3}
        showRestTagsPopover
        outerTopSlot={canSelectAll ? (
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--line-soft)' }}>
            <Button size="small" theme="borderless" type="primary" block onMouseDown={(event) => event.preventDefault()} onClick={selectAllVisible}>
              全选当前搜索结果
            </Button>
          </div>
        ) : undefined}
      />
    </div>
  );
}
