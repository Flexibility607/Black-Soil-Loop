(function () {
  const runtime = window.BLACKSOIL_CONFIG || {};
  const productionHost = /(^|\.)flexibility607\.cn$/i.test(window.location.hostname);
  const demoMode = runtime.demo === true;
  const baseUrl = demoMode
    ? (runtime.apiBase || '/api/v1')
    : productionHost ? 'https://api.flexibility607.cn/api/v1' : (runtime.apiBase || '/api/v1');
  const demoSnapshotUrl = './frontend-mocks-v0.1/e02-dashboard-snapshot.json';
  const authListeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('blacksoil-auth-v1') : null;
  let accessToken = null;
  let csrfToken = null;
  let currentUser = null;
  let idleTimeoutMs = 30 * 60 * 1000;
  let idleTimer = null;
  let refreshing = null;
  const recentDashboardEventIds = new Set();

  const ROUTES = {
    enterprises: '/web/master-data/enterprises',
    stores: '/web/master-data/stores',
    products: '/web/master-data/products',
    vehicles: '/web/master-data/vehicles',
    warehouses: '/web/master-data/warehouses',
    suppliers: '/web/master-data/suppliers',
    'transport-orders': '/web/transport/orders',
    'transport-plans': '/web/transport/plans',
    'transport-tasks': '/web/transport/tasks',
    alerts: '/web/alerts',
    'telemetry-issues': '/web/telemetry-issues',
    receipts: '/web/receipts',
    'inventory-movements': '/web/inventory-movements',
    'stockout-demands': '/web/stockout-demands',
    'store-daily-reports': '/web/store-daily-reports',
    'procurement-aggregations': '/web/procurement/aggregations',
  };

  function response(ok, status, json, headers = null) {
    return { ok, status, json, headers };
  }

  async function readJson(res) {
    return res.json().catch(() => null);
  }

  function withData(result, data) {
    if (!result?.json) return result;
    return { ...result, json: { ...result.json, data } };
  }

  function emitAuth(reason) {
    const detail = { user: currentUser, reason };
    authListeners.forEach((listener) => listener(detail));
    window.dispatchEvent(new CustomEvent('blacksoil:auth', { detail }));
  }

  function clearIdleTimer() {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdleTimer() {
    clearIdleTimer();
    if (!currentUser) return;
    idleTimer = window.setTimeout(() => {
      clearSession('idle_timeout', true);
    }, idleTimeoutMs);
  }

  function touchActivity() {
    if (currentUser) armIdleTimer();
  }

  function saveSession(payload, reason = 'authenticated', broadcast = true) {
    if (!payload) return;
    accessToken = payload.access_token || accessToken;
    csrfToken = payload.csrf_token || csrfToken;
    currentUser = payload.user || currentUser;
    idleTimeoutMs = Math.max(60_000, Number(payload.idle_timeout_seconds || 1800) * 1000);
    armIdleTimer();
    emitAuth(reason);
    if (broadcast && channel) {
      channel.postMessage({
        type: 'session',
        accessToken,
        csrfToken,
        user: currentUser,
        idleTimeoutMs,
      });
    }
  }

  function clearSession(reason = 'logged_out', broadcast = true) {
    accessToken = null;
    csrfToken = null;
    currentUser = null;
    clearIdleTimer();
    emitAuth(reason);
    if (broadcast && channel) channel.postMessage({ type: 'logout', reason });
  }

  if (channel) {
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'logout') clearSession(event.data.reason || 'remote_logout', false);
      if (event.data?.type === 'session') {
        accessToken = event.data.accessToken || null;
        csrfToken = event.data.csrfToken || null;
        currentUser = event.data.user || null;
        idleTimeoutMs = event.data.idleTimeoutMs || idleTimeoutMs;
        armIdleTimer();
        emitAuth('remote_session');
      }
    });
  }

  async function rawRequest(path, options = {}, retryOn401 = true) {
    if (demoMode) {
      return response(false, 503, {
        code: 'DEMO_API_DISABLED',
        message: '本地演示不会访问服务器 API。',
      });
    }
    const {
      authPolicy = 'auto',
      credentialsPolicy = 'include',
      ...fetchOptions
    } = options;
    const headers = new Headers(fetchOptions.headers || {});
    const hasFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
    if (fetchOptions.body && !hasFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (authPolicy === 'required' && !accessToken) {
      return response(false, 401, { code: 'NOT_AUTHENTICATED', message: '请先登录后再执行此操作' });
    }
    if (authPolicy !== 'omit' && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (path === '/web/auth/refresh' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const res = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      headers,
      credentials: credentialsPolicy,
      cache: fetchOptions.cache || 'no-store',
    });
    const result = response(res.ok, res.status, await readJson(res), res.headers);
    if (res.status === 401 && authPolicy !== 'omit' && retryOn401 && path !== '/web/auth/refresh' && await refreshAccessToken()) {
      return rawRequest(path, options, false);
    }
    if (res.status === 401 && authPolicy !== 'omit' && !retryOn401) clearSession('unauthorized');
    return result;
  }

  async function refreshAccessToken() {
    if (demoMode) return false;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const result = await rawRequest('/web/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: null }),
      }, false);
      if (!result.ok) {
        clearSession('refresh_failed');
        return false;
      }
      saveSession(result.json, 'refreshed');
      return true;
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = null;
    }
  }

  async function request(path, options = {}, retryOn401 = true) {
    return rawRequest(path, options, retryOn401);
  }

  async function login(username, password) {
    if (demoMode) {
      saveSession({ user: { id: 'demo', username: '演示管理员', display_name: '演示管理员', role: 'park_admin' } });
      return response(true, 200, { data: currentUser });
    }
    const result = await rawRequest('/web/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }, false);
    if (result.ok) saveSession(result.json, 'login');
    return withData(result, result.json?.user);
  }

  async function getCurrentUser() {
    if (demoMode && currentUser) return response(true, 200, { data: currentUser });
    if (!accessToken && !await refreshAccessToken()) return response(false, 401, { code: 'NOT_AUTHENTICATED', message: '登录会话不存在或已过期' });
    const result = await rawRequest('/web/auth/me');
    if (result.ok) saveSession({ ...result.json, user: result.json.user }, 'me');
    return withData(result, result.json?.user);
  }

  async function logout() {
    if (accessToken && !demoMode) await rawRequest('/web/auth/logout', { method: 'POST', body: '{}' }, false);
    clearSession('logout');
    return response(true, 200, { data: { logged_out: true } });
  }

  async function list(resource, params = {}) {
    const route = ROUTES[resource];
    if (!route) return response(false, 404, { code: 'RESOURCE_NOT_SUPPORTED', message: '该资源尚未接入新服务器', details: { resource } });
    const query = new URLSearchParams({ page: '1', page_size: '20', ...params });
    const result = await rawRequest(`${route}?${query}`);
    return withData(result, result.json ? {
      items: result.json.items || [],
      page: result.json.page || 1,
      page_size: result.json.page_size || 20,
      total: result.json.total || 0,
    } : null);
  }

  function overviewFromSnapshot(snapshot) {
    const summary = snapshot?.summary || {};
    const charts = snapshot?.charts || {};
    return {
      enterprise_count: summary.enterprise_count,
      production_plan_count: (charts.demand_by_enterprise || []).length,
      inventory_record_count: (charts.inventory_by_product || []).length,
      preorder_count: summary.preorder_count,
      transport_task_count: summary.active_transport_count,
      freezer_count: (charts.warehouse_capacity || []).length,
      expected_order_quantity: summary.preorder_count,
      committed_order_quantity: summary.preorder_count,
      sales_amount_total: summary.total_sales_amount,
      inventory_alert_count: summary.low_stock_count,
      details: charts.demand_by_enterprise || [],
    };
  }

  async function getDashboard(path) {
    if (path !== 'overview') return response(false, 404, { code: 'DASHBOARD_VIEW_NOT_FOUND', message: '看板视图不存在' });
    const result = await rawRequest('/web/dashboard/snapshot');
    return withData(result, overviewFromSnapshot(result.json));
  }

  async function getDashboardSnapshot(period = '30d', authenticated = false) {
    if (demoMode) {
      const res = await fetch(demoSnapshotUrl, { cache: 'no-store' });
      return response(res.ok, res.status, await readJson(res));
    }
    const route = authenticated ? '/web/dashboard/snapshot' : '/public/dashboard/snapshot';
    const result = await rawRequest(`${route}?${new URLSearchParams({ period })}`, authenticated
      ? { authPolicy: 'required' }
      : { authPolicy: 'omit', credentialsPolicy: 'omit' });
    return withData(result, result.json);
  }

  async function getOperationsSummary(period = '30d') {
    const result = await rawRequest(`/web/operations/summary?${new URLSearchParams({ period })}`);
    return withData(result, result.json);
  }

  async function getDictionaries() {
    const route = accessToken ? '/web/dictionaries' : '/public/dictionaries';
    const result = await rawRequest(route, accessToken
      ? { authPolicy: 'required' }
      : { authPolicy: 'omit', credentialsPolicy: 'omit' });
    return withData(result, result.json?.dictionaries);
  }

  async function getPublicDictionaries() {
    const result = await rawRequest('/public/dictionaries', {
      authPolicy: 'omit',
      credentialsPolicy: 'omit',
    });
    return withData(result, result.json?.dictionaries);
  }

  async function getPublicInformation(limit = 8, etag = null) {
    if (demoMode) {
      const [newsResponse, policyResponse] = await Promise.all([
        fetch('./frontend-mocks-v0.1/e02-public-news-changchun.json', { cache: 'no-store' }),
        fetch('./frontend-mocks-v0.1/e02-public-policies-changchun.json', { cache: 'no-store' }),
      ]);
      const newsEnvelope = await readJson(newsResponse);
      const policyEnvelope = await readJson(policyResponse);
      if (!newsResponse.ok || !policyResponse.ok) return { ok: false, status: 503, data: null, etag: null };
      const toneMap = { blue: 'INFO', green: 'SUCCESS', amber: 'WARNING', red: 'ALERT' };
      const now = '2026-08-13T10:20:00+08:00';
      const news = (newsEnvelope?.data || []).slice(0, 4).map((item, index) => ({
        slug: `demo-news-${index + 1}`, kind: 'NEWS', kind_label: '园区动态', category: item.category,
        title: item.title,
        summary: String(item.summary || '').replaceAll('current_qty', '当前库存'),
        published_at: now,
        source_type: 'INTERNAL_RELEASE',
        source_name: '吉品食品产业协同园区', source_url: null, source_verified_at: now,
        service_scope: '长春市及市郊', tone: toneMap[item.tone] || 'INFO',
      }));
      const policies = (policyEnvelope?.data || []).slice(0, 4).map((item, index) => ({
        slug: `demo-policy-${index + 1}`, kind: 'POLICY', kind_label: '政策资讯', category: item.category,
        title: item.title, summary: item.summary, published_at: item.published_at || now,
        source_type: 'GOVERNMENT_POLICY', source_name: item.source_name, source_url: item.source_url,
        source_verified_at: now, service_scope: '长春市及市郊', tone: index === 0 ? 'WARNING' : 'INFO',
      }));
      const data = {
        items: [...news, ...policies], total: 8, kind: 'all', catalog_version: '2026-08-13.1-demo',
        service_scope: '长春市及市郊', data_cutoff: now,
      };
      return {
        ...response(true, 200, { status: 'PROCESSED', code: 'OK', data }),
        etag: '"demo-public-information-20260813"',
      };
    }
    const headers = etag ? { 'If-None-Match': etag } : undefined;
    const result = await rawRequest(`/public/dashboard/information?${new URLSearchParams({ kind: 'all', limit: String(limit) })}`, {
      headers,
      authPolicy: 'omit',
      credentialsPolicy: 'omit',
    });
    return { ...withData(result, result.json), etag: result.headers?.get?.('etag') || null };
  }

  async function demoAssistantAnswer(question, period) {
    try {
      const result = await fetch(demoSnapshotUrl, { cache: 'no-store' });
      const envelope = await readJson(result);
      const snapshot = envelope?.data;
      if (!result.ok || !snapshot) throw new Error('fixture unavailable');
      const normalized = String(question || '').trim();
      const common = {
        mode: 'demo_deterministic',
        period,
        period_start: snapshot.range_start || null,
        period_end: snapshot.range_end || null,
        data_cutoff: snapshot.data_cutoff || envelope.data_cutoff || null,
        generated_at: new Date().toISOString(),
        allowed_chart_types: ['bar', 'line', 'donut', 'route'],
        chart_fallback_reason: null,
      };
      const channelMix = Array.isArray(snapshot.channel_mix) ? snapshot.channel_mix : [];
      const thirdSpace = channelMix.find((item) => item.channel_type === 'THIRD_SPACE');
      if (/第三空间/.test(normalized) && /(占比|营业额)/.test(normalized)) {
        return response(true, 200, { data: {
          ...common,
          intent: 'CHANNEL',
          unit: '人民币',
          answer: `演示数据中，第三空间营业额为 ${Number(thirdSpace?.sales_amount || 0).toLocaleString('zh-CN')} 元，占园区营业额 ${Number(thirdSpace?.sales_share || 0).toFixed(2)}%。`,
          chart: {
            kind: 'donut',
            title: '演示渠道营业额构成',
            unit: '人民币',
            categories: channelMix.map((item) => item.display_name),
            series: [{ name: '营业额', data: channelMix.map((item) => Number(item.sales_amount || 0)) }],
          },
        } });
      }
      if (/排行/.test(normalized)) {
        const stores = [...(snapshot.third_spaces || [])].sort((left, right) => Number(right.sales_amount || 0) - Number(left.sales_amount || 0));
        return response(true, 200, { data: {
          ...common,
          intent: 'OPERATIONS',
          unit: '人民币',
          answer: `演示数据中，第三空间营业额最高的是 ${stores[0]?.store_name || '暂无门店'}。`,
          chart: {
            kind: 'bar',
            title: '演示第三空间营业额排行',
            unit: '人民币',
            categories: stores.map((item) => item.store_name),
            series: [{ name: '营业额', data: stores.map((item) => Number(item.sales_amount || 0)) }],
          },
        } });
      }
      if (/需求|趋势/.test(normalized)) {
        const totals = new Map();
        for (const row of snapshot.daily_trend || []) {
          const kg = row.demand_totals?.find((item) => item.unit === 'kg')?.quantity || 0;
          totals.set(row.date, Number(totals.get(row.date) || 0) + Number(kg));
        }
        const dates = [...totals.keys()].sort();
        return response(true, 200, { data: {
          ...common,
          intent: 'OVERVIEW',
          unit: '公斤',
          answer: `演示数据包含 ${dates.length} 个自然日的需求趋势，请查看折线图。`,
          chart: {
            kind: 'line',
            title: '演示每日需求趋势',
            unit: '公斤',
            categories: dates,
            series: [{ name: '需求量', data: dates.map((date) => Number(totals.get(date) || 0)) }],
          },
        } });
      }
      const demandTotals = snapshot.headline?.demand_totals || [];
      return response(true, 200, { data: {
        ...common,
        intent: 'OVERVIEW',
        unit: '按商品单位拆分',
        answer: `当前为本地演示数据：预订单 ${Number(snapshot.headline?.preorder_count || 0)} 笔，经营订单 ${Number(snapshot.headline?.operation_order_count || 0)} 笔。`,
        chart: {
          kind: 'bar',
          title: '演示园区需求概览',
          unit: '原始单位',
          categories: demandTotals.map((item) => item.unit),
          series: [{ name: '需求量', data: demandTotals.map((item) => Number(item.quantity || 0)) }],
        },
      } });
    } catch {
      return response(false, 503, {
        code: 'DEMO_ASSISTANT_UNAVAILABLE',
        message: '本地演示助手数据暂不可用，请刷新页面后重试。',
      });
    }
  }

  async function transcribeDashboardAudio(blob, durationSeconds, filename = 'question.wav', options = {}) {
    if (demoMode) {
      return response(false, 503, {
        code: 'VOICE_DISABLED',
        message: '本地演示不上传录音，请使用文字或预设问题。',
      });
    }
    const requestId = options.requestId || globalThis.crypto?.randomUUID?.();
    if (!requestId) throw new Error('无法生成语音请求编号，请刷新页面后重试。');
    const form = new FormData();
    form.append('audio', blob, filename);
    form.append('duration_seconds', String(durationSeconds));
    form.append('client_request_id', requestId);
    const route = accessToken ? '/web/assistant/transcriptions' : '/public/assistant/transcriptions';
    const result = await rawRequest(route, {
      method: 'POST',
      headers: { 'Idempotency-Key': requestId, 'X-Trace-Id': requestId },
      body: form,
      signal: options.signal,
    }, Boolean(accessToken));
    return withData(result, result.json ? { ...result.json, text: result.json.transcript } : null);
  }

  async function queryDashboardAssistant(question, period = '30d', _parkId = null, preferredChart = null, options = {}) {
    if (demoMode) return demoAssistantAnswer(question, period);
    const headers = options.requestId ? { 'X-Trace-Id': options.requestId } : undefined;
    const authenticated = Boolean(accessToken);
    const result = await rawRequest(authenticated ? '/web/assistant/query' : '/public/assistant/query', {
      method: 'POST',
      headers,
      body: JSON.stringify({ question, preferred_chart: preferredChart || 'auto', period }),
      signal: options.signal,
      authPolicy: authenticated ? 'required' : 'omit',
      credentialsPolicy: authenticated ? 'include' : 'omit',
    });
    return withData(result, result.json);
  }

  async function calculate(kind, body = {}) {
    const routes = {
      'carpool-preview': ['/web/algorithms/carpool/preview', 'POST'],
      'warehouse-preview': ['/web/algorithms/warehouse-pool/preview', 'POST'],
      procurement: ['/web/algorithms/procurement', 'GET'],
      forecast: ['/web/algorithms/forecast', 'GET'],
    };
    const config = routes[kind];
    if (!config) return response(false, 404, { code: 'CALCULATION_NOT_SUPPORTED', message: '该计算项尚未接入新服务器' });
    let [path, method] = config;
    const options = { method };
    if (method === 'GET') path += `?${new URLSearchParams(body)}`;
    else options.body = JSON.stringify(body);
    const result = await rawRequest(path, options);
    return withData(result, result.json);
  }

  async function confirmCarpool(matchRunId, objectVersion = 1, candidateIndex = 0, orderVersions = null) {
    const result = await rawRequest(`/web/algorithms/carpool/runs/${encodeURIComponent(matchRunId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        match_run_id: matchRunId,
        candidate_index: candidateIndex,
        object_version: objectVersion,
        order_versions: orderVersions || {},
      }),
    });
    return withData(result, result.json);
  }

  async function confirmWarehousePool(matchRunId, candidateIndex, warehouseId, warehouseObjectVersion, key) {
    const result = await rawRequest(
      `/web/algorithms/warehouse-pool/runs/${encodeURIComponent(matchRunId)}/confirm`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          match_run_id: matchRunId,
          candidate_index: candidateIndex,
          warehouse_id: warehouseId,
          warehouse_object_version: warehouseObjectVersion,
        }),
      },
    );
    return withData(result, result.json);
  }

  async function getWarehousePoolPlan(planId) {
    const result = await rawRequest(`/web/warehouse-pool/plans/${encodeURIComponent(planId)}`);
    return withData(result, result.json);
  }

  async function requestWarehousePoolAction(planId, action, objectVersion, key, reason = null) {
    const body = { object_version: objectVersion };
    if (action === 'cancel') body.reason = reason || '网页端取消拼仓计划';
    const result = await rawRequest(
      `/web/warehouse-pool/plans/${encodeURIComponent(planId)}/${encodeURIComponent(action)}`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      },
    );
    return withData(result, result.json);
  }

  async function generateProcurementAggregation(cycleStart = null, key) {
    const result = await rawRequest('/web/procurement/aggregations/generate', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ cycle_start: cycleStart }),
    });
    return withData(result, result.json);
  }

  async function confirmProcurementAggregation(aggregationId, objectVersion, adjustedQuantity, reason, key) {
    const body = { object_version: objectVersion };
    if (adjustedQuantity !== null) {
      body.adjusted_quantity = adjustedQuantity;
      body.adjustment_reason = reason;
    }
    const result = await rawRequest(
      `/web/procurement/aggregations/${encodeURIComponent(aggregationId)}/confirm`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      },
    );
    return withData(result, result.json);
  }

  async function generateNextWeekForecast(key) {
    const result = await rawRequest('/web/forecasts/next-week/generate', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
    });
    return withData(result, result.json);
  }

  async function getNextWeekForecast() {
    const result = await rawRequest('/web/forecasts/next-week');
    return withData(result, result.json);
  }

  async function precheckImport() {
    return response(false, 501, { code: 'IMPORT_RETIRED', message: '新服务器不再接收旧版整本导入，请使用订单和主数据 API' });
  }

  async function confirmImport() {
    return precheckImport();
  }

  async function subscribeDashboardEvents(onEvent, signal, onOpen = null) {
    let cursor = Number(sessionStorage.getItem('blacksoil.dashboard.cursor') || '0');
    const result = await fetch(`${baseUrl}/dashboard/events?cursor=${encodeURIComponent(cursor)}`, {
      headers: {
        ...(cursor > 0 ? { 'Last-Event-ID': String(cursor) } : {}),
      },
      credentials: 'omit',
      cache: 'no-store',
      signal,
    });
    if (!result.ok || !result.body) throw new Error(`实时事件连接失败（HTTP ${result.status}）`);
    onOpen?.();
    const reader = result.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const packets = buffer.split('\n\n');
      buffer = packets.pop() || '';
      for (const packet of packets) {
        const id = packet.match(/^id:\s*(.+)$/m)?.[1];
        const data = packet.match(/^data:\s*(.+)$/m)?.[1];
        const nextCursor = Number(id || 0);
        const event = data ? JSON.parse(data) : null;
        if (!event || nextCursor <= cursor || recentDashboardEventIds.has(event.event_id)) continue;
        cursor = nextCursor;
        sessionStorage.setItem('blacksoil.dashboard.cursor', String(cursor));
        recentDashboardEventIds.add(event.event_id);
        if (recentDashboardEventIds.size > 500) {
          const oldest = recentDashboardEventIds.values().next().value;
          recentDashboardEventIds.delete(oldest);
        }
        onEvent(event, String(cursor));
      }
    }
    throw new Error('实时事件连接已结束');
  }

  window.API = {
    calculate,
    clearTokens: () => clearSession('cleared'),
    confirmCarpool,
    confirmProcurementAggregation,
    confirmWarehousePool,
    confirmImport,
    getCurrentUser,
    getDashboard,
    getDictionaries,
    getPublicDictionaries,
    getPublicInformation,
    getDashboardSnapshot,
    generateProcurementAggregation,
    generateNextWeekForecast,
    getOperationsSummary,
    getBaseUrl: () => baseUrl,
    getNextWeekForecast,
    getWarehousePoolPlan,
    getLiveBase: () => baseUrl,
    getSession: () => ({ user: currentUser, authenticated: Boolean(currentUser), idleTimeoutMs }),
    isMock: () => demoMode,
    list,
    login,
    logout,
    onAuthChange(listener) {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
    precheckImport,
    queryDashboardAssistant,
    request,
    requestWarehousePoolAction,
    subscribeDashboardEvents,
    touchActivity,
    transcribeDashboardAudio,
  };
})();
