import { useMemo, useState } from 'react';
import Select, { components, type GroupBase, type MenuListProps, type StylesConfig } from 'react-select';
import { filterOptionsByQuery, normalizeFilterOptions, type FilterOption, type FilterOptionInput } from './filter-options';

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

type SelectGroup = GroupBase<FilterOption>;

function SearchMenuList(props: MenuListProps<FilterOption, true, SelectGroup> & { onSelectAll: () => void; canSelectAll: boolean }) {
  const { children, onSelectAll, canSelectAll } = props;
  return (
    <components.MenuList {...props}>
      {canSelectAll && (
        <button
          type="button"
          aria-label="全选当前搜索结果"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={onSelectAll}
          style={{
            display: 'block',
            width: '100%',
            border: 0,
            borderBottom: '1px solid #e5ebe7',
            background: '#f7faf8',
            color: '#2b7fa3',
            cursor: 'pointer',
            fontSize: 12,
            padding: '8px 12px',
            textAlign: 'left',
          }}
        >
          全选当前搜索结果
        </button>
      )}
      {children}
    </components.MenuList>
  );
}

const styles: StylesConfig<FilterOption, true, SelectGroup> = {
  control: (base, state) => ({
    ...base,
    minHeight: 34,
            borderColor: state.isFocused ? '#4a9cbe' : '#d8e2dc',
    borderRadius: 5,
            boxShadow: state.isFocused ? '0 0 0 3px #e1f0f6' : 'none',
            ':hover': { borderColor: '#4a9cbe' },
  }),
  valueContainer: (base) => ({ ...base, gap: 2, padding: '3px 8px' }),
        multiValue: (base) => ({ ...base, borderRadius: 4, backgroundColor: '#e5f2f7' }),
        multiValueLabel: (base) => ({ ...base, color: '#226b8a', fontSize: 11 }),
  multiValueRemove: (base) => ({
    ...base,
            color: '#3c7e9a',
            ':hover': { backgroundColor: '#d3eaf3', color: '#1e5874' },
  }),
  input: (base) => ({ ...base, fontSize: 12 }),
  placeholder: (base) => ({ ...base, color: '#8a9890', fontSize: 12 }),
  option: (base, state) => ({
    ...base,
    color: '#1d2a23',
    cursor: 'pointer',
    fontSize: 12,
            backgroundColor: state.isSelected ? '#e1f0f6' : state.isFocused ? '#f2f8fb' : '#fff',
            ':active': { backgroundColor: '#d7edf5' },
  }),
  menu: (base) => ({ ...base, zIndex: 20, borderRadius: 5, overflow: 'hidden' }),
  menuList: (base) => ({ ...base, padding: 0 }),
  noOptionsMessage: (base) => ({ ...base, color: '#7a8980', fontSize: 12, padding: '12px 8px' }),
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
  const [inputValue, setInputValue] = useState('');
  const normalizedOptions = useMemo(() => normalizeFilterOptions(options), [options]);
  const selectedOptions = useMemo(() => {
    const optionMap = new Map(normalizedOptions.map((option) => [option.value, option]));
    return value.map((item) => optionMap.get(item) ?? { value: item, label: item }).filter((option) => option.value);
  }, [normalizedOptions, value]);
  const visibleOptions = useMemo(() => filterOptionsByQuery(normalizedOptions, inputValue), [normalizedOptions, inputValue]);
  const selectedValues = useMemo(() => new Set(value), [value]);
  const canSelectAll = visibleOptions.length > 0 && visibleOptions.some((option) => !selectedValues.has(option.value));

  const selectAllVisible = () => {
    const next = [...value];
    for (const option of visibleOptions) {
      if (!selectedValues.has(option.value)) next.push(option.value);
    }
    onChange(next);
  };

  return (
    <div className={className}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={{ color: '#66756c', fontSize: 11, fontWeight: 500 }}>{label}</label>
        <span aria-live="polite" style={{ color: '#2b7fa3', fontSize: 10 }}>
          {value.length ? `已选 ${value.length}` : '未选择'}
        </span>
      </div>
      <Select<FilterOption, true, SelectGroup>
        aria-label={label}
        aria-live="polite"
        closeMenuOnSelect={false}
        components={{
          MenuList: (props) => <SearchMenuList {...props} onSelectAll={selectAllVisible} canSelectAll={canSelectAll} />,
        }}
        isClearable
        isDisabled={disabled}
        isMulti
        inputValue={inputValue}
        maxMenuHeight={maxMenuHeight}
        menuPlacement="auto"
        noOptionsMessage={() => (normalizedOptions.length ? noOptionsMessage : emptyMessage)}
        onChange={(next) => onChange(next.map((option) => option.value))}
        onInputChange={(next, meta) => {
          if (meta.action === 'input-change') setInputValue(next);
          if (meta.action === 'menu-close') setInputValue('');
          return next;
        }}
        options={visibleOptions}
        placeholder={placeholder}
        styles={styles}
        value={selectedOptions}
      />
    </div>
  );
}
