/**
 * Daikin Cloud Homebridge UI
 * Main application script
 */

const DaikinUI = {
    // Application state
    state: {
        currentStep: 1,
        authState: null,
        authUrl: null,
        pollInterval: null,
        countdownInterval: null,
        tokenExpiresAt: null,
        isValidating: false,
    },

    // DOM element cache
    elements: {},

    /**
     * Initialize the application
     */
    init() {
        this.cacheElements();
        this.loadStatus();
        this.loadSavedConfig();
        this.loadDevices();
    },

    /**
     * Cache frequently used DOM elements
     */
    cacheElements() {
        this.elements = {
            statusBadge: document.getElementById('status-badge'),
            statusText: document.getElementById('status-text'),
            authStatus: document.getElementById('auth-status'),
            expiresRow: document.getElementById('expires-row'),
            tokenExpires: document.getElementById('token-expires'),
            btnAuthenticate: document.getElementById('btn-authenticate'),
            btnRevoke: document.getElementById('btn-revoke'),
            btnTest: document.getElementById('btn-test'),
            wizardCard: document.getElementById('wizard-card'),
            statusCard: document.getElementById('status-card'),
            validationErrors: document.getElementById('validation-errors'),
            authUrlContainer: document.getElementById('auth-url-container'),
            authUrlDisplay: document.getElementById('auth-url'),
            callbackServerStatus: document.getElementById('callback-server-status'),
            successMessage: document.getElementById('success-message'),
            testResult: document.getElementById('test-result'),
            loading: document.getElementById('loading'),
            globalError: document.getElementById('global-error'),
            devicesLoading: document.getElementById('devices-loading'),
            devicesList: document.getElementById('devices-list'),
            devicesEmpty: document.getElementById('devices-empty'),
            devicesError: document.getElementById('devices-error'),
            rateLimitDisplay: document.getElementById('rate-limit-display'),
        };
    },
};

/**
 * Authentication Module
 */
