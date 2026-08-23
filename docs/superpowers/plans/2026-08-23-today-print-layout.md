# 今日打印与排版优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 默认只展示今天的出货订单，保留可调 T+n，并优化标签/加工单的操作排版与日期信息。

**Architecture:** 将默认日期筛选设为本地今天并让加载结果保持真实空状态；加工单从筛选结果计算出货日期摘要；App 控件分组和 CSS 负责操作密度与打印预览层级。

**Tech Stack:** React 18、TypeScript、Vitest、Vite、CSS、GitHub Pages。

---

### Task 1: 默认今日与日期测试

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/print-model.test.ts`

- [ ] 让默认 `PrintFilter` 使用本地今天并使用 `exact` 日期模式。
- [ ] 保持飞书空视图为空，不再回退到历史或样例订单。
- [ ] 增加今日精确匹配和 T+n 可调整的测试。

### Task 2: 加工单日期信息

**Files:**
- Modify: `src/App.tsx`

- [ ] 在加工单抬头显示筛选后的出货日期摘要。
- [ ] 单日期显示具体日期，多日期显示“多个出货日期”，空值显示“未填写出货日期”。

### Task 3: 操作排版优化

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] 将筛选区、标签设置区和底部操作区做出清晰层级，减少无效滚动。
- [ ] 优化预览画布尺寸、工具栏、标签卡和加工单抬头。
- [ ] 养护说明最多显示两行，避免压缩条码区域。

### Task 4: 验证与发布

**Files:**
- Modify: `README.md`

- [ ] 更新默认今日和 T+n 使用说明。
- [ ] 运行 `npm test`、`npm run build`。
- [ ] 用 Chrome 验证今天为空、T+n、加工单日期和移动端布局。
- [ ] 更新 GitHub Pages 的 `gh-pages` 构建。
