import {
  CHANNEL_LABELS,
  COLORS,
  channelValues,
  dashboardPalette,
  demandDisplaySummary,
  demandSeries,
  formatCurrency,
  formatCnyAmount,
  formatDate,
  formatNumber,
  formatPercent,
  operationTrendSeries,
  responseError,
  safeEnvelopeData,
} from './dashboard-format.js?v=20260815-demand-summary-1';
import {
  applyDashboardMapDictionaries,
  basemapVisibilityPatch,
  buildChangchunMapOption,
  buildNortheastMapOption,
  localGeoJsonIsChangchunRoadBasemap,
  localGeoJsonIsChangchunServiceArea,
  localGeoJsonIsNortheast,
  localShowcaseRoutesAreValid,
  MAP_SCALE_LIMIT,
  normalizeMapViewport,
  overviewMapViewport,
  routeFocusViewport,
  selectChangchunRoutes,
} from './dashboard-map.js?v=20260815-demand-summary-1';
import { createSeamlessLoop } from './dashboard-loop.js?v=20260815-demand-summary-1';
import { VOICE_STATES, VoiceQuestionController } from './dashboard-voice.js?v=20260815-demand-summary-1';
import { adaptDashboardSnapshot, applyDashboardDictionaries } from './dashboard-adapter.js?v=20260815-demand-summary-1';
import { eventTargets, RealtimeCoordinator } from './dashboard-realtime.js?v=20260815-demand-summary-1';

const echarts = window.echarts;
const API = window.API;
const DEMO_FIXTURE = './frontend-mocks-v0.1/e02-dashboard-snapshot.json';
const CHANGCHUN_MAP_FIXTURE = './assets/maps/changchun-service-area.geojson';
const CHANGCHUN_ROAD_BASEMAPS = Object.freeze([
  './assets/maps/changchun-road-basemap.v4.geojson',
  './assets/maps/changchun-road-basemap.v3.geojson',
  './assets/maps/changchun-road-basemap.v2.geojson',
]);
const CHANGCHUN_SHOWCASE_ROUTE_CATALOGS = Object.freeze([
  './assets/maps/changchun-showcase-routes.v3.json',
  './assets/maps/changchun-showcase-routes.v2.json',
  './assets/maps/changchun-showcase-routes.v1.json',
]);
const LEGACY_MAP_FIXTURE = './assets/maps/northeast-china-admin1.geojson';
const chartInstances = new Map();
const state = {
  active: false,
  loading: false,
  period: '30d',
  snapshot: null,
  source: null,
  lastSuccessfulAt: null,
  mapReady: false,
  mapMode: null,
  mapBasemap: null,
  mapShowcaseRoutes: null,
  mapBasemapFallback: false,
  mapBasemapFallbackLevel: null,
  mapRouteFallbackLevel: null,
  mapViewport: overviewMapViewport(),
  mapViewportInitialized: false,
  mapPresentationMode: null,
  mapRoutePresentation: null,
  mapRendered: false,
  refreshGeneration: 0,
  information: null,
  informationEtag: null,
  informationSignatures: { NEWS: null, POLICY: null },
  informationPaused: false,
  informationTimer: null,
  rankingLoop: null,
  informationLoops: { NEWS: null, POLICY: null },
  rankingSignature: null,
  showcasePanel: 'CARPOOL',
  showcaseCase: {},
  showcasePauseUntil: 0,
  showcaseTimer: null,
  e01Snapshot: null,
  currentSection: 'overview',
  eventRefreshTimer: null,
  pendingEventTargets: new Set(),
  theme: 'night',
  dialogContent: null,
  demandDialogTrigger: null,
};
let realtimeCoordinator = null;

function byId(id) {
  return document.getElementById(id);
}

function htmlEscape(value) {
  const span = document.createElement('span');
  span.textContent = String(value ?? '');
  return span.innerHTML;
}

function initChart(id) {
  const element = byId(id);
  if (!element || !echarts) return null;
  let chart = chartInstances.get(id);
  if (!chart) {
    chart = echarts.init(element, null, { renderer: id === 'dv2-map-chart' ? 'svg' : 'canvas' });
    chartInstances.set(id, chart);
  }
  return chart;
}

function baseAxis(palette = COLORS) {
  return {
    axisLine: { lineStyle: { color: palette.axis || 'rgba(105, 184, 219, .28)' } },
    axisLabel: { color: palette.muted, fontSize: 10 },
    splitLine: { lineStyle: { color: palette.grid } },
  };
}

function tooltip(palette = COLORS) {
  return {
    trigger: 'axis',
    backgroundColor: palette.tooltipBackground || 'rgba(8, 31, 55, .96)',
    borderColor: palette.tooltipBorder || palette.traditional,
    textStyle: { color: palette.text, fontSize: 11 },
  };
}

function screenPalette() {
  return dashboardPalette(state.theme);
}

function formatSnapshotTime(value, emptyText) {
  if (!value) return emptyText;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return emptyText;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(parsed);
}

function recomputeSnapshot(source, period) {
  if (!source?.daily_trend?.length || period === '30d') return { ...source, period };
  const dates = [...new Set(source.daily_trend.map((row) => String(row.date)))].sort();
  const last = dates.at(-1);
  const selected = period === '7d'
    ? new Set(dates.slice(-7))
    : new Set(dates.filter((date) => date.slice(0, 7) === last.slice(0, 7)));
  const daily = source.daily_trend.filter((row) => selected.has(String(row.date)));
  const channels = ['TRADITIONAL_STORE', 'THIRD_SPACE'].map((type) => {
    const rows = daily.filter((row) => row.channel_type === type);
    const totals = new Map();
    for (const row of rows) for (const item of row.demand_totals || []) totals.set(item.unit, (totals.get(item.unit) || 0) + Number(item.quantity || 0));
    return {
      channel_type: type,
      display_name: CHANNEL_LABELS[type],
      preorder_count: rows.reduce((sum, row) => sum + Number(row.preorder_count || 0), 0),
      demand_totals: [...totals].map(([unit, quantity]) => ({ unit, quantity })),
      operation_order_count: rows.reduce((sum, row) => sum + Number(row.operation_order_count || 0), 0),
      sales_amount: rows.reduce((sum, row) => sum + Number(row.sales_amount || 0), 0),
    };
  });
  const totalOrders = channels.reduce((sum, row) => sum + row.operation_order_count, 0);
  const totalSales = channels.reduce((sum, row) => sum + row.sales_amount, 0);
  for (const channel of channels) {
    channel.operation_order_share = totalOrders ? channel.operation_order_count / totalOrders * 100 : null;
    channel.sales_share = totalSales ? channel.sales_amount / totalSales * 100 : null;
  }
  const demand = new Map();
  for (const channel of channels) for (const item of channel.demand_totals) demand.set(item.unit, (demand.get(item.unit) || 0) + item.quantity);
  const third = channels.find((channel) => channel.channel_type === 'THIRD_SPACE');
  const originalThird = source.channel_mix.find((channel) => channel.channel_type === 'THIRD_SPACE');
  const orderRatio = originalThird?.operation_order_count ? third.operation_order_count / originalThird.operation_order_count : 0;
  const salesRatio = originalThird?.sales_amount ? third.sales_amount / originalThird.sales_amount : 0;
  const preorderRatio = originalThird?.preorder_count ? third.preorder_count / originalThird.preorder_count : 0;
  return {
    ...source,
    period,
    range_start: `${[...selected][0]}T00:00:00+08:00`,
    daily_trend: daily,
    channel_mix: channels,
    headline: {
      ...source.headline,
      preorder_count: channels.reduce((sum, row) => sum + row.preorder_count, 0),
      demand_totals: [...demand].map(([unit, quantity]) => ({ unit, quantity })),
      operation_order_count: totalOrders,
      sales_amount: totalSales,
    },
    third_spaces: source.third_spaces.map((item) => ({
      ...item,
      preorder_count: Math.round(item.preorder_count * preorderRatio),
      operation_order_count: Math.round(item.operation_order_count * orderRatio),
      sales_amount: item.sales_amount * salesRatio,
      demand_totals: item.demand_totals.map((total) => ({ ...total, quantity: total.quantity * preorderRatio })),
    })),
  };
}

export function demoSnapshotForPeriod(snapshot, period) {
  return recomputeSnapshot(snapshot, period);
}

async function loadDemoSnapshot() {
  const response = await fetch(DEMO_FIXTURE, { cache: 'no-store' });
  if (!response.ok) throw new Error(`本地演示快照加载失败（HTTP ${response.status}）`);
  const payload = await response.json();
  if (!payload?.data) throw new Error('本地演示快照格式无效');
  return recomputeSnapshot(payload.data, state.period);
}

