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
    { value: 'receipts', label: '签收结果' },
    { value: 'inventory-movements', label: '库存流水' },
    { value: 'stockout-demands', label: '缺货需求' },
    { value: 'store-daily-reports', label: '第三空间经营日报' },
    { value: 'warehouses', label: '仓库与温区' },
    { value: 'products', label: '商品库存维度' },
  ],
  transport: [
    { value: 'transport-tasks', label: '运输任务实时投影' },
    { value: 'transport-plans', label: '拼车计划' },
    { value: 'alerts', label: '温湿度与运输报警' },
    { value: 'telemetry-issues', label: '遥测异常与状态不一致' },
    { value: 'vehicles', label: '车辆与司机资源' },
  ],
};

const RESOURCE_TABLE_SCHEMAS = Object.freeze({
  enterprises: ['enterprise_name', 'industry', 'status', 'updated_at', 'source_updated_at'],
  stores: ['store_name', 'channel', 'city', 'status', 'updated_at', 'source_updated_at'],
  products: ['product_name', 'category', 'unit', 'status', 'updated_at', 'source_updated_at'],
  suppliers: ['supplier_name', 'category', 'delivery_score', 'quality_score', 'status', 'updated_at'],
  'transport-orders': ['order_no', 'enterprise_name', 'product_name', 'quantity', 'unit', 'status', 'planned_departure_at', 'updated_at'],
  'transport-plans': ['plan_no', 'status', 'order_count', 'enterprise_count', 'capacity_utilization_pct', 'planned_departure_at', 'updated_at'],
  receipts: ['receipt_no', 'store_name', 'receipt_status_label', 'expected_total', 'received_total', 'difference_total', 'business_at'],
  'inventory-movements': ['product_name', 'movement_type_label', 'quantity_before', 'quantity_delta', 'quantity_after', 'business_at'],
  'stockout-demands': ['store_name', 'product_name', 'requested_quantity', 'unit', 'status_label', 'business_at'],
  'store-daily-reports': ['store_name', 'report_date', 'order_count', 'sales_amount', 'status_label', 'updated_at'],
  warehouses: ['warehouse_name', 'temperature_zone', 'available_volume_m3', 'status', 'updated_at'],
  'transport-tasks': ['task_no', 'vehicle_label', 'status_label', 'next_stop_name', 'recorded_at', 'updated_at'],
  alerts: ['alert_type_label', 'message', 'status_label', 'opened_at', 'updated_at'],
  'telemetry-issues': ['status_label', 'message', 'business_at', 'updated_at'],
  vehicles: ['license_plate', 'vehicle_type', 'mass_capacity_kg', 'volume_capacity_m3', 'status', 'updated_at'],
});

const RESOURCE_PRIMARY_ID_FIELDS = Object.freeze({
  enterprises: 'enterprise_id', stores: 'store_id', products: 'product_id', suppliers: 'supplier_id',
  'transport-orders': 'order_id', 'transport-plans': 'plan_id', receipts: 'receipt_id',
  'inventory-movements': 'movement_id', 'stockout-demands': 'stockout_id',
  'store-daily-reports': 'report_id', warehouses: 'warehouse_id', 'transport-tasks': 'task_id',
  alerts: 'alert_id', 'telemetry-issues': 'issue_id', vehicles: 'vehicle_id',
});

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
  lastWarehouseRunId: null,
  lastWarehouseCandidate: null,
  warehousePlan: null,
  procurementAggregation: null,
  forecastBatch: null,
  calculationContext: null,
  resourceRows: { enterprise: [], production: [], inventory: [], transport: [] },
  resourceDetail: null,
};

function newIdempotencyKey(prefix) {
  const suffix = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

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
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') return `${Object.keys(value).length} 项结构化信息`;
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
  source_receipt_id: '来源签收单', receipt_status: '签收状态', receipt_status_label: '签收状态',
  expected_total: '应收数量', received_total: '实收数量', difference_total: '差异数量', rejected_line_count: '拒收明细数',
  source_movement_id: '来源库存流水', movement_type: '流水类型', movement_type_label: '流水类型',
  quantity_before: '变更前数量', quantity_delta: '变更数量', quantity_after: '变更后数量',
  source_stockout_id: '来源缺货需求', requested_quantity: '缺货需求量', status_label: '状态', business_at: '业务发生时间',
  source_report_id: '来源经营日报', report_date: '日报日期', order_count: '经营订单数',
  authorized_for_dashboard: '经营数据展示授权', product_unit: '商品单位', store_channel: '门店类型',
  enterprise_id: '企业编号', enterprise_name: '企业名称', enterprise_display_name: '企业名称', industry: '所属行业', contact_name: '联系人/负责组', park_id: '所属园区',
  store_id: '门店编号', store_name: '门店名称', city: '城市', channel_type: '渠道类型', reporting_authorized: '日报上报授权',
  partner_id: '合作方编号', partner_name: '合作方名称', preorder_id: '预订单编号', order_id: '订单编号', product_id: '产品编号',
  product_name: '产品名称', category: '品类', quantity: '数量', unit: '单位', amount: '金额', sales_amount: '营业额',
  status: '状态', required_at: '需求日期', created_at: '创建时间', updated_at: '更新时间', source_system: '数据来源',
  source_record_id: '来源记录编号', plan_date: '计划日期', daily_capacity: '日产能', planned_quantity: '计划数量',
  completed_quantity: '已完成数量', warning_threshold: '预警阈值', inventory_quantity: '库存数量', freezer_capacity: '冻库容量',
  task_id: '任务编号', origin: '起点', destination: '终点', driver_name: '司机', license_plate: '车牌号',
  id: '记录编号', code: '业务编码', name: '名称', enabled: '是否启用', object_version: '数据版本', display_name: '显示名称',
  channel: '渠道', latitude: '纬度', longitude: '经度', temperature_zone: '温区', plate_no: '车牌号', driver_id: '司机编号',
  max_weight_kg: '最大载重（公斤）', max_volume_m3: '最大容积（立方米）', capacity_m3: '总库容（立方米）', used_m3: '已用库容（立方米）',
  plan_no: '计划编号', task_no: '任务编号', store_id: '门店编号', product_id: '商品编号', order_no: '订单编号', scenario_code: '演示场景',
  departure_at: '计划发车时间', weight_kg: '重量（公斤）', volume_m3: '体积（立方米）', task_id: '执行任务编号',
  source_order_ids: '来源订单', total_weight_kg: '总重量（公斤）', total_volume_m3: '总体积（立方米）', stops: '配送站点',
  latest_telemetry: '最新温湿度', latest_location: '最新位置', route_label: '路线性质', alert_type: '报警类型', message: '报警说明', opened_at: '报警时间',
  source_issue_id: '来源问题记录', issue_type: '问题类型', issue_type_label: '问题类型', source_type: '上报来源',
  severity: '严重程度', task_status: '任务状态', expected_vehicle_id: '任务车辆', actual_vehicle_id: '上报车辆',
  expected_driver_id: '任务司机', actual_driver_id: '上报司机', status_label: '处理状态', business_at: '业务发生时间',
  delivery_score: '交付能力评分', quality_score: '质量评分', category: '品类', unit: '单位', updated_at: '更新时间', created_at: '创建时间',
  quantity_kg: '确认需求量（公斤）', count: '数量', utilization_pct: '容量占用率',
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
  method_label: '预测方法', algorithm_type: '算法类型', algorithm_type_label: '算法类型', role_label: '用户角色',
  origin_max_km: '始发地最大距离（千米）', destination_max_km: '目的地最大距离（千米）', departure_window_minutes: '发车时间窗（分钟）',
  capacity_utilization_limit: '容量上限', distance_max_km: '最大距离（千米）',
  pairwise_checks: '候选组两两距离校验', route_points: '确定性估算路线点',
  merged_route_estimated_km: '合并路线估算里程（千米）', independent_route_estimated_km: '独立运输估算里程（千米）',
  detour_estimated_km: '估算绕行距离（千米）', mileage_benefit_estimated_km: '估算合单里程收益（千米）',
};

