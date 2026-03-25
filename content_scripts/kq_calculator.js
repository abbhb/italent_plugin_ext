/**
 * iTalent 考勤工时计算器 - Content Script
 *
 * 功能：在北森 iTalent 考勤页面（我的出勤）注入「计算工时」按钮，
 * 点击后统计已勾选行的工时信息，并以弹窗展示详情。
 *
 * 适用页面：https://*.italent.cn/ 下的「我的出勤」
 * DOM 参考：spec/kq-calculator-spec.md
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // 常量
  // ─────────────────────────────────────────────
  /** 每天标准工时（小时），超出部分计为加班 */
  const STANDARD_WORK_HOURS = 8;

  /** 插件 UI 元素的唯一标识前缀，防止与页面样式冲突 */
  const PREFIX = 'kq-calc';
  const SELECTED_STATE_CLASS_PATTERN = /(?:^|__|--)(checked|selected)$/;

  // ─────────────────────────────────────────────
  // 样式注入
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(`${PREFIX}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${PREFIX}-styles`;
    style.textContent = `
      /* ── 计算工时按钮 ── */
      .${PREFIX}-btn {
        cursor: pointer;
        display: inline-block;
        margin-left: 8px;
        vertical-align: top;
      }
      .${PREFIX}-btn .base-bg-ripple {
        background-color: #0071ce !important;
        border-color: #0071ce !important;
      }
      .${PREFIX}-btn:hover .base-bg-ripple {
        background-color: #005fa8 !important;
        border-color: #005fa8 !important;
      }

      /* ── 遮罩层 ── */
      .${PREFIX}-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 99998;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, "Microsoft YaHei", sans-serif;
      }

      /* ── 弹窗主体 ── */
      .${PREFIX}-modal {
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        width: 720px;
        max-width: 95vw;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 99999;
      }

      /* ── 弹窗标题栏 ── */
      .${PREFIX}-modal-header {
        background: #0071ce;
        color: #fff;
        padding: 14px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }
      .${PREFIX}-modal-header h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .${PREFIX}-close-btn {
        background: none;
        border: none;
        color: rgba(255,255,255,0.85);
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        padding: 0 4px;
        transition: color 0.15s;
      }
      .${PREFIX}-close-btn:hover { color: #fff; }

      /* ── 弹窗内容区 ── */
      .${PREFIX}-modal-body {
        overflow-y: auto;
        padding: 20px;
        flex: 1;
      }

      /* ── 统计卡片网格 ── */
      .${PREFIX}-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 20px;
      }
      .${PREFIX}-stat-card {
        background: #f0f6ff;
        border: 1px solid #d0e4f8;
        border-radius: 6px;
        padding: 12px 14px;
        text-align: center;
      }
      .${PREFIX}-stat-card.highlight {
        background: #e6f7ff;
        border-color: #91caff;
      }
      .${PREFIX}-stat-card.warning {
        background: #fff7e6;
        border-color: #ffd591;
      }
      .${PREFIX}-stat-label {
        font-size: 12px;
        color: #666;
        margin-bottom: 4px;
      }
      .${PREFIX}-stat-value {
        font-size: 22px;
        font-weight: 700;
        color: #0071ce;
        line-height: 1.2;
      }
      .${PREFIX}-stat-value.warning { color: #d46b08; }
      .${PREFIX}-stat-unit {
        font-size: 12px;
        color: #888;
        margin-top: 2px;
      }

      /* ── 明细表格 ── */
      .${PREFIX}-section-title {
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin: 0 0 10px 0;
        padding-bottom: 6px;
        border-bottom: 2px solid #0071ce;
        display: inline-block;
      }
      .${PREFIX}-detail-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        table-layout: fixed;
      }
      .${PREFIX}-detail-table th {
        background: #f0f6ff;
        color: #444;
        font-weight: 600;
        padding: 8px 10px;
        text-align: center;
        border: 1px solid #d0e4f8;
        white-space: nowrap;
      }
      .${PREFIX}-detail-table td {
        padding: 7px 10px;
        border: 1px solid #eee;
        text-align: center;
        color: #333;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${PREFIX}-detail-table tr:nth-child(even) td {
        background: #fafcff;
      }
      .${PREFIX}-detail-table tr:hover td {
        background: #e8f4ff;
      }
      .${PREFIX}-ot { color: #d46b08; font-weight: 600; }
      .${PREFIX}-zero { color: #aaa; }
      .${PREFIX}-weekend { color: #eb2f96; }
      .${PREFIX}-normal { color: #52c41a; }
      .${PREFIX}-abnormal { color: #f5222d; }

      /* ── 底部说明 ── */
      .${PREFIX}-footnote {
        font-size: 12px;
        color: #999;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid #f0f0f0;
      }

      /* ── 无数据提示 ── */
      .${PREFIX}-toast {
        position: fixed;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.75);
        color: #fff;
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 14px;
        z-index: 100000;
        pointer-events: none;
        font-family: -apple-system, "Microsoft YaHei", sans-serif;
        animation: ${PREFIX}-fadeout 2.5s forwards;
      }
      @keyframes ${PREFIX}-fadeout {
        0%   { opacity: 1; }
        70%  { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  // 解析工具函数
  // ─────────────────────────────────────────────

  /** 将缺勤时长文本（如 "1 小时 3 分钟"）解析为分钟数 */
  function parseAbsenceToMinutes(text) {
    if (!text || text.trim() === '--') return 0;
    let minutes = 0;
    const hourMatch = text.match(/(\d+)\s*小时/);
    const minMatch = text.match(/(\d+)\s*分钟/);
    if (hourMatch) minutes += parseInt(hourMatch[1], 10) * 60;
    if (minMatch) minutes += parseInt(minMatch[1], 10);
    return minutes;
  }

  /** 将分钟数格式化为 "Xh Ym" 形式 */
  function formatMinutes(totalMinutes) {
    if (totalMinutes <= 0) return '0 分钟';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m} 分钟`;
    if (m === 0) return `${h} 小时`;
    return `${h} 小时 ${m} 分钟`;
  }

  /** 解析工作时长文本为浮点数 */
  function parseWorkHours(text) {
    if (!text || text.trim() === '--') return 0;
    return parseFloat(text.trim()) || 0;
  }

  /** 判断考勤日期文本是否为周末（星期六 / 星期日） */
  function isWeekend(dateText) {
    if (!dateText) return false;
    return dateText.includes('星期六') || dateText.includes('星期日');
  }

  /** 将小时格式化为保留两位小数的字符串 */
  function fmtH(hours) {
    return parseFloat(hours).toFixed(2);
  }

  /** 转义 HTML 特殊字符，防止将页面文本插入 innerHTML 时产生 XSS */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─────────────────────────────────────────────
  // DOM 访问 —— 基于列标题动态定位列位置
  // ─────────────────────────────────────────────

  /**
   * 扫描表头行，返回各列对应的 left (px) 字符串，格式：
   * { date, firstCheckin, lastCheckin, absence, status, workHours }
   */
  function detectColumnPositions() {
    const headerRow = document.querySelector('[role="row"][aria-rowindex="1"]');
    if (!headerRow) return null;

    const cellGroups = headerRow.querySelectorAll(
      '.fixedDataTableCellGroupLayout_cellGroupWrapper'
    );
    if (cellGroups.length < 2) return null;

    const scrollableCells = cellGroups[1].querySelectorAll(
      '.fixedDataTableCellLayout_main[role="columnheader"]'
    );

    const nameMap = {
      考勤日期: 'date',
      首打卡: 'firstCheckin',
      末打卡: 'lastCheckin',
      缺勤时长: 'absence',
      考勤状态: 'status',
      工作时长: 'workHours',
    };

    const positions = {};
    scrollableCells.forEach((cell) => {
      const styleStr = cell.getAttribute('style') || '';
      const leftMatch = styleStr.match(/left:\s*(\d+)px/);
      if (!leftMatch) return;
      const leftPx = leftMatch[1];
      const cellText = cell.textContent.trim();
      for (const [name, key] of Object.entries(nameMap)) {
        if (cellText.includes(name)) {
          positions[key] = leftPx;
        }
      }
    });

    return positions;
  }

  /**
   * 在数据行中，根据 left (px) 取出对应单元格的文本
   */
  function getCellValueByLeft(row, leftPx) {
    const cellGroups = row.querySelectorAll(
      '.fixedDataTableCellGroupLayout_cellGroupWrapper'
    );
    if (cellGroups.length < 2) return '';

    const cells = cellGroups[1].querySelectorAll(
      '.fixedDataTableCellLayout_main[role="gridcell"]'
    );
    for (const cell of cells) {
      const styleStr = cell.getAttribute('style') || '';
      // 匹配 "left: 1224px" 等格式
      if (new RegExp(`left:\\s*${leftPx}px`).test(styleStr)) {
        const content = cell.querySelector('.public_fixedDataTableCell_cellContent');
        return content ? content.textContent.trim() : '';
      }
    }
    return '';
  }

  /** 返回所有数据行（排除表头 aria-rowindex="1"） */
  function getDataRows() {
    return document.querySelectorAll(
      '[role="row"]:not([aria-rowindex="1"])'
    );
  }

  function getRenderedRowSignature() {
    return Array.from(getDataRows())
      .map((row) => row.getAttribute('aria-rowindex') || '')
      .join(',');
  }

  function getVirtualGrid() {
    return document.querySelector('.pps-virtual-table[role="grid"][aria-rowcount]');
  }

  function getRowLogicalIndex(row) {
    const ariaRowIndex = parseInt(row.getAttribute('aria-rowindex') || '', 10);
    return Number.isFinite(ariaRowIndex) && ariaRowIndex > 1
      ? ariaRowIndex - 1
      : null;
  }

  function waitForVirtualTableRender(delay = 60) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, delay);
    });
  }

  function hasSelectedClass(element) {
    if (!element || typeof element.className !== 'string') return false;

    return element.className
      .split(/\s+/)
      .some((className) => (
        className === 'checked' ||
        className === 'selected' ||
        className === 'is-checked' ||
        className === 'is-selected' ||
        SELECTED_STATE_CLASS_PATTERN.test(className)
      ));
  }

  function isCheckboxElement(element) {
    return !!(
      element &&
      typeof element.className === 'string' &&
      element.className.includes('checkbox')
    );
  }

  /** 判断某行的复选框是否被勾选 */
  function isRowChecked(row) {
    const checkbox = row.querySelector(
      '.platform-checkbox__input[type="checkbox"]'
    );
    if (!checkbox) return false;
    if (checkbox.checked) return true;
    if (checkbox.getAttribute('aria-checked') === 'true') return true;
    if (row.getAttribute('aria-selected') === 'true') return true;
    if (checkbox.nextElementSibling && hasSelectedClass(checkbox.nextElementSibling)) return true;

    for (let element = checkbox; element; element = element.parentElement) {
      if (
        element.getAttribute('aria-checked') === 'true' &&
        isCheckboxElement(element)
      ) {
        return true;
      }
      if (hasSelectedClass(element)) return true;
      if (element === row) return false;
    }

    return false;
  }

  function extractRowData(row, colPos) {
    const date = getCellValueByLeft(row, colPos.date);
    const firstCheckin = getCellValueByLeft(row, colPos.firstCheckin);
    const lastCheckin = getCellValueByLeft(row, colPos.lastCheckin);
    const absenceText = getCellValueByLeft(row, colPos.absence);
    const status = getCellValueByLeft(row, colPos.status);
    const workHoursText = getCellValueByLeft(row, colPos.workHours);
    const workHours = parseWorkHours(workHoursText);
    const weekend = isWeekend(date);
    const absenceMinutes = parseAbsenceToMinutes(absenceText);
    // 加班：工作日超出标准工时；周末所有工时均为加班
    const overtime = weekend
      ? workHours
      : Math.max(0, workHours - STANDARD_WORK_HOURS);

    return {
      date,
      firstCheckin,
      lastCheckin,
      absenceText,
      absenceMinutes,
      status,
      workHours,
      weekend,
      overtime,
    };
  }

  function collectVisibleSelectedRows(colPos, rowMap) {
    Array.from(getDataRows()).forEach((row) => {
      const rowIndex = getRowLogicalIndex(row);
      if (rowIndex === null || !isRowChecked(row) || rowMap.has(rowIndex)) return;
      rowMap.set(rowIndex, extractRowData(row, colPos));
    });
  }

  async function findVirtualScrollTarget(grid) {
    const candidates = [
      grid,
      grid.querySelector('.fixedDataTableLayout_rowsContainer'),
      grid.parentElement,
      grid.closest('.react-datagrid'),
    ].filter(Boolean);
    const baseSignature = getRenderedRowSignature();

    for (const candidate of candidates) {
      const originalTop = candidate.scrollTop;
      const probeTop = originalTop + Math.max(candidate.clientHeight || 0, 240);

      candidate.scrollTop = probeTop;
      await waitForVirtualTableRender();
      const changed = getRenderedRowSignature() !== baseSignature;

      candidate.scrollTop = originalTop;
      await waitForVirtualTableRender();

      if (changed) return candidate;
    }

    return null;
  }

  async function collectSelectedRows(colPos) {
    const rowMap = new Map();
    collectVisibleSelectedRows(colPos, rowMap);

    const grid = getVirtualGrid();
    const totalDataRows = Math.max(
      parseInt(grid && grid.getAttribute('aria-rowcount'), 10) - 1 || 0,
      0
    );
    if (!grid || totalDataRows <= rowMap.size) {
      return Array.from(rowMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, row]) => row);
    }

    const scrollTarget = await findVirtualScrollTarget(grid);
    if (!scrollTarget) {
      return Array.from(rowMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, row]) => row);
    }

    const originalTop = scrollTarget.scrollTop;
    scrollTarget.scrollTop = 0;
    await waitForVirtualTableRender();
    collectVisibleSelectedRows(colPos, rowMap);

    const maxScrollTop = Math.max(
      (scrollTarget.scrollHeight || 0) - (scrollTarget.clientHeight || 0),
      0
    );
    const step = Math.max(Math.floor((scrollTarget.clientHeight || 0) * 0.85), 160);
    let currentTop = 0;
    let lastSignature = getRenderedRowSignature();
    let stagnantRounds = 0;

    while (currentTop < maxScrollTop) {
      currentTop = Math.min(currentTop + step, maxScrollTop);
      scrollTarget.scrollTop = currentTop;
      await waitForVirtualTableRender();
      collectVisibleSelectedRows(colPos, rowMap);

      const currentSignature = getRenderedRowSignature();
      if (currentSignature === lastSignature) {
        stagnantRounds += 1;
      } else {
        stagnantRounds = 0;
        lastSignature = currentSignature;
      }

      if (stagnantRounds >= 2 || rowMap.size >= totalDataRows) break;
    }

    scrollTarget.scrollTop = originalTop;
    await waitForVirtualTableRender();

    return Array.from(rowMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => row);
  }

  // ─────────────────────────────────────────────
  // 工时统计计算
  // ─────────────────────────────────────────────

  /**
   * 统计已选行工时，返回统计对象；若无选中行则返回 null
   */
  async function calcStats() {
    const colPos = detectColumnPositions();
    if (!colPos || !colPos.workHours) return null;

    const rows = await collectSelectedRows(colPos);
    if (rows.length === 0) return null;

    // 汇总
    const totalDays = rows.length;
    const weekdays = rows.filter((r) => !r.weekend);
    const weekends = rows.filter((r) => r.weekend);
    const workingDays = weekdays.filter((r) => r.workHours > 0);
    const workingWeekends = weekends.filter((r) => r.workHours > 0);

    const totalWorkHours = rows.reduce((s, r) => s + r.workHours, 0);
    const weekdayWorkHours = weekdays.reduce((s, r) => s + r.workHours, 0);
    const weekendWorkHours = weekends.reduce((s, r) => s + r.workHours, 0);

    const weekdayOT = weekdays.reduce((s, r) => s + r.overtime, 0);
    const weekendOT = weekends.reduce((s, r) => s + r.overtime, 0);
    const totalOT = weekdayOT + weekendOT;

    const totalAbsenceMinutes = rows.reduce(
      (s, r) => s + r.absenceMinutes,
      0
    );

    const avgDailyHours =
      workingDays.length > 0 ? weekdayWorkHours / workingDays.length : 0;

    return {
      totalDays,
      weekdayCount: weekdays.length,
      weekendCount: weekends.length,
      workingDays: workingDays.length,
      workingWeekends: workingWeekends.length,
      totalWorkHours,
      weekdayWorkHours,
      weekendWorkHours,
      weekdayOT,
      weekendOT,
      totalOT,
      totalAbsenceMinutes,
      avgDailyHours,
      rows,
    };
  }

  // ─────────────────────────────────────────────
  // UI 组件
  // ─────────────────────────────────────────────

  /** 显示短暂提示 */
  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = `${PREFIX}-toast`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  /** 构建统计卡片 HTML */
  function buildStatCard(label, value, unit, extraClass = '') {
    return `
      <div class="${PREFIX}-stat-card ${extraClass}">
        <div class="${PREFIX}-stat-label">${label}</div>
        <div class="${PREFIX}-stat-value ${extraClass}">${value}</div>
        <div class="${PREFIX}-stat-unit">${unit}</div>
      </div>`;
  }

  /** 构建明细表格行 */
  function buildDetailRows(rows) {
    return rows
      .map((r, i) => {
        const stClass = r.status === '正常' ? `${PREFIX}-normal` : r.status === '--' ? `${PREFIX}-zero` : `${PREFIX}-abnormal`;
        const otClass = r.overtime > 0 ? `${PREFIX}-ot` : `${PREFIX}-zero`;
        const wh = r.workHours > 0 ? fmtH(r.workHours) : `<span class="${PREFIX}-zero">0.00</span>`;
        const ot = r.overtime > 0 ? `<span class="${otClass}">${fmtH(r.overtime)}</span>` : `<span class="${PREFIX}-zero">0.00</span>`;
        const dateLabel = r.weekend
          ? `<span class="${PREFIX}-weekend">${esc(r.date)}</span>`
          : esc(r.date);
        const absence = r.absenceMinutes > 0
          ? esc(formatMinutes(r.absenceMinutes))
          : `<span class="${PREFIX}-zero">0</span>`;
        const checkin = r.firstCheckin && r.firstCheckin !== '--'
          ? esc(r.firstCheckin.replace(/^\d{4}-\d{2}-\d{2}\s+/, ''))  // 只显示时间部分
          : `<span class="${PREFIX}-zero">--</span>`;
        const checkout = r.lastCheckin && r.lastCheckin !== '--'
          ? esc(r.lastCheckin.replace(/^\d{4}-\d{2}-\d{2}\s+/, ''))
          : `<span class="${PREFIX}-zero">--</span>`;

        return `
          <tr>
            <td>${i + 1}</td>
            <td style="text-align:left">${dateLabel}</td>
            <td>${checkin}</td>
            <td>${checkout}</td>
            <td><span class="${stClass}">${esc(r.status || '--')}</span></td>
            <td>${wh}</td>
            <td>${ot}</td>
            <td>${absence}</td>
          </tr>`;
      })
      .join('');
  }

  /** 创建并显示统计弹窗 */
  function showModal(stats) {
    // 移除旧弹窗
    const old = document.getElementById(`${PREFIX}-overlay`);
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = `${PREFIX}-overlay`;
    overlay.id = `${PREFIX}-overlay`;

    overlay.innerHTML = `
      <div class="${PREFIX}-modal" role="dialog" aria-modal="true" aria-labelledby="${PREFIX}-title">
        <div class="${PREFIX}-modal-header">
          <h2 id="${PREFIX}-title">📊 考勤工时统计报告</h2>
          <button class="${PREFIX}-close-btn" aria-label="关闭" title="关闭">×</button>
        </div>
        <div class="${PREFIX}-modal-body">
          <!-- 统计卡片 -->
          <div class="${PREFIX}-stats-grid">
            ${buildStatCard('选中天数', stats.totalDays, '天', 'highlight')}
            ${buildStatCard('工作日', stats.workingDays + ' / ' + stats.weekdayCount, '天有效 / 总', '')}
            ${buildStatCard('周末出勤', stats.workingWeekends, '天', '')}
            ${buildStatCard('总工时', fmtH(stats.totalWorkHours), '小时', 'highlight')}
            ${buildStatCard('工作日工时', fmtH(stats.weekdayWorkHours), '小时', '')}
            ${buildStatCard('周末工时', fmtH(stats.weekendWorkHours), '小时', '')}
            ${buildStatCard('日均工时(工作日)', fmtH(stats.avgDailyHours), '小时', '')}
            ${buildStatCard('总加班工时', fmtH(stats.totalOT), '小时', stats.totalOT > 0 ? 'warning' : '')}
            ${buildStatCard('工作日加班', fmtH(stats.weekdayOT), '小时（超 8h/天）', stats.weekdayOT > 0 ? 'warning' : '')}
            ${buildStatCard('周末加班', fmtH(stats.weekendOT), '小时', stats.weekendOT > 0 ? 'warning' : '')}
            ${buildStatCard('总缺勤', formatMinutes(stats.totalAbsenceMinutes), '', '')}
            ${buildStatCard('标准工时基准', STANDARD_WORK_HOURS, '小时/天', '')}
          </div>

          <!-- 明细表格 -->
          <div class="${PREFIX}-section-title">逐日明细</div>
          <table class="${PREFIX}-detail-table">
            <thead>
              <tr>
                <th style="width:36px">#</th>
                <th style="width:160px;text-align:left">考勤日期</th>
                <th style="width:72px">上班打卡</th>
                <th style="width:72px">下班打卡</th>
                <th style="width:60px">考勤状态</th>
                <th style="width:72px">工作时长(h)</th>
                <th style="width:72px">加班时长(h)</th>
                <th style="width:100px">缺勤时长</th>
              </tr>
            </thead>
            <tbody>
              ${buildDetailRows(stats.rows)}
            </tbody>
          </table>

          <div class="${PREFIX}-footnote">
            ※ 加班规则：工作日超出 ${STANDARD_WORK_HOURS} 小时/天的部分计为加班；周末出勤全部计为加班。<br>
            ※ 统计范围：本页面已勾选的 ${stats.totalDays} 条记录（可通过勾选/取消勾选调整）。
          </div>
        </div>
      </div>`;

    // 关闭弹窗逻辑
    overlay.querySelector(`.${PREFIX}-close-btn`).addEventListener('click', () => {
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    // ESC 键关闭
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
  }

  // ─────────────────────────────────────────────
  // 按钮注入
  // ─────────────────────────────────────────────

  /** 执行计算并展示弹窗 */
  async function onCalcButtonClick() {
    const stats = await calcStats();
    if (!stats) {
      showToast('请先勾选要统计的考勤记录（至少一行）');
      return;
    }
    showModal(stats);
  }

  /** 在 .button-list 中注入计算工时按钮 */
  function injectCalcButton(buttonList) {
    if (buttonList.querySelector(`.${PREFIX}-btn`)) return;

    injectStyles();

    const btn = document.createElement('div');
    btn.className = `base-button-component clearfix ${PREFIX}-btn`;
    btn.setAttribute('title', '统计已勾选行的工时信息');
    btn.innerHTML = `
      <span class="base-bg-ripple base-btns-bgc-big base-bg-ripple-active">
        <span class="base-btn-title">📊 计算工时</span>
      </span>`;
    btn.addEventListener('click', onCalcButtonClick);
    buttonList.appendChild(btn);
  }

  // ─────────────────────────────────────────────
  // 初始化 —— 监听 .button-list 出现（SPA 场景）
  // ─────────────────────────────────────────────

  function isMyAttendancePage() {
    const currentUrl = new URL(window.location.href);
    const hash = currentUrl.hash || '';
    const hashQueryIndex = hash.indexOf('?');
    const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? hash.slice(hashQueryIndex + 1) : '');
    const getCurrentParam = (name) => currentUrl.searchParams.get(name) || hashParams.get(name) || '';
    const metaObjName = getCurrentParam('metaObjName');
    const viewName = getCurrentParam('viewName');

    return (
      metaObjName === 'Attendance.AttendanceStatistics' &&
      viewName === 'Attendance.AttendanceDataRecordNavView'
    );
  }

  function tryInject() {
    if (!isMyAttendancePage()) return;

    const buttonList = document.querySelector('.button-list.clearfix');
    if (buttonList) {
      injectCalcButton(buttonList);
    }
  }

  // 立即尝试一次（页面可能已加载完毕）
  tryInject();

  // 监听 DOM 变化，处理 SPA 路由切换或懒加载
  const domObserver = new MutationObserver(() => {
    tryInject();
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
})();
