import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertTriangle, Barcode, Check, ChevronDown, FileText, LayoutGrid, LoaderCircle, Printer, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import { bitable } from '@lark-base-open/js-sdk';
import { useReactToPrint } from 'react-to-print';
import { adjustPrintDate, aggregateOrders, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, issueLabel, splitCategoryValues, type LabelConfig, type PrintFilter, type PrintOrder } from './lib/print-model';
import { loadFeishuOrders } from './lib/feishu-adapter';
import { SearchMultiSelect } from './features/filters/SearchMultiSelect';
import { LabelLayoutEditor } from './features/templates/LabelLayoutEditor';
import { createDefaultTemplate, migrateTemplateConfig, type A4Template, type LabelTemplate } from './domain/templates';
import { clampFixedCopies, limitPreviewItems, MAX_TOTAL_PRINT_ITEMS, validatePrintTotal } from './domain/print-safety';
import { WorkOrderEditor } from './features/work-order/WorkOrderEditor';
import { WorkOrderPrintDocument, createDefaultWorkOrderTemplate, type WorkOrderTemplate } from './features/print/WorkOrderPrintDocument';
import { createTemplateRepository, TemplatePermissionError } from './infrastructure/template-repository';
import { retry } from './lib/retry';

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
  return { ...defaultLabelConfig, width: template.paper.widthMm, height: template.paper.heightMm, columns: template.grid.columns, rows: template.grid.rows, gapX: template.grid.gapXmm, gapY: template.grid.gapYmm, marginX: template.grid.marginXmm, marginY: template.grid.marginYmm, padding: template.padding, contentGap: template.contentGap, fontFamily: template.fontFamily, fontSize: template.fontSize, fontWeight: template.fontWeight, textAlign: template.textAlign, lineHeight: template.lineHeight, labelDateOffsetDays: template.labelDateOffsetDays, copiesByQuantity: template.copiesByQuantity, showName: template.showName, showCode: template.showCode, showDate: template.showDate, showCustomer: template.showCustomer, showCareInstructions: template.showCareInstructions };
}

function templateFromConfig(config: LabelConfig, current: LabelTemplate): LabelTemplate {
  return migrateTemplateConfig({ ...current, paper: { widthMm: config.width, heightMm: config.height }, grid: { columns: config.columns, rows: config.rows, gapXmm: config.gapX, gapYmm: config.gapY, marginXmm: config.marginX, marginYmm: config.marginY }, styles: { ...current.styles, fontFamily: config.fontFamily, fontSize: config.fontSize, fontWeight: config.fontWeight, align: config.textAlign, lineHeight: config.lineHeight, padding: config.padding, contentGap: config.contentGap }, labelDateOffsetDays: config.labelDateOffsetDays, copiesByQuantity: config.copiesByQuantity, showName: config.showName, showCode: config.showCode, showDate: config.showDate, showCustomer: config.showCustomer, showCareInstructions: config.showCareInstructions }, 'label');
}

function workFromSharedTemplate(template: A4Template): WorkOrderTemplate {
  const fallback = createDefaultWorkOrderTemplate();
  return { ...fallback, name: template.name, title: template.title, orientation: template.orientation, marginsMm: { top: template.margins.top, right: template.margins.right, bottom: template.margins.bottom, left: template.margins.left }, typography: { ...fallback.typography, fontFamily: template.fontFamily, bodySizeMm: template.fontSize, fontWeight: template.fontWeight, align: template.textAlign }, table: { ...fallback.table, borderWidthMm: template.borderWidth, borderStyle: template.borderStyle, borderColor: template.borderColor }, header: { ...fallback.header, visible: template.headerVisible, showCustomer: template.titleVisible }, footer: { ...fallback.footer, visible: template.footerVisible }, columns: template.columns.map((column) => ({ id: column.id === 'quantity' ? 'bunchQuantity' : column.id as WorkOrderTemplate['columns'][number]['id'], label: column.label, width: column.width, visible: column.visible, align: column.align, required: column.id === 'bouquet' || column.id === 'material' || column.id === 'quantity' })) };
}

