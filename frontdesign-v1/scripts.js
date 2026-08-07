const RESOURCE_GROUPS = {
  enterprise: [
    { value: 'enterprises', label: '企业档案' },
    { value: 'stores', label: '门店与第三空间' },
    { value: 'products', label: '商品与原料' },
    { value: 'suppliers', label: '供应商' },
  ],
  production: [
    { value: 'transport-orders', label: '多企业运输订单' },
    { value: 'transport-plans', label: '拼车运输计划' },
    { value: 'products', label: '商品与原料' },
  ],
  inventory: [
    { value: 'warehouses', label: '仓库与温区' },
    { value: 'products', label: '商品库存维度' },
  ],
  transport: [
    { value: 'transport-tasks', label: '运输任务实时投影' },
    { value: 'transport-plans', label: '拼车计划' },
    { value: 'alerts', label: '温湿度与运输报警' },
    { value: 'vehicles', label: '车辆与司机资源' },
  ],
};

const state = {
  activeSection: 'overview',
  resource: {
    enterprise: 'enterprises',
    production: 'transport-orders',
    inventory: 'warehouses',
    transport: 'transport-tasks',
  },
  resourcePage: { enterprise: 1, production: 1, inventory: 1, transport: 1 },
  resourceSearch: { enterprise: '', production: '', inventory: '', transport: '' },
  importBatchId: null,
  publicEnterpriseRows: [],
  publicEnterpriseExpanded: false,
  publicMapZoom: 1.08,
  publicMapPanX: 0,
  publicMapPanY: 0,
  publicMapSuppressClickUntil: 0,
  publicMapDragCleanup: null,
  lastMatchRunId: null,
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
  const details = body.details && typeof body.details === 'object' ? Object.values(body.details).join('；') : '';
  return first
    ? `${body.code || '请求失败'}：${first.message}`
    : `${body.code || '请求失败'}：${body.message || details || `HTTP ${result.status}`}`;
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

const FIELD_LABELS = {
  enterprise_id: '企业编号', enterprise_name: '企业名称', enterprise_display_name: '企业名称', park_id: '所属园区',
  store_id: '门店编号', store_name: '门店名称', city: '城市', channel_type: '渠道类型', reporting_authorized: '日报上报授权',
  partner_id: '合作方编号', partner_name: '合作方名称', preorder_id: '预订单编号', order_id: '订单编号', product_id: '产品编号',
  product_name: '产品名称', category: '品类', quantity: '数量', unit: '单位', amount: '金额', sales_amount: '营业额',
  status: '状态', required_at: '需求日期', created_at: '创建时间', updated_at: '更新时间', source_system: '数据来源',
  source_record_id: '来源记录编号', plan_date: '计划日期', daily_capacity: '日产能', planned_quantity: '计划数量',
  completed_quantity: '已完成数量', warning_threshold: '预警阈值', inventory_quantity: '库存数量', freezer_capacity: '冻库容量',
  task_id: '任务编号', origin: '起点', destination: '终点', driver_name: '司机', license_plate: '车牌号',
  id: '记录编号', code: '业务编码', name: '名称', enabled: '是否启用', object_version: '数据版本', display_name: '显示名称',
  channel: '渠道', latitude: '纬度', longitude: '经度', temperature_zone: '温区', plate_no: '车牌号', driver_id: '司机编号',
  max_weight_kg: '最大载重（千克）', max_volume_m3: '最大容积（立方米）', capacity_m3: '总库容（立方米）', used_m3: '已用库容（立方米）',
  plan_no: '计划编号', task_no: '任务编号', store_id: '门店编号', product_id: '商品编号', order_no: '订单编号', scenario_code: '演示场景',
  departure_at: '计划发车时间', weight_kg: '重量（千克）', volume_m3: '体积（立方米）', task_id: '执行任务编号',
  source_order_ids: '来源订单', total_weight_kg: '总重量（千克）', total_volume_m3: '总体积（立方米）', stops: '配送站点',
  latest_telemetry: '最新温湿度', latest_location: '最新位置', route_label: '路线性质', alert_type: '报警类型', message: '报警说明', opened_at: '报警时间',
  delivery_score: '交付能力评分', quality_score: '质量评分', category: '品类', unit: '单位', updated_at: '更新时间', created_at: '创建时间',
  quantity_kg: '确认需求量（千克）', count: '数量', utilization_pct: '容量占用率',
  match_run_id: '计算编号', run_id: '计算编号', rules_version: '规则版本', candidates: '候选方案', rejections: '不匹配原因',
  order_ids: '订单记录', order_nos: '订单编号', vehicle_id: '车辆编号', planned_departure_at: '计划发车时间',
  origin_spread_km: '始发地离散距离（千米）', destination_spread_km: '目的地离散距离（千米）',
  departure_span_minutes: '发车时间差（分钟）', capacity_utilization_pct: '车辆容量使用率', explanation: '规则解释',
  rules: '匹配规则', recommendation: '推荐方案', alternatives: '备选方案', weights: '评分权重',
  forecast: '预测结果', forecast_quantity: '预测量', lower_bound: '预测下界', upper_bound: '预测上界',
  method: '预测方法', mae: '平均绝对误差', smape: '对称平均绝对百分比误差', data_cutoff: '数据截止时间',
  unmatched: '未匹配订单', reason: '原因', enterprise_count: '企业数量', product_count: '品类数量',
  weight_utilization_pct: '载重使用率', volume_utilization_pct: '容积使用率', expected_quantity: '应交数量', delivery_lines: '交付明细',
  candidate_warehouses: '候选仓库', warehouse_id: '仓库编号', warehouse_name: '仓库名称', estimated_distance_km: '估算距离（千米）',
  available_volume_m3: '可用库容（立方米）', eligible: '是否符合规则', required_volume_m3: '所需库容（立方米）',
  required_quantity: '采购需求量', supplier_id: '供应商编号', supplier_name: '供应商名称', unit_price: '单价', total_amount: '总金额',
  price_score: '价格评分', composite_score: '综合评分', tier_min_quantity: '阶梯起订量', supply_capacity: '供货能力',
  price: '价格权重', delivery: '交付权重', quality: '质量权重', data_points: '历史数据点',
  production_plan_quantity: '生产计划数量', method_note: '方法说明',
  origin_max_km: '始发地最大距离（千米）', destination_max_km: '目的地最大距离（千米）', departure_window_minutes: '发车时间窗（分钟）',
  capacity_utilization_limit: '容量上限', distance_max_km: '最大距离（千米）',
};

const VALUE_LABELS = {
  TRADITIONAL: '传统门店', TRADITIONAL_STORE: '传统门店', THIRD_SPACE: '第三空间', CONFIRMED: '已确认', COMPLETED: '已完成',
  DRAFT: '草稿', MATCHED: '已匹配', PUBLISHED: '已发布', DRIVER_ACCEPTED: '司机已接单', PICKED_UP: '已取货', IN_TRANSIT: '运输中',
  DELIVERED: '已送达', STORE_SIGNED: '门店已签收', IN_PROGRESS: '进行中', CANCELLED: '已取消', OPEN: '待处理', RESOLVED: '已处理',
  ACTIVE: '有效', INACTIVE: '停用', AMBIENT: '常温', CHILLED: '冷藏', FROZEN: '冷冻',
  COMPLETE: '完整上报', INCOMPLETE: '部分上报', MISSING: '缺报', true: '是', false: '否',
  NO_DATA: '无历史数据', SEASONAL_EXPONENTIAL_SMOOTHING: '季节性指数平滑', WEIGHTED_MOVING_AVERAGE: '加权移动平均',
};

function displayField(key) {
  return FIELD_LABELS[key] || '扩展信息';
}

function displayCell(value, key = '') {
  if (value === true || value === false) return VALUE_LABELS[String(value)];
  if (typeof value === 'string' && VALUE_LABELS[value]) return VALUE_LABELS[value];
  if (Array.isArray(value) && ['order_ids', 'order_nos'].includes(key)) return `${value.length} 条订单`;
  if (Array.isArray(value) && key === 'stops') return `${value.length} 个配送站点`;
  if (value && typeof value === 'object' && ['origin', 'destination'].includes(key)) {
    return `纬度 ${formatNumber(value.latitude, 4)}，经度 ${formatNumber(value.longitude, 4)}`;
  }
  return formatValue(value);
}

function renderTable(target, items, emptyMessage = '暂无数据') {
  const el = document.getElementById(target);
  if (!el) return;
  if (!Array.isArray(items) || !items.length) {
    el.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  const keys = [...new Set(items.flatMap((item) => Object.keys(item)))];
  el.innerHTML = `<div class="table-scroll"><table><thead><tr>${keys.map((key) => `<th>${escapeHtml(displayField(key))}</th>`).join('')}</tr></thead><tbody>${items.map((item) => `<tr>${keys.map((key) => `<td>${escapeHtml(displayCell(item[key], key))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderStructuredResult(target, data) {
  const el = document.getElementById(target);
  if (!el) return;
  if (!data || typeof data !== 'object') {
    el.textContent = formatValue(data);
    return;
  }
  const hiddenMetadata = new Set(['trace_id', 'schema_version', 'generated_at']);
  const primitiveEntries = Object.entries(data).filter(([key, value]) => !hiddenMetadata.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  const listEntries = Object.entries(data).filter(([, value]) => Array.isArray(value));
  const objectEntries = Object.entries(data).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value));
  const cards = primitiveEntries.length
    ? `<div class="readable-result-cards">${primitiveEntries.map(([key, value]) => `<div><span>${escapeHtml(displayField(key))}</span><strong>${escapeHtml(displayCell(value, key))}</strong></div>`).join('')}</div>`
    : '';
  const objects = objectEntries.map(([key, value]) => {
    const entries = Object.entries(value).filter(([field]) => !hiddenMetadata.has(field));
    return `<section><h4>${escapeHtml(displayField(key))}</h4><div class="readable-result-cards">${entries.map(([field, item]) => `<div><span>${escapeHtml(displayField(field))}</span><strong>${escapeHtml(displayCell(item, field))}</strong></div>`).join('')}</div></section>`;
  }).join('');
  const lists = listEntries.map(([key, value]) => {
    if (!value.length) return `<section><h4>${escapeHtml(displayField(key))}</h4><p>暂无记录</p></section>`;
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const keys = [...new Set(value.slice(0, 20).flatMap((item) => Object.keys(item)))];
      return `<section><h4>${escapeHtml(displayField(key))}</h4><div class="table-scroll"><table><thead><tr>${keys.map((field) => `<th>${escapeHtml(displayField(field))}</th>`).join('')}</tr></thead><tbody>${value.slice(0, 20).map((item) => `<tr>${keys.map((field) => `<td>${escapeHtml(displayCell(item[field], field))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
    }
    return `<section><h4>${escapeHtml(displayField(key))}</h4><p>${value.map((item) => displayCell(item, key)).map(escapeHtml).join('、')}</p></section>`;
  }).join('');
  el.innerHTML = `${cards}${objects}${lists}<details><summary>查看原始数据（调试）</summary><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></details>`;
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

function formatShanghaiDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatValue(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
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
    const right = 72;
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
    const path = (points) => points.map((item, index) => (index ? 'L' : 'M') + ' ' + item.x.toFixed(1) + ' ' + item.y.toFixed(1)).join(' ');
    const currentPath = path(currentPoints);
    const grid = [0, 1, 2, 3, 4].map((index) => {
      const y = top + index * ((bottom - top) / 4);
      return '<line class="chart-grid-line" x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '" />';
    }).join('');
    const labels = currentPoints.map((item) => '<text class="chart-axis-label" x="' + item.x.toFixed(1) + '" y="166" text-anchor="middle">' + escapeHtml(item.label) + '</text>').join('');
    const yLabels = [0, .5, 1].map((ratio) => '<text class="trend-axis-label" x="4" y="' + (bottom - ratio * (bottom - top)).toFixed(1) + '">' + escapeHtml(formatter(max * ratio)) + '</text>').join('');
    const placeLabel = (point, labelWidth, labelHeight) => {
      const gap = 5;
      let xPosition = point.x > width - right - 38 ? point.x - labelWidth - gap : point.x + gap;
      let yPosition = point.y > top + labelHeight + gap ? point.y - labelHeight - gap : point.y + gap;
      xPosition = Math.max(left, Math.min(width - right - labelWidth, xPosition));
      if (yPosition + labelHeight > bottom) yPosition = point.y - labelHeight - gap;
      yPosition = Math.max(top, Math.min(bottom - labelHeight, yPosition));
      return { x: xPosition, y: yPosition };
    };
    const placeEndLabel = (point, labelWidth, labelHeight) => {
      const gap = 5;
      let xPosition = point.x + gap;
      if (xPosition + labelWidth > width - 4) xPosition = point.x - labelWidth - gap;
      let yPosition = point.y - labelHeight - gap;
      if (yPosition < top) yPosition = point.y + gap;
      yPosition = Math.max(top, Math.min(bottom - labelHeight, yPosition));
      return { x: xPosition, y: yPosition };
    };
    const renderNode = (item, seriesClass, seriesLabel, pointColor) => {
      const valueLabel = formatter(item.value);
      const label = item.label + '：' + valueLabel;
      const labelWidth = Math.min(82, Math.max(50, label.length * 4.1 + 10));
      const labelHeight = 15;
      const labelPosition = placeLabel(item, labelWidth, labelHeight);
      return '<g class="trend-chart-node ' + seriesClass + '" tabindex="0" role="img" aria-label="' + escapeHtml(seriesLabel + ' ' + label) + '"><circle class="trend-chart-hit" cx="' + item.x.toFixed(1) + '" cy="' + item.y.toFixed(1) + '" r="11"></circle><circle class="trend-chart-point ' + seriesClass + '" style="--point-color:' + pointColor + '" cx="' + item.x.toFixed(1) + '" cy="' + item.y.toFixed(1) + '" r="3.5"></circle><g class="trend-hover-label" transform="translate(' + labelPosition.x.toFixed(1) + ' ' + labelPosition.y.toFixed(1) + ')" aria-hidden="true"><rect width="' + labelWidth.toFixed(1) + '" height="' + labelHeight + '" rx="3"></rect><text x="' + (labelWidth / 2).toFixed(1) + '" y="10.5" text-anchor="middle">' + escapeHtml(label) + '</text></g><title>' + escapeHtml(seriesLabel + ' ' + label) + '</title></g>';
    };
    const dots = currentPoints.map((item) => renderNode(item, 'current', '本期', color)).join('');
    const area = currentPath + ' L ' + currentPoints.at(-1).x.toFixed(1) + ' ' + bottom + ' L ' + currentPoints[0].x.toFixed(1) + ' ' + bottom + ' Z';
    const end = currentPoints.at(-1);
    const endLabel = formatter(end.value);
    const badgePosition = placeEndLabel(end, 58, 18);
    const badge = '<g class="trend-end-label" pointer-events="none"><rect x="' + badgePosition.x.toFixed(1) + '" y="' + badgePosition.y.toFixed(1) + '" width="58" height="18" rx="4"/><text x="' + (badgePosition.x + 29).toFixed(1) + '" y="' + (badgePosition.y + 12).toFixed(1) + '" text-anchor="middle">' + escapeHtml(endLabel) + '</text></g>';
    return '<article class="trend-chart-card"><div class="trend-chart-card-head"><span class="trend-chart-card-icon">' + escapeHtml(icon) + '</span><div><small>' + escapeHtml(tag) + '</small><strong>' + escapeHtml(title) + '</strong></div><b>峰值 ' + escapeHtml(formatter(Math.max(...currentPoints.map((item) => item.value)))) + '</b></div><div class="trend-chart-card-legend"><i style="--trend-color:' + color + '"></i>本期' + escapeHtml(title) + '（' + escapeHtml(unit) + '）</div><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(title + '近七日趋势') + '"><defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity=".3"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' + grid + yLabels + '<path class="trend-chart-area" style="--trend-area:' + color + '" fill="url(#' + gradientId + ')" d="' + area + '"/><path class="trend-chart-line" style="--trend-color:' + color + '" d="' + currentPath + '"/>' + dots + badge + labels + '</svg></article>';
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
  el.innerHTML = displayRows.map((item) => '<a class="screen-policy-item" href="' + escapeHtml(item.source_url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(item.source_name || item.title) + '"><span>' + escapeHtml(item.category) + '</span><div><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.summary) + ' · ' + escapeHtml(item.source_verified ? '官方原文' : (item.source_type || 'OFFICIAL')) + '</small></div></a>').join('');
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
    else {
      const stage = document.getElementById('public');
      const target = stage && typeof stage.requestFullscreen === 'function' ? stage : document.documentElement;
      if (!document.fullscreenEnabled || typeof target.requestFullscreen !== 'function') throw new Error('当前浏览器不允许网页全屏');
      await target.requestFullscreen();
    }
  } catch (error) {
    const stateEl = document.getElementById('public-sync-state');
    if (stateEl) stateEl.textContent = `全屏切换失败：${error.message}`;
  }
}

function applyPublicTheme(theme) {
  const isDay = theme === 'day';
  document.body.classList.toggle('screen-day', isDay);
  const button = document.getElementById('public-theme-toggle');
  if (!button) return;
  button.textContent = isDay ? '夜间模式' : '日间模式';
  button.title = isDay ? '切换到夜间模式' : '切换到日间模式';
  button.setAttribute('aria-pressed', String(isDay));
}

function togglePublicTheme() {
  const theme = document.body.classList.contains('screen-day') ? 'night' : 'day';
  localStorage.setItem('publicTheme', theme);
  applyPublicTheme(theme);
}

function setupOverviewDetails() {
  const popover = document.getElementById('overview-detail-popover');
  const targetLabels = {
    enterprise: '主数据与企业',
    production: '运输订单与拼车计划',
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
    const role = { park_admin: '园区管理员', analyst: '数据分析员' }[user.role] || '已授权用户';
    stateEl.textContent = `${user.display_name || user.username} · ${role}`;
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else {
    stateEl.textContent = '未登录';
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
  document.getElementById('data-cutoff').textContent = formatShanghaiDateTime(cutoff);
  renderTable('overview-enterprise-details', data.details || [], '暂无企业明细');
  document.getElementById('overview-body').textContent = `E01 总览已同步：预计订单 ${formatValue(data.expected_order_quantity)}，已承担订单 ${formatValue(data.committed_order_quantity)}，销售额 ${formatValue(data.sales_amount_total)}；当前未处理库存预警 ${formatValue(data.inventory_alert_count)}。`;
  setMessage('E01 总览加载完成。', 'success');
}

function renderOperationalAlerts(resource, items, enterpriseNames = {}) {
  const el = document.getElementById('inventory-alerts');
  if (!el) return;
  const rows = Array.isArray(items) ? items : [];
  const enterpriseLabel = (item) => enterpriseNames[item.enterprise_id] || item.enterprise_name || item.enterprise_id || '未关联企业';
  const itemMarkup = (level, title, detail, action) => `<article class="operation-alert ${level}"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div><b>${escapeHtml(action)}</b></article>`;
  let heading = '运行提醒';
  let alerts = [];
  if (resource === 'warehouses') {
    heading = '仓库容量提醒';
    alerts = rows.filter((item) => Number(item.capacity_m3) > 0 && Number(item.used_m3) / Number(item.capacity_m3) >= 0.8).map((item) => {
      const occupancy = Number(item.used_m3) / Number(item.capacity_m3) * 100;
      return itemMarkup(occupancy >= 90 ? 'critical' : 'warning', item.name || item.code || '仓库', `容量占用 ${occupancy.toFixed(1)}% · ${displayCell(item.temperature_zone)}`, occupancy >= 90 ? '暂停入库并调度拼仓' : '关注剩余库容');
    });
  } else if (resource === 'inventories') {
    heading = '库存预警条目';
    alerts = rows.filter((item) => {
      const current = Number(item.current_qty);
      const safety = Number(item.safety_stock_qty);
      return String(item.inventory_alert_status || item.warning_status || '').toUpperCase() === 'WARNING' || (Number.isFinite(current) && Number.isFinite(safety) && current < safety);
    }).map((item) => {
      const current = Number(item.current_qty) || 0;
      const safety = Number(item.safety_stock_qty);
      const target = Number(item.target_stock_qty);
      const unit = item.unit || '件';
      const threshold = Number.isFinite(safety) ? safety : 0;
      const gap = Number.isFinite(target) ? Math.max(0, target - current) : Math.max(0, threshold - current);
      const level = threshold && current <= threshold * .5 ? 'critical' : 'warning';
      return itemMarkup(level, `${enterpriseLabel(item)} · ${item.product_name || item.product_id || '未命名物料'}`, `当前 ${formatNumber(current)} ${unit} · 预警阈值 ${Number.isFinite(safety) ? formatNumber(safety) + ' ' + unit : '待审批'} · 建议补 ${formatNumber(gap)} ${unit}`, level === 'critical' ? '立即补货' : '安排补货');
    });
  } else if (resource === 'sales-order-lines') {
    heading = '销售履约提醒';
    alerts = rows.filter((item) => !['SETTLED', 'COMPLETED', 'CLOSED'].includes(String(item.status || '').toUpperCase())).map((item) => {
      const status = String(item.status || '待确认').toUpperCase();
      const action = status === 'PROCESSING' ? '跟进出库' : '确认履约';
      return itemMarkup(status === 'PROCESSING' ? 'warning' : 'info', `${enterpriseLabel(item)} · ${item.product_name || item.product_id || '未命名商品'}`, `订单 ${item.sales_order_id || '—'} · 数量 ${formatNumber(item.quantity)} · 金额 ${formatMoney(item.order_amount)} · 状态 ${item.status || '待确认'}`, action);
    });
  } else if (resource === 'freezer-records') {
    heading = '冻库监控预警';
    alerts = rows.map((item) => {
      const used = Number(item.used_volume_m3) || 0;
      const total = Number(item.total_volume_m3) || 0;
      const occupancy = total ? used / total * 100 : 0;
      const temperature = Number(item.temperature_celsius);
      const reasons = [];
      if (occupancy >= 80) reasons.push(`容量占用 ${occupancy.toFixed(1)}%`);
      if (Number.isFinite(temperature) && temperature > -16) reasons.push(`温度 ${temperature.toFixed(1)}℃偏高`);
      if (!reasons.length) return null;
      return itemMarkup(occupancy >= 80 ? 'critical' : 'warning', `${enterpriseLabel(item)} · ${item.freezer_id || '冻库记录'}`, `${reasons.join('、')} · 冻品 ${formatNumber(item.frozen_goods_kg)} kg`, occupancy >= 80 ? '调整入库' : '检查温控');
    }).filter(Boolean);
  }
  const sourceNote = rows.length ? '依据服务器实时记录计算' : '当前资源没有可展示的记录';
  el.innerHTML = `<div class="operation-alert-heading"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(alerts.length)} 条 · ${escapeHtml(sourceNote)}</span></div>${alerts.length ? alerts.join('') : '<div class="operation-alert-empty">当前资源暂无需要处理的预警条目。</div>'}`;
}

async function loadResource(section) {
  const resource = state.resource[section];
  const resultTarget = `${section}-table`;
  setLoading(resultTarget);
  const page = state.resourcePage[section] || 1;
  const keyword = state.resourceSearch[section] || '';
  const result = await getAPI().list(resource, { page: String(page), page_size: '20', ...(keyword ? { keyword } : {}) });
  if (!result.ok) {
    requireAuth(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  const data = dataOf(result) || {};
  const visibleItems = getAPI().isMock() && keyword
    ? (data.items || []).filter((item) => JSON.stringify(item).toLowerCase().includes(keyword.toLowerCase()))
    : data.items || [];
  renderTable(resultTarget, visibleItems);
  const total = document.getElementById(`${section}-total`);
  const recordTotal = getAPI().isMock() && keyword ? visibleItems.length : Number(data.total || 0);
  if (total) total.textContent = `${recordTotal} 条记录`;
  const pageLabel = document.getElementById(`${section}-page`);
  if (pageLabel) pageLabel.textContent = `第 ${page} / ${Math.max(1, Math.ceil(recordTotal / Number(data.page_size || 20)))} 页`;
  document.getElementById(`${section}-prev`).disabled = page <= 1;
  document.getElementById(`${section}-next`).disabled = page * Number(data.page_size || 20) >= recordTotal;
  if (section === 'inventory') {
    const enterpriseResult = await getAPI().list('enterprises');
    const enterpriseItems = enterpriseResult.ok ? (dataOf(enterpriseResult) || {}).items || [] : [];
    const enterpriseNames = Object.fromEntries(enterpriseItems.map((item) => [item.enterprise_id, item.enterprise_name]));
    renderOperationalAlerts(resource, data.items || [], enterpriseNames);
  }
  if (section === 'transport') {
    const rows = data.items || [];
    const monitored = rows.filter((item) => item.latest_telemetry);
    const openAlerts = rows.filter((item) => item.status === 'OPEN');
    document.getElementById('transport-monitoring').textContent = resource === 'alerts'
      ? `服务器当前返回 ${openAlerts.length} 条待处理报警；报警时间、类型和对象版本均来自 B02 投影。`
      : monitored.length
        ? `当前有 ${monitored.length} 条运输任务带最新温湿度采样，异常路线在 E02 以红色显示。`
        : '当前任务投影暂无温湿度采样，页面不会生成模拟异常提示。';
  }
}

async function loadCalculation() {
  const kind = document.getElementById('calc-kind').value;
  const resultEl = document.getElementById('calculation-result');
  resultEl.textContent = '计算中…';
  const body = ['carpool-preview', 'warehouse-preview'].includes(kind)
    ? { scenario_code: document.getElementById('calc-scenario').value }
    : kind === 'procurement'
      ? { product_id: document.getElementById('calc-product').value, required_quantity: document.getElementById('calc-quantity').value }
      : { enterprise_id: document.getElementById('calc-enterprise').value, product_id: document.getElementById('calc-product').value };
  const result = await getAPI().calculate(kind, body);
  if (!result.ok) {
    requireAuth(result);
    resultEl.textContent = errorOf(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  const data = dataOf(result);
  renderStructuredResult('calculation-result', data);
  state.lastMatchRunId = kind === 'carpool-preview' ? data?.match_run_id : null;
  document.getElementById('confirm-carpool').hidden = !state.lastMatchRunId || !(data?.candidates || []).length;
  setMessage('计算已返回规则版本、候选方案及不匹配原因。', 'success');
}

async function confirmCarpool() {
  if (!state.lastMatchRunId) return;
  const result = await getAPI().confirmCarpool(state.lastMatchRunId, 1, 0);
  if (!result.ok) {
    document.getElementById('calculation-result').textContent = errorOf(result);
    return;
  }
  document.getElementById('confirm-carpool').hidden = true;
  renderStructuredResult('calculation-result', dataOf(result));
  setMessage('首选拼车方案已确认，服务器正在创建执行任务。', 'success');
}

function updateCalculationFields() {
  const kind = document.getElementById('calc-kind').value;
  document.getElementById('scenario-fields').hidden = !['carpool-preview', 'warehouse-preview'].includes(kind);
  document.getElementById('enterprise-fields').hidden = kind !== 'forecast';
  document.getElementById('product-fields').hidden = !['procurement', 'forecast'].includes(kind);
  document.getElementById('quantity-fields').hidden = kind !== 'procurement';
  document.getElementById('confirm-carpool').hidden = true;
  state.lastMatchRunId = null;
}

async function loadCalculationOptions() {
  const [enterprises, products] = await Promise.all([
    getAPI().list('enterprises', { page_size: '100' }),
    getAPI().list('products', { page_size: '100' }),
  ]);
  const enterpriseRows = dataOf(enterprises)?.items || [];
  const productRows = dataOf(products)?.items || [];
  document.getElementById('calc-enterprise').innerHTML = enterpriseRows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
  document.getElementById('calc-product').innerHTML = productRows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}（${escapeHtml(row.unit)}）</option>`).join('');
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
  renderStructuredResult('import-result', data);
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
  renderStructuredResult('import-result', dataOf(result));
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
      state.resourcePage[section] = 1;
      await loadResource(section);
    });
    document.getElementById(`${section}-refresh`).addEventListener('click', () => loadResource(section));
    const search = document.getElementById(`${section}-search`);
    search.addEventListener('input', () => {
      state.resourceSearch[section] = search.value.trim();
      state.resourcePage[section] = 1;
    });
    search.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadResource(section); });
    document.getElementById(`${section}-prev`).addEventListener('click', () => {
      state.resourcePage[section] = Math.max(1, state.resourcePage[section] - 1);
      loadResource(section);
    });
    document.getElementById(`${section}-next`).addEventListener('click', () => {
      state.resourcePage[section] += 1;
      loadResource(section);
    });
  });
}

function showSection(section) {
  state.activeSection = section;
  const isPublic = section === 'public';
  document.body.classList.toggle('screen-mode', isPublic);
  document.querySelectorAll('.page-section').forEach((item) => item.classList.toggle('active', item.id === section));
  document.querySelectorAll('.sidebar button[data-section]').forEach((item) => item.classList.toggle('active', item.dataset.section === section));
  const titles = { overview: 'E01 管理总览', enterprise: '主数据与企业', production: '运输订单与拼车计划', inventory: '库存、销售与冻库', transport: '运输任务与资源', import: 'B01 批量导入', analytics: 'B01 计算与建议', public: 'E02 公开大屏' };
  document.getElementById('page-title').textContent = titles[section] || '黑土闭环';
  if (section === 'overview') loadOverview();
  if (RESOURCE_GROUPS[section]) loadResource(section);
  if (isPublic) {
    updatePublicClock();
    requestAnimationFrame(applyPublicScreenScale);
    window.DashboardV2?.activate();
  } else {
    window.scrollTo({ top: 0, left: 0 });
  }
  window.dispatchEvent(new CustomEvent('app:section-change', { detail: { section } }));
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
  await loadCalculationOptions();
  setMessage('E01 登录成功。', 'success');
  showSection(state.activeSection);
}

async function handleLogout() {
  await getAPI().logout();
  renderAuthState(null);
  document.getElementById('auth-panel').hidden = false;
  setMessage('已退出 E01 会话；E02 公开大屏仍可访问。', 'info');
}

async function initPage() {
  document.querySelectorAll('.sidebar button[data-section]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
  document.getElementById('open-login').addEventListener('click', () => { document.getElementById('auth-panel').hidden = false; });
  document.getElementById('close-login').addEventListener('click', () => { document.getElementById('auth-panel').hidden = true; });
  document.getElementById('logout-button').addEventListener('click', handleLogout);
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('calc-kind').addEventListener('change', updateCalculationFields);
  document.getElementById('run-calculation').addEventListener('click', loadCalculation);
  document.getElementById('confirm-carpool').addEventListener('click', confirmCarpool);
  document.getElementById('public-refresh')?.addEventListener('click', () => window.DashboardV2?.refresh());
  document.getElementById('public-fullscreen')?.addEventListener('click', togglePublicFullscreen);
  document.getElementById('public-theme-toggle')?.addEventListener('click', togglePublicTheme);
  document.getElementById('public-exit')?.addEventListener('click', exitPublicScreen);
  document.getElementById('public-enterprise-toggle')?.addEventListener('click', () => {
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
    const button = document.getElementById('public-fullscreen');
    if (button) {
      button.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
      button.title = document.fullscreenElement ? '退出浏览器全屏' : '进入浏览器全屏';
    }
    applyPublicScreenScale();
  });
  updatePublicClock();
  window.setInterval(updatePublicClock, 1000);
  setupResourceSelects();
  setupOverviewDetails();
  getAPI().onAuthChange(({ user, reason }) => {
    renderAuthState(user);
    if (!user && reason === 'idle_timeout') {
      document.getElementById('auth-panel').hidden = false;
      setMessage('会话因 30 分钟无操作已自动退出，请重新登录。', 'warning');
    }
  });
  ['pointerdown', 'keydown'].forEach((eventName) => document.addEventListener(eventName, getAPI().touchActivity, { passive: true }));
  const me = await getAPI().getCurrentUser();
  const user = me.ok ? dataOf(me) : null;
  renderAuthState(user);
  document.getElementById('auth-panel').hidden = Boolean(user);
  if (user) await loadCalculationOptions();
  updateCalculationFields();
  showSection('overview');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
else initPage();
