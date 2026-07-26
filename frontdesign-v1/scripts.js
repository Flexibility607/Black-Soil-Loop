const RESOURCE_GROUPS = {
  enterprise: [
    { value: 'enterprises', label: '企业档案' },
    { value: 'parks', label: '园区档案' },
    { value: 'enterprise-tags', label: '企业标签' },
    { value: 'partners', label: '合作方' },
    { value: 'stores', label: '门店档案' },
  ],
  production: [
    { value: 'production-plans', label: '生产计划' },
    { value: 'production-orders', label: '生产订单' },
    { value: 'preorders', label: '预订单' },
    { value: 'boms', label: '物料清单 BOM' },
  ],
  inventory: [
    { value: 'inventories', label: '企业库存' },
    { value: 'sales-order-lines', label: '销售订单明细' },
    { value: 'returns', label: '退货记录' },
    { value: 'freezer-records', label: '冻库记录' },
  ],
  transport: [
    { value: 'transport-task-summaries', label: '运输任务摘要' },
    { value: 'transport-resources', label: '运输资源' },
  ],
};

const state = {
  activeSection: 'overview',
  resource: {
    enterprise: 'enterprises',
    production: 'production-plans',
    inventory: 'inventories',
    transport: 'transport-task-summaries',
  },
  importBatchId: null,
  publicEnterpriseRows: [],
  publicEnterpriseExpanded: false,
  publicMapZoom: 1.08,
  publicMapPanX: 0,
  publicMapPanY: 0,
  publicMapSuppressClickUntil: 0,
  publicMapDragCleanup: null,
};

function getAPI() {
  return window.API;
}

function dataOf(result) {
  return result && result.json ? result.json.data : null;
}