async function ensureMap(mode = 'changchun') {
  if (state.mapReady && state.mapMode === mode) return;
  if (mode === 'changchun') {
    state.mapBasemap = null;
    state.mapBasemapFallback = false;
    state.mapBasemapFallbackLevel = null;
    for (let index = 0; index < CHANGCHUN_ROAD_BASEMAPS.length; index += 1) {
      try {
        const basemapResponse = await fetch(CHANGCHUN_ROAD_BASEMAPS[index], { cache: 'force-cache' });
        if (!basemapResponse.ok) throw new Error(`HTTP ${basemapResponse.status}`);
        const basemap = await basemapResponse.json();
        if (!localGeoJsonIsChangchunRoadBasemap(basemap)) throw new Error('结构校验失败');
        const boundaryFeatures = basemap.features.filter((feature) => feature.properties?.layer === 'service_boundary');
        if (!boundaryFeatures.length) throw new Error('服务范围边界缺失');
        echarts.registerMap('changchun-service-area', { type: 'FeatureCollection', features: boundaryFeatures });
        state.mapBasemap = basemap;
        state.mapBasemapFallback = index > 0;
        state.mapBasemapFallbackLevel = index === 1 ? 'v3' : index === 2 ? 'v2' : null;
        break;
      } catch {
        // 继续尝试下一级首方静态资产。
      }
    }
    if (!state.mapBasemap) {
      const fallbackResponse = await fetch(CHANGCHUN_MAP_FIXTURE, { cache: 'force-cache' });
      if (!fallbackResponse.ok) throw new Error(`本地地图资源加载失败（HTTP ${fallbackResponse.status}）`);
      const fallback = await fallbackResponse.json();
      if (!localGeoJsonIsChangchunServiceArea(fallback)) throw new Error('长春服务范围地图坐标校验失败');
      echarts.registerMap('changchun-service-area', fallback);
      state.mapBasemap = null;
      state.mapBasemapFallback = true;
      state.mapBasemapFallbackLevel = 'service-area';
    }
    state.mapShowcaseRoutes = null;
    state.mapRouteFallbackLevel = null;
    for (let index = 0; index < CHANGCHUN_SHOWCASE_ROUTE_CATALOGS.length; index += 1) {
      try {
        const routeResponse = await fetch(CHANGCHUN_SHOWCASE_ROUTE_CATALOGS[index], { cache: 'force-cache' });
        if (!routeResponse.ok) throw new Error(`HTTP ${routeResponse.status}`);
        const routeCatalog = await routeResponse.json();
        if (!localShowcaseRoutesAreValid(routeCatalog)) throw new Error('路线目录结构校验失败');
        state.mapShowcaseRoutes = routeCatalog;
        state.mapRouteFallbackLevel = index === 1 ? 'v2' : index === 2 ? 'v1' : null;
        break;
      } catch {
        // 继续尝试简化路线回退资产。
      }
    }
    state.mapViewport = overviewMapViewport(state.mapBasemap);
    state.mapViewportInitialized = false;
    state.mapPresentationMode = null;
  } else {
    const response = await fetch(LEGACY_MAP_FIXTURE, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`本地地图资源加载失败（HTTP ${response.status}）`);
    const geojson = await response.json();
    if (!localGeoJsonIsNortheast(geojson)) throw new Error('东北三省地图坐标校验失败');
    echarts.registerMap('northeast-admin1', geojson);
  }
  state.mapReady = true;
  state.mapMode = mode;
  state.mapRendered = false;
}

function setSource(source, message) {
  const sourceEl = byId('dv2-source-state');
  const demoBadge = byId('dv2-demo-badge');
  const dataInfoButton = byId('dv2-data-info');
  if (sourceEl) {
    sourceEl.className = `dv2-source ${source === 'demo' ? 'demo' : source === 'error' ? 'error' : 'live'}`;
    sourceEl.textContent = message;
  }
  if (demoBadge && source !== 'showcase') demoBadge.hidden = true;
  if (dataInfoButton && source !== 'showcase') dataInfoButton.hidden = true;
}

