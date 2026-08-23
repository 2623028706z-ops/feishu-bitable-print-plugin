# Shared Print Template Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Rebuild the Feishu print plugin with safe label quantities, shared Base templates, a Konva label editor, editable A4 work orders, searchable filters, and isolated print documents.

**Architecture:** Keep the existing Feishu order/recipe adapter as the business-data boundary. Add pure versioned template and print-safety domains, then build isolated feature components around them. The app orchestrates data, filters, template persistence, editing and printing; label and A4 documents never share paper/layout logic.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Feishu Bitable JS SDK, react-konva/Konva, react-to-print, react-select, JsBarcode.

---

### Task 1: Safe quantity and versioned template domains

**Files:**
- Create: `src/domain/print-safety.ts`
- Create: `src/domain/print-safety.test.ts`
- Create: `src/domain/templates.ts`
- Create: `src/domain/templates.test.ts`

- [ ] Write failing tests for clamping fixed copies to 1-500, blocking totals above 5000, limiting previews to 100, repairing legacy 10000 storage, clamping label elements to paper bounds, and validating required A4 columns.
- [ ] Run `npm test -- --run src/domain/print-safety.test.ts src/domain/templates.test.ts` and confirm the missing modules fail.
- [ ] Implement pure constants, normalization, geometry, defaults, schema guards and migration helpers without React or SDK dependencies.
- [ ] Run the focused tests and then `npm test -- --run`.

### Task 2: Shared Base template repository

**Files:**
- Create: `src/infrastructure/template-repository.ts`
- Create: `src/infrastructure/template-repository.test.ts`

- [ ] Write mocked SDK tests for missing-table read fallback, list/create/update/copy/delete, default-template uniqueness, permission errors and optimistic version conflicts.
- [ ] Run the focused test and confirm it fails before implementation.
- [ ] Implement a repository for the `打印模板配置` table using versioned JSON and stable template IDs; do not store secrets or modify the sales-order table.
- [ ] Run focused and full tests.

### Task 3: Searchable multi-select filters

**Files:**
- Create: `src/features/filters/SearchMultiSelect.tsx`
- Create: `src/features/filters/filter-options.ts`

- [ ] Implement one accessible react-select wrapper for customers, categories and products with search, multi-select, clear, selected count and Chinese empty text.
- [ ] Preserve existing filter semantics: OR within one dimension, AND across dimensions, empty means no filter.
- [ ] Verify TypeScript build and keyboard-accessible labels.

### Task 4: Konva label editor and DOM print document

**Files:**
- Create: `src/features/label-editor/LabelEditor.tsx`
- Create: `src/features/label-editor/LabelElementRenderer.tsx`
- Create: `src/features/print/LabelPrintDocument.tsx`
- Create: `src/features/print/BarcodeSvg.tsx`

- [ ] Render one representative order in Konva with six fixed field types.
- [ ] Support selection, drag, resize, bounds, visibility and basic typography, writing millimetre coordinates back to the template.
- [ ] Ensure barcode and visible code bind only to `order.productCode`; no recipe access and no order-number fallback.
- [ ] Render print labels as DOM/SVG using absolute millimetre positions, custom paper/grid settings and a maximum 100-label screen preview.
- [ ] Verify build and browser interaction.

### Task 5: Editable A4 template and print document

**Files:**
- Create: `src/features/work-order/WorkOrderEditor.tsx`
- Create: `src/features/print/WorkOrderPrintDocument.tsx`

- [ ] Add simple structured controls for template/title name, orientation, margins, fonts, sizes, weights, alignment, table borders, column labels/order/width/visibility, header/footer and repeated table header.
- [ ] Render real customers, real ship dates and BOM recipe rows using the existing aggregation contract.
- [ ] Keep required columns validated and keep A4 independent from label dimensions and Konva.
- [ ] Verify A4 landscape/portrait rendering and pagination build.

### Task 6: App integration, template management and print isolation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/lib/print-model.ts`
- Modify: `src/lib/print-model.test.ts`
- Modify: `README.md`

- [ ] Replace the fixed filter lists with searchable selects and normalize legacy local storage before first render.
- [ ] Integrate shared template list, create/copy/rename/save/delete/default/reset actions, read-only permission states and conflict messages.
- [ ] Show recipe issues only in work-order mode; labels remain independent of BOM.
- [ ] Use react-to-print refs for separate hidden label and A4 documents; block unsafe totals and show preview truncation.
- [ ] Simplify the left control panel and editor toolbar, with print as the only primary action.
- [ ] Run full tests, build, diff check, dependency audit, browser smoke checks and PDF/print-media verification.

### Task 7: Release

**Files:**
- Generated: `dist/**`

- [ ] Review the final diff for correctness, performance, security and missing requirements.
- [ ] Confirm no secrets, no order-number barcode fallback, no label BOM access and no unbounded label expansion.
- [ ] Commit source changes, push `main`, deploy built files to `gh-pages`, wait for Pages status `built`, and verify the new asset hashes online.
- [ ] Keep the previous Pages commit as the rollback target and report any remaining browser/driver limitations.
