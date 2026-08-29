import type { PrintOrder } from '../../lib/print-model';

/** A recipe row in the explicit A4 work-order page model. */
export type WorkOrderPageRow = {
  /** Stable row key. Recipe rows use `<recordId>` for the first row and
   * `<recordId>:<recipeIndex>` for subsequent rows. */
  id: string;
  order: PrintOrder;
  recipeIndex: number;
  /** True for the first recipe row belonging to a bouquet. */
  bouquetStart: boolean;
  /** True when this is the first row of a continuation chunk. */
  continued: boolean;
};

export type WorkOrderPage = {
  number: number;
  total: number;
  rows: WorkOrderPageRow[];
};

/**
 * Pagination inputs are intentionally data-only. A nested array is accepted
 * because callers commonly group orders by customer/date before pagination;
 * each PrintOrder still remains an indivisible bouquet group until it is too
 * tall for a page.
 */
export type WorkOrderGroup = readonly PrintOrder[];

export type WorkOrderPaginationOptions = {
  /** Height available for table rows, in millimetres. */
  pageBodyHeightMm: number;
  /** Repeated header and table-header space reserved on every page. */
  headerHeightMm?: number;
  tableHeaderHeightMm?: number;
  /** Measured row height. The fallback is deliberately conservative. */
  rowHeightMm?: (row: WorkOrderPageRow) => number;
};

const EPSILON = 1e-7;
const DEFAULT_ROW_HEIGHT_MM = 10;

function finitePositive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function rowsForOrder(order: PrintOrder): WorkOrderPageRow[] {
  const recipeCount = order.recipe.length || 1;
  return Array.from({ length: recipeCount }, (_, recipeIndex) => ({
    id: recipeIndex === 0 ? order.recordId : `${order.recordId}:${recipeIndex}`,
    order,
    recipeIndex,
    bouquetStart: recipeIndex === 0,
    continued: false,
  }));
}

/**
 * Flatten grouped orders into one row per recipe line while retaining bouquet
 * boundaries. Empty/invalid groups are harmless and produce no rows.
 */
export function flattenWorkOrderGroups(groups: readonly WorkOrderGroup[]): WorkOrderPageRow[] {
  return groups.flatMap((group) => group.flatMap((order) => rowsForOrder(order)));
}

function orderGroups(rows: readonly WorkOrderPageRow[]): WorkOrderPageRow[][] {
  const groups: WorkOrderPageRow[][] = [];
  let current: WorkOrderPageRow[] = [];
  let currentRecordId: string | undefined;
  for (const row of rows) {
    const recordId = row.order.recordId;
    if (current.length && row.bouquetStart && recordId !== currentRecordId) {
      groups.push(current);
      current = [];
    }
    current.push(row);
    currentRecordId = recordId;
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Generate explicit pages for an A4 work order. Every page receives the same
 * header/table-header reservation; a bouquet moves intact to a fresh page
 * whenever it fits there. Oversized bouquets are split only between recipe
 * rows, with `continued` set on the first row in every later chunk.
 */
export function paginateWorkOrderRows(
  groups: readonly WorkOrderGroup[],
  options: WorkOrderPaginationOptions,
): WorkOrderPage[] {
  const configuredBody = finitePositive(options.pageBodyHeightMm, 1);
  const reserved = Math.max(0, Number(options.headerHeightMm) || 0) + Math.max(0, Number(options.tableHeaderHeightMm) || 0);
  // A non-positive effective capacity must still make progress. Keeping one
  // row per page is safer than an infinite loop when malformed dimensions are
  // supplied by a saved template.
  const capacity = Math.max(configuredBody - reserved, EPSILON);
  const heightOf = (row: WorkOrderPageRow) => finitePositive(options.rowHeightMm?.(row), DEFAULT_ROW_HEIGHT_MM);
  const rows = flattenWorkOrderGroups(groups);
  if (!rows.length) return [];

  const pagesRows: WorkOrderPageRow[][] = [];
  let page: WorkOrderPageRow[] = [];
  let used = 0;
  const pushPage = () => {
    if (page.length) pagesRows.push(page);
    page = [];
    used = 0;
  };

  for (const bouquet of orderGroups(rows)) {
    const bouquetHeight = bouquet.reduce((sum, row) => sum + heightOf(row), 0);

    // Keep a complete bouquet together whenever it fits on a fresh page. If
    // it cannot fit in the current remainder, start the bouquet on the next
    // page rather than splitting it unnecessarily.
    if (bouquetHeight <= capacity + EPSILON) {
      if (page.length && used + bouquetHeight > capacity + EPSILON) pushPage();
      page.push(...bouquet);
      used += bouquetHeight;
      continue;
    }

    // Oversized bouquet: split only between recipe rows. A row taller than a
    // page is emitted alone so the cursor always advances and the final row
    // can never be lost.
    let bouquetStarted = false;
    let continuationPending = false;
    for (const [index, row] of bouquet.entries()) {
      const height = heightOf(row);
      if (page.length && used + height > capacity + EPSILON) {
        pushPage();
        continuationPending = bouquetStarted;
      }
      const isContinuation = !page.length && continuationPending;
      page.push({ ...row, continued: isContinuation });
      continuationPending = false;
      bouquetStarted = true;
      used += height;
      if (used >= capacity - EPSILON && index < bouquet.length - 1) {
        pushPage();
        continuationPending = true;
      }
    }
  }
  pushPage();

  const total = pagesRows.length;
  return pagesRows.map((rowsForPage, index) => ({ number: index + 1, total, rows: rowsForPage }));
}
