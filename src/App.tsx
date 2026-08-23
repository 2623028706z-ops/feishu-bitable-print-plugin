import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import JsBarcode from 'jsbarcode';
import { AlertTriangle, Barcode, Check, ChevronDown, FileText, LayoutGrid, LoaderCircle, Printer, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import { bitable } from '@lark-base-open/js-sdk';
import { aggregateOrders, defaultLabelConfig, expandLabelCopies, issueLabel, sampleOrders, type LabelConfig, type PrintOrder } from './lib/print-model';
import { loadFeishuOrders } from './lib/feishu-adapter';

type Mode = 'label' | 'work-order';

function BarcodeView({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    JsBarcode(ref.current, value, { format: 'CODE128', displayValue: false, margin: 0, height: 34, width: 1.25 });
  }, [value]);
  return <svg ref={ref} className="barcode" aria-label={`条码 ${value}`} />;
}

function IssueSummary({ orders }: { orders: PrintOrder[] }) {
  const issues = orders.flatMap((order) => order.issues.map((issue) => `${order.productName}：${issueLabel(issue)}`));
  if (!issues.length) return <div className="clean-status"><Check size={15} /> 数据完整，可生成打印预览</div>;
  return <div className="issue-box"><AlertTriangle size={16} /><div><strong>{issues.length} 项数据需要确认</strong><div>{issues.slice(0, 3).join('；')}{issues.length > 3 ? '…' : ''}</div></div></div>;
}

function LabelSheet({ orders, config }: { orders: PrintOrder[]; config: LabelConfig }) {
  const labels = expandLabelCopies(orders.filter((order) => order.quantity > 0), config);
  return <div className="print-surface label-sheet" style={{ '--label-width': `${config.width}mm`, '--label-height': `${config.height}mm`, '--gap-x': `${config.gapX}mm`, '--gap-y': `${config.gapY}mm`, '--margin-x': `${config.marginX}mm`, '--margin-y': `${config.marginY}mm`, '--label-columns': config.columns } as CSSProperties}>
    {labels.map((order) => <div className="label-card" key={order.recordId}>
      {config.showName && <div className="label-name">{order.productName}</div>}
      {config.showCode && order.productCode ? <><BarcodeView value={order.productCode} /><div className="label-code">{order.productCode}</div></> : <div className="label-missing">未设置花束编码</div>}
      <div className="label-meta">
        {config.showQuantity && <span>{order.quantity} 扎</span>}
        {config.showDate && <span>{order.shipDate || '未填写日期'}</span>}
      </div>
      {config.showCustomer && <div className="label-customer">{order.customer || '未填写客户'}</div>}
    </div>)}
  </div>;
}

