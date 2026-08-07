const CHANNEL_TYPES = {
  TRADITIONAL: 'TRADITIONAL_STORE',
  TRADITIONAL_STORE: 'TRADITIONAL_STORE',
  THIRD_SPACE: 'THIRD_SPACE',
};

const CHANNEL_NAMES = {
  TRADITIONAL_STORE: '传统门店',
  THIRD_SPACE: '第三空间',
};

const TRANSPORT_NAMES = {
  DRAFT: '草稿', MATCHED: '已匹配', CONFIRMED: '已确认', PUBLISHED: '已发布',
  DRIVER_ACCEPTED: '司机已接单', PICKED_UP: '已取货', IN_TRANSIT: '运输中',
  DELIVERED: '已送达', STORE_SIGNED: '门店已签收', COMPLETED: '已完成', CANCELLED: '已取消',
};

function channelType(value) {
  return CHANNEL_TYPES[value] || value || 'UNKNOWN';
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function inferCity(store = {}) {
  if (store.city) return store.city;
  const latitude = number(store.latitude);
  if (latitude >= 45) return '哈尔滨市';
  if (latitude >= 43) return '长春市';
  return '沈阳市';
}

function demandTotals(rows) {
  const totals = new Map();
  for (const row of rows) totals.set(row.unit, (totals.get(row.unit) || 0) + number(row.quantity));
  return [...totals].map(([unit, quantity]) => ({ unit, quantity }));
}

export function adaptDashboardSnapshot(source) {
  if (!source || typeof source !== 'object') return null;
  if (source.headline && source.daily_trend) return source;

  const summary = source.summary || {};
  const charts = source.charts || {};
  const demandRows = charts.daily_demand_by_unit || [];
  const operationRows = charts.daily_operations_by_channel || [];
  const preorderRows = charts.daily_preorders_by_channel || [];
  const dayChannels = new Set([
    ...demandRows.map((row) => `${row.date}\u0000${channelType(row.channel)}`),
    ...operationRows.map((row) => `${row.date}\u0000${channelType(row.channel)}`),
    ...preorderRows.map((row) => `${row.date}\u0000${channelType(row.channel)}`),
  ]);

  const dailyTrend = [...dayChannels].sort().map((key) => {
    const [date, type] = key.split('\u0000');
    const demand = demandRows.filter((row) => row.date === date && channelType(row.channel) === type);
    const operation = operationRows.find((row) => row.date === date && channelType(row.channel) === type) || {};
    const preorder = preorderRows.find((row) => row.date === date && channelType(row.channel) === type) || {};
    return {
      date,
      channel_type: type,
      preorder_count: number(preorder.count),
      demand_totals: demandTotals(demand),
      operation_order_count: number(operation.order_count),
      sales_amount: number(operation.sales_amount),
    };
  });

  const preorders = new Map((charts.preorders_by_channel || []).map((row) => [channelType(row.channel), number(row.count)]));
  const channels = (charts.channel_mix || []).map((row) => ({
    channel_type: channelType(row.channel),
    display_name: CHANNEL_NAMES[channelType(row.channel)] || row.channel,
    preorder_count: preorders.get(channelType(row.channel)) || 0,
    demand_totals: demandTotals(demandRows.filter((item) => channelType(item.channel) === channelType(row.channel))),
    operation_order_count: number(row.order_count),
    sales_amount: number(row.sales_amount),
  }));
  const totalOrders = channels.reduce((sum, row) => sum + row.operation_order_count, 0);
  const totalSales = channels.reduce((sum, row) => sum + row.sales_amount, 0);
  channels.forEach((row) => {
    row.operation_order_share = totalOrders ? row.operation_order_count / totalOrders * 100 : 0;
    row.sales_share = totalSales ? row.sales_amount / totalSales * 100 : 0;
  });

  const stores = new Map((source.map?.stores || []).map((store) => [store.id, store]));
  const mapNodes = [];
  const mapEdges = [];
  const existingNodes = new Set();
  function pushNode(node) {
    if (!node.node_id || existingNodes.has(node.node_id)) return;
    existingNodes.add(node.node_id);
    mapNodes.push(node);
  }
  for (const route of source.map?.routes || []) {
    const originId = `origin-${route.task_id}`;
    pushNode({
      node_id: originId,
      node_type: 'PARK',
      display_name: route.task_no || '任务始发地',
      latitude: route.origin?.latitude,
      longitude: route.origin?.longitude,
      status: route.status,
    });
    for (const stop of route.stops || []) {
      const store = stores.get(stop.store_id) || stop;
      const targetId = `store-${stop.store_id}`;
      pushNode({
        node_id: targetId,
        node_type: channelType(store.channel),
        display_name: store.name || stop.store_name || stop.store_id,
        latitude: store.latitude ?? stop.latitude,
        longitude: store.longitude ?? stop.longitude,
        status: stop.status,
      });
      mapEdges.push({
        source_id: originId,
        target_id: targetId,
        task_id: route.task_id,
        task_no: route.task_no,
        status: route.status,
        channel_type: channelType(store.channel),
        route_label: route.route_label || '经纬度估算路线',
        latest_telemetry: route.latest_telemetry,
        latest_location: route.latest_location,
        abnormal: Boolean(route.latest_telemetry?.anomaly_code),
      });
    }
  }
  for (const store of stores.values()) {
    pushNode({
      node_id: `store-${store.id}`,
      node_type: channelType(store.channel),
      display_name: store.name,
      latitude: store.latitude,
      longitude: store.longitude,
    });
  }

  const quality = source.data_quality || {};
  const storeCount = number(quality.store_count || summary.store_count);
  const reportingCount = number(quality.reporting_store_count);
  return {
    park_name: '黑土循环产业协同园区',
    data_cutoff: source.data_cutoff || source.generated_at,
    generated_at: source.generated_at,
    headline: {
      preorder_count: number(summary.preorder_count),
      demand_totals: demandTotals(demandRows),
      operation_order_count: number(summary.operation_order_count),
      sales_amount: number(summary.total_sales_amount),
    },
    daily_trend: dailyTrend,
    channel_mix: channels,
    third_spaces: (charts.third_space_ranking || []).map((row) => ({
      ...row,
      city: inferCity(stores.get(row.store_id)),
      preorder_count: 0,
      demand_totals: [],
      operation_order_count: number(row.order_count),
      sales_amount: number(row.sales_amount),
      last_report_date: source.data_cutoff?.slice?.(0, 10),
    })),
    data_quality: {
      store_count: storeCount,
      report_coverage: number(quality.report_coverage_pct),
      missing_store_classification_count: 0,
      missing_coordinate_count: [...stores.values()].filter((store) => !store.latitude || !store.longitude).length,
      missing_report_count: Math.max(0, storeCount - reportingCount),
    },
    map_nodes: mapNodes,
    map_edges: mapEdges,
    alerts: source.alerts || [],
    internal: {
      capacity: (charts.demand_by_enterprise || []).map((row) => ({ label: row.name, value: row.quantity_kg, unit: 'kg' })),
      inventory_alerts: (charts.inventory_by_product || []).map((row) => ({ label: row.product_name, value: row.quantity, unit: '库存' })),
      freezer: (charts.warehouse_capacity || []).map((row) => ({ label: row.warehouse_name, value: row.utilization_pct, unit: '%' })),
      transport: (charts.transport_status || []).map((row) => ({ label: TRANSPORT_NAMES[row.status] || '其他状态', value: row.count, unit: '项' })),
    },
  };
}