function renderDatasetBadge(snapshot) {
  const badge = byId('dv2-demo-badge');
  const infoButton = byId('dv2-data-info');
  if (!badge) return;
  const showcase = snapshot?.dataset_mode === 'showcase';
  badge.hidden = !showcase;
  if (infoButton) infoButton.hidden = !showcase;
  if (!showcase) return;
  const refreshed = snapshot.case_refreshed_at
    ? new Date(snapshot.case_refreshed_at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
    : '--:--';
  badge.textContent = `固定演示案例 · 更新至 ${refreshed}`;
}

function renderHeadline(snapshot) {
  byId('dv2-park-name').textContent = snapshot.park_name || '园区未选择';
  byId('dv2-preorder-count').textContent = formatNumber(snapshot.headline.preorder_count);
  byId('dv2-operation-orders').textContent = formatNumber(snapshot.headline.operation_order_count);
  byId('dv2-sales-amount').textContent = snapshot.currency === 'CNY'
    ? formatCnyAmount(snapshot.headline.sales_amount)
    : `币种不支持（${snapshot.currency || '空值'}）`;
  byId('dv2-third-space-count').textContent = formatNumber(snapshot.third_spaces.length);
  const summary = demandDisplaySummary(snapshot.headline?.demand_totals, { primaryUnit: '公斤' });
  const primaryValue = byId('dv2-demand-primary-value');
  const primaryUnit = byId('dv2-demand-primary-unit');
  const primaryMeta = byId('dv2-demand-primary-meta');
  const openButton = byId('dv2-demand-open');
  if (primaryValue) primaryValue.textContent = summary.primary.available ? formatNumber(summary.primary.quantity, 2) : '—';
  if (primaryUnit) primaryUnit.textContent = '公斤';
  if (primaryMeta) {
    primaryMeta.textContent = summary.all.length === 0
      ? '当前周期暂无需求数据'
      : summary.primary.available
        ? (summary.secondaryCount ? `· 另有 ${summary.secondaryCount} 种单位` : '仅公斤需求')
        : `当前周期暂无公斤需求 · 另有 ${summary.secondaryCount} 种单位`;
  }
  if (openButton) openButton.disabled = summary.all.length === 0;
  byId('public-data-cutoff').textContent = formatSnapshotTime(snapshot.data_cutoff, snapshot.data_cutoff_note || '暂无业务数据');
  byId('public-generated-at').textContent = formatSnapshotTime(snapshot.generated_at, '响应时间未知');
}

function renderDemandDialog(snapshot) {
  const dialog = byId('dv2-chart-dialog');
  const summaryElement = byId('dv2-demand-dialog-summary');
  const chartElement = byId('dv2-dialog-chart');
  if (!dialog || !summaryElement || !chartElement) return;
  const summary = demandDisplaySummary(snapshot?.headline?.demand_totals, { primaryUnit: '公斤' });
  const periodLabel = { '7d': '7 日', '30d': '30 日', month: '本月' }[state.period] || state.period;
  const cutoff = formatSnapshotTime(snapshot?.data_cutoff, '暂无数据截止时间');
  summaryElement.innerHTML = summary.all.length
    ? `<div class="dv2-demand-dialog-period">当前周期：${htmlEscape(periodLabel)} · 数据截止：${htmlEscape(cutoff)}</div><dl>${summary.all.map((item) => `<div class="dv2-demand-dialog-item"><dt>${htmlEscape(item.unit)}${item.unit === '公斤' ? '<small>主要单位</small>' : ''}</dt><dd>${htmlEscape(formatNumber(item.quantity, 2))}</dd></div>`).join('')}</dl><p>各单位独立统计，不跨单位相加。</p>`
    : '<div class="dv2-empty">当前周期暂无需求数据</div>';
  summaryElement.hidden = false;
  dialog.classList.add('is-demand');
  chartElement.setAttribute('aria-label', `${periodLabel}每日分单位需求趋势图`);
  renderDemandChart(snapshot || { daily_trend: [] }, 'dv2-dialog-chart');
}

function renderDemandChart(snapshot, target = 'dv2-demand-chart', palette = screenPalette()) {
  const chart = initChart(target);
  if (!chart) return;
  const data = demandSeries(snapshot.daily_trend);
  chart.setOption({
    animationDuration: 350,
    color: [palette.demand, palette.traditional, palette.thirdSpace, palette.alternate],
    tooltip: tooltip(palette),
    legend: { top: 5, right: 8, textStyle: { color: palette.muted, fontSize: 10 } },
    grid: { top: 40, right: 18, bottom: 28, left: 45 },
    xAxis: { type: 'category', data: data.dates.map(formatDate), boundaryGap: false, ...baseAxis(palette), axisLabel: { color: palette.muted, fontSize: 9, interval: Math.max(0, Math.floor(data.dates.length / 6) - 1) } },
    yAxis: { type: 'value', ...baseAxis(palette), name: '按单位', nameTextStyle: { color: palette.muted, fontSize: 9 } },
    series: data.series.map((series, index) => ({
      ...series,
      type: 'line',
      smooth: 0.25,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { width: 2 },
      areaStyle: { opacity: index === 0 ? 0.13 : 0.04 },
    })),
  }, true);
}

function donutOption(values, centerLabel, palette = COLORS, valueFormatter = formatNumber, displayOptions = {}) {
  const total = values.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const expanded = displayOptions.profile === 'e02-expanded';
  const primary = displayOptions.centerPrimary ?? (total ? valueFormatter(total) : valueFormatter(0));
  const unit = displayOptions.centerUnit ?? centerLabel;
  const primaryLength = String(primary).length;
  const primaryFontSize = expanded ? (primaryLength >= 8 ? 12 : primaryLength >= 6 ? 14 : 16) : 18;
  return {
    animationDuration: 350,
    tooltip: { trigger: 'item', formatter: (params) => `${htmlEscape(params.name)}<br/>${htmlEscape(valueFormatter(params.value, true))} · ${htmlEscape(formatPercent(params.percent))}`, backgroundColor: palette.tooltipBackground || 'rgba(8, 31, 55, .96)', borderColor: palette.tooltipBorder || palette.traditional, textStyle: { color: palette.text } },
    title: { text: primary, subtext: unit, left: 'center', top: expanded ? '32%' : '37%', textStyle: { color: palette.text, fontFamily: 'JetBrains Mono Variable', fontSize: primaryFontSize, width: expanded ? 64 : undefined, overflow: 'truncate', align: 'center' }, subtextStyle: { color: palette.muted, fontSize: expanded ? 9 : 10, width: expanded ? 64 : undefined, overflow: 'truncate', align: 'center' } },
    series: [{
      type: 'pie', radius: expanded ? ['63%', '88%'] : ['57%', '77%'], center: ['50%', expanded ? '49%' : '48%'], startAngle: 90,
      label: { show: false }, emphasis: { scale: true, scaleSize: 5 },
      itemStyle: { borderColor: palette.pieBorder || '#0b263e', borderWidth: 2 },
      data: values,
    }],
  };
}

function renderMix(snapshot) {
  const palette = screenPalette();
  const orderTotal = snapshot.channel_mix.reduce((sum, item) => sum + Number(item.operation_order_count || 0), 0);
  initChart('dv2-order-donut')?.setOption(donutOption(
    channelValues(snapshot.channel_mix, 'operation_order_count', palette), '订单', palette, formatNumber,
    { profile: 'e02-expanded', centerPrimary: formatNumber(orderTotal), centerUnit: '笔' },
  ), true);
  const salesFormatter = (value, full = false) => snapshot.currency === 'CNY'
    ? formatCnyAmount(value, { compact: !full, fullPrecision: full })
    : `币种不支持（${snapshot.currency || '空值'}）`;
  const salesTotal = snapshot.channel_mix.reduce((sum, item) => sum + Number(item.sales_amount || 0), 0);
  const salesPrimary = snapshot.currency === 'CNY'
    ? formatCnyAmount(salesTotal).replace(/\s*(亿元|万元|元)$/, '')
    : '—';
  const salesUnit = snapshot.currency === 'CNY'
    ? (salesTotal >= 100000000 ? '亿元' : salesTotal >= 10000 ? '万元' : '元')
    : '';
  initChart('dv2-sales-donut')?.setOption(donutOption(
    channelValues(snapshot.channel_mix, 'sales_amount', palette), '营业额', palette, salesFormatter,
    { profile: 'e02-expanded', centerPrimary: salesPrimary, centerUnit: salesUnit },
  ), true);
  byId('dv2-mix-legend').innerHTML = snapshot.channel_mix.map((item) => {
    const color = item.channel_type === 'THIRD_SPACE' ? palette.thirdSpace : palette.traditional;
    return `<div style="--legend-color:${color}"><strong>${htmlEscape(item.display_name)}</strong><small>订单 ${htmlEscape(formatPercent(item.operation_order_share))} · 营业额 ${htmlEscape(formatPercent(item.sales_share))}</small></div>`;
  }).join('');
}

function rankItemMarkup(item, index, max, snapshot) {
  return `<div class="dv2-rank-item">
    <b>${index + 1}</b>
    <div><strong>${htmlEscape(item.store_name)}</strong><small>${htmlEscape(item.city || '城市待补充')} · 最近上报 ${htmlEscape(item.last_report_date || '缺报')}</small><div class="dv2-rank-bar"><i style="width:${Math.max(4, Number(item.sales_amount || 0) / max * 100).toFixed(1)}%"></i></div></div>
    <span class="dv2-rank-value"><b>${htmlEscape(snapshot.currency === 'CNY' ? formatCnyAmount(item.sales_amount) : `币种不支持（${snapshot.currency || '空值'}）`)}</b><small>${htmlEscape(formatNumber(item.operation_order_count))} 笔</small></span>
  </div>`;
}

function renderRanking(snapshot) {
  const rows = [...snapshot.third_spaces].sort((a, b) => Number(b.sales_amount) - Number(a.sales_amount));
  const max = Math.max(...rows.map((item) => Number(item.sales_amount || 0)), 1);
  const viewport = byId('dv2-third-space-list');
  const signature = JSON.stringify(rows.map((item) => [item.store_name, item.sales_amount, item.operation_order_count, item.last_report_date]));
  if (state.rankingSignature === signature && viewport.querySelector('.dv2-loop-track')) {
    state.rankingLoop?.refresh();
    return;
  }
  state.rankingLoop?.destroy();
  state.rankingLoop = null;
  state.rankingSignature = signature;
  viewport.innerHTML = rows.length ? `<div class="dv2-loop-track">${rows.map((item, index) => rankItemMarkup(item, index, max, snapshot)).join('')}</div>` : '<div class="dv2-empty">暂无第三空间经营数据</div>';
  if (!rows.length) {
    byId('dv2-ranking-loop-toggle').hidden = true;
    return;
  }
  state.rankingLoop = createSeamlessLoop({
    viewport, track: viewport.firstElementChild, pauseButton: byId('dv2-ranking-loop-toggle'),
    signature, speedPxPerSecond: 15, itemCount: rows.length,
    active: () => state.active && !document.hidden,
    blocked: () => Boolean(document.querySelector('.dv2-chart-dialog[open]')),
  });
}

function renderQuality(snapshot) {
  const quality = snapshot.data_quality;
  byId('dv2-coverage').textContent = `日报覆盖 ${formatPercent(quality.report_coverage)}`;
  const items = [
    ['正式门店', quality.store_count],
    ['缺少分类', quality.missing_store_classification_count],
    ['缺少坐标', quality.missing_coordinate_count],
    ['日报缺报', quality.missing_report_count],
  ];
  byId('dv2-quality-list').innerHTML = items.map(([label, value]) => `<div><b>${htmlEscape(formatNumber(value))}</b><span>${htmlEscape(label)}</span></div>`).join('');
}

function routeDetailMarkup(route) {
  if (!route) return '<strong>当前无可展示线路</strong><span>精选门店仍正常显示。</span>';
  if (route.mode === 'SHOWCASE') {
    const data = route.showcase;
    const detail = Number(data.detail_distance_km ?? data.estimated_distance_km);
    const full = Number(data.full_distance_km ?? data.estimated_distance_km);
    const scope = state.mapViewport.focusScope === 'FULL' ? 'FULL' : 'DETAIL';
    return `<strong>路线 ${htmlEscape(route.routeNo)} · 展示车辆</strong><span>${htmlEscape(data.origin.display_name)} → ${htmlEscape(data.destination_name)}</span><small>${scope === 'DETAIL' ? `当前显示终点前 ${htmlEscape(formatNumber(detail, 1))} km` : `当前显示完整路线 ${htmlEscape(formatNumber(full, 1))} km`}</small><em>${scope === 'DETAIL' ? `完整路线 ${htmlEscape(formatNumber(full, 1))} km，可切换“全程”` : '预设路线演示 · 无实时定位与遥测'}；不代表道路导航或实时履约。</em>`;
  }
  const live = route.live;
  const location = live.latest_location;
  const telemetry = live.latest_telemetry;
  const alerts = live.alerts || [];
  return `<strong>路线 ${htmlEscape(route.routeNo)} · ${htmlEscape(live.vehicle_label || '配送车辆')}</strong><span>${htmlEscape(live.from?.display_name || '车辆当前位置')} → ${htmlEscape(live.to?.display_name || '运输目标点')} · ${htmlEscape(live.status_label || live.status || '状态待补充')}</span><small>${location ? `定位 ${htmlEscape(formatSnapshotTime(location.recorded_at, '时间待补充'))} · ${htmlEscape(formatNumber(location.speed_mps, 1))} 米/秒 · 精度 ${htmlEscape(formatNumber(location.accuracy_m, 1))} 米` : '暂无有效车辆位置，使用任务起点估算'}</small><em>${telemetry ? `温度 ${htmlEscape(formatNumber(telemetry.temperature_c, 1))} ℃ · 湿度 ${htmlEscape(formatNumber(telemetry.humidity_pct, 1))}%` : '暂无温湿度采样'}${alerts.length ? ` · ${htmlEscape(alerts[0].message || alerts[0].alert_type_label || '存在未解决报警')}` : ''}</em>`;
}

function renderRoutePresentation(presentation) {
  state.mapRoutePresentation = presentation;
  const routes = presentation.routes || [];
  const modeChanged = state.mapPresentationMode && state.mapPresentationMode !== presentation.mode;
  const selectedKey = state.mapViewport.selectedRouteKey;
  if (routes.length && (!state.mapViewportInitialized || modeChanged || (selectedKey && !routes.some((route) => route.key === selectedKey)))) {
    state.mapViewport = routeFocusViewport(routes[0], 'DETAIL');
    state.mapViewportInitialized = true;
  } else if (!routes.length) {
    state.mapViewport = overviewMapViewport(state.mapBasemap);
    state.mapViewportInitialized = true;
  }
  state.mapPresentationMode = presentation.mode;
  const controls = byId('dv2-route-controls');
  if (controls) controls.innerHTML = routes.map((route) => {
    const destination = route.showcase?.destination_name || route.live?.to?.display_name || '目的地';
    const shortName = destination.replace('国信', '').replace('温泉', '').replace(/(水饺|生煎).*/, '').replace(/（.*?）/g, '');
    return `<button type="button" data-route-key="${htmlEscape(route.key)}" data-route-no="${htmlEscape(route.routeNo)}" aria-pressed="${route.key === state.mapViewport.selectedRouteKey}"><b>${htmlEscape(route.routeNo)}</b><span>${htmlEscape(shortName)}</span></button>`;
  }).join('');
  const detail = byId('dv2-route-detail');
  const selected = routes.find((route) => route.key === state.mapViewport.selectedRouteKey) || null;
  if (detail) detail.innerHTML = selected
    ? routeDetailMarkup(selected)
    : '<strong>五条配送路线全览</strong><span>共线路段只绘制一次，彩色分支对应路线 01—05。</span><small>选择路线可查看终段或全程。</small>';
  const mode = byId('dv2-route-mode');
  if (mode) mode.textContent = presentation.label;
  const detailScope = byId('dv2-route-scope-detail');
  const fullScope = byId('dv2-route-scope-full');
  const overviewScope = byId('dv2-route-scope-overview');
  const hasSelection = Boolean(selected);
  if (detailScope) { detailScope.disabled = !hasSelection; detailScope.setAttribute('aria-pressed', String(hasSelection && state.mapViewport.focusScope !== 'FULL' && state.mapViewport.mode !== 'OVERVIEW')); }
  if (fullScope) { fullScope.disabled = !hasSelection; fullScope.setAttribute('aria-pressed', String(hasSelection && state.mapViewport.focusScope === 'FULL' && state.mapViewport.mode !== 'OVERVIEW')); }
  if (overviewScope) overviewScope.setAttribute('aria-pressed', String(state.mapViewport.mode === 'OVERVIEW'));
}

function setMapViewport(viewport, { render = true } = {}) {
  state.mapViewport = normalizeMapViewport(viewport);
  updateMapZoomControls();
  if (render && state.snapshot) renderMap(state.snapshot);
}

function selectMapRoute(route, focusScope = 'DETAIL') {
  if (!route) return;
  setMapViewport(routeFocusViewport(route, focusScope));
}

function onMapRouteClick(params) {
  const route = params?.data?.routeDisplay;
  if (!route) return;
  selectMapRoute(route);
}

function onMapGeoRoam() {
  const chart = chartInstances.get('dv2-map-chart');
  const geo = chart?.getOption()?.geo?.[0];
  if (!geo) return;
  state.mapViewport = normalizeMapViewport({
    ...state.mapViewport,
    mode: 'MANUAL',
    center: Array.isArray(geo.center) ? geo.center.map(Number) : state.mapViewport.center,
    zoom: Number(geo.zoom) || state.mapViewport.zoom,
  });
  const seriesIds = new Set((chart.getOption().series || []).map((series) => series.id));
  const visibility = basemapVisibilityPatch(state.mapViewport.zoom).filter((series) => seriesIds.has(series.id));
  if (visibility.length) chart.setOption({ series: visibility }, { notMerge: false, lazyUpdate: true });
  updateMapZoomControls();
}

function updateMapZoomControls() {
  const zoom = state.mapViewport.zoom;
  const zoomIn = byId('dv2-map-zoom-in');
  const zoomOut = byId('dv2-map-zoom-out');
  if (zoomIn) zoomIn.disabled = zoom >= MAP_SCALE_LIMIT.max - 0.001;
  if (zoomOut) zoomOut.disabled = zoom <= MAP_SCALE_LIMIT.min + 0.001;
  const status = byId('dv2-map-zoom-status');
  if (status) status.textContent = `${formatNumber(zoom, 2)}×`;
}

function renderMap(snapshot) {
  const chart = initChart('dv2-map-chart');
  if (!chart) return;
  const presentation = selectChangchunRoutes(snapshot, state.mapShowcaseRoutes);
  renderRoutePresentation(presentation);
  const option = snapshot.public_map?.schema_version === '2.0'
    ? buildChangchunMapOption(snapshot, screenPalette(), state.mapBasemap, state.mapShowcaseRoutes, {
      selectedRouteKey: state.mapViewport.selectedRouteKey,
      viewport: state.mapViewport,
    })
    : buildNortheastMapOption(snapshot, screenPalette());
  if (!state.mapRendered) {
    chart.setOption(option, true);
    state.mapRendered = true;
  } else {
    chart.setOption(option, { notMerge: false, lazyUpdate: false });
  }
  chart.off('click', onMapRouteClick);
  chart.on('click', onMapRouteClick);
  chart.off('georoam', onMapGeoRoam);
  chart.on('georoam', onMapGeoRoam);
  updateMapZoomControls();
  const excluded = snapshot.public_map?.excluded_route_summary?.count || 0;
  const alerts = (snapshot.public_map?.active_routes || []).reduce((sum, route) => sum + Number(route.alert_count || 0), 0);
  if (byId('dv2-map-summary')) {
    const fallback = state.mapBasemapFallbackLevel === 'v3'
      ? '路线连接底图暂不可用，当前显示精细道路图'
      : state.mapBasemapFallbackLevel === 'v2'
        ? '精细底图暂不可用，当前显示基础道路图'
      : state.mapBasemapFallbackLevel === 'service-area'
        ? '道路底图暂不可用，当前显示长春服务范围图'
        : state.mapRouteFallbackLevel === 'v2'
          ? '走廊路线暂不可用，当前显示完整折线路线'
          : state.mapRouteFallbackLevel === 'v1'
          ? '道路级路线暂不可用，当前显示简化路线'
          : null;
    byId('dv2-map-summary').textContent = `${fallback ? `${fallback} · ` : ''}${presentation.label} · 未解决报警 ${alerts} 条 · 排除 ${excluded} 项`;
  }
}

function showcaseAllocationSummary(allocation) {
  if (allocation.type === 'CARPOOL') {
    const stores = allocation.store_names || [];
    return {
      title: allocation.vehicle_label,
      statusLabel: allocation.decision_state_label,
      primaryMetrics: stores.length > 1 ? `${stores[0]}等 ${stores.length} 个目的地` : stores[0] || '目的地待补充',
      secondaryMetrics: `${allocation.order_count} 单 · ${formatNumber(allocation.total_weight_kg, 0)} kg · 利用率 ${formatPercent(allocation.capacity_utilization_pct)}`,
      detail: `预计节省 ${formatNumber(allocation.mileage_benefit_estimated_km, 1)} km`,
    };
  }
  if (allocation.type === 'WAREHOUSE') {
    return {
      title: allocation.warehouse_name,
      statusLabel: allocation.decision_state_label,
      primaryMetrics: `${allocation.order_count} 单 · ${allocation.temperature_zone_label} · 距离 ${formatNumber(allocation.estimated_distance_km, 1)} km`,
      secondaryMetrics: `需要 ${formatNumber(allocation.required_volume_m3, 1)} m³ · 剩余 ${formatNumber(allocation.remaining_volume_m3, 1)} m³`,
      detail: (allocation.reasons || [])[0] || '满足共享仓约束',
    };
  }
  if (allocation.type === 'PROCUREMENT') {
    const supplier = (allocation.supplier_options || [])[0];
    return {
      title: allocation.product_name,
      statusLabel: allocation.confirmation_state_label,
      primaryMetrics: `采用 ${formatNumber(allocation.effective_quantity, 2)} ${allocation.base_unit} · ${allocation.quantity_source_label}`,
      secondaryMetrics: supplier ? `首选 ${supplier.supplier_name} · ${formatCnyAmount(supplier.total_amount)}` : '暂无合格供应商',
      detail: supplier ? `综合评分 ${formatNumber(supplier.composite_score, 1)}` : '等待补充报价和供货能力',
    };
  }
  return {
    title: `${allocation.product_name} · ${allocation.unit}`,
    statusLabel: allocation.data_insufficient_count ? '部分数据不足' : '预测已生成',
    primaryMetrics: `预测 ${allocation.forecast_quantity ?? '数据不足'} · 建议采购 ${allocation.suggested_purchase_quantity ?? '数据不足'}`,
    secondaryMetrics: `区间 ${allocation.lower_bound ?? '数据不足'}—${allocation.upper_bound ?? '数据不足'} · ${allocation.enterprise_count} 家企业`,
    detail: (allocation.method_labels || [])[0] || '方法待补充',
  };
}

function showcaseAllocationDetail(allocation) {
  const compact = showcaseAllocationSummary(allocation);
  if (allocation.type === 'CARPOOL') return { ...compact, primaryMetrics: `${(allocation.store_names || []).join('、') || '目的地待补充'}；${allocation.order_count} 单 · ${allocation.enterprise_count} 家企业 · ${allocation.temperature_zone_label}`, secondaryMetrics: `${formatNumber(allocation.total_weight_kg, 1)} kg · ${formatNumber(allocation.total_volume_m3, 1)} m³ · 综合利用率 ${formatPercent(allocation.capacity_utilization_pct)}`, detail: `估算节省 ${formatNumber(allocation.mileage_benefit_estimated_km, 1)} km；${allocation.explanation || '经纬度估算路线'}` };
  if (allocation.type === 'WAREHOUSE') return { ...compact, primaryMetrics: `${allocation.order_count} 单 · ${allocation.enterprise_count} 家企业 · ${allocation.temperature_zone_label}`, secondaryMetrics: `需要 ${formatNumber(allocation.required_volume_m3, 1)} m³ · 可用 ${formatNumber(allocation.available_volume_m3, 1)} m³ · 剩余 ${formatNumber(allocation.remaining_volume_m3, 1)} m³`, detail: `最远估算 ${formatNumber(allocation.estimated_distance_km, 1)} km；${(allocation.reasons || []).join('；') || '满足共享仓约束'}` };
  return compact;
}

function showcaseSummary(selected) {
  const summary = selected.result_summary || {};
  return [
    `${summary.allocation_count || 0} 个结果`,
    summary.allocated_order_count === null || summary.allocated_order_count === undefined ? null : `${summary.allocated_order_count} 单已分配`,
    summary.unmatched_count ? `${summary.unmatched_count} 项待调整` : null,
    summary.warning_count ? `${summary.warning_count} 项提示` : null,
  ].filter(Boolean).join(' · ');
}

function showcaseCardMarkup(card) {
  return `<article><header><b>${htmlEscape(card.title)}</b><i>${htmlEscape(card.statusLabel || '')}</i></header><span>${htmlEscape(card.primaryMetrics)}</span><small>${htmlEscape(card.secondaryMetrics)}</small><em>${htmlEscape(card.detail)}</em></article>`;
}

function selectedShowcaseCase(showcase) {
  const panel = (showcase?.panels || []).find((item) => item.kind === state.showcasePanel) || showcase?.panels?.[0];
  if (!panel) return { panel: null, selected: null };
  const requested = state.showcaseCase[panel.kind];
  const selected = panel.cases?.find((item) => item.key === requested) || panel.cases?.[0] || null;
  if (selected) state.showcaseCase[panel.kind] = selected.key;
  return { panel, selected };
}

function renderShowcase(showcase) {
  const { panel, selected } = selectedShowcaseCase(showcase);
  byId('dv2-showcase-state').textContent = panel?.status_label || '等待生成';
  document.querySelectorAll('#dv2-showcase-tabs [data-kind]').forEach((button) => {
    const active = button.dataset.kind === (panel?.kind || state.showcasePanel);
    button.setAttribute('aria-selected', String(active));
    button.classList.toggle('active', active);
  });
  const cases = panel?.cases || [];
  byId('dv2-showcase-cases').innerHTML = cases.length > 1 ? cases.map((item) => `<button type="button" data-case="${htmlEscape(item.key)}" class="${item === selected ? 'active' : ''}">${htmlEscape(item.title)}</button>`).join('') : (selected?.input_summary?.period_start ? `<span>${htmlEscape(selected.input_summary.period_start)}—${htmlEscape(selected.input_summary.period_end)}</span>` : '');
  if (!selected) {
    byId('dv2-showcase-content').innerHTML = '<div class="dv2-empty">等待生成分配方案</div>';
    byId('dv2-showcase-summary').textContent = '';
    byId('dv2-showcase-more').hidden = true;
    return;
  }
  const input = selected.input_summary || {};
  const chips = [
    input.enterprise_count ? `${input.enterprise_count} 企` : null,
    input.order_count ? `${input.order_count} 单` : null,
    input.product_count ? `${input.product_count} 品` : null,
    (input.temperature_zones || []).join('/'),
  ].filter(Boolean).slice(0, 4);
  const cards = (selected.allocations || []).slice(0, 2).map(showcaseAllocationSummary);
  byId('dv2-showcase-content').innerHTML = `<div class="dv2-showcase-copy"><strong>${htmlEscape(selected.title)}</strong><div class="dv2-showcase-chips">${chips.map((chip) => `<i>${htmlEscape(chip)}</i>`).join('')}</div></div><div class="dv2-showcase-cards">${cards.length ? cards.map(showcaseCardMarkup).join('') : `<div class="dv2-empty"><b>${htmlEscape(selected.headline)}</b><span>${htmlEscape(selected.unmatched_reasons?.[0]?.reason || selected.data_cutoff_note || '')}</span></div>`}</div>`;
  const reason = selected.unmatched_reasons?.[0]?.reason || '';
  byId('dv2-showcase-summary').innerHTML = `<b>${htmlEscape(showcaseSummary(selected))}</b>${reason ? `<span>首要原因：${htmlEscape(reason)}</span>` : ''}`;
  const resultCount = (selected.allocations || []).length;
  byId('dv2-showcase-more').textContent = resultCount > 2 ? `查看全部 ${resultCount} 个结果` : reason && !resultCount ? '查看不匹配原因' : '查看方案详情';
  byId('dv2-showcase-more').hidden = !(resultCount || selected.headline || reason);
}

function openShowcaseDialog() {
  const { selected } = selectedShowcaseCase(state.snapshot?.algorithm_showcase);
  if (!selected) return;
  byId('dv2-algorithm-dialog-title').textContent = selected.title;
  const cards = (selected.allocations || []).slice(0, 24).map(showcaseAllocationDetail);
  byId('dv2-algorithm-dialog-content').innerHTML = `<div class="dv2-algorithm-dialog-summary"><strong>${htmlEscape(selected.headline)}</strong><p>${htmlEscape(selected.description)}</p><small>${htmlEscape(formatSnapshotTime(selected.calculated_at, '尚未计算'))} · ${htmlEscape(selected.data_cutoff_note || '预设场景测算')}</small></div>${cards.map((card) => `<article><h4>${htmlEscape(card.title)} · ${htmlEscape(card.statusLabel || '')}</h4><p>${htmlEscape(card.primaryMetrics)}</p><p>${htmlEscape(card.secondaryMetrics)}</p><small>${htmlEscape(card.detail)}</small></article>`).join('')}${(selected.unmatched_reasons || []).length ? `<section><h4>待调整原因</h4>${selected.unmatched_reasons.map((item) => `<p>${htmlEscape(item.reason)} · ${item.count} 项</p>`).join('')}</section>` : ''}`;
  byId('dv2-algorithm-dialog').showModal();
  state.rankingLoop?.refresh();
  refreshInformationLoops();
}

function informationCacheKey() {
  return `blacksoil:e02-information:v1:${API.getBaseUrl?.() || 'default'}`;
}

function readInformationCache() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(informationCacheKey()) || 'null');
    return stored && Date.now() - stored.savedAt <= 86400000 ? stored : null;
  } catch {
    return null;
  }
}

