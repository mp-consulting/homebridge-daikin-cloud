// State
let currentStep = 1;
let authState = null;
let authUrl = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadStatus();
    loadSavedConfig();
});

// Load authentication status
async function loadStatus() {
    try {
        const response = await homebridge.request('/auth/status');
        updateStatusUI(response);
    } catch (error) {
        console.error('Failed to load status:', error);
        updateStatusUI({ authenticated: false, error: error.message });
    }
}

// Update status UI
function updateStatusUI(status) {
    const badge = document.getElementById('status-badge');
    const indicator = badge.querySelector('.status-indicator');
    const statusText = document.getElementById('status-text');
    const authStatus = document.getElementById('auth-status');
    const expiresRow = document.getElementById('expires-row');
    const tokenExpires = document.getElementById('token-expires');
    const btnAuthenticate = document.getElementById('btn-authenticate');
    const btnRevoke = document.getElementById('btn-revoke');
    const btnTest = document.getElementById('btn-test');

    if (status.authenticated) {
        if (status.isExpired) {
            badge.className = 'status-badge expired';
            indicator.className = 'status-indicator yellow';
            statusText.textContent = 'Expired';
            authStatus.textContent = status.canRefresh ? 'Token expired (will auto-refresh)' : 'Token expired';
        } else {
            badge.className = 'status-badge authenticated';
            indicator.className = 'status-indicator green';
            statusText.textContent = 'Connected';
            authStatus.textContent = 'Authenticated and ready';
        }

        if (status.expiresAt) {
            expiresRow.style.display = 'flex';
            const date = new Date(status.expiresAt);
            tokenExpires.textContent = date.toLocaleString();
        }

        btnAuthenticate.textContent = 'Re-authenticate';
        btnRevoke.style.display = 'inline-flex';
        btnTest.disabled = false;
    } else {
        badge.className = 'status-badge not-authenticated';
        indicator.className = 'status-indicator red';
        statusText.textContent = 'Not Connected';
        authStatus.textContent = status.error || 'Authentication required';
        expiresRow.style.display = 'none';
        btnAuthenticate.textContent = 'Authenticate';
        btnRevoke.style.display = 'none';
        btnTest.disabled = true;
    }
}

// Load saved config into form
async function loadSavedConfig() {
    try {
        const config = await homebridge.getPluginConfig();
        if (config && config.length > 0) {
            const platformConfig = config[0];
            if (platformConfig.clientId) {
                document.getElementById('clientId').value = platformConfig.clientId;
            }
            if (platformConfig.clientSecret) {
                document.getElementById('clientSecret').value = platformConfig.clientSecret;
            }
            if (platformConfig.callbackServerExternalAddress) {
                document.getElementById('callbackServerExternalAddress').value = platformConfig.callbackServerExternalAddress;
            }
            if (platformConfig.callbackServerPort) {
                document.getElementById('callbackServerPort').value = platformConfig.callbackServerPort;
            }
        }
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Show wizard
function showWizard() {
    document.getElementById('wizard-card').classList.remove('hidden');
    document.getElementById('status-card').classList.add('hidden');
    goToStep(1);
}

// Hide wizard
function hideWizard() {
    document.getElementById('wizard-card').classList.add('hidden');
    document.getElementById('status-card').classList.remove('hidden');
}

// Go to step
function goToStep(step) {
    currentStep = step;

    // Update step indicators
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
}

// Validate config and proceed
async function validateAndProceed() {
    const clientId = document.getElementById('clientId').value.trim();
    const clientSecret = document.getElementById('clientSecret').value.trim();
    const callbackServerExternalAddress = document.getElementById('callbackServerExternalAddress').value.trim();
    const callbackServerPort = document.getElementById('callbackServerPort').value.trim() || '8582';

    const errorsDiv = document.getElementById('validation-errors');

    showLoading();

    try {
        const result = await homebridge.request('/config/validate', {
            clientId,
            clientSecret,
            callbackServerExternalAddress,
            callbackServerPort,
        });

        if (!result.valid) {
            errorsDiv.innerHTML = result.errors.map(e => `<div>${e}</div>`).join('');
            errorsDiv.classList.remove('hidden');
            hideLoading();
            return;
        }

        errorsDiv.classList.add('hidden');

        // Start auth flow
        const authResult = await homebridge.request('/auth/start', {
            clientId,
            clientSecret,
            callbackServerExternalAddress,
            callbackServerPort,
        });

        authState = authResult.state;
        authUrl = authResult.authUrl;

        document.getElementById('auth-url').textContent = authUrl;
        document.getElementById('auth-url-container').classList.remove('hidden');

        goToStep(2);
    } catch (error) {
        errorsDiv.innerHTML = `<div>${error.message}</div>`;
        errorsDiv.classList.remove('hidden');
    }

    hideLoading();
}

// Open auth URL
function openAuthUrl() {
    if (authUrl) {
        window.open(authUrl, '_blank');
    }
}

// Submit auth code
async function submitAuthCode() {
    const code = document.getElementById('authCode').value.trim();

    if (!code) {
        alert('Please enter the authorization code');
        return;
    }

    showLoading();

    try {
        const result = await homebridge.request('/auth/callback', {
            code,
            state: authState,
        });

        if (result.success) {
            document.getElementById('success-message').textContent = result.message;
            goToStep(3);

            // Save config
            await saveConfig();
        } else {
            alert('Authentication failed: ' + (result.message || 'Unknown error'));
        }
    } catch (error) {
        alert('Authentication failed: ' + error.message);
    }

    hideLoading();
}

// Save config
async function saveConfig() {
    try {
        const config = await homebridge.getPluginConfig();
        const platformConfig = config[0] || { platform: 'DaikinCloud' };

        platformConfig.clientId = document.getElementById('clientId').value.trim();
        platformConfig.clientSecret = document.getElementById('clientSecret').value.trim();
        platformConfig.callbackServerExternalAddress = document.getElementById('callbackServerExternalAddress').value.trim();
        platformConfig.callbackServerPort = document.getElementById('callbackServerPort').value.trim() || '8582';

        await homebridge.updatePluginConfig([platformConfig]);
        await homebridge.savePluginConfig();
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

// Finish wizard
function finishWizard() {
    hideWizard();
    loadStatus();
}

// Test connection
async function testConnection() {
    const resultDiv = document.getElementById('test-result');
    const btn = document.getElementById('btn-test');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Testing...';
    resultDiv.classList.add('hidden');

    try {
        const result = await homebridge.request('/auth/test');

        resultDiv.classList.remove('hidden', 'alert-success', 'alert-danger');

        if (result.success) {
            resultDiv.classList.add('alert-success');
            resultDiv.textContent = result.message;
        } else {
            resultDiv.classList.add('alert-danger');
            resultDiv.textContent = result.message;
        }
    } catch (error) {
        resultDiv.classList.remove('hidden', 'alert-success');
        resultDiv.classList.add('alert-danger');
        resultDiv.textContent = 'Test failed: ' + error.message;
    }

    btn.disabled = false;
    btn.innerHTML = 'Test Connection';
}

// Revoke authentication
async function revokeAuth() {
    if (!confirm('Are you sure you want to revoke access? You will need to re-authenticate.')) {
        return;
    }

    showLoading();

    try {
        const config = await homebridge.getPluginConfig();
        const platformConfig = config[0] || {};

        await homebridge.request('/auth/revoke', {
            clientId: platformConfig.clientId,
            clientSecret: platformConfig.clientSecret,
        });

        loadStatus();
    } catch (error) {
        alert('Failed to revoke: ' + error.message);
    }

    hideLoading();
}

// Show loading overlay
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}
