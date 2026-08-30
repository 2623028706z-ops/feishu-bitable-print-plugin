# Work Order Pagination And Category Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从“成品档案表”的单选“品类”稳定回填订单，并让任意长度加工单按独立 A4 页面完整输出。

**Architecture:** 数据侧保留飞书完整字段元数据，批量构建成品档案索引，按订单直读、关联记录、编码、名称的顺序解析品类并返回诊断。打印侧把聚合订单先展平为可分页行，再按真实页面容量生成 `WorkOrderPage[]`，React 每页渲染一个固定 A4 节点，不依赖浏览器自动重复表头或 CSS 页码。

**Tech Stack:** React 18.3、TypeScript 5.7、Vite 6、Vitest 2.1、Semi UI 2.102、飞书多维表格 JS SDK 1.0.2、Chrome Print-to-PDF。

---

## File Map

- Modify `src/lib/feishu-adapter.ts`: preserve field metadata, load and index 成品档案表, resolve the single-select category, return diagnostics.
- Modify `src/lib/feishu-adapter.test.ts`: cover single-select wrappers, link/code/name fallbacks, ambiguity, and one-time loading.
- Create `src/features/print/work-order-pagination.ts`: pure page metrics, row flattening, height estimation input, grouping, and continuation page model.
- Create `src/features/print/work-order-pagination.test.ts`: cover boundaries, bouquet grouping, continuation rows, and final-row preservation.
- Modify `src/features/print/WorkOrderPrintDocument.tsx`: render one article per generated page with repeated metadata, table header, and explicit page number.
- Modify `src/features/print/WorkOrderPrintDocument.test.ts`: cover template migration and rendered page invariants.
- Modify `src/features/work-order/WorkOrderEditor.tsx`: remove duplicate stat/footer controls and group common versus advanced controls.
- Modify `src/App.tsx`: store category diagnostics, show filter feedback, and report actual A4 page count.
- Modify `src/styles.css`: apply the sky-blue token set, compact diagnostics, A4 page stack, print page breaks, wrapping, and responsive editing layout.

## Dependency Graph And Parallel Lanes

```text
Lane A: category adapter + adapter tests ─────────────┐
                                                     ├─ App integration ─ final verification
Lane B: pagination model + model tests ─ document ───┤
Lane C: editor/style audit ──────────────────────────┘
```

Lane A owns only `src/lib/feishu-adapter.ts` and its test. Lane B owns only print files. Lane C owns `WorkOrderEditor.tsx` and records proposed CSS selectors; the main controller alone edits `App.tsx` and `styles.css` after both contracts are stable.

### Task 1: Resolve Category From 成品档案表

**Files:**
- Modify: `src/lib/feishu-adapter.ts`
- Test: `src/lib/feishu-adapter.test.ts`

- [ ] **Step 1: Add failing single-select and fallback tests**

Add fixtures where the sales record has no category and the product table is named `成品档案表`. Cover direct linked product, code fallback, name fallback, duplicate-name ambiguity, an empty preferred alias followed by a populated alias, and a wrapper such as:

```ts
fld_category: { value: { id: 'opt_flower', name: '鲜花花束' } }
```

Assert the result carries visible text rather than `opt_flower`, and assert the product table's `getRecordsByPage` is called once for multiple sales orders.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- --run src/lib/feishu-adapter.test.ts`

Expected: FAIL because `成品档案表` is not a product table candidate and category is only read from the sales record.

- [ ] **Step 3: Preserve metadata and define a diagnostic contract**

Extend `RawFieldMeta` with `type?: unknown`, keep `metas` in `fieldLabels`, and add:

```ts
export type CategoryDiagnostic = {
  code: 'table-missing' | 'field-missing' | 'field-ambiguous' | 'product-unmatched';
  message: string;
};

type CategoryResolution = {
  value: string;
  source: 'sales' | 'linked-product' | 'product-code' | 'product-name' | 'none';
  diagnostic?: CategoryDiagnostic;
};
```

The loader return type becomes:

