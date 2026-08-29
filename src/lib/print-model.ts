export type PrintIssue = 'missing-code' | 'missing-quantity' | 'missing-recipe';

export type RecipeLine = {
  material: string;
  stemsPerBunch: number;
  unit: string;
  totalStems: number;
  note: string;
};

export type PrintOrder = {
  recordId: string;
  orderNo: string;
  shipDate: string;
  customer: string;
  category: string;
  careInstructions: string;
  productName: string;
  productCode: string;
  quantity: number;
  note: string;
  recipe: RecipeLine[];
  issues: PrintIssue[];
};

export type LabelRotation = 0 | 90 | 180 | 270;
export type LabelPrinterFeed = 'landscape' | 'portrait';

export type LabelConfig = {
  width: number;
  height: number;
  printerFeed: LabelPrinterFeed;
  /** @deprecated Kept only to migrate older saved settings. */
  printRotation: LabelRotation;
  columns: number;
  rows: number;
  gapX: number;
  gapY: number;
  marginX: number;
  marginY: number;
  padding: number;
  contentGap: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  labelDateOffsetDays: number;
  copiesByQuantity: boolean;
  showName: boolean;
  showCode: boolean;
  showDate: boolean;
  showCustomer: boolean;
  showCareInstructions: boolean;
};

/**
 * Physical page geometry for roll/single-label printing.
 *
 * The editor still keeps grid fields for backwards-compatible templates, but
 * those fields must never change the physical page size of a label print job.
 */
export function labelPrintPageMetrics(config: Pick<LabelConfig, 'width' | 'height'> & Partial<Pick<LabelConfig, 'printerFeed'>>) {
  const layout = labelPrintLayout(config);
  return {
    widthMm: layout.pageW,
    heightMm: layout.pageH,
    orientation: layout.pageW >= layout.pageH ? 'landscape' : 'portrait',
    columns: 1,
    rows: 1,
    gapXmm: 0,
    gapYmm: 0,
    marginXmm: 0,
    marginYmm: 0,
  } as const;
}

export function labelPrintPageStyle(config: Pick<LabelConfig, 'width' | 'height'> & Partial<Pick<LabelConfig, 'printerFeed' | 'printRotation'>>): string {
  // @page uses the rotated physical page. The print root is reset to auto size
  // while the cloned preview canvas and sheets are locked to physical millimetres.
  const layout = labelPrintLayout(config);
  const width = `${layout.pageW}mm`;
  const height = `${layout.pageH}mm`;
  const cardWidth = `${layout.cardW}mm`;
  const cardHeight = `${layout.cardH}mm`;
  const size = `${width} ${height}`;
  return [
    // The sheet uses a named page context. Define both named and unnamed rules:
    // Chromium applies the named rule when `.label-sheet { page: label-sheet-page }`
    // is present, while the unnamed rule keeps direct/legacy print paths working.
    `@page { size: ${size}; margin: 0; }`,
    `@page label-sheet-page { size: ${size}; margin: 0; }`,
    `@media print { @page { size: ${size}; margin: 0; } @page label-sheet-page { size: ${size}; margin: 0; } }`,
    `html, body { width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }`,
    `.preview-canvas { display: block !important; width: ${width} !important; min-width: ${width} !important; max-width: ${width} !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }`,
    `.label-sheet { width: ${width} !important; min-width: ${width} !important; max-width: ${width} !important; height: ${height} !important; min-height: ${height} !important; max-height: ${height} !important; box-sizing: border-box !important; }`,
    `.label-card { width: ${cardWidth} !important; height: ${cardHeight} !important; box-sizing: border-box !important; }`,
  ].join(' ');
}

export function normalizeLabelPrinterFeed(config: Pick<LabelConfig, 'width' | 'height'> & {
  printerFeed?: unknown;
  printRotation?: unknown;
}): LabelPrinterFeed {
  if (config.printerFeed === 'landscape' || config.printerFeed === 'portrait') return config.printerFeed;
  // The old 90/270 setting produced mismatched paper sizes. Do not carry that
  // broken behavior into the new explicit output-direction setting.
  return config.width >= config.height ? 'landscape' : 'portrait';
}

/**
 * 标签内容始终按 width×height 设计并铺满该 card。只有明确选择了不同的
 * 标签机进纸方向时，才交换物理页面宽高并旋转整张 card；旋转本身不参与缩放。
 * printRotation 仅为旧配置保留，新的 UI 不再写入 90/270。
 */