function saveInformationCache(payload, etag) {
  try {
    sessionStorage.setItem(informationCacheKey(), JSON.stringify({ payload, etag, savedAt: Date.now() }));
  } catch {
    // A full or blocked sessionStorage must not break the public dashboard.
  }
}

function refreshInformationLoops() {
  Object.values(state.informationLoops).forEach((loop) => loop?.refresh());
}

function renderInformationColumn(kind, message = null, { animate = true } = {}) {
  const items = (state.information?.items || []).filter((item) => item.kind === kind);
  const list = byId(kind === 'NEWS' ? 'dv2-information-news' : 'dv2-information-policy');
  const signature = `${kind}:${state.information?.catalog_version || ''}:${items.map((item) => item.slug).join('|')}`;
  if (animate && !message && state.informationSignatures[kind] === signature && list.querySelector('.dv2-loop-track')) {
    state.informationLoops[kind]?.refresh();
    return;
  }
  state.informationLoops[kind]?.destroy();
  state.informationLoops[kind] = null;
  state.informationSignatures[kind] = signature;
  if (!items.length) {
    list.innerHTML = `<div class="dv2-empty">${htmlEscape(message || (kind === 'NEWS' ? '暂无园区动态' : '暂无政策资讯'))}</div>`;
    return;
  }
  byId('dv2-information-retry').hidden = true;
  list.innerHTML = `<div class="dv2-loop-track">${items.map((item) => {
    const content = `<small>${htmlEscape(item.category)} · ${htmlEscape(formatSnapshotTime(item.published_at, '时间待补充'))}</small><strong>${htmlEscape(item.title)}</strong><span>${htmlEscape(item.summary)}</span><em>${htmlEscape(item.source_name)}</em>`;
    return item.source_url ? `<a class="tone-${item.tone.toLowerCase()}" href="${htmlEscape(item.source_url)}" target="_blank" rel="noopener noreferrer">${content}</a>` : `<article class="tone-${item.tone.toLowerCase()}">${content}</article>`;
  }).join('')}</div>`;
  if (!animate) {
    byId('dv2-information-loop-toggle').hidden = true;
    return;
  }
  state.informationLoops[kind] = createSeamlessLoop({
    viewport: list, track: list.firstElementChild, pauseButton: null,
    signature, speedPxPerSecond: 8, itemCount: items.length,
    active: () => state.active && !document.hidden,
    blocked: () => state.informationPaused || Boolean(document.querySelector('.dv2-chart-dialog[open]')),
  });
}

