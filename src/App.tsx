import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertTriangle, Barcode, Check, FileText, LayoutGrid, LoaderCircle, Printer, RefreshCw, Save, SearchX, Settings2 } from 'lucide-react';
import { bitable } from '@lark-base-open/js-sdk';
import { useReactToPrint } from 'react-to-print';
import { adjustPrintDate, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, formatSelectedDateRange, groupOrdersForWorkOrders, issueLabel, sampleOrders, splitCategoryValues, type LabelConfig, type PrintFilter, type PrintOrder } from './lib/print-model';
import { loadFeishuOrders } from './lib/feishu-adapter';
import { SearchMultiSelect } from './features/filters/SearchMultiSelect';
const LabelLayoutEditor = lazy(() => import('./features/templates/LabelLayoutEditor').then((module) => ({ default: module.LabelLayoutEditor })));
import { createDefaultTemplate, migrateTemplateConfig, type A4Template, type LabelTemplate } from './domain/templates';
import { clampFixedCopies, limitPreviewItems, MAX_TOTAL_PRINT_ITEMS, validatePrintTotal } from './domain/print-safety';
import { WorkOrderEditor } from './features/work-order/WorkOrderEditor';
import { WorkOrderPrintDocument, createDefaultWorkOrderTemplate, type WorkOrderTemplate } from './features/print/WorkOrderPrintDocument';
import { createTemplateRepository, TemplateConflictError, TemplatePermissionError } from './infrastructure/template-repository';
import { OperationTimeoutError, retry, withTimeout } from './lib/retry';

type Mode = 'label' | 'work-order';
const MODE_STORAGE_KEY = 'huazhong-print-mode';
const FILTER_STORAGE_KEY = 'huazhong-print-filter';
const CONFIG_STORAGE_KEY = 'huazhong-label-config';
const LABEL_TEMPLATE_STORAGE_KEY = 'huazhong-label-template';
const WORK_TEMPLATE_STORAGE_KEY = 'huazhong-work-template';

function storageGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function storageSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* Feishu iframe storage can be unavailable. */ }
}

function readMemory<T>(key: string, fallback: T): T {
  try {
    const value = storageGet(key);
    return value ? { ...fallback as object, ...JSON.parse(value) } as T : fallback;
  } catch {
    return fallback;
  }
}

function configFromTemplate(template: LabelTemplate): LabelConfig {
  const visible = (kind: string, fallback: boolean) => template.elements.find((element) => element.kind === kind)?.visible ?? fallback;
  return { ...defaultLabelConfig, width: template.paper.widthMm, height: template.paper.heightMm, columns: template.grid.columns, rows: template.grid.rows, gapX: template.grid.gapXmm, gapY: template.grid.gapYmm, marginX: template.grid.marginXmm, marginY: template.grid.marginYmm, padding: template.padding, contentGap: template.contentGap, fontFamily: template.fontFamily, fontSize: template.fontSize, fontWeight: template.fontWeight, textAlign: template.textAlign, lineHeight: template.lineHeight, labelDateOffsetDays: template.labelDateOffsetDays, copiesByQuantity: template.copiesByQuantity, showName: visible('name', template.showName), showCode: visible('barcode', template.showCode) && visible('code', template.showCode), showDate: visible('date', template.showDate), showCustomer: visible('customer', template.showCustomer), showCareInstructions: visible('careInstructions', template.showCareInstructions) };
}

function templateFromConfig(config: LabelConfig, current: LabelTemplate): LabelTemplate {
  const visibility: Record<string, boolean> = { name: config.showName, barcode: config.showCode, code: config.showCode, date: config.showDate, customer: config.showCustomer, careInstructions: config.showCareInstructions, care: config.showCareInstructions };
  return migrateTemplateConfig({ ...current, paper: { widthMm: config.width, heightMm: config.height }, grid: { columns: config.columns, rows: config.rows, gapXmm: config.gapX, gapYmm: config.gapY, marginXmm: config.marginX, marginYmm: config.marginY }, elements: current.elements.map((element) => ({ ...element, visible: visibility[element.kind] ?? element.visible })), styles: { ...current.styles, fontFamily: config.fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, align: config.textAlign, lineHeight: config.lineHeight, padding: config.padding, contentGap: config.contentGap }, labelDateOffsetDays: config.labelDateOffsetDays, copiesByQuantity: config.copiesByQuantity, showName: config.showName, showCode: config.showCode, showDate: config.showDate, showCustomer: config.showCustomer, showCareInstructions: config.showCareInstructions }, 'label');
}