export function labelPrintLayout(config: Pick<LabelConfig, 'width' | 'height'> & Partial<Pick<LabelConfig, 'printerFeed' | 'printRotation'>>) {
  const w = config.width;
  const h = config.height;
  const designFeed: LabelPrinterFeed = w >= h ? 'landscape' : 'portrait';
  const legacyRotation = ([0, 90, 180, 270] as number[]).includes(Number(config.printRotation))
    ? Number(config.printRotation) as LabelRotation
    : 0;
  const feed = normalizeLabelPrinterFeed(config);
  // A feed direction mismatch rotates the complete design card, but never scales it.
  if (feed !== designFeed) {
    const transform = feed === 'portrait'
      ? `translateX(${h}mm) rotate(90deg)`
      : `translateY(${w}mm) rotate(270deg)`;
    return { pageW: h, pageH: w, cardW: w, cardH: h, transform, rotation: feed === 'portrait' ? 90 as const : 270 as const, printerFeed: feed };
  }
  const contentRotation = legacyRotation === 180 ? 180 : 0;
  const transform = contentRotation === 180 ? `translate(${w}mm, ${h}mm) rotate(180deg)` : 'none';
  return { pageW: w, pageH: h, cardW: w, cardH: h, transform, rotation: contentRotation, printerFeed: feed };
}

export type DateFilterMode = 'all' | 'exact' | 'range' | 'offset';

export type PrintFilter = {
  customers: string[];
  categories: string[];
  products: string[];
  dateMode: DateFilterMode;
  exactDate: string;
  startDate: string;
  endDate: string;
  baseDate: string;
  offsetDays: number;
  quantityMode: 'order' | 'custom';
  customQuantity: number;
};

export const defaultPrintFilter: PrintFilter = {
  customers: [],
  categories: [],
  products: [],
  dateMode: 'all',
  exactDate: '',
  startDate: '',
  endDate: '',
  baseDate: '',
  offsetDays: 2,
  quantityMode: 'order',
  customQuantity: 1,
};

export const defaultLabelConfig: LabelConfig = {
  width: 50,
  height: 30,
  // A 50×30 label is normally fed horizontally. Missing legacy settings are
  // normalized from this design orientation in App.readLabelConfigMemory.
  printerFeed: 'landscape',
  printRotation: 0,
  columns: 1,
  rows: 1,
  gapX: 0,
  gapY: 0,
  marginX: 0,
  marginY: 0,
  padding: 2.2,
  contentGap: 0.5,
  fontFamily: 'Microsoft YaHei, 微软雅黑, sans-serif',
  fontSize: 3.2,
  fontWeight: 600,
  textAlign: 'center',
  lineHeight: 1.2,
  labelDateOffsetDays: 0,
  copiesByQuantity: false,
  showName: true,
  showCode: true,
  showDate: true,
  showCustomer: true,
  showCareInstructions: false,
};

export const sampleOrders: PrintOrder[] = [
  {
    recordId: 'sample-1',
    orderNo: 'HZ-20260823-001',
    shipDate: '2026/08/24',
    customer: '天虹',
    category: '鲜花花束',
    careInstructions: '避免阳光直射，保持花泥湿润',
    productName: '云间甜梦玫瑰混搭花束',
    productCode: '2020016014883',
    quantity: 12,
    note: '华南生鲜仓',
    recipe: [
      { material: '玫瑰', stemsPerBunch: 6, unit: '支', totalStems: 72, note: '' },
      { material: '尤加利叶', stemsPerBunch: 3, unit: '支', totalStems: 36, note: '' },
    ],
    issues: [],
  },
  {
    recordId: 'sample-2',
    orderNo: 'HZ-20260823-002',
    shipDate: '2026/08/24',
    customer: '天虹',
    category: '鲜花花束',
    careInstructions: '远离空调风口，保持环境通风',
    productName: '彩虹系列单头康乃馨随机色',
    productCode: '2020016014107',
    quantity: 8,
    note: '',
    recipe: [
      { material: '单头康乃馨', stemsPerBunch: 10, unit: '支', totalStems: 80, note: '随机配色' },
    ],
    issues: [],
  },
];

export function issueLabel(issue: PrintIssue): string {
  return {
    'missing-code': '缺少花束编码',
    'missing-quantity': '销售数量无效',
    'missing-recipe': '未关联成品配方',
  }[issue];
}

export function aggregateOrders(orders: PrintOrder[]): PrintOrder[] {
  const byProduct = new Map<string, PrintOrder>();
  for (const order of orders) {
    const key = order.productCode || order.productName;
    const existing = byProduct.get(key);
    if (!existing) {
      byProduct.set(key, { ...order, recipe: order.recipe.map((line) => ({ ...line })) });
      continue;
    }
    existing.quantity += order.quantity;
    for (const line of order.recipe) {
      const existingLine = existing.recipe.find((item) => item.material === line.material);
      if (existingLine) existingLine.totalStems += line.totalStems;
      else existing.recipe.push({ ...line });
    }
  }
  return [...byProduct.values()];
}