function WorkOrder({ orders }: { orders: PrintOrder[] }) {
  const grouped = aggregateOrders(orders.filter((order) => order.quantity > 0));
  const totalQuantity = grouped.reduce((sum, order) => sum + order.quantity, 0);
  return <div className="print-surface work-order">
    <header className="work-head"><div><div className="work-kicker">花众生产打印</div><h1>天虹花束加工单</h1><p>A4 横向 · 由销售订单实时展开成品配方</p></div><div className="work-stats"><strong>{totalQuantity} 扎</strong><span>{grouped.length} 款 · {orders.length} 单</span></div></header>
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

export default function App() {
  const [mode, setMode] = useState<Mode>('label');
  const [orders, setOrders] = useState<PrintOrder[]>(sampleOrders);
  const [source, setSource] = useState('示例预览');
  const [tableName, setTableName] = useState('销售订单表');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<LabelConfig>(() => {
    try { return { ...defaultLabelConfig, ...JSON.parse(localStorage.getItem('huazhong-label-config') || '{}') }; } catch { return defaultLabelConfig; }
  });

  const updateConfig = useCallback((patch: Partial<LabelConfig>) => setConfig((current) => {
    const next = { ...current, ...patch };
    localStorage.setItem('huazhong-label-config', JSON.stringify(next));
    return next;
  }), []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await loadFeishuOrders();
      setOrders(result.orders.length ? result.orders : sampleOrders);
      setSource(result.orders.length ? result.source : '当前视图为空 · 示例预览');
      setTableName(result.tableName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取飞书当前表');
      setSource('脱离飞书 · 示例预览');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    return bitable.base.onSelectionChange(() => { refresh(); });
  }, [refresh]);

  const activeCount = mode === 'label' ? expandLabelCopies(orders, config).length : aggregateOrders(orders).length;
  const title = mode === 'label' ? '标签与条码' : '天虹加工单';

  return <div className="app-shell">
    <aside className="control-panel">
      <div className="brand"><div className="brand-mark">H</div><div><strong>花众打印</strong><span>Sales order studio</span></div></div>
      <div className="source-strip"><span className="source-dot" /><div><b>{tableName}</b><small>{source}</small></div><button className="icon-button" onClick={refresh} aria-label="刷新数据" title="刷新数据">{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}</button></div>
      <div className="mode-switch" role="tablist"><button className={mode === 'label' ? 'active' : ''} onClick={() => setMode('label')} role="tab"><Barcode size={16} />标签</button><button className={mode === 'work-order' ? 'active' : ''} onClick={() => setMode('work-order')} role="tab"><FileText size={16} />加工单</button></div>
      <div className="panel-section"><div className="section-title"><span>打印范围</span><span className="count-pill">{orders.length} 条</span></div><div className="range-row"><span className="selection-indicator" />当前视图记录</div><p className="helper">在表格里选中单条记录时，会优先预览该记录。</p></div>
      {mode === 'label' ? <div className="panel-section"><div className="section-title"><span>标签规格</span><Settings2 size={15} /></div><div className="field-grid"><NumberField label="宽 mm" value={config.width} onChange={(value) => updateConfig({ width: value })} /><NumberField label="高 mm" value={config.height} onChange={(value) => updateConfig({ height: value })} /><NumberField label="列数" value={config.columns} onChange={(value) => updateConfig({ columns: Math.max(1, value) })} /><NumberField label="行数" value={config.rows} onChange={(value) => updateConfig({ rows: Math.max(1, value) })} /></div><div className="field-grid"><NumberField label="横间距" value={config.gapX} onChange={(value) => updateConfig({ gapX: value })} /><NumberField label="纵间距" value={config.gapY} onChange={(value) => updateConfig({ gapY: value })} /></div></div> : <div className="panel-section"><div className="section-title"><span>加工单结构</span><LayoutGrid size={15} /></div><div className="info-row"><span>纸张</span><b>A4 横向</b></div><div className="info-row"><span>聚合</span><b>按花束合并</b></div><div className="info-row"><span>配方来源</span><b>成品配方表</b></div></div>}
      {mode === 'label' && <div className="panel-section"><div className="section-title"><span>标签内容</span><SlidersHorizontal size={15} /></div>{[['showName', '花束名称'], ['showCode', '条码与编码'], ['showQuantity', '销售数量'], ['showDate', '出货日期'], ['showCustomer', '客户名称']].map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(config[key as keyof LabelConfig])} onChange={(event) => updateConfig({ [key]: event.target.checked })} /><i /></label>)}<label className="toggle-row"><span>按销售数量打印</span><input type="checkbox" checked={config.copiesByQuantity} onChange={(event) => updateConfig({ copiesByQuantity: event.target.checked })} /><i /></label></div>}
      <div className="panel-footer"><IssueSummary orders={orders} />{error && <div className="error-text">{error}</div>}<button className="primary-button" onClick={() => window.print()}><Printer size={17} />打印 {activeCount} {mode === 'label' ? '张标签' : '款加工单'}</button><button className="secondary-button" onClick={() => setMode(mode === 'label' ? 'work-order' : 'label')}><ChevronDown size={16} />切换到{mode === 'label' ? '加工单' : '标签'}</button></div>
    </aside>
    <main className="workspace"><div className="workspace-head"><div><div className="eyebrow">PRINT PREVIEW</div><h1>{title}</h1><p>{mode === 'label' ? '将销售订单转成可直接扫码的商品标签' : '销售订单关联成品配方，按天虹作业结构展开'}</p></div><div className="head-chip"><span className="live-dot" />实时数据</div></div><div className="preview-frame"><div className="preview-toolbar"><span>预览区域</span><span>{mode === 'label' ? `${config.width} × ${config.height} mm` : 'A4 · 横向'}</span></div><div className="preview-canvas">{mode === 'label' ? <LabelSheet orders={orders} config={config} /> : <WorkOrder orders={orders} />}</div></div></main>
  </div>;
}
