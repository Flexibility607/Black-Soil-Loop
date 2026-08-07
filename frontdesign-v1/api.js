(function () {
  const runtime = window.BLACKSOIL_CONFIG || {};
  const productionHost = /(^|\.)flexibility607\.cn$/i.test(window.location.hostname);
  const baseUrl = productionHost
    ? 'https://api.flexibility607.cn/api/v1'
    : (runtime.apiBase || '/api/v1');
  const demoMode = runtime.demo === true;
  const demoSnapshotUrl = './frontend-mocks-v0.1/e02-dashboard-snapshot.json';
  const authListeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('blacksoil-auth-v1') : null;
  let accessToken = null;
  let csrfToken = null;
  let currentUser = null;
  let idleTimeoutMs = 30 * 60 * 1000;
  let idleTimer = null;
  let refreshing = null;

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
  };

  function response(ok, status, json) {
    return { ok, status, json };
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
    const headers = new Headers(options.headers || {});
    const hasFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body && !hasFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (path === '/web/auth/refresh' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const res = await fetch(`${baseUrl}${path}`, { ...options, headers, credentials: 'include', cache: 'no-store' });
    const result = response(res.ok, res.status, await readJson(res));
    if (res.status === 401 && retryOn401 && path !== '/web/auth/refresh' && await refreshAccessToken()) {
      return rawRequest(path, options, false);
    }
    if (res.status === 401 && !retryOn401) clearSession('unauthorized');
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

  async function getDashboardSnapshot(_period = '30d', authenticated = false) {
    if (demoMode) {
      const res = await fetch(demoSnapshotUrl, { cache: 'no-store' });
      return response(res.ok, res.status, await readJson(res));
    }
    const result = await rawRequest(authenticated ? '/web/dashboard/snapshot' : '/public/dashboard/snapshot');
    return withData(result, result.json);
  }

  async function transcribeDashboardAudio(blob, durationSeconds, filename = 'question.webm') {
    const form = new FormData();
    form.append('audio', blob, filename);
    form.append('duration_seconds', String(durationSeconds));
    const result = await rawRequest('/web/assistant/transcriptions', { method: 'POST', body: form }, false);
    return withData(result, result.json ? { ...result.json, text: result.json.transcript } : null);
  }

  async function queryDashboardAssistant(question, _period = '30d', _parkId = null, preferredChart = null) {
    const result = await rawRequest(accessToken ? '/web/assistant/query' : '/public/assistant/query', {
      method: 'POST',
      body: JSON.stringify({ question, preferred_chart: preferredChart || 'auto' }),
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

  async function confirmCarpool(matchRunId, objectVersion = 1, candidateIndex = 0) {
    const result = await rawRequest(`/web/algorithms/carpool/runs/${encodeURIComponent(matchRunId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ match_run_id: matchRunId, candidate_index: candidateIndex, object_version: objectVersion }),
    });
    return withData(result, result.json);
  }

  async function precheckImport() {
    return response(false, 501, { code: 'IMPORT_RETIRED', message: '新服务器不再接收旧版整本导入，请使用订单和主数据 API' });
  }

  async function confirmImport() {
    return precheckImport();
  }

  async function subscribeDashboardEvents(onEvent, signal) {
    const cursor = sessionStorage.getItem('blacksoil.dashboard.cursor') || '0';
    const result = await fetch(`${baseUrl}/dashboard/events?cursor=${encodeURIComponent(cursor)}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (!result.ok || !result.body) throw new Error(`实时事件连接失败（HTTP ${result.status}）`);
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
        if (id) sessionStorage.setItem('blacksoil.dashboard.cursor', id);
        if (data) onEvent(JSON.parse(data), id);
      }
    }
  }

  window.API = {
    calculate,
    clearTokens: () => clearSession('cleared'),
    confirmCarpool,
    confirmImport,
    getCurrentUser,
    getDashboard,
    getDashboardSnapshot,
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
    subscribeDashboardEvents,
    touchActivity,
    transcribeDashboardAudio,
  };
})();
