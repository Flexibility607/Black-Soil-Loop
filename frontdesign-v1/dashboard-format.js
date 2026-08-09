export const CHANNEL_LABELS = {
  TRADITIONAL_STORE: '传统门店',
  THIRD_SPACE: '第三空间',
};

export const COLORS = Object.freeze({
  traditional: '#55c8ff',
  thirdSpace: '#51df84',
  demand: '#f6bd4d',
  text: '#eaf8ff',
  muted: '#83aabd',
  grid: 'rgba(102, 191, 230, 0.12)',
});

export const SCREEN_PALETTES = Object.freeze({
  night: Object.freeze({
    ...COLORS,
    axis: 'rgba(105, 184, 219, 0.28)',
    tooltipBackground: 'rgba(8, 31, 55, 0.96)',
    tooltipBorder: COLORS.traditional,
    pieBorder: '#0b263e',
    alternate: '#b18bff',
    danger: '#ff6b68',
    mapLabel: '#9ad8ec',
    mapArea: 'rgba(17, 66, 105, 0.66)',
    mapBorder: '#5acbff',
    mapShadow: 'rgba(39, 177, 232, 0.35)',
    mapEmphasis: 'rgba(31, 103, 143, 0.82)',
    mapEffect: '#d9fbff',
    mapTextBorder: '#071a2d',
    mapReference: '#799dad',
  }),
  day: Object.freeze({
    traditional: '#1677b8',
    thirdSpace: '#168553',
    demand: '#a56a08',
    text: '#17324a',
    muted: '#56778e',
    grid: 'rgba(52, 124, 164, 0.14)',
    axis: 'rgba(35, 107, 149, 0.25)',
    tooltipBackground: 'rgba(255, 255, 255, 0.97)',
    tooltipBorder: '#1677b8',
    pieBorder: '#edf6fb',
    alternate: '#7651b9',
    danger: '#c43d3b',
    mapLabel: '#245a78',
    mapArea: 'rgba(155, 205, 230, 0.5)',
    mapBorder: '#2b85b8',
    mapShadow: 'rgba(46, 125, 166, 0.22)',
    mapEmphasis: 'rgba(121, 185, 217, 0.65)',
    mapEffect: '#eefaff',
    mapTextBorder: '#f6fbfe',
    mapReference: '#55788d',
  }),
});

export function dashboardPalette(theme = 'night') {
  return SCREEN_PALETTES[theme] || SCREEN_PALETTES.night;
}

export function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(number);
}

export function formatCurrency(value, compact = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (compact && Math.abs(number) >= 10000) return `¥${(number / 10000).toFixed(2)}万`;
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(number);
}

export function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '暂无占比';
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '—');
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date).replaceAll('/', '-');
}

export function sortDemandTotals(items = []) {
  return [...items]
    .filter((item) => item && item.unit)
    .sort((a, b) => String(a.unit).localeCompare(String(b.unit), 'zh-CN'));
}

export function demandSeries(dailyTrend = []) {
  const dates = [...new Set(dailyTrend.map((item) => String(item.date)))].sort();
  const units = [...new Set(dailyTrend.flatMap((item) => (item.demand_totals || []).map((total) => total.unit)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const values = new Map();
  for (const row of dailyTrend) {
    for (const item of row.demand_totals || []) {
      const key = `${row.date}\u0000${item.unit}`;
      values.set(key, (values.get(key) || 0) + Number(item.quantity || 0));
    }
  }
  return {
    dates,
    series: units.map((unit) => ({ name: unit, data: dates.map((date) => values.get(`${date}\u0000${unit}`) || 0) })),
  };
}

export function operationTrendSeries(dailyTrend = []) {
  const dates = [...new Set(dailyTrend.map((item) => String(item.date)))].sort();
  const orders = new Map(dates.map((date) => [date, 0]));
  const sales = new Map(dates.map((date) => [date, 0]));
  for (const row of dailyTrend) {
    orders.set(String(row.date), (orders.get(String(row.date)) || 0) + Number(row.operation_order_count || 0));
    sales.set(String(row.date), (sales.get(String(row.date)) || 0) + Number(row.sales_amount || 0));
  }
  return {
    dates,
    orders: dates.map((date) => orders.get(date)),
    sales: dates.map((date) => sales.get(date)),
  };
}

export function channelValues(channelMix = [], field, palette = COLORS) {
  const byType = new Map(channelMix.map((item) => [item.channel_type, Number(item[field] || 0)]));
  return [
    { name: CHANNEL_LABELS.TRADITIONAL_STORE, value: byType.get('TRADITIONAL_STORE') || 0, itemStyle: { color: palette.traditional } },
    { name: CHANNEL_LABELS.THIRD_SPACE, value: byType.get('THIRD_SPACE') || 0, itemStyle: { color: palette.thirdSpace } },
  ];
}

export function safeEnvelopeData(result) {
  return result && result.ok && result.json && result.json.data ? result.json.data : null;
}

export function responseError(result) {
  const body = result?.json;
  const detail = body?.detail;
  const first = body?.errors?.[0];
  return first?.message || detail?.message || detail || body?.message || `请求失败（HTTP ${result?.status || '未知'}）`;
}
