/**
 * Daikin Cloud Homebridge UI
 * Main application script
 */

// ============================================================================
// DOM & Utility Helpers
// ============================================================================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const $id = (id) => document.getElementById(id);

const DOM = {
  show: (el) => el?.classList.remove('d-none'),
  hide: (el) => el?.classList.add('d-none'),
  toggle: (el, show) => el?.classList.toggle('d-none', !show),
  setValid: (el, valid) => el?.classList.toggle('is-invalid', !valid),
};

const Utils = {
  capitalize: (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '',

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text === null || text === undefined ? '' : String(text);
    return div.innerHTML;
  },

  isValidPort(port) {
    const num = parseInt(port, 10);
    return !isNaN(num) && num >= 1 && num <= 65535;
  },

  isValidNumber(value, min, max) {
    const num = parseInt(value, 10);
    return !isNaN(num) && num >= min && num <= max;
  },

  isValidIPv4(ip) {
    if (!ip) {
      return true;
    }
    return /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.){3}(25[0-5]|(2[0-4]|1\d|[1-9]|)\d)$/.test(ip);
  },

  formatTime(ms) {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  },
};

// ============================================================================
// Application State
// ============================================================================

const State = {
  currentTab: 'devices',
  currentStep: 1,
  authState: null,
  authUrl: null,
  tokenExpiresAt: null,
  isValidating: false,
  intervals: {
    poll: null,
    countdown: null,
    statusRefresh: null,
  },
};

// Element cache (populated on init)
let El = {};

// ============================================================================
// UI Module
// ============================================================================