function errorOf(result) {
  const body = result && result.json;
  if (!body) return `请求失败（HTTP ${result ? result.status : '未知'}）`;
  const first = body.errors && body.errors[0];
  return first ? `${body.code || '请求失败'}：${first.message}` : `${body.code || '请求失败'}：${body.message || `HTTP ${result.status}`}`;
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value) {
  return formatValue(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setMessage(message, type = 'info') {
  const el = document.getElementById('global-message');
  if (!el) return;
  el.textContent = message;
  el.className = `message ${type}`;
}

function setLoading(target, message = '加载中…') {
  const el = document.getElementById(target);
  if (el) el.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`;
}

function renderTable(target, items, emptyMessage = '暂无数据') {
  const el = document.getElementById(target);
  if (!el) return;
  if (!Array.isArray(items) || !items.length) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  const keys = [...new Set(items.flatMap((item) => Object.keys(item)))];
  el.innerHTML = `<div class="table-scroll"><table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr></thead><tbody>${items.map((item) => `<tr>${keys.map((key) => `<td>${escapeHtml(item[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function formatNumber(value, maximumFractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(number);
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 10000) return `¥${(number / 10000).toFixed(2)}万`;
  return `¥${formatNumber(number)}`;
}

function formatCompactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 10000) return `¥${(number / 10000).toFixed(1)}万`;
  return `¥${formatNumber(number)}`;
}

function formatShortDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatValue(value);
  const options = includeTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-CN', options).format(date).replaceAll('/', '-');
}

function renderLineChart(target, items, labelKey, valueKey, gradientId) {
  const el = document.getElementById(target);
  if (!el) return;
  if (!Array.isArray(items) || items.length < 2) {
    el.innerHTML = '<div class="empty-state">暂无趋势数据</div>';
    return;
  }
  const values = items.map((item) => Number(item[valueKey]) || 0);
  const width = 450;
  const height = 180;
  const bottom = 150;
  const top = 12;
  const left = 16;
  const right = 12;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const lower = Math.max(0, min * 0.78);
  const range = Math.max(max * 1.08 - lower, 1);
  const points = items.map((item, index) => ({
    x: left + index * ((width - left - right) / Math.max(items.length - 1, 1)),
    y: bottom - ((Number(item[valueKey]) - lower) / range) * (bottom - top),
    label: formatShortDate(item[labelKey]),
    value: Number(item[valueKey]) || 0,
  }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${path} L ${points.at(-1).x.toFixed(1)} ${bottom} L ${points[0].x.toFixed(1)} ${bottom} Z`;
  const sales = target.includes('sales');
  const color = sales ? '#e8bd62' : '#62dda0';
  const grid = [0, 1, 2, 3].map((index) => `<line class="chart-grid-line" x1="${left}" y1="${top + index * 46}" x2="${width - right}" y2="${top + index * 46}" />`).join('');
  const labels = points.map((point) => `<text class="chart-axis-label" x="${point.x}" y="170" text-anchor="middle">${escapeHtml(point.label)}</text>`).join('');
  const dots = points.map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.label)}：${escapeHtml(formatNumber(point.value))}</title></circle>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${sales ? '销售额' : '订单量'}趋势图"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".34"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" style="fill:url(#${gradientId})" d="${area}"/><path class="chart-line" d="${path}"/>${dots}${labels}</svg>`;
}

function renderCapacityList(items) {
  const el = document.getElementById('public-capacity');
  if (!el) return;
  const rows = (items || []).slice(0, 12);
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无产能数据</div>';
    return;
  }
  const displayRows = rows.length > 4 ? [...rows, ...rows] : rows;
  el.innerHTML = `<div class="capacity-track">${displayRows.map((item) => {
    const occupancy = Math.max(0, Math.min(100, Number(item.capacity_occupancy_percent) || 0));
    const remaining = Number(item.capacity_remaining) || 0;
    const status = String(item.line_status || '—');
    const statusClass = /预警|偏紧|补料/.test(status) ? 'warn' : '';
    return `<div class="capacity-item" title="${escapeHtml(item.enterprise_display_name)} · ${escapeHtml(item.category)} · 当日产能占用 ${escapeHtml(occupancy)}% · 剩余 ${escapeHtml(formatNumber(remaining))} ${escapeHtml(item.unit)}"><div class="capacity-identity"><strong>${escapeHtml(item.enterprise_display_name)}</strong><small>${escapeHtml(item.category)}</small></div><div class="capacity-progress"><i style="width:${Math.max(5, occupancy)}%"></i><span>占用 ${escapeHtml(occupancy)}%</span></div><b class="capacity-remaining">余 ${escapeHtml(formatNumber(remaining))} ${escapeHtml(item.unit)}</b><em class="capacity-status ${statusClass}">${escapeHtml(status)}</em></div>`;
  }).join('')}</div>`;
}

function setPublicText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = formatValue(value);
}

function renderTrendCharts(orderItems, salesItems) {
  const el = document.getElementById('public-order-sales-chart');
  if (!el) return;
  if (!Array.isArray(orderItems) || !Array.isArray(salesItems) || orderItems.length < 2 || salesItems.length < 2) {
    el.innerHTML = '<div class="empty-state">暂无趋势数据</div>';
    return;
  }
  const chart = (items, key, title, tag, unit, color, gradientId, formatter, icon) => {
    const width = 360;
    const height = 178;
    const left = 40;
    const right = 12;
    const top = 16;
    const bottom = 142;
    const max = Math.max(...items.map((item) => Number(item[key]) || 0), 1) * 1.12;
    const x = (index) => left + index * ((width - left - right) / Math.max(items.length - 1, 1));
    const makePoints = (values) => values.map((value, index) => ({
      x: x(index),
      y: bottom - value / max * (bottom - top),
      label: formatShortDate(items[index].date),
      value,
    }));
    const currentPoints = makePoints(items.map((item) => Number(item[key]) || 0));
    const previousPoints = makePoints(currentPoints.map((item, index) => item.value * (.62 + (index % 3) * .06)));
    const path = (points) => points.map((item, index) => (index ? 'L' : 'M') + ' ' + item.x.toFixed(1) + ' ' + item.y.toFixed(1)).join(' ');
    const currentPath = path(currentPoints);
    const previousPath = path(previousPoints);
    const grid = [0, 1, 2, 3, 4].map((index) => {
      const y = top + index * ((bottom - top) / 4);
      return '<line class="chart-grid-line" x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '" />';
    }).join('');
    const labels = currentPoints.map((item) => '<text class="chart-axis-label" x="' + item.x.toFixed(1) + '" y="166" text-anchor="middle">' + escapeHtml(item.label) + '</text>').join('');
    const yLabels = [0, .5, 1].map((ratio) => '<text class="trend-axis-label" x="4" y="' + (bottom - ratio * (bottom - top)).toFixed(1) + '">' + escapeHtml(formatter(max * ratio)) + '</text>').join('');
    const dots = currentPoints.map((item) => {
      const label = item.label + '：' + formatter(item.value);
      return '<g class="trend-chart-node" tabindex="0" role="img" aria-label="' + escapeHtml(label) + '"><circle class="trend-chart-hit" cx="' + item.x.toFixed(1) + '" cy="' + item.y.toFixed(1) + '" r="11"></circle><circle class="trend-chart-point" style="--point-color:' + color + '" cx="' + item.x.toFixed(1) + '" cy="' + item.y.toFixed(1) + '" r="3.5"></circle><title>' + escapeHtml(label) + '</title></g>';
    }).join('');
    const area = currentPath + ' L ' + currentPoints.at(-1).x.toFixed(1) + ' ' + bottom + ' L ' + currentPoints[0].x.toFixed(1) + ' ' + bottom + ' Z';
    const end = currentPoints.at(-1);
    const endLabel = formatter(end.value);
    const badgeX = width - 70;
    const badgeY = Math.max(top + 2, end.y - 25);
    const badge = '<g class="trend-end-label"><rect x="' + badgeX + '" y="' + badgeY.toFixed(1) + '" width="58" height="18" rx="4"/><text x="' + (badgeX + 29) + '" y="' + (badgeY + 12).toFixed(1) + '" text-anchor="middle">' + escapeHtml(endLabel) + '</text></g>';
    return '<article class="trend-chart-card"><div class="trend-chart-card-head"><span class="trend-chart-card-icon">' + escapeHtml(icon) + '</span><div><small>' + escapeHtml(tag) + '</small><strong>' + escapeHtml(title) + '</strong></div><b>峰值 ' + escapeHtml(formatter(Math.max(...currentPoints.map((item) => item.value)))) + '</b></div><div class="trend-chart-card-legend"><i style="--trend-color:' + color + '"></i>本期' + escapeHtml(title) + '（' + escapeHtml(unit) + '）<i class="previous"></i>上一周期</div><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(title + '近七日趋势') + '"><defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".3"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' + grid + yLabels + '<path class="trend-chart-area" style="--trend-area:' + color + '" fill="url(#' + gradientId + ')" d="' + area + '"/><path class="trend-chart-line previous" d="' + previousPath + '"/><path class="trend-chart-line" style="--trend-color:' + color + '" d="' + currentPath + '"/>' + dots + badge + labels + '</svg></article>';
  };
  el.innerHTML = chart(orderItems, 'quantity', '订单量趋势', 'ORDER VOLUME', 'kg', '#35b9ff', 'orderTrendArea', formatNumber, '▥') + chart(salesItems, 'amount', '销售额趋势', 'SALES AMOUNT', 'CNY', '#f3bd57', 'salesTrendArea', formatMoney, '◒');
}

function renderEnterpriseOrderTable(items) {
  const el = document.getElementById('public-enterprise-orders');
  if (!el) return;
  state.publicEnterpriseRows = Array.isArray(items) ? items : [];
  const rows = state.publicEnterpriseRows.slice(0, state.publicEnterpriseExpanded ? 8 : 5);
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无企业订单明细</div>';
    return;
  }
  const renderRows = (duplicate = false) => rows.map((item) => '<button class="enterprise-order-row" type="button" data-enterprise="' + escapeHtml(item.enterprise_label) + '" title="点击查看 ' + escapeHtml(item.enterprise_label) + ' 订单明细"' + (duplicate ? ' tabindex="-1" aria-hidden="true"' : '') + '><span><strong>' + escapeHtml(item.enterprise_label) + '</strong><small>' + escapeHtml(item.category) + '</small></span><b>' + formatNumber(item.committed_order_quantity) + ' kg</b><i><em style="width:' + Math.max(4, Math.min(100, Number(item.completion_percent) || 0)) + '%"></em></i><mark class="' + (item.status === '库存预警' || item.status === '产能紧张' ? 'warn' : '') + '">' + escapeHtml(item.status) + '</mark></button>').join('');
  const trackRows = renderRows() + (state.publicEnterpriseExpanded ? renderRows(true) : '');
  el.innerHTML = '<div class="enterprise-order-head"><span>企业 / 品类</span><span>订单量</span><span>完成</span><span>状态</span></div><div class="enterprise-order-window' + (state.publicEnterpriseExpanded ? ' is-expanded' : '') + '"><div class="enterprise-order-track' + (state.publicEnterpriseExpanded ? ' is-scrolling' : '') + '">' + trackRows + '</div></div>';
  if (state.publicEnterpriseExpanded) {
    const windowEl = el.querySelector('.enterprise-order-window');
    bindWheelScroll(windowEl, () => el.querySelector('.enterprise-order-track'));
  }
  el.querySelectorAll('.enterprise-order-row').forEach((button) => button.addEventListener('click', () => {
    setPublicText('public-sync-state', button.dataset.enterprise + '：订单明细已展开（演示）。');
  }));
}

function renderProcurementDonut(items) {
  const el = document.getElementById('public-procurement-chart');
  if (!el) return;
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无采购汇总</div>';
    return;
  }
  const colors = ['#35b9ff', '#7c83ff', '#f3bd57', '#52d49a', '#d979b0'];
  const total = rows.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  const segments = rows.map((item, index) => {
    const value = Number(item.value || 0);
    const length = value / total * circumference;
    const offset = cursor * circumference;
    cursor += value / total;
    const label = item.label + '：' + formatMoney(value) + '，占比 ' + Number(item.share_percent || 0).toFixed(1) + '%';
    return '<circle class="procurement-segment" data-index="' + index + '" cx="56" cy="56" r="' + radius + '" fill="none" stroke="' + colors[index % colors.length] + '" stroke-width="18" stroke-dasharray="' + length.toFixed(2) + ' ' + Math.max(0, circumference - length).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" tabindex="0" role="button" aria-label="' + escapeHtml(label) + '"><title>' + escapeHtml(label) + '</title></circle>';
  }).join('');
  const legend = rows.map((item, index) => '<button type="button" class="procurement-row" data-index="' + index + '" title="悬停查看 ' + escapeHtml(item.label) + ' 采购占比"><i style="--legend-color:' + colors[index % colors.length] + '"></i><span>' + escapeHtml(item.label) + '</span><strong>' + formatMoney(item.value) + '</strong><small>' + Number(item.share_percent || 0).toFixed(1) + '%</small></button>').join('');
  el.innerHTML = '<div class="procurement-donut" title="批量采购总额：' + escapeHtml(formatMoney(total)) + '"><svg viewBox="0 0 112 112" aria-label="集中采购金额结构"><circle class="procurement-track" cx="56" cy="56" r="' + radius + '" fill="none" stroke-width="18"></circle><g transform="rotate(-90 56 56)">' + segments + '</g></svg><div class="procurement-donut-center"><strong>' + formatCompactMoney(total) + '</strong><span>采购合计</span></div></div><div class="procurement-legend">' + legend + '</div>';
  const center = el.querySelector('.procurement-donut-center');
  const centerValue = center.querySelector('strong');
  const centerLabel = center.querySelector('span');
  const segmentEls = [...el.querySelectorAll('.procurement-segment')];
  const legendEls = [...el.querySelectorAll('.procurement-row')];
  const setActive = (index = null) => {
    const active = Number.isInteger(index) && rows[index];
    el.classList.toggle('has-active', Boolean(active));
    segmentEls.forEach((segment) => segment.classList.toggle('is-active', Number(segment.dataset.index) === index));
    legendEls.forEach((row) => row.classList.toggle('is-active', Number(row.dataset.index) === index));
    center.classList.toggle('is-active', Boolean(active));
    if (active) {
      const value = Number(active.value || 0);
      centerValue.textContent = Math.abs(value) >= 10000 ? '¥' + (value / 10000).toFixed(2) + '万' : formatMoney(value);
      centerLabel.textContent = active.label;
      center.title = active.label + '：' + formatMoney(value);
    } else {
      centerValue.textContent = formatCompactMoney(total);
      centerLabel.textContent = '采购合计';
      center.title = '批量采购总额：' + formatMoney(total);
    }
  };
  [...segmentEls, ...legendEls].forEach((target) => {
    const activate = () => setActive(Number(target.dataset.index));
    target.addEventListener('mouseenter', activate);
    target.addEventListener('focus', activate);
    target.addEventListener('click', activate);
    target.addEventListener('mouseleave', () => setActive());
    target.addEventListener('blur', () => setActive());
  });
}

function renderTransportSummary(items) {
  const el = document.getElementById('public-transport');
  if (!el) return;
  const rows = items || [];
  const vehicles = rows.reduce((sum, item) => sum + Number(item.required_vehicle_count || 0), 0);
  const fee = rows.reduce((sum, item) => sum + Number(item.estimated_fee || 0), 0);
  const abnormal = rows.filter((item) => item.anomaly).length;
  el.innerHTML = '<div class="transport-stat"><strong>' + escapeHtml(rows.length) + '</strong><span>展示任务</span></div><div class="transport-stat"><strong>' + escapeHtml(vehicles) + '</strong><span>所需车辆</span></div><div class="transport-stat"><strong>' + escapeHtml(formatMoney(fee)) + '</strong><span>预计费用</span></div><div class="transport-stat ' + (abnormal ? 'alert' : '') + '"><strong>' + escapeHtml(abnormal) + '</strong><span>异常任务</span></div>';
}

function renderEnterpriseDonut(items) {
  const el = document.getElementById('public-enterprise-chart');
  if (!el) return;
  const rows = (items || []).slice(0, 10);
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无企业订单数据</div>';
    return;
  }
  const colors = ['#59d69a', '#38b97f', '#87d68f', '#d4b85e', '#65b6ae', '#4d8fc3', '#9178c5', '#cc7f6f', '#8aa25c', '#5e7f73'];
  const total = rows.reduce((sum, item) => sum + Number(item.committed_order_quantity || 0), 0) || 1;
  let cursor = 0;
  const segments = rows.map((item, index) => {
    const start = cursor;
    cursor += Number(item.committed_order_quantity || 0) / total * 100;
    return `${colors[index]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const legend = rows.map((item, index) => `<div title="${escapeHtml(item.enterprise_label)}：${escapeHtml(formatNumber(item.committed_order_quantity))}"><i style="--legend-color:${colors[index]}"></i><span>${escapeHtml(item.enterprise_label)}</span><strong>${escapeHtml((Number(item.committed_order_quantity || 0) / total * 100).toFixed(1))}%</strong></div>`).join('');
  el.innerHTML = `<div class="donut-visual" style="background:conic-gradient(${segments.join(',')})"><div class="donut-center"><strong>${escapeHtml(formatNumber(total))}</strong><span>订单总量 kg</span></div></div><div class="donut-legend">${legend}</div>`;
}

function renderPreorderList(items) {
  const el = document.getElementById('public-preorders');
  if (!el) return;
  const rows = [...(items || [])].sort((a, b) => String(a.required_start_at).localeCompare(String(b.required_start_at))).slice(0, 7);
  el.innerHTML = rows.map((item) => `<div class="preorder-item" title="${escapeHtml(item.partner_display_name)} · ${escapeHtml(item.category)} · ${escapeHtml(formatNumber(item.quantity))} ${escapeHtml(item.unit)}"><strong>${escapeHtml(item.partner_display_name)}</strong><span>${escapeHtml(item.category)}</span><b>${escapeHtml(formatNumber(item.quantity))} ${escapeHtml(item.unit)}</b><time>${escapeHtml(formatShortDate(item.required_start_at, true))}</time></div>`).join('') || '<div class="empty-state">暂无预订单</div>';
}


function renderPolicyFeed(items) {
  const el = document.getElementById('public-policies');
  if (!el) return;
  const rows = items || [];
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state">暂无政策词条</div>';
    return;
  }
  const displayRows = rows.length > 4 ? [...rows, ...rows] : rows;
  el.innerHTML = displayRows.map((item) => '<a class="screen-policy-item" href="' + escapeHtml(item.source_url) + '" target="_blank" rel="noreferrer"><span>' + escapeHtml(item.category) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.summary) + ' · ' + escapeHtml(item.source_type || 'OFFICIAL') + '</small></div></a>').join('');
}

function renderNewsFeed(items) {
  const el = document.getElementById('public-news');
  if (!el) return;
  const rows = Array.isArray(items) ? items : [];
  const displayRows = rows.length > 3 ? [...rows, ...rows] : rows;
  el.innerHTML = displayRows.map((item) => '<button type="button" class="screen-news-item ' + escapeHtml(item.tone || 'blue') + '" data-news-title="' + escapeHtml(item.title) + '"><span class="news-image">' + escapeHtml(item.category) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.published_label) + ' · ' + escapeHtml(item.summary) + '</small></div></button>').join('') || '<div class="empty-state">暂无园区动态</div>';
  el.querySelectorAll('.screen-news-item').forEach((button) => button.addEventListener('click', () => {
    setPublicText('public-sync-state', button.dataset.newsTitle + '：演示动态详情已展开，正式环境将跳转公开来源。');
  }));
}

function bindWheelScroll(container, contentGetter) {
  if (!container || container.dataset.wheelReady === 'true') return;
  let resumeTimer = null;
  container.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) < 1 || container.scrollHeight <= container.clientHeight) return;
    event.preventDefault();
    container.scrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + event.deltaY));
    const content = contentGetter && contentGetter();
    if (content) {
      content.style.animationPlayState = 'paused';
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { content.style.animationPlayState = 'running'; }, 1200);
    }
  }, { passive: false });
  container.dataset.wheelReady = 'true';
}

function renderRouteMap(items) {
  const el = document.getElementById('public-route-map');
  if (!el) return;
  const routes = (items || []).filter((item) => item.destination_district).slice(0, 10);
  const tileZoom = 8;
  const tileGridSize = 7;
  const tileCoverage = 4.2;
  const tileCoords = Array.from({ length: tileGridSize * tileGridSize }, (_, index) => [214 + index % tileGridSize, 90 + Math.floor(index / tileGridSize)]);
  const geoPoint = (longitude, latitude) => {
    const x = Math.max(4, Math.min(96, ((Number(longitude) - 124.4) / (126.7 - 124.4)) * 100));
    const y = Math.max(4, Math.min(94, ((44.85 - Number(latitude)) / (44.85 - 43.35)) * 100));
    return [x, y];
  };
  const center = geoPoint(125.305, 43.865);
  const fallbackPoints = (route) => [[125.305, 43.865], [Number(route.destination_longitude), Number(route.destination_latitude)]];
  const toScreenPoints = (route) => {
    const source = Array.isArray(route.route_points) && route.route_points.length >= 2 ? route.route_points : fallbackPoints(route);
    return source.map((point) => Array.isArray(point) ? geoPoint(point[0], point[1]) : geoPoint(point.longitude, point.latitude));
  };
  const lineLength = (from, to) => Math.hypot(to[0] - from[0], to[1] - from[1]);
  const pointOnRoute = (points, progress) => {
    const lengths = points.slice(1).map((point, index) => lineLength(points[index], point));
    const total = lengths.reduce((sum, value) => sum + value, 0) || 1;
    let target = total * Math.max(0, Math.min(1, progress));
    for (let index = 0; index < lengths.length; index += 1) {
      if (target <= lengths[index]) {
        const ratio = lengths[index] ? target / lengths[index] : 0;
        return [points[index][0] + (points[index + 1][0] - points[index][0]) * ratio, points[index][1] + (points[index + 1][1] - points[index][1]) * ratio];
      }
      target -= lengths[index];
    }
    return points.at(-1);
  };
  const geometries = routes.map((route) => {
    const points = toScreenPoints(route);
    const progress = Number.isFinite(Number(route.route_progress_percent)) ? Number(route.route_progress_percent) / 100 : .42;
    return { route, points, destination: points.at(-1), vehicle: pointOnRoute(points, progress), progress: Math.round(progress * 100) };
  });
  const routePaths = geometries.map(({ route, points }) => {
    const d = points.map((point, index) => (index ? 'L ' : 'M ') + point[0].toFixed(1) + ' ' + point[1].toFixed(1)).join(' ');
    return '<path class="map-route-path ' + (route.anomaly ? 'abnormal' : '') + '" d="' + d + '"><title>' + escapeHtml(route.destination_district + ' · 模拟运输路线') + '</title></path>';
  }).join('');
  const nodes = geometries.map(({ route, destination }) => '<button type="button" class="map-node ' + (route.anomaly ? 'abnormal' : '') + '" style="--x:' + destination[0].toFixed(1) + '%;--y:' + destination[1].toFixed(1) + '%" data-route-id="' + escapeHtml(route.task_id) + '" title="' + escapeHtml(route.destination_district) + '：' + escapeHtml(route.vehicle_type_name) + '，' + escapeHtml(route.driver_name) + '，' + escapeHtml(route.license_plate) + '"><i></i><strong>' + escapeHtml(route.destination_district) + '</strong><small>' + escapeHtml(route.status) + '</small></button>').join('');
  const vehicles = geometries.map(({ route, vehicle, progress }) => '<button type="button" class="map-vehicle ' + (route.anomaly ? 'abnormal' : '') + '" style="--x:' + vehicle[0].toFixed(1) + '%;--y:' + vehicle[1].toFixed(1) + '%" data-route-id="' + escapeHtml(route.task_id) + '" aria-label="' + escapeHtml(route.driver_name + ' · ' + route.license_plate + ' · 路线进度 ' + progress + '%') + '" title="' + escapeHtml(route.driver_name + ' · ' + route.license_plate + ' · 路线进度 ' + progress + '%') + '"><span aria-hidden="true">🚚</span><small>' + escapeHtml(route.license_plate) + '</small></button>').join('');
  const tiles = tileCoords.map(([x, y]) => '<img src="https://tile.openstreetmap.org/' + tileZoom + '/' + x + '/' + y + '.png" alt="" loading="eager" draggable="false" referrerpolicy="no-referrer">').join('');
  const scene = '<div class="map-scene" style="--map-zoom:' + state.publicMapZoom.toFixed(2) + '"><div class="map-tile-layer" aria-hidden="true">' + tiles + '</div><div class="map-grid-label">长春市服务范围 · 模拟路线与车辆位置</div><svg class="map-route-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="长春市模拟运输路线">' + routePaths + '</svg><div class="map-center-node" style="--x:' + center[0].toFixed(1) + '%;--y:' + center[1].toFixed(1) + '%"><i></i><strong>新安食品产业园</strong><small>长春市中心节点</small></div>' + nodes + vehicles + '</div>';
  el.innerHTML = scene + '<div class="map-attribution">© OpenStreetMap contributors · DEMO_SIMULATION</div><div id="public-route-detail" class="map-route-detail" hidden></div>';
  const detail = document.getElementById('public-route-detail');
  el.querySelectorAll('.map-node, .map-vehicle').forEach((button) => button.addEventListener('click', () => {
    if (state.publicMapSuppressClickUntil > Date.now()) return;
    const geometry = geometries.find((item) => item.route.task_id === button.dataset.routeId);
    const route = geometry && geometry.route;
    if (!route || !detail) return;
    detail.hidden = false;
    detail.innerHTML = '<strong>' + escapeHtml(route.destination_district) + ' · ' + escapeHtml(route.destination) + '</strong><span>' + escapeHtml(route.driver_name) + ' · ' + escapeHtml(route.license_plate) + ' · ' + escapeHtml(route.vehicle_type_name) + '</span><span>' + escapeHtml(route.required_vehicle_count) + ' 辆 · ' + escapeHtml(formatMoney(route.estimated_fee)) + ' · 路线进度 ' + escapeHtml(geometry.progress) + '% · ' + (route.anomaly ? '异常：' : '状态：') + escapeHtml(route.anomaly ? route.anomaly_reason : route.status) + '</span>';
  }));
  const zoomLevel = document.getElementById('public-map-zoom-level');
  const mapScene = el.querySelector('.map-scene');
  const mapWidth = mapScene ? mapScene.offsetWidth : el.clientWidth;
  const mapHeight = mapScene ? mapScene.offsetHeight : el.clientHeight;
  const viewportWidth = el.clientWidth;
  const viewportHeight = el.clientHeight;
  const clampZoom = (value) => Math.max(.3, Math.min(3, value));
  const applyMapView = () => {
    if (mapScene) {
      const maxPanX = Math.max(0, (mapWidth * state.publicMapZoom * tileCoverage - viewportWidth) / 2);
      const maxPanY = Math.max(0, (mapHeight * state.publicMapZoom * tileCoverage - viewportHeight) / 2);
      state.publicMapPanX = Math.max(-maxPanX, Math.min(maxPanX, state.publicMapPanX));
      state.publicMapPanY = Math.max(-maxPanY, Math.min(maxPanY, state.publicMapPanY));
      mapScene.style.transform = 'translate(' + state.publicMapPanX.toFixed(1) + 'px, ' + state.publicMapPanY.toFixed(1) + 'px) scale(' + state.publicMapZoom.toFixed(2) + ')';
    }
    if (zoomLevel) zoomLevel.textContent = Math.round(state.publicMapZoom * 100) + '%';
  };
  const zoomOut = document.getElementById('public-map-zoom-out');
  const zoomIn = document.getElementById('public-map-zoom-in');
  const zoomReset = document.getElementById('public-map-zoom-reset');
  if (zoomOut) zoomOut.onclick = () => { state.publicMapZoom = clampZoom(state.publicMapZoom - .15); applyMapView(); };
  if (zoomIn) zoomIn.onclick = () => { state.publicMapZoom = clampZoom(state.publicMapZoom + .15); applyMapView(); };
  if (zoomReset) zoomReset.onclick = () => { state.publicMapZoom = 1.08; state.publicMapPanX = 0; state.publicMapPanY = 0; applyMapView(); };
  const onMapWheel = (event) => {
    event.preventDefault();
    const previousZoom = state.publicMapZoom;
    const nextZoom = clampZoom(previousZoom * Math.exp(-event.deltaY * .0012));
    const bounds = el.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left - bounds.width / 2) * (viewportWidth / bounds.width);
    const pointerY = (event.clientY - bounds.top - bounds.height / 2) * (viewportHeight / bounds.height);
    const ratio = nextZoom / previousZoom;
    state.publicMapPanX = pointerX - (pointerX - state.publicMapPanX) * ratio;
    state.publicMapPanY = pointerY - (pointerY - state.publicMapPanY) * ratio;
    state.publicMapZoom = nextZoom;
    applyMapView();
  };
  let drag = null;
  const beginDrag = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (drag) return;
    const bounds = el.getBoundingClientRect();
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scaleX: viewportWidth / bounds.width, scaleY: viewportHeight / bounds.height, originX: state.publicMapPanX, originY: state.publicMapPanY, moved: false };
  };
  const moveDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - drag.startX) * drag.scaleX;
    const deltaY = (event.clientY - drag.startY) * drag.scaleY;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      drag.moved = true;
      el.classList.add('is-dragging');
      try { el.setPointerCapture(event.pointerId); } catch (error) { /* 指针已结束时无需继续捕获 */ }
    }
    if (drag.moved) {
      event.preventDefault();
      state.publicMapPanX = drag.originX + deltaX;
      state.publicMapPanY = drag.originY + deltaY;
      applyMapView();
    }
  };
  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) state.publicMapSuppressClickUntil = Date.now() + 220;
    drag = null;
    el.classList.remove('is-dragging');
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  };
  const preventNativeDrag = (event) => event.preventDefault();
  if (state.publicMapDragCleanup) state.publicMapDragCleanup();
  const dragListeners = [
    ['pointerdown', beginDrag], ['pointermove', moveDrag], ['pointerup', endDrag], ['pointercancel', endDrag], ['lostpointercapture', endDrag],
    ['dragstart', preventNativeDrag], ['selectstart', preventNativeDrag], ['wheel', onMapWheel],
  ];
  dragListeners.forEach(([type, handler]) => el.addEventListener(type, handler, type === 'wheel' ? { passive: false } : undefined));
  state.publicMapDragCleanup = () => {
    dragListeners.forEach(([type, handler]) => el.removeEventListener(type, handler));
  };
  applyMapView();
}

function renderAssistant(summary, preorderItems) {
  const el = document.getElementById('public-assistant');
  if (!el) return;
  const warningCount = Number(summary.warning_count || 0);
  const preorderCount = Array.isArray(preorderItems) ? preorderItems.length : 0;
  el.innerHTML = '<div class="assistant-widget"><div class="assistant-avatar" aria-hidden="true">🤖</div><div class="assistant-bubble"><small>园区协同机器人 · 在线</small><p class="assistant-answer" id="public-assistant-answer">已接收长春市服务范围数据：' + escapeHtml(summary.enterprise_count) + ' 家企业、' + escapeHtml(summary.order_count_total) + ' 笔订单。当前建议优先关注 ' + escapeHtml(warningCount) + ' 条库存/产能预警。</p></div></div><div class="assistant-questions"><button type="button" data-answer="建议先向长春市净月区生鲜节点补货，并把净菜产能反馈给生产计划。">库存预警</button><button type="button" data-answer="当前长春市周边有 ' + escapeHtml(preorderCount) + ' 条预订单，建议按区域合并车辆后再确认费用。">订单排产</button><button type="button" data-answer="运输匹配会优先选择温控范围匹配、距离较近且状态正常的车辆。">运输匹配</button></div>';
  const answer = document.getElementById('public-assistant-answer');
  el.querySelectorAll('.assistant-questions button').forEach((button) => button.addEventListener('click', () => { if (answer) answer.textContent = button.dataset.answer; }));
}
function applyPublicScreenScale() {
  const canvas = document.getElementById('public-screen-canvas');
  if (!canvas || !document.body.classList.contains('screen-mode')) return;
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function updatePublicClock() {
  const now = new Date();
  const clock = document.getElementById('public-clock');
  const date = document.getElementById('public-date');
  if (clock) clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  if (date) date.textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
}

async function togglePublicFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    const stateEl = document.getElementById('public-sync-state');
    if (stateEl) stateEl.textContent = `全屏切换失败：${error.message}`;
  }
}

function setupOverviewDetails() {
  const popover = document.getElementById('overview-detail-popover');
  const targetLabels = {
    enterprise: '主数据与企业',
    production: '生产计划与订单',
    inventory: '库存、销售与冻库',
    transport: '运输任务与资源',
  };
  const hide = () => {
    if (!popover) return;
    popover.hidden = true;
    popover.dataset.pinned = '';
    popover.replaceChildren();
    document.querySelectorAll('.detail-card').forEach((item) => {
      item.classList.remove('is-selected');
      item.setAttribute('aria-expanded', 'false');
    });
  };
  const show = (card, pinned = false) => {
    if (!popover) return;
    const label = card.querySelector('span')?.textContent || '总览指标';
    const value = card.querySelector('strong')?.textContent || '—';
    const title = document.createElement('strong');
    title.textContent = `${label}：${value}`;
    const description = document.createElement('span');
    description.textContent = card.dataset.detail || '';
    popover.replaceChildren(title, description);
    popover.dataset.pinned = pinned ? `${card.dataset.targetSection}:${card.dataset.targetResource}` : '';
    popover.hidden = false;
    card.classList.toggle('is-selected', pinned);
    card.setAttribute('aria-expanded', pinned ? 'true' : 'false');
    if (!pinned) return;
    const actions = document.createElement('span');
    actions.className = 'detail-actions';
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'button secondary detail-action';
    openButton.textContent = `进入${targetLabels[card.dataset.targetSection] || '对应列表'}`;
    openButton.addEventListener('click', () => {
      const targetSection = card.dataset.targetSection;
      const targetResource = card.dataset.targetResource;
      if (targetSection && targetResource && state.resource[targetSection] !== undefined) {
        state.resource[targetSection] = targetResource;
        const select = document.getElementById(`${targetSection}-resource`);
        if (select) select.value = targetResource;
      }
      hide();
      if (targetSection) showSection(targetSection);
    });
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'button ghost detail-action';
    closeButton.textContent = '收起';
    closeButton.addEventListener('click', hide);
    actions.append(openButton, closeButton);
    popover.append(actions);
    document.querySelectorAll('.detail-card').forEach((item) => {
      if (item !== card) {
        item.classList.remove('is-selected');
        item.setAttribute('aria-expanded', 'false');
      }
    });
  };
  document.querySelectorAll('.detail-card').forEach((card) => {
    card.addEventListener('mouseenter', () => { if (!popover?.dataset.pinned) show(card); });
    card.addEventListener('focus', () => { if (!popover?.dataset.pinned) show(card); });
    card.addEventListener('click', () => {
      const key = `${card.dataset.targetSection}:${card.dataset.targetResource}`;
      if (popover?.dataset.pinned === key) hide();
      else show(card, true);
    });
    card.addEventListener('mouseleave', () => { if (!popover?.dataset.pinned) hide(); });
    card.addEventListener('blur', () => { if (!popover?.dataset.pinned) hide(); });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        card.click();
      }
    });
  });
}

function renderAuthState(user) {
  const stateEl = document.getElementById('auth-state');
  const loginButton = document.getElementById('open-login');
  const logoutButton = document.getElementById('logout-button');
  if (user) {
    stateEl.textContent = `${user.username} · ${user.role}`;
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else {
    stateEl.textContent = getAPI().isMock() ? 'Mock E01 会话' : '未登录';
    loginButton.hidden = false;
    logoutButton.hidden = true;
  }
}

function requireAuth(result) {
  if (result && result.status === 401 && !getAPI().isMock()) {
    document.getElementById('auth-panel').hidden = false;
    setMessage('E01 接口需要登录，请先输入后端账号。', 'warning');
    return true;
  }
  return false;
}

async function loadOverview() {
  setLoading('overview-body');
  const result = await getAPI().getDashboard('overview');
  if (!result.ok) {
    requireAuth(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  const data = dataOf(result) || {};
  const cards = {
    'kpi-enterprise-count': data.enterprise_count,
    'kpi-production-count': data.production_plan_count,
    'kpi-inventory-count': data.inventory_record_count,
    'kpi-preorder-count': data.preorder_count,
    'kpi-transport-count': data.transport_task_count,
    'kpi-freezer-count': data.freezer_count,
  };
  Object.entries(cards).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatValue(value);
  });
  const cutoff = result.json && result.json.data_cutoff;
  document.getElementById('data-cutoff').textContent = formatValue(cutoff);
  renderTable('overview-enterprise-details', data.details || [], '暂无企业明细');
  document.getElementById('overview-body').textContent = `E01 总览已同步：预计订单 ${formatValue(data.expected_order_quantity)}，已承担订单 ${formatValue(data.committed_order_quantity)}，销售额 ${formatValue(data.sales_amount_total)}；当前未处理库存预警 ${formatValue(data.inventory_alert_count)}。`;
  setMessage('E01 总览加载完成。', 'success');
}

async function loadResource(section) {
  const resource = state.resource[section];
  const resultTarget = `${section}-table`;
  setLoading(resultTarget);
  const result = await getAPI().list(resource);
  if (!result.ok) {
    requireAuth(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  const data = dataOf(result) || {};
  renderTable(resultTarget, data.items || []);
  const total = document.getElementById(`${section}-total`);
  if (total) total.textContent = `${data.total || 0} 条记录`;
  if (section === 'inventory') {
    const alerts = (data.items || []).filter((item) => item.inventory_alert_status || item.warning_status === 'WARNING');
    document.getElementById('inventory-alerts').textContent = alerts.length ? `当前列表有 ${alerts.length} 条库存预警，状态：${alerts.map((item) => item.inventory_alert_status || item.warning_status).join('、')}。` : '当前列表暂无已生成库存预警；阈值申请需企业提交并由园区审批。';
  }
  if (section === 'transport') {
    const monitored = (data.items || []).filter((item) => item.telemetry && item.telemetry.length);
    document.getElementById('transport-monitoring').textContent = monitored.length ? `当前有 ${monitored.length} 条运输任务带遥测记录，异常点将在 E02 以红色展示。` : '当前没有遥测记录；可先用 DEMO_SIMULATION 数据演示路径和温湿度异常。';
  }
}

async function loadPublicDashboard() {
  ['public-capacity', 'public-transport', 'public-order-sales-chart', 'public-route-map', 'public-policies', 'public-news', 'public-procurement-chart', 'public-enterprise-orders', 'public-assistant'].forEach((target) => setLoading(target));
  const syncState = document.getElementById('public-sync-state');
  if (syncState) syncState.textContent = '正在同步公开数据…';
  const [overview, capacity, preorders, transport, policies, news] = await Promise.all([
    getAPI().getPublicDashboard('overview'),
    getAPI().getPublicDashboard('capacity'),
    getAPI().getPublicDashboard('preorders'),
    getAPI().getPublicDashboard('transport'),
    getAPI().getPublicDashboard('policies'),
    getAPI().getPublicDashboard('news'),
  ]);
  if (!overview.ok || !capacity.ok || !preorders.ok || !transport.ok || !policies.ok || !news.ok) {
    const message = errorOf([overview, capacity, preorders, transport, policies, news].find((item) => !item.ok));
    if (syncState) syncState.textContent = '同步失败：' + message;
    setMessage(message, 'error');
    return;
  }
  const summary = dataOf(overview) || {};
  const transportItems = dataOf(transport) || [];
  const transportTotal = Object.values(summary.transport_task_counts || {}).reduce((sum, item) => sum + Number(item || 0), 0);
  const abnormalCount = transportItems.filter((item) => item.anomaly).length;
  const orderTrend = summary.order_trend || [];
  const salesTrend = summary.sales_trend || [];
  setPublicText('public-enterprise-count', formatNumber(summary.enterprise_count));
  setPublicText('public-capacity-total', formatValue(summary.capacity_occupancy_percent) + '%');
  setPublicText('public-order-count', formatNumber(summary.order_count_total));
  setPublicText('public-procurement-total', formatMoney(summary.procurement_amount_total));
  setPublicText('public-transport-total', formatNumber(transportTotal || transportItems.length));
  setPublicText('public-sales-total', formatMoney(summary.sales_amount_total));
  setPublicText('public-capacity-occupancy', '占用 ' + formatValue(summary.capacity_occupancy_percent) + '%');
  setPublicText('public-transport-kpi-note', abnormalCount ? abnormalCount + ' 条异常路径' : '全部运行正常');
  setPublicText('public-order-peak', orderTrend.length ? '峰值 ' + formatNumber(Math.max(...orderTrend.map((item) => Number(item.quantity) || 0))) + ' kg' : '—');
  setPublicText('public-sales-peak', salesTrend.length ? '峰值 ' + formatMoney(Math.max(...salesTrend.map((item) => Number(item.amount) || 0))) : '—');
  setPublicText('public-trend-range', '近 ' + formatNumber(summary.trend_days || orderTrend.length) + ' 日 · 分图');
  setPublicText('public-data-cutoff', overview.json && overview.json.data_cutoff);
  renderCapacityList(dataOf(capacity) || []);
  renderTransportSummary(transportItems);
  renderTrendCharts(orderTrend, salesTrend);
  renderEnterpriseOrderTable(summary.enterprise_order_details || []);
  renderProcurementDonut(summary.procurement_pie || []);
  renderPolicyFeed(dataOf(policies) || []);
  renderNewsFeed(dataOf(news) || []);
  bindWheelScroll(document.getElementById('public-capacity'), () => document.querySelector('#public-capacity .capacity-track'));
  bindWheelScroll(document.querySelector('.policy-window'), () => document.querySelector('.policy-window > :not([hidden])'));
  renderRouteMap(transportItems);
  renderAssistant(summary, dataOf(preorders) || []);
  if (syncState) syncState.textContent = '数据同步正常';
  setMessage('E02 公开大屏已同步；长春市服务范围数据已加载。', 'success');
}

async function loadCalculation() {
  const kind = document.getElementById('calc-kind').value;
  const resultEl = document.getElementById('calculation-result');
  resultEl.textContent = '计算中…';
  let body = {};
  if (kind === 'routes/estimate') {
    body = {
      origin: document.getElementById('calc-origin').value.trim(),
      destination: document.getElementById('calc-destination').value.trim(),
    };
  }
  const result = await getAPI().calculate(kind, body);
  if (!result.ok) {
    requireAuth(result);
    resultEl.textContent = errorOf(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  resultEl.textContent = JSON.stringify(dataOf(result), null, 2);
  setMessage('B01 计算接口已返回结果；请按 calculation_status 处理缺失输入或规则。', 'success');
}

async function handleImport(event) {
  event.preventDefault();
  const file = document.getElementById('import-file').files[0];
  if (!file) {
    setMessage('请先选择 XLSX 文件。', 'warning');
    return;
  }
  document.getElementById('import-result').textContent = '正在预检整本工作簿…';
  const result = await getAPI().precheckImport(file);
  if (!result.ok) {
    requireAuth(result);
    document.getElementById('import-result').textContent = errorOf(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  const data = dataOf(result) || {};
  state.importBatchId = data.batch_id || null;
  document.getElementById('import-result').textContent = JSON.stringify(data, null, 2);
  document.getElementById('confirm-import').hidden = data.status !== 'READY_TO_CONFIRM';
  setMessage(data.status === 'READY_TO_CONFIRM' ? '预检通过，请确认后整本写入。' : '预检已返回，请查看结果。', 'success');
}

async function confirmImport() {
  if (!state.importBatchId) return;
  const result = await getAPI().confirmImport(state.importBatchId);
  if (!result.ok) {
    requireAuth(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  document.getElementById('import-result').textContent = JSON.stringify(dataOf(result), null, 2);
  document.getElementById('confirm-import').hidden = true;
  setMessage('导入批次已提交；后端按整本事务处理。', 'success');
}

function setupResourceSelects() {
  Object.entries(RESOURCE_GROUPS).forEach(([section, resources]) => {
    const select = document.getElementById(`${section}-resource`);
    resources.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    select.value = state.resource[section];
    select.addEventListener('change', async () => {
      state.resource[section] = select.value;
      await loadResource(section);
    });
    document.getElementById(`${section}-refresh`).addEventListener('click', () => loadResource(section));
  });
}

function showSection(section) {
  state.activeSection = section;
  const isPublic = section === 'public';
  document.body.classList.toggle('screen-mode', isPublic);
  document.querySelectorAll('.page-section').forEach((item) => item.classList.toggle('active', item.id === section));
  document.querySelectorAll('.sidebar button[data-section]').forEach((item) => item.classList.toggle('active', item.dataset.section === section));
  const titles = { overview: 'E01 管理总览', enterprise: '主数据与企业', production: '生产计划与订单', inventory: '库存、销售与冻库', transport: '运输任务与资源', import: 'B01 批量导入', analytics: 'B01 计算与建议', public: 'E02 公开大屏' };
  document.getElementById('page-title').textContent = titles[section] || '黑土闭环';
  if (section === 'overview') loadOverview();
  if (RESOURCE_GROUPS[section]) loadResource(section);
  if (isPublic) {
    updatePublicClock();
    requestAnimationFrame(applyPublicScreenScale);
    loadPublicDashboard();
  } else {
    window.scrollTo({ top: 0, left: 0 });
  }
}

async function exitPublicScreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  showSection('overview');
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const result = await getAPI().login(username, password);
  if (!result.ok) {
    document.getElementById('login-message').textContent = errorOf(result);
    return;
  }
  const me = await getAPI().getCurrentUser();
  renderAuthState(dataOf(me) || { username, role: 'E01' });
  document.getElementById('auth-panel').hidden = true;
  setMessage('E01 登录成功。', 'success');
  showSection(state.activeSection);
}

async function handleLogout() {
  await getAPI().logout();
  renderAuthState(null);
  document.getElementById('auth-panel').hidden = false;
  setMessage('已退出 E01 会话；E02 公开大屏仍可访问。', 'info');
}

function initPage() {
  const mockToggle = document.getElementById('toggle-mock');
  mockToggle.checked = getAPI().isMock();
  mockToggle.addEventListener('change', () => {
    localStorage.setItem('useMock', mockToggle.checked ? 'true' : 'false');
    getAPI().clearTokens();
    renderAuthState(null);
    setMessage(mockToggle.checked ? '已切换到本地 Mock 数据。' : `已切换到 Live：${getAPI().getLiveBase()}`, 'info');
    showSection(state.activeSection);
  });

  document.querySelectorAll('.sidebar button[data-section]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
  document.getElementById('open-login').addEventListener('click', () => { document.getElementById('auth-panel').hidden = false; });
  document.getElementById('close-login').addEventListener('click', () => { document.getElementById('auth-panel').hidden = true; });
  document.getElementById('logout-button').addEventListener('click', handleLogout);
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('import-form').addEventListener('submit', handleImport);
  document.getElementById('confirm-import').addEventListener('click', confirmImport);
  document.getElementById('calc-kind').addEventListener('change', () => {
    const isRoute = document.getElementById('calc-kind').value === 'routes/estimate';
    document.getElementById('route-fields').hidden = !isRoute;
    document.getElementById('route-fields-destination').hidden = !isRoute;
  });
  document.getElementById('run-calculation').addEventListener('click', loadCalculation);
  document.getElementById('public-refresh').addEventListener('click', loadPublicDashboard);
  document.getElementById('public-fullscreen').addEventListener('click', togglePublicFullscreen);
  document.getElementById('public-exit').addEventListener('click', exitPublicScreen);
  document.getElementById('public-enterprise-toggle').addEventListener('click', () => {
    state.publicEnterpriseExpanded = !state.publicEnterpriseExpanded;
    document.getElementById('public-enterprise-toggle').textContent = state.publicEnterpriseExpanded ? '收起明细' : '轮播明细';
    renderEnterpriseOrderTable(state.publicEnterpriseRows);
  });
  document.querySelectorAll('.news-tabs button').forEach((button) => button.addEventListener('click', () => {
    const showNews = button.dataset.feed === 'news';
    document.querySelectorAll('.news-tabs button').forEach((item) => item.classList.toggle('active', item === button));
    document.getElementById('public-policies').hidden = showNews;
    document.getElementById('public-news').hidden = !showNews;
  }));
  window.addEventListener('resize', applyPublicScreenScale);
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('public-fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
    applyPublicScreenScale();
  });
  updatePublicClock();
  window.setInterval(updatePublicClock, 1000);
  setupResourceSelects();
  setupOverviewDetails();
  renderAuthState(null);
  showSection('overview');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
else initPage();
