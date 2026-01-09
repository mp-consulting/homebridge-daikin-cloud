const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { resolve } = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');

// =============================================================================
// Configuration
// =============================================================================

const OIDC_CONFIG = {
    authorizationEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/authorize',
    tokenEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/token',
    revokeEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/revoke',
    apiEndpoint: 'https://api.onecta.daikineurope.com',
    scope: 'openid onecta:basic.integration',
};

const CLIMATE_CONTROL_IDS = ['climateControl', 'climateControlMainZone', 'climateControlSecondaryZone'];

// =============================================================================
// SSL Certificate Utilities
// =============================================================================

const SSLUtils = {
    /**
     * Check if a string is a valid IP address
     */
    isIPAddress(str) {
        const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
        return ipv4Pattern.test(str) || ipv6Pattern.test(str);
    },

    /**
     * Generate self-signed certificate for HTTPS callback server
     */
    generateCert(hostname, certDir) {
        const keyPath = resolve(certDir, 'server.key');
        const certPath = resolve(certDir, 'server.crt');

        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
        }

        // Return existing certs if valid
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
            try {
                return {
                    key: fs.readFileSync(keyPath, 'utf8'),
                    cert: fs.readFileSync(certPath, 'utf8'),
                };
            } catch (e) {
                // Regenerate if can't read
            }
        }

        // Generate new certificate
        try {
            execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });

            const isIP = this.isIPAddress(hostname);
            const sanValue = isIP ? `IP:${hostname}` : `DNS:${hostname}`;
            const subj = `/CN=${hostname}/O=Homebridge Daikin Cloud/C=US`;

            execSync(
                `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "${subj}" -addext "subjectAltName=${sanValue}"`,
                { stdio: 'pipe' }
            );

            return {
                key: fs.readFileSync(keyPath, 'utf8'),
                cert: fs.readFileSync(certPath, 'utf8'),
            };
        } catch (error) {
            throw new Error(`Failed to generate SSL certificate. Make sure openssl is installed. Error: ${error.message}`);
        }
    },
};

// =============================================================================
// Token Management
// =============================================================================

const TokenManager = {
    /**
     * Load token set from file
     */
    load(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading token set:', error.message);
        }
        return null;
    },

    /**
     * Save token set to file
     */
    save(filePath, tokenSet) {
        fs.writeFileSync(filePath, JSON.stringify(tokenSet, null, 2), 'utf8');
    },

    /**
     * Delete token file
     */
    delete(filePath) {
        try {
            fs.unlinkSync(filePath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    },

    /**
     * Check token status
     */
    getStatus(tokenSet) {
        if (!tokenSet || !tokenSet.access_token) {
            return { authenticated: false, message: 'Not authenticated' };
        }

        const expiresAt = tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000) : null;
        const isExpired = expiresAt ? expiresAt < new Date() : false;
        const hasRefreshToken = !!tokenSet.refresh_token;

        return {
            authenticated: true,
            isExpired,
            canRefresh: hasRefreshToken,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            message: isExpired
                ? (hasRefreshToken ? 'Token expired, will refresh automatically' : 'Token expired, re-authentication required')
                : 'Authenticated',
        };
    },
};

// =============================================================================
// HTTP Utilities
// =============================================================================

const HttpUtils = {
    /**
     * Make HTTPS POST request with form data
     */
    async post(url, formData, headers = {}) {
        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams(formData).toString();
            const urlObj = new URL(url);

            const options = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                    ...headers,
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, data, headers: res.headers }));
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    },

    /**
     * Make HTTPS GET request
     */
    async get(url, accessToken) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);

            const options = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, data, headers: res.headers }));
            });

            req.on('error', reject);
            req.end();
        });
    },
};

// =============================================================================
// Device Data Extraction
// =============================================================================