/** Keeps加工单 separate by the business context that must appear in its header. */
export function groupOrdersForWorkOrders(orders: PrintOrder[]): PrintOrder[][] {
  const groups = new Map<string, PrintOrder[]>();
  for (const order of orders.filter((item) => item.quantity > 0)) {
    const key = `${order.customer.trim() || '未填写客户'}\u0000${order.shipDate.trim() || '未填写出货日期'}`;
    const group = groups.get(key) ?? [];
    group.push(order);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function expandLabelCopies(orders: PrintOrder[], config: LabelConfig, customCopies?: number): PrintOrder[] {
  if (customCopies !== undefined) {
    const copies = Math.max(0, Math.round(customCopies));
    return orders.flatMap((order) => Array.from({ length: copies }, (_, index) => ({ ...order, recordId: `${order.recordId}-custom-${index + 1}` })));
  }
  if (!config.copiesByQuantity) return orders;
  return orders.flatMap((order) =>
    Array.from({ length: Math.max(1, Math.round(order.quantity)) }, (_, index) => ({
      ...order,
      recordId: `${order.recordId}-copy-${index + 1}`,
    })),
  );
}

function dateKey(value: string): string {
  const match = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

export function formatDateDisplay(value: string): string {
  const key = dateKey(value);
  if (!key) return value || '';
  const [year, month, day] = key.split('-');
  return `${year}/${month}/${day}`;
}

/** Returns a human-readable date context for the current print selection. */
export function formatSelectedDateRange(filter: PrintFilter, orders: PrintOrder[] = []): string {
  if (filter.dateMode === 'exact') return filter.exactDate ? formatDateDisplay(filter.exactDate) : '未选择日期';
  if (filter.dateMode === 'offset') {
    const target = shiftDate(filter.baseDate, Math.max(0, Math.round(filter.offsetDays)));
    return target ? formatDateDisplay(target) : '未选择日期';
  }
  if (filter.dateMode === 'range') {
    const start = filter.startDate ? formatDateDisplay(filter.startDate) : '开始日期';
    const end = filter.endDate ? formatDateDisplay(filter.endDate) : '结束日期';
    return start === end ? start : `${start} 至 ${end}`;
  }
  const dates = [...new Set(orders.map((order) => dateKey(order.shipDate)).filter(Boolean))].sort();
  if (!dates.length) return '全部日期';
  const first = formatDateDisplay(dates[0]);
  const last = formatDateDisplay(dates[dates.length - 1]);
  return first === last ? first : `${first} 至 ${last}`;
}

export function splitCategoryValues(value: string): string[] {
  return value
    .normalize('NFKC')
    .split(/[、,，;/；|｜\n\r\t]+/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function selectedCategorySet(values: string[]): Set<string> {
  return new Set(values.flatMap(splitCategoryValues));
}

function shiftDate(value: string, days: number): string {
  const match = value.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  const separator = match ? value.includes('/') ? '/' : '-' : '-';
  return `${date.getFullYear()}${separator}${String(date.getMonth() + 1).padStart(2, '0')}${separator}${String(date.getDate()).padStart(2, '0')}`;
}

export function adjustPrintDate(value: string, days: number): string {
  return shiftDate(value, Math.round(days)) || value;
}

export function filterOrders(orders: PrintOrder[], filter: PrintFilter): PrintOrder[] {
  const customers = new Set(filter.customers);
  const categories = selectedCategorySet(filter.categories);
  const products = new Set(filter.products);
  let targetDate = '';
  if (filter.dateMode === 'exact') targetDate = dateKey(filter.exactDate);
  if (filter.dateMode === 'offset') targetDate = shiftDate(filter.baseDate, Math.max(0, Math.round(filter.offsetDays)));
  const start = dateKey(filter.startDate);
  const end = dateKey(filter.endDate);

  return orders.filter((order) => {
    if (customers.size && !customers.has(order.customer)) return false;
    if (categories.size) {
      const orderCategories = splitCategoryValues(order.category);
      if (!orderCategories.some((category) => categories.has(category))) return false;
    }
    if (products.size && !products.has(order.productName)) return false;
    const orderDate = dateKey(order.shipDate);
    if (filter.dateMode === 'exact' || filter.dateMode === 'offset') return Boolean(targetDate && orderDate === targetDate);
    if (filter.dateMode === 'range') return Boolean(start && end && orderDate >= start && orderDate <= end);
    return true;
  });
}

export function applyQuantityFilter(orders: PrintOrder[], filter: PrintFilter): PrintOrder[] {
  if (filter.quantityMode === 'order') return orders;
  const quantity = Math.max(0, Math.round(filter.customQuantity || 0));
  return orders.map((order) => ({ ...order, quantity }));
}
