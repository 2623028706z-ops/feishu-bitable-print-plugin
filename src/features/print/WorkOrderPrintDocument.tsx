import type { CSSProperties, ReactNode } from 'react';
import { aggregateOrders, type PrintOrder } from '../../lib/print-model';

export type WorkOrderColumnId = 'bouquet' | 'material' | 'bunchQuantity' | 'stemsPerBunch' | 'totalStems' | 'note';
export type WorkOrderColumn = {
  id: WorkOrderColumnId;
  label: string;
  width: number;
  visible: boolean;
  align: 'left' | 'center' | 'right';
  required: boolean;
};

export type WorkOrderTemplate = {
  version: 1;
  name: string;
  title: string;
  orientation: 'landscape' | 'portrait';
  marginsMm: { top: number; right: number; bottom: number; left: number };
  typography: { fontFamily: string; titleSizeMm: number; metaSizeMm: number; bodySizeMm: number; fontWeight: number; lineHeight: number; align: 'left' | 'center' | 'right' };
  table: { borderWidthMm: number; borderStyle: 'solid' | 'dashed' | 'dotted'; borderColor: string; headerBackground: string; cellPaddingMm: number };
  columns: WorkOrderColumn[];
  header: { visible: boolean; kicker: string; showCustomer: boolean; showShipDate: boolean; showOrderCount: boolean };
  footer: { visible: boolean; text: string; showPageNumber: boolean };
};

export type WorkOrderPrintDocumentProps = {
  orders: readonly PrintOrder[];
  template?: WorkOrderTemplate;
  className?: string;
  /** Used when a caller already applied its own date-selection label. */
  shipDateLabel?: string;
};

const columnDefaults: WorkOrderColumn[] = [
  { id: 'bouquet', label: '花束', width: 22, visible: true, align: 'left', required: true },
  { id: 'material', label: '花材', width: 22, visible: true, align: 'left', required: true },
  { id: 'bunchQuantity', label: '加工扎数', width: 14, visible: true, align: 'center', required: true },
  { id: 'stemsPerBunch', label: '单束用量', width: 14, visible: true, align: 'center', required: false },
  { id: 'totalStems', label: '总支数', width: 14, visible: true, align: 'center', required: false },
  { id: 'note', label: '备注', width: 14, visible: true, align: 'left', required: false },
];

const DEFAULT_FONT = 'Microsoft YaHei, 微软雅黑, PingFang SC, Arial, sans-serif';
const columnIds = new Set<WorkOrderColumnId>(columnDefaults.map((column) => column.id));

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function createDefaultWorkOrderTemplate(): WorkOrderTemplate {
  return {
    version: 1,
    name: '默认加工单模板',
    title: '花束加工单',
    orientation: 'landscape',
    marginsMm: { top: 10, right: 12, bottom: 8, left: 12 },
    typography: { fontFamily: DEFAULT_FONT, titleSizeMm: 7, metaSizeMm: 2.5, bodySizeMm: 2.8, fontWeight: 500, lineHeight: 1.35, align: 'left' },
    table: { borderWidthMm: 0.25, borderStyle: 'solid', borderColor: '#9da9a4', headerBackground: '#edf2ef', cellPaddingMm: 2 },
    columns: columnDefaults.map((column) => ({ ...column })),
    header: { visible: true, kicker: '花众生产打印', showCustomer: true, showShipDate: true, showOrderCount: true },
    footer: { visible: true, text: '加工扎数取销售数量（扎），同花束按订单合并。', showPageNumber: true },
  };
}