function sharedTemplateFromWork(template: WorkOrderTemplate, current: A4Template): A4Template {
  return migrateTemplateConfig({ ...current, name: template.name, title: template.title, orientation: template.orientation, margins: template.marginsMm, fontFamily: template.typography.fontFamily, fontSize: template.typography.bodySizeMm, fontWeight: template.typography.fontWeight, textAlign: template.typography.align, borderVisible: template.table.borderWidthMm > 0, borderWidth: template.table.borderWidthMm, borderStyle: template.table.borderStyle, borderColor: template.table.borderColor, titleVisible: true, headerVisible: template.header.visible, footerVisible: template.footer.visible, columns: template.columns.map((column) => ({ id: column.id === 'bunchQuantity' ? 'quantity' : column.id, label: column.label, width: column.width, visible: column.visible, align: column.align })) }, 'a4');
}

function BarcodeView({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    JsBarcode(ref.current, value, { format: 'CODE128', displayValue: false, margin: 0, height: 34, width: 1.25 });
  }, [value]);
  return <svg ref={ref} className="barcode" aria-label={`条码 ${value}`} />;
}

function IssueSummary({ orders }: { orders: PrintOrder[] }) {
  if (!orders.length) return <div className="empty-status"><span>0</span> 当前筛选没有可打印订单</div>;
  const issues = orders.flatMap((order) => order.issues.map((issue) => `${order.productName}：${issueLabel(issue)}`));
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
        const style = { position: 'absolute', left: `${element.x}mm`, top: `${element.y}mm`, width: `${element.width}mm`, height: `${element.height}mm`, fontFamily: element.fontFamily ?? template.fontFamily, fontSize: `${element.fontSizeMm ?? template.fontSize}mm`, fontWeight: element.fontWeight ?? template.fontWeight, textAlign: element.textAlign ?? template.textAlign, lineHeight: element.kind === 'careInstructions' || element.kind === 'care' ? template.lineHeight : 1.1 } as CSSProperties;
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
  return <div className="empty-preview"><span>⌕</span><strong>没有匹配的订单</strong><p>调整客户、花束或出货日期筛选后再打印</p></div>;
}

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  const print = useReactToPrint({ contentRef: printRef, documentTitle: mode === 'label' ? '花众标签' : '花众加工单', onBeforePrint: async () => { setIsPrinting(true); await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); }, onAfterPrint: () => setIsPrinting(false) });

  const updateConfig = useCallback((patch: Partial<LabelConfig>) => setConfig((current) => {
    const next = { ...current, ...patch };
    storageSet(CONFIG_STORAGE_KEY, JSON.stringify(next));
    return next;
  }), []);

  useEffect(() => { setLabelTemplate((current) => templateFromConfig(config, current)); }, [config]);
  useEffect(() => { storageSet(LABEL_TEMPLATE_STORAGE_KEY, JSON.stringify(labelTemplate)); }, [labelTemplate]);
  useEffect(() => { storageSet(WORK_TEMPLATE_STORAGE_KEY, JSON.stringify(workTemplate)); }, [workTemplate]);
  useEffect(() => {
    repository.load().then((snapshot) => {
      const shared = snapshot.templates.find((template) => template.type === 'label' && template.isDefault);
      const sharedA4 = snapshot.templates.find((template) => template.type === 'a4' && template.isDefault);
      if (shared?.type === 'label') { setLabelTemplate(shared); setConfig(configFromTemplate(shared)); }
      if (sharedA4?.type === 'a4') { setSharedA4Template(sharedA4); setWorkTemplate(workFromSharedTemplate(sharedA4)); }
      if (snapshot.reason === 'missing-table') { setTemplateMissing(true); setTemplateMessage('未找到打印模板配置表，当前使用本地模板'); }
      if (!snapshot.editable && snapshot.reason === 'permission-denied') setTemplateMessage('共享模板只读：当前成员没有配置表编辑权限');
    }).catch(() => setTemplateMessage('共享模板读取失败，当前使用本地模板'));
  }, [repository]);

  useEffect(() => { storageSet(MODE_STORAGE_KEY, mode); }, [mode]);
  useEffect(() => { storageSet(FILTER_STORAGE_KEY, JSON.stringify(filter)); }, [filter]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true); setError('');
    try {
      const result = await retry(loadFeishuOrders, { attempts: 3, delaysMs: [350, 900] });
      if (sequence !== refreshSequence.current) return;
      setOrders(result.orders);
      setSource(result.orders.length ? result.source : '当前视图为空');
      setTableName(result.tableName);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      setError(cause instanceof Error ? cause.message : '无法读取飞书当前表');
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
  const activeCount = mode === 'label' ? labelCopies.length : aggregateOrders(filteredOrders.filter((order) => order.quantity > 0)).length;
  const title = mode === 'label' ? '标签与条码' : '花束加工单';
  const updateFilter = useCallback((patch: Partial<PrintFilter>) => setFilter((current) => ({ ...current, ...patch })), []);
  const dateModeLabel = { all: '全部日期', exact: '指定日期', range: '日期范围', offset: '指定日期' }[filter.dateMode];
  const shipDateLabel = useMemo(() => {
    const dates = [...new Set(filteredOrders.map((order) => order.shipDate).filter(Boolean))].sort();
    return dates.length === 0 ? '未填写出货日期' : dates.length === 1 ? dates[0] : `多个出货日期（${dates.length} 天）`;
  }, [filteredOrders]);
  const resetFilter = useCallback(() => setFilter({ ...defaultPrintFilter, dateMode: 'exact', exactDate: todayInput(), baseDate: todayInput() }), []);

  const saveSharedLabelTemplate = async () => {
    try { await repository.save({ ...labelTemplate, isDefault: true }); setTemplateMessage('共享标签模板已保存'); } catch (cause) { setTemplateMessage(cause instanceof TemplatePermissionError ? '没有编辑打印模板配置表的权限' : '共享模板保存失败'); }
  };
  const saveSharedWorkTemplate = async () => {
    try { const saved = await repository.save({ ...sharedTemplateFromWork(workTemplate, sharedA4Template), isDefault: true }); setSharedA4Template(saved as A4Template); setTemplateMessage('共享加工单模板已保存'); } catch (cause) { setTemplateMessage(cause instanceof TemplatePermissionError ? '没有编辑打印模板配置表的权限' : '共享加工单模板保存失败'); }
  };
  const initializeSharedTemplates = async () => {
    try { await repository.initialize(); setTemplateMissing(false); setTemplateMessage('共享模板配置表已初始化'); } catch (cause) { setTemplateMessage(cause instanceof TemplatePermissionError ? '没有创建打印模板配置表的权限' : '初始化共享模板配置表失败'); }
  };

  return <div className={`app-shell ${mode}`}>
    <aside className="control-panel">
      <div className="brand"><div className="brand-mark">H</div><div><strong>花众打印</strong><span>Sales order studio</span></div></div>
      <div className="source-strip"><span className="source-dot" /><div><b>{tableName}</b><small>{source}</small></div><button className="icon-button" onClick={refresh} aria-label="刷新数据" title="刷新数据">{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}</button></div>
      <div className="mode-switch" role="tablist"><button className={mode === 'label' ? 'active' : ''} onClick={() => setMode('label')} role="tab"><Barcode size={16} />标签</button><button className={mode === 'work-order' ? 'active' : ''} onClick={() => setMode('work-order')} role="tab"><FileText size={16} />加工单</button></div>
      <div className="panel-section filter-section"><div className="section-title"><span>订单筛选</span><button type="button" className="reset-filter" onClick={resetFilter}>重置</button><span className="count-pill">{filteredOrders.length}/{orders.length} 条</span></div><div className="range-row"><span className="selection-indicator" />当前视图记录 <small>{dateModeLabel}</small></div><SearchMultiSelect className="filter-field" label="客户（可多选）" options={customers} value={filter.customers} onChange={(customers) => updateFilter({ customers })} /><SearchMultiSelect className="filter-field" label="品类（可多选）" options={categories} value={filter.categories} onChange={(categories) => updateFilter({ categories })} /><SearchMultiSelect className="filter-field" label="花束（可多选）" options={products} value={filter.products} onChange={(products) => updateFilter({ products })} /><div className="filter-field"><div className="filter-label"><span>出货日期</span><b>{dateModeLabel}</b></div><select className="select-field" value={filter.dateMode === 'offset' ? 'exact' : filter.dateMode} onChange={(event) => updateFilter({ dateMode: event.target.value as PrintFilter['dateMode'] })}><option value="exact">指定日期</option><option value="range">日期范围</option><option value="all">全部日期</option></select>{(filter.dateMode === 'exact' || filter.dateMode === 'offset') && <input className="date-field" type="date" value={filter.dateMode === 'offset' && !filter.exactDate ? filter.baseDate : filter.exactDate} onChange={(event) => updateFilter({ exactDate: event.target.value, dateMode: 'exact' })} />}{filter.dateMode === 'range' && <div className="date-pair"><input className="date-field" type="date" value={filter.startDate} onChange={(event) => updateFilter({ startDate: event.target.value })} /><input className="date-field" type="date" value={filter.endDate} onChange={(event) => updateFilter({ endDate: event.target.value })} /></div>}</div><div className="filter-field"><div className="filter-label"><span>标签数量</span><b>{filter.quantityMode === 'order' ? '按订单数量' : `每单 ${requestedCopies ?? 1} 张`}</b></div><div className="quantity-switch"><button type="button" className={filter.quantityMode === 'order' ? 'active' : ''} onClick={() => updateFilter({ quantityMode: 'order' })}>订单数量</button><button type="button" className={filter.quantityMode === 'custom' ? 'active' : ''} onClick={() => updateFilter({ quantityMode: 'custom' })}>自定义</button></div>{filter.quantityMode === 'custom' && <NumberField label="每单打印张数（1-5000）" value={requestedCopies ?? 1} onChange={(customQuantity) => updateFilter({ customQuantity: clampFixedCopies(customQuantity) })} />}</div></div>
      {mode === 'label' ? <div className="panel-section"><div className="section-title"><span>标签规格</span><Settings2 size={15} /></div><div className="field-grid"><NumberField label="宽 mm" value={config.width} onChange={(value) => updateConfig({ width: Math.min(300, Math.max(5, value)) })} /><NumberField label="高 mm" value={config.height} onChange={(value) => updateConfig({ height: Math.min(300, Math.max(5, value)) })} /><NumberField label="列数" value={config.columns} onChange={(value) => updateConfig({ columns: Math.min(20, Math.max(1, value)) })} /><NumberField label="行数" value={config.rows} onChange={(value) => updateConfig({ rows: Math.min(20, Math.max(1, value)) })} /></div><div className="field-grid"><NumberField label="横间距" value={config.gapX} onChange={(value) => updateConfig({ gapX: Math.min(50, Math.max(0, value)) })} /><NumberField label="纵间距" value={config.gapY} onChange={(value) => updateConfig({ gapY: Math.min(50, Math.max(0, value)) })} /></div><div className="field-grid"><NumberField label="内边距 mm" value={config.padding} onChange={(value) => updateConfig({ padding: Math.min(20, Math.max(0, value)) })} /><NumberField label="内容间距 mm" value={config.contentGap} onChange={(value) => updateConfig({ contentGap: Math.min(20, Math.max(0, value)) })} /></div></div> : <div className="panel-section"><div className="section-title"><span>加工单模板</span><LayoutGrid size={15} /></div><WorkOrderEditor value={workTemplate} onChange={setWorkTemplate} /></div>}
      {mode === 'label' && <div className="panel-section"><div className="section-title"><span>标签排版</span><SlidersHorizontal size={15} /></div><div className="field-grid"><NumberField label="标签日期 T+" value={config.labelDateOffsetDays} onChange={(value) => updateConfig({ labelDateOffsetDays: Math.round(value) })} /><label className="number-field"><span>字体</span><select className="select-field" value={config.fontFamily} onChange={(event) => updateConfig({ fontFamily: event.target.value })}><option value="Microsoft YaHei, 微软雅黑, sans-serif">微软雅黑</option><option value="SimSun, 宋体, serif">宋体</option><option value="Arial, sans-serif">Arial</option><option value="sans-serif">系统无衬线</option></select></label></div><div className="field-grid"><NumberField label="字号 mm" value={config.fontSize} onChange={(value) => updateConfig({ fontSize: Math.max(1, value) })} /><label className="number-field"><span>粗细</span><select className="select-field" value={config.fontWeight} onChange={(event) => updateConfig({ fontWeight: Number(event.target.value) })}><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label></div><div className="field-grid"><label className="number-field"><span>对齐</span><select className="select-field" value={config.textAlign} onChange={(event) => updateConfig({ textAlign: event.target.value as LabelConfig['textAlign'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><label className="number-field"><span>行高</span><select className="select-field" value={config.lineHeight} onChange={(event) => updateConfig({ lineHeight: Number(event.target.value) })}><option value="1">紧凑</option><option value="1.2">标准</option><option value="1.4">宽松</option></select></label></div>{[['showName', '花束名称'], ['showCode', '条码与编码'], ['showDate', '出货日期'], ['showCustomer', '客户名称'], ['showCareInstructions', '养护说明']].map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(config[key as keyof LabelConfig])} onChange={(event) => updateConfig({ [key]: event.target.checked })} /><i /></label>)}<label className="toggle-row"><span>按销售数量打印</span><input type="checkbox" checked={config.copiesByQuantity} onChange={(event) => updateConfig({ copiesByQuantity: event.target.checked })} /><i /></label></div>}
      <div className="panel-footer"><IssueSummary orders={filteredOrders} />{templateMessage && <div className="info-text">{templateMessage}</div>}{error && <div className="error-text">{error}</div>}{templateMissing && <button className="secondary-button" onClick={initializeSharedTemplates}>初始化共享模板配置表</button>}{mode === 'label' ? <button className="secondary-button" onClick={saveSharedLabelTemplate}>保存为共享标签模板</button> : <button className="secondary-button" onClick={saveSharedWorkTemplate}>保存为共享加工单模板</button>}<button className="primary-button" disabled={!activeCount || !printCheck.valid} onClick={() => print()}><Printer size={17} />打印 {activeCount} {mode === 'label' ? '张标签' : '款加工单'}</button><button className="secondary-button" onClick={() => setMode(mode === 'label' ? 'work-order' : 'label')}><ChevronDown size={16} />切换到{mode === 'label' ? '加工单' : '标签'}</button></div>
    </aside>
    <main className="workspace"><div className="workspace-head"><div><div className="eyebrow">PRINT PREVIEW</div><h1>{title}</h1><p>{mode === 'label' ? '按出货日期生成标签，标签日期可单独调整' : '按出货日期展开花束加工单'}</p></div><div className="head-chip"><span className="live-dot" />{shipDateLabel}</div></div>{mode === 'label' && <LabelLayoutEditor template={labelTemplate} order={filteredOrders[0]} onChange={(next) => { setLabelTemplate(next); setConfig(configFromTemplate(next)); }} />}<div className="preview-frame"><div className="preview-toolbar"><span>预览区域</span><span>{mode === 'label' ? `${config.width} × ${config.height} mm · 标签日期 T+${config.labelDateOffsetDays} · ${labelCopies.length} 张` : `A4 · ${workTemplate.orientation === 'landscape' ? '横向' : '纵向'} · ${shipDateLabel}`}</span></div><div className="preview-canvas" ref={printRef}>{!filteredOrders.length || (mode === 'label' && !labelCopies.length) ? <EmptyPreview /> : mode === 'label' ? <LabelSheet orders={visibleLabelCopies} config={{ ...config, copiesByQuantity: false }} template={labelTemplate} /> : <WorkOrderPrintDocument orders={filteredOrders} template={workTemplate} shipDateLabel={shipDateLabel} />}</div>{!isPrinting && preview.truncated && <div className="issue-box">预览已限制为 {preview.items.length} 张，实际打印 {preview.total} 张</div>}{!printCheck.valid && <div className="error-text">打印数量超过 {MAX_TOTAL_PRINT_ITEMS} 张，请减少筛选范围或自定义数量</div>}</div></main>
  </div>;
}
