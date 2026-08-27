import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertTriangle, Barcode, Check, FileText, LayoutGrid, LoaderCircle, Printer, RefreshCw, SearchX, Settings2 } from 'lucide-react';
import { bitable } from '@lark-base-open/js-sdk';
import { Button, Banner, InputNumber, Select, DatePicker, RadioGroup, Radio } from '@douyinfe/semi-ui';
import { useReactToPrint } from 'react-to-print';
import { adjustPrintDate, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, formatSelectedDateRange, groupOrdersForWorkOrders, issueLabel, labelPrintLayout, labelPrintPageStyle, sampleOrders, splitCategoryValues, type LabelConfig, type LabelRotation, type PrintFilter, type PrintOrder } from './lib/print-model';
import { loadFeishuOrders } from './lib/feishu-adapter';
import { SearchMultiSelect } from './features/filters/SearchMultiSelect';
const LabelLayoutEditor = lazy(() => import('./features/templates/LabelLayoutEditor').then((module) => ({ default: module.LabelLayoutEditor })));
import { migrateTemplateConfig, type LabelTemplate } from './domain/templates';
import { clampFixedCopies, limitPreviewItems, MAX_TOTAL_PRINT_ITEMS, validatePrintTotal } from './domain/print-safety';
import { WorkOrderEditor } from './features/work-order/WorkOrderEditor';
import { WorkOrderPrintDocument, createDefaultWorkOrderTemplate, type WorkOrderRegion, type WorkOrderTemplate } from './features/print/WorkOrderPrintDocument';
import { OperationTimeoutError, retry } from './lib/retry';

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

function readLabelConfigMemory(): LabelConfig {
  const stored = readMemory(CONFIG_STORAGE_KEY, defaultLabelConfig);
  const isLegacySheetDefault = stored.columns === 2 && stored.rows === 8 && stored.gapX === 2 && stored.gapY === 2 && stored.marginX === 5 && stored.marginY === 5;
  return isLegacySheetDefault ? { ...stored, columns: 1, rows: 1, gapX: 0, gapY: 0, marginX: 0, marginY: 0 } : stored;
}

