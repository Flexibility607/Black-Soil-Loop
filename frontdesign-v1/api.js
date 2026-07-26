// E01 / E02 / B01 的轻量 API 客户端。
// 页面保持无构建依赖，Mock 和 Live 只通过 localStorage 中的开关切换。
(function () {
  const defaultBase = 'http://localhost:8000/api/v1';
  const mockBase = '../frontend-mocks-v0.1';
  const accessTokenKey = 'b01.accessToken';
  const refreshTokenKey = 'b01.refreshToken';

  function useMock() {
    return localStorage.getItem('useMock') !== 'false';
  }

  function getLiveBase() {
    return localStorage.getItem('apiBase') || defaultBase;
  }

  function getAccessToken() {
    return localStorage.getItem(accessTokenKey);
  }

  function saveTokens(data) {
    if (data && data.access_token) localStorage.setItem(accessTokenKey, data.access_token);
    if (data && data.refresh_token) localStorage.setItem(refreshTokenKey, data.refresh_token);
  }

  function clearTokens() {
    localStorage.removeItem(accessTokenKey);
    localStorage.removeItem(refreshTokenKey);
  }

  function response(ok, status, json) {
    return { ok, status, json };
  }

  async function readJson(res) {
    return res.json().catch(() => null);
  }

  function mockEnvelope(data, traceId) {
    return {
      status: 'PROCESSED',
      code: 'OK',
      data,
      errors: [],
      trace_id: traceId || 'TRACE-MOCK-001',
      data_cutoff: '2026-07-23T10:00:00+08:00',
    };
  }

  function mockList(items) {
    return mockEnvelope({ items, total: items.length, page: 1, page_size: 20 }, 'TRACE-MOCK-LIST-001');
  }

  let mockResourceRowsCache;

  async function fixture(name) {
    const res = await fetch(`${mockBase}/${name}`, { cache: 'no-store' });
    return response(res.ok, res.status, await readJson(res));
  }

  async function getMockResourceRows() {
    if (mockResourceRowsCache) return mockResourceRowsCache;
    const result = await fixture('e01-resource-rows.json');
    mockResourceRowsCache = result.ok && result.json && result.json.data ? result.json.data.resources || {} : {};
    return mockResourceRowsCache;
  }

  async function mockRequest(path) {
    if (path === '/auth/login') return fixture('auth-login-success.json');
    if (path === '/auth/me') {
      return response(true, 200, mockEnvelope({ user_id: 'USER-MOCK-001', username: 'mock-admin', role: 'park_admin', park_id: 'PARK-001', enterprise_ids: [] }, 'TRACE-MOCK-ME-001'));
    }
    if (path === '/dashboard/overview') return fixture('e01-dashboard-overview.json');
    if (path === '/enterprises') {
      const rows = await getMockResourceRows();
      return response(true, 200, mockList(rows.enterprises || []));
    }
    if (path === '/analytics/material-demand') return fixture('e01-calculation-material-demand.json');
    if (path === '/routes/estimate') {
      return response(true, 200, mockEnvelope({ calculation_status: 'RULE_MISSING', missing_fields: ['map_provider'], calc_results: {} }, 'TRACE-MOCK-ROUTE-001'));
    }
    if (path === '/public/dashboard/overview') return fixture('e02-public-overview-changchun.json');
    if (path === '/public/dashboard/capacity') return fixture('e02-public-capacity-changchun.json');
    if (path === '/public/dashboard/preorders') return fixture('e02-public-preorders-changchun.json');
    if (path === '/public/dashboard/transport') return fixture('e02-public-transport-changchun.json');
    if (path === '/public/dashboard/policies') return fixture('e02-public-policies-changchun.json');
    if (path === '/public/dashboard/news') return fixture('e02-public-news-changchun.json');
    if (path === '/imports/precheck') return fixture('import-precheck-success.json');
    if (path.startsWith('/imports/') && path.endsWith('/confirm')) return fixture('import-precheck-success.json');
    const rows = await getMockResourceRows();
    return response(true, 200, mockList(rows[path.slice(1)] || []));
  }

  async function refreshAccessToken() {
    const refreshToken = localStorage.getItem(refreshTokenKey);
    if (!refreshToken) return false;
    const result = await request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, false);
    if (!result.ok) {
      clearTokens();
      return false;
    }
    saveTokens(result.json && result.json.data);
    return true;
  }

  async function request(path, options = {}, retryOn401 = true) {
    if (useMock()) return mockRequest(path);

    const headers = new Headers(options.headers || {});
    const hasFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body && !hasFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const accessToken = getAccessToken();
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

    const res = await fetch(`${getLiveBase()}${path}`, { ...options, headers });
    const json = await readJson(res);
    if (res.status === 401 && retryOn401 && await refreshAccessToken()) {
      return request(path, options, false);
    }
    return response(res.ok, res.status, json);
  }

  async function login(username, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }, false);
    if (result.ok && result.json && result.json.data) saveTokens(result.json.data);
    return result;
  }

  async function logout() {
    const refreshToken = localStorage.getItem(refreshTokenKey);
    if (!useMock() && refreshToken && getAccessToken()) {
      await request('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, false);
    }
    clearTokens();
    return response(true, 200, mockEnvelope({ logged_out: true }, 'TRACE-LOGOUT-001'));
  }

  async function list(resource, params = {}) {
    if (useMock()) return mockRequest(`/${resource}`);
    const query = new URLSearchParams({ page: '1', page_size: '20', ...params });
    return request(`/${resource}?${query.toString()}`);
  }

  async function getDashboard(path) {
    return request(`/dashboard/${path}`);
  }

  async function getPublicDashboard(path) {
    return request(`/public/dashboard/${path}`);
  }

  async function precheckImport(file) {
    if (useMock()) return mockRequest('/imports/precheck');
    const form = new FormData();
    form.append('file', file);
    return request('/imports/precheck', { method: 'POST', body: form });
  }

  async function confirmImport(batchId) {
    return request(`/imports/${encodeURIComponent(batchId)}/confirm`, { method: 'POST' });
  }

  async function calculate(kind, body) {
    if (kind === 'material-demand') return request('/analytics/material-demand');
    return request(`/${kind}`, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  window.API = {
    clearTokens,
    confirmImport,
    calculate,
    getDashboard,
    getPublicDashboard,
    getLiveBase,
    getCurrentUser: () => request('/auth/me'),
    isMock: useMock,
    list,
    login,
    logout,
    precheckImport,
    request,
  };
})();
