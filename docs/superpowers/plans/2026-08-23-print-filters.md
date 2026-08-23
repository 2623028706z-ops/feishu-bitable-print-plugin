# 打印筛选与 T+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为标签和加工单增加客户、品类、花束、日期、数量筛选，并支持自定义 T+n 与养护说明打印。

**Architecture:** 在 `print-model` 中定义纯函数筛选和数量覆盖逻辑；`App` 维护筛选控件状态并把结果传给现有预览组件；飞书适配器只负责读取记录。

**Tech Stack:** React 18、TypeScript、Vite、Vitest、@lark-base-open/js-sdk。

---

### Task 1: 筛选模型

**Files:**
- Modify: `src/lib/print-model.ts`
- Test: `src/lib/print-model.test.ts`

- [ ] 增加 `PrintFilter`、日期模式和 `filterOrders` 纯函数。
- [ ] 增加数量覆盖函数，使标签可以使用统一自定义数量。
- [ ] 覆盖客户、花束、T+n、数量过滤的单元测试。

### Task 2: 控件与预览接线

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] 增加客户/品类/花束多选、日期模式、T、n、数量模式控件。
- [ ] 用筛选结果驱动标签和加工单，并在空结果时禁用打印。
- [ ] 增加养护说明标签开关，保留现有标签规格和加工单结构。

### Task 3: 文档与验证

**Files:**
- Modify: `README.md`

- [ ] 补充筛选与 T+n 使用说明。
- [ ] 运行 `npm test`、`npm run build`。
- [ ] 用 Chrome 调试协议验证桌面和移动布局、筛选结果和加工单切换。