function templateFromConfig(config: LabelConfig, current: LabelTemplate): LabelTemplate {
  const visibility: Record<string, boolean> = { name: config.showName, barcode: config.showCode, code: config.showCode, date: config.showDate, customer: config.showCustomer, careInstructions: config.showCareInstructions, care: config.showCareInstructions };
  return migrateTemplateConfig({ ...current, paper: { widthMm: config.width, heightMm: config.height }, grid: { columns: config.columns, rows: config.rows, gapXmm: config.gapX, gapYmm: config.gapY, marginXmm: config.marginX, marginYmm: config.marginY }, elements: current.elements.map((element) => ({ ...element, visible: visibility[element.kind] ?? element.visible })), styles: { ...current.styles, fontFamily: config.fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, align: config.textAlign, lineHeight: config.lineHeight, padding: config.padding, contentGap: config.contentGap }, labelDateOffsetDays: config.labelDateOffsetDays, copiesByQuantity: config.copiesByQuantity, showName: config.showName, showCode: config.showCode, showDate: config.showDate, showCustomer: config.showCustomer, showCareInstructions: config.showCareInstructions }, 'label');
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
  const layout = labelPrintLayout(config);
  // Each label is a physical page. Legacy multi-cell grid values are retained
  // in templates for editing but cannot create a hidden 2-up print layout.
  const style = { '--label-width': `${layout.cardW}mm`, '--label-height': `${layout.cardH}mm`, '--sheet-width': `${layout.pageW}mm`, '--sheet-height': `${layout.pageH}mm`, '--label-rotate': layout.transform, '--gap-x': '0mm', '--gap-y': '0mm', '--margin-x': '0mm', '--margin-y': '0mm', '--label-columns': 1, '--label-rows': 1, '--label-font-family': config.fontFamily, '--label-font-size': `${config.fontSize}mm`, '--label-code-size': `${Math.max(1.4, config.fontSize * 0.68)}mm`, '--label-meta-size': `${Math.max(1.2, config.fontSize * 0.58)}mm`, '--label-customer-size': `${Math.max(1.1, config.fontSize * 0.54)}mm`, '--label-care-size': `${Math.max(1, config.fontSize * 0.5)}mm`, '--label-font-weight': config.fontWeight, '--label-align': config.textAlign, '--label-padding': `${config.padding}mm`, '--label-content-gap': `${config.contentGap}mm`, '--label-line-height': config.lineHeight } as CSSProperties;
  const pageCount = Math.max(1, labels.length);
  return <>{Array.from({ length: pageCount }, (_, pageIndex) => <div className={`print-surface label-sheet${layout.rotation ? ' label-sheet-rotated' : ''}${pageIndex < pageCount - 1 ? ' label-page-break' : ''}`} style={style} key={`label-page-${pageIndex}`}>
    {labels.slice(pageIndex, pageIndex + 1).map((order) => <div className="label-card" key={order.recordId}>
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
  return <label className="number-field"><span>{label}</span><InputNumber aria-label={label} hideButtons min={0} style={{ width: '100%' }} value={value} onChange={(next) => onChange(Number(next) || 0)} /></label>;
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
  const [config, setConfig] = useState<LabelConfig>(() => readLabelConfigMemory());
  const [labelTemplate, setLabelTemplate] = useState<LabelTemplate>(() => migrateTemplateConfig(readMemory(LABEL_TEMPLATE_STORAGE_KEY, defaultLabelConfig), 'label'));
  const [workTemplate, setWorkTemplate] = useState<WorkOrderTemplate>(() => readMemory(WORK_TEMPLATE_STORAGE_KEY, createDefaultWorkOrderTemplate()));
  const [workRegion, setWorkRegion] = useState<WorkOrderRegion>('page');
  const [isPrinting, setIsPrinting] = useState(false);
  const refreshSequence = useRef(0);
  const printRef = useRef<HTMLDivElement>(null);
  const updateConfig = useCallback((patch: Partial<LabelConfig>) => setConfig((current) => {
    const next = { ...current, ...patch };
    storageSet(CONFIG_STORAGE_KEY, JSON.stringify(next));
    return next;
  }), []);
  const setLabelOrientation = useCallback((orientation: 'landscape' | 'portrait') => setConfig((current) => {
    const isLandscape = current.width >= current.height;
    if ((orientation === 'landscape') === isLandscape) return current;
    const next = { ...current, width: current.height, height: current.width };
    storageSet(CONFIG_STORAGE_KEY, JSON.stringify(next));
    return next;
  }), []);

  useEffect(() => { setLabelTemplate((current) => templateFromConfig(config, current)); }, [config]);
  useEffect(() => { storageSet(LABEL_TEMPLATE_STORAGE_KEY, JSON.stringify(labelTemplate)); }, [labelTemplate]);
  useEffect(() => { storageSet(WORK_TEMPLATE_STORAGE_KEY, JSON.stringify(workTemplate)); }, [workTemplate]);
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
    const rule = labelPrintPageStyle(config);
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
  }, [mode, config.width, config.height, config.printRotation]);

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
  const printPageStyle = mode === 'label' ? labelPrintPageStyle(config) : `@page { size: A4 ${workTemplate.orientation}; margin: 0; }`;
  const print = useReactToPrint({
    contentRef: printRef,
    documentTitle: mode === 'label' ? '花众标签' : '花众加工单',
    pageStyle: printPageStyle,
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

  return <div className={`app-shell ${mode}`}>
    <aside className="control-panel">
      <div className="brand"><div className="brand-mark">H</div><div><strong>花众打印</strong><span>销售订单打印</span></div></div>
      <div className="source-strip"><span className="source-dot" /><div><b>{tableName}</b><small>{source}</small></div><Button theme="borderless" type="tertiary" icon={loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} onClick={refresh} aria-label="刷新数据" title="刷新数据" /></div>
      <RadioGroup className="mode-switch" type="button" buttonSize="large" value={mode} onChange={(event) => setMode(event.target.value as Mode)} aria-label="打印模式"><Radio value="label"><span className="mode-radio-inner"><Barcode size={16} />标签</span></Radio><Radio value="work-order"><span className="mode-radio-inner"><FileText size={16} />加工单</span></Radio></RadioGroup>
      <div className="panel-section filter-section"><div className="section-title"><span>订单筛选</span><Button className="reset-filter" theme="borderless" type="tertiary" size="small" onClick={resetFilter}>重置</Button><span className="count-pill">{filteredOrders.length}/{orders.length} 条</span></div><div className="range-row"><span className="selection-indicator" /><div><b>当前视图记录</b><small>{dateModeLabel} · {shipDateLabel}</small></div></div><SearchMultiSelect className="filter-field" label="客户（可多选）" options={customers} value={filter.customers} onChange={(customers) => updateFilter({ customers })} /><SearchMultiSelect className="filter-field" label="品类（可多选）" options={categories} value={filter.categories} onChange={(categories) => updateFilter({ categories })} /><SearchMultiSelect className="filter-field" label="花束（可多选）" options={products} value={filter.products} onChange={(products) => updateFilter({ products })} /><div className="filter-field"><div className="filter-label"><span>出货日期</span><b>{dateModeLabel}</b></div><Select aria-label="出货日期筛选模式" style={{ width: '100%' }} value={filter.dateMode === 'offset' ? 'exact' : filter.dateMode} onChange={(value) => { const nextMode = value as PrintFilter['dateMode']; updateFilter(nextMode === 'range' ? { dateMode: nextMode, startDate: filter.startDate || filter.exactDate, endDate: filter.endDate || filter.exactDate } : { dateMode: nextMode }); }} optionList={[{ value: 'exact', label: '单日' }, { value: 'range', label: '日期区间' }, { value: 'all', label: '全部日期' }]} />{(filter.dateMode === 'exact' || filter.dateMode === 'offset') && <label className="date-label"><span>选择出货日</span><DatePicker aria-label="选择出货日" type="date" density="compact" format="yyyy-MM-dd" style={{ width: '100%' }} value={filter.dateMode === 'offset' && !filter.exactDate ? filter.baseDate : filter.exactDate} onChange={(_, dateString) => updateFilter({ exactDate: dateString as string, baseDate: dateString as string, dateMode: 'exact' })} /></label>}{filter.dateMode === 'range' && <div className="date-pair"><label className="date-label"><span>开始日期</span><DatePicker aria-label="开始日期" type="date" density="compact" format="yyyy-MM-dd" style={{ width: '100%' }} value={filter.startDate} onChange={(_, dateString) => updateFilter({ startDate: dateString as string })} /></label><label className="date-label"><span>结束日期</span><DatePicker aria-label="结束日期" type="date" density="compact" format="yyyy-MM-dd" style={{ width: '100%' }} value={filter.endDate} onChange={(_, dateString) => updateFilter({ endDate: dateString as string })} /></label></div>}</div><div className="filter-field"><div className="filter-label"><span>标签数量</span><b>{filter.quantityMode === 'order' ? '按订单数量' : `每单 ${requestedCopies ?? 1} 张`}</b></div><RadioGroup className="segmented" type="button" value={filter.quantityMode} onChange={(event) => updateFilter({ quantityMode: event.target.value as PrintFilter['quantityMode'] })} aria-label="标签数量模式"><Radio value="order">订单数量</Radio><Radio value="custom">自定义</Radio></RadioGroup>{filter.quantityMode === 'custom' && <NumberField label="每单打印张数（1-5000）" value={requestedCopies ?? 1} onChange={(customQuantity) => updateFilter({ customQuantity: clampFixedCopies(customQuantity) })} />}</div></div>
      {mode === 'label' ? <div className="panel-section"><div className="section-title"><span>标签规格</span><Settings2 size={15} /></div><div className="field-grid"><NumberField label="宽 mm" value={config.width} onChange={(value) => updateConfig({ width: Math.min(300, Math.max(5, value)) })} /><NumberField label="高 mm" value={config.height} onChange={(value) => updateConfig({ height: Math.min(300, Math.max(5, value)) })} /><NumberField label="列数" value={config.columns} onChange={(value) => updateConfig({ columns: Math.min(20, Math.max(1, value)) })} /><NumberField label="行数" value={config.rows} onChange={(value) => updateConfig({ rows: Math.min(20, Math.max(1, value)) })} /></div><div className="orientation-control"><span>打印方向</span><RadioGroup className="segmented" type="button" value={config.width >= config.height ? 'landscape' : 'portrait'} onChange={(event) => setLabelOrientation(event.target.value as 'landscape' | 'portrait')} aria-label="标签打印方向"><Radio value="landscape">横向</Radio><Radio value="portrait">纵向</Radio></RadioGroup></div><div className="orientation-control"><span>打印旋转</span><RadioGroup className="segmented" type="button" value={String(config.printRotation ?? 0)} onChange={(event) => updateConfig({ printRotation: Number(event.target.value) as LabelRotation })} aria-label="打印旋转角度"><Radio value="0">0°</Radio><Radio value="90">90°</Radio><Radio value="180">180°</Radio><Radio value="270">270°</Radio></RadioGroup></div><div className="field-grid"><NumberField label="横间距" value={config.gapX} onChange={(value) => updateConfig({ gapX: Math.min(50, Math.max(0, value)) })} /><NumberField label="纵间距" value={config.gapY} onChange={(value) => updateConfig({ gapY: Math.min(50, Math.max(0, value)) })} /></div><div className="field-grid"><NumberField label="内边距 mm" value={config.padding} onChange={(value) => updateConfig({ padding: Math.min(20, Math.max(0, value)) })} /><NumberField label="内容间距 mm" value={config.contentGap} onChange={(value) => updateConfig({ contentGap: Math.min(20, Math.max(0, value)) })} /></div></div> : <div className="panel-section"><div className="section-title"><span>加工单模板</span><LayoutGrid size={15} /></div><WorkOrderEditor value={workTemplate} onChange={setWorkTemplate} region={workRegion} onSelectRegion={setWorkRegion} /></div>}
      {mode === 'label' && <div className="panel-section label-date-section"><div className="section-title"><span>标签日期</span><span className="section-hint">只影响标签显示</span></div><NumberField label="标签日期 T+ 天数" value={config.labelDateOffsetDays} onChange={(value) => updateConfig({ labelDateOffsetDays: Math.min(3650, Math.max(0, Math.round(value))) })} /></div>}
      <div className="panel-footer"><IssueSummary orders={filteredOrders} mode={mode} />{error && <Banner type="danger" fullMode={false} closeIcon={null} description={error} />}<Button className="primary-button" theme="solid" type="primary" size="large" block icon={<Printer size={17} />} disabled={!activeCount || !printValid} onClick={() => print()}>打印 {activeCount} {mode === 'label' ? '张标签' : '张加工单'}</Button></div>
    </aside>
    <main className="workspace"><div className="workspace-head"><div><div className="eyebrow">打印预览</div><h1>{title}</h1><p>{mode === 'label' ? '按出货日期生成标签，标签日期可单独调整' : '按客户和出货日期分别生成加工单'}</p></div><div className="head-chip"><span className="live-dot" />{shipDateLabel}</div></div><div className="workspace-content">{mode === 'label' && <Suspense fallback={<div className="layout-editor-loading">正在加载标签编辑器</div>}><LabelLayoutEditor template={labelTemplate} order={filteredOrders[0]} onChange={setLabelTemplate} /></Suspense>}<div className="preview-frame"><div className="preview-toolbar"><span>预览区域</span><span>{mode === 'label' ? `${config.width} × ${config.height} mm · 标签日期 T+${config.labelDateOffsetDays} · ${labelCopies.length} 张` : `A4 · ${workTemplate.orientation === 'landscape' ? '横向' : '纵向'} · ${shipDateLabel}`}</span></div><div className="preview-canvas" ref={printRef}>{!filteredOrders.length || (mode === 'label' && !labelCopies.length) ? <EmptyPreview /> : mode === 'label' ? <LabelSheet orders={visibleLabelCopies} config={{ ...config, copiesByQuantity: false }} template={labelTemplate} /> : workOrderGroups.map((group, index) => <WorkOrderPrintDocument key={`${group[0]?.customer ?? 'customer'}-${group[0]?.shipDate ?? 'date'}-${index}`} orders={group} template={workTemplate} shipDateLabel={group[0]?.shipDate || '未填写出货日期'} interactive={!isPrinting && index === 0} selectedRegion={index === 0 ? workRegion : undefined} onSelectRegion={setWorkRegion} />)}</div>{!isPrinting && preview.truncated && mode === 'label' && <div className="issue-box">预览已限制为 {preview.items.length} 张，实际打印 {preview.total} 张</div>}{mode === 'label' && !printCheck.valid && <div className="error-text">打印数量超过 {MAX_TOTAL_PRINT_ITEMS} 张，请减少筛选范围或自定义数量</div>}</div></div></main>
  </div>;
}
