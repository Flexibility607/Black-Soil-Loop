import {
  CHANNEL_LABELS,
  COLORS,
  channelValues,
  demandSeries,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  operationTrendSeries,
  responseError,
  safeEnvelopeData,
  sortDemandTotals,
} from './dashboard-format.js';
import { buildNortheastMapOption, harbinIsNorthOfChangchun, localGeoJsonIsNortheast } from './dashboard-map.js';
import { VOICE_STATES, VoiceQuestionController } from './dashboard-voice.js';
import { adaptDashboardSnapshot } from './dashboard-adapter.js';

const echarts = window.echarts;
const API = window.API;
const REFRESH_INTERVAL_MS = 30_000;
const DEMO_FIXTURE = './frontend-mocks-v0.1/e02-dashboard-snapshot.json';
const MAP_FIXTURE = './assets/maps/northeast-china-admin1.geojson';
const chartInstances = new Map();
const state = {
  active: false,
  loading: false,
  period: '30d',
  snapshot: null,
  source: null,
  lastSuccessfulAt: null,
  mapReady: false,
  e01Snapshot: null,
  eventController: null,
  eventRefreshTimer: null,
};

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
    chart = echarts.init(element, null, { renderer: 'canvas' });
    chartInstances.set(id, chart);
  }
  return chart;
}

function baseAxis() {
  return {
    axisLine: { lineStyle: { color: 'rgba(105, 184, 219, .28)' } },
    axisLabel: { color: COLORS.muted, fontSize: 10 },
    splitLine: { lineStyle: { color: COLORS.grid } },
  };
}

function tooltip() {
  return {
    trigger: 'axis',
    backgroundColor: 'rgba(8, 31, 55, .96)',
    borderColor: COLORS.traditional,
    textStyle: { color: COLORS.text, fontSize: 11 },
  };
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

async function ensureMap() {
  if (state.mapReady) return;
  const response = await fetch(MAP_FIXTURE, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`本地地图资源加载失败（HTTP ${response.status}）`);
  const geojson = await response.json();
  if (!localGeoJsonIsNortheast(geojson) || !harbinIsNorthOfChangchun()) throw new Error('东北三省地图坐标校验失败');
  echarts.registerMap('northeast-admin1', geojson);
  state.mapReady = true;
}

function setSource(source, message) {
  const sourceEl = byId('dv2-source-state');
  const demoBadge = byId('dv2-demo-badge');
  if (sourceEl) {
    sourceEl.className = `dv2-source ${source === 'demo' ? 'demo' : source === 'error' ? 'error' : 'live'}`;
    sourceEl.textContent = message;
  }
  if (demoBadge) demoBadge.hidden = source !== 'demo';
}

function renderHeadline(snapshot) {
  byId('dv2-park-name').textContent = snapshot.park_name || '园区未选择';
  byId('dv2-preorder-count').textContent = formatNumber(snapshot.headline.preorder_count);
  byId('dv2-operation-orders').textContent = formatNumber(snapshot.headline.operation_order_count);
  byId('dv2-sales-amount').textContent = formatCurrency(snapshot.headline.sales_amount);
  byId('dv2-third-space-count').textContent = formatNumber(snapshot.third_spaces.length);
  const totals = sortDemandTotals(snapshot.headline.demand_totals);
  byId('dv2-demand-totals').innerHTML = totals.length
    ? totals.map((item) => `<b>${htmlEscape(formatNumber(item.quantity, 2))} ${htmlEscape(item.unit)}</b>`).join('')
    : '<b>暂无需求</b>';
  byId('public-data-cutoff').textContent = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(snapshot.data_cutoff));
}

