# Spec: iTalent 考勤工时计算器 (kq-calculator)

> **版本**：1.0.0  
> **更新**：2026-03-24  
> **适用页面**：`https://www.italent.cn/portal/convoy/attendance` 下当前 URL 参数满足 `metaObjName=Attendance.AttendanceStatistics` 且 `viewName=Attendance.AttendanceDataRecordNavView` 的「我的出勤 / 我的考勤」页面，仅在该页面注入按钮

---

## 1. 功能概述

在北森 iTalent SaaS 系统的「我的出勤」页面，通过浏览器扩展注入一个「📊 计算工时」按钮。
用户勾选若干考勤记录行后，点击该按钮，弹窗展示：

- 选中期间的**总工时**、**日均工时**
- **加班工时**（工作日超 8h/天，周末全计）
- **缺勤合计**时长
- 逐日明细表格（日期、上下班打卡、考勤状态、工时、加班、缺勤）

---

## 2. 页面 DOM 结构（关键节点）

### 2.1 页面全局容器
```
#bs-main
└─ [data-reactroot] .container
   └─ .view.view-main[data-page="main"]
      └─ .datatable[data-i18n-metadata="..."]
         ├─ .button-list.clearfix          ← 按钮注入点
         └─ .dataGrid
            └─ .react-datagrid.pps-virtual-table
               └─ .pps-virtual-table.fixedDataTableLayout_main[role="grid" aria-rowcount="25"]
                  └─ .fixedDataTableLayout_rowsContainer
                     ├─ .fixedDataTableRowLayout_rowWrapper  (表头行, aria-rowindex="1")
                     └─ .fixedDataTableRowLayout_rowWrapper  (数据行, aria-rowindex="2~N")
```

### 2.2 按钮区域（注入点）
```html
<div class="button-list clearfix" style="top: 0px;">
  <div class="base-button-component clearfix">
    <span class="base-bg-ripple base-btns-bgc-big base-bg-ripple-active">
      <span class="base-btn-title">补签</span>
    </span>
  </div>
  <!-- 插件在此追加「计算工时」按钮 -->
</div>
```

### 2.3 表格行结构
每行（含表头行和数据行）由两个 `fixedDataTableCellGroupWrapper` 组成：

| 组 | z-index | 内容 |
|----|---------|------|
| 第 1 组（固定列，left=0，width=38px）| 2 | 复选框单元格 |
| 第 2 组（滚动列，left=38px，width=699px）| 0 | 所有数据列（虚拟宽度 1700px）|

**复选框选择器**：
```css
.checkbox-cell .platform-checkbox__input[type="checkbox"]
```

**已勾选行判断**：
```javascript
const checkbox = row.querySelector('.platform-checkbox__input[type="checkbox"]');
checkbox.checked === true ||
checkbox.getAttribute('aria-checked') === 'true' ||
row.getAttribute('aria-selected') === 'true' ||
// 全选时，选中态体现在 input 的兄弟 span（platform-checkbox__realInput--checked）上
(checkbox.nextElementSibling && hasSelectedClass(checkbox.nextElementSibling)) ||
// 祖先元素兜底
checkbox.closest('[class*="checked"], [class*="selected"]') !== null
```

### 2.4 滚动列——列定义（left 偏移量）

| # | 列名 | left (px) | width (px) | 示例值 |
|---|------|-----------|------------|--------|
| 1 | 考勤日期 | 0 | 172 | `2026-03-03 星期二` |
| 2 | 首打卡 | 172 | 160 | `2026-03-03 09:57:00` |
| 3 | 末打卡 | 332 | 160 | `2026-03-03 22:49:00` |
| 4 | 缺勤时长 | 492 | 172 | `57 分钟` / `1 小时 3 分钟` |
| 5 | 考勤状态 | 664 | 140 | `正常` / `异常` |
| 6 | 异常原因 | 804 | 140 | 文本或 `--` |
| 7 | 补签状态 | 944 | 140 | 文本或 `--` |
| 8 | 备注 | 1084 | 140 | 文本或 `--` |
| **9** | **工作时长** | **1224** | **172** | `12.87` / `0.00` |
| 10 | 职务 | 1396 | 140 | `后端研发工程师` |
| 11 | 操作 | 1536 | — | 操作按钮 |

> ⚠️ **列位置由表头动态检测**（`detectColumnPositions()`），不硬编码 left 值，以应对列顺序/宽度变化。