const VALUE_LABELS = {
  TRADITIONAL: '传统门店', TRADITIONAL_STORE: '传统门店', THIRD_SPACE: '第三空间', CONFIRMED: '已确认', COMPLETED: '已完成',
  DRAFT: '草稿', MATCHED: '已匹配', PUBLISHED: '已发布', DRIVER_ACCEPTED: '司机已接单', PICKED_UP: '已取货', IN_TRANSIT: '运输中',
  DELIVERED: '已送达', STORE_SIGNED: '门店已签收', IN_PROGRESS: '进行中', CANCELLED: '已取消', OPEN: '待处理', RESOLVED: '已处理',
  ACTIVE: '有效', INACTIVE: '停用', AMBIENT: '常温', CHILLED: '冷藏', FROZEN: '冷冻',
  COMPLETE: '完整上报', INCOMPLETE: '部分上报', MISSING: '缺报', true: '是', false: '否',
  NO_DATA: '无历史数据', SEASONAL_EXPONENTIAL_SMOOTHING: '季节性指数平滑', WEIGHTED_MOVING_AVERAGE: '加权移动平均',
};

const UNIT_LABELS = {
  kg: '公斤', kilogram: '公斤', kilograms: '公斤',
  m3: '立方米', cubic_meter: '立方米',
  celsius: '摄氏度', pct: '百分比', percent: '百分比',
  cny: '人民币', rmb: '人民币', item: '件', items: '件', box: '箱',
};

function applyServerDictionaries(dictionaries) {
  if (!dictionaries || typeof dictionaries !== 'object') return;
  Object.values(dictionaries).forEach((mapping) => {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return;
    Object.assign(VALUE_LABELS, mapping);
  });
}

async function loadServerDictionaries() {
  if (typeof getAPI().getDictionaries !== 'function') return;
  try {
    const result = await getAPI().getDictionaries();
    if (result.ok) applyServerDictionaries(dataOf(result));
  } catch {
    // 网络不可用时继续使用内置中文词典。
  }
}

function displayField(key) {
  return FIELD_LABELS[key] || `未识别字段（${key}）`;
}

function displayCell(value, key = '') {
  if (value === true || value === false) return VALUE_LABELS[String(value)];
  if (typeof value === 'string' && VALUE_LABELS[value]) return VALUE_LABELS[value];
  if (typeof value === 'string' && UNIT_LABELS[value.toLowerCase()]) return UNIT_LABELS[value.toLowerCase()];
  if (typeof value === 'string' && /^[A-Z][A-Z0-9_+.-]*$/.test(value)) return `未知类型（${value}）`;
  if (Array.isArray(value) && ['order_ids', 'order_nos', 'source_order_ids'].includes(key)) return `${value.length} 条订单`;
  if (Array.isArray(value) && key === 'stops') return `${value.length} 个配送站点`;
  if (Array.isArray(value)) {
    if (!value.length) return '暂无记录';
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      const visible = value.slice(0, 8).map((item) => displayCell(item, key)).join('、');
      return value.length > 8 ? `${visible}等 ${value.length} 项` : visible;
    }
    return `${value.length} 项结构化记录`;
  }
  if (value && typeof value === 'object' && ['origin', 'destination'].includes(key)) {
    return `纬度 ${formatNumber(value.latitude, 4)}，经度 ${formatNumber(value.longitude, 4)}`;
  }
  if (value && typeof value === 'object' && key === 'latest_location') {
    return `纬度 ${formatNumber(value.latitude, 4)}，经度 ${formatNumber(value.longitude, 4)}；速度 ${formatNumber(value.speed_mps, 1)} 米/秒；精度 ${formatNumber(value.accuracy_m, 1)} 米；采样 ${formatDateTime(value.sampled_at)}`;
  }
  if (value && typeof value === 'object' && key === 'latest_telemetry') {
    return `温度 ${formatNumber(value.temperature_c, 1)} ℃；湿度 ${formatNumber(value.humidity_pct, 1)}%；采样 ${formatDateTime(value.sampled_at)}`;
  }
  if (value && typeof value === 'object' && /window$/.test(key)) {
    return `${formatDateTime(value.start)} 至 ${formatDateTime(value.end)}`;
  }
  if (value && typeof value === 'object' && key === 'weights') {
    return `价格 ${formatNumber(Number(value.price) * 100, 0)}%，交付 ${formatNumber(Number(value.delivery) * 100, 0)}%，质量 ${formatNumber(Number(value.quality) * 100, 0)}%`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
    if (!entries.length) return `${Object.keys(value).length} 项结构化信息`;
    return entries.slice(0, 4).map(([field, item]) => `${displayField(field)}：${displayCell(item, field)}`).join('；');
  }
  const number = Number(value);
  if (value !== '' && Number.isFinite(number)) {
    if (/(^|_)(sales_amount|total_amount|unit_price|amount|order_amount)$/.test(key)) return formatMoney(number);
    if (/_kg$/.test(key)) return `${formatNumber(number, 2)} 公斤`;
    if (/_m3$/.test(key)) return `${formatNumber(number, 2)} 立方米`;
    if (key === 'temperature_c') return `${formatNumber(number, 1)} ℃`;
    if (key === 'humidity_pct' || /_pct$/.test(key) || key === 'smape') return `${formatNumber(number, 2)}%`;
    if (/_km$/.test(key)) return `${formatNumber(number, 2)} 千米`;
    if (/_minutes$/.test(key)) return `${formatNumber(number, 0)} 分钟`;
    if (key === 'speed_mps') return `${formatNumber(number, 1)} 米/秒`;
    if (key === 'accuracy_m') return `${formatNumber(number, 1)} 米`;
  }
  return formatValue(value);
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(parsed);
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