function workFromSharedTemplate(template: A4Template): WorkOrderTemplate {
  const fallback = createDefaultWorkOrderTemplate();
  const presentation = template.presentation;
  return { ...fallback, name: template.name, title: template.title, orientation: template.orientation, marginsMm: { top: template.margins.top, right: template.margins.right, bottom: template.margins.bottom, left: template.margins.left }, typography: { ...fallback.typography, fontFamily: template.fontFamily, titleSizeMm: presentation?.titleSizeMm ?? fallback.typography.titleSizeMm, metaSizeMm: presentation?.metaSizeMm ?? fallback.typography.metaSizeMm, customerSizeMm: presentation?.customerSizeMm ?? fallback.typography.customerSizeMm, bodySizeMm: template.fontSize, fontWeight: template.fontWeight, lineHeight: presentation?.lineHeight ?? fallback.typography.lineHeight, align: template.textAlign }, table: { ...fallback.table, borderWidthMm: template.borderWidth, borderStyle: template.borderStyle, borderColor: template.borderColor, headerBackground: presentation?.headerBackground ?? fallback.table.headerBackground, cellPaddingMm: presentation?.cellPaddingMm ?? fallback.table.cellPaddingMm }, header: { ...fallback.header, visible: template.headerVisible, kicker: presentation?.kicker ?? fallback.header.kicker, showCustomer: presentation?.showCustomer ?? template.titleVisible, showShipDate: presentation?.showShipDate ?? fallback.header.showShipDate, showOrderCount: presentation?.showOrderCount ?? fallback.header.showOrderCount }, footer: { ...fallback.footer, visible: template.footerVisible, text: presentation?.footerText ?? fallback.footer.text, showPageNumber: presentation?.showPageNumber ?? fallback.footer.showPageNumber }, columns: template.columns.map((column) => ({ id: (column.id === 'quantity' ? 'bunchQuantity' : column.id) as WorkOrderTemplate['columns'][number]['id'], label: column.label, width: column.width, visible: column.visible, align: column.align, required: column.id === 'bouquet' || column.id === 'material' || column.id === 'quantity' || column.id === 'bunchQuantity' })) };
}

function sharedTemplateFromWork(template: WorkOrderTemplate, current: A4Template): A4Template {
  return migrateTemplateConfig({ ...current, name: template.name, title: template.title, orientation: template.orientation, margins: template.marginsMm, fontFamily: template.typography.fontFamily, fontSize: template.typography.bodySizeMm, fontWeight: template.typography.fontWeight, textAlign: template.typography.align, borderVisible: template.table.borderWidthMm > 0, borderWidth: template.table.borderWidthMm, borderStyle: template.table.borderStyle, borderColor: template.table.borderColor, titleVisible: template.header.showCustomer, headerVisible: template.header.visible, footerVisible: template.footer.visible, presentation: { ...(current.presentation ?? {}), kicker: template.header.kicker, showCustomer: template.header.showCustomer, showShipDate: template.header.showShipDate, showOrderCount: template.header.showOrderCount, footerText: template.footer.text, showPageNumber: template.footer.showPageNumber, titleSizeMm: template.typography.titleSizeMm, metaSizeMm: template.typography.metaSizeMm, customerSizeMm: template.typography.customerSizeMm, lineHeight: template.typography.lineHeight, cellPaddingMm: template.table.cellPaddingMm, headerBackground: template.table.headerBackground }, columns: template.columns.map((column) => ({ id: column.id, label: column.label, width: column.width, visible: column.visible, align: column.align })) }, 'a4');
}

const barcodeDataUriCache = new Map<string, string>();