function renderInformation(message = null, options = {}) {
  renderInformationColumn('NEWS', message, options);
  renderInformationColumn('POLICY', message, options);
  const hasOverflowingColumn = ['NEWS', 'POLICY'].some((kind) => (state.information?.items || []).filter((item) => item.kind === kind).length > 3);
  const toggle = byId('dv2-information-loop-toggle');
  toggle.hidden = !hasOverflowingColumn;
  toggle.textContent = state.informationPaused ? '播放' : '暂停';
  toggle.setAttribute('aria-pressed', String(state.informationPaused));
  toggle.setAttribute('aria-label', state.informationPaused ? '播放园区资讯自动循环' : '暂停园区资讯自动循环');
}

async function refreshInformation() {
  if (!API.getPublicInformation) return;
  const cached = readInformationCache();
  const etag = state.informationEtag || cached?.etag || null;
  try {
    const result = await API.getPublicInformation(8, etag);
    if (result.status === 304) {
      if (!state.information && cached?.payload) state.information = cached.payload;
      byId('dv2-information-state').textContent = '目录已是最新';
      renderInformation();
      return;
    }
    const payload = safeEnvelopeData(result);
    if (!payload) throw Object.assign(new Error(responseError(result)), { status: result.status });
    state.information = payload;
    state.informationEtag = result.etag;
    saveInformationCache(payload, result.etag);
    byId('dv2-information-state').textContent = `更新至 ${formatSnapshotTime(payload.data_cutoff, '—')}`;
    renderInformation();
  } catch (error) {
    if (!state.information && cached?.payload) state.information = cached.payload;
    if (state.information) {
      byId('dv2-information-state').textContent = '更新失败，显示上次内容';
      renderInformation(null, { animate: false });
    } else {
      byId('dv2-information-state').textContent = error.status === 404 ? '功能正在更新' : '资讯暂不可用';
      renderInformation(error.status === 404 ? '园区资讯功能正在更新' : '园区资讯暂不可用');
      byId('dv2-information-retry').hidden = false;
    }
  }
}