/** Repair incomplete local storage values without allowing a required BOM column to disappear. */
export function normalizeWorkOrderTemplate(value?: Partial<WorkOrderTemplate> | null): WorkOrderTemplate {
  const fallback = createDefaultWorkOrderTemplate();
  const candidate = value ?? {};
  const rawColumns = Array.isArray(candidate.columns) ? candidate.columns : fallback.columns;
  const byId = new Map<WorkOrderColumnId, Partial<WorkOrderColumn>>();
  for (const column of rawColumns) {
    if (column && columnIds.has(column.id as WorkOrderColumnId) && !byId.has(column.id as WorkOrderColumnId)) {
      byId.set(column.id as WorkOrderColumnId, column);
    }
  }
  const requestedOrder = rawColumns
    .map((column) => column?.id as WorkOrderColumnId)
    .filter((id, index, values) => columnIds.has(id) && values.indexOf(id) === index);
  const orderedIds = [...requestedOrder, ...columnDefaults.map((column) => column.id).filter((id) => !requestedOrder.includes(id))];
  const columns: WorkOrderColumn[] = orderedIds.map((id) => {
    const defaultColumn = columnDefaults.find((column) => column.id === id)!;
    const source = byId.get(id) ?? {};
    return {
      ...defaultColumn,
      label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : defaultColumn.label,
      width: clamp(source.width, defaultColumn.width, 4, 60),
      visible: defaultColumn.required ? true : source.visible !== false,
      align: (source.align === 'center' || source.align === 'right' ? source.align : 'left') as WorkOrderColumn['align'],
      required: defaultColumn.required,
    };
  });
  const margins = candidate.marginsMm ?? fallback.marginsMm;
  const typography = candidate.typography ?? fallback.typography;
  const table = candidate.table ?? fallback.table;
  const header = candidate.header ?? fallback.header;
  const footer = candidate.footer ?? fallback.footer;
  return {
    version: 1,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : fallback.name,
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : fallback.title,
    orientation: candidate.orientation === 'portrait' ? 'portrait' : 'landscape',
    marginsMm: { top: clamp(margins.top, fallback.marginsMm.top, 0, 40), right: clamp(margins.right, fallback.marginsMm.right, 0, 40), bottom: clamp(margins.bottom, fallback.marginsMm.bottom, 0, 40), left: clamp(margins.left, fallback.marginsMm.left, 0, 40) },
    typography: {
      fontFamily: typeof typography.fontFamily === 'string' && typography.fontFamily.trim() ? typography.fontFamily.trim() : DEFAULT_FONT,
      titleSizeMm: clamp(typography.titleSizeMm, fallback.typography.titleSizeMm, 3, 15),
      metaSizeMm: clamp(typography.metaSizeMm, fallback.typography.metaSizeMm, 1.5, 8),
      bodySizeMm: clamp(typography.bodySizeMm, fallback.typography.bodySizeMm, 1.5, 10),
      fontWeight: clamp(typography.fontWeight, fallback.typography.fontWeight, 100, 900),
      lineHeight: clamp(typography.lineHeight, fallback.typography.lineHeight, 0.8, 2.5),
      align: typography.align === 'center' || typography.align === 'right' ? typography.align : 'left',
    },
    table: {
      borderWidthMm: clamp(table.borderWidthMm, fallback.table.borderWidthMm, 0, 2),
      borderStyle: table.borderStyle === 'dashed' || table.borderStyle === 'dotted' ? table.borderStyle : 'solid',
      borderColor: color(table.borderColor, fallback.table.borderColor),
      headerBackground: color(table.headerBackground, fallback.table.headerBackground),
      cellPaddingMm: clamp(table.cellPaddingMm, fallback.table.cellPaddingMm, 0, 10),
    },
    columns,
    header: {
      visible: header.visible !== false,
      kicker: typeof header.kicker === 'string' ? header.kicker.trim() : fallback.header.kicker,
      showCustomer: header.showCustomer !== false,
      showShipDate: header.showShipDate !== false,
      showOrderCount: header.showOrderCount !== false,
    },
    footer: {
      visible: footer.visible !== false,
      text: typeof footer.text === 'string' ? footer.text.trim() : fallback.footer.text,
      showPageNumber: footer.showPageNumber !== false,
    },
  };
}