function barcodeDataUri(value: string): string {
  const cached = barcodeDataUriCache.get(value);
  if (cached) return cached;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  JsBarcode(svg, value, { format: 'CODE128', displayValue: false, margin: 0, height: 34, width: 1.25 });
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
  barcodeDataUriCache.set(value, uri);
  return uri;
}

function BarcodeView({ value }: { value: string }) {
  return <img src={barcodeDataUri(value)} className="barcode" alt={`条码 ${value}`} />;
}

function IssueSummary({ orders, mode }: { orders: PrintOrder[]; mode: Mode }) {
  if (!orders.length) return <div className="empty-status"><span>0</span> 当前筛选没有可打印订单</div>;
  const issues = orders.flatMap((order) => order.issues
    .filter((issue) => mode === 'work-order' || issue !== 'missing-recipe')
    .map((issue) => `${order.productName}：${issueLabel(issue)}`));
  if (!issues.length) return <div className="clean-status"><Check size={15} /> 数据完整，可生成打印预览</div>;
  return <div className="issue-box"><AlertTriangle size={16} /><div><strong>{issues.length} 项数据需要确认</strong><div>{issues.slice(0, 3).join('；')}{issues.length > 3 ? '…' : ''}</div></div></div>;
}

function LabelSheet({ orders, config, template }: { orders: PrintOrder[]; config: LabelConfig; template?: LabelTemplate }) {
  const labels = expandLabelCopies(orders.filter((order) => order.quantity > 0), config);
  const pageSize = Math.max(1, config.rows * config.columns);
  const { sheetWidth, sheetHeight } = labelSheetMetrics(config);
  const style = { '--label-width': `${config.width}mm`, '--label-height': `${config.height}mm`, '--sheet-width': `${sheetWidth}mm`, '--sheet-height': `${sheetHeight}mm`, '--gap-x': `${config.gapX}mm`, '--gap-y': `${config.gapY}mm`, '--margin-x': `${config.marginX}mm`, '--margin-y': `${config.marginY}mm`, '--label-columns': config.columns, '--label-rows': config.rows, '--label-font-family': config.fontFamily, '--label-font-size': `${config.fontSize}mm`, '--label-code-size': `${Math.max(1.4, config.fontSize * 0.68)}mm`, '--label-meta-size': `${Math.max(1.2, config.fontSize * 0.58)}mm`, '--label-customer-size': `${Math.max(1.1, config.fontSize * 0.54)}mm`, '--label-care-size': `${Math.max(1, config.fontSize * 0.5)}mm`, '--label-font-weight': config.fontWeight, '--label-align': config.textAlign, '--label-padding': `${config.padding}mm`, '--label-content-gap': `${config.contentGap}mm`, '--label-line-height': config.lineHeight } as CSSProperties;
  const pageCount = Math.max(1, Math.ceil(labels.length / pageSize));
  return <>{Array.from({ length: pageCount }, (_, pageIndex) => <div className={`print-surface label-sheet${pageIndex < pageCount - 1 ? ' label-page-break' : ''}`} style={style} key={`label-page-${pageIndex}`}>
    {labels.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((order) => <div className="label-card" key={order.recordId}>
      {template ? template.elements.filter((element) => element.visible).map((element) => {
        const style = { position: 'absolute', left: `${element.x}mm`, top: `${element.y}mm`, width: `${element.width}mm`, height: `${element.height}mm`, fontFamily: element.fontFamily ?? template.fontFamily, fontSize: `${element.fontSizeMm ?? template.fontSize}mm`, fontWeight: element.fontWeight ?? template.fontWeight, textAlign: element.textAlign ?? element.align ?? template.textAlign, lineHeight: element.kind === 'careInstructions' || element.kind === 'care' ? template.lineHeight : 1.1 } as CSSProperties;
        if (element.kind === 'barcode') return order.productCode ? <div key={element.id} style={style}><BarcodeView value={order.productCode} /></div> : null;
        const text = element.kind === 'name' ? order.productName : element.kind === 'code' ? order.productCode : element.kind === 'date' ? (order.shipDate ? adjustPrintDate(order.shipDate, template.labelDateOffsetDays) : '未填写日期') : element.kind === 'customer' ? order.customer : order.careInstructions;
        return <div key={element.id} style={style}>{text || ''}</div>;
      }) : <>
        {config.showName && <div className="label-name">{order.productName}</div>}
        {config.showCode && order.productCode ? <><BarcodeView value={order.productCode} /><div className="label-code">{order.productCode}</div></> : <div className="label-missing">未设置花束编码</div>}
        {config.showDate && <div className="label-meta"><span>{order.shipDate ? adjustPrintDate(order.shipDate, config.labelDateOffsetDays) : '未填写日期'}</span></div>}
        {config.showCustomer && <div className="label-customer">{order.customer || '未填写客户'}</div>}
        {config.showCareInstructions && order.careInstructions && <div className="label-care">{order.careInstructions}</div>}
      </>}
    </div>)}
  </div>)}</>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><input type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>;
}

