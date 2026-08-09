export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const POLLING_INTERVAL_MS = 30_000;

export function eventTargets(topic = '') {
  if (topic.startsWith('store.receipt') || topic.startsWith('store.stockout') || topic.startsWith('store.daily_report')) {
    return ['overview', 'inventory'];
  }
  if (topic.startsWith('transport.order') || topic.startsWith('transport.plan')) {
    return ['overview', 'production', 'transport'];
  }
  if (topic.startsWith('transport.task') || topic.startsWith('telemetry.') || topic.startsWith('location.')) {
    return ['overview', 'transport'];
  }
  if (topic.startsWith('alert.')) return ['overview', 'transport'];
  return ['overview', 'enterprise', 'production', 'inventory', 'transport'];
}

export class RealtimeCoordinator {
  constructor({
    subscribe,
    onEvent,
    onPoll,
    onState = () => {},
    setTimeoutFn = window.setTimeout.bind(window),
    clearTimeoutFn = window.clearTimeout.bind(window),
    setIntervalFn = window.setInterval.bind(window),
    clearIntervalFn = window.clearInterval.bind(window),
  }) {
    this.subscribe = subscribe;
    this.onEvent = onEvent;
    this.onPoll = onPoll;
    this.onState = onState;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.controller = null;
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.retryIndex = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    if (this.reconnectTimer) this.clearTimeoutFn(this.reconnectTimer);
    if (this.pollTimer) this.clearIntervalFn(this.pollTimer);
    this.reconnectTimer = null;
    this.pollTimer = null;
  }

  connect() {
    if (!this.running || this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    this.subscribe(
      (event, cursor) => this.onEvent(event, cursor),
      controller.signal,
      () => this.connected(),
    ).catch((error) => this.disconnected(controller, error));
  }

  connected() {
    this.retryIndex = 0;
    if (this.pollTimer) this.clearIntervalFn(this.pollTimer);
    this.pollTimer = null;
    this.onState('connected');
  }

  disconnected(controller, error) {
    if (this.controller !== controller) return;
    this.controller = null;
    if (!this.running || controller.signal.aborted) return;
    this.onState('polling', error);
    if (!this.pollTimer) this.pollTimer = this.setIntervalFn(() => this.onPoll(), POLLING_INTERVAL_MS);
    const delay = RECONNECT_DELAYS_MS[Math.min(this.retryIndex, RECONNECT_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