```ts
Promise<{
  orders: PrintOrder[];
  source: string;
  tableName: string;
  columns: string[];
  diagnostics: CategoryDiagnostic[];
}>
```

Preserve the existing user change that returns `columns`; do not replace or remove it.

- [ ] **Step 4: Implement one-time product archive indexing**

Add `成品档案表` at the front of `PRODUCT_TABLE_NAMES`. Resolve the exact `品类` field first and validate it as a single-select-compatible field using metadata when the SDK supplies a type. Load archive records once and build:

```ts
type ProductArchiveEntry = {
  recordId: string;
  code: string;
  name: string;
  category: string;
};

type ProductArchiveIndex = {
  byRecordId: Map<string, ProductArchiveEntry>;
  byCode: Map<string, ProductArchiveEntry>;
  byName: Map<string, ProductArchiveEntry[]>;
};
```

Parse display text in the order `value`, `displayValue`, `text`, `name`, `label`. Never use `id`, `recordId`, or `recordIds` as a category label.

- [ ] **Step 5: Resolve each order in the confirmed priority order**

Use sales category, linked archive record, normalized code, then normalized name. An ambiguous name produces `product-unmatched` rather than selecting the first item. Empty alias fields must fall through to the next candidate with a value.

- [ ] **Step 6: Run focused and full adapter tests**

Run: `npm test -- --run src/lib/feishu-adapter.test.ts`

Expected: PASS, including a single archive-table load for multiple orders.

- [ ] **Step 7: Commit the category slice**

```bash
git add src/lib/feishu-adapter.ts src/lib/feishu-adapter.test.ts
git commit -m "fix: resolve category from product archive"
```

### Task 2: Build A Pure Work-Order Pagination Model

**Files:**
- Create: `src/features/print/work-order-pagination.ts`
- Create: `src/features/print/work-order-pagination.test.ts`

- [ ] **Step 1: Write failing pagination boundary tests**

Use synthetic row heights so tests are deterministic. Assert: exact-fit rows stay on the page, a bouquet group moves intact when it fits on a fresh page, a group taller than one page splits between recipe rows, the first continued row uses `continued: true`, and the final row appears exactly once.

```ts
const pages = paginateWorkOrderRows(groups, {
  pageBodyHeightMm: 120,
  rowHeightMm: (row) => row.id === 'long' ? 70 : 30,
});

expect(pages.flatMap((page) => page.rows).map((row) => row.id))
  .toEqual(['a', 'b', 'long', 'last']);
```

- [ ] **Step 2: Run the new test and confirm failure**

Run: `npm test -- --run src/features/print/work-order-pagination.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Define page and row models**

```ts
export type WorkOrderPageRow = {
  id: string;
  order: PrintOrder;
  recipeIndex: number;
  bouquetStart: boolean;
  continued: boolean;
};

export type WorkOrderPage = {
  number: number;
  total: number;
  rows: WorkOrderPageRow[];
};
```

Expose a pure `flattenWorkOrderGroups()` and `paginateWorkOrderRows()`. The paginator accepts measured or deterministic row heights and reserves the same header and table-header height on every page.

- [ ] **Step 4: Implement group-aware pagination**

Keep a complete bouquet group together when its measured height is less than a fresh page capacity. Split oversized groups only between recipe rows and set `continued` on the first row of every later chunk. Always advance the cursor, even when one row exceeds capacity, so malformed dimensions cannot create an infinite loop.

- [ ] **Step 5: Pass pagination tests**

Run: `npm test -- --run src/features/print/work-order-pagination.test.ts`

Expected: PASS for exact boundary, grouped move, continuation, over-height row guard, empty input, and last-row preservation.

- [ ] **Step 6: Commit the pure model**

```bash
git add src/features/print/work-order-pagination.ts src/features/print/work-order-pagination.test.ts
git commit -m "feat: add deterministic work order pagination"
```

### Task 3: Render Explicit A4 Pages

**Files:**
- Modify: `src/features/print/WorkOrderPrintDocument.tsx`
- Modify: `src/features/print/WorkOrderPrintDocument.test.ts`
- Use: `src/features/print/work-order-pagination.ts`

- [ ] **Step 1: Add failing document invariants**

Render enough recipe rows for at least two pages and assert each `.work-order-page` contains `.wo-title`, `.wo-customer`, `.wo-ship-date`, one table header, and text matching `第 N / M 页`. Assert the last material and a continued bouquet label are present.

- [ ] **Step 2: Run the focused document tests and confirm failure**

Run: `npm test -- --run src/features/print/WorkOrderPrintDocument.test.ts`

Expected: FAIL because the component currently emits one fixed-height article and a CSS counter page number.

- [ ] **Step 3: Replace the monolithic article with a page list**

Render one fixed-size article per `WorkOrderPage`:

```tsx
<section className="work-order-document" data-page-count={pages.length}>
  {pages.map((page) => (
    <article className="work-order-page" key={page.number}>
      <WorkOrderPageHeader customer={customer} shipDate={shipDate} />
      <WorkOrderPageTable page={page} columns={visibleColumns} />
      <div className="wo-page-number">第 {page.number} / {page.total} 页</div>
    </article>
  ))}