const UI = {
  showLoading: () => DOM.show(El.loading),
  hideLoading: () => DOM.hide(El.loading),

  showError(message) {
    if (El.globalError) {
      El.globalError.innerHTML = `<div class="alert alert-danger">${Utils.escapeHtml(message)}</div>`;
      DOM.show(El.globalError);
      setTimeout(() => DOM.hide(El.globalError), 10000);
    }
  },

  setButtonLoading(btn, loading, loadingText = 'Loading...', normalText = null) {
    if (!btn) {
      return;
    }
    btn.disabled = loading;
    if (loading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${loadingText}`;
    } else {
      btn.innerHTML = normalText || btn.dataset.originalText || btn.innerHTML;
    }
  },
};

// ============================================================================
// Assistant Module (Homebridge AI Kit)
// ============================================================================
// Shown only when the shared HomebridgeAiKit platform is set up and enabled.
// Nothing sent to it may contain credentials, tokens or IP addresses.

const Assistant = {
  enabled: false,
  available: false,

  // Keys kept out of every request: credentials and network addresses
  PRIVATE_KEYS: ['clientId', 'clientSecret', 'daikinEmail', 'daikinPassword', 'callbackServerExternalAddress', 'oidcCallbackServerBindAddr'],

  async init() {
    try {
      if (window.MpKit && MpKit.ai) {
        const status = await MpKit.ai.status();
        this.available = true;
        this.enabled = !!(status && status.enabled);
      }
    } catch {
      // Routes missing (AI Kit not installed) or older Homebridge UI: no Assistant
    }
    DOM.toggle($id('assistant-hint'), this.available && !this.enabled);
    if (this.enabled) {
      this.setupConfigCard();
    }
  },

  // Error text without e-mail addresses or LAN/public IPs (loopback and 0.0.0.0 stay: they explain bind problems)
  scrub(text) {
    return String(text ?? '')
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '<email>')
      .replace(/\b(?!127\.)(?!0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, '<address>');
  },

  // Device facts the Assistant may see (whitelist)
  device(d) {
    return {
      name: d.name,
      id: d.id,
      model: d.model,
      type: d.type,
      online: !!d.online,
      features: Array.isArray(d.features) ? d.features : [],
    };
  },

  // Plugin settings the Assistant may see, as one sentence (no credentials or addresses)
  context(extra) {
    const interval = $id('updateIntervalInMinutes')?.value;
    return [
      extra,
      `Authentication method: ${AuthMode.current}.`,
      interval ? `Update interval: ${interval} minutes.` : '',
      AuthMode.current === 'mobile_app' ? `WebSocket: ${$id('enableWebSocket')?.checked ? 'on' : 'off'}.` : '',
      `HTTP transport: ${$id('httpTransport')?.value || 'node'}.`,
    ].filter(Boolean).join(' ');
  },

  // Streams an explanation of `error` into `answerEl`
  async explain(button, answerEl, { error, context, device, title }) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    DOM.show(answerEl);
    const answer = MpKit.ai.renderAnswer(answerEl, { title });
    try {
      const res = await MpKit.ai.explain({ error: this.scrub(error), context: this.scrub(context), device }, { onChunk: answer.append });
      answer.done(res);
    } catch (e) {
      answer.error(e);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  },

  /**
   * Adds an "Explain" button (and its answer panel) to the slot `slotId`, next to an
   * error the page already shows. With `alert: true` the error itself is shown too
   * (for errors that otherwise only appear in the auto-hiding global banner).
   */
  offer(slotId, { message, context, title, alert = false }) {
    const slot = $id(slotId);
    if (!slot || !this.enabled) {
      return;
    }
    slot.innerHTML = `
      <div class="d-flex justify-content-between align-items-start gap-2 ${alert ? 'alert alert-danger mb-0' : ''}">
        <div>${alert ? Utils.escapeHtml(message) : ''}</div>
        ${MpKit.ai.renderButton({ label: 'Explain', size: 'sm', className: 'flex-shrink-0 js-explain', title: 'Explain this problem' })}
      </div>
      <div class="assistant-answer mt-2 d-none"></div>`;
    DOM.show(slot);
    const button = slot.querySelector('.js-explain');
    button.addEventListener('click', () => this.explain(button, slot.querySelector('.assistant-answer'), {
      error: message,
      context: this.context(context),
      title,
    }));
  },

  clear(slotId) {
    const slot = $id(slotId);
    if (slot) {
      DOM.hide(slot);
      slot.innerHTML = '';
    }
  },

  // ── Describe Your Setup ────────────────────────────────────────────────────

  setupConfigCard() {
    DOM.show($id('assistant-config-card'));
    $id('assistant-config-badge').innerHTML = MpKit.ai.renderBadge();
    $id('assistant-config-action').innerHTML = MpKit.ai.renderButton({ label: 'Suggest changes', id: 'btn-assistant-config' });
    $id('btn-assistant-config').addEventListener('click', () => this.suggestConfig());
  },

  async suggestConfig() {
    const request = $id('assistant-config-request').value.trim();
    if (!request) {
      UI.showError('Describe what you want to change first');
      return;
    }
    const button = $id('btn-assistant-config');
    const result = $id('assistant-config-result');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    result.innerHTML = MpKit.ai.renderThinking('Preparing a suggestion…');
    try {
      const config = (await homebridge.getPluginConfig())[0] || { platform: 'DaikinCloud', name: 'Daikin Cloud' };
      // Credentials and addresses stay in the browser: strip them before and merge them back on apply
      const shareable = { ...config };
      this.PRIVATE_KEYS.forEach(k => delete shareable[k]);
      const schema = await homebridge.getPluginConfigSchema();
      const res = await MpKit.ai.config({ schema, request, current: shareable });

      // Keep keys the schema does not describe (platform, _bridge, ...) and the current key order
      const known = new Set(Object.keys((schema.schema || schema).properties || {}));
      const proposed = res.config || {};
      const suggested = {};
      Object.keys(shareable).forEach(k => {
        if (!known.has(k)) {
          suggested[k] = shareable[k];
        } else if (k in proposed) {
          suggested[k] = proposed[k];
        }
      });
      Object.keys(proposed).forEach(k => {
        if (known.has(k) && !(k in suggested)) {
          suggested[k] = proposed[k];
        }
      });
      this.PRIVATE_KEYS.forEach(k => delete suggested[k]);

      result.innerHTML = '<div class="assistant-explanation mb-2"></div><div class="assistant-diff"></div>';
      MpKit.ai.renderAnswer(result.querySelector('.assistant-explanation'), { text: res.explanation, streaming: false, title: 'Suggested change' });
      MpKit.ai.renderDiff(result.querySelector('.assistant-diff'), {
        before: shareable,
        after: suggested,
        applyLabel: 'Apply',
        onApply: () => this.applyConfig(config, suggested),
      });
    } catch (e) {
      result.innerHTML = '';
      MpKit.ai.renderAnswer(result, { streaming: false }).error(e);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  },

  async applyConfig(config, suggested) {
    const newConfig = { ...suggested, platform: 'DaikinCloud', name: suggested.name || config.name || 'Daikin Cloud' };
    this.PRIVATE_KEYS.forEach(k => {
      if (config[k] !== undefined) {
        newConfig[k] = config[k];
      }
    });
    // The settings tab saves every change straight away; do the same here
    await homebridge.updatePluginConfig([newConfig]);
    await homebridge.savePluginConfig();

    Settings.populateForm(newConfig);
    Settings.excludedIds = newConfig.excludedDevicesByDeviceId || [];
    Settings.loadDeviceToggles();
    AuthMode.current = AuthMode.previous = newConfig.authMode || 'developer_portal';
    AuthMode.updateUI();
    homebridge.toast.success('Change saved. Restart Homebridge to apply it.');
  },
};

// ============================================================================
// Tab Navigation
// ============================================================================

function switchTab(tabName) {
  State.currentTab = tabName;
  $$('.nav-pills .nav-link').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tabName));
  $$('.tab-pane').forEach(panel =>
    panel.classList.toggle('active', panel.id === `tab-${tabName}`));
}

function switchSettingsSubtab(subtabName) {
  $$('.nav-tabs .nav-link').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.subtab === subtabName));
  $$('.settings-subtab-content').forEach(panel =>
    DOM.toggle(panel, panel.id === `subtab-${subtabName}`));
}

// ============================================================================
// Countdown Timer
// ============================================================================

const Countdown = {
  start() {
    this.stop();
    this.update();
    State.intervals.countdown = setInterval(() => this.update(), 1000);
  },

  stop() {
    if (State.intervals.countdown) {
      clearInterval(State.intervals.countdown);
      State.intervals.countdown = null;
    }
  },

  update() {
    if (!State.tokenExpiresAt) {
      return;
    }

    const diff = State.tokenExpiresAt - Date.now();

    if (diff <= 0) {
      [El.tokenExpires, El.authTokenExpires].forEach(el => {
        if (el) {
          el.textContent = 'Expired';
        }
      });
      this.stop();
      Auth.loadStatus();
      return;
    }

    const formatted = Utils.formatTime(diff);
    const color = diff < 300000 ? 'var(--bs-danger)' : diff < 1800000 ? 'var(--bs-warning)' : '';

    [El.tokenExpires, El.authTokenExpires].forEach(el => {
      if (el) {
        el.textContent = formatted;
        el.style.color = color;
      }
    });
  },
};

// ============================================================================
// Authentication Module
// ============================================================================

const Auth = {
  STATUS_REFRESH_INTERVAL: 60000,
  _lastStatusCheck: 0,
  _statusPromise: null,

  async loadStatus() {
    // Debounce: skip if called within 500ms of last call
    const now = Date.now();
    if (now - this._lastStatusCheck < 500 && this._statusPromise) {
      return this._statusPromise;
    }
    this._lastStatusCheck = now;

    this._statusPromise = (async () => {
      try {
        const response = await homebridge.request('/auth/status');
        this.updateUI(response);
      } catch (error) {
        this.updateUI({ authenticated: false, error: error.message });
      }
    })();

    return this._statusPromise;
  },

  startStatusRefresh() {
    this.stopStatusRefresh();
    State.intervals.statusRefresh = setInterval(() => this.checkTokenRenewal(), this.STATUS_REFRESH_INTERVAL);
  },

  stopStatusRefresh() {
    if (State.intervals.statusRefresh) {
      clearInterval(State.intervals.statusRefresh);
      State.intervals.statusRefresh = null;
    }
  },

  async checkTokenRenewal() {
    try {
      const response = await homebridge.request('/auth/status');
      if (response.authenticated && response.expiresAt) {
        const newExpires = new Date(response.expiresAt).getTime();
        if (!State.tokenExpiresAt || newExpires !== State.tokenExpiresAt.getTime()) {
          this.updateUI(response);
        }
      }
    } catch (error) {
      console.error('Token check failed:', error);
    }
  },

  updateUI(status) {
    if (status.authenticated) {
      this.setAuthenticated(status);
    } else {
      this.setUnauthenticated(status);
    }
  },

  setAuthenticated(status) {
    const isExpired = status.isExpired;

    El.statusBadge.className = `badge ${isExpired ? 'expired' : 'authenticated'}`;
    El.statusIndicator.className = `status-dot ${isExpired ? 'yellow' : 'green'}`;
    El.statusText.textContent = isExpired ? 'Expired' : 'Connected';
    El.authStatus.textContent = isExpired
      ? (status.canRefresh ? 'Token expired (will auto-refresh)' : 'Token expired')
      : 'Authenticated and ready';

    if (status.expiresAt) {
      State.tokenExpiresAt = new Date(status.expiresAt);
      DOM.show(El.tokenExpiresLabel);
      DOM.show(El.expiresRow);
      Countdown.start();
    }

    this.startStatusRefresh();
    El.btnAuthenticate.textContent = 'Re-authenticate';
    DOM.show(El.btnRevoke);
    El.btnTest.disabled = false;
  },

  setUnauthenticated(status) {
    El.statusBadge.className = 'badge not-authenticated';
    El.statusIndicator.className = 'status-dot red';
    El.statusText.textContent = 'Not Connected';
    El.authStatus.textContent = status.error || 'Authentication required';

    DOM.hide(El.tokenExpiresLabel);
    DOM.hide(El.expiresRow);
    El.tokenExpires.textContent = '';
    El.btnAuthenticate.textContent = 'Authenticate';
    DOM.hide(El.btnRevoke);
    El.btnTest.disabled = true;

    Countdown.stop();
    this.stopStatusRefresh();
  },

  async startAuth(config) {
    const result = await homebridge.request('/auth/start', config);
    State.authState = result.state;
    State.authUrl = result.authUrl;
    return result;
  },

  async revoke() {
    UI.showLoading();
    try {
      const config = await homebridge.getPluginConfig();
      const { clientId, clientSecret } = config[0] || {};
      await homebridge.request('/auth/revoke', { clientId, clientSecret });
      this.loadStatus();
    } catch (error) {
      UI.showError('Failed to revoke: ' + error.message);
    }
    UI.hideLoading();
  },

  async testConnection() {
    UI.setButtonLoading(El.btnTest, true, 'Testing...');
    DOM.hide(El.testResult);
    Assistant.clear('test-problem');

    try {
      const result = await homebridge.request('/auth/test');
      El.testResult.className = `alert ${result.success ? 'alert-success' : 'alert-danger'}`;
      El.testResult.textContent = result.message;
      DOM.show(El.testResult);
      if (!result.success) {
        this.offerExplain(result.message);
      }
    } catch (error) {
      El.testResult.className = 'alert alert-danger';
      El.testResult.textContent = 'Test failed: ' + error.message;
      DOM.show(El.testResult);
      this.offerExplain(El.testResult.textContent);
    }

    UI.setButtonLoading(El.btnTest, false, null, 'Test Connection');
  },

  offerExplain(message) {
    Assistant.offer('test-problem', {
      message,
      context: 'Test Connection in the plugin settings (reads the saved token and lists the gateway devices from the Daikin Onecta API) failed.',
      title: 'Why did the connection test fail?',
    });
  },
};

// ============================================================================
// OAuth Wizard Module
// ============================================================================

const Wizard = {
  show() {
    DOM.show(El.wizard);
    DOM.hide(El.authStatusCard);
    this.goToStep(1);
  },

  hide() {
    Polling.stop();
    homebridge.request('/auth/stop-server').catch(() => {});
    DOM.hide(El.wizard);
    DOM.show(El.authStatusCard);
    DOM.hide(El.callbackServerStatus);
  },

  goToStep(step) {
    State.currentStep = step;
    for (let i = 1; i <= 3; i++) {
      const stepEl = $id(`step-${i}`);
      const contentEl = $id(`content-${i}`);
      stepEl.classList.remove('active', 'completed');
      DOM.toggle(contentEl, i === step);
      if (i < step) {
        stepEl.classList.add('completed');
      } else if (i === step) {
        stepEl.classList.add('active');
      }
    }
  },

  async validateAndProceed() {
    if (State.isValidating) {
      return;
    }
    State.isValidating = true;

    const config = this.getFormConfig();
    const portInput = $id('callbackServerPort');

    if (!Utils.isValidPort(config.callbackServerPort)) {
      DOM.setValid(portInput, false);
      El.validationErrors.innerHTML = '<div>Port must be between 1 and 65535</div>';
      DOM.show(El.validationErrors);
      State.isValidating = false;
      return;
    }
    DOM.setValid(portInput, true);

    UI.showLoading();
    try {
      const validation = await homebridge.request('/config/validate', config);
      if (!validation.valid) {
        El.validationErrors.innerHTML = validation.errors.map(e => `<div>${Utils.escapeHtml(e)}</div>`).join('');
        DOM.show(El.validationErrors);
        UI.hideLoading();
        State.isValidating = false;
        return;
      }

      DOM.hide(El.validationErrors);
      Assistant.clear('wizard-start-problem');
      const authResult = await Auth.startAuth(config);

      El.authUrlDisplay.textContent = authResult.authUrl;
      DOM.show(El.authUrlContainer);

      const manualCollapse = $id('manual-callback-collapse');
      DOM.toggle(El.callbackServerStatus, authResult.callbackServerRunning);
      if (manualCollapse) {
        manualCollapse.classList.toggle('show', !authResult.callbackServerRunning);
      }

      Polling.start();
      this.goToStep(2);
    } catch (error) {
      El.validationErrors.innerHTML = `<div>${Utils.escapeHtml(error.message)}</div>`;
      DOM.show(El.validationErrors);
      Assistant.offer('wizard-start-problem', {
        message: error.message,
        context: 'Starting the Developer Portal OAuth login (temporary HTTPS callback server) from the plugin settings failed.',
        title: 'Why can the login not start?',
      });
    }

    UI.hideLoading();
    State.isValidating = false;
  },

  getFormConfig() {
    return {
      clientId: $id('clientId')?.value.trim() || '',
      clientSecret: $id('clientSecret')?.value.trim() || '',
      callbackServerExternalAddress: $id('callbackServerExternalAddress')?.value.trim() || '',
      callbackServerPort: $id('callbackServerPort')?.value.trim() || '8582',
    };
  },

  async submitCallbackUrl() {
    const url = $id('callbackUrl')?.value.trim();
    if (!url) {
      return UI.showError('Please paste the callback URL');
    }
    if (!url.includes('code=')) {
      return UI.showError('Invalid URL - must contain code parameter');
    }

    UI.showLoading();
    Assistant.clear('wizard-auth-problem');
    try {
      const result = await homebridge.request('/auth/', { callbackUrl: url });
      if (result.success) {
        El.successMessage.textContent = result.message;
        this.goToStep(3);
        await Config.save();
      } else {
        this.authFailed('Authentication failed: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      this.authFailed('Authentication failed: ' + error.message);
    }
    UI.hideLoading();
  },

  authFailed(message) {
    UI.showError(message);
    Assistant.offer('wizard-auth-problem', {
      message,
      alert: true,
      context: 'Completing the Developer Portal OAuth login (exchanging the authorization code from the Daikin redirect for tokens) failed.',
      title: 'Why did the login fail?',
    });
  },

  finish() {
    Polling.stop();
    this.hide();
    Auth.loadStatus();
    Devices.load();
  },

  openAuthUrl() {
    if (State.authUrl) {
      window.open(State.authUrl, '_blank');
    }
  },
};

// ============================================================================
// Polling Module
// ============================================================================

const Polling = {
  isPolling: false,

  start() {
    this.stop();
    this.isPolling = true;
    this.poll();
  },

  stop() {
    this.isPolling = false;
    if (State.intervals.poll) {
      clearTimeout(State.intervals.poll);
      State.intervals.poll = null;
    }
  },

  async poll() {
    if (!this.isPolling) {
      return;
    }

    try {
      const result = await homebridge.request('/auth/poll');
      if (!result.pending) {
        this.stop();
        if (result.success) {
          El.successMessage.textContent = result.message || 'Authentication successful!';
          Wizard.goToStep(3);
          await Config.save();
          Devices.load();
        } else {
          Wizard.authFailed('Authentication failed: ' + (result.error || 'Unknown error'));
        }
        return;
      }
    } catch (error) {
      console.error('Polling error:', error);
    }

    if (this.isPolling) {
      State.intervals.poll = setTimeout(() => this.poll(), 1500);
    }
  },
};

// ============================================================================
// Configuration Module
// ============================================================================

const Config = {
  async load() {
    try {
      const config = await homebridge.getPluginConfig();
      if (config?.[0]) {
        this.populateForm(config[0]);
      }
      await this.prefillServerAddress();
    } catch (error) {
      console.error('Config load failed:', error);
    }
  },

  async prefillServerAddress() {
    const field = $id('callbackServerExternalAddress');
    if (!field || field.value.trim()) {
      return;
    }

    try {
      const { primaryIp } = await homebridge.request('/server/info');
      if (primaryIp) {
        field.value = primaryIp;
        field.placeholder = primaryIp;
      }
    } catch (error) {
      console.error('Server IP fetch failed:', error);
    }
  },

  populateForm(config) {
    ['clientId', 'clientSecret', 'callbackServerExternalAddress', 'callbackServerPort'].forEach(field => {
      const el = $id(field);
      if (el && config[field]) {
        el.value = config[field];
      }
    });
  },

  async save() {
    try {
      const config = await homebridge.getPluginConfig();
      const platformConfig = config[0] || { platform: 'DaikinCloud', name: 'Daikin Cloud' };
      Object.assign(platformConfig, Wizard.getFormConfig());
      await homebridge.updatePluginConfig([platformConfig]);
      await homebridge.savePluginConfig();
    } catch (error) {
      console.error('Config save failed:', error);
    }
  },
};

// ============================================================================
// Device List Request (shared)
// ============================================================================

/**
 * Settings and Devices both need /devices/list on page load. Share one
 * in-flight request so the page spends at most one API call; an explicit
 * refresh bypasses both this and the server-side cache.
 */
const DeviceList = {
  _inFlight: null,
  _mode: null,

  fetch({ refresh = false } = {}) {
    const mode = AuthMode.current;
    if (!refresh && this._inFlight && this._mode === mode) {
      return this._inFlight;
    }

    const request = homebridge.request('/devices/list', { mode, refresh })
      .finally(() => {
        if (this._inFlight === request) {
          this._inFlight = null;
        }
      });
    this._inFlight = request;
    this._mode = mode;
    return request;
  },
};

// ============================================================================
// Settings Module
// ============================================================================

const Settings = {
  devices: [],
  excludedIds: [],
  saveTimeout: null,
  toggleListenerAttached: false,

  // Feature switches that honour the legacy "Show Extra Features" flag as their default.
  FEATURE_KEYS: [
    'showPowerfulMode', 'showEconoMode', 'showStreamerMode',
    'showOutdoorSilentMode', 'showIndoorSilentMode', 'showAutoFanMode',
    'showOscillationSwitch', 'showDryMode', 'showFanOnlyMode',
    'showHolidayMode',
  ],

  // Standalone toggles that default to off (never enabled implicitly by the legacy flag).
  STANDALONE_KEYS: ['showSeparateFanControl', 'showFirmwareUpdateSwitch'],

  async load() {
    try {
      const config = await homebridge.getPluginConfig();
      if (config?.[0]) {
        this.populateForm(config[0]);
        this.excludedIds = config[0].excludedDevicesByDeviceId || [];
      }
      await this.loadDeviceToggles();
      this.setupAutoSave();
    } catch (error) {
      console.error('Settings load failed:', error);
    }
  },

  setupAutoSave() {
    const handler = () => this.autoSave();

    // Feature toggles + WebSocket
    [...this.FEATURE_KEYS, ...this.STANDALONE_KEYS, 'enableWebSocket'].forEach(id => {
      $id(id)?.addEventListener('change', handler);
    });

    $id('httpTransport')?.addEventListener('change', handler);

    // Number/text inputs
    ['updateIntervalInMinutes', 'forceUpdateDelay', 'oidcCallbackServerBindAddr'].forEach(id => {
      const el = $id(id);
      el?.addEventListener('change', handler);
      el?.addEventListener('input', handler);
    });
  },

  autoSave() {
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      if (this.validateInputs()) {
        this.save();
      }
    }, 500);
  },

  validateInputs() {
    const validators = [
      ['oidcCallbackServerBindAddr', (v) => Utils.isValidIPv4(v.trim())],
      ['updateIntervalInMinutes', (v) => Utils.isValidNumber(v, 1, 60)],
      ['forceUpdateDelay', (v) => Utils.isValidNumber(v, 1, 300)],
    ];

    return validators.every(([id, validate]) => {
      const el = $id(id);
      const valid = !el || validate(el.value);
      DOM.setValid(el, valid);
      return valid;
    });
  },

  populateForm(config) {
    const showAllLegacy = config.showExtraFeatures === true;

    // Same rule as the plugin (resolveFeatures in config-manager): only a boolean
    // overrides; absent or null follows showExtraFeatures.
    this.FEATURE_KEYS.forEach(key => {
      const el = $id(key);
      if (el) {
        el.checked = typeof config[key] === 'boolean' ? config[key] : showAllLegacy;
      }
    });

    // Standalone toggles never inherit the legacy flag — default to off.
    this.STANDALONE_KEYS.forEach(key => {
      const el = $id(key);
      if (el) {
        el.checked = config[key] === true;
      }
    });

    const updateInterval = $id('updateIntervalInMinutes');
    if (updateInterval) {
      updateInterval.value = config.updateIntervalInMinutes || 15;
    }

    const forceDelay = $id('forceUpdateDelay');
    if (forceDelay) {
      forceDelay.value = Math.round((config.forceUpdateDelay || 60000) / 1000);
    }

    const bindAddr = $id('oidcCallbackServerBindAddr');
    if (bindAddr) {
      bindAddr.value = config.oidcCallbackServerBindAddr || '0.0.0.0';
    }

    const transport = $id('httpTransport');
    if (transport) {
      transport.value = config.httpTransport === 'curl' ? 'curl' : 'node';
    }

    const enableWS = $id('enableWebSocket');
    if (enableWS) {
      enableWS.checked = config.enableWebSocket !== false;
    }
  },

  async loadDeviceToggles() {
    const loading = $id('device-toggles-loading');
    const list = $id('device-toggles-list');
    const empty = $id('device-toggles-empty');

    DOM.show(loading);
    list.innerHTML = '';
    DOM.hide(empty);

    try {
      const result = await DeviceList.fetch();
      DOM.hide(loading);

      if (!result.success) {
        empty.innerHTML = `<p class="mb-0">${Utils.escapeHtml(result.message || 'No devices found. Authenticate first to see your devices.')}</p>`;
        DOM.show(empty);
        return;
      }

      if (!result.devices.length) {
        empty.innerHTML = '<p class="mb-0">No devices found. Authenticate first to see your devices.</p>';
        DOM.show(empty);
        return;
      }

      this.devices = result.devices;
      list.innerHTML = this.devices.map((d, i) => this.renderDeviceToggle(d, i)).join('');

      if (!this.toggleListenerAttached) {
        this.toggleListenerAttached = true;
        list.addEventListener('change', (e) => {
          if (e.target.classList.contains('device-visibility-toggle')) {
            const idx = parseInt(e.target.dataset.index, 10);
            const device = this.devices[idx];
            if (device) {
              this.toggleDevice(device.id, e.target.checked, idx);
            }
          }
        });
      }
    } catch (error) {
      DOM.hide(loading);
      empty.innerHTML = `<p class="mb-0">Failed to load: ${Utils.escapeHtml(error.message)}</p>`;
      DOM.show(empty);
    }
  },

  renderDeviceToggle(device, index) {
    const visible = !this.excludedIds.includes(device.id);
    return `
            <div class="list-group-item d-flex justify-content-between align-items-center gap-3">
                <div class="min-w-0">
                    <div class="fw-medium">${Utils.escapeHtml(device.name)}</div>
                    <small class="device-id text-muted">${Utils.escapeHtml(device.id)}</small>
                </div>
                <div class="d-flex align-items-center gap-2 flex-shrink-0">
                    <span class="device-toggle-label small ${visible ? 'visible' : 'hidden-label'}" data-label-index="${index}">${visible ? 'Visible' : 'Hidden'}</span>
                    <div class="form-check form-switch mb-0">
                        <input type="checkbox" class="form-check-input device-visibility-toggle" role="switch" data-index="${index}" ${visible ? 'checked' : ''}>
                    </div>
                </div>
            </div>`;
  },

  toggleDevice(deviceId, visible, index) {
    const label = $(`[data-label-index="${index}"]`);

    if (visible) {
      this.excludedIds = this.excludedIds.filter(id => id !== deviceId);
    } else if (!this.excludedIds.includes(deviceId)) {
      this.excludedIds.push(deviceId);
    }

    if (label) {
      label.textContent = visible ? 'Visible' : 'Hidden';
      label.className = `device-toggle-label small ${visible ? 'visible' : 'hidden-label'}`;
    }

    this.autoSave();
  },

  getFormSettings() {
    const settings = {
      updateIntervalInMinutes: parseInt($id('updateIntervalInMinutes')?.value, 10) || 15,
      forceUpdateDelay: (parseInt($id('forceUpdateDelay')?.value, 10) || 60) * 1000,
      oidcCallbackServerBindAddr: $id('oidcCallbackServerBindAddr')?.value?.trim() || '0.0.0.0',
      excludedDevicesByDeviceId: this.excludedIds,
      enableWebSocket: $id('enableWebSocket')?.checked ?? true,
      httpTransport: $id('httpTransport')?.value === 'curl' ? 'curl' : 'node',
    };

    [...this.FEATURE_KEYS, ...this.STANDALONE_KEYS].forEach(key => {
      const el = $id(key);
      if (el) {
        settings[key] = el.checked;
      }
    });

    return settings;
  },

  async save() {
    const status = $id('settings-status');

    try {
      this.showStatus(status, 'saving', 'Saving...');
      const config = await homebridge.getPluginConfig();
      const platformConfig = config[0] || { platform: 'DaikinCloud', name: 'Daikin Cloud' };
      Object.assign(platformConfig, this.getFormSettings());
      await homebridge.updatePluginConfig([platformConfig]);
      await homebridge.savePluginConfig();
      this.showStatus(status, 'saved', 'Saved');
    } catch (error) {
      this.showStatus(status, 'error', 'Failed');
      console.error('Settings save failed:', error);
    }
  },

  showStatus(el, type, message) {
    if (!el) {
      return;
    }
    el.className = `badge ${type}`;
    el.textContent = message;
    DOM.show(el);
    if (type === 'saved') {
      setTimeout(() => DOM.hide(el), 2000);
    }
  },
};

// ============================================================================
// Devices Module
// ============================================================================

const Devices = {
  items: [],

  async load({ refresh = false } = {}) {
    DOM.show(El.devicesLoading);
    El.devicesList.innerHTML = '';
    DOM.hide(El.devicesEmpty);
    DOM.hide(El.devicesError);
    Assistant.clear('devices-problem');
    this.items = [];

    try {
      const result = await DeviceList.fetch({ refresh });
      DOM.hide(El.devicesLoading);

      if (!result.success) {
        this.handleError(result);
        return;
      }

      if (!result.devices.length) {
        DOM.show(El.devicesEmpty);
        return;
      }

      this.items = result.devices;
      El.devicesList.innerHTML = result.devices.map((d, i) => this.render(d, i)).join('');
    } catch (error) {
      DOM.hide(El.devicesLoading);
      El.devicesError.textContent = 'Failed to load: ' + error.message;
      DOM.show(El.devicesError);
      this.offerExplain(El.devicesError.textContent);
    }
  },

  offerExplain(message) {
    Assistant.offer('devices-problem', {
      message,
      context: 'Loading the device list (GET /v1/gateway-devices on the Daikin Onecta API) in the plugin settings failed.',
      title: 'Why did loading devices fail?',
    });
  },

  // Why a device needs attention, or null when it looks fine
  problem(device) {
    if (!device.online) {
      return 'The Daikin Onecta cloud reports this unit as offline: its Wi-Fi adapter has no cloud connection (isCloudConnectionUp is false), so HomeKit cannot control it.';
    }
    return null;
  },

  onListClick(e) {
    const button = e.target.closest('.js-explain-device');
    const row = button && button.closest('[data-device-index]');
    const device = row && this.items[Number(row.dataset.deviceIndex)];
    if (!device) {
      return;
    }
    Assistant.explain(button, row.querySelector('.assistant-answer'), {
      error: this.problem(device) || 'The unit does not respond as expected.',
      context: Assistant.context('The user is looking at the device list of the Daikin Cloud plugin settings.'),
      device: Assistant.device(device),
      title: `Why does ${device.name || 'this unit'} need attention?`,
    });
  },

  handleError(result) {
    if (result.message?.includes('Not authenticated')) {
      El.devicesEmpty.innerHTML = `
                <i class="bi bi-lock fs-1 mb-2 opacity-50 d-block text-center"></i>
                <p class="mb-1">Please authenticate first</p>
                <p class="text-muted small">Go to Authentication tab to connect.</p>`;
      DOM.show(El.devicesEmpty);
    } else {
      El.devicesError.textContent = result.message;
      DOM.show(El.devicesError);
      this.offerExplain(result.message);
    }
  },

  render(device, index) {
    const online = device.online;
    const powerOn = device.powerState === 'on';
    const mode = device.operationMode ? Utils.capitalize(device.operationMode) : '-';
    const features = device.features?.length
      ? device.features.map(f => `<span class="badge bg-secondary bg-opacity-50">${Utils.escapeHtml(f)}</span>`).join('')
      : '';

    const meta = [
      device.roomTemp ? `<span class="device-meta-item">Room: <span class="text-body-secondary">${Utils.escapeHtml(device.roomTemp)}</span></span>` : '',
      device.outdoorTemp ? `<span class="device-meta-item">Outdoor: <span class="text-body-secondary">${Utils.escapeHtml(device.outdoorTemp)}</span></span>` : '',
      `<span class="device-meta-item">Mode: <span class="text-body-secondary">${Utils.escapeHtml(mode)}</span></span>`,
      `<span class="device-meta-item">Model: <span class="text-body-secondary">${Utils.escapeHtml(device.model)}</span></span>`,
    ].filter(Boolean).join('<span class="device-meta-sep">·</span>');

    const explainButton = Assistant.enabled && this.problem(device)
      ? MpKit.ai.renderButton({ label: 'Explain', size: 'sm', className: 'js-explain-device', title: 'Explain this device problem' })
      : '';

    return `
            <div class="list-group-item" data-device-index="${index}">
                <div class="device-header">
                    <span class="device-power ${powerOn ? 'power-on' : 'power-off'}">${powerOn ? 'ON' : 'OFF'}</span>
                    <span class="device-name fw-semibold">${Utils.escapeHtml(device.name)}</span>
                    ${features ? `<div class="device-features">${features}</div>` : ''}
                    ${explainButton}
                    <span class="device-status ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>
                </div>
                <div class="device-meta mt-1">${meta}</div>
                <div class="assistant-answer mt-2 d-none"></div>
            </div>`;
  },

  async refresh() {
    // Bypass the shared request and the server cache, then let the Settings
    // device toggles reuse the same fresh request.
    const pending = this.load({ refresh: true });
    Settings.loadDeviceToggles();
    await pending;
  },
};

// ============================================================================
// Rate Limit Module
// ============================================================================

const RateLimit = {
  MODE_LABELS: { developer_portal: 'Developer Portal', mobile_app: 'Mobile App' },

  async check() {
    const display = El.rateLimitDisplay;
    const updated = El.rateLimitUpdated;
    display.textContent = 'Checking...';
    DOM.hide(updated);

    try {
      // Reads the status the running plugin last recorded; no API call is made.
      const result = await homebridge.request('/api/rate-limit', { mode: AuthMode.current });
      if (result.success && result.rateLimit) {
        const { limitDay, remainingDay, limitMinute, remainingMinute } = result.rateLimit;
        let text = remainingDay !== undefined ? `${remainingDay}/${limitDay} daily` : '';
        if (remainingMinute !== undefined) {
          text += text ? `, ${remainingMinute}/${limitMinute}/min` : `${remainingMinute}/${limitMinute}/min`;
        }
        display.textContent = text || 'No rate limit headers in the last response';
        this.showUpdated(updated, result);
      } else {
        display.textContent = result.message || 'No info';
      }
    } catch (error) {
      display.textContent = 'Error: ' + error.message;
    }
  },

  showUpdated(el, result) {
    if (!el || !result.updatedAt) {
      return;
    }
    const parts = [`as of ${new Date(result.updatedAt).toLocaleString()}`];
    if (typeof result.ageMs === 'number') {
      parts.push(`(${Utils.formatTime(result.ageMs)} ago)`);
    }
    if (result.mode && result.mode !== AuthMode.current) {
      parts.push(`— recorded in ${this.MODE_LABELS[result.mode] || result.mode} mode`);
    }
    el.textContent = parts.join(' ');
    DOM.show(el);
  },
};

// ============================================================================
// Mobile Auth Module
// ============================================================================

const MobileAuth = {
  show() {
    DOM.show($id('mobile-auth-form'));
    DOM.hide($id('auth-status-card'));
    this.loadCredentials();
  },

  hide() {
    DOM.hide($id('mobile-auth-form'));
    DOM.show($id('auth-status-card'));
    DOM.hide($id('mobile-auth-errors'));
    DOM.hide($id('mobile-auth-success'));
  },

  async loadCredentials() {
    try {
      const config = await homebridge.getPluginConfig();
      if (config?.[0]) {
        const email = $id('daikinEmail');
        const pass = $id('daikinPassword');
        if (email && config[0].daikinEmail) {
          email.value = config[0].daikinEmail;
        }
        if (pass && config[0].daikinPassword) {
          pass.value = config[0].daikinPassword;
        }
      }
    } catch (error) {
      console.error('Credential load failed:', error);
    }
  },

  async test() {
    const email = $id('daikinEmail')?.value.trim();
    const password = $id('daikinPassword')?.value;
    const errors = $id('mobile-auth-errors');
    const success = $id('mobile-auth-success');
    const btn = $id('btn-test-mobile-auth');

    DOM.hide(errors);
    DOM.hide(success);
    Assistant.clear('mobile-auth-problem');

    if (!email || !password) {
      errors.textContent = 'Please enter email and password';
      DOM.show(errors);
      return;
    }

    UI.setButtonLoading(btn, true, 'Testing...');

    try {
      const result = await homebridge.request('/auth/mobile-test', { email, password });

      if (result.success) {
        await this.saveCredentials(email, password);
        success.innerHTML = `
                    <strong>Success!</strong> Found ${Utils.escapeHtml(result.deviceCount || 0)} device(s).<br>
                    Rate limit: ${Utils.escapeHtml(result.rateLimit?.remainingDay ?? '?')}/${Utils.escapeHtml(result.rateLimit?.limitDay ?? '3000')}/day<br>
                    <small>Restart Homebridge to apply.</small>`;
        DOM.show(success);
        setTimeout(() => {
          this.hide();
          Auth.loadStatus();
          Devices.load();
        }, 2000);
      } else {
        errors.textContent = result.message || 'Authentication failed';
        DOM.show(errors);
        this.offerExplain(errors.textContent);
      }
    } catch (error) {
      errors.textContent = 'Failed: ' + error.message;
      DOM.show(errors);
      this.offerExplain(errors.textContent);
    }

    UI.setButtonLoading(btn, false, null, 'Test & Save Credentials');
  },

  offerExplain(message) {
    Assistant.offer('mobile-auth-problem', {
      message,
      context: 'Mobile App login (Onecta account, Gigya login at id.daikin.eu, then OIDC token exchange) from the plugin settings failed.',
      title: 'Why did the Mobile App login fail?',
    });
  },

  async saveCredentials(email, password) {
    const config = await homebridge.getPluginConfig();
    const platformConfig = config[0] || { platform: 'DaikinCloud', name: 'Daikin Cloud' };
    Object.assign(platformConfig, { authMode: 'mobile_app', daikinEmail: email, daikinPassword: password });
    await homebridge.updatePluginConfig([platformConfig]);
    await homebridge.savePluginConfig();
  },
};

// ============================================================================
// Auth Mode Module
// ============================================================================

const AuthMode = {
  current: 'developer_portal',
  previous: 'developer_portal',

  DEFAULTS: {
    developer_portal: { updateIntervalInMinutes: 15, forceUpdateDelay: 60, enableWebSocket: false },
    mobile_app: { updateIntervalInMinutes: 5, forceUpdateDelay: 10, enableWebSocket: true },
  },

  async init() {
    try {
      const config = await homebridge.getPluginConfig();
      if (config?.[0]?.authMode) {
        this.current = this.previous = config[0].authMode;
      }
    } catch (error) {
      console.error('AuthMode init failed:', error);
    }
    this.updateUI();
  },

  onChange() {
    const select = $id('authMode');
    if (select) {
      this.previous = this.current;
      this.current = select.value;
      this.updateUI();
      this.updateDefaults();
      this.save();
    }
  },

  updateUI() {
    const isMobile = this.current === 'mobile_app';

    $id('authMode').value = this.current;
    $id('auth-mode-hint').textContent = isMobile
      ? 'Use your Daikin Onecta account (same as mobile app)'
      : 'Requires API credentials from the Daikin Developer Portal';

    DOM.toggle($id('btn-authenticate'), !isMobile);
    DOM.toggle($id('btn-authenticate-mobile'), isMobile);

    $id('auth-mode-text').textContent = isMobile ? 'Mobile App' : 'Developer Portal';
    $id('rate-limit-display').textContent = isMobile ? '3000 requests/day' : '200 requests/day';
    $id('rate-limit-info').textContent = `The Daikin API limits you to ${isMobile ? '3000' : '200'} requests per day.`;

    DOM.toggle($id('websocket-setting-row'), isMobile);

    this.updateHints();
  },

  updateHints() {
    const isMobile = this.current === 'mobile_app';
    const interval = $id('updateIntervalInMinutes');
    const delay = $id('forceUpdateDelay');

    if (interval) {
      interval.placeholder = isMobile ? '5 (recommended)' : '15 (recommended)';
      interval.title = isMobile ? '1-5 min (3000 calls/day)' : '15+ min (200 calls/day)';
    }
    if (delay) {
      delay.placeholder = isMobile ? '10 (recommended)' : '60 (recommended)';
      delay.title = isMobile ? '10s recommended' : '60s recommended';
    }
  },

  updateDefaults() {
    if (this.current === this.previous) {
      return;
    }

    const defaults = this.DEFAULTS[this.current];
    $id('updateIntervalInMinutes').value = defaults.updateIntervalInMinutes;
    $id('forceUpdateDelay').value = defaults.forceUpdateDelay;
    $id('enableWebSocket').checked = defaults.enableWebSocket;

    Settings.autoSave();
  },

  async save() {
    try {
      const config = await homebridge.getPluginConfig();
      const platformConfig = config[0] || { platform: 'DaikinCloud', name: 'Daikin Cloud' };
      platformConfig.authMode = this.current;
      await homebridge.updatePluginConfig([platformConfig]);
      await homebridge.savePluginConfig();
    } catch (error) {
      console.error('AuthMode save failed:', error);
    }
  },
};

// ============================================================================
// Global Event Handlers (for HTML onclick)
// ============================================================================

const showWizard = () => Wizard.show();
const hideWizard = () => Wizard.hide();
const goToStep = (step) => Wizard.goToStep(step);
const validateAndProceed = () => Wizard.validateAndProceed();
const openAuthUrl = () => Wizard.openAuthUrl();
const submitCallbackUrl = () => Wizard.submitCallbackUrl();
const finishWizard = () => Wizard.finish();
const testConnection = () => Auth.testConnection();
const revokeAuth = () => Auth.revoke();
const refreshDevices = () => Devices.refresh();
const checkRateLimit = () => RateLimit.check();
const showMobileAuthForm = () => MobileAuth.show();
const hideMobileAuthForm = () => MobileAuth.hide();
const testMobileAuth = () => MobileAuth.test();
const onAuthModeChange = () => AuthMode.onChange();

// ============================================================================
// Initialization
// ============================================================================

function cacheElements() {
  El = {
    statusBadge: $id('status-badge'),
    statusIndicator: $id('status-indicator'),
    statusText: $id('status-text'),
    tokenExpiresLabel: $id('token-expires-label'),
    tokenExpires: $id('token-expires'),
    authStatus: $id('auth-status'),
    authTokenExpires: $id('auth-token-expires'),
    expiresRow: $id('expires-row'),
    btnAuthenticate: $id('btn-authenticate'),
    btnRevoke: $id('btn-revoke'),
    btnTest: $id('btn-test'),
    testResult: $id('test-result'),
    wizard: $id('wizard'),
    authStatusCard: $id('auth-status-card'),
    validationErrors: $id('validation-errors'),
    authUrlContainer: $id('auth-url-container'),
    authUrlDisplay: $id('auth-url'),
    callbackServerStatus: $id('callback-server-status'),
    successMessage: $id('success-message'),
    devicesLoading: $id('devices-loading'),
    devicesList: $id('devices-list'),
    devicesEmpty: $id('devices-empty'),
    devicesError: $id('devices-error'),
    settingsStatus: $id('settings-status'),
    rateLimitDisplay: $id('rate-limit-display'),
    rateLimitUpdated: $id('rate-limit-updated'),
    loading: $id('loading'),
    globalError: $id('global-error'),
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  // Confirm theme from Homebridge settings (overrides the early OS-preference detection)
  try {
    const settings = await homebridge.getUserSettings();
    const scheme = settings.colorScheme;
    if (scheme === 'dark' || scheme === 'light') {
      document.documentElement.dataset.bsTheme = scheme;
    } else if (scheme === 'auto') {
      document.documentElement.dataset.bsTheme =
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch {
    // getUserSettings not available in older versions — keep the early-detected theme
  }
  cacheElements();
  await Assistant.init();
  El.devicesList.addEventListener('click', (e) => Devices.onListClick(e));
  Auth.loadStatus();
  Config.load();
  await AuthMode.init();
  Settings.load();
  Devices.load();
});