function isTechnicalField(key) {
  return key === 'id' || key.endsWith('_id') || key === 'object_version' || key.endsWith('_versions')
    || ['trace_id', 'rules_version', 'input_snapshot', 'output_snapshot', 'raw_json'].includes(key);
}

function resourceColumns(resource, items) {
  const declared = RESOURCE_TABLE_SCHEMAS[resource] || [];
  const available = new Set(items.flatMap((item) => Object.keys(item || {})));
  const selected = declared.filter((key) => available.has(key));
  if (selected.length) return selected;
  return [...available].filter((key) => !isTechnicalField(key) && !['source_system', 'source_record_id', 'remark'].includes(key)).slice(0, 6);
}

function todayOrdinal(page, pageSize, rowIndex) {
  return String((Math.max(1, Number(page) || 1) - 1) * Math.max(1, Number(pageSize) || 20) + rowIndex + 1).padStart(2, '0');
}

function renderResourceTable(target, items, { resource, section, page, pageSize } = {}) {
  const el = document.getElementById(target);
  if (!el) return;
  if (!Array.isArray(items) || !items.length) {
    el.innerHTML = '<div class="empty-state">暂无数据</div>';
    return;
  }
  const keys = resourceColumns(resource, items);
  el.innerHTML = `<div class="table-scroll"><table class="resource-table"><thead><tr><th>今日序号</th>${keys.map((key) => `<th>${escapeHtml(displayField(key))}</th>`).join('')}<th>更多详细信息</th></tr></thead><tbody>${items.map((item, rowIndex) => `<tr><td><b class="daily-ordinal">${todayOrdinal(page, pageSize, rowIndex)}</b></td>${keys.map((key) => `<td>${escapeHtml(displayCell(item[key], key))}</td>`).join('')}<td><button type="button" class="resource-detail-button" data-row-index="${rowIndex}">查看详情</button></td></tr>`).join('')}</tbody></table></div>`;
  el.querySelectorAll('.resource-detail-button').forEach((button) => button.addEventListener('click', () => openResourceDetail(section, Number(button.dataset.rowIndex))));
}

function closeResourceDetail() {
  state.resourceDetail = null;
  const dialog = document.getElementById('e01-resource-dialog');
  if (dialog?.open) dialog.close();
  const content = document.getElementById('e01-resource-dialog-content');
  if (content) content.textContent = '';
}