const DeviceExtractor = {
    /**
     * Get management point by ID
     */
    getManagementPoint(device, embeddedId) {
        return device.managementPoints?.find(mp => mp.embeddedId === embeddedId) || null;
    },

    /**
     * Get climate control management point
     */
    getClimateControlPoint(device) {
        for (const id of CLIMATE_CONTROL_IDS) {
            const mp = this.getManagementPoint(device, id);
            if (mp) return mp;
        }
        return null;
    },

    /**
     * Extract device name
     */
    extractName(device) {
        const climateControl = this.getClimateControlPoint(device);
        return climateControl?.name?.value || device.id || 'Unknown Device';
    },

    /**
     * Extract model info
     */
    extractModel(device) {
        const gateway = this.getManagementPoint(device, 'gateway');
        return gateway?.modelInfo?.value || device.deviceModel || 'Unknown Model';
    },

    /**
     * Extract device type
     */
    extractType(device) {
        if (!device.managementPoints) return device.type || 'Unknown Type';

        for (const mp of device.managementPoints) {
            if (mp.embeddedId === 'climateControl') return 'Climate Control';
            if (mp.embeddedId === 'domesticHotWaterTank') return 'Hot Water Tank';
        }
        return device.type || 'Unknown Type';
    },

    /**
     * Check if device is online
     */
    isOnline(device) {
        return device.isCloudConnectionUp?.value ?? false;
    },

    /**
     * Extract room temperature
     */
    extractRoomTemp(device) {
        const climateControl = this.getClimateControlPoint(device);
        const roomTemp = climateControl?.sensoryData?.value?.roomTemperature;
        return roomTemp?.value !== undefined ? `${roomTemp.value}${roomTemp.unit || '°C'}` : null;
    },

    /**
     * Extract outdoor temperature
     */
    extractOutdoorTemp(device) {
        const climateControl = this.getClimateControlPoint(device);
        const outdoorTemp = climateControl?.sensoryData?.value?.outdoorTemperature;
        return outdoorTemp?.value !== undefined ? `${outdoorTemp.value}${outdoorTemp.unit || '°C'}` : null;
    },

    /**
     * Extract operation mode
     */
    extractOperationMode(device) {
        const climateControl = this.getClimateControlPoint(device);
        return climateControl?.operationMode?.value || null;
    },

    /**
     * Extract power state
     */
    extractPowerState(device) {
        const climateControl = this.getClimateControlPoint(device);
        return climateControl?.onOffMode?.value || null;
    },

    /**
     * Extract device features
     */
    extractFeatures(device) {
        const features = [];
        if (!device.managementPoints) return features;

        for (const mp of device.managementPoints) {
            if (CLIMATE_CONTROL_IDS.includes(mp.embeddedId)) {
                if (mp.onOffMode) features.push('Power');
                if (mp.temperatureControl) features.push('Temperature');
                if (mp.operationMode) features.push('Mode');
                if (mp.fanControl) features.push('Fan');
                if (mp.sensoryData) features.push('Sensors');
            }
            if (mp.embeddedId === 'domesticHotWaterTank') {
                if (mp.onOffMode) features.push('Hot Water');
                if (mp.temperatureControl) features.push('Water Temp');
            }
        }
        return features;
    },

    /**
     * Extract all device info
     */
    extractAll(device) {
        return {
            id: device.id,
            name: this.extractName(device),
            model: this.extractModel(device),
            type: this.extractType(device),
            online: this.isOnline(device),
            features: this.extractFeatures(device),
            roomTemp: this.extractRoomTemp(device),
            outdoorTemp: this.extractOutdoorTemp(device),
            operationMode: this.extractOperationMode(device),
            powerState: this.extractPowerState(device),
        };
    },
};

// =============================================================================
// OAuth Service
// =============================================================================

class OAuthService {
    /**
     * Exchange authorization code for tokens
     */
    static async exchangeCode(code, clientId, clientSecret, redirectUri) {
        const response = await HttpUtils.post(OIDC_CONFIG.tokenEndpoint, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
        });