const Auth = {
    /**
     * Load authentication status from server
     */
    async loadStatus() {
        try {
            const response = await homebridge.request('/auth/status');
            this.updateStatusUI(response);
        } catch (error) {
            console.error('Failed to load status:', error);
            this.updateStatusUI({ authenticated: false, error: error.message });
        }
    },

    /**
     * Update the status UI based on authentication state
     */
    updateStatusUI(status) {
        const { elements } = DaikinUI;
        const indicator = elements.statusBadge?.querySelector('.status-indicator');

        if (status.authenticated) {
            this.setAuthenticatedState(status, indicator);
        } else {
            this.setUnauthenticatedState(status, indicator);
        }
    },

    /**
     * Set UI for authenticated state
     */
    setAuthenticatedState(status, indicator) {
        const { elements } = DaikinUI;

        if (status.isExpired) {
            elements.statusBadge.className = 'status-badge expired';
            indicator.className = 'status-indicator yellow';
            elements.statusText.textContent = 'Expired';
            elements.authStatus.textContent = status.canRefresh
                ? 'Token expired (will auto-refresh)'
                : 'Token expired';
        } else {
            elements.statusBadge.className = 'status-badge authenticated';
            indicator.className = 'status-indicator green';
            elements.statusText.textContent = 'Connected';
            elements.authStatus.textContent = 'Authenticated and ready';
        }

        if (status.expiresAt) {
            elements.expiresRow.style.display = 'flex';
            DaikinUI.state.tokenExpiresAt = new Date(status.expiresAt);
            Countdown.start();
        } else {
            Countdown.stop();
        }

        elements.btnAuthenticate.textContent = 'Re-authenticate';
        elements.btnRevoke.style.display = 'inline-flex';
        elements.btnTest.disabled = false;
    },

    /**
     * Set UI for unauthenticated state
     */
    setUnauthenticatedState(status, indicator) {
        const { elements } = DaikinUI;

        elements.statusBadge.className = 'status-badge not-authenticated';
        indicator.className = 'status-indicator red';
        elements.statusText.textContent = 'Not Connected';
        elements.authStatus.textContent = status.error || 'Authentication required';
        elements.expiresRow.style.display = 'none';
        elements.btnAuthenticate.textContent = 'Authenticate';
        elements.btnRevoke.style.display = 'none';
        elements.btnTest.disabled = true;
        Countdown.stop();
    },

    /**
     * Start the OAuth authentication flow
     */
    async startAuth(config) {
        const result = await homebridge.request('/auth/start', config);
        DaikinUI.state.authState = result.state;
        DaikinUI.state.authUrl = result.authUrl;
        return result;
    },

    /**
     * Submit authorization code manually
     */
    async submitCode(code) {
        return await homebridge.request('/auth/callback', {
            code,
            state: DaikinUI.state.authState,
        });
    },

    /**
     * Revoke authentication
     */
    async revoke() {
        UI.showLoading();
        try {
            const config = await homebridge.getPluginConfig();
            const platformConfig = config[0] || {};

            await homebridge.request('/auth/revoke', {
                clientId: platformConfig.clientId,
                clientSecret: platformConfig.clientSecret,
            });

            this.loadStatus();
        } catch (error) {
            UI.showError('Failed to revoke: ' + error.message);
        }
        UI.hideLoading();
    },

    /**
     * Test the connection to Daikin API
     */
    async testConnection() {
        const { elements } = DaikinUI;

        elements.btnTest.disabled = true;
        elements.btnTest.innerHTML = '<span class="spinner"></span> Testing...';
        elements.testResult.classList.add('hidden');

        try {
            const result = await homebridge.request('/auth/test');
            elements.testResult.classList.remove('hidden', 'alert-success', 'alert-danger');

            if (result.success) {
                elements.testResult.classList.add('alert-success');
            } else {
                elements.testResult.classList.add('alert-danger');
            }
            elements.testResult.textContent = result.message;
        } catch (error) {
            elements.testResult.classList.remove('hidden', 'alert-success');
            elements.testResult.classList.add('alert-danger');
            elements.testResult.textContent = 'Test failed: ' + error.message;
        }

        elements.btnTest.disabled = false;
        elements.btnTest.innerHTML = 'Test Connection';
    },
};

/**
 * Countdown Timer Module
 */
const Countdown = {
    /**
     * Start the countdown timer
     */
    start() {
        this.stop();
        this.update();
        DaikinUI.state.countdownInterval = setInterval(() => this.update(), 1000);
    },

    /**
     * Stop the countdown timer
     */
    stop() {
        if (DaikinUI.state.countdownInterval) {
            clearInterval(DaikinUI.state.countdownInterval);
            DaikinUI.state.countdownInterval = null;
        }
    },

    /**
     * Update the countdown display
     */
    update() {
        const { tokenExpiresAt } = DaikinUI.state;
        const tokenExpires = DaikinUI.elements.tokenExpires;

        if (!tokenExpiresAt || !tokenExpires) return;

        const diff = tokenExpiresAt - new Date();

        if (diff <= 0) {
            tokenExpires.textContent = 'Expired';
            tokenExpires.style.color = 'var(--danger-color)';
            this.stop();
            Auth.loadStatus();
            return;
        }

        tokenExpires.textContent = this.formatTime(diff);
        tokenExpires.style.color = this.getColor(diff);
    },

    /**
     * Format milliseconds into readable time string
     */
    formatTime(ms) {
        const days = Math.floor(ms / (1000 * 60 * 60 * 24));
        const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);

        if (days > 0) return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    },

    /**
     * Get color based on remaining time
     */
    getColor(ms) {
        if (ms < 5 * 60 * 1000) return 'var(--danger-color)';
        if (ms < 30 * 60 * 1000) return 'var(--warning-color)';
        return '';
    },
};

/**
 * Wizard Module
 */