function openResourceDetail(section, rowIndex) {
  const row = state.resourceRows[section]?.[rowIndex];
  const resource = state.resource[section];
  if (!row || !getAPI().getSession?.()?.user) return;
  state.resourceDetail = { section, rowIndex };
  const title = RESOURCE_GROUPS[section]?.find((item) => item.value === resource)?.label || '业务记录';
  document.getElementById('e01-resource-dialog-title').textContent = `${title} · 今日序号 ${todayOrdinal(state.resourcePage[section], 20, rowIndex)}`;
  const visibleEntries = Object.entries(row).filter(([key, value]) => !isTechnicalField(key) && !['source_record_id', 'source_system'].includes(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  const primaryIdKey = RESOURCE_PRIMARY_ID_FIELDS[resource] || Object.keys(row).find((key) => key === 'id' || key.endsWith('_id'));
  const primaryId = primaryIdKey ? row[primaryIdKey] : null;
  document.getElementById('e01-resource-dialog-content').innerHTML = `<section><h4>业务信息</h4><dl>${visibleEntries.map(([key, value]) => `<div><dt>${escapeHtml(displayField(key))}</dt><dd>${escapeHtml(displayCell(value, key))}</dd></div>`).join('')}</dl></section><details${primaryId ? '' : ' hidden'}><summary>技术追溯信息</summary><dl><div><dt>原始记录编号</dt><dd>${escapeHtml(primaryId)}</dd></div></dl><p>原始编号仅用于登录态问题追溯；今日序号不会进入业务请求。</p></details>`;
  document.getElementById('e01-resource-dialog').showModal();
}

function renderStructuredResult(target, data) {
  const el = document.getElementById(target);
  if (!el) return;
  if (!data || typeof data !== 'object') {
    el.textContent = formatValue(data);
    return;
  }
  const hiddenMetadata = new Set([
    'trace_id', 'schema_version', 'generated_at', 'id', 'object_version', 'rules_version',
    'run_id', 'match_run_id', 'algorithm_run_id', 'plan_id', 'task_id', 'order_id',
    'warehouse_id', 'vehicle_id', 'driver_id', 'product_id', 'enterprise_id', 'supplier_id',
    'input_snapshot', 'output_snapshot', 'scenario_code', 'confirmed_by',
  ]);
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
      const keys = [...new Set(value.slice(0, 20).flatMap((item) => Object.keys(item)))].filter((field) => !hiddenMetadata.has(field) && !isTechnicalField(field));
      return `<section><h4>${escapeHtml(displayField(key))}</h4><div class="table-scroll"><table><thead><tr>${keys.map((field) => `<th>${escapeHtml(displayField(field))}</th>`).join('')}</tr></thead><tbody>${value.slice(0, 20).map((item) => `<tr>${keys.map((field) => `<td>${escapeHtml(displayCell(item[field], field))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
    }
    return `<section><h4>${escapeHtml(displayField(key))}</h4><p>${value.map((item) => displayCell(item, key)).map(escapeHtml).join('、')}</p></section>`;
  }).join('');
  el.innerHTML = `${cards}${objects}${lists}`;
}

function renderAlgorithmPresentation(presentation) {
  const target = document.getElementById('calculation-result');
  if (!presentation || typeof presentation !== 'object') {
    target.textContent = '本次计算没有可展示的业务结论。';
    return;
  }
  const input = presentation.input_summary || {};
  const chips = [
    input.enterprise_count ? `${input.enterprise_count} 家企业` : null,
    input.order_count ? `${input.order_count} 单` : null,
    input.product_count ? `${input.product_count} 个商品` : null,
    ...(input.temperature_zones || []),
  ].filter(Boolean);
  const allocations = presentation.allocations || [];
  target.innerHTML = `<section class="algorithm-presentation"><header><div><small>${escapeHtml(presentation.status_label)}</small><h4>${escapeHtml(presentation.title)}</h4></div><strong>${escapeHtml(presentation.headline)}</strong></header><div class="algorithm-input-chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div><div class="algorithm-allocation-cards">${allocations.map((item, index) => {
    const isCarpool = Boolean(item.vehicle_label);
    const title = isCarpool ? `${item.vehicle_label} → ${(item.store_names || []).join('、') || '门店待补充'}` : `${item.warehouse_name || '名称待补充'} · ${item.recommendation_label || ''}`;
    const metrics = isCarpool
      ? `${item.order_count} 单 / ${item.enterprise_count} 企业 · 综合利用率 ${formatNumber(item.capacity_utilization_pct, 1)}% · 估算节省 ${formatNumber(item.mileage_benefit_estimated_km, 1)} 千米`
      : `${item.order_count} 单 / ${item.enterprise_count} 企业 · 需要 ${formatNumber(item.required_volume_m3, 1)} 立方米 · 剩余 ${formatNumber(item.remaining_volume_m3, 1)} 立方米`;
    const detail = isCarpool ? `${item.temperature_zone_label} · ${item.recommendation_label} · ${item.explanation}` : `${item.temperature_zone_label} · ${formatNumber(item.estimated_distance_km, 1)} 千米 · ${(item.reasons || []).join('；')}`;
    return `<button type="button" class="algorithm-allocation-card${index === Number(state.calculationContext?.candidateIndex || 0) ? ' selected' : ''}"><b>${escapeHtml(title)}</b><span>${escapeHtml(metrics)}</span><small>${escapeHtml(detail)}</small></button>`;
  }).join('') || '<div class="empty-state">等待生成分配方案</div>'}</div>${(presentation.unmatched_reasons || []).length ? `<div class="algorithm-unmatched"><b>待调整原因</b>${presentation.unmatched_reasons.map((item) => `<span>${escapeHtml(item.reason)} · ${item.count} 项</span>`).join('')}</div>` : ''}</section>`;
  [...target.querySelectorAll('.algorithm-allocation-card')].forEach((button, index) => button.addEventListener('click', () => {
    if (!state.calculationContext) return;
    state.calculationContext.candidateIndex = index;
    [...target.querySelectorAll('.algorithm-allocation-card')].forEach((item, itemIndex) => item.classList.toggle('selected', itemIndex === index));
  }));
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
  el.innerHTML = chart(orderItems, 'quantity', '订单量趋势', 'ORDER VOLUME', '公斤', '#35b9ff', 'orderTrendArea', formatNumber, '▥') + chart(salesItems, 'amount', '销售额趋势', 'SALES AMOUNT', '人民币', '#f3bd57', 'salesTrendArea', formatMoney, '◒');
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
  const renderRows = (duplicate = false) => rows.map((item) => '<button class="enterprise-order-row" type="button" data-enterprise="' + escapeHtml(item.enterprise_label) + '" title="点击查看 ' + escapeHtml(item.enterprise_label) + ' 订单明细"' + (duplicate ? ' tabindex="-1" aria-hidden="true"' : '') + '><span><strong>' + escapeHtml(item.enterprise_label) + '</strong><small>' + escapeHtml(item.category) + '</small></span><b>' + formatNumber(item.committed_order_quantity) + ' 公斤</b><i><em style="width:' + Math.max(4, Math.min(100, Number(item.completion_percent) || 0)) + '%"></em></i><mark class="' + (item.status === '库存预警' || item.status === '产能紧张' ? 'warn' : '') + '">' + escapeHtml(item.status) + '</mark></button>').join('');
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
  el.innerHTML = `<div class="donut-visual" style="background:conic-gradient(${segments.join(',')})"><div class="donut-center"><strong>${escapeHtml(formatNumber(total))}</strong><span>订单总量 公斤</span></div></div><div class="donut-legend">${legend}</div>`;
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

function normalizePublicTheme(theme) {
  return theme === 'day' ? 'day' : 'night';
}

function readStoredPublicTheme() {
  try {
    return normalizePublicTheme(localStorage.getItem('publicTheme'));
  } catch {
    return 'night';
  }
}

function storePublicTheme(theme) {
  try {
    localStorage.setItem('publicTheme', normalizePublicTheme(theme));
  } catch {
    // Storage can be blocked; the selected theme still applies to this page.
  }
}

function applyPublicTheme(theme) {
  const normalizedTheme = normalizePublicTheme(theme);
  const isDay = normalizedTheme === 'day';
  document.body.classList.toggle('screen-day', isDay);
  const logo = document.getElementById('dv2-brand-logo');
  const logoSource = isDay ? logo?.dataset.daySrc : logo?.dataset.nightSrc;
  if (logo && logoSource && logo.getAttribute('src') !== logoSource) logo.setAttribute('src', logoSource);
  const button = document.getElementById('public-theme-toggle');
  if (button) {
    button.textContent = isDay ? '夜间模式' : '日间模式';
    button.title = isDay ? '切换到夜间模式' : '切换到日间模式';
    button.setAttribute('aria-pressed', String(isDay));
  }
  window.dispatchEvent(new CustomEvent('app:public-theme-change', { detail: { theme: normalizedTheme } }));
  return normalizedTheme;
}

function togglePublicTheme() {
  const theme = document.body.classList.contains('screen-day') ? 'night' : 'day';
  storePublicTheme(theme);
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
  const datasetBadge = document.getElementById('e01-dataset-badge');
  const dataInfoButton = document.getElementById('e01-data-info');
  const resetButton = document.getElementById('reset-demo-case');
  if (user) {
    const role = user.role_label || VALUE_LABELS[user.role] || `未知类型（${user.role || '空值'}）`;
    stateEl.textContent = `${user.display_name || user.username} · ${role}`;
    loginButton.hidden = true;
    logoutButton.hidden = false;
    const showcase = user.dataset_mode === 'showcase';
    datasetBadge.hidden = !showcase;
    dataInfoButton.hidden = !showcase;
    if (showcase) {
      const refreshed = user.case_refreshed_at ? new Date(user.case_refreshed_at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
      datasetBadge.textContent = `固定演示案例 · 更新至 ${refreshed}`;
    }
    resetButton.hidden = !(showcase && user.role === 'park_admin');
  } else {
    stateEl.textContent = '未登录';
    loginButton.hidden = false;
    logoutButton.hidden = true;
    datasetBadge.hidden = true;
    dataInfoButton.hidden = true;
    resetButton.hidden = true;
  }
}

async function handleDemoCaseReset() {
  const user = getAPI().getSession().user;
  if (!user || user.dataset_mode !== 'showcase' || user.role !== 'park_admin') return;
  if (!window.confirm('恢复后，固定案例将回到今日标准状态，当前演示会话会退出。是否继续？')) return;
  const button = document.getElementById('reset-demo-case');
  button.disabled = true;
  const result = await getAPI().resetDemoCase(user.case_revision, newIdempotencyKey('showcase-reset'));
  button.disabled = false;
  if (!result.ok) {
    setMessage(errorOf(result), 'error');
    return;
  }
  closeResourceDetail();
  Object.keys(state.resourceRows).forEach((section) => { state.resourceRows[section] = []; });
  updateCalculationFields();
  renderAuthState(null);
  document.getElementById('auth-panel').hidden = false;
  setMessage('固定案例正在恢复。完成后请重新登录。', 'success');
}

function requireAuth(result) {
  if (result && result.status === 401 && !getAPI().isMock()) {
    closeResourceDetail();
    Object.keys(state.resourceRows).forEach((section) => { state.resourceRows[section] = []; });
    updateCalculationFields();
    document.getElementById('auth-panel').hidden = false;
    setMessage('E01 园区管理台接口需要登录，请先输入后端账号。', 'warning');
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
  document.getElementById('overview-body').textContent = `E01 园区管理台总览已同步：预计订单 ${formatValue(data.expected_order_quantity)}，已承担订单 ${formatValue(data.committed_order_quantity)}，销售额 ${formatMoney(data.sales_amount_total)}；当前未处理库存预警 ${formatValue(data.inventory_alert_count)}。`;
  setMessage('E01 园区管理台总览加载完成。', 'success');
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
      return itemMarkup(occupancy >= 80 ? 'critical' : 'warning', `${enterpriseLabel(item)} · ${item.freezer_id || '冻库记录'}`, `${reasons.join('、')} · 冻品 ${formatNumber(item.frozen_goods_kg)} 公斤`, occupancy >= 80 ? '调整入库' : '检查温控');
    }).filter(Boolean);
  }
  const sourceNote = rows.length ? '依据服务器实时记录计算' : '当前资源没有可展示的记录';
  el.innerHTML = `<div class="operation-alert-heading"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(alerts.length)} 条 · ${escapeHtml(sourceNote)}</span></div>${alerts.length ? alerts.join('') : '<div class="operation-alert-empty">当前资源暂无需要处理的预警条目。</div>'}`;
}

function operationChart(target) {
  const element = document.getElementById(target);
  if (!element || !window.echarts) return null;
  return window.echarts.getInstanceByDom(element) || window.echarts.init(element, null, { renderer: 'canvas' });
}

function operationTime(value) {
  if (!value) return '暂无业务数据';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium', hour12: false,
  }).format(parsed);
}

function setOperationState(kind, message, error = false) {
  const element = document.getElementById(`operations-${kind}-state`);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', error);
}

function setOperationMeta(kind, period, unit) {
  const element = document.getElementById(`operations-${kind}-meta`);
  if (element) element.textContent = `统计周期：${period === 'all' ? '全部' : period}　单位：${unit}`;
}

function renderOperationBar(target, rows, nameKey, valueKey, seriesName, color) {
  const chart = operationChart(target);
  if (!chart) return;
  chart.clear();
  chart.setOption({
    color: [color],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { top: 20, right: 24, bottom: 28, left: 105 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: rows.map((item) => item[nameKey]) },
    series: [{ name: seriesName, type: 'bar', barMaxWidth: 16, data: rows.map((item) => Number(item[valueKey] || 0)) }],
  }, true);
}

function renderOperationsSummary(data) {
  const period = data.period || 'all';
  const receiptRows = data.receipts?.status || [];
  setOperationMeta('receipt', period, data.receipts?.unit || '单');
  const receipt = operationChart('operations-receipt-chart');
  receipt?.clear();
  if (receiptRows.length) {
    receipt?.setOption({
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [{
        name: '签收结果', type: 'pie', radius: ['45%', '68%'], center: ['50%', '43%'],
        data: receiptRows.map((item) => ({ name: item.label, value: item.count })),
      }],
    }, true);
    setOperationState(
      'receipt',
      `差异签收 ${data.receipts.difference_count || 0} 单，拒收 ${data.receipts.rejected_count || 0} 单，差异数量 ${formatNumber(data.receipts.difference_quantity || 0, 2)}`,
    );
  } else {
    setOperationState('receipt', '当前统计周期暂无签收数据');
  }

  const stockoutRows = (data.stockouts?.ranking || []).slice(0, 8).reverse();
  setOperationMeta('stockout', period, data.stockouts?.unit || '商品基础单位');
  renderOperationBar('operations-stockout-chart', stockoutRows, 'product_name', 'quantity', '缺货需求量', '#c58b3a');
  setOperationState('stockout', stockoutRows.length ? `展示缺货需求量最高的 ${stockoutRows.length} 个商品` : '当前统计周期暂无缺货商品');

  const thirdSpaceRows = (data.stockouts?.third_space || []).slice(0, 8).reverse();
  setOperationMeta('third-space', period, data.stockouts?.unit || '商品基础单位');
  renderOperationBar('operations-third-space-chart', thirdSpaceRows, 'store_name', 'quantity', '缺货需求量', '#4a8f6c');
  setOperationState('third-space', thirdSpaceRows.length ? `汇总 ${thirdSpaceRows.length} 个第三空间的未满足需求` : '当前统计周期暂无第三空间缺货需求');

  const inventoryRows = (data.inventory?.changes || []).slice(0, 8).reverse();
  setOperationMeta('inventory', period, data.inventory?.unit || '商品基础单位');
  renderOperationBar('operations-inventory-chart', inventoryRows, 'product_name', 'quantity_delta', '库存变化量', '#287d5a');
  setOperationState('inventory', inventoryRows.length ? `展示 ${inventoryRows.length} 个商品的库存净变化` : '当前统计周期暂无库存流水');

  const timestamps = document.getElementById('operations-timestamps');
  if (timestamps) timestamps.textContent = `响应生成时间：${operationTime(data.generated_at)}　业务数据截止：${operationTime(data.data_cutoff)}`;
}

async function loadOperationsSummary() {
  ['receipt', 'stockout', 'third-space', 'inventory'].forEach((kind) => setOperationState(kind, '正在读取经营数据投影'));
  const result = await getAPI().getOperationsSummary();
  if (!result.ok) {
    const message = errorOf(result);
    ['receipt', 'stockout', 'third-space', 'inventory'].forEach((kind) => setOperationState(kind, message, true));
    return;
  }
  renderOperationsSummary(dataOf(result) || {});
}

async function loadResource(section) {
  closeResourceDetail();
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
  state.resourceRows[section] = visibleItems;
  renderResourceTable(resultTarget, visibleItems, { resource, section, page, pageSize: Number(data.page_size || 20) });
  const total = document.getElementById(`${section}-total`);
  const recordTotal = getAPI().isMock() && keyword ? visibleItems.length : Number(data.total || 0);
  if (total) total.textContent = `${recordTotal} 条记录`;
  const pageLabel = document.getElementById(`${section}-page`);
  if (pageLabel) pageLabel.textContent = `第 ${page} / ${Math.max(1, Math.ceil(recordTotal / Number(data.page_size || 20)))} 页`;
  document.getElementById(`${section}-prev`).disabled = page <= 1;
  document.getElementById(`${section}-next`).disabled = page * Number(data.page_size || 20) >= recordTotal;
  if (section === 'inventory') {
    await loadOperationsSummary();
    const enterpriseResult = await getAPI().list('enterprises');
    const enterpriseItems = enterpriseResult.ok ? (dataOf(enterpriseResult) || {}).items || [] : [];
    const enterpriseNames = Object.fromEntries(enterpriseItems.map((item) => [item.enterprise_id, item.enterprise_name]));
    renderOperationalAlerts(resource, data.items || [], enterpriseNames);
  }
  if (section === 'transport') {
    const rows = data.items || [];
    const monitored = rows.filter((item) => item.latest_telemetry);
    const openAlerts = rows.filter((item) => item.status === 'OPEN');
    document.getElementById('transport-monitoring').textContent = resource === 'telemetry-issues'
      ? `服务器当前返回 ${rows.length} 条遥测异常或状态不一致记录，可按任务、车辆、司机和发生时间核查。`
      : resource === 'alerts'
      ? `服务器当前返回 ${openAlerts.length} 条待处理报警；报警时间、类型和对象版本均来自 B02 移动履约与设备服务投影。`
      : monitored.length
        ? `当前有 ${monitored.length} 条运输任务带最新温湿度采样，异常路线在 E02 公开产销协同大屏以红色显示。`
        : '当前任务投影暂无温湿度采样，页面不会生成模拟异常提示。';
  }
}

async function loadCalculation() {
  const kind = document.getElementById('calc-kind').value;
  const resultEl = document.getElementById('calculation-result');
  resultEl.textContent = '计算中…';
  const body = ['carpool-preview', 'warehouse-preview'].includes(kind)
    ? { scenario_code: document.getElementById('calc-scenario').value }
    : { enterprise_id: document.getElementById('calc-enterprise').value, product_id: document.getElementById('calc-product').value };
  const result = kind === 'procurement'
    ? await getAPI().generateProcurementAggregation(null, newIdempotencyKey('procurement-generate'))
    : kind === 'forecast'
      ? await getAPI().generateNextWeekForecast(newIdempotencyKey('forecast-generate'))
      : await getAPI().calculate(kind, body);
  if (!result.ok) {
    requireAuth(result);
    resultEl.textContent = errorOf(result);
    setMessage(errorOf(result), 'error');
    return;
  }
  const data = dataOf(result);
  if (data?.presentation) renderAlgorithmPresentation(data.presentation);
  else if (!['procurement', 'forecast'].includes(kind)) renderStructuredResult('calculation-result', data);
  state.lastMatchRunId = kind === 'carpool-preview' ? data?.match_run_id : null;
  state.lastWarehouseRunId = kind === 'warehouse-preview' ? data?.match_run_id : null;
  state.lastWarehouseCandidate = kind === 'warehouse-preview' ? (data?.candidates || [])[0] || null : null;
  state.warehousePlan = null;
  state.procurementAggregation = kind === 'procurement' ? (data?.items || [])[0] || null : null;
  state.forecastBatch = kind === 'forecast' ? data?.batch || null : null;
  state.calculationContext = {
    kind,
    runId: kind === 'carpool-preview' ? data?.match_run_id : kind === 'warehouse-preview' ? data?.match_run_id : null,
    candidateIndex: 0,
    choices: kind === 'carpool-preview'
      ? (data?.candidates || []).map((candidate, candidateIndex) => ({
          candidateIndex,
          orderVersions: candidate.order_versions || null,
        }))
      : kind === 'warehouse-preview'
        ? (data?.candidates || []).flatMap((candidate, candidateIndex) => (
            (candidate.candidate_warehouses || []).map((warehouse) => ({
              candidateIndex,
              warehouseId: warehouse.warehouse_id,
              warehouseObjectVersion: warehouse.warehouse_object_version,
              eligible: warehouse.eligible,
            }))
          ))
        : [],
    aggregationId: state.procurementAggregation?.id || null,
    objectVersion: state.procurementAggregation?.object_version || null,
  };
  if (kind === 'warehouse-preview') {
    const firstEligible = state.calculationContext.choices.findIndex((item) => item.eligible);
    state.calculationContext.candidateIndex = firstEligible >= 0 ? firstEligible : 0;
  }
  document.getElementById('confirm-carpool').hidden = !state.lastMatchRunId || !(data?.candidates || []).length;
  document.getElementById('confirm-warehouse').hidden = !state.lastWarehouseRunId
    || !state.lastWarehouseCandidate?.candidate_warehouses?.some((item) => item.eligible);
  updateWarehouseActionButtons();
  if (kind === 'procurement') renderProcurementAggregationBoard(data);
  else document.getElementById('procurement-aggregation-board').hidden = true;
  if (kind === 'forecast') renderForecastAggregationBoard(data);
  else document.getElementById('forecast-aggregation-board').hidden = true;
  const canConfirmProcurement = getAPI().getSession().user?.role === 'park_admin';
  document.getElementById('confirm-procurement').hidden = !canConfirmProcurement
    || state.procurementAggregation?.status !== 'DRAFT';
  if (state.procurementAggregation) {
    document.getElementById('calc-quantity').value = state.procurementAggregation.automatic_quantity;
  }
  setMessage('计算已返回场景条件、业务分配结论及待调整原因。', 'success');
}

function renderForecastAggregationBoard(data) {
  const board = document.getElementById('forecast-aggregation-board');
  const rows = data?.aggregates || [];
  board.hidden = false;
  if (!rows.length) {
    board.textContent = '下周预测批次暂无可汇总商品。';
    return;
  }
  const methodRows = data?.items || [];
  board.innerHTML = rows.map((row) => {
    const values = [
      ['历史用量', Number(row.historical_usage || 0)],
      ['生产计划', Number(row.production_plan_quantity || 0)],
      ['预测结果', Number(row.forecast_quantity || 0)],
    ];
    const maximum = Math.max(...values.map((item) => item[1]), 1);
    const bars = values.map(([label, value]) => `<div class="forecast-compare-row"><span>${label}</span><i style="--forecast-value:${(value / maximum * 100).toFixed(1)}%"></i><strong>${value.toFixed(2)}</strong></div>`).join('');
    const related = methodRows.filter((item) => item.product_id === row.product_id);
    const maeValues = related.map((item) => item.mae).filter((value) => value !== null);
    const smapeValues = related.map((item) => item.smape).filter((value) => value !== null);
    const mae = maeValues.length ? (maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length).toFixed(2) : '数据不足';
    const smape = smapeValues.length ? `${(smapeValues.reduce((sum, value) => sum + value, 0) / smapeValues.length).toFixed(2)}%` : '数据不足';
    return `<article class="forecast-aggregation-item"><header><strong>${escapeHtml(row.product_name || '名称待补充')}</strong><span>建议采购 ${Number(row.suggested_purchase_quantity || 0).toFixed(2)} ${escapeHtml(row.unit)}</span></header><p>${escapeHtml(data.period?.start || '—')} 至 ${escapeHtml(data.period?.end || '—')} · 区间 ${row.lower_bound ?? '数据不足'}—${row.upper_bound ?? '数据不足'}</p><div class="forecast-compare-bars" aria-label="历史用量、生产计划和预测结果条形对比图">${bars}</div><small>平均 MAE：${mae} · 平均 sMAPE：${smape} · 数据截止：${escapeHtml(data.data_cutoff || '暂无')}</small><small>方法：季节性平滑 / 加权移动平均 / 生产计划降级；数据不足 ${Number(row.data_insufficient_count || 0)} 家</small></article>`;
  }).join('');
}

function renderProcurementAggregationBoard(data) {
  const board = document.getElementById('procurement-aggregation-board');
  const items = data?.items || [];
  board.hidden = false;
  if (!items.length) {
    board.textContent = '当前采购周期暂无可汇总商品。';
    return;
  }
  board.innerHTML = items.map((item) => {
    const suppliers = (item.candidates || []).slice(0, 3);
    const maximum = Math.max(...suppliers.map((supplier) => Number(supplier.composite_score || 0)), 1);
    const bars = suppliers.length
      ? suppliers.map((supplier) => `<div class="supplier-compare-row"><span>${escapeHtml(supplier.supplier_name)}</span><i style="--supplier-score:${(Number(supplier.composite_score || 0) / maximum * 100).toFixed(1)}%"></i><strong>${Number(supplier.composite_score || 0).toFixed(1)} 分</strong></div>`).join('')
      : '<p class="empty-state">没有满足报价、起订量、档位和供货能力的供应商。</p>';
    const warning = (item.unit_conversion_warnings || []).length
      ? `<small class="warning-text">${item.unit_conversion_warnings.length} 条单位无法换算，已排除自动推荐</small>`
      : '<small>单位换算完整</small>';
    return `<article class="procurement-aggregation-item"><header><strong>${escapeHtml(item.product_name || '名称待补充')}</strong><span>${Number(item.automatic_quantity || 0).toFixed(2)} ${escapeHtml(item.base_unit)}</span></header><p>${escapeHtml(item.cycle_start)} 至 ${escapeHtml(item.cycle_end)} · ${escapeHtml(item.status)}</p>${warning}<div class="supplier-compare-bars" aria-label="供应商方案综合评分条形图">${bars}</div></article>`;
  }).join('');
}

async function confirmProcurementAggregation() {
  const item = state.procurementAggregation;
  if (!item) return;
  const input = document.getElementById('calc-quantity');
  const entered = input.value === '' ? null : Number(input.value);
  const adjusted = entered !== null && entered !== Number(item.automatic_quantity) ? entered : null;
  const result = await getAPI().confirmProcurementAggregation(
    item.id,
    item.object_version,
    adjusted,
    adjusted === null ? null : '网页授权用户调整采购汇总数量',
    newIdempotencyKey('procurement-confirm'),
  );
  if (!result.ok) {
    document.getElementById('calculation-result').textContent = errorOf(result);
    return;
  }
  state.procurementAggregation = { ...item, status: 'CONFIRMED', object_version: dataOf(result).object_version };
  document.getElementById('confirm-procurement').hidden = true;
  document.getElementById('calculation-result').innerHTML = '<div class="operation-note">采购建议已确认，采用数量、供应商推荐和业务状态已同步保存。</div>';
  renderProcurementAggregationBoard({ items: [state.procurementAggregation] });
  setMessage('采购汇总已保存输入快照、供应商方案和人工确认状态。', 'success');
}

async function confirmCarpool() {
  if (!state.lastMatchRunId) return;
  const context = state.calculationContext || {};
  const choice = context.choices?.[context.candidateIndex] || {};
  const result = await getAPI().confirmCarpool(
    state.lastMatchRunId,
    1,
    Number(choice.candidateIndex || 0),
    choice.orderVersions,
  );
  if (!result.ok) {
    document.getElementById('calculation-result').textContent = errorOf(result);
    return;
  }
  document.getElementById('confirm-carpool').hidden = true;
  document.getElementById('calculation-result').innerHTML = '<div class="operation-note">拼车方案已确认，服务器正在创建执行任务。</div>';
  setMessage('首选拼车方案已确认，服务器正在创建执行任务。', 'success');
}

function updateWarehouseActionButtons() {
  const plan = state.warehousePlan;
  document.getElementById('refresh-warehouse-plan').hidden = !plan;
  document.getElementById('occupy-warehouse').hidden = plan?.status !== 'RESERVED';
  document.getElementById('cancel-warehouse').hidden = !['RESERVATION_REQUESTED', 'RESERVED'].includes(plan?.status);
  document.getElementById('release-warehouse').hidden = plan?.status !== 'OCCUPIED';
}

async function confirmWarehousePool() {
  const context = state.calculationContext || {};
  const choice = context.choices?.[context.candidateIndex] || context.choices?.find((item) => item.eligible);
  if (!state.lastWarehouseRunId || !choice?.eligible) return;
  const result = await getAPI().confirmWarehousePool(
    state.lastWarehouseRunId,
    choice.candidateIndex,
    choice.warehouseId,
    choice.warehouseObjectVersion,
    newIdempotencyKey('warehouse-confirm'),
  );
  if (!result.ok) {
    document.getElementById('calculation-result').textContent = errorOf(result);
    return;
  }
  state.warehousePlan = dataOf(result)?.plan || null;
  document.getElementById('confirm-warehouse').hidden = true;
  updateWarehouseActionButtons();
  document.getElementById('calculation-result').innerHTML = '<div class="operation-note">共享仓方案已确认，服务器正在原子预占库容。</div>';
  setMessage('拼仓方案已确认，服务器正在原子预占库容。', 'success');
}

async function refreshWarehousePlan() {
  if (!state.warehousePlan?.id) return;
  const result = await getAPI().getWarehousePoolPlan(state.warehousePlan.id);
  if (!result.ok) {
    document.getElementById('calculation-result').textContent = errorOf(result);
    return;
  }
  state.warehousePlan = dataOf(result)?.plan || null;
  updateWarehouseActionButtons();
  document.getElementById('calculation-result').innerHTML = `<div class="operation-note">共享仓当前状态：${escapeHtml(state.warehousePlan?.status_label || state.warehousePlan?.status || '处理中')}</div>`;
}

async function requestWarehouseAction(action) {
  const plan = state.warehousePlan;
  if (!plan) return;
  const result = await getAPI().requestWarehousePoolAction(
    plan.id,
    action,
    plan.object_version,
    newIdempotencyKey(`warehouse-${action}`),
    action === 'cancel' ? '网页端取消拼仓计划' : null,
  );
  if (!result.ok) {
    document.getElementById('calculation-result').textContent = errorOf(result);
    return;
  }
  state.warehousePlan = { ...plan, ...dataOf(result) };
  updateWarehouseActionButtons();
  document.getElementById('calculation-result').innerHTML = `<div class="operation-note">拼仓操作已受理，当前状态：${escapeHtml(state.warehousePlan?.status_label || state.warehousePlan?.status || '处理中')}</div>`;
  setMessage('拼仓操作已受理，请刷新查看 Worker 处理结果。', 'success');
}

function updateCalculationFields() {
  const kind = document.getElementById('calc-kind').value;
  document.getElementById('scenario-fields').hidden = !['carpool-preview', 'warehouse-preview'].includes(kind);
  document.getElementById('enterprise-fields').hidden = true;
  document.getElementById('product-fields').hidden = true;
  document.getElementById('quantity-fields').hidden = kind !== 'procurement';
  document.getElementById('confirm-carpool').hidden = true;
  document.getElementById('confirm-warehouse').hidden = true;
  state.lastWarehouseRunId = null;
  state.lastWarehouseCandidate = null;
  state.warehousePlan = null;
  updateWarehouseActionButtons();
  state.procurementAggregation = null;
  state.forecastBatch = null;
  document.getElementById('confirm-procurement').hidden = true;
  document.getElementById('procurement-aggregation-board').hidden = true;
  document.getElementById('forecast-aggregation-board').hidden = true;
  state.lastMatchRunId = null;
  state.calculationContext = null;
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
    document.getElementById(`${section}-refresh`).addEventListener('click', async () => {
      await loadResource(section);
      await window.DashboardV2?.refreshE01(section);
    });
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
  const titles = { overview: 'E01 园区管理台 · 管理总览', enterprise: 'E01 园区管理台 · 主数据与企业', production: 'B01 网页管理与经营服务 · 运输订单与拼车计划', inventory: 'B01 网页管理与经营服务 · 库存、销售与冻库', transport: 'B01 网页管理与经营服务 · 运输任务与资源', import: 'B01 网页管理与经营服务 · 批量导入', analytics: 'B01 网页管理与经营服务 · 计算与建议', public: 'E02 公开产销协同大屏' };
  document.getElementById('page-title').textContent = titles[section] || '黑土闭环';
  if (section === 'overview') loadOverview();
  if (RESOURCE_GROUPS[section]) loadResource(section);
  if (isPublic) {
    updatePublicClock();
    requestAnimationFrame(applyPublicScreenScale);
  } else {
    window.scrollTo({ top: 0, left: 0 });
  }
  window.dispatchEvent(new CustomEvent('app:section-change', { detail: { section } }));
  if (window.location.hash !== `#${section}`) history.replaceState(null, '', `#${section}`);
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
  setMessage('E01 园区管理台登录成功。', 'success');
  showSection(state.activeSection);
}

