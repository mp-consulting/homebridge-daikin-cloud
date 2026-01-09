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
        div.textContent = text;
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
        if (!ip) return true;
        return /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.){3}(25[0-5]|(2[0-4]|1\d|[1-9]|)\d)$/.test(ip);
    },

    formatTime(ms) {
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);

        if (days > 0) return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
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
        if (!btn) return;
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
        if (!State.tokenExpiresAt) return;

        const diff = State.tokenExpiresAt - Date.now();

        if (diff <= 0) {
            [El.tokenExpires, El.authTokenExpires].forEach(el => {
                if (el) el.textContent = 'Expired';
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

        try {
            const result = await homebridge.request('/auth/test');
            El.testResult.className = `alert ${result.success ? 'alert-success' : 'alert-danger'}`;
            El.testResult.textContent = result.message;
            DOM.show(El.testResult);
        } catch (error) {
            El.testResult.className = 'alert alert-danger';
            El.testResult.textContent = 'Test failed: ' + error.message;
            DOM.show(El.testResult);
        }

        UI.setButtonLoading(El.btnTest, false, null, 'Test Connection');
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
            if (i < step) stepEl.classList.add('completed');
            else if (i === step) stepEl.classList.add('active');
        }
    },

    async validateAndProceed() {
        if (State.isValidating) return;
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
                El.validationErrors.innerHTML = validation.errors.map(e => `<div>${e}</div>`).join('');
                DOM.show(El.validationErrors);
                UI.hideLoading();
                State.isValidating = false;
                return;
            }

            DOM.hide(El.validationErrors);
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
            El.validationErrors.innerHTML = `<div>${error.message}</div>`;
            DOM.show(El.validationErrors);
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
        if (!url) return UI.showError('Please paste the callback URL');
        if (!url.includes('code=')) return UI.showError('Invalid URL - must contain code parameter');

        UI.showLoading();
        try {
            const result = await homebridge.request('/auth/', { callbackUrl: url });
            if (result.success) {
                El.successMessage.textContent = result.message;
                this.goToStep(3);
                await Config.save();
            } else {
                UI.showError('Authentication failed: ' + (result.message || 'Unknown error'));
            }
        } catch (error) {
            UI.showError('Authentication failed: ' + error.message);
        }
        UI.hideLoading();
    },

    finish() {
        Polling.stop();
        this.hide();
        Auth.loadStatus();
        Devices.load();
    },

    openAuthUrl() {
        if (State.authUrl) window.open(State.authUrl, '_blank');
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
        if (!this.isPolling) return;

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
                    UI.showError('Authentication failed: ' + (result.error || 'Unknown error'));
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
        if (!field || field.value.trim()) return;

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
            if (el && config[field]) el.value = config[field];
        });
    },

    async save() {
        try {
            const config = await homebridge.getPluginConfig();
            const platformConfig = config[0] || { platform: 'DaikinCloud' };
            Object.assign(platformConfig, Wizard.getFormConfig());
            await homebridge.updatePluginConfig([platformConfig]);
            await homebridge.savePluginConfig();
        } catch (error) {
            console.error('Config save failed:', error);
        }
    },
};

// ============================================================================
// Settings Module
// ============================================================================