function startInformationTimer() {
  window.clearInterval(state.informationTimer);
  state.informationTimer = window.setInterval(() => { if (state.active && !document.hidden) refreshInformation(); }, 300000);
}

function startShowcaseRotation() {
  window.clearInterval(state.showcaseTimer);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  state.showcaseTimer = window.setInterval(() => {
    if (!state.active || document.hidden || Date.now() < state.showcasePauseUntil || byId('dv2-algorithm-dialog')?.open) return;
    const panel = byId('dv2-showcase-content')?.closest('.dv2-showcase-panel');
    if (panel?.matches(':hover, :focus-within')) return;
    const kinds = ['CARPOOL', 'WAREHOUSE', 'PROCUREMENT', 'FORECAST'];
    state.showcasePanel = kinds[(kinds.indexOf(state.showcasePanel) + 1) % kinds.length];
    renderShowcase(state.snapshot?.algorithm_showcase);
  }, 10000);
}

function renderSnapshot(snapshot) {
  renderDatasetBadge(snapshot);
  renderHeadline(snapshot);
  renderDemandChart(snapshot);
  renderMix(snapshot);
  renderRanking(snapshot);
  renderQuality(snapshot);
  renderMap(snapshot);
  renderShowcase(snapshot.algorithm_showcase);
  renderStoredDialog();
  byId('public-sync-state').textContent = state.source === 'demo' ? '本地演示快照' : '数据同步正常';
}

async function refresh({ force = false } = {}) {
  if (state.loading && !force) return;
  const generation = ++state.refreshGeneration;
  state.loading = true;
  byId('public-sync-state').textContent = '正在同步数据';
  setSource(state.source || 'live', '连接中');
  try {
    const result = await API.getDashboardSnapshot(state.period, false);
    const snapshot = adaptDashboardSnapshot(safeEnvelopeData(result));
    if (!snapshot) throw new Error(responseError(result));
    if (generation !== state.refreshGeneration) return;
    await ensureMap(snapshot.public_map?.schema_version === '2.0' ? 'changchun' : 'legacy');
    state.snapshot = snapshot;
    state.source = snapshot.dataset_mode === 'showcase' ? 'showcase' : snapshot.demo_mode || API.isMock() ? 'demo' : 'live';
    state.lastSuccessfulAt = new Date();
    setSource(state.source, state.source === 'showcase' ? '数据正常' : state.source === 'demo' ? '演示数据' : '实时数据');
    renderSnapshot(snapshot);
  } catch (error) {
    if (state.snapshot) {
      setSource(state.source || 'error', '保留上次数据');
      byId('public-sync-state').textContent = `刷新失败，保留上次成功数据：${error.message}`;
    } else {
      try {
        state.snapshot = await loadDemoSnapshot();
        state.source = 'demo';
        setSource('demo', '离线演示');
        renderSnapshot(state.snapshot);
        byId('public-sync-state').textContent = `后端不可用，已加载本地演示快照`;
      } catch (fallbackError) {
        setSource('error', '数据不可用');
        byId('public-sync-state').textContent = fallbackError.message;
        byId('dv2-map-chart').innerHTML = `<div class="dv2-error">${htmlEscape(error.message)}<br/>${htmlEscape(fallbackError.message)}</div>`;
      }
    }
  } finally {
    state.loading = false;
  }
}

async function refreshAll() {
  await Promise.all([refresh({ force: true }), refreshInformation()]);
}

function renderAssistantChart(chartSpec, { remember = true } = {}) {
  if (!chartSpec) return;
  const kind = chartSpec.kind || chartSpec.type || 'bar';
  if (!['bar', 'line', 'donut', 'route'].includes(kind)) return;
  if (remember) state.dialogContent = { type: 'assistant', chartSpec };
  const dialog = byId('dv2-chart-dialog');
  dialog?.classList.remove('is-demand');
  const demandSummary = byId('dv2-demand-dialog-summary');
  if (demandSummary) demandSummary.hidden = true;
  byId('dv2-dialog-title').textContent = chartSpec.title;
  if (!dialog.open) dialog.showModal();
  const chart = initChart('dv2-dialog-chart');
  const palette = screenPalette();
  if (kind === 'route') {
    chart.setOption(buildNortheastMapOption(state.snapshot || {}, palette), true);
    return;
  }
  const rows = Array.isArray(chartSpec.data) ? chartSpec.data : [];
  const categories = chartSpec.categories || rows.map((row) => row[chartSpec.category_key] ?? row.name ?? '未命名');
  const valueKeys = chartSpec.value_keys || (chartSpec.value_key ? [chartSpec.value_key] : []);
  const series = chartSpec.series || valueKeys.map((key) => ({
    name: key === 'order_count' ? '订单量' : key === 'sales_amount' ? '营业额' : '数值',
    data: rows.map((row) => Number(row[key] || 0)),
  }));
  let option;
  if (kind === 'donut') {
    const values = categories.map((name, index) => ({ name, value: Number(series[0]?.data?.[index] || 0), itemStyle: { color: index === 1 ? palette.thirdSpace : palette.traditional } }));
    option = { ...donutOption(values, chartSpec.unit, palette), legend: { bottom: 24, textStyle: { color: palette.muted } } };
  } else {
    option = {
      tooltip: tooltip(palette),
      legend: { top: 18, textStyle: { color: palette.muted } },
      grid: { top: 68, right: 35, bottom: 55, left: 65 },
      xAxis: { type: 'category', data: categories, ...baseAxis(palette) },
      yAxis: { type: 'value', name: chartSpec.unit, nameTextStyle: { color: palette.muted }, ...baseAxis(palette) },
      series: series.map((item, index) => ({ name: item.name, data: item.data, type: kind, smooth: kind === 'line', itemStyle: { color: index === 0 ? palette.thirdSpace : palette.traditional }, areaStyle: kind === 'line' ? { opacity: 0.08 } : undefined })),
    };
  }
  requestAnimationFrame(() => { chart.resize(); chart.setOption(option, true); });
}

function openDemandDialog(trigger = byId('dv2-demand-open')) {
  if (!state.snapshot || !demandDisplaySummary(state.snapshot.headline?.demand_totals).all.length) return;
  const dialog = byId('dv2-chart-dialog');
  if (!dialog) return;
  state.demandDialogTrigger = trigger instanceof HTMLElement ? trigger : byId('dv2-demand-open');
  state.dialogContent = { type: 'demand' };
  byId('dv2-dialog-title').textContent = '园区需求量明细';
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => renderDemandDialog(state.snapshot));
}

function renderStoredDialog() {
  const dialog = byId('dv2-chart-dialog');
  if (!dialog?.open || !state.dialogContent) return;
  if (state.dialogContent.type === 'demand') {
    renderDemandDialog(state.snapshot || { daily_trend: [] });
    return;
  }
  renderAssistantChart(state.dialogContent.chartSpec, { remember: false });
}

function setTheme(theme) {
  state.theme = theme === 'day' ? 'day' : 'night';
  if (state.snapshot) {
    renderDemandChart(state.snapshot);
    renderMix(state.snapshot);
    renderMap(state.snapshot);
    renderShowcase(state.snapshot.algorithm_showcase);
  }
  renderStoredDialog();
}