function EmptyPreview() {
  return <div className="empty-preview"><span><SearchX size={22} /></span><strong>没有匹配的订单</strong><p>调整客户、花束或出货日期筛选后再打印</p></div>;
}

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isEmbeddedFeishuHost(): boolean {
  try { return window.top !== window.self; } catch { return true; }
}

function previewModeRequested(): boolean {
  try { return new URLSearchParams(window.location.search).get('preview') === '1'; } catch { return false; }
}

function previewOrdersForToday(): PrintOrder[] {
  const today = todayInput().replace(/-/g, '/');
  return sampleOrders.map((order, index) => ({ ...order, recordId: `preview-${index + 1}`, shipDate: today }));
}

function labelSheetMetrics(config: LabelConfig) {
  const sheetWidth = config.marginX * 2 + config.columns * config.width + (config.columns - 1) * config.gapX;
  const sheetHeight = config.marginY * 2 + config.rows * config.height + (config.rows - 1) * config.gapY;
  return { sheetWidth, sheetHeight };
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() => storageGet(MODE_STORAGE_KEY) === 'work-order' ? 'work-order' : 'label');
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [source, setSource] = useState('等待读取飞书');
  const [tableName, setTableName] = useState('销售订单表');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<PrintFilter>(() => {
    const remembered = readMemory(FILTER_STORAGE_KEY, defaultPrintFilter);
    const today = todayInput();
    return { ...remembered, dateMode: 'exact', exactDate: today, baseDate: today };
  });
  const [config, setConfig] = useState<LabelConfig>(() => readMemory(CONFIG_STORAGE_KEY, defaultLabelConfig));
  const [labelTemplate, setLabelTemplate] = useState<LabelTemplate>(() => migrateTemplateConfig(readMemory(LABEL_TEMPLATE_STORAGE_KEY, defaultLabelConfig), 'label'));
  const [workTemplate, setWorkTemplate] = useState<WorkOrderTemplate>(() => readMemory(WORK_TEMPLATE_STORAGE_KEY, createDefaultWorkOrderTemplate()));
  const [sharedA4Template, setSharedA4Template] = useState<A4Template>(() => createDefaultTemplate('a4'));
  const [templateMessage, setTemplateMessage] = useState('');
  const [templateMissing, setTemplateMissing] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const refreshSequence = useRef(0);
  const printRef = useRef<HTMLDivElement>(null);
  const repository = useMemo(() => createTemplateRepository(), []);

  const updateConfig = useCallback((patch: Partial<LabelConfig>) => setConfig((current) => {
    const next = { ...current, ...patch };
    storageSet(CONFIG_STORAGE_KEY, JSON.stringify(next));
    return next;
  }), []);

  useEffect(() => { setLabelTemplate((current) => templateFromConfig(config, current)); }, [config]);
  useEffect(() => { storageSet(LABEL_TEMPLATE_STORAGE_KEY, JSON.stringify(labelTemplate)); }, [labelTemplate]);
  useEffect(() => { storageSet(WORK_TEMPLATE_STORAGE_KEY, JSON.stringify(workTemplate)); }, [workTemplate]);
  useEffect(() => {
    withTimeout(repository.load(), 5000).then((snapshot) => {
      const shared = snapshot.templates.find((template) => template.type === 'label' && template.isDefault);
      const sharedA4 = snapshot.templates.find((template) => template.type === 'a4' && template.isDefault);
      if (shared?.type === 'label') { setLabelTemplate(shared); setConfig(configFromTemplate(shared)); }
      if (sharedA4?.type === 'a4') { setSharedA4Template(sharedA4); setWorkTemplate(workFromSharedTemplate(sharedA4)); }
      if (snapshot.reason === 'missing-table') { setTemplateMissing(true); setTemplateMessage('未找到打印模板配置表，当前使用本地模板'); }
      if (!snapshot.editable && snapshot.reason === 'permission-denied') setTemplateMessage('共享模板只读：当前成员没有配置表编辑权限');
    }).catch(() => setTemplateMessage('共享模板读取超时，当前使用本地模板'));
  }, [repository]);

  useEffect(() => { storageSet(MODE_STORAGE_KEY, mode); }, [mode]);
  useEffect(() => { storageSet(FILTER_STORAGE_KEY, JSON.stringify(filter)); }, [filter]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true); setError('');
    if (previewModeRequested() || !isEmbeddedFeishuHost()) {
      setOrders(previewOrdersForToday());
      setSource('脱离飞书预览数据');
      setTableName('销售订单示例');
      setLoading(false);
      return;
    }
    try {
      const result = await retry(loadFeishuOrders, { attempts: 2, delaysMs: [500], timeoutMs: 6000 });
      if (sequence !== refreshSequence.current) return;
      setOrders(result.orders);
      setSource(result.orders.length ? result.source : '当前视图为空');
      setTableName(result.tableName);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      if (!isEmbeddedFeishuHost() || previewModeRequested()) {
        setOrders(previewOrdersForToday());
        setSource('脱离飞书预览数据');
        setTableName('销售订单示例');
        setError('');
        return;
      }
      setError(cause instanceof OperationTimeoutError ? '飞书连接超时，请确认插件通过飞书打开后重试' : cause instanceof Error ? cause.message : '无法读取飞书当前表');
      setSource('未连接飞书');
    } finally { if (sequence === refreshSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const base = bitable?.base as unknown as { onSelectionChange?: (callback: () => void) => (() => void) | void } | undefined;
    const onSelectionChange = base?.onSelectionChange;
    if (typeof onSelectionChange !== 'function') return;
    const unsubscribe = onSelectionChange.call(base, () => { refresh(); });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [refresh]);

  useEffect(() => {
    const styleId = 'label-sheet-page-style';
    const metrics = labelSheetMetrics(config);
    const rule = `@page label-sheet-page { size: ${metrics.sheetWidth}mm ${metrics.sheetHeight}mm; margin: 0; }`;
    if (mode !== 'label') {
      document.getElementById(styleId)?.remove();
      return;
    }
    const existing = document.getElementById(styleId) as HTMLStyleElement | null;
    const style = existing ?? document.createElement('style');
    style.id = styleId;
    style.textContent = rule;
    if (!existing) document.head.appendChild(style);
    return () => {
      if (style.isConnected) style.remove();
    };
  }, [mode, config.width, config.height, config.columns, config.rows, config.gapX, config.gapY, config.marginX, config.marginY]);

  const customers = useMemo(() => [...new Set(orders.map((order) => order.customer).filter(Boolean))].sort(), [orders]);
  const categories = useMemo(() => [...new Set(orders.flatMap((order) => splitCategoryValues(order.category)))].sort(), [orders]);
  const products = useMemo(() => [...new Set(orders.map((order) => order.productName).filter(Boolean))].sort(), [orders]);
  const filteredOrders = useMemo(() => filterOrders(orders, filter), [orders, filter]);
  const requestedCopies = filter.quantityMode === 'custom' ? clampFixedCopies(filter.customQuantity) : undefined;
  const labelCopies = useMemo(() => expandLabelCopies(filteredOrders.filter((order) => order.quantity > 0), { ...config, copiesByQuantity: requestedCopies === undefined && config.copiesByQuantity }, requestedCopies), [filteredOrders, config, requestedCopies]);
  const printCheck = validatePrintTotal(labelCopies.length);
  const preview = limitPreviewItems(labelCopies);
  const visibleLabelCopies = isPrinting ? labelCopies : preview.items;
  const workOrderGroups = useMemo(() => groupOrdersForWorkOrders(filteredOrders), [filteredOrders]);
  const activeCount = mode === 'label' ? labelCopies.length : workOrderGroups.length;
  const printValid = mode === 'label' ? printCheck.valid : activeCount > 0;
  const print = useReactToPrint({
    contentRef: printRef,
    documentTitle: mode === 'label' ? '花众标签' : '花众加工单',
    onBeforePrint: async () => {
      setIsPrinting(true);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (mode !== 'label') return;
      const expected = labelCopies.filter((order) => Boolean(order.productCode)).length;
      const startedAt = Date.now();
      while (expected > 0 && Date.now() - startedAt < 15000) {
        const rendered = [...document.querySelectorAll<HTMLImageElement>('.label-card .barcode')].filter((node) => node.complete && node.naturalWidth > 0).length;
        if (rendered >= expected) break;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
    },
    onAfterPrint: () => setIsPrinting(false),
  });
  const title = mode === 'label' ? '标签与条码' : '花束加工单';
  const updateFilter = useCallback((patch: Partial<PrintFilter>) => setFilter((current) => {
    const next = { ...current, ...patch };
    if (next.dateMode === 'range' && next.startDate && next.endDate && next.startDate > next.endDate) {
      if (Object.prototype.hasOwnProperty.call(patch, 'startDate')) next.endDate = next.startDate;
      else next.startDate = next.endDate;
    }
    return next;
  }), []);
  const dateModeLabel = { all: '全部日期', exact: '单日', range: '日期区间', offset: '单日' }[filter.dateMode];
  const shipDateLabel = useMemo(() => formatSelectedDateRange(filter, filteredOrders), [filter, filteredOrders]);
  const resetFilter = useCallback(() => setFilter({ ...defaultPrintFilter, dateMode: 'exact', exactDate: todayInput(), baseDate: todayInput() }), []);

  const saveSharedLabelTemplate = async () => {
    try { await repository.save({ ...labelTemplate, isDefault: true }, labelTemplate.version); setTemplateMessage('共享标签模板已保存'); } catch (cause) { setTemplateMessage(cause instanceof TemplatePermissionError ? '没有编辑打印模板配置表的权限' : cause instanceof TemplateConflictError ? '模板已被其他成员更新，请先刷新后再保存' : '共享模板保存失败'); }
  };
  const saveSharedWorkTemplate = async () => {
    try { const saved = await repository.save({ ...sharedTemplateFromWork(workTemplate, sharedA4Template), isDefault: true }, sharedA4Template.version); setSharedA4Template(saved as A4Template); setTemplateMessage('共享加工单模板已保存'); } catch (cause) { setTemplateMessage(cause instanceof TemplatePermissionError ? '没有编辑打印模板配置表的权限' : cause instanceof TemplateConflictError ? '模板已被其他成员更新，请先刷新后再保存' : '共享加工单模板保存失败'); }
  };
  const initializeSharedTemplates = async () => {
    try {
      await repository.initialize();
      const snapshot = await withTimeout(repository.load(), 5000);
      const shared = snapshot.templates.find((template) => template.type === 'label' && template.isDefault);
      const sharedA4 = snapshot.templates.find((template) => template.type === 'a4' && template.isDefault);
      if (shared?.type === 'label') { setLabelTemplate(shared); setConfig(configFromTemplate(shared)); }
      if (sharedA4?.type === 'a4') { setSharedA4Template(sharedA4); setWorkTemplate(workFromSharedTemplate(sharedA4)); }
      setTemplateMissing(false); setTemplateMessage('共享模板配置表已初始化');
    } catch (cause) { setTemplateMessage(cause instanceof TemplatePermissionError ? '没有创建打印模板配置表的权限' : '初始化共享模板配置表失败'); }
  };

  return <div className={`app-shell ${mode}`}>
    <aside className="control-panel">
      <div className="brand"><div className="brand-mark">H</div><div><strong>花众打印</strong><span>销售订单打印</span></div></div>
      <div className="source-strip"><span className="source-dot" /><div><b>{tableName}</b><small>{source}</small></div><button className="icon-button" onClick={refresh} aria-label="刷新数据" title="刷新数据">{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}</button></div>
      <div className="mode-switch" role="tablist"><button className={mode === 'label' ? 'active' : ''} onClick={() => setMode('label')} role="tab"><Barcode size={16} />标签</button><button className={mode === 'work-order' ? 'active' : ''} onClick={() => setMode('work-order')} role="tab"><FileText size={16} />加工单</button></div>
      <div className="panel-section filter-section"><div className="section-title"><span>订单筛选</span><button type="button" className="reset-filter" onClick={resetFilter}>重置</button><span className="count-pill">{filteredOrders.length}/{orders.length} 条</span></div><div className="range-row"><span className="selection-indicator" /><div><b>当前视图记录</b><small>{dateModeLabel} · {shipDateLabel}</small></div></div><SearchMultiSelect className="filter-field" label="客户（可多选）" options={customers} value={filter.customers} onChange={(customers) => updateFilter({ customers })} /><SearchMultiSelect className="filter-field" label="品类（可多选）" options={categories} value={filter.categories} onChange={(categories) => updateFilter({ categories })} /><SearchMultiSelect className="filter-field" label="花束（可多选）" options={products} value={filter.products} onChange={(products) => updateFilter({ products })} /><div className="filter-field"><div className="filter-label"><span>出货日期</span><b>{dateModeLabel}</b></div><select className="select-field" value={filter.dateMode === 'offset' ? 'exact' : filter.dateMode} onChange={(event) => { const nextMode = event.target.value as PrintFilter['dateMode']; updateFilter(nextMode === 'range' ? { dateMode: nextMode, startDate: filter.startDate || filter.exactDate, endDate: filter.endDate || filter.exactDate } : { dateMode: nextMode }); }}><option value="exact">单日</option><option value="range">日期区间</option><option value="all">全部日期</option></select>{(filter.dateMode === 'exact' || filter.dateMode === 'offset') && <label className="date-label"><span>选择出货日</span><input className="date-field" type="date" value={filter.dateMode === 'offset' && !filter.exactDate ? filter.baseDate : filter.exactDate} onChange={(event) => updateFilter({ exactDate: event.target.value, baseDate: event.target.value, dateMode: 'exact' })} /></label>}{filter.dateMode === 'range' && <div className="date-pair"><label className="date-label"><span>开始日期</span><input className="date-field" type="date" value={filter.startDate} onChange={(event) => updateFilter({ startDate: event.target.value })} /></label><label className="date-label"><span>结束日期</span><input className="date-field" type="date" value={filter.endDate} min={filter.startDate || undefined} onChange={(event) => updateFilter({ endDate: event.target.value })} /></label></div>}</div><div className="filter-field"><div className="filter-label"><span>标签数量</span><b>{filter.quantityMode === 'order' ? '按订单数量' : `每单 ${requestedCopies ?? 1} 张`}</b></div><div className="quantity-switch"><button type="button" className={filter.quantityMode === 'order' ? 'active' : ''} onClick={() => updateFilter({ quantityMode: 'order' })}>订单数量</button><button type="button" className={filter.quantityMode === 'custom' ? 'active' : ''} onClick={() => updateFilter({ quantityMode: 'custom' })}>自定义</button></div>{filter.quantityMode === 'custom' && <NumberField label="每单打印张数（1-5000）" value={requestedCopies ?? 1} onChange={(customQuantity) => updateFilter({ customQuantity: clampFixedCopies(customQuantity) })} />}</div></div>
      {mode === 'label' ? <div className="panel-section"><div className="section-title"><span>标签规格</span><Settings2 size={15} /></div><div className="field-grid"><NumberField label="宽 mm" value={config.width} onChange={(value) => updateConfig({ width: Math.min(300, Math.max(5, value)) })} /><NumberField label="高 mm" value={config.height} onChange={(value) => updateConfig({ height: Math.min(300, Math.max(5, value)) })} /><NumberField label="列数" value={config.columns} onChange={(value) => updateConfig({ columns: Math.min(20, Math.max(1, value)) })} /><NumberField label="行数" value={config.rows} onChange={(value) => updateConfig({ rows: Math.min(20, Math.max(1, value)) })} /></div><div className="field-grid"><NumberField label="横间距" value={config.gapX} onChange={(value) => updateConfig({ gapX: Math.min(50, Math.max(0, value)) })} /><NumberField label="纵间距" value={config.gapY} onChange={(value) => updateConfig({ gapY: Math.min(50, Math.max(0, value)) })} /></div><div className="field-grid"><NumberField label="内边距 mm" value={config.padding} onChange={(value) => updateConfig({ padding: Math.min(20, Math.max(0, value)) })} /><NumberField label="内容间距 mm" value={config.contentGap} onChange={(value) => updateConfig({ contentGap: Math.min(20, Math.max(0, value)) })} /></div></div> : <div className="panel-section"><div className="section-title"><span>加工单模板</span><LayoutGrid size={15} /></div><WorkOrderEditor value={workTemplate} onChange={setWorkTemplate} /></div>}
      {mode === 'label' && <div className="panel-section label-date-section"><div className="section-title"><span>标签日期</span><span className="section-hint">只影响标签显示</span></div><NumberField label="标签日期 T+ 天数" value={config.labelDateOffsetDays} onChange={(value) => updateConfig({ labelDateOffsetDays: Math.min(3650, Math.max(0, Math.round(value))) })} /></div>}
      <div className="panel-footer"><IssueSummary orders={filteredOrders} mode={mode} />{templateMessage && <div className="info-text">{templateMessage}</div>}{error && <div className="error-text">{error}</div>}<div className="template-actions">{templateMissing && <button className="secondary-button" onClick={initializeSharedTemplates}>初始化模板</button>}{mode === 'label' ? <button className="secondary-button" onClick={saveSharedLabelTemplate}><Save size={15} />保存共享模板</button> : <button className="secondary-button" onClick={saveSharedWorkTemplate}><Save size={15} />保存共享模板</button>}</div><button className="primary-button" disabled={!activeCount || !printValid} onClick={() => print()}><Printer size={17} />打印 {activeCount} {mode === 'label' ? '张标签' : '张加工单'}</button></div>
    </aside>
    <main className="workspace"><div className="workspace-head"><div><div className="eyebrow">打印预览</div><h1>{title}</h1><p>{mode === 'label' ? '按出货日期生成标签，标签日期可单独调整' : '按客户和出货日期分别生成加工单'}</p></div><div className="head-chip"><span className="live-dot" />{shipDateLabel}</div></div><div className="workspace-content">{mode === 'label' && <Suspense fallback={<div className="layout-editor-loading">正在加载标签编辑器</div>}><LabelLayoutEditor template={labelTemplate} order={filteredOrders[0]} onChange={(next) => { setLabelTemplate(next); setConfig(configFromTemplate(next)); }} /></Suspense>}<div className="preview-frame"><div className="preview-toolbar"><span>预览区域</span><span>{mode === 'label' ? `${config.width} × ${config.height} mm · 标签日期 T+${config.labelDateOffsetDays} · ${labelCopies.length} 张` : `A4 · ${workTemplate.orientation === 'landscape' ? '横向' : '纵向'} · ${shipDateLabel}`}</span></div><div className="preview-canvas" ref={printRef}>{!filteredOrders.length || (mode === 'label' && !labelCopies.length) ? <EmptyPreview /> : mode === 'label' ? <LabelSheet orders={visibleLabelCopies} config={{ ...config, copiesByQuantity: false }} template={labelTemplate} /> : workOrderGroups.map((group, index) => <WorkOrderPrintDocument key={`${group[0]?.customer ?? 'customer'}-${group[0]?.shipDate ?? 'date'}-${index}`} orders={group} template={workTemplate} shipDateLabel={group[0]?.shipDate || '未填写出货日期'} />)}</div>{!isPrinting && preview.truncated && mode === 'label' && <div className="issue-box">预览已限制为 {preview.items.length} 张，实际打印 {preview.total} 张</div>}{mode === 'label' && !printCheck.valid && <div className="error-text">打印数量超过 {MAX_TOTAL_PRINT_ITEMS} 张，请减少筛选范围或自定义数量</div>}</div></div></main>
  </div>;
}