const Settings = {
    devices: [],
    excludedIds: [],
    saveTimeout: null,

    FEATURE_KEYS: [
        'showPowerfulMode', 'showEconoMode', 'showStreamerMode',
        'showOutdoorSilentMode', 'showIndoorSilentMode', 'showDryMode', 'showFanOnlyMode',
    ],

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
        [...this.FEATURE_KEYS, 'enableWebSocket'].forEach(id => {
            $id(id)?.addEventListener('change', handler);
        });

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
            if (this.validateInputs()) this.save();
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

        this.FEATURE_KEYS.forEach(key => {
            const el = $id(key);
            if (el) el.checked = key in config ? config[key] === true : showAllLegacy;
        });

        const updateInterval = $id('updateIntervalInMinutes');
        if (updateInterval) updateInterval.value = config.updateIntervalInMinutes || 15;

        const forceDelay = $id('forceUpdateDelay');
        if (forceDelay) forceDelay.value = Math.round((config.forceUpdateDelay || 60000) / 1000);

        const bindAddr = $id('oidcCallbackServerBindAddr');
        if (bindAddr) bindAddr.value = config.oidcCallbackServerBindAddr || '0.0.0.0';

        const enableWS = $id('enableWebSocket');
        if (enableWS) enableWS.checked = config.enableWebSocket !== false;
    },

    async loadDeviceToggles() {
        const loading = $id('device-toggles-loading');
        const list = $id('device-toggles-list');
        const empty = $id('device-toggles-empty');

        DOM.show(loading);
        list.innerHTML = '';
        DOM.hide(empty);

        try {
            const result = await homebridge.request('/devices/list');
            DOM.hide(loading);

            if (!result.success || !result.devices.length) {
                DOM.show(empty);
                return;
            }

            this.devices = result.devices;
            list.innerHTML = this.devices.map((d, i) => this.renderDeviceToggle(d, i)).join('');

            list.addEventListener('change', (e) => {
                if (e.target.classList.contains('device-visibility-toggle')) {
                    const idx = parseInt(e.target.dataset.index, 10);
                    const device = this.devices[idx];
                    if (device) this.toggleDevice(device.id, e.target.checked, idx);
                }
            });
        } catch (error) {
            DOM.hide(loading);
            empty.innerHTML = `<p>Failed to load: ${error.message}</p>`;
            DOM.show(empty);
        }
    },

    renderDeviceToggle(device, index) {
        const visible = !this.excludedIds.includes(device.id);
        return `
            <div class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                    <div class="fw-medium">${Utils.escapeHtml(device.name)}</div>
                    <small class="text-muted">${Utils.escapeHtml(device.id)}</small>
                </div>
                <div class="d-flex align-items-center gap-2">
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
        };

        this.FEATURE_KEYS.forEach(key => {
            const el = $id(key);
            if (el) settings[key] = el.checked;
        });

        return settings;
    },

    async save() {
        const status = $id('settings-status');

        try {
            this.showStatus(status, 'saving', 'Saving...');
            const config = await homebridge.getPluginConfig();
            const platformConfig = config[0] || { platform: 'DaikinCloud' };
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
        if (!el) return;
        el.className = `badge ${type}`;
        el.textContent = message;
        DOM.show(el);
        if (type === 'saved') setTimeout(() => DOM.hide(el), 2000);
    },
};

// ============================================================================
// Devices Module
// ============================================================================

const Devices = {
    async load() {
        DOM.show(El.devicesLoading);
        El.devicesList.innerHTML = '';
        DOM.hide(El.devicesEmpty);
        DOM.hide(El.devicesError);

        try {
            const result = await homebridge.request('/devices/list');
            DOM.hide(El.devicesLoading);

            if (!result.success) {
                this.handleError(result);
                return;
            }

            if (!result.devices.length) {
                DOM.show(El.devicesEmpty);
                return;
            }

            El.devicesList.innerHTML = result.devices.map(d => this.render(d)).join('');
        } catch (error) {
            DOM.hide(El.devicesLoading);
            El.devicesError.textContent = 'Failed to load: ' + error.message;
            DOM.show(El.devicesError);
        }
    },

    handleError(result) {
        if (result.message?.includes('Not authenticated')) {
            El.devicesEmpty.innerHTML = `
                <div class="fs-1 mb-2 opacity-50">🔐</div>
                <p class="mb-1">Please authenticate first</p>
                <p class="text-muted small">Go to Authentication tab to connect.</p>`;
            DOM.show(El.devicesEmpty);
        } else {
            El.devicesError.textContent = result.message;
            DOM.show(El.devicesError);
        }
    },

    render(device) {
        const online = device.online;
        const powerOn = device.powerState === 'on';
        const mode = device.operationMode ? Utils.capitalize(device.operationMode) : '-';
        const features = device.features?.length
            ? `<div class="mt-2">${device.features.map(f => `<span class="badge bg-secondary me-1">${f}</span>`).join('')}</div>`
            : '';

        return `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <div class="fw-semibold">${Utils.escapeHtml(device.name)}</div>
                    <div class="d-flex gap-1">
                        <span class="device-power ${powerOn ? 'power-on' : 'power-off'}">${powerOn ? 'ON' : 'OFF'}</span>
                        <span class="device-status ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-3 small text-muted">
                    ${device.roomTemp ? `<span><strong>Room:</strong> ${Utils.escapeHtml(device.roomTemp)}</span>` : ''}
                    ${device.outdoorTemp ? `<span><strong>Outdoor:</strong> ${Utils.escapeHtml(device.outdoorTemp)}</span>` : ''}
                    <span><strong>Mode:</strong> ${Utils.escapeHtml(mode)}</span>
                    <span><strong>Model:</strong> ${Utils.escapeHtml(device.model)}</span>
                </div>
                ${features}
            </div>`;
    },

    refresh() { this.load(); },
};

// ============================================================================
// Rate Limit Module
// ============================================================================

const RateLimit = {
    async check() {
        const display = El.rateLimitDisplay;
        display.textContent = 'Checking...';

        try {
            const result = await homebridge.request('/api/rate-limit', { mode: AuthMode.current });
            if (result.success && result.rateLimit) {
                const { limitDay, remainingDay, limitMinute, remainingMinute } = result.rateLimit;
                let text = remainingDay !== undefined ? `${remainingDay}/${limitDay} daily` : '';
                if (remainingMinute !== undefined) {
                    text += text ? `, ${remainingMinute}/${limitMinute}/min` : `${remainingMinute}/${limitMinute}/min`;
                }
                display.textContent = text || 'No rate limit headers';
            } else {
                display.textContent = result.message || 'No info';
            }
        } catch (error) {
            display.textContent = 'Error: ' + error.message;
        }
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
                if (email && config[0].daikinEmail) email.value = config[0].daikinEmail;
                if (pass && config[0].daikinPassword) pass.value = config[0].daikinPassword;
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
                    <strong>Success!</strong> Found ${result.deviceCount || 0} device(s).<br>
                    Rate limit: ${result.rateLimit?.remainingDay || '?'}/${result.rateLimit?.limitDay || '5000'}/day<br>
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
            }
        } catch (error) {
            errors.textContent = 'Failed: ' + error.message;
            DOM.show(errors);
        }

        UI.setButtonLoading(btn, false, null, 'Test & Save Credentials');
    },

    async saveCredentials(email, password) {
        const config = await homebridge.getPluginConfig();
        const platformConfig = config[0] || { platform: 'DaikinCloud' };
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
        $id('rate-limit-display').textContent = isMobile ? '5000 requests/day' : '200 requests/day';
        $id('rate-limit-info').textContent = `The Daikin API limits you to ${isMobile ? '5000' : '200'} requests per day.`;

        DOM.toggle($id('websocket-setting-row'), isMobile);

        this.updateHints();
    },

    updateHints() {
        const isMobile = this.current === 'mobile_app';
        const interval = $id('updateIntervalInMinutes');
        const delay = $id('forceUpdateDelay');

        if (interval) {
            interval.placeholder = isMobile ? '5 (recommended)' : '15 (recommended)';
            interval.title = isMobile ? '1-5 min (5000 calls/day)' : '15+ min (200 calls/day)';
        }
        if (delay) {
            delay.placeholder = isMobile ? '10 (recommended)' : '60 (recommended)';
            delay.title = isMobile ? '10s recommended' : '60s recommended';
        }
    },

    updateDefaults() {
        if (this.current === this.previous) return;

        const defaults = this.DEFAULTS[this.current];
        $id('updateIntervalInMinutes').value = defaults.updateIntervalInMinutes;
        $id('forceUpdateDelay').value = defaults.forceUpdateDelay;
        $id('enableWebSocket').checked = defaults.enableWebSocket;

        Settings.autoSave();
    },

    async save() {
        try {
            const config = await homebridge.getPluginConfig();
            const platformConfig = config[0] || { platform: 'DaikinCloud' };
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
        loading: $id('loading'),
        globalError: $id('global-error'),
    };
}

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    Auth.loadStatus();
    Config.load();
    Settings.load();
    Devices.load();
    AuthMode.init();
});