async function handleLogout() {
  await getAPI().logout();
  closeResourceDetail();
  Object.keys(state.resourceRows).forEach((section) => { state.resourceRows[section] = []; });
  updateCalculationFields();
  renderAuthState(null);
  document.getElementById('auth-panel').hidden = false;
  setMessage('已退出 E01 园区管理台会话；E02 公开产销协同大屏仍可访问。', 'info');
}

async function initPage() {
  applyPublicTheme(readStoredPublicTheme());
  await loadServerDictionaries();
  document.querySelectorAll('.sidebar button[data-section]').forEach((button) => button.addEventListener('click', () => showSection(button.dataset.section)));
  document.getElementById('open-login').addEventListener('click', () => { document.getElementById('auth-panel').hidden = false; });
  document.getElementById('close-login').addEventListener('click', () => { document.getElementById('auth-panel').hidden = true; });
  document.getElementById('logout-button').addEventListener('click', handleLogout);
  document.getElementById('reset-demo-case')?.addEventListener('click', handleDemoCaseReset);
  document.querySelectorAll('.showcase-info-trigger').forEach((button) => {
    button.addEventListener('click', () => document.getElementById('showcase-data-dialog')?.showModal());
  });
  document.getElementById('showcase-data-dialog-close')?.addEventListener('click', () => document.getElementById('showcase-data-dialog')?.close());
  document.getElementById('showcase-data-dialog')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  document.getElementById('e01-resource-dialog-close')?.addEventListener('click', closeResourceDetail);
  document.getElementById('e01-resource-dialog')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeResourceDetail(); });
  document.getElementById('e01-resource-dialog')?.addEventListener('close', () => { state.resourceDetail = null; });
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('calc-kind').addEventListener('change', updateCalculationFields);
  document.getElementById('calc-scenario').addEventListener('change', updateCalculationFields);
  document.getElementById('run-calculation').addEventListener('click', loadCalculation);
  document.getElementById('confirm-carpool').addEventListener('click', confirmCarpool);
  document.getElementById('confirm-warehouse').addEventListener('click', confirmWarehousePool);
  document.getElementById('refresh-warehouse-plan').addEventListener('click', refreshWarehousePlan);
  document.getElementById('occupy-warehouse').addEventListener('click', () => requestWarehouseAction('occupy'));
  document.getElementById('cancel-warehouse').addEventListener('click', () => requestWarehouseAction('cancel'));
  document.getElementById('release-warehouse').addEventListener('click', () => requestWarehouseAction('release'));
  document.getElementById('confirm-procurement').addEventListener('click', confirmProcurementAggregation);
  document.getElementById('public-refresh')?.addEventListener('click', () => window.DashboardV2?.refreshAll?.());
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
  window.addEventListener('blacksoil:e01-realtime-refresh', (event) => {
    const targets = event.detail?.targets || [];
    if (!targets.includes(state.activeSection) || state.activeSection === 'public') return;
    if (state.activeSection === 'overview') loadOverview();
    else if (RESOURCE_GROUPS[state.activeSection]) loadResource(state.activeSection);
  });
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
  const requestedSection = window.location.hash.slice(1);
  showSection(document.getElementById(requestedSection)?.classList.contains('page-section') ? requestedSection : 'overview');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage);
else initPage();