function customerLabel(orders: readonly PrintOrder[]) {
  const customers = [...new Set(orders.map((order) => order.customer.trim()).filter(Boolean))].sort();
  return customers.length === 0 ? '未填写客户' : customers.length === 1 ? customers[0] : `多个客户（${customers.length}）`;
}

function dateLabel(orders: readonly PrintOrder[], provided?: string) {
  if (provided) return provided;
  const dates = [...new Set(orders.map((order) => order.shipDate.trim()).filter(Boolean))].sort();
  return dates.length === 0 ? '未填写出货日期' : dates.length === 1 ? dates[0] : `${dates[0]} 至 ${dates[dates.length - 1]}`;
}

function tableValue(column: WorkOrderColumnId, order: PrintOrder, recipeIndex: number): ReactNode {
  const line = order.recipe[recipeIndex];
  if (column === 'bouquet') {
    return recipeIndex === 0 ? <><strong>{order.productName}</strong>{order.productCode && <small>{order.productCode}</small>}</> : null;
  }
  if (!line) return column === 'material' ? '未关联成品配方，请检查成品汇总表' : '—';
  if (column === 'material') return line.material;
  if (column === 'bunchQuantity') return `${order.quantity} 扎`;
  if (column === 'stemsPerBunch') return line.stemsPerBunch ? `${line.stemsPerBunch} ${line.unit}` : '—';
  if (column === 'totalStems') return line.totalStems || '—';
  return line.note || order.note || '';
}

function WorkOrderRow({ order, index, columns }: { order: PrintOrder; index: number; columns: WorkOrderColumn[] }) {
  const lines = order.recipe.length ? order.recipe : [null];
  return <>
    {lines.map((line, recipeIndex) => (
      <tr key={`${order.recordId}-${line?.material ?? 'missing'}-${recipeIndex}`}>
        {columns.map((column) => column.id === 'bouquet' && recipeIndex > 0 ? null : (
          <td
            className={column.id === 'bouquet' ? 'wo-bouquet' : undefined}
            key={column.id}
            rowSpan={column.id === 'bouquet' && lines.length > 1 ? lines.length : undefined}
            style={{ textAlign: column.align }}
          >
            {column.id === 'bouquet' ? <span className="wo-index">{index + 1}. </span> : null}
            {tableValue(column.id, order, recipeIndex)}
          </td>
        ))}
      </tr>
    ))}
  </>;
}