        const tokenSet = JSON.parse(response.data);
        if (tokenSet.error) {
            throw new Error(tokenSet.error_description || tokenSet.error);
        }

        // Calculate expires_at from expires_in
        if (tokenSet.expires_in && !tokenSet.expires_at) {
            tokenSet.expires_at = Math.floor(Date.now() / 1000) + tokenSet.expires_in;
        }

        return tokenSet;
    }

    /**
     * Revoke token at server
     */
    static async revokeToken(token, clientId, clientSecret) {
        await HttpUtils.post(OIDC_CONFIG.revokeEndpoint, {
            token,
            token_type_hint: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
        });
    }

    /**
     * Build authorization URL
     */
    static buildAuthUrl(clientId, redirectUri, state) {
        const url = new URL(OIDC_CONFIG.authorizationEndpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('scope', OIDC_CONFIG.scope);
        url.searchParams.set('state', state);
        return url.toString();
    }
}

// =============================================================================
// API Service
// =============================================================================

class ApiService {
    /**
     * Make authenticated API request
     */
    static async request(path, accessToken) {
        const response = await HttpUtils.get(OIDC_CONFIG.apiEndpoint + path, accessToken);

        if (response.statusCode === 401) throw new Error('Token expired or invalid');
        if (response.statusCode === 429) throw new Error('Rate limit exceeded');
        if (response.statusCode >= 400) throw new Error(`API error: ${response.statusCode}`);

        try {
            return JSON.parse(response.data);
        } catch (e) {
            throw new Error('Invalid API response');
        }
    }

    /**
     * Make request and return with headers
     */
    static async requestWithHeaders(path, accessToken) {
        const response = await HttpUtils.get(OIDC_CONFIG.apiEndpoint + path, accessToken);

        if (response.statusCode >= 400) throw new Error(`API error: ${response.statusCode}`);

        const rateLimit = {
            limit: response.headers['x-ratelimit-limit'] || response.headers['ratelimit-limit'],
            remaining: response.headers['x-ratelimit-remaining'] || response.headers['ratelimit-remaining'],
            reset: response.headers['x-ratelimit-reset'] || response.headers['ratelimit-reset'],
        };

        return {
            data: JSON.parse(response.data),
            headers: response.headers,
            rateLimit,
        };
    }
}

// =============================================================================
// Callback Server
// =============================================================================

class CallbackServer {
    constructor() {
        this.server = null;
        this.port = null;
        this.connections = new Set();
    }

    /**
     * Start HTTPS server
     */
    async start(port, hostname, certDir, requestHandler) {
        await this.stop();

        return new Promise((resolve, reject) => {
            const tryStart = (attempt = 1) => {
                try {
                    const { key, cert } = SSLUtils.generateCert(hostname, certDir);

                    this.server = https.createServer({ key, cert }, requestHandler);

                    this.server.on('connection', (conn) => {
                        this.connections.add(conn);
                        conn.on('close', () => this.connections.delete(conn));
                    });

                    this.server.on('error', (err) => {
                        if (err.code === 'EADDRINUSE' && attempt < 3) {
                            console.warn(`Port ${port} in use, retrying in 1 second (attempt ${attempt}/3)...`);
                            setTimeout(() => tryStart(attempt + 1), 1000);
                        } else {
                            console.error('Callback server error:', err.message);
                            reject(err);
                        }
                    });

                    this.server.listen(port, '0.0.0.0', () => {
                        console.log(`HTTPS callback server listening on port ${port}`);
                        this.port = port;
                        resolve({ success: true, port });
                    });
                } catch (error) {
                    reject(error);
                }
            };

            tryStart();
        });
    }

    /**
     * Stop server
     */
    async stop() {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve({ success: true });
                return;
            }

            // Force close connections
            for (const conn of this.connections) {
                conn.destroy();
            }
            this.connections.clear();

            const timeout = setTimeout(() => {
                console.warn('HTTPS callback server close timed out, forcing cleanup');
                this.server = null;
                this.port = null;
                resolve({ success: true });
            }, 2000);