const Wizard = {
    /**
     * Show the setup wizard
     */
    show() {
        DaikinUI.elements.wizardCard.classList.remove('hidden');
        DaikinUI.elements.statusCard.classList.add('hidden');
        this.goToStep(1);
    },

    /**
     * Hide the setup wizard
     */
    hide() {
        Polling.stop();
        homebridge.request('/auth/stop-server').catch(() => {});
        DaikinUI.elements.wizardCard.classList.add('hidden');
        DaikinUI.elements.statusCard.classList.remove('hidden');
        DaikinUI.elements.callbackServerStatus.classList.add('hidden');
    },

    /**
     * Navigate to a specific step
     */
    goToStep(step) {
        DaikinUI.state.currentStep = step;

        for (let i = 1; i <= 3; i++) {
            const stepEl = document.getElementById(`step-${i}`);
            const contentEl = document.getElementById(`content-${i}`);

            stepEl.classList.remove('active', 'completed');
            contentEl.classList.remove('active');

            if (i < step) {
                stepEl.classList.add('completed');
            } else if (i === step) {
                stepEl.classList.add('active');
                contentEl.classList.add('active');
            }
        }
    },

    /**
     * Validate configuration and proceed to authorization
     */
    async validateAndProceed() {
        if (DaikinUI.state.isValidating) return;
        DaikinUI.state.isValidating = true;

        const config = this.getFormConfig();
        const { elements } = DaikinUI;

        UI.showLoading();

        try {
            const validation = await homebridge.request('/config/validate', config);

            if (!validation.valid) {
                elements.validationErrors.innerHTML = validation.errors
                    .map(e => `<div>${e}</div>`)
                    .join('');
                elements.validationErrors.classList.remove('hidden');
                UI.hideLoading();
                DaikinUI.state.isValidating = false;
                return;
            }

            elements.validationErrors.classList.add('hidden');

            const authResult = await Auth.startAuth(config);

            elements.authUrlDisplay.textContent = authResult.authUrl;
            elements.authUrlContainer.classList.remove('hidden');

            if (authResult.callbackServerRunning) {
                elements.callbackServerStatus.classList.remove('hidden');
            }

            Polling.start();
            this.goToStep(2);
        } catch (error) {
            elements.validationErrors.innerHTML = `<div>${error.message}</div>`;
            elements.validationErrors.classList.remove('hidden');
        }

        UI.hideLoading();
        DaikinUI.state.isValidating = false;
    },

    /**
     * Get configuration from form inputs
     */
    getFormConfig() {
        return {
            clientId: document.getElementById('clientId').value.trim(),
            clientSecret: document.getElementById('clientSecret').value.trim(),
            callbackServerExternalAddress: document.getElementById('callbackServerExternalAddress').value.trim(),
            callbackServerPort: document.getElementById('callbackServerPort').value.trim() || '8582',
        };
    },

    /**
     * Submit authorization code manually
     */
    async submitAuthCode() {
        const code = document.getElementById('authCode').value.trim();

        if (!code) {
            UI.showError('Please enter the authorization code');
            return;
        }

        UI.showLoading();

        try {
            const result = await Auth.submitCode(code);

            if (result.success) {
                DaikinUI.elements.successMessage.textContent = result.message;
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

    /**
     * Finish the wizard and return to status view
     */
    finish() {
        Polling.stop();
        this.hide();
        Auth.loadStatus();
        Devices.load();
    },

    /**
     * Open the authorization URL in a new tab
     */
    openAuthUrl() {
        if (DaikinUI.state.authUrl) {
            window.open(DaikinUI.state.authUrl, '_blank');
        }
    },
};

/**
 * Polling Module
 */
const Polling = {
    isPolling: false,

    /**
     * Start polling for authentication result
     */
    start() {
        this.stop();
        this.isPolling = true;
        this.poll();
    },

    /**
     * Stop polling
     */
    stop() {
        this.isPolling = false;
        if (DaikinUI.state.pollInterval) {
            if (typeof DaikinUI.state.pollInterval === 'number') {
                clearTimeout(DaikinUI.state.pollInterval);
            }
            DaikinUI.state.pollInterval = null;
        }
    },

    /**
     * Poll for authentication result
     */
    async poll() {
        if (!this.isPolling) return;

        try {
            const result = await homebridge.request('/auth/poll');

            if (!result.pending) {
                this.isPolling = false;
                DaikinUI.state.pollInterval = null;

                if (result.success) {
                    DaikinUI.elements.successMessage.textContent =
                        result.message || 'Authentication successful!';
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
            DaikinUI.state.pollInterval = setTimeout(() => this.poll(), 1500);
        }
    },
};

/**
 * Configuration Module
 */
const Config = {
    /**
     * Load saved configuration into form
     */
    async load() {
        try {
            const config = await homebridge.getPluginConfig();
            if (config && config.length > 0) {
                const platformConfig = config[0];
                this.populateForm(platformConfig);
            }
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    },

    /**
     * Populate form fields with config values
     */
    populateForm(config) {
        const fields = ['clientId', 'clientSecret', 'callbackServerExternalAddress', 'callbackServerPort'];

        fields.forEach(field => {
            if (config[field]) {
                const element = document.getElementById(field);
                if (element) element.value = config[field];
            }
        });
    },

    /**
     * Save configuration
     */
    async save() {
        try {
            const config = await homebridge.getPluginConfig();
            const platformConfig = config[0] || { platform: 'DaikinCloud' };
            const formConfig = Wizard.getFormConfig();

            Object.assign(platformConfig, formConfig);

            await homebridge.updatePluginConfig([platformConfig]);
            await homebridge.savePluginConfig();
        } catch (error) {
            console.error('Failed to save config:', error);
        }
    },
};

/**
 * Devices Module
 */
const Devices = {
    /**
     * Load devices from API
     */
    async load() {
        const { elements } = DaikinUI;

        elements.devicesLoading.classList.remove('hidden');
        elements.devicesList.innerHTML = '';
        elements.devicesEmpty.classList.add('hidden');
        elements.devicesError.classList.add('hidden');

        try {
            const result = await homebridge.request('/devices/list');
            elements.devicesLoading.classList.add('hidden');

            if (!result.success) {
                this.handleLoadError(result);
                return;
            }

            if (result.devices.length === 0) {
                elements.devicesEmpty.classList.remove('hidden');
                return;
            }

            elements.devicesList.innerHTML = result.devices
                .map(device => this.render(device))
                .join('');
        } catch (error) {
            elements.devicesLoading.classList.add('hidden');
            elements.devicesError.textContent = 'Failed to load devices: ' + error.message;
            elements.devicesError.classList.remove('hidden');
        }
    },

    /**
     * Handle device load error
     */
    handleLoadError(result) {
        const { elements } = DaikinUI;

        if (result.message.includes('Not authenticated')) {
            elements.devicesEmpty.innerHTML = '<p>Please authenticate first to see your devices.</p>';
            elements.devicesEmpty.classList.remove('hidden');
        } else {
            elements.devicesError.textContent = result.message;
            elements.devicesError.classList.remove('hidden');
        }
    },

    /**
     * Render a device card
     */
    render(device) {
        const statusClass = device.online ? 'online' : 'offline';
        const statusText = device.online ? 'Online' : 'Offline';
        const statusDot = device.online ? '●' : '○';
        const powerClass = device.powerState === 'on' ? 'power-on' : 'power-off';
        const powerText = device.powerState === 'on' ? 'ON' : 'OFF';
        const modeDisplay = device.operationMode ? Utils.capitalize(device.operationMode) : '-';

        return `
            <div class="device-item">
                <div class="device-header">
                    <span class="device-name">${Utils.escapeHtml(device.name)}</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="device-power ${powerClass}">${powerText}</span>
                        <span class="device-status ${statusClass}">${statusDot} ${statusText}</span>
                    </div>
                </div>
                <div class="device-info">
                    ${this.renderTempInfo(device)}
                    <div class="device-info-item">
                        <span class="device-info-label">Mode</span>
                        <span class="device-info-value">${Utils.escapeHtml(modeDisplay)}</span>
                    </div>
                    <div class="device-info-item">
                        <span class="device-info-label">Model</span>
                        <span class="device-info-value">${Utils.escapeHtml(device.model)}</span>
                    </div>
                </div>
                ${this.renderFeatures(device.features)}
            </div>
        `;
    },

    /**
     * Render temperature info
     */
    renderTempInfo(device) {
        let html = '';

        if (device.roomTemp) {
            html += `
                <div class="device-info-item">
                    <span class="device-info-label">Room Temp</span>
                    <span class="device-info-value">${Utils.escapeHtml(device.roomTemp)}</span>
                </div>`;
        }

        if (device.outdoorTemp) {
            html += `
                <div class="device-info-item">
                    <span class="device-info-label">Outdoor</span>
                    <span class="device-info-value">${Utils.escapeHtml(device.outdoorTemp)}</span>
                </div>`;
        }

        return html;
    },

    /**
     * Render feature tags
     */
    renderFeatures(features) {
        if (!features || features.length === 0) return '';

        return `
            <div class="device-features">
                ${features.map(f => `<span class="device-feature-tag">${f}</span>`).join('')}
            </div>
        `;
    },

    /**
     * Refresh devices list
     */
    refresh() {
        this.load();
    },
};

/**
 * Rate Limit Module
 */
const RateLimit = {
    /**
     * Check rate limit from API
     */
    async check() {
        const display = DaikinUI.elements.rateLimitDisplay;
        display.textContent = 'Checking...';

        try {
            const result = await homebridge.request('/api/rate-limit');

            if (result.success && result.rateLimit) {
                const { limit, remaining } = result.rateLimit;
                if (remaining !== undefined && limit !== undefined) {
                    display.textContent = `${remaining}/${limit} remaining`;
                } else {
                    display.textContent = 'No rate limit headers';
                    console.log('All headers:', result.headers);
                }
            } else {
                display.textContent = result.message || 'No rate limit info';
            }
        } catch (error) {
            display.textContent = 'Error: ' + error.message;
        }
    },
};

/**
 * UI Utilities
 */
const UI = {
    /**
     * Show loading overlay
     */
    showLoading() {
        DaikinUI.elements.loading.classList.remove('hidden');
    },

    /**
     * Hide loading overlay
     */
    hideLoading() {
        DaikinUI.elements.loading.classList.add('hidden');
    },

    /**
     * Show error message
     */
    showError(message) {
        const errorDiv = DaikinUI.elements.globalError;
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
            setTimeout(() => errorDiv.classList.add('hidden'), 10000);
        } else {
            console.error(message);
        }
    },
};

/**
 * Utility Functions
 */
const Utils = {
    /**
     * Capitalize first letter
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
};

// Global function bindings for HTML onclick handlers
function showWizard() { Wizard.show(); }
function hideWizard() { Wizard.hide(); }
function goToStep(step) { Wizard.goToStep(step); }
function validateAndProceed() { Wizard.validateAndProceed(); }
function openAuthUrl() { Wizard.openAuthUrl(); }
function submitAuthCode() { Wizard.submitAuthCode(); }
function finishWizard() { Wizard.finish(); }
function testConnection() { Auth.testConnection(); }
function revokeAuth() { Auth.revoke(); }
function refreshDevices() { Devices.refresh(); }
function checkRateLimit() { RateLimit.check(); }

// Bind module methods to DaikinUI for easier access
DaikinUI.loadStatus = () => Auth.loadStatus();
DaikinUI.loadSavedConfig = () => Config.load();
DaikinUI.loadDevices = () => Devices.load();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => DaikinUI.init());
