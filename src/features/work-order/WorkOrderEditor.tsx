import { useId, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import {
  createDefaultWorkOrderTemplate,
  normalizeWorkOrderTemplate,
  type WorkOrderColumn,
  type WorkOrderTemplate,
} from '../print/WorkOrderPrintDocument';

export type WorkOrderEditorProps = {
  value: WorkOrderTemplate;
  onChange: (template: WorkOrderTemplate) => void;
  onReset?: () => void;
  disabled?: boolean;
};

type NumberPath =
  | 'marginsMm.top'
  | 'marginsMm.right'
  | 'marginsMm.bottom'
  | 'marginsMm.left'
  | 'typography.titleSizeMm'
  | 'typography.metaSizeMm'
  | 'typography.customerSizeMm'
  | 'typography.bodySizeMm'
  | 'typography.fontWeight'
  | 'typography.lineHeight'
  | 'table.cellPaddingMm'
  | 'table.borderWidthMm';

const editorStyle = {
  background: '#fff',
  border: '1px solid #dce2df',
  borderRadius: 7,
  color: '#172022',
  display: 'grid',
  gap: 14,
  padding: 14,
} as const;

const sectionStyle = {
  borderTop: '1px solid #edf0ee',
  display: 'grid',
  gap: 9,
  paddingTop: 13,
} as const;

const labelStyle = {
  color: '#687172',
  display: 'grid',
  fontSize: 11,
  gap: 5,
} as const;

const inputStyle = {
  background: '#fff',
  border: '1px solid #dce2df',
  borderRadius: 5,
  color: '#172022',
  height: 34,
  minWidth: 0,
  padding: '0 9px',
  width: '100%',
} as const;

const FONT_OPTIONS = [
  ['Microsoft YaHei, 微软雅黑, sans-serif', '微软雅黑'],
  ['PingFang SC, 苹方, sans-serif', '苹方'],
  ['Noto Sans CJK SC, sans-serif', '思源黑体'],
  ['SimSun, 宋体, serif', '宋体'],
  ['Arial, sans-serif', 'Arial'],
  ['sans-serif', '系统无衬线'],
] as const;

type LayoutKey = 'header' | 'table' | 'footer';

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} style={labelStyle}>
      <span>{label}</span>
      <input
        id={id}
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={inputStyle}
        type="number"
        value={Number.isFinite(value) ? value : min}
      />
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} style={labelStyle}>
      <span>{label}</span>
      <input id={id} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={inputStyle} type="text" value={value} />
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} style={{ alignItems: 'center', display: 'flex', fontSize: 12, justifyContent: 'space-between', minHeight: 30 }}>
      <span>{label}</span>
      <input id={id} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function updateNumber(template: WorkOrderTemplate, path: NumberPath, value: number): WorkOrderTemplate {
  const validValue = Number.isFinite(value) ? value : 0;
  const [group, field] = path.split('.') as [keyof WorkOrderTemplate, string];
  return normalizeWorkOrderTemplate({ ...template, [group]: { ...(template[group] as object), [field]: validValue } });
}

function updateColumn(template: WorkOrderTemplate, id: string, patch: Partial<WorkOrderColumn>): WorkOrderTemplate {
  return normalizeWorkOrderTemplate({ ...template, columns: template.columns.map((column) => column.id === id ? { ...column, ...patch } : column) });
}

function moveColumn(template: WorkOrderTemplate, id: string, direction: -1 | 1): WorkOrderTemplate {
  const index = template.columns.findIndex((column) => column.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= template.columns.length) return template;
  const columns = [...template.columns];
  [columns[index], columns[target]] = [columns[target], columns[index]];
  return normalizeWorkOrderTemplate({ ...template, columns });
}

/**
 * Compact A4 template editor. It is intentionally controlled so callers can
 * persist a shared template in the same store as their label template.
 */