</section>
```

Remove the kicker, statistics block, explanatory footer, `rowSpan` across pages, CSS counter, and print-time repeated-customer table row.

- [ ] **Step 4: Use exact layout measurement before pagination**

Render an offscreen measurement table with the same column widths, font, line-height, and cell padding. In `useLayoutEffect`, read each row's `getBoundingClientRect().height`, convert pixels to millimetres using a measured `100mm` reference element, and feed those heights into the pure paginator. If fonts are still loading, wait for `document.fonts.ready` and recalculate once. While measurement is pending, disable printing and show a short “正在计算分页” status instead of printing stale geometry.

If a single measured recipe row exceeds the page body, split its longest text field by grapheme boundaries with binary search against the measurement row. Mark later fragments as continued; never apply `overflow: hidden`, ellipsis, line clamp, or font-size reduction.

- [ ] **Step 5: Restrict transforms to screen editing**

Interactive offsets may affect the first screen preview, but `.work-order-page` and all descendants must have `transform: none` in print media. Each page gets physical A4 dimensions and `break-after: page`; the last page removes the trailing break.

- [ ] **Step 6: Pass focused tests and build**

Run: `npm test -- --run src/features/print/WorkOrderPrintDocument.test.ts src/features/print/work-order-pagination.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: TypeScript and Vite build complete with exit code 0.

- [ ] **Step 7: Commit the document slice**

```bash
git add src/features/print/WorkOrderPrintDocument.tsx src/features/print/WorkOrderPrintDocument.test.ts src/features/print/work-order-pagination.ts src/features/print/work-order-pagination.test.ts
git commit -m "fix: paginate work orders into complete A4 pages"
```

### Task 4: Simplify The Work-Order Editor And Integrate Diagnostics

