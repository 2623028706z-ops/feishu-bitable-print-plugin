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
  copiesByQuantity: boolean;
  showName: boolean;
  showCode: boolean;
  showQuantity: boolean;
  showDate: boolean;
  showCustomer: boolean;
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
  copiesByQuantity: false,
  showName: true,
  showCode: true,
  showQuantity: true,
  showDate: true,
  showCustomer: true,
};

export const sampleOrders: PrintOrder[] = [
  {
    recordId: 'sample-1',
    orderNo: 'HZ-20260823-001',
    shipDate: '2026/08/24',
    customer: '天虹',
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

export function expandLabelCopies(orders: PrintOrder[], config: LabelConfig): PrintOrder[] {
  if (!config.copiesByQuantity) return orders;
  return orders.flatMap((order) =>
    Array.from({ length: Math.max(1, Math.round(order.quantity)) }, (_, index) => ({
      ...order,
      recordId: `${order.recordId}-copy-${index + 1}`,
    })),
  );
}
