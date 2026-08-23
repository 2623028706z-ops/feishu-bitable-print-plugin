import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertTriangle, Barcode, Check, ChevronDown, FileText, LayoutGrid, LoaderCircle, Printer, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import { bitable } from '@lark-base-open/js-sdk';
import { adjustPrintDate, aggregateOrders, defaultLabelConfig, defaultPrintFilter, expandLabelCopies, filterOrders, issueLabel, splitCategoryValues, type LabelConfig, type PrintFilter, type PrintOrder } from './lib/print-model';
import { loadFeishuOrders } from './lib/feishu-adapter';

type Mode = 'label' | 'work-order';
const MODE_STORAGE_KEY = 'huazhong-print-mode';
const FILTER_STORAGE_KEY = 'huazhong-print-filter';
const CONFIG_STORAGE_KEY = 'huazhong-label-config';

function readMemory<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? { ...fallback as object, ...JSON.parse(value) } as T : fallback;
  } catch {
    return fallback;
  }
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

function LabelSheet({ orders, config }: { orders: PrintOrder[]; config: LabelConfig }) {
  const labels = expandLabelCopies(orders.filter((order) => order.quantity > 0), config);
  const pageSize = Math.max(1, config.rows * config.columns);
  const { sheetWidth, sheetHeight } = labelSheetMetrics(config);
  const style = { '--label-width': `${config.width}mm`, '--label-height': `${config.height}mm`, '--sheet-width': `${sheetWidth}mm`, '--sheet-height': `${sheetHeight}mm`, '--gap-x': `${config.gapX}mm`, '--gap-y': `${config.gapY}mm`, '--margin-x': `${config.marginX}mm`, '--margin-y': `${config.marginY}mm`, '--label-columns': config.columns, '--label-rows': config.rows, '--label-font-family': config.fontFamily, '--label-font-size': `${config.fontSize}mm`, '--label-code-size': `${Math.max(1.4, config.fontSize * 0.68)}mm`, '--label-meta-size': `${Math.max(1.2, config.fontSize * 0.58)}mm`, '--label-customer-size': `${Math.max(1.1, config.fontSize * 0.54)}mm`, '--label-care-size': `${Math.max(1, config.fontSize * 0.5)}mm`, '--label-font-weight': config.fontWeight, '--label-align': config.textAlign, '--label-padding': `${config.padding}mm`, '--label-content-gap': `${config.contentGap}mm`, '--label-line-height': config.lineHeight } as CSSProperties;
  const pageCount = Math.max(1, Math.ceil(labels.length / pageSize));
  return <>{Array.from({ length: pageCount }, (_, pageIndex) => <div className={`print-surface label-sheet${pageIndex < pageCount - 1 ? ' label-page-break' : ''}`} style={style} key={`label-page-${pageIndex}`}>
    {labels.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map((order) => <div className="label-card" key={order.recordId}>
      {config.showName && <div className="label-name">{order.productName}</div>}
      {config.showCode && order.productCode ? <><BarcodeView value={order.productCode} /><div className="label-code">{order.productCode}</div></> : <div className="label-missing">未设置花束编码</div>}
      {config.showDate && <div className="label-meta"><span>{order.shipDate ? adjustPrintDate(order.shipDate, config.labelDateOffsetDays) : '未填写日期'}</span></div>}
      {config.showCustomer && <div className="label-customer">{order.customer || '未填写客户'}</div>}
      {config.showCareInstructions && order.careInstructions && <div className="label-care">{order.careInstructions}</div>}
    </div>)}
  </div>)}</>;
}