const voiceLabels = {
  [VOICE_STATES.IDLE]: '等待提问',
  [VOICE_STATES.REQUESTING]: '申请权限',
  [VOICE_STATES.RECORDING]: '正在录音',
  [VOICE_STATES.UPLOADING]: '正在上传',
  [VOICE_STATES.TRANSCRIBING]: '正在转写',
  [VOICE_STATES.ANALYZING]: '正在分析',
  [VOICE_STATES.DONE]: '回答完成',
  [VOICE_STATES.ERROR]: '提问失败',
  [VOICE_STATES.CANCELLED]: '已取消',
};

const voice = new VoiceQuestionController({
  api: API,
  onState(next, detail) {
    byId('dv2-voice-state').textContent = voiceLabels[next] || next;
    byId('dv2-voice-hint').textContent = detail || '点击麦克风开始录音，再次点击结束。最长 30 秒。';
    const mic = byId('dv2-mic-button');
    mic.classList.toggle('recording', next === VOICE_STATES.RECORDING);
    mic.querySelector('span').textContent = next === VOICE_STATES.RECORDING ? '结束录音' : '开始提问';
    mic.setAttribute('aria-label', next === VOICE_STATES.RECORDING ? '结束语音录音' : '开始语音提问');
    mic.setAttribute('aria-pressed', String(next === VOICE_STATES.RECORDING));
    mic.disabled = [VOICE_STATES.REQUESTING, VOICE_STATES.UPLOADING, VOICE_STATES.TRANSCRIBING, VOICE_STATES.ANALYZING].includes(next);
    byId('dv2-voice-cancel').hidden = ![VOICE_STATES.REQUESTING, VOICE_STATES.RECORDING, VOICE_STATES.UPLOADING, VOICE_STATES.TRANSCRIBING, VOICE_STATES.ANALYZING].includes(next);
    byId('dv2-voice-retry').hidden = next !== VOICE_STATES.ERROR && next !== VOICE_STATES.CANCELLED;
  },
  onTranscript(question) {
    byId('dv2-assistant-input').value = question;
    const element = byId('dv2-transcript');
    element.hidden = false;
    element.textContent = `识别问题：${question}`;
  },
  onAnswer(result) {
    byId('dv2-answer').textContent = result?.answer || '已完成分析。';
    if (result?.chart) renderAssistantChart(result.chart);
  },
  onFallback() {
    byId('dv2-assistant-input')?.focus();
  },
});

function renderE01Overview(snapshot) {
  const demandChart = initChart('e01-demand-chart');
  if (demandChart) {
    const data = demandSeries(snapshot.daily_trend);
    demandChart.setOption({
      color: [COLORS.demand, COLORS.traditional, COLORS.thirdSpace, '#9d7cf4'], tooltip: tooltip(),
      legend: { top: 10, right: 15 }, grid: { top: 50, right: 25, bottom: 34, left: 55 },
      xAxis: { type: 'category', data: data.dates.map(formatDate), ...baseAxis(), axisLabel: { interval: Math.max(0, Math.floor(data.dates.length / 8) - 1) } },
      yAxis: { type: 'value', ...baseAxis() },
      series: data.series.map((item) => ({ ...item, type: 'bar', stack: 'demand', barMaxWidth: 16 })),
    }, true);
  }
  const operations = operationTrendSeries(snapshot.daily_trend);
  initChart('e01-operation-chart')?.setOption({
    color: [COLORS.traditional, COLORS.demand], tooltip: tooltip(), legend: { top: 8 }, grid: { top: 48, right: 45, bottom: 35, left: 52 },
    xAxis: { type: 'category', data: operations.dates.map(formatDate), ...baseAxis(), axisLabel: { interval: Math.max(0, Math.floor(operations.dates.length / 6) - 1) } },
    yAxis: [{ type: 'value', ...baseAxis() }, { type: 'value', ...baseAxis(), axisLabel: { formatter: (value) => `${Math.round(value / 10000)}万` } }],
    series: [{ name: '经营订单', type: 'line', smooth: true, data: operations.orders }, { name: '营业额', type: 'line', smooth: true, yAxisIndex: 1, data: operations.sales }],
  }, true);
  initChart('e01-channel-chart')?.setOption({ ...donutOption(channelValues(snapshot.channel_mix, 'sales_amount'), '营业额'), legend: { bottom: 2 } }, true);
  initChart('e01-third-space-chart')?.setOption({
    color: [COLORS.thirdSpace], tooltip: tooltip(), grid: { top: 18, right: 28, bottom: 28, left: 115 },
    xAxis: { type: 'value', ...baseAxis() }, yAxis: { type: 'category', data: [...snapshot.third_spaces].sort((a, b) => a.sales_amount - b.sales_amount).map((item) => item.store_name.replace('【演示】', '')), ...baseAxis() },
    series: [{ name: '营业额', type: 'bar', barMaxWidth: 18, data: [...snapshot.third_spaces].sort((a, b) => a.sales_amount - b.sales_amount).map((item) => item.sales_amount) }],
  }, true);
}

function renderE01Section(section, snapshot) {
  if (section === 'overview') return renderE01Overview(snapshot);
  const internal = snapshot.internal || {};
  const sectionConfig = {
    enterprise: {
      id: 'e01-enterprise-chart',
      rows: [
        { label: '渠道已分类', value: Math.max(0, snapshot.data_quality.store_count - snapshot.data_quality.missing_store_classification_count), unit: '家' },
        { label: '坐标已完整', value: Math.max(0, snapshot.data_quality.store_count - snapshot.data_quality.missing_coordinate_count), unit: '家' },
        { label: '日报覆盖率', value: snapshot.data_quality.report_coverage || 0, unit: '%' },
      ],
    },
    production: { id: 'e01-production-chart', rows: internal.capacity || [] },
    inventory: { id: 'e01-inventory-chart', rows: [...(internal.inventory_alerts || []), ...(internal.freezer || [])] },
    transport: { id: 'e01-transport-chart', rows: internal.transport || [] },
  }[section];
  if (!sectionConfig) return;
  const chart = initChart(sectionConfig.id);
  if (!chart) return;
  const rows = sectionConfig.rows;
  chart.setOption({
    color: [COLORS.traditional], tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, grid: { top: 8, right: 35, bottom: 22, left: 105 },
    xAxis: { type: 'value', ...baseAxis() }, yAxis: { type: 'category', data: rows.map((item) => item.label), ...baseAxis() },
    series: [{ type: 'bar', barMaxWidth: 16, data: rows.map((item) => ({ value: Number(item.value || 0), itemStyle: { color: /预警|异常|偏紧/.test(item.status || '') ? COLORS.demand : COLORS.traditional }, label: { show: true, position: 'right', formatter: `${item.value} ${item.unit || ''}` } })) }],
  }, true);
}

async function ensureE01Snapshot() {
  if (state.e01Snapshot) return state.e01Snapshot;
  let result = await API.getDashboardSnapshot('30d', true);
  let snapshot = adaptDashboardSnapshot(safeEnvelopeData(result));
  if (!snapshot) {
    result = await API.getDashboardSnapshot('30d', false);
    snapshot = adaptDashboardSnapshot(safeEnvelopeData(result));
  }
  if (!snapshot) snapshot = await loadDemoSnapshot();
  state.e01Snapshot = snapshot;
  return snapshot;
}

async function activateE01Section(section) {
  if (!['overview', 'enterprise', 'production', 'inventory', 'transport'].includes(section)) return;
  try {
    const snapshot = await ensureE01Snapshot();
    requestAnimationFrame(() => renderE01Section(section, snapshot));
  } catch {
    // Existing E01 tables stay available even when the chart snapshot fails.
  }
}

function activate() {
  if (state.active) return;
  state.active = true;
  state.theme = document.body.classList.contains('screen-day') ? 'day' : 'night';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    refresh();
    refreshInformation();
    chartInstances.forEach((chart) => chart.resize());
  }));
  startRealtimeEvents();
  startInformationTimer();
  startShowcaseRotation();
}

function deactivate() {
  state.active = false;
  window.clearInterval(state.informationTimer);
  state.informationTimer = null;
  state.rankingLoop?.refresh();
  refreshInformationLoops();
  window.clearInterval(state.showcaseTimer);
  state.showcaseTimer = null;
  if (voice.busy) voice.cancel('已离开 E02 大屏，本次语音提问已停止');
}

function flushRealtimeRefresh() {
  state.eventRefreshTimer = null;
  const targets = [...state.pendingEventTargets];
  state.pendingEventTargets.clear();
  state.e01Snapshot = null;
  if (state.active) refresh({ force: true });
  if (targets.includes(state.currentSection)) activateE01Section(state.currentSection);
  window.dispatchEvent(new CustomEvent('blacksoil:e01-realtime-refresh', { detail: { targets } }));
}

function queueRealtimeRefresh(targets) {
  targets.forEach((target) => state.pendingEventTargets.add(target));
  window.clearTimeout(state.eventRefreshTimer);
  state.eventRefreshTimer = window.setTimeout(flushRealtimeRefresh, 800);
}

