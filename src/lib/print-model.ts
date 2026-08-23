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

export type LabelConfig = {
  width: number;
  height: number;
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
  copiesByQuantity: boolean;
  showName: boolean;
  showCode: boolean;
  showDate: boolean;
  showCustomer: boolean;
  showCareInstructions: boolean;
};

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
  columns: 2,
  rows: 8,
  gapX: 2,
  gapY: 2,
  marginX: 5,
  marginY: 5,
  padding: 2.2,
  contentGap: 0.5,
  fontFamily: 'Microsoft YaHei, 微软雅黑, sans-serif',
  fontSize: 3.2,
  fontWeight: 600,
  textAlign: 'center',
  lineHeight: 1.2,
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

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterOrders(orders: PrintOrder[], filter: PrintFilter): PrintOrder[] {
  const customers = new Set(filter.customers);
  const categories = new Set(filter.categories);
  const products = new Set(filter.products);
  let targetDate = '';
  if (filter.dateMode === 'exact') targetDate = dateKey(filter.exactDate);
  if (filter.dateMode === 'offset') targetDate = shiftDate(filter.baseDate, Math.max(0, Math.round(filter.offsetDays)));
  const start = dateKey(filter.startDate);
  const end = dateKey(filter.endDate);

  return orders.filter((order) => {
    if (customers.size && !customers.has(order.customer)) return false;
    if (categories.size && !categories.has(order.category)) return false;
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