function WorkOrder({ orders, shipDateLabel }: { orders: PrintOrder[]; shipDateLabel: string }) {
  const grouped = aggregateOrders(orders.filter((order) => order.quantity > 0));
  const totalQuantity = grouped.reduce((sum, order) => sum + order.quantity, 0);
  const customers = [...new Set(orders.map((order) => order.customer.trim()).filter(Boolean))].sort();
  const customerLabel = customers.length === 0 ? '未填写客户' : customers.length === 1 ? customers[0] : `多个客户（${customers.length}）`;
  return <div className="print-surface work-order">
    <header className="work-head"><div><div className="work-kicker">花众生产打印</div><h1>花束加工单</h1><p>A4 横向 · 客户：<b>{customerLabel}</b> · 出货日期：<b>{shipDateLabel}</b></p></div><div className="work-stats"><strong>{totalQuantity} 扎</strong><span>{grouped.length} 款 · {orders.length} 单</span></div></header>
    <table><thead><tr><th>花束</th><th>花材</th><th>加工扎数</th><th>单束</th><th>总支数</th><th>备注</th></tr></thead><tbody>
      {grouped.flatMap((order, index) => order.recipe.length ? order.recipe.map((line, lineIndex) => (
        <tr key={`${order.recordId}-${line.material}`}>
          {lineIndex === 0 ? <td rowSpan={order.recipe.length} className="bouquet-cell"><b>{index + 1}. {order.productName}</b><span>{order.quantity} 扎</span></td> : null}
          <td>{line.material}</td><td className="center">{order.quantity} 扎</td><td className="center">{line.stemsPerBunch ? `${line.stemsPerBunch} ${line.unit}` : '—'}</td><td className="center">{line.totalStems || '—'}</td><td>{line.note || order.note || ''}</td>
        </tr>
      )) : [
        <tr key={order.recordId}><td className="bouquet-cell"><b>{index + 1}. {order.productName}</b><span>{order.quantity} 扎</span></td><td colSpan={5} className="missing-recipe">未关联成品配方，请检查成品汇总表</td></tr>,
      ])}
    </tbody></table>
    <footer>说明：加工扎数取销售数量（扎），同花束按订单合并。 <span>第 1/1 页</span></footer>
  </div>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><input type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} /></label>;
}