function startRealtimeEvents() {
  if (realtimeCoordinator || typeof API.subscribeDashboardEvents !== 'function') return;
  realtimeCoordinator = new RealtimeCoordinator({
    subscribe: API.subscribeDashboardEvents,
    onEvent: (event) => {
      const declaredTargets = Array.isArray(event?.targets) ? event.targets : [];
      const targets = declaredTargets.length
        ? [
            ...(declaredTargets.includes('public-dashboard') ? ['public'] : []),
            ...(declaredTargets.includes('e01-overview') ? ['overview', 'enterprise', 'production', 'inventory', 'transport'] : []),
          ]
        : eventTargets(event.topic);
      queueRealtimeRefresh(targets);
    },
    onPoll: () => queueRealtimeRefresh(['overview', 'enterprise', 'production', 'inventory', 'transport']),
    onState: (connectionState) => {
      if (!state.active) return;
      byId('public-sync-state').textContent = connectionState === 'connected'
        ? 'SSE 实时连接正常'
        : 'SSE 已断线，当前每 30 秒轮询并尝试重连';
    },
  });
  realtimeCoordinator.start();
}

async function submitAssistantQuestion(question, sourceLabel = '文字问题') {
  const normalized = String(question || '').trim();
  if (normalized.length < 2) return;
  if (voice.busy) voice.cancel('已切换为文字提问');
  byId('dv2-voice-state').textContent = '正在分析';
  byId('dv2-voice-hint').textContent = `${sourceLabel}：${normalized}`;
  try {
    const result = await API.queryDashboardAssistant(normalized, state.period, state.snapshot?.park_id);
    const payload = safeEnvelopeData(result);
    if (!payload) {
      byId('dv2-voice-state').textContent = '提问失败';
      byId('dv2-answer').textContent = responseError(result);
      return;
    }
    byId('dv2-voice-state').textContent = '回答完成';
    byId('dv2-answer').textContent = payload.answer || '已完成分析。';
    if (payload.chart) renderAssistantChart(payload.chart);
  } catch {
    byId('dv2-voice-state').textContent = '提问失败';
    byId('dv2-answer').textContent = '网络连接失败，请检查网络后重试。';
  }
}

function bindEvents() {
  document.querySelectorAll('.dv2-periods button').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.period !== state.period && voice.busy) {
      voice.cancel('统计周期已切换，请按新周期重新录音');
    }
    state.period = button.dataset.period;
    document.querySelectorAll('.dv2-periods button').forEach((item) => item.classList.toggle('active', item === button));
    state.snapshot = null;
    refresh({ force: true });
  }));
  byId('dv2-mic-button')?.addEventListener('click', () => voice.toggle(state.period, state.snapshot?.park_id));
  byId('dv2-voice-cancel')?.addEventListener('click', () => voice.cancel());
  byId('dv2-voice-retry')?.addEventListener('click', () => voice.start(state.period, state.snapshot?.park_id));
  byId('dv2-assistant-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitAssistantQuestion(byId('dv2-assistant-input').value);
  });
  document.querySelectorAll('.dv2-examples button').forEach((button) => button.addEventListener('click', async () => {
    byId('dv2-assistant-input').value = button.dataset.example;
    await submitAssistantQuestion(button.dataset.example, '预设问题');
  }));
  document.querySelectorAll('[data-open-chart="demand"], #dv2-demand-open').forEach((button) => button.addEventListener('click', () => openDemandDialog(button)));
  byId('dv2-dialog-close')?.addEventListener('click', () => byId('dv2-chart-dialog').close());
  byId('dv2-chart-dialog')?.addEventListener('close', () => {
    const trigger = state.demandDialogTrigger;
    state.dialogContent = null;
    state.demandDialogTrigger = null;
    byId('dv2-chart-dialog')?.classList.remove('is-demand');
    const demandSummary = byId('dv2-demand-dialog-summary');
    if (demandSummary) demandSummary.hidden = true;
    state.rankingLoop?.refresh();
    refreshInformationLoops();
    trigger?.focus?.();
  });
  byId('dv2-chart-dialog')?.addEventListener('click', (event) => { if (event.target === byId('dv2-chart-dialog')) event.target.close(); });
  document.querySelectorAll('#dv2-showcase-tabs [data-kind]').forEach((button) => button.addEventListener('click', () => {
    state.showcasePanel = button.dataset.kind;
    state.showcasePauseUntil = Date.now() + 60000;
    renderShowcase(state.snapshot?.algorithm_showcase);
  }));
  byId('dv2-showcase-cases')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-case]');
    if (!button) return;
    state.showcaseCase[state.showcasePanel] = button.dataset.case;
    state.showcasePauseUntil = Date.now() + 60000;
    renderShowcase(state.snapshot?.algorithm_showcase);
  });
  byId('dv2-showcase-more')?.addEventListener('click', openShowcaseDialog);
  byId('dv2-algorithm-dialog-close')?.addEventListener('click', () => byId('dv2-algorithm-dialog').close());
  byId('dv2-algorithm-dialog')?.addEventListener('close', () => { state.rankingLoop?.refresh(); refreshInformationLoops(); });
  byId('dv2-algorithm-dialog')?.addEventListener('click', (event) => { if (event.target === byId('dv2-algorithm-dialog')) event.target.close(); });
  byId('dv2-information-loop-toggle')?.addEventListener('click', () => {
    state.informationPaused = !state.informationPaused;
    renderInformation();
    refreshInformationLoops();
  });
  byId('dv2-route-controls')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-route-key]');
    if (!button) return;
    const route = state.mapRoutePresentation?.routes?.find((item) => item.key === button.dataset.routeKey);
    selectMapRoute(route);
  });
  byId('dv2-route-scope-detail')?.addEventListener('click', () => {
    const route = state.mapRoutePresentation?.routes?.find((item) => item.key === state.mapViewport.selectedRouteKey);
    selectMapRoute(route, 'DETAIL');
  });
  byId('dv2-route-scope-full')?.addEventListener('click', () => {
    const route = state.mapRoutePresentation?.routes?.find((item) => item.key === state.mapViewport.selectedRouteKey);
    selectMapRoute(route, 'FULL');
  });
  byId('dv2-route-scope-overview')?.addEventListener('click', () => setMapViewport(overviewMapViewport(state.mapBasemap)));
  byId('dv2-map-zoom-in')?.addEventListener('click', () => setMapViewport({
    ...state.mapViewport, mode: 'MANUAL', zoom: Math.min(MAP_SCALE_LIMIT.max, state.mapViewport.zoom * 1.25),
  }));
  byId('dv2-map-zoom-out')?.addEventListener('click', () => setMapViewport({
    ...state.mapViewport, mode: 'MANUAL', zoom: Math.max(MAP_SCALE_LIMIT.min, state.mapViewport.zoom / 1.25),
  }));
  byId('dv2-map-overview')?.addEventListener('click', () => setMapViewport(overviewMapViewport(state.mapBasemap)));
  byId('dv2-information-retry')?.addEventListener('click', () => {
    byId('dv2-information-retry').hidden = true;
    refreshInformation();
  });
  let resizeFrame = null;
  const resizeCharts = () => {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      chartInstances.forEach((chart) => chart.resize());
    });
  };
  window.addEventListener('resize', resizeCharts);
  window.visualViewport?.addEventListener('resize', resizeCharts);
  document.addEventListener('fullscreenchange', resizeCharts);
  window.addEventListener('app:public-theme-change', (event) => setTheme(event.detail?.theme));
  document.addEventListener('visibilitychange', () => {
    state.rankingLoop?.refresh();
    refreshInformationLoops();
    if (document.hidden) {
      if (voice.busy) voice.cancel('页面已隐藏，本次语音提问已停止');
      return;
    }
    if (state.active) refreshInformation();
    queueRealtimeRefresh(['overview', 'enterprise', 'production', 'inventory', 'transport']);
    startRealtimeEvents();
  });
  window.addEventListener('app:section-change', (event) => {
    const section = event.detail?.section;
    state.currentSection = section || 'overview';
    if (section === 'public') activate();
    else {
      deactivate();
      activateE01Section(section);
    }
  });
}

async function initializeDashboard() {
  try {
    const result = await (API.getPublicDictionaries?.() || API.getDictionaries?.());
    const dictionaries = safeEnvelopeData(result);
    if (dictionaries) {
      applyDashboardDictionaries(dictionaries);
      applyDashboardMapDictionaries(dictionaries);
    }
  } catch {
    // 内置中文词典继续提供确定性显示。
  }
  bindEvents();
  setTheme(document.body.classList.contains('screen-day') ? 'day' : 'night');
  startRealtimeEvents();
  activateE01Section('overview');
  if (document.body.classList.contains('screen-mode')) activate();
}

if (!echarts) {
  byId('public-sync-state').textContent = '本地 ECharts 资源未加载';
} else {
  initializeDashboard();
}

window.DashboardV2 = {
  activate,
  deactivate,
  refresh,
  refreshAll,
  setTheme,
  refreshE01(section = state.currentSection) {
    state.e01Snapshot = null;
    return activateE01Section(section);
  },
  getState: () => ({ ...state }),
};