function renderDemandChart(snapshot, target = 'dv2-demand-chart') {
  const chart = initChart(target);
  if (!chart) return;
  const data = demandSeries(snapshot.daily_trend);
  chart.setOption({
    animationDuration: 350,
    color: [COLORS.demand, COLORS.traditional, COLORS.thirdSpace, '#b18bff'],
    tooltip: tooltip(),
    legend: { top: 5, right: 8, textStyle: { color: COLORS.muted, fontSize: 10 } },
    grid: { top: 40, right: 18, bottom: 28, left: 45 },
    xAxis: { type: 'category', data: data.dates.map(formatDate), boundaryGap: false, ...baseAxis(), axisLabel: { color: COLORS.muted, fontSize: 9, interval: Math.max(0, Math.floor(data.dates.length / 6) - 1) } },
    yAxis: { type: 'value', ...baseAxis(), name: '按单位', nameTextStyle: { color: COLORS.muted, fontSize: 9 } },
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

function donutOption(values, centerLabel) {
  const total = values.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return {
    animationDuration: 350,
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} · {d}%', backgroundColor: 'rgba(8, 31, 55, .96)', borderColor: COLORS.traditional, textStyle: { color: COLORS.text } },
    title: { text: total ? formatNumber(total) : '0', subtext: centerLabel, left: 'center', top: '37%', textStyle: { color: COLORS.text, fontFamily: 'JetBrains Mono Variable', fontSize: 18 }, subtextStyle: { color: COLORS.muted, fontSize: 10 } },
    series: [{
      type: 'pie', radius: ['57%', '77%'], center: ['50%', '48%'], startAngle: 90,
      label: { show: false }, emphasis: { scale: true, scaleSize: 5 },
      itemStyle: { borderColor: '#0b263e', borderWidth: 2 },
      data: values,
    }],
  };
}

function renderMix(snapshot) {
  initChart('dv2-order-donut')?.setOption(donutOption(channelValues(snapshot.channel_mix, 'operation_order_count'), '订单'), true);
  initChart('dv2-sales-donut')?.setOption(donutOption(channelValues(snapshot.channel_mix, 'sales_amount'), '营业额'), true);
  byId('dv2-mix-legend').innerHTML = snapshot.channel_mix.map((item) => {
    const color = item.channel_type === 'THIRD_SPACE' ? COLORS.thirdSpace : COLORS.traditional;
    return `<div style="--legend-color:${color}"><strong>${htmlEscape(item.display_name)}</strong><small>订单 ${htmlEscape(formatPercent(item.operation_order_share))} · 营业额 ${htmlEscape(formatPercent(item.sales_share))}</small></div>`;
  }).join('');
}

function renderRanking(snapshot) {
  const rows = [...snapshot.third_spaces].sort((a, b) => Number(b.sales_amount) - Number(a.sales_amount));
  const max = Math.max(...rows.map((item) => Number(item.sales_amount || 0)), 1);
  byId('dv2-third-space-list').innerHTML = rows.length ? rows.slice(0, 4).map((item, index) => `
    <div class="dv2-rank-item">
      <b>${index + 1}</b>
      <div><strong>${htmlEscape(item.store_name)}</strong><small>${htmlEscape(item.city || '城市待补充')} · 最近上报 ${htmlEscape(item.last_report_date || '缺报')}</small><div class="dv2-rank-bar"><i style="width:${Math.max(4, Number(item.sales_amount || 0) / max * 100).toFixed(1)}%"></i></div></div>
      <span class="dv2-rank-value"><b>${htmlEscape(formatCurrency(item.sales_amount))}</b><small>${htmlEscape(formatNumber(item.operation_order_count))} 笔</small></span>
    </div>`).join('') : '<div class="dv2-empty">暂无第三空间经营数据</div>';
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

function renderMap(snapshot) {
  const chart = initChart('dv2-map-chart');
  if (!chart) return;
  chart.setOption(buildNortheastMapOption(snapshot), true);
}

function renderSnapshot(snapshot) {
  renderHeadline(snapshot);
  renderDemandChart(snapshot);
  renderMix(snapshot);
  renderRanking(snapshot);
  renderQuality(snapshot);
  renderMap(snapshot);
  byId('public-sync-state').textContent = state.source === 'demo' ? '本地演示快照' : '数据同步正常';
}

async function refresh({ force = false } = {}) {
  if (state.loading && !force) return;
  state.loading = true;
  byId('public-sync-state').textContent = '正在同步数据';
  setSource(state.source || 'live', '连接中');
  try {
    await ensureMap();
    const result = await API.getDashboardSnapshot(state.period, false);
    const snapshot = adaptDashboardSnapshot(safeEnvelopeData(result));
    if (!snapshot) throw new Error(responseError(result));
    state.snapshot = snapshot;
    state.source = snapshot.demo_mode || API.isMock() ? 'demo' : 'live';
    state.lastSuccessfulAt = new Date();
    setSource(state.source, state.source === 'demo' ? '演示数据' : '实时数据');
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

function renderAssistantChart(chartSpec) {
  if (!chartSpec) return;
  const dialog = byId('dv2-chart-dialog');
  byId('dv2-dialog-title').textContent = chartSpec.title;
  if (!dialog.open) dialog.showModal();
  const chart = initChart('dv2-dialog-chart');
  if (chartSpec.type === 'route' || chartSpec.kind === 'route') {
    chart.setOption(buildNortheastMapOption(state.snapshot || {}), true);
    return;
  }
  const kind = chartSpec.kind || chartSpec.type || 'bar';
  const rows = Array.isArray(chartSpec.data) ? chartSpec.data : [];
  const categories = chartSpec.categories || rows.map((row) => row[chartSpec.category_key] ?? row.name ?? '未命名');
  const valueKeys = chartSpec.value_keys || (chartSpec.value_key ? [chartSpec.value_key] : []);
  const series = chartSpec.series || valueKeys.map((key) => ({
    name: key === 'order_count' ? '订单量' : key === 'sales_amount' ? '营业额' : '数值',
    data: rows.map((row) => Number(row[key] || 0)),
  }));
  let option;
  if (kind === 'donut') {
    const values = categories.map((name, index) => ({ name, value: Number(series[0]?.data?.[index] || 0), itemStyle: { color: index === 1 ? COLORS.thirdSpace : COLORS.traditional } }));
    option = { ...donutOption(values, chartSpec.unit), legend: { bottom: 24, textStyle: { color: COLORS.muted } } };
  } else {
    option = {
      tooltip: tooltip(),
      legend: { top: 18, textStyle: { color: COLORS.muted } },
      grid: { top: 68, right: 35, bottom: 55, left: 65 },
      xAxis: { type: 'category', data: categories, ...baseAxis() },
      yAxis: { type: 'value', name: chartSpec.unit, nameTextStyle: { color: COLORS.muted }, ...baseAxis() },
      series: series.map((item, index) => ({ name: item.name, data: item.data, type: kind, smooth: kind === 'line', itemStyle: { color: index === 0 ? COLORS.thirdSpace : COLORS.traditional }, areaStyle: kind === 'line' ? { opacity: 0.08 } : undefined })),
    };
  }
  requestAnimationFrame(() => { chart.resize(); chart.setOption(option, true); });
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
    byId('dv2-voice-cancel').hidden = ![VOICE_STATES.REQUESTING, VOICE_STATES.RECORDING, VOICE_STATES.UPLOADING, VOICE_STATES.TRANSCRIBING, VOICE_STATES.ANALYZING].includes(next);
    byId('dv2-voice-retry').hidden = next !== VOICE_STATES.ERROR && next !== VOICE_STATES.CANCELLED;
  },
  onTranscript(question) {
    const element = byId('dv2-transcript');
    element.hidden = false;
    element.textContent = `识别问题：${question}`;
  },
  onAnswer(result) {
    byId('dv2-answer').textContent = result?.answer || '已完成分析。';
    if (result?.chart) renderAssistantChart(result.chart);
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
  state.active = true;
  refresh();
  startRealtimeEvents();
  requestAnimationFrame(() => chartInstances.forEach((chart) => chart.resize()));
}

function deactivate() {
  state.active = false;
  state.eventController?.abort();
  state.eventController = null;
}

function startRealtimeEvents() {
  if (state.eventController || typeof API.subscribeDashboardEvents !== 'function') return;
  const controller = new AbortController();
  state.eventController = controller;
  API.subscribeDashboardEvents(() => {
    if (!state.active || document.hidden) return;
    window.clearTimeout(state.eventRefreshTimer);
    state.eventRefreshTimer = window.setTimeout(() => {
      state.e01Snapshot = null;
      refresh({ force: true });
    }, 800);
  }, controller.signal).catch(() => {
    if (controller.signal.aborted) return;
    state.eventController = null;
    byId('public-sync-state').textContent = '实时连接已降级，每 30 秒轮询';
  });
}

function bindEvents() {
  document.querySelectorAll('.dv2-periods button').forEach((button) => button.addEventListener('click', () => {
    state.period = button.dataset.period;
    document.querySelectorAll('.dv2-periods button').forEach((item) => item.classList.toggle('active', item === button));
    state.snapshot = null;
    refresh({ force: true });
  }));
  byId('dv2-mic-button')?.addEventListener('click', () => voice.toggle(state.period, state.snapshot?.park_id));
  byId('dv2-voice-cancel')?.addEventListener('click', () => voice.cancel());
  byId('dv2-voice-retry')?.addEventListener('click', () => voice.start(state.period, state.snapshot?.park_id));
  document.querySelectorAll('.dv2-examples button').forEach((button) => button.addEventListener('click', async () => {
    byId('dv2-voice-state').textContent = '正在分析';
    byId('dv2-voice-hint').textContent = `预设问题：${button.dataset.example}`;
    const result = await API.queryDashboardAssistant(button.dataset.example, state.period, state.snapshot?.park_id);
    const payload = safeEnvelopeData(result);
    if (!payload) {
      byId('dv2-voice-state').textContent = '提问失败';
      byId('dv2-answer').textContent = responseError(result);
      return;
    }
    byId('dv2-voice-state').textContent = '回答完成';
    byId('dv2-answer').textContent = payload.answer || '已完成分析。';
    if (payload.chart) renderAssistantChart(payload.chart);
  }));
  document.querySelector('[data-open-chart="demand"]')?.addEventListener('click', () => {
    if (!state.snapshot) return;
    const dialog = byId('dv2-chart-dialog');
    byId('dv2-dialog-title').textContent = '每日分单位需求';
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => renderDemandChart(state.snapshot, 'dv2-dialog-chart'));
  });
  byId('dv2-dialog-close')?.addEventListener('click', () => byId('dv2-chart-dialog').close());
  byId('dv2-chart-dialog')?.addEventListener('click', (event) => { if (event.target === byId('dv2-chart-dialog')) event.target.close(); });
  window.addEventListener('resize', () => chartInstances.forEach((chart) => chart.resize()));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    state.e01Snapshot = null;
    if (state.active) {
      refresh({ force: true });
      startRealtimeEvents();
    }
  });
  window.addEventListener('app:section-change', (event) => {
    const section = event.detail?.section;
    if (section === 'public') activate();
    else {
      deactivate();
      activateE01Section(section);
    }
  });
}

if (!echarts) {
  byId('public-sync-state').textContent = '本地 ECharts 资源未加载';
} else {
  bindEvents();
  activateE01Section('overview');
  if (document.body.classList.contains('screen-mode')) activate();
  window.setInterval(() => { if (state.active) refresh(); }, REFRESH_INTERVAL_MS);
}

window.DashboardV2 = { activate, deactivate, refresh, getState: () => ({ ...state }) };