### 2.5 单元格内容定位
```javascript
// 取数据行中 left=Xpx 的列文本
function getCellValueByLeft(row, leftPx) {
  const scrollGroup = row.querySelectorAll(
    '.fixedDataTableCellGroupLayout_cellGroupWrapper'
  )[1];
  const cells = scrollGroup.querySelectorAll(
    '.fixedDataTableCellLayout_main[role="gridcell"]'
  );
  for (const cell of cells) {
    if (/left:\s*${leftPx}px/.test(cell.getAttribute('style') || '')) {
      return cell.querySelector('.public_fixedDataTableCell_cellContent')
                 ?.textContent.trim() ?? '';
    }
  }
  return '';
}
```

---

## 3. 数据解析规则

### 3.1 工作时长（workHours）
- 字段来源：「工作时长」列
- 格式：十进制小时数，如 `12.87`、`0.00`，或 `--`（无记录）
- 解析：`parseFloat(text) || 0`

### 3.2 缺勤时长（absence）
- 字段来源：「缺勤时长」列
- 格式：`57 分钟`、`1 小时 3 分钟`、`0 分钟`、`--`
- 解析为分钟：
  ```
  minutes = (小时数 × 60) + 分钟数
  ```

### 3.3 周末判断
- 字段来源：「考勤日期」列，包含 `星期六` 或 `星期日` 则为周末
- 用于区分加班类型

---

## 4. 统计指标定义

| 指标 | 计算方式 |
|------|---------|
| 选中天数 | 所有选中行数 |
| 有效工作日 | 工作日中 workHours > 0 的行数 |
| 周末出勤天数 | 周末中 workHours > 0 的行数 |
| 总工时 | Σ workHours（所有选中行） |
| 工作日工时 | Σ workHours（工作日） |
| 周末工时 | Σ workHours（周末） |
| 日均工时（工作日） | 工作日工时 ÷ 有效工作日数 |
| 工作日加班 | Σ max(0, workHours − 8)（工作日） |
| 周末加班 | Σ workHours（周末，全部计入） |
| 总加班工时 | 工作日加班 + 周末加班 |
| 总缺勤 | Σ absenceMinutes（转换为小时/分钟显示） |

---

## 5. UI 规范

### 5.1 注入按钮
- **选择器**：`.button-list.clearfix`
- **追加位置**：现有按钮（"补签"）之后
- **HTML 结构**（与现有按钮一致）：
  ```html
  <div class="base-button-component clearfix kq-calc-btn">
    <span class="base-bg-ripple base-btns-bgc-big base-bg-ripple-active">
      <span class="base-btn-title">📊 计算工时</span>
    </span>
  </div>
  ```
- **防重复**：注入前检查 `.kq-calc-btn` 是否已存在

### 5.2 弹窗
- 半透明遮罩层（`z-index: 99998`）
- 白色卡片容器（最大 720px 宽，88vh 高，可滚动）
- 标题栏：蓝色 `#0071ce`，白字
- 统计卡片区（4 列网格）
- 逐日明细表格
- 底部备注说明
- 关闭方式：× 按钮、点击遮罩、ESC 键

### 5.3 加班高亮
- 加班工时 > 0：橙色 `#d46b08`
- 考勤异常：红色 `#f5222d`
- 考勤正常：绿色 `#52c41a`
- 周末日期：粉色 `#eb2f96`

---

## 6. SPA 适配

页面为 React SPA，`.button-list` 在路由切换后可能重新渲染。
使用 `MutationObserver` 监听 `document.body` 的子树变化，每次触发时检查并补充注入按钮。

---

## 7. 文件结构

```
italent_plugin_ext/
├── manifest.json                  # Manifest V3 扩展描述
├── content_scripts/
│   └── kq_calculator.js           # 注入脚本（本 spec 描述）
├── popup/
│   └── popup.html                 # 扩展弹出面板（使用说明）
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── spec/
│   └── kq-calculator-spec.md      # 本 spec 文件（AI 可加载）
└── README.md                      # 项目说明
```

---

## 8. 权限声明（manifest.json）

```json
{
  "manifest_version": 3,
  "content_scripts": [{
    "matches": ["https://*.italent.cn/*", "http://*.italent.cn/*"],
    "js": ["content_scripts/kq_calculator.js"],
    "run_at": "document_idle"
  }],
  "permissions": [],
  "host_permissions": ["https://*.italent.cn/*", "http://*.italent.cn/*"]
}
```

---

## 9. 已知限制

1. 虚拟表格：当行数极多时，虚拟表格可能不渲染所有行（当前测试 24 行全部渲染）。如遇分页场景，需切换到对应分页后分别勾选统计。
2. 「工作时长」列仅反映系统记录的工时，与实际打卡时长计算方式以系统为准。
3. 标准工时 `STANDARD_WORK_HOURS = 8` 为代码常量，如需修改请在 `content_scripts/kq_calculator.js` 顶部更改。
