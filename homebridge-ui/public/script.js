/**
 * Daikin Cloud Homebridge UI
 * Main application script
 */

const DaikinUI = {
    // Application state
    state: {
        currentStep: 1,
        currentTab: 'devices',
        authState: null,
        authUrl: null,
        pollInterval: null,
        countdownInterval: null,
        statusRefreshInterval: null,
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
        this.loadSettings();
        this.loadDevices();
    },

    /**
     * Cache frequently used DOM elements
     */
    cacheElements() {
        this.elements = {
            // Header
            statusBadge: document.getElementById('status-badge'),
            statusIndicator: document.getElementById('status-indicator'),
            statusText: document.getElementById('status-text'),
            tokenExpiresLabel: document.getElementById('token-expires-label'),
            tokenExpires: document.getElementById('token-expires'),

            // Auth
            authStatus: document.getElementById('auth-status'),
            authTokenExpires: document.getElementById('auth-token-expires'),
            expiresRow: document.getElementById('expires-row'),
            btnAuthenticate: document.getElementById('btn-authenticate'),
            btnRevoke: document.getElementById('btn-revoke'),
            btnTest: document.getElementById('btn-test'),
            testResult: document.getElementById('test-result'),

            // Wizard
            wizard: document.getElementById('wizard'),
            authStatusCard: document.getElementById('auth-status-card'),
            validationErrors: document.getElementById('validation-errors'),
            authUrlContainer: document.getElementById('auth-url-container'),
            authUrlDisplay: document.getElementById('auth-url'),
            callbackServerStatus: document.getElementById('callback-server-status'),
            successMessage: document.getElementById('success-message'),

            // Devices
            devicesLoading: document.getElementById('devices-loading'),
            devicesList: document.getElementById('devices-list'),
            devicesEmpty: document.getElementById('devices-empty'),
            devicesError: document.getElementById('devices-error'),

            // Settings
            settingsStatus: document.getElementById('settings-status'),

            // Help
            rateLimitDisplay: document.getElementById('rate-limit-display'),

            // Global
            loading: document.getElementById('loading'),
            globalError: document.getElementById('global-error'),
        };
    },
};

/**
 * Tab Navigation
 */
function switchTab(tabName) {
    DaikinUI.state.currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
}

/**
 * Authentication Module
 */