function OptionList({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (value: string[]) => void }) {
  if (!options.length) return null;
  const toggle = (option: string) => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  return <div className="filter-field"><div className="filter-label"><span>{label}</span>{selected.length > 0 && <button type="button" onClick={() => onChange([])}>清空</button>}</div><div className="filter-options">{options.map((option) => <label key={option} className="filter-option"><input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}</div></div>;
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
  const [mode, setMode] = useState<Mode>(() => localStorage.getItem(MODE_STORAGE_KEY) === 'work-order' ? 'work-order' : 'label');
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [source, setSource] = useState('等待读取飞书');
  const [tableName, setTableName] = useState('销售订单表');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<PrintFilter>(() => readMemory(FILTER_STORAGE_KEY, { ...defaultPrintFilter, dateMode: 'exact', exactDate: todayInput(), baseDate: todayInput() }));
  const [config, setConfig] = useState<LabelConfig>(() => readMemory(CONFIG_STORAGE_KEY, defaultLabelConfig));

  const updateConfig = useCallback((patch: Partial<LabelConfig>) => setConfig((current) => {
    const next = { ...current, ...patch };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    return next;
  }), []);

  useEffect(() => { localStorage.setItem(MODE_STORAGE_KEY, mode); }, [mode]);
  useEffect(() => { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter)); }, [filter]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await loadFeishuOrders();
      setOrders(result.orders);
      setSource(result.orders.length ? result.source : '当前视图为空');
      setTableName(result.tableName);
    } catch (cause) {
      setOrders([]);
      setError(cause instanceof Error ? cause.message : '无法读取飞书当前表');
      setSource('未连接飞书');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    return bitable.base.onSelectionChange(() => { refresh(); });
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
  const labelCopies = useMemo(() => expandLabelCopies(filteredOrders.filter((order) => order.quantity > 0), config, filter.quantityMode === 'custom' ? filter.customQuantity : undefined), [filteredOrders, config, filter.quantityMode, filter.customQuantity]);
  const activeCount = mode === 'label' ? labelCopies.length : aggregateOrders(filteredOrders.filter((order) => order.quantity > 0)).length;
  const title = mode === 'label' ? '标签与条码' : '花束加工单';
  const updateFilter = useCallback((patch: Partial<PrintFilter>) => setFilter((current) => ({ ...current, ...patch })), []);
  const dateModeLabel = { all: '全部日期', exact: '指定日期', range: '日期范围', offset: '指定日期' }[filter.dateMode];
  const shipDateLabel = useMemo(() => {
    const dates = [...new Set(filteredOrders.map((order) => order.shipDate).filter(Boolean))].sort();
    return dates.length === 0 ? '未填写出货日期' : dates.length === 1 ? dates[0] : `多个出货日期（${dates.length} 天）`;
  }, [filteredOrders]);
  const resetFilter = useCallback(() => setFilter({ ...defaultPrintFilter, dateMode: 'exact', exactDate: todayInput(), baseDate: todayInput() }), []);

  return <div className={`app-shell ${mode}`}>
    <aside className="control-panel">
      <div className="brand"><div className="brand-mark">H</div><div><strong>花众打印</strong><span>Sales order studio</span></div></div>
      <div className="source-strip"><span className="source-dot" /><div><b>{tableName}</b><small>{source}</small></div><button className="icon-button" onClick={refresh} aria-label="刷新数据" title="刷新数据">{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}</button></div>
      <div className="mode-switch" role="tablist"><button className={mode === 'label' ? 'active' : ''} onClick={() => setMode('label')} role="tab"><Barcode size={16} />标签</button><button className={mode === 'work-order' ? 'active' : ''} onClick={() => setMode('work-order')} role="tab"><FileText size={16} />加工单</button></div>
      <div className="panel-section filter-section"><div className="section-title"><span>订单筛选</span><button type="button" className="reset-filter" onClick={resetFilter}>重置</button><span className="count-pill">{filteredOrders.length}/{orders.length} 条</span></div><div className="range-row"><span className="selection-indicator" />当前视图记录 <small>{dateModeLabel}</small></div><OptionList label="客户（可多选）" options={customers} selected={filter.customers} onChange={(customers) => updateFilter({ customers })} /><OptionList label="品类（可多选）" options={categories} selected={filter.categories} onChange={(categories) => updateFilter({ categories })} /><OptionList label="花束（可多选）" options={products} selected={filter.products} onChange={(products) => updateFilter({ products })} /><div className="filter-field"><div className="filter-label"><span>出货日期</span><b>{dateModeLabel}</b></div><select className="select-field" value={filter.dateMode === 'offset' ? 'exact' : filter.dateMode} onChange={(event) => updateFilter({ dateMode: event.target.value as PrintFilter['dateMode'] })}><option value="exact">指定日期</option><option value="range">日期范围</option><option value="all">全部日期</option></select>{(filter.dateMode === 'exact' || filter.dateMode === 'offset') && <input className="date-field" type="date" value={filter.dateMode === 'offset' && !filter.exactDate ? filter.baseDate : filter.exactDate} onChange={(event) => updateFilter({ exactDate: event.target.value, dateMode: 'exact' })} />}{filter.dateMode === 'range' && <div className="date-pair"><input className="date-field" type="date" value={filter.startDate} onChange={(event) => updateFilter({ startDate: event.target.value })} /><input className="date-field" type="date" value={filter.endDate} onChange={(event) => updateFilter({ endDate: event.target.value })} /></div>}</div><div className="filter-field"><div className="filter-label"><span>标签数量</span><b>{filter.quantityMode === 'order' ? '按订单数量' : `每单 ${filter.customQuantity} 张`}</b></div><div className="quantity-switch"><button type="button" className={filter.quantityMode === 'order' ? 'active' : ''} onClick={() => updateFilter({ quantityMode: 'order' })}>订单数量</button><button type="button" className={filter.quantityMode === 'custom' ? 'active' : ''} onClick={() => updateFilter({ quantityMode: 'custom' })}>自定义</button></div>{filter.quantityMode === 'custom' && <NumberField label="每单打印张数" value={filter.customQuantity} onChange={(customQuantity) => updateFilter({ customQuantity: Math.max(0, customQuantity) })} />}</div></div>
      {mode === 'label' ? <div className="panel-section"><div className="section-title"><span>标签规格</span><Settings2 size={15} /></div><div className="field-grid"><NumberField label="宽 mm" value={config.width} onChange={(value) => updateConfig({ width: value })} /><NumberField label="高 mm" value={config.height} onChange={(value) => updateConfig({ height: value })} /><NumberField label="列数" value={config.columns} onChange={(value) => updateConfig({ columns: Math.max(1, value) })} /><NumberField label="行数" value={config.rows} onChange={(value) => updateConfig({ rows: Math.max(1, value) })} /></div><div className="field-grid"><NumberField label="横间距" value={config.gapX} onChange={(value) => updateConfig({ gapX: value })} /><NumberField label="纵间距" value={config.gapY} onChange={(value) => updateConfig({ gapY: value })} /></div><div className="field-grid"><NumberField label="内边距 mm" value={config.padding} onChange={(value) => updateConfig({ padding: Math.max(0, value) })} /><NumberField label="内容间距 mm" value={config.contentGap} onChange={(value) => updateConfig({ contentGap: Math.max(0, value) })} /></div></div> : <div className="panel-section"><div className="section-title"><span>加工单结构</span><LayoutGrid size={15} /></div><div className="info-row"><span>纸张</span><b>A4 横向</b></div><div className="info-row"><span>聚合</span><b>按花束合并</b></div><div className="info-row"><span>配方来源</span><b>成品配方表</b></div></div>}
      {mode === 'label' && <div className="panel-section"><div className="section-title"><span>标签排版</span><SlidersHorizontal size={15} /></div><div className="field-grid"><NumberField label="标签日期 T+" value={config.labelDateOffsetDays} onChange={(value) => updateConfig({ labelDateOffsetDays: Math.round(value) })} /><label className="number-field"><span>字体</span><select className="select-field" value={config.fontFamily} onChange={(event) => updateConfig({ fontFamily: event.target.value })}><option value="Microsoft YaHei, 微软雅黑, sans-serif">微软雅黑</option><option value="SimSun, 宋体, serif">宋体</option><option value="Arial, sans-serif">Arial</option><option value="sans-serif">系统无衬线</option></select></label></div><div className="field-grid"><NumberField label="字号 mm" value={config.fontSize} onChange={(value) => updateConfig({ fontSize: Math.max(1, value) })} /><label className="number-field"><span>粗细</span><select className="select-field" value={config.fontWeight} onChange={(event) => updateConfig({ fontWeight: Number(event.target.value) })}><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label></div><div className="field-grid"><label className="number-field"><span>对齐</span><select className="select-field" value={config.textAlign} onChange={(event) => updateConfig({ textAlign: event.target.value as LabelConfig['textAlign'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label><label className="number-field"><span>行高</span><select className="select-field" value={config.lineHeight} onChange={(event) => updateConfig({ lineHeight: Number(event.target.value) })}><option value="1">紧凑</option><option value="1.2">标准</option><option value="1.4">宽松</option></select></label></div>{[['showName', '花束名称'], ['showCode', '条码与编码'], ['showDate', '出货日期'], ['showCustomer', '客户名称'], ['showCareInstructions', '养护说明']].map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(config[key as keyof LabelConfig])} onChange={(event) => updateConfig({ [key]: event.target.checked })} /><i /></label>)}<label className="toggle-row"><span>按销售数量打印</span><input type="checkbox" checked={config.copiesByQuantity} onChange={(event) => updateConfig({ copiesByQuantity: event.target.checked })} /><i /></label></div>}
      <div className="panel-footer"><IssueSummary orders={filteredOrders} />{error && <div className="error-text">{error}</div>}<button className="primary-button" disabled={!activeCount} onClick={() => window.print()}><Printer size={17} />打印 {activeCount} {mode === 'label' ? '张标签' : '款加工单'}</button><button className="secondary-button" onClick={() => setMode(mode === 'label' ? 'work-order' : 'label')}><ChevronDown size={16} />切换到{mode === 'label' ? '加工单' : '标签'}</button></div>
    </aside>
    <main className="workspace"><div className="workspace-head"><div><div className="eyebrow">PRINT PREVIEW</div><h1>{title}</h1><p>{mode === 'label' ? '按出货日期生成标签，标签日期可单独调整' : '按出货日期展开花束加工单'}</p></div><div className="head-chip"><span className="live-dot" />{shipDateLabel}</div></div><div className="preview-frame"><div className="preview-toolbar"><span>预览区域</span><span>{mode === 'label' ? `${config.width} × ${config.height} mm · 标签日期 T+${config.labelDateOffsetDays} · ${labelCopies.length} 张` : `A4 · 横向 · ${shipDateLabel}`}</span></div><div className="preview-canvas">{!filteredOrders.length || (mode === 'label' && !labelCopies.length) ? <EmptyPreview /> : mode === 'label' ? <LabelSheet orders={labelCopies} config={{ ...config, copiesByQuantity: false }} /> : <WorkOrder orders={filteredOrders} shipDateLabel={shipDateLabel} />}</div></div></main>
  </div>;
}