            this.server.close(() => {
                clearTimeout(timeout);
                console.log('HTTPS callback server stopped');
                this.server = null;
                this.port = null;
                resolve({ success: true });
            });
        });
    }

    get isRunning() {
        return this.server !== null;
    }
}

// =============================================================================
// HTML Response Templates
// =============================================================================

const HtmlTemplates = {
    callbackResponse(success, message) {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Daikin Authentication</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
        .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        .success { color: #4caf50; }
        .error { color: #f44336; }
        h1 { margin: 0 0 1rem; font-size: 1.5rem; }
        p { color: #666; margin: 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon ${success ? 'success' : 'error'}">${success ? '✓' : '✗'}</div>
        <h1>${success ? 'Success!' : 'Error'}</h1>
        <p>${message}</p>
        <p style="margin-top: 1rem; font-size: 0.9rem;">You can close this window and return to Homebridge.</p>
    </div>
</body>
</html>`;
    },
};

// =============================================================================
// Main Server Class
// =============================================================================

class DaikinCloudUiServer extends HomebridgePluginUiServer {
    constructor() {
        super();

        this.pendingAuth = null;
        this.authResult = null;
        this.authStartInProgress = false;
        this.callbackServer = new CallbackServer();

        this.registerHandlers();
        this.ready();
    }

    // -------------------------------------------------------------------------
    // Path Helpers
    // -------------------------------------------------------------------------

    getTokenFilePath() {
        return resolve(this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '', '.daikin-controller-cloud-tokenset');
    }

    getCertDir() {
        return resolve(this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '', 'daikin-cloud-certs');
    }

    // -------------------------------------------------------------------------
    // Request Handler Registration
    // -------------------------------------------------------------------------

    registerHandlers() {
        this.onRequest('/auth/status', this.handleGetAuthStatus.bind(this));
        this.onRequest('/auth/start', this.handleStartAuth.bind(this));
        this.onRequest('/auth/', this.handleCallback.bind(this));
        this.onRequest('/auth/revoke', this.handleRevokeAuth.bind(this));
        this.onRequest('/auth/test', this.handleTestConnection.bind(this));
        this.onRequest('/auth/poll', this.handlePollAuthResult.bind(this));
        this.onRequest('/auth/stop-server', this.handleStopServer.bind(this));
        this.onRequest('/config/validate', this.handleValidateConfig.bind(this));
        this.onRequest('/devices/list', this.handleListDevices.bind(this));
        this.onRequest('/api/rate-limit', this.handleGetRateLimit.bind(this));
    }

    // -------------------------------------------------------------------------
    // Auth Status Handler
    // -------------------------------------------------------------------------

    async handleGetAuthStatus() {
        try {
            const tokenSet = TokenManager.load(this.getTokenFilePath());
            return TokenManager.getStatus(tokenSet);
        } catch (error) {
            return { authenticated: false, error: error.message, message: 'Error reading token status' };
        }
    }

    // -------------------------------------------------------------------------
    // Start Auth Handler
    // -------------------------------------------------------------------------

    async handleStartAuth(payload) {
        if (this.authStartInProgress) {
            if (this.pendingAuth && this.callbackServer.isRunning) {
                return {
                    authUrl: OAuthService.buildAuthUrl(this.pendingAuth.clientId, this.pendingAuth.redirectUri, this.pendingAuth.state),
                    state: this.pendingAuth.state,
                    redirectUri: this.pendingAuth.redirectUri,
                    callbackServerRunning: true,
                    message: 'Authorization already in progress.',
                };
            }
            throw new Error('Authorization already in progress. Please wait.');
        }

        this.authStartInProgress = true;

        try {
            const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = payload;

            if (!clientId || !clientSecret) throw new Error('Client ID and Client Secret are required');
            if (!callbackServerExternalAddress) throw new Error('Callback Server Address is required');

            const port = parseInt(callbackServerPort || '8582', 10);
            const redirectUri = `https://${callbackServerExternalAddress}:${port}/callback`;
            const state = crypto.randomBytes(32).toString('hex');

            this.authResult = null;
            this.pendingAuth = { state, clientId, clientSecret, redirectUri, port, createdAt: Date.now() };

            await this.callbackServer.start(port, callbackServerExternalAddress, this.getCertDir(), (req, res) => {
                this.handleHttpsCallback(req, res);
            });

            return {
                authUrl: OAuthService.buildAuthUrl(clientId, redirectUri, state),
                state,
                redirectUri,
                callbackServerRunning: true,
                message: 'Authorization URL generated. Callback server is running.',
            };
        } catch (error) {
            this.pendingAuth = null;
            this.authStartInProgress = false;
            throw error;
        }
    }

    // -------------------------------------------------------------------------
    // HTTPS Callback Handler
    // -------------------------------------------------------------------------

    handleHttpsCallback(req, res) {
        const url = new URL(req.url, `https://${req.headers.host}`);

        if (url.pathname !== '/callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
            this.authResult = { success: false, error: errorDescription || error };
            this.sendCallbackResponse(res, false, errorDescription || error);
            return;
        }

        if (!code || !state) {
            this.authResult = { success: false, error: 'Missing code or state parameter' };
            this.sendCallbackResponse(res, false, 'Missing authorization code');
            return;
        }

        if (!this.pendingAuth || state !== this.pendingAuth.state) {
            this.authResult = { success: false, error: 'Invalid state parameter' };
            this.sendCallbackResponse(res, false, 'Invalid state parameter');
            return;
        }

        const { clientId, clientSecret, redirectUri } = this.pendingAuth;

        OAuthService.exchangeCode(code, clientId, clientSecret, redirectUri)
            .then((tokenSet) => {
                TokenManager.save(this.getTokenFilePath(), tokenSet);
                this.authResult = {
                    success: true,
                    message: 'Authentication successful!',
                    expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
                };
                this.pendingAuth = null;
                this.sendCallbackResponse(res, true, 'Authentication successful! You can close this window.');
            })
            .catch((err) => {
                this.authResult = { success: false, error: err.message };
                this.sendCallbackResponse(res, false, `Token exchange failed: ${err.message}`);
            });
    }

    sendCallbackResponse(res, success, message) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HtmlTemplates.callbackResponse(success, message));
    }

    // -------------------------------------------------------------------------
    // Manual Callback Handler
    // -------------------------------------------------------------------------

    async handleCallback(payload) {
        const { code, state } = payload;

        if (!this.pendingAuth) throw new Error('No pending authorization. Please start the auth flow again.');
        if (state !== this.pendingAuth.state) throw new Error('Invalid state parameter. Possible CSRF attack.');
        if (Date.now() - this.pendingAuth.createdAt > 5 * 60 * 1000) {
            this.pendingAuth = null;
            throw new Error('Authorization request expired. Please try again.');
        }

        const { clientId, clientSecret, redirectUri } = this.pendingAuth;

        try {
            const tokenSet = await OAuthService.exchangeCode(code, clientId, clientSecret, redirectUri);
            TokenManager.save(this.getTokenFilePath(), tokenSet);
            this.pendingAuth = null;

            return {
                success: true,
                message: 'Authentication successful! You can now close this window and restart Homebridge.',
                expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
            };
        } catch (error) {
            this.pendingAuth = null;
            throw new Error(`Token exchange failed: ${error.message}`);
        }
    }

    // -------------------------------------------------------------------------
    // Poll Auth Result Handler
    // -------------------------------------------------------------------------

    async handlePollAuthResult() {
        if (this.authResult) {
            const result = this.authResult;
            this.authResult = null;
            await this.handleStopServer();
            return result;
        }
        return { pending: true };
    }

    // -------------------------------------------------------------------------
    // Stop Server Handler
    // -------------------------------------------------------------------------

    async handleStopServer() {
        this.authStartInProgress = false;
        return await this.callbackServer.stop();
    }

    // -------------------------------------------------------------------------
    // Revoke Auth Handler
    // -------------------------------------------------------------------------

    async handleRevokeAuth(payload) {
        const tokenSet = TokenManager.load(this.getTokenFilePath());
        if (!tokenSet) return { success: true, message: 'No tokens to revoke' };

        const { clientId, clientSecret } = payload;

        if (tokenSet.refresh_token && clientId && clientSecret) {
            try {
                await OAuthService.revokeToken(tokenSet.refresh_token, clientId, clientSecret);
            } catch (error) {
                console.warn('Failed to revoke token at server:', error.message);
            }
        }

        TokenManager.delete(this.getTokenFilePath());
        return { success: true, message: 'Authentication revoked. You will need to re-authenticate.' };
    }

    // -------------------------------------------------------------------------
    // Test Connection Handler
    // -------------------------------------------------------------------------

    async handleTestConnection() {
        const tokenSet = TokenManager.load(this.getTokenFilePath());
        if (!tokenSet?.access_token) {
            return { success: false, message: 'Not authenticated. Please authenticate first.' };
        }

        try {
            const result = await ApiService.request('/v1/gateway-devices', tokenSet.access_token);
            return {
                success: true,
                message: `Connection successful! Found ${result.length || 0} device(s).`,
                deviceCount: result.length || 0,
            };
        } catch (error) {
            return { success: false, message: `Connection failed: ${error.message}`, error: error.message };
        }
    }

    // -------------------------------------------------------------------------
    // List Devices Handler
    // -------------------------------------------------------------------------

    async handleListDevices() {
        const tokenSet = TokenManager.load(this.getTokenFilePath());
        if (!tokenSet?.access_token) {
            return { success: false, devices: [], message: 'Not authenticated. Please authenticate first.' };
        }

        try {
            const gatewayDevices = await ApiService.request('/v1/gateway-devices', tokenSet.access_token);
            const devices = gatewayDevices.map(device => DeviceExtractor.extractAll(device));

            return { success: true, devices, message: `Found ${devices.length} device(s).` };
        } catch (error) {
            return { success: false, devices: [], message: `Failed to fetch devices: ${error.message}`, error: error.message };
        }
    }

    // -------------------------------------------------------------------------
    // Get Rate Limit Handler
    // -------------------------------------------------------------------------

    async handleGetRateLimit() {
        const tokenSet = TokenManager.load(this.getTokenFilePath());
        if (!tokenSet?.access_token) {
            return { success: false, message: 'Not authenticated' };
        }

        try {
            const result = await ApiService.requestWithHeaders('/v1/gateway-devices', tokenSet.access_token);
            return { success: true, headers: result.headers, rateLimit: result.rateLimit };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // -------------------------------------------------------------------------
    // Validate Config Handler
    // -------------------------------------------------------------------------

    async handleValidateConfig(payload) {
        const errors = [];
        const warnings = [];
        const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = payload;

        if (!clientId) errors.push('Client ID is required. Get it from the Daikin Developer Portal.');
        if (!clientSecret) errors.push('Client Secret is required. Get it from the Daikin Developer Portal.');

        if (!callbackServerExternalAddress) {
            errors.push('Callback Server External Address is required.');
        } else if (callbackServerExternalAddress === 'localhost' || callbackServerExternalAddress === '127.0.0.1') {
            errors.push('Callback address cannot be localhost. Use your external IP or domain.');
        }

        const port = parseInt(callbackServerPort || '8582', 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            errors.push('Invalid port number. Must be between 1 and 65535.');
        } else if (port < 1024) {
            warnings.push('Using a privileged port (< 1024) may require root permissions.');
        }

        return { valid: errors.length === 0, errors, warnings };
    }
}

// =============================================================================
// Initialize Server
// =============================================================================

(() => new DaikinCloudUiServer())();
