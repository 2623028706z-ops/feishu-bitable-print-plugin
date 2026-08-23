# 花众销售订单打印插件

飞书多维表格扩展脚本。读取当前表格视图或勾选记录，生成自定义尺寸标签/Code 128 条码和天虹花束加工单。

## 本地运行

```bash
npm install
npm run dev
```

将 Vite 提供的本地地址添加到飞书多维表格的“扩展脚本”。脱离飞书打开时会展示脱敏样例数据。

## 构建

```bash
npm run test
npm run build
```

GitHub 只用于管理源码。按飞书官方扩展脚本发布流程，将 GitHub 仓库导入 Replit，使用 Replit 的 Publish 生成插件运行地址，再提交飞书官方上架表单。GitHub Pages 不是官方扩展脚本上架流程的替代品。

## 飞书内开发调试

1. 将仓库导入 Replit（官方文档提供 Import from GitHub 流程）。
2. 在 Replit 中运行 `npm run start`，复制公开 HTTPS 地址。
3. 打开目标 Base 的“销售订单表”，打开扩展脚本，新增脚本并填入该地址。
4. 勾选记录后刷新插件；未勾选时读取当前视图前 200 条记录。
5. 调整标签尺寸或切换加工单，预览后打印。

插件内可组合筛选客户、品类、花束。出货日期支持指定日期、日期范围和 `T+n`：先填写基准日 T，再填写偏移天数，例如 T 为 2026-08-23、偏移 2 天时匹配 2026-08-25。标签数量可按销售数量或设置为每单固定张数；“养护说明”字段可在标签内容中单独开启。

## 官方正式公开

按官方顺序操作：GitHub 管理代码 → Replit Import from GitHub → Run → Publish → Publish to Community → 复制公开 URL → 填写飞书官方插件上架表单。审核通过后，其他飞书用户才能在插件中心搜索或安装。官方文档：<https://lark-base-team.github.io/js-sdk-docs/zh/start/release>