export function WorkOrderPrintDocument({ orders, template: rawTemplate, className, shipDateLabel }: WorkOrderPrintDocumentProps) {
  const template = normalizeWorkOrderTemplate(rawTemplate);
  const grouped = aggregateOrders(orders.filter((order) => order.quantity > 0));
  const totalQuantity = grouped.reduce((sum, order) => sum + order.quantity, 0);
  const visibleColumns = template.columns.filter((column) => column.visible);
  const contentStyle = {
    '--wo-border-color': template.table.borderColor,
    '--wo-border-style': template.table.borderStyle,
    '--wo-border-width': `${template.table.borderWidthMm}mm`,
    '--wo-body-size': `${template.typography.bodySizeMm}mm`,
    '--wo-cell-padding': `${template.table.cellPaddingMm}mm`,
    '--wo-font-family': template.typography.fontFamily,
    '--wo-font-weight': template.typography.fontWeight,
    '--wo-header-bg': template.table.headerBackground,
    '--wo-line-height': template.typography.lineHeight,
  } as CSSProperties;
  const pageRule = `@page work-order-generated { size: A4 ${template.orientation}; margin: 0; }`;

  return (
    <article
      className={`work-order-document ${className ?? ''}`.trim()}
      data-template-name={template.name}
      style={{ ...contentStyle, page: 'work-order-generated', padding: `${template.marginsMm.top}mm ${template.marginsMm.right}mm ${template.marginsMm.bottom}mm ${template.marginsMm.left}mm` }}
    >
      <style>{`${pageRule}
        .work-order-document{background:#fff;color:#172022;font-family:var(--wo-font-family);font-size:var(--wo-body-size);font-weight:var(--wo-font-weight);line-height:var(--wo-line-height);min-height:${template.orientation === 'landscape' ? '210mm' : '297mm'};width:${template.orientation === 'landscape' ? '297mm' : '210mm'}}
        .work-order-document .wo-head{align-items:flex-end;border-bottom:calc(var(--wo-border-width) * 3) solid #345b50;display:flex;justify-content:space-between;min-height:25mm;padding-bottom:3mm}
        .work-order-document .wo-kicker{color:#567d71;font-size:2mm;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
        .work-order-document .wo-title{font-size:${template.typography.titleSizeMm}mm;line-height:1.1;margin:1.2mm 0 1.5mm;text-align:${template.typography.align}}
        .work-order-document .wo-meta{color:#596562;font-size:${template.typography.metaSizeMm}mm;margin:0}.work-order-document .wo-meta b{color:#274f43}
        .work-order-document .wo-stat{color:#274f43;text-align:right}.work-order-document .wo-stat strong{display:block;font-family:Georgia,serif;font-size:6mm;line-height:1}.work-order-document .wo-stat span{display:block;font-size:${template.typography.metaSizeMm}mm;margin-top:2mm}
        .work-order-document table{border-collapse:collapse;margin-top:5mm;table-layout:fixed;width:100%}.work-order-document th,.work-order-document td{border:var(--wo-border-width) var(--wo-border-style) var(--wo-border-color);padding:var(--wo-cell-padding);vertical-align:middle}.work-order-document th{background:var(--wo-header-bg);color:#45534f;font-size:calc(var(--wo-body-size) * .92);font-weight:700;height:9mm}.work-order-document td{height:10mm}.work-order-document .wo-bouquet{background:#f4f7f5}.work-order-document .wo-bouquet strong,.work-order-document .wo-bouquet small{display:block}.work-order-document .wo-bouquet small{color:#176b54;font-family:monospace;font-size:calc(var(--wo-body-size) * .85);font-weight:600;margin-top:1mm}.work-order-document .wo-index{color:#176b54;font-weight:700}.work-order-document .wo-footer{border-top:var(--wo-border-width) solid #ccd3d0;color:#687172;font-size:${template.typography.metaSizeMm}mm;margin-top:5mm;padding-top:3mm}.work-order-document .wo-page{float:right}@media print{.work-order-document{box-shadow:none;break-after:page}.work-order-document thead{display:table-header-group}}
      `}</style>
      {template.header.visible && (
        <header className="wo-head">
          <div>
            {template.header.kicker && <div className="wo-kicker">{template.header.kicker}</div>}
            <h1 className="wo-title">{template.title}</h1>
            <p className="wo-meta">
              {template.header.showCustomer && <>客户：<b>{customerLabel(orders)}</b></>}
              {template.header.showCustomer && template.header.showShipDate && ' · '}
              {template.header.showShipDate && <>出货日期：<b>{dateLabel(orders, shipDateLabel)}</b></>}
            </p>
          </div>
          {template.header.showOrderCount && <div className="wo-stat"><strong>{totalQuantity} 扎</strong><span>{grouped.length} 款 · {orders.length} 单</span></div>}
        </header>
      )}
      <table aria-label={`${template.title}明细`}>
        <colgroup>{visibleColumns.map((column) => <col key={column.id} style={{ width: `${column.width}%` }} />)}</colgroup>
        <thead><tr>{visibleColumns.map((column) => <th key={column.id} scope="col" style={{ textAlign: column.align }}>{column.label}</th>)}</tr></thead>
        <tbody>{grouped.map((order, index) => <WorkOrderRow columns={visibleColumns} index={index} key={order.recordId} order={order} />)}</tbody>
      </table>
      {template.footer.visible && <footer className="wo-footer">{template.footer.text}{template.footer.showPageNumber && <span className="wo-page">第 1 页</span>}</footer>}
    </article>
  );
}