const Auth = {
    // Refresh status every 60 seconds to detect token renewal
    STATUS_REFRESH_INTERVAL: 60 * 1000,

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
     * Start periodic status refresh to detect token renewal
     */
    startStatusRefresh() {
        this.stopStatusRefresh();
        DaikinUI.state.statusRefreshInterval = setInterval(() => {
            this.checkForTokenRenewal();
        }, this.STATUS_REFRESH_INTERVAL);
    },

    /**
     * Stop periodic status refresh
     */
    stopStatusRefresh() {
        if (DaikinUI.state.statusRefreshInterval) {
            clearInterval(DaikinUI.state.statusRefreshInterval);
            DaikinUI.state.statusRefreshInterval = null;
        }
    },

    /**
     * Check if token has been renewed and update UI
     */
    async checkForTokenRenewal() {
        try {
            const response = await homebridge.request('/auth/status');

            if (response.authenticated && response.expiresAt) {
                const newExpiresAt = new Date(response.expiresAt);
                const currentExpiresAt = DaikinUI.state.tokenExpiresAt;

                // If expiration time changed, token was renewed
                if (!currentExpiresAt || newExpiresAt.getTime() !== currentExpiresAt.getTime()) {
                    console.log('Token renewed, updating countdown');
                    this.updateStatusUI(response);
                }
            }
        } catch (error) {
            console.error('Failed to check token status:', error);
        }
    },

    /**
     * Update the status UI based on authentication state
     */
    updateStatusUI(status) {
        const { elements } = DaikinUI;

        if (status.authenticated) {
            this.setAuthenticatedState(status);
        } else {
            this.setUnauthenticatedState(status);
        }
    },

    /**
     * Set UI for authenticated state
     */
    setAuthenticatedState(status) {
        const { elements } = DaikinUI;

        if (status.isExpired) {
            elements.statusBadge.className = 'status-badge expired';
            elements.statusIndicator.className = 'status-indicator yellow';
            elements.statusText.textContent = 'Expired';
            elements.authStatus.textContent = status.canRefresh
                ? 'Token expired (will auto-refresh)'
                : 'Token expired';
        } else {
            elements.statusBadge.className = 'status-badge authenticated';
            elements.statusIndicator.className = 'status-indicator green';
            elements.statusText.textContent = 'Connected';
            elements.authStatus.textContent = 'Authenticated and ready';
        }

        if (status.expiresAt) {
            DaikinUI.state.tokenExpiresAt = new Date(status.expiresAt);
            elements.tokenExpiresLabel.classList.remove('hidden');
            elements.expiresRow.style.display = 'flex';
            Countdown.start();
        } else {
            Countdown.stop();
        }

        // Start periodic refresh to detect token renewal
        this.startStatusRefresh();

        elements.btnAuthenticate.textContent = 'Re-authenticate';
        elements.btnRevoke.style.display = 'inline-flex';
        elements.btnTest.disabled = false;
    },

    /**
     * Set UI for unauthenticated state
     */
    setUnauthenticatedState(status) {
        const { elements } = DaikinUI;

        elements.statusBadge.className = 'status-badge not-authenticated';
        elements.statusIndicator.className = 'status-indicator red';
        elements.statusText.textContent = 'Not Connected';
        elements.authStatus.textContent = status.error || 'Authentication required';
        elements.tokenExpiresLabel.classList.add('hidden');
        elements.tokenExpires.textContent = '';
        elements.expiresRow.style.display = 'none';
        elements.btnAuthenticate.textContent = 'Authenticate';
        elements.btnRevoke.style.display = 'none';
        elements.btnTest.disabled = true;
        Countdown.stop();
        this.stopStatusRefresh();
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
        const { tokenExpires, authTokenExpires } = DaikinUI.elements;

        if (!tokenExpiresAt) return;

        const diff = tokenExpiresAt - new Date();

        if (diff <= 0) {
            if (tokenExpires) tokenExpires.textContent = 'Expired';
            if (authTokenExpires) authTokenExpires.textContent = 'Expired';
            this.stop();
            Auth.loadStatus();
            return;
        }

        const formatted = this.formatTime(diff);
        const color = this.getColor(diff);

        if (tokenExpires) {
            tokenExpires.textContent = formatted;
            tokenExpires.style.color = color;
        }
        if (authTokenExpires) {
            authTokenExpires.textContent = formatted;
            authTokenExpires.style.color = color;
        }
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
        DaikinUI.elements.wizard.classList.remove('hidden');
        DaikinUI.elements.authStatusCard.classList.add('hidden');
        this.goToStep(1);
    },

    /**
     * Hide the setup wizard
     */
    hide() {
        Polling.stop();
        homebridge.request('/auth/stop-server').catch(() => {});
        DaikinUI.elements.wizard.classList.add('hidden');
        DaikinUI.elements.authStatusCard.classList.remove('hidden');
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

        // Client-side port validation
        const portInput = document.getElementById('callbackServerPort');
        if (!this.isValidPort(config.callbackServerPort)) {
            portInput?.classList.add('invalid');
            elements.validationErrors.innerHTML = '<div>Port must be between 1 and 65535</div>';
            elements.validationErrors.classList.remove('hidden');
            DaikinUI.state.isValidating = false;
            return;
        }
        portInput?.classList.remove('invalid');

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

            const callbackStatusEl = document.getElementById('callback-server-status');
            const manualDetailsEl = document.getElementById('manual-callback-details');

            if (authResult.callbackServerRunning) {
                // Show automatic status, collapse manual section
                if (callbackStatusEl) callbackStatusEl.classList.remove('hidden');
                if (manualDetailsEl) manualDetailsEl.open = false;
            } else {
                // Hide automatic status, expand manual section
                if (callbackStatusEl) callbackStatusEl.classList.add('hidden');
                if (manualDetailsEl) manualDetailsEl.open = true;
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
     * Validate port number
     */
    isValidPort(port) {
        const num = parseInt(port, 10);
        return !isNaN(num) && num >= 1 && num <= 65535;
    },

    /**
     * Submit callback URL (contains code and state)
     */
    async submitCallbackUrl() {
        const callbackUrl = document.getElementById('callbackUrl').value.trim();

        if (!callbackUrl) {
            UI.showError('Please paste the callback URL from your browser');
            return;
        }

        if (!callbackUrl.includes('code=')) {
            UI.showError('Invalid URL - must contain a code parameter');
            return;
        }

        UI.showLoading();

        try {
            const result = await homebridge.request('/auth/', { callbackUrl });

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
     * Submit authorization code manually (legacy)
     */
    async submitAuthCode() {
        const code = document.getElementById('authCode')?.value?.trim();

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

            // Prefill callback server address with server IP if empty
            await this.prefillServerAddress();
        } catch (error) {
            console.error('Failed to load config:', error);
        }
    },

    /**
     * Prefill callback server address with server's IP if not already set
     */
    async prefillServerAddress() {
        const addressField = document.getElementById('callbackServerExternalAddress');
        if (!addressField || addressField.value.trim()) return; // Already has a value

        try {
            const serverInfo = await homebridge.request('/server/info');
            if (serverInfo.primaryIp) {
                addressField.value = serverInfo.primaryIp;
                addressField.placeholder = serverInfo.primaryIp;
            }
        } catch (error) {
            console.error('Failed to get server IP:', error);
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
 * Settings Module
 */
const Settings = {
    // Cache for devices and exclusions
    devices: [],
    excludedIds: [],

    // Auto-save debounce timer
    saveTimeout: null,
    SAVE_DEBOUNCE_MS: 500,

    // Feature config keys
    featureKeys: [
        'showPowerfulMode',
        'showEconoMode',
        'showStreamerMode',
        'showOutdoorSilentMode',
        'showIndoorSilentMode',
        'showDryMode',
        'showFanOnlyMode',
    ],

    /**
     * Load settings from plugin config
     */
    async load() {
        try {
            const config = await homebridge.getPluginConfig();
            if (config && config.length > 0) {
                this.populateForm(config[0]);
                this.excludedIds = config[0].excludedDevicesByDeviceId || [];
            }
            // Load device toggles
            await this.loadDeviceToggles();
            // Setup auto-save listeners
            this.setupAutoSave();
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    },

    /**
     * Setup auto-save event listeners
     */
    setupAutoSave() {
        // Feature toggles
        this.featureKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) {
                el.addEventListener('change', () => this.autoSave());
            }
        });

        // Number and text inputs
        const inputs = ['updateIntervalInMinutes', 'forceUpdateDelay', 'oidcCallbackServerBindAddr'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => this.autoSave());
                el.addEventListener('input', () => this.autoSave());
            }
        });
    },

    /**
     * Auto-save with debounce
     */
    autoSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            if (this.validateInputs()) {
                this.save();
            }
        }, this.SAVE_DEBOUNCE_MS);
    },

    /**
     * Validate inputs before saving
     */
    validateInputs() {
        let isValid = true;

        // Validate IP address
        const bindAddr = document.getElementById('oidcCallbackServerBindAddr');
        if (bindAddr && !this.isValidIPv4(bindAddr.value.trim())) {
            bindAddr.classList.add('invalid');
            isValid = false;
        } else {
            bindAddr?.classList.remove('invalid');
        }

        // Validate update interval (1-60 minutes)
        const updateInterval = document.getElementById('updateIntervalInMinutes');
        if (updateInterval && !this.isValidNumber(updateInterval.value, 1, 60)) {
            updateInterval.classList.add('invalid');
            isValid = false;
        } else {
            updateInterval?.classList.remove('invalid');
        }

        // Validate force update delay (1-300 seconds)
        const forceDelay = document.getElementById('forceUpdateDelay');
        if (forceDelay && !this.isValidNumber(forceDelay.value, 1, 300)) {
            forceDelay.classList.add('invalid');
            isValid = false;
        } else {
            forceDelay?.classList.remove('invalid');
        }

        return isValid;
    },

    /**
     * Check if value is a valid number within range
     */
    isValidNumber(value, min, max) {
        const num = parseInt(value, 10);
        return !isNaN(num) && num >= min && num <= max;
    },

    /**
     * Check if string is a valid IPv4 address
     */
    isValidIPv4(ip) {
        if (!ip) return true; // Allow empty, will use default
        const pattern = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.){3}(25[0-5]|(2[0-4]|1\d|[1-9]|)\d)$/;
        return pattern.test(ip);
    },

    /**
     * Populate settings form fields
     */
    populateForm(config) {
        // Feature toggles
        const showAllLegacy = config.showExtraFeatures === true;

        this.featureKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) {
                // If individual key exists, use it; otherwise fall back to legacy showExtraFeatures
                if (key in config) {
                    el.checked = config[key] === true;
                } else {
                    el.checked = showAllLegacy;
                }
            }
        });

        // Number inputs
        const updateInterval = document.getElementById('updateIntervalInMinutes');
        if (updateInterval) {
            updateInterval.value = config.updateIntervalInMinutes || 15;
        }

        const forceDelay = document.getElementById('forceUpdateDelay');
        if (forceDelay) {
            // Convert ms to seconds for display
            const delayMs = config.forceUpdateDelay || 60000;
            forceDelay.value = Math.round(delayMs / 1000);
        }

        // Text input
        const bindAddr = document.getElementById('oidcCallbackServerBindAddr');
        if (bindAddr) {
            bindAddr.value = config.oidcCallbackServerBindAddr || '0.0.0.0';
        }
    },

    /**
     * Load devices and render toggles
     */
    async loadDeviceToggles() {
        const loadingEl = document.getElementById('device-toggles-loading');
        const listEl = document.getElementById('device-toggles-list');
        const emptyEl = document.getElementById('device-toggles-empty');

        loadingEl.classList.remove('hidden');
        listEl.innerHTML = '';
        emptyEl.classList.add('hidden');

        try {
            const result = await homebridge.request('/devices/list');
            loadingEl.classList.add('hidden');

            if (!result.success || result.devices.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }

            this.devices = result.devices;
            listEl.innerHTML = this.devices.map((device, index) => this.renderDeviceToggle(device, index)).join('');

            // Use event delegation for toggle changes (safer than inline onclick)
            listEl.addEventListener('change', (e) => {
                if (e.target.classList.contains('device-visibility-toggle')) {
                    const index = parseInt(e.target.dataset.index, 10);
                    const device = this.devices[index];
                    if (device) {
                        this.toggleDevice(device.id, e.target.checked, index);
                    }
                }
            });
        } catch (error) {
            loadingEl.classList.add('hidden');
            emptyEl.innerHTML = `<p>Failed to load devices: ${error.message}</p>`;
            emptyEl.classList.remove('hidden');
        }
    },

    /**
     * Render a device toggle item
     */
    renderDeviceToggle(device, index) {
        const isExcluded = this.excludedIds.includes(device.id);
        const isVisible = !isExcluded;
        const labelClass = isVisible ? 'visible' : 'hidden-label';
        const labelText = isVisible ? 'Visible' : 'Hidden';

        return `
            <div class="device-toggle-item">
                <div class="device-toggle-info">
                    <span class="device-toggle-name">${Utils.escapeHtml(device.name)}</span>
                    <span class="device-toggle-id">${Utils.escapeHtml(device.id)}</span>
                </div>
                <div class="device-toggle-status">
                    <span class="device-toggle-label ${labelClass}" data-label-index="${index}">${labelText}</span>
                    <label class="toggle-label" style="margin: 0;">
                        <input type="checkbox"
                               class="toggle-input device-visibility-toggle"
                               data-index="${index}"
                               ${isVisible ? 'checked' : ''}>
                        <span class="toggle-switch"></span>
                    </label>
                </div>
            </div>
        `;
    },

    /**
     * Toggle device visibility
     */
    toggleDevice(deviceId, isVisible, index) {
        const labelEl = document.querySelector(`[data-label-index="${index}"]`);

        if (isVisible) {
            // Remove from excluded list
            this.excludedIds = this.excludedIds.filter(id => id !== deviceId);
            if (labelEl) {
                labelEl.textContent = 'Visible';
                labelEl.className = 'device-toggle-label visible';
            }
        } else {
            // Add to excluded list
            if (!this.excludedIds.includes(deviceId)) {
                this.excludedIds.push(deviceId);
            }
            if (labelEl) {
                labelEl.textContent = 'Hidden';
                labelEl.className = 'device-toggle-label hidden-label';
            }
        }

        // Trigger auto-save
        this.autoSave();
    },

    /**
     * Get settings from form
     */
    getFormSettings() {
        // Convert seconds from UI to milliseconds for config
        const delaySeconds = parseInt(document.getElementById('forceUpdateDelay')?.value, 10) || 60;
        const delayMs = delaySeconds * 1000;

        // Build settings object
        const settings = {
            updateIntervalInMinutes: parseInt(document.getElementById('updateIntervalInMinutes')?.value, 10) || 15,
            forceUpdateDelay: delayMs,
            oidcCallbackServerBindAddr: document.getElementById('oidcCallbackServerBindAddr')?.value?.trim() || '0.0.0.0',
            excludedDevicesByDeviceId: this.excludedIds,
        };

        // Add individual feature toggles
        this.featureKeys.forEach(key => {
            const el = document.getElementById(key);
            if (el) {
                settings[key] = el.checked;
            }
        });

        return settings;
    },

    /**
     * Save settings to plugin config
     */
    async save() {
        const statusEl = document.getElementById('settings-status');

        try {
            this.showStatus(statusEl, 'saving', 'Saving...');

            const config = await homebridge.getPluginConfig();
            const platformConfig = config[0] || { platform: 'DaikinCloud' };
            const settings = this.getFormSettings();

            Object.assign(platformConfig, settings);

            await homebridge.updatePluginConfig([platformConfig]);
            await homebridge.savePluginConfig();

            this.showStatus(statusEl, 'saved', 'Saved');
        } catch (error) {
            this.showStatus(statusEl, 'error', 'Failed to save');
            console.error('Failed to save settings:', error);
        }
    },

    /**
     * Show save status indicator
     */
    showStatus(el, type, message) {
        if (!el) return;
        el.className = `settings-status ${type}`;
        el.textContent = message;
        el.classList.remove('hidden');

        // Auto-hide after success
        if (type === 'saved') {
            setTimeout(() => el.classList.add('hidden'), 2000);
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
            elements.devicesEmpty.innerHTML = `
                <div class="empty-icon">🔐</div>
                <p>Please authenticate first</p>
                <p class="text-muted">Go to the Authentication tab to connect your Daikin account.</p>
            `;
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
        const powerClass = device.powerState === 'on' ? 'power-on' : 'power-off';
        const powerText = device.powerState === 'on' ? 'ON' : 'OFF';
        const modeDisplay = device.operationMode ? Utils.capitalize(device.operationMode) : '-';

        return `
            <div class="device-item">
                <div class="device-header">
                    <span class="device-name">${Utils.escapeHtml(device.name)}</span>
                    <div class="device-badges">
                        <span class="device-power ${powerClass}">${powerText}</span>
                        <span class="device-status ${statusClass}">${statusText}</span>
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
function submitCallbackUrl() { Wizard.submitCallbackUrl(); }
function finishWizard() { Wizard.finish(); }
function testConnection() { Auth.testConnection(); }
function revokeAuth() { Auth.revoke(); }
function refreshDevices() { Devices.refresh(); }
function checkRateLimit() { RateLimit.check(); }

// Bind module methods to DaikinUI for easier access
DaikinUI.loadStatus = () => Auth.loadStatus();
DaikinUI.loadSavedConfig = () => Config.load();
DaikinUI.loadDevices = () => Devices.load();
DaikinUI.loadSettings = () => Settings.load();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => DaikinUI.init());
