import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { Button, ColorPicker, Input, InputNumber, Select, Switch } from '@douyinfe/semi-ui';
import {
  createDefaultWorkOrderTemplate,
  normalizeWorkOrderTemplate,
  type WorkOrderColumn,
  type WorkOrderColumnId,
  type WorkOrderRegion,
  type WorkOrderTemplate,
} from '../print/WorkOrderPrintDocument';

export type WorkOrderEditorProps = {
  value: WorkOrderTemplate;
  onChange: (template: WorkOrderTemplate) => void;
  onReset?: () => void;
  disabled?: boolean;
  region?: WorkOrderRegion;
  onSelectRegion?: (region: WorkOrderRegion) => void;
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

type RegionKey = Exclude<WorkOrderRegion, `col:${string}`>;

const REGION_META: Record<RegionKey, { label: string; hint: string }> = {
  page: { label: '纸张', hint: '纸张方向、页边距、字体与全局样式' },
  header: { label: '页眉', hint: '页眉整体显隐与小标题、位置微调' },
  title: { label: '标题', hint: '打印标题文字、字号与对齐' },
  meta: { label: '客户行', hint: '客户与出货日期的显示与字号' },
  stat: { label: '统计', hint: '右上角扎数 / 款数 / 单数统计块' },
  table: { label: '明细表', hint: '表格边框、表头、单元格与位置微调' },
  footer: { label: '页脚', hint: '页脚说明文字与页码' },
};

const REGION_ORDER: RegionKey[] = ['page', 'header', 'title', 'meta', 'stat', 'table', 'footer'];

function regionKeyOf(region: WorkOrderRegion): RegionKey {
  return region.startsWith('col:') ? 'table' : (region as RegionKey);
}

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

const FONT_OPTIONS = [
  ['Microsoft YaHei, 微软雅黑, sans-serif', '微软雅黑'],
  ['PingFang SC, 苹方, sans-serif', '苹方'],
  ['Noto Sans CJK SC, sans-serif', '思源黑体'],
  ['SimSun, 宋体, serif', '宋体'],
  ['Arial, sans-serif', 'Arial'],
  ['sans-serif', '系统无衬线'],
] as const;

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
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <InputNumber
        aria-label={label}
        disabled={disabled}
        hideButtons
        max={max}
        min={min}
        onChange={(next) => onChange(Number(next))}
        size="small"
        step={step}
        style={{ width: '100%' }}
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
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <Input aria-label={label} disabled={disabled} onChange={(next) => onChange(next)} size="small" value={value} />
    </label>
  );
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const trigger = (
    <div aria-label={label} role="button" style={{ alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 5, cursor: disabled ? 'default' : 'pointer', display: 'flex', gap: 7, height: 30, opacity: disabled ? 0.6 : 1, padding: '0 8px' }}>
      <span style={{ background: value, border: '1px solid rgba(0,0,0,.12)', borderRadius: 4, display: 'inline-block', height: 16, width: 16 }} />
      <span style={{ color: 'var(--ink)', fontSize: 11, letterSpacing: '.02em', textTransform: 'uppercase' }}>{value}</span>
    </div>
  );
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      {disabled ? trigger : (
        <ColorPicker
          alpha={false}
          usePopover
          value={ColorPicker.colorStringToValue(value)}
          onChange={(next) => onChange(next.hex)}
          popoverProps={{ zIndex: 1100 }}
        >
          {trigger}
        </ColorPicker>
      )}
    </label>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ alignItems: 'center', display: 'flex', fontSize: 12, justifyContent: 'space-between', minHeight: 30 }}>
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} disabled={disabled} onChange={(next) => onChange(next)} size="small" />
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