export function WorkOrderEditor({ value, onChange, onReset, disabled = false }: WorkOrderEditorProps) {
  const template = normalizeWorkOrderTemplate(value);
  const [drag, setDrag] = useState<{ key: LayoutKey; startX: number; startY: number; x: number; y: number } | null>(null);
  const patch = (next: Partial<WorkOrderTemplate>) => onChange(normalizeWorkOrderTemplate({ ...template, ...next }));
  const moveBlock = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const scale = 1.25;
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    onChange(normalizeWorkOrderTemplate({ ...template, layout: { ...template.layout, [drag.key]: { x: drag.x + dx, y: drag.y + dy } } }));
  };
  const reset = () => {
    if (onReset) onReset();
    else onChange(createDefaultWorkOrderTemplate());
  };

  return (
    <section aria-label="加工单模板设置" style={editorStyle}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>加工单模板</div>
          <div style={{ color: '#687172', fontSize: 10, marginTop: 3 }}>A4 版式与表格内容</div>
        </div>
        <button aria-label="恢复默认加工单模板" disabled={disabled} onClick={reset} style={{ alignItems: 'center', background: 'transparent', border: 0, color: '#2b7fa3', display: 'inline-flex', gap: 4, padding: 4 }} type="button">
          <RotateCcw size={15} /> <span style={{ fontSize: 11 }}>重置</span>
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <TextInput disabled={disabled} label="模板名称" onChange={(name) => patch({ name })} value={template.name} />
        <TextInput disabled={disabled} label="打印标题" onChange={(title) => patch({ title })} value={template.title} />
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>纸张与页眉</div>
        <label style={labelStyle}>
          <span>页面方向</span>
          <select disabled={disabled} onChange={(event) => patch({ orientation: event.target.value as WorkOrderTemplate['orientation'] })} style={inputStyle} value={template.orientation}>
            <option value="landscape">A4 横向</option>
            <option value="portrait">A4 纵向</option>
          </select>
        </label>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          <NumberInput disabled={disabled} label="上边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.top', number))} value={template.marginsMm.top} />
          <NumberInput disabled={disabled} label="下边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.bottom', number))} value={template.marginsMm.bottom} />
          <NumberInput disabled={disabled} label="左边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.left', number))} value={template.marginsMm.left} />
          <NumberInput disabled={disabled} label="右边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.right', number))} value={template.marginsMm.right} />
        </div>
        <Toggle checked={template.header.visible} disabled={disabled} label="显示页眉（客户与出货日期）" onChange={(visible) => patch({ header: { ...template.header, visible } })} />
        <Toggle checked={template.footer.visible} disabled={disabled} label="显示页脚说明" onChange={(visible) => patch({ footer: { ...template.footer, visible } })} />
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>字体与表格</div>
        <label htmlFor="work-order-font" style={labelStyle}><span>字体</span><select id="work-order-font" disabled={disabled} onChange={(event) => patch({ typography: { ...template.typography, fontFamily: event.target.value } })} style={inputStyle} value={template.typography.fontFamily}>{FONT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
          <NumberInput disabled={disabled} label="标题 (mm)" max={15} min={3} onChange={(number) => onChange(updateNumber(template, 'typography.titleSizeMm', number))} step={0.1} value={template.typography.titleSizeMm} />
          <NumberInput disabled={disabled} label="客户名称 (mm)" max={12} min={2} onChange={(number) => onChange(updateNumber(template, 'typography.customerSizeMm', number))} step={0.1} value={template.typography.customerSizeMm} />
          <NumberInput disabled={disabled} label="正文 (mm)" max={10} min={1.5} onChange={(number) => onChange(updateNumber(template, 'typography.bodySizeMm', number))} step={0.1} value={template.typography.bodySizeMm} />
          <label style={labelStyle}><span>字重</span><select disabled={disabled} onChange={(event) => onChange(updateNumber(template, 'typography.fontWeight', Number(event.target.value)))} style={inputStyle} value={template.typography.fontWeight}><option value="400">常规</option><option value="500">中等</option><option value="600">半粗</option><option value="700">粗体</option></select></label>
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          <NumberInput disabled={disabled} label="单元格内边距 (mm)" max={10} onChange={(number) => onChange(updateNumber(template, 'table.cellPaddingMm', number))} step={0.1} value={template.table.cellPaddingMm} />
          <NumberInput disabled={disabled} label="边框粗细 (mm)" max={2} min={0} onChange={(number) => onChange(updateNumber(template, 'table.borderWidthMm', number))} step={0.05} value={template.table.borderWidthMm} />
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          <label style={labelStyle}><span>边框线型</span><select disabled={disabled} onChange={(event) => patch({ table: { ...template.table, borderStyle: event.target.value as WorkOrderTemplate['table']['borderStyle'] } })} style={inputStyle} value={template.table.borderStyle}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
          <label style={labelStyle}><span>边框颜色</span><input disabled={disabled} onChange={(event) => patch({ table: { ...template.table, borderColor: event.target.value } })} style={{ ...inputStyle, padding: 3 }} type="color" value={template.table.borderColor} /></label>
          <label style={labelStyle}><span>表头背景</span><input disabled={disabled} onChange={(event) => patch({ table: { ...template.table, headerBackground: event.target.value } })} style={{ ...inputStyle, padding: 3 }} type="color" value={template.table.headerBackground} /></label>
          <label style={labelStyle}><span>正文对齐</span><select disabled={disabled} onChange={(event) => patch({ typography: { ...template.typography, align: event.target.value as WorkOrderTemplate['typography']['align'] } })} style={inputStyle} value={template.typography.align}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between' }}><div style={{ fontSize: 12, fontWeight: 700 }}>A4 画布</div><span style={{ color: '#718894', fontSize: 10 }}>拖动版块调整位置</span></div>
        <div aria-label="加工单拖拽画布" onPointerMove={moveBlock} onPointerUp={() => setDrag(null)} style={{ background: '#edf5f8', border: '1px solid #cfe0e7', borderRadius: 8, height: 220, overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
          {(['header', 'table', 'footer'] as LayoutKey[]).map((key) => { const labels: Record<LayoutKey, string> = { header: '页眉 · 客户与日期', table: '明细表 · BOM', footer: '页脚' }; const offset = template.layout[key]; const style = key === 'header' ? { left: 18, top: 16 } : key === 'table' ? { left: 18, top: 72 } : { left: 18, top: 188 }; return <div key={key} onPointerDown={(event) => { if (disabled) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ key, startX: event.clientX, startY: event.clientY, x: offset.x, y: offset.y }); }} style={{ background: key === 'table' ? '#fff' : '#dff0f6', border: '1px solid #8dbed0', borderRadius: 5, color: '#216986', cursor: disabled ? 'default' : 'grab', fontSize: 10, left: style.left + offset.x * 1.25, minHeight: key === 'table' ? 88 : 34, padding: '8px 9px', position: 'absolute', top: style.top + offset.y * 1.25, width: key === 'table' ? 'calc(100% - 36px)' : 'calc(100% - 36px)' }}>{labels[key]}</div>; })}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>表格列</div>
          <span style={{ color: '#687172', fontSize: 10 }}>必需列不能隐藏或删除</span>
        </div>
        <div style={{ border: '1px solid #e2e8e4', borderRadius: 5, overflow: 'hidden' }}>
          {template.columns.map((column, index) => (
            <div key={column.id} style={{ alignItems: 'center', borderBottom: index === template.columns.length - 1 ? 0 : '1px solid #edf0ee', display: 'grid', gap: 7, gridTemplateColumns: '22px minmax(0,1fr) 52px 64px 42px', minHeight: 43, padding: '5px 7px' }}>
              <div style={{ display: 'grid', gap: 1 }}>
                <button aria-label={`上移 ${column.label}`} disabled={disabled || index === 0} onClick={() => onChange(moveColumn(template, column.id, -1))} style={{ background: 'transparent', border: 0, color: '#687172', height: 15, padding: 0 }} type="button"><ArrowUp size={13} /></button>
                <button aria-label={`下移 ${column.label}`} disabled={disabled || index === template.columns.length - 1} onClick={() => onChange(moveColumn(template, column.id, 1))} style={{ background: 'transparent', border: 0, color: '#687172', height: 15, padding: 0 }} type="button"><ArrowDown size={13} /></button>
              </div>
              <input aria-label={`${column.label}列名`} disabled={disabled} onChange={(event) => onChange(updateColumn(template, column.id, { label: event.target.value }))} style={{ ...inputStyle, height: 29 }} value={column.label} />
              <input aria-label={`${column.label}列宽百分比`} disabled={disabled} max={60} min={4} onChange={(event) => onChange(updateColumn(template, column.id, { width: Number(event.target.value) }))} style={{ ...inputStyle, height: 29 }} type="number" value={column.width} />
              <select aria-label={`${column.label}对齐`} disabled={disabled} onChange={(event) => onChange(updateColumn(template, column.id, { align: event.target.value as WorkOrderColumn['align'] }))} style={{ ...inputStyle, height: 29, padding: '0 4px' }} value={column.align}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select>
              <label style={{ color: column.required ? '#687172' : '#172022', fontSize: 10, textAlign: 'center' }}><input aria-label={`${column.label}显示`} checked={column.visible} disabled={disabled || column.required} onChange={(event) => onChange(updateColumn(template, column.id, { visible: event.target.checked }))} type="checkbox" /> 显示</label>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