**Files:**
- Modify: `src/features/work-order/WorkOrderEditor.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Remove controls for deleted print content**

Remove the `stat` editor region, kicker input, show-order-count switch, explanatory footer text, and footer-position controls. Keep title, customer, ship date, six columns, page number, font family, font weight, sizes, margins, borders, colors, widths, order, visibility, and alignment.

- [ ] **Step 2: Separate common and advanced settings**

Common settings contain template name, A4 direction, page margins, font, body size, customer size, title, and column widths. Put border style/color, header background, fine alignment, and screen-only offsets in one collapsed Semi UI section labelled `高级设置`. Do not add dependencies.

- [ ] **Step 3: Integrate category diagnostics and page readiness**

Initialize `diagnostics` from `loadFeishuOrders()`, preserve `columns`, and show at most one compact issue row under the category selector. Valid category options remain derived from all loaded orders. Disable the print button while work-order measurement is pending; replace the preview toolbar's generic `A4` text with orientation, actual page count, and date.

- [ ] **Step 4: Apply the confirmed sky-blue design tokens**

Replace green brand tokens and hard-coded green editor colors with a restrained sky-blue action palette and neutral cool grays. Keep A4 output mostly black and white; use only a pale blue table header and blue metadata accent. Remove dotted decorative canvas styling for the work-order view and use a quiet neutral page stage with clear page separation.

- [ ] **Step 5: Verify responsive layout and interaction states**

At 1440×900, 1024×768, and 390×844, confirm labels fit, controls do not overlap, the advanced section is closed by default, focus rings are visible, and horizontal A4 preview scrolls without scaling the printed document.

- [ ] **Step 6: Run full tests and build**

Run: `npm test -- --run`

Expected: all tests pass.

Run: `npm run build`

Expected: build exits 0 without unresolved imports or type errors.

- [ ] **Step 7: Commit the integration slice**

```bash
git add src/features/work-order/WorkOrderEditor.tsx src/App.tsx src/styles.css
git commit -m "refactor: simplify work order print controls"
```

### Task 5: Browser And PDF Acceptance

**Files:**
- Verify only; no source edit unless a test exposes a defect.

- [ ] **Step 1: Start the production preview**

Run: `npm run build && npm run preview -- --host 127.0.0.1`

Expected: Vite prints a local preview URL and remains running for browser checks.

- [ ] **Step 2: Smoke-test the real plugin page**

Use the established BrowserHarness with the existing browser profile. Verify today/date-range filtering, category selection from 成品档案表, customer/date grouping, common/advanced editor controls, and print-button readiness. Record structured results by target selector rather than relying only on screenshots.

- [ ] **Step 3: Generate long horizontal and vertical A4 PDFs**

Use Chrome Print-to-PDF with fixtures containing multiple bouquets, one oversized bouquet, long material names, and a long note. Generate both A4 landscape and portrait outputs with browser scale at 100%.

- [ ] **Step 4: Inspect physical pages and extracted text**

Run `pdfinfo <output.pdf>` and verify A4 page size and expected orientation. Extract text and assert every page contains customer, ship date, table headings, and `第 N / M 页`; assert the first material, continuation material, and final material each appear.

- [ ] **Step 5: Run final regression gates**

Run: `npm test -- --run && npm run build`

Expected: all tests and the build pass after browser/PDF findings are incorporated.

- [ ] **Step 6: Review the diff before deployment**

Confirm no configuration table was created, no dependency was added, label BOM/geometry files were not changed unintentionally, and the pre-existing `columns` change in `feishu-adapter.ts` remains intact.

## Final Checkpoint

- [ ] Category options populate when only 成品档案表 has the single-select 品类.
- [ ] Archive loading is batched and does not issue one request per order.
- [ ] Ambiguous or missing fields produce a visible diagnosis instead of a false category.
- [ ] Every A4 page repeats title, customer, ship date, six headings, and explicit page number.
- [ ] Long content continues to later pages without clipping, ellipsis, or font shrinking.
- [ ] Landscape and portrait PDF MediaBox values are correct.
- [ ] Full tests, build, desktop/mobile browser smoke, and PDF text checks pass before deployment.

## Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 飞书不同宿主返回的单选包装结构不一致 | 品类仍为空或显示 ID | 元数据加结构化解析测试；显示字段白名单；ID 字段黑名单 |
| 成品档案有重复编码或名称 | 回填到错误品类 | 编码要求唯一；名称多候选时停止并诊断 |
| Web 字体加载后行高变化 | 页尾内容越界 | 等待 `document.fonts.ready` 后重新测量并锁定打印按钮 |
| 单条备注高于整页 | 行无法放入页面 | 按 grapheme 边界二分拆分文本，并生成续行 |
| Chrome 打印对 `@page` 支持差异 | 页面方向或边距不一致 | 每页固定毫米尺寸；命名和默认 `@page` 同时定义；以 PDF MediaBox 实测 |
| 并行修改冲突 | 覆盖用户现有 adapter 改动 | 文件所有权隔离；`App.tsx` 和 `styles.css` 只由主控最后集成 |

## Open Questions

无。规格中的数据来源、单选类型、关联优先级、A4 字段和分页行为均已确认。
