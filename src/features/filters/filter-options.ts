export type FilterOption = {
  value: string;
  label: string;
};

export type FilterOptionInput = FilterOption | string;

/** Normalize values coming from Feishu fields or local filter state. */
export function normalizeFilterOptions(options: readonly FilterOptionInput[]): FilterOption[] {
  const seen = new Set<string>();

  return options.reduce<FilterOption[]>((result, option) => {
    const value = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    const normalizedValue = value.trim();
    const normalizedLabel = label.trim() || normalizedValue;
    if (!normalizedValue || seen.has(normalizedValue)) return result;

    seen.add(normalizedValue);
    result.push({ value: normalizedValue, label: normalizedLabel });
    return result;
  }, []);
}

export function filterOptionsByQuery(options: readonly FilterOption[], query: string): FilterOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...options];
  return options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery) || option.value.toLocaleLowerCase().includes(normalizedQuery));
}
