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
  typography: { fontFamily: string; titleSizeMm: number; metaSizeMm: number; customerSizeMm: number; bodySizeMm: number; fontWeight: number; lineHeight: number; align: 'left' | 'center' | 'right' };
  table: { borderWidthMm: number; borderStyle: 'solid' | 'dashed' | 'dotted'; borderColor: string; headerBackground: string; cellPaddingMm: number };
  columns: WorkOrderColumn[];
  header: { visible: boolean; kicker: string; showCustomer: boolean; showShipDate: boolean; showOrderCount: boolean };
  footer: { visible: boolean; text: string; showPageNumber: boolean };
  layout: { header: { x: number; y: number }; table: { x: number; y: number }; footer: { x: number; y: number } };
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

function normalizeVisibleColumnWidths(columns: WorkOrderColumn[]): WorkOrderColumn[] {
  const visible = columns.filter((column) => column.visible);
  if (!visible.length) return columns;
  const total = visible.reduce((sum, column) => sum + column.width, 0);
  if (!Number.isFinite(total) || total <= 0) return columns;
  const scaled = new Map(visible.map((column) => [column.id, clamp((column.width / total) * 100, column.width, 4, 60)] as const));
  let remaining = 100 - [...scaled.values()].reduce((sum, width) => sum + width, 0);
  for (let pass = 0; pass < visible.length * 2 && Math.abs(remaining) > 0.01; pass += 1) {
    const candidates = visible.filter((column) => {
      const width = scaled.get(column.id) ?? column.width;
      return remaining > 0 ? width < 60 : width > 4;
    });
    if (!candidates.length) break;
    const delta = remaining / candidates.length;
    candidates.forEach((column) => {
      const current = scaled.get(column.id) ?? column.width;
      const next = clamp(current + delta, current, 4, 60);
      scaled.set(column.id, next);
    });
    remaining = 100 - [...scaled.values()].reduce((sum, width) => sum + width, 0);
  }
  return columns.map((column) => scaled.has(column.id) ? { ...column, width: scaled.get(column.id)! } : column);
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function fontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 160 && !/[{};<>"']/.test(trimmed) ? trimmed : fallback;
}

export function createDefaultWorkOrderTemplate(): WorkOrderTemplate {
  return {
    version: 1,
    name: '默认加工单模板',
    title: '花束加工单',
    orientation: 'landscape',
    marginsMm: { top: 10, right: 12, bottom: 8, left: 12 },
    typography: { fontFamily: DEFAULT_FONT, titleSizeMm: 7, metaSizeMm: 2.5, customerSizeMm: 4, bodySizeMm: 2.8, fontWeight: 500, lineHeight: 1.35, align: 'left' },
    table: { borderWidthMm: 0.25, borderStyle: 'solid', borderColor: '#9bbdca', headerBackground: '#e8f3f7', cellPaddingMm: 2 },
    columns: columnDefaults.map((column) => ({ ...column })),
    header: { visible: true, kicker: '花众生产打印', showCustomer: true, showShipDate: true, showOrderCount: true },
    footer: { visible: true, text: '加工扎数取销售数量（扎），同花束按订单合并。', showPageNumber: true },
    layout: { header: { x: 0, y: 0 }, table: { x: 0, y: 0 }, footer: { x: 0, y: 0 } },
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
  const normalizedColumns = normalizeVisibleColumnWidths(columns);
  const margins = candidate.marginsMm ?? fallback.marginsMm;
  const typography = candidate.typography ?? fallback.typography;
  const table = candidate.table ?? fallback.table;
  const header = candidate.header ?? fallback.header;
  const footer = candidate.footer ?? fallback.footer;
  const layout = candidate.layout ?? fallback.layout;
  return {
    version: 1,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : fallback.name,
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : fallback.title,
    orientation: candidate.orientation === 'portrait' ? 'portrait' : 'landscape',
    marginsMm: { top: clamp(margins.top, fallback.marginsMm.top, 0, 40), right: clamp(margins.right, fallback.marginsMm.right, 0, 40), bottom: clamp(margins.bottom, fallback.marginsMm.bottom, 0, 40), left: clamp(margins.left, fallback.marginsMm.left, 0, 40) },
    typography: {
      fontFamily: fontFamily(typography.fontFamily, DEFAULT_FONT),
      titleSizeMm: clamp(typography.titleSizeMm, fallback.typography.titleSizeMm, 3, 15),
      metaSizeMm: clamp(typography.metaSizeMm, fallback.typography.metaSizeMm, 1.5, 8),
      customerSizeMm: clamp(typography.customerSizeMm, fallback.typography.customerSizeMm, 2, 12),
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
    columns: normalizedColumns,
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
    layout: {
      header: { x: clamp(layout.header?.x, 0, -10, 10), y: clamp(layout.header?.y, 0, -10, 10) },
      table: { x: clamp(layout.table?.x, 0, -10, 10), y: clamp(layout.table?.y, 0, -10, 10) },
      footer: { x: clamp(layout.footer?.x, 0, -10, 10), y: clamp(layout.footer?.y, 0, -10, 10) },
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
    '--wo-customer-size': `${template.typography.customerSizeMm}mm`,
  } as CSSProperties;
  const pageRule = `@page work-order-generated { size: A4 ${template.orientation}; margin: 0; }`;

  return (
    <article
      className={`work-order-document ${className ?? ''}`.trim()}
      data-template-name={template.name}
      style={{ ...contentStyle, page: 'work-order-generated', padding: `${template.marginsMm.top}mm ${template.marginsMm.right}mm ${template.marginsMm.bottom}mm ${template.marginsMm.left}mm` }}
    >
      <style>{`${pageRule}
        .work-order-document{background:#fff;box-sizing:border-box;color:#172022;font-family:var(--wo-font-family);font-size:var(--wo-body-size);font-weight:var(--wo-font-weight);height:${template.orientation === 'landscape' ? '210mm' : '297mm'};line-height:var(--wo-line-height);width:${template.orientation === 'landscape' ? '297mm' : '210mm'}}
        .work-order-document .wo-head{align-items:flex-end;border-bottom:calc(var(--wo-border-width) * 3) solid #2b7fa3;display:flex;justify-content:space-between;min-height:25mm;padding-bottom:3mm}
        .work-order-document .wo-kicker{color:#397f9d;font-size:2mm;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
        .work-order-document .wo-title{font-size:${template.typography.titleSizeMm}mm;line-height:1.1;margin:1.2mm 0 1.5mm;text-align:${template.typography.align}}
        .work-order-document .wo-meta{color:#596d75;font-size:${template.typography.metaSizeMm}mm;margin:0}.work-order-document .wo-meta b{color:#216986}.work-order-document .wo-meta .wo-customer{font-size:var(--wo-customer-size);font-weight:700}
        .work-order-document .wo-stat{color:#216986;text-align:right}.work-order-document .wo-stat strong{display:block;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:6mm;line-height:1}.work-order-document .wo-stat span{display:block;font-size:${template.typography.metaSizeMm}mm;margin-top:2mm}
        .work-order-document table{border-collapse:collapse;break-inside:auto;margin-top:5mm;table-layout:fixed;width:100%}.work-order-document thead{display:table-header-group}.work-order-document tr{break-inside:avoid;page-break-inside:avoid}.work-order-document th,.work-order-document td{border:var(--wo-border-width) var(--wo-border-style) var(--wo-border-color);padding:var(--wo-cell-padding);vertical-align:middle}.work-order-document th{background:var(--wo-header-bg);color:#405b66;font-size:calc(var(--wo-body-size) * .92);font-weight:700;height:9mm}.work-order-document .wo-repeat-customer{display:none}.work-order-document td{height:10mm}.work-order-document .wo-bouquet{background:#f1f8fb}.work-order-document .wo-bouquet strong,.work-order-document .wo-bouquet small{display:block}.work-order-document .wo-bouquet small{color:#2b7fa3;font-family:monospace;font-size:calc(var(--wo-body-size) * .85);font-weight:600;margin-top:1mm}.work-order-document .wo-index{color:#2b7fa3;font-weight:700}.work-order-document .wo-footer{border-top:var(--wo-border-width) solid #c6dbe3;color:#687f88;font-size:${template.typography.metaSizeMm}mm;margin-top:5mm;padding-top:3mm}.work-order-document .wo-page{float:right}.work-order-document .wo-page-number::after{content:counter(page)}@media print{.work-order-document{box-shadow:none;break-after:page;page-break-after:always}.work-order-document .wo-repeat-customer{display:table-row}.work-order-document .wo-repeat-customer th{background:#fff;border-left:0;border-right:0;color:#216986;font-size:calc(var(--wo-body-size) * .95);height:8mm;text-align:left}.work-order-document thead{display:table-header-group}}
      `}</style>
      {template.header.visible && (
        <header className="wo-head" style={{ transform: `translate(${template.layout.header.x}mm, ${template.layout.header.y}mm)` }}>
          <div>
            {template.header.kicker && <div className="wo-kicker">{template.header.kicker}</div>}
            <h1 className="wo-title">{template.title}</h1>
            <p className="wo-meta">
              {template.header.showCustomer && <>客户：<b className="wo-customer">{customerLabel(orders)}</b></>}
              {template.header.showCustomer && template.header.showShipDate && ' · '}
              {template.header.showShipDate && <>出货日期：<b>{dateLabel(orders, shipDateLabel)}</b></>}
            </p>
          </div>
          {template.header.showOrderCount && <div className="wo-stat"><strong>{totalQuantity} 扎</strong><span>{grouped.length} 款 · {orders.length} 单</span></div>}
        </header>
      )}
      <table aria-label={`${template.title}明细`} style={{ transform: `translate(${template.layout.table.x}mm, ${template.layout.table.y}mm)` }}>
        <colgroup>{visibleColumns.map((column) => <col key={column.id} style={{ width: `${column.width}%` }} />)}</colgroup>
        <thead><tr className="wo-repeat-customer"><th colSpan={visibleColumns.length}>客户：{customerLabel(orders)} · 出货日期：{dateLabel(orders, shipDateLabel)}</th></tr><tr>{visibleColumns.map((column) => <th key={column.id} scope="col" style={{ textAlign: column.align }}>{column.label}</th>)}</tr></thead>
        <tbody>{grouped.map((order, index) => <WorkOrderRow columns={visibleColumns} index={index} key={order.recordId} order={order} />)}</tbody>
      </table>
      {template.footer.visible && <footer className="wo-footer" style={{ transform: `translate(${template.layout.footer.x}mm, ${template.layout.footer.y}mm)` }}>{template.footer.text}{template.footer.showPageNumber && <span className="wo-page">第 <span className="wo-page-number" /> 页</span>}</footer>}
    </article>
  );
}