function updateLayout(template: WorkOrderTemplate, key: 'header' | 'table' | 'footer', axis: 'x' | 'y', value: number): WorkOrderTemplate {
  const valid = Number.isFinite(value) ? value : 0;
  return normalizeWorkOrderTemplate({ ...template, layout: { ...template.layout, [key]: { ...template.layout[key], [axis]: valid } } });
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
export function WorkOrderEditor({ value, onChange, onReset, disabled = false, region = 'page', onSelectRegion }: WorkOrderEditorProps) {
  const template = normalizeWorkOrderTemplate(value);
  const activeKey = regionKeyOf(region);
  const activeColumnId = region.startsWith('col:') ? (region.slice(4) as WorkOrderColumnId) : null;
  const patch = (next: Partial<WorkOrderTemplate>) => onChange(normalizeWorkOrderTemplate({ ...template, ...next }));
  const select = (next: WorkOrderRegion) => onSelectRegion?.(next);
  const reset = () => {
    if (onReset) onReset();
    else onChange(createDefaultWorkOrderTemplate());
  };

  return (
    <section aria-label="加工单模板设置" style={editorStyle}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>加工单模板</div>
          <div style={{ color: '#687172', fontSize: 10, marginTop: 3 }}>点画布任意区域即可编辑对应字段</div>
        </div>
        <Button aria-label="恢复默认加工单模板" disabled={disabled} icon={<RotateCcw size={15} />} onClick={reset} size="small" theme="borderless" type="tertiary">重置</Button>
      </div>

      <div role="tablist" aria-label="选择编辑区域" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {REGION_ORDER.map((key) => {
          const on = activeKey === key;
          return (
            <Button key={key} role="tab" aria-selected={on} disabled={disabled} onClick={() => select(key)} size="small" theme={on ? 'solid' : 'borderless'} type={on ? 'primary' : 'tertiary'} style={{ borderRadius: 6, fontSize: 11 }}>{REGION_META[key].label}</Button>
          );
        })}
      </div>

      <div style={{ background: '#f3f7f4', border: '1px solid #e2ece5', borderRadius: 6, color: '#4c5d53', fontSize: 10.5, lineHeight: 1.5, padding: '7px 9px' }}>{REGION_META[activeKey].hint}</div>

      {activeKey === 'page' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <TextInput disabled={disabled} label="模板名称" onChange={(name) => patch({ name })} value={template.name} />
          <label style={labelStyle}>
            <span>页面方向</span>
            <Select aria-label="页面方向" disabled={disabled} onChange={(value) => patch({ orientation: value as WorkOrderTemplate['orientation'] })} optionList={[{ value: 'landscape', label: 'A4 横向' }, { value: 'portrait', label: 'A4 纵向' }]} size="small" style={{ width: '100%' }} value={template.orientation} />
          </label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="上边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.top', number))} value={template.marginsMm.top} />
            <NumberInput disabled={disabled} label="下边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.bottom', number))} value={template.marginsMm.bottom} />
            <NumberInput disabled={disabled} label="左边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.left', number))} value={template.marginsMm.left} />
            <NumberInput disabled={disabled} label="右边距 (mm)" max={40} onChange={(number) => onChange(updateNumber(template, 'marginsMm.right', number))} value={template.marginsMm.right} />
          </div>
          <label style={labelStyle}><span>字体</span><Select aria-label="字体" disabled={disabled} onChange={(value) => patch({ typography: { ...template.typography, fontFamily: value as string } })} optionList={FONT_OPTIONS.map(([value, label]) => ({ value, label }))} size="small" style={{ width: '100%' }} value={template.typography.fontFamily} /></label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <label style={labelStyle}><span>字重</span><Select aria-label="字重" disabled={disabled} onChange={(value) => onChange(updateNumber(template, 'typography.fontWeight', Number(value)))} optionList={[{ value: 400, label: '常规' }, { value: 500, label: '中等' }, { value: 600, label: '半粗' }, { value: 700, label: '粗体' }]} size="small" style={{ width: '100%' }} value={template.typography.fontWeight} /></label>
            <NumberInput disabled={disabled} label="行高" max={2.5} min={0.8} onChange={(number) => onChange(updateNumber(template, 'typography.lineHeight', number))} step={0.05} value={template.typography.lineHeight} />
          </div>
          <Toggle checked={template.header.visible} disabled={disabled} label="显示页眉" onChange={(visible) => patch({ header: { ...template.header, visible } })} />
          <Toggle checked={template.footer.visible} disabled={disabled} label="显示页脚" onChange={(visible) => patch({ footer: { ...template.footer, visible } })} />
        </div>
      )}

      {activeKey === 'header' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Toggle checked={template.header.visible} disabled={disabled} label="显示页眉" onChange={(visible) => patch({ header: { ...template.header, visible } })} />
          <TextInput disabled={disabled || !template.header.visible} label="页眉小标题" onChange={(kicker) => patch({ header: { ...template.header, kicker } })} value={template.header.kicker} />
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="水平偏移 (mm)" max={10} min={-10} onChange={(number) => onChange(updateLayout(template, 'header', 'x', number))} step={0.5} value={template.layout.header.x} />
            <NumberInput disabled={disabled} label="垂直偏移 (mm)" max={10} min={-10} onChange={(number) => onChange(updateLayout(template, 'header', 'y', number))} step={0.5} value={template.layout.header.y} />
          </div>
        </div>
      )}

      {activeKey === 'title' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <TextInput disabled={disabled} label="打印标题" onChange={(title) => patch({ title })} value={template.title} />
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="标题字号 (mm)" max={15} min={3} onChange={(number) => onChange(updateNumber(template, 'typography.titleSizeMm', number))} step={0.1} value={template.typography.titleSizeMm} />
            <label style={labelStyle}><span>标题对齐</span><Select aria-label="标题对齐" disabled={disabled} onChange={(value) => patch({ typography: { ...template.typography, align: value as WorkOrderTemplate['typography']['align'] } })} optionList={[{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]} size="small" style={{ width: '100%' }} value={template.typography.align} /></label>
          </div>
        </div>
      )}

      {activeKey === 'meta' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Toggle checked={template.header.showCustomer} disabled={disabled} label="显示客户名称" onChange={(showCustomer) => patch({ header: { ...template.header, showCustomer } })} />
          <Toggle checked={template.header.showShipDate} disabled={disabled} label="显示出货日期" onChange={(showShipDate) => patch({ header: { ...template.header, showShipDate } })} />
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="客户字号 (mm)" max={12} min={2} onChange={(number) => onChange(updateNumber(template, 'typography.customerSizeMm', number))} step={0.1} value={template.typography.customerSizeMm} />
            <NumberInput disabled={disabled} label="日期字号 (mm)" max={8} min={1.5} onChange={(number) => onChange(updateNumber(template, 'typography.metaSizeMm', number))} step={0.1} value={template.typography.metaSizeMm} />
          </div>
        </div>
      )}

      {activeKey === 'stat' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Toggle checked={template.header.showOrderCount} disabled={disabled} label="显示统计（扎数 / 款数 / 单数）" onChange={(showOrderCount) => patch({ header: { ...template.header, showOrderCount } })} />
          <NumberInput disabled={disabled} label="统计说明字号 (mm)" max={8} min={1.5} onChange={(number) => onChange(updateNumber(template, 'typography.metaSizeMm', number))} step={0.1} value={template.typography.metaSizeMm} />
        </div>
      )}

      {activeKey === 'footer' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Toggle checked={template.footer.visible} disabled={disabled} label="显示页脚" onChange={(visible) => patch({ footer: { ...template.footer, visible } })} />
          <TextInput disabled={disabled || !template.footer.visible} label="页脚说明文字" onChange={(text) => patch({ footer: { ...template.footer, text } })} value={template.footer.text} />
          <Toggle checked={template.footer.showPageNumber} disabled={disabled || !template.footer.visible} label="显示页码" onChange={(showPageNumber) => patch({ footer: { ...template.footer, showPageNumber } })} />
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="水平偏移 (mm)" max={10} min={-10} onChange={(number) => onChange(updateLayout(template, 'footer', 'x', number))} step={0.5} value={template.layout.footer.x} />
            <NumberInput disabled={disabled} label="垂直偏移 (mm)" max={10} min={-10} onChange={(number) => onChange(updateLayout(template, 'footer', 'y', number))} step={0.5} value={template.layout.footer.y} />
          </div>
        </div>
      )}

      {activeKey === 'table' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="正文字号 (mm)" max={10} min={1.5} onChange={(number) => onChange(updateNumber(template, 'typography.bodySizeMm', number))} step={0.1} value={template.typography.bodySizeMm} />
            <NumberInput disabled={disabled} label="单元格内边距 (mm)" max={10} onChange={(number) => onChange(updateNumber(template, 'table.cellPaddingMm', number))} step={0.1} value={template.table.cellPaddingMm} />
            <NumberInput disabled={disabled} label="边框粗细 (mm)" max={2} min={0} onChange={(number) => onChange(updateNumber(template, 'table.borderWidthMm', number))} step={0.05} value={template.table.borderWidthMm} />
            <label style={labelStyle}><span>边框线型</span><Select aria-label="边框线型" disabled={disabled} onChange={(value) => patch({ table: { ...template.table, borderStyle: value as WorkOrderTemplate['table']['borderStyle'] } })} optionList={[{ value: 'solid', label: '实线' }, { value: 'dashed', label: '虚线' }, { value: 'dotted', label: '点线' }]} size="small" style={{ width: '100%' }} value={template.table.borderStyle} /></label>
            <ColorField disabled={disabled} label="边框颜色" onChange={(borderColor) => patch({ table: { ...template.table, borderColor } })} value={template.table.borderColor} />
            <ColorField disabled={disabled} label="表头背景" onChange={(headerBackground) => patch({ table: { ...template.table, headerBackground } })} value={template.table.headerBackground} />
          </div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <NumberInput disabled={disabled} label="表格水平偏移 (mm)" max={10} min={-10} onChange={(number) => onChange(updateLayout(template, 'table', 'x', number))} step={0.5} value={template.layout.table.x} />
            <NumberInput disabled={disabled} label="表格垂直偏移 (mm)" max={10} min={-10} onChange={(number) => onChange(updateLayout(template, 'table', 'y', number))} step={0.5} value={template.layout.table.y} />
          </div>

          <div style={{ ...sectionStyle, gap: 8 }}>
            <div style={{ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>表格列</div>
              <span style={{ color: '#687172', fontSize: 10 }}>点表头选中列 · 必需列不能隐藏</span>
            </div>
            <div style={{ border: '1px solid #e2e8e4', borderRadius: 5, overflow: 'hidden' }}>
              {template.columns.map((column, index) => {
                const on = activeColumnId === column.id;
                return (
                  <div key={column.id} onClick={() => select(`col:${column.id}`)} style={{ alignItems: 'center', background: on ? '#eef6f0' : undefined, borderBottom: index === template.columns.length - 1 ? 0 : '1px solid #edf0ee', boxShadow: on ? 'inset 2px 0 0 var(--brand, #2e7d5b)' : undefined, cursor: 'pointer', display: 'grid', gap: 7, gridTemplateColumns: '22px minmax(0,1fr) 52px 64px 42px', minHeight: 43, padding: '5px 7px' }}>
                    <div style={{ display: 'grid', gap: 1 }}>
                      <Button aria-label={`上移 ${column.label}`} disabled={disabled || index === 0} icon={<ArrowUp size={13} />} onClick={(e) => { e.stopPropagation(); onChange(moveColumn(template, column.id, -1)); }} size="small" style={{ height: 15, minWidth: 0, padding: 0 }} theme="borderless" type="tertiary" />
                      <Button aria-label={`下移 ${column.label}`} disabled={disabled || index === template.columns.length - 1} icon={<ArrowDown size={13} />} onClick={(e) => { e.stopPropagation(); onChange(moveColumn(template, column.id, 1)); }} size="small" style={{ height: 15, minWidth: 0, padding: 0 }} theme="borderless" type="tertiary" />
                    </div>
                    <Input aria-label={`${column.label}列名`} disabled={disabled} onChange={(value) => onChange(updateColumn(template, column.id, { label: value }))} onClick={(e) => e.stopPropagation()} size="small" value={column.label} />
                    <InputNumber aria-label={`${column.label}列宽百分比`} disabled={disabled} hideButtons max={60} min={4} onChange={(value) => onChange(updateColumn(template, column.id, { width: Number(value) }))} onClick={(e) => e.stopPropagation()} size="small" style={{ width: '100%' }} value={column.width} />
                    <Select aria-label={`${column.label}对齐`} disabled={disabled} onChange={(value) => onChange(updateColumn(template, column.id, { align: value as WorkOrderColumn['align'] }))} optionList={[{ value: 'left', label: '左' }, { value: 'center', label: '中' }, { value: 'right', label: '右' }]} size="small" style={{ width: '100%' }} value={column.align} />
                    <label onClick={(e) => e.stopPropagation()} style={{ alignItems: 'center', color: '#687172', display: 'flex', fontSize: 10, gap: 3, justifyContent: 'center' }}><Switch aria-label={`${column.label}显示`} checked={column.visible} disabled={disabled || column.required} onChange={(value) => onChange(updateColumn(template, column.id, { visible: value }))} size="small" /></label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
