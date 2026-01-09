const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { resolve } = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

/**
 * Daikin OIDC Configuration
 */
const OIDC_CONFIG = {
    authorizationEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/authorize',
    tokenEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/token',
    revokeEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/revoke',
    apiEndpoint: 'https://api.onecta.daikineurope.com',
    scope: 'openid onecta:basic.integration',
};

class DaikinCloudUiServer extends HomebridgePluginUiServer {
    constructor() {
        super();

        // Pending authorization state
        this.pendingAuth = null;

        // Register request handlers
        this.onRequest('/auth/status', this.getAuthStatus.bind(this));
        this.onRequest('/auth/start', this.startAuth.bind(this));
        this.onRequest('/auth/callback', this.handleCallback.bind(this));
        this.onRequest('/auth/revoke', this.revokeAuth.bind(this));
        this.onRequest('/auth/test', this.testConnection.bind(this));
        this.onRequest('/config/validate', this.validateConfig.bind(this));

        this.ready();
    }

    /**
     * Get token file path (lazy initialization)
     */
    getTokenFilePath() {
        return resolve(this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '', '.daikin-controller-cloud-tokenset');
    }

    /**
     * Get current authentication status
     */
    async getAuthStatus() {
        try {
            const tokenSet = this.loadTokenSet();

            if (!tokenSet || !tokenSet.access_token) {
                return {
                    authenticated: false,
                    message: 'Not authenticated',
                };
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
        } catch (error) {
            return {
                authenticated: false,
                error: error.message,
                message: 'Error reading token status',
            };
        }
    }

    /**
     * Start OAuth authorization flow
     */
    async startAuth(payload) {
        const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = payload;

        if (!clientId || !clientSecret) {
            throw new Error('Client ID and Client Secret are required');
        }

        const port = callbackServerPort || '8582';
        const redirectUri = `https://${callbackServerExternalAddress}:${port}/callback`;

        // Generate state for CSRF protection
        const state = crypto.randomBytes(32).toString('hex');

        // Store pending auth info
        this.pendingAuth = {
            state,
            clientId,
            clientSecret,
            redirectUri,
            port: parseInt(port, 10),
            createdAt: Date.now(),
        };

        // Build authorization URL
        const authUrl = new URL(OIDC_CONFIG.authorizationEndpoint);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', OIDC_CONFIG.scope);
        authUrl.searchParams.set('state', state);

        return {
            authUrl: authUrl.toString(),
            state,
            redirectUri,
            message: 'Authorization URL generated. Open this URL in a new browser tab to authenticate.',
        };
    }

    /**
     * Handle OAuth callback with authorization code
     */
    async handleCallback(payload) {
        const { code, state } = payload;

        if (!this.pendingAuth) {
            throw new Error('No pending authorization. Please start the auth flow again.');
        }

        if (state !== this.pendingAuth.state) {
            throw new Error('Invalid state parameter. Possible CSRF attack.');
        }

        // Check if auth request is too old (5 minutes)
        if (Date.now() - this.pendingAuth.createdAt > 5 * 60 * 1000) {
            this.pendingAuth = null;
            throw new Error('Authorization request expired. Please try again.');
        }

        const { clientId, clientSecret, redirectUri } = this.pendingAuth;

        try {
            // Exchange code for tokens
            const tokenSet = await this.exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);

            // Save token set
            this.saveTokenSet(tokenSet);

            // Clear pending auth
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

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCodeForTokens(code, clientId, clientSecret, redirectUri) {
        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                client_secret: clientSecret,
            }).toString();

            const url = new URL(OIDC_CONFIG.tokenEndpoint);

            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const tokenSet = JSON.parse(data);
                        if (tokenSet.error) {
                            reject(new Error(tokenSet.error_description || tokenSet.error));
                        } else {
                            // Calculate expires_at from expires_in
                            if (tokenSet.expires_in && !tokenSet.expires_at) {
                                tokenSet.expires_at = Math.floor(Date.now() / 1000) + tokenSet.expires_in;
                            }
                            resolve(tokenSet);
                        }
                    } catch (e) {
                        reject(new Error(`Invalid response: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    /**
     * Revoke current authentication
     */
    async revokeAuth(payload) {
        const tokenSet = this.loadTokenSet();

        if (!tokenSet) {
            return { success: true, message: 'No tokens to revoke' };
        }

        const { clientId, clientSecret } = payload;

        // Try to revoke at Daikin's server (best effort)
        if (tokenSet.refresh_token && clientId && clientSecret) {
            try {
                await this.revokeTokenAtServer(tokenSet.refresh_token, clientId, clientSecret);
            } catch (error) {
                console.warn('Failed to revoke token at server:', error.message);
            }
        }

        // Delete local token file
        try {
            fs.unlinkSync(this.getTokenFilePath());
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        return {
            success: true,
            message: 'Authentication revoked. You will need to re-authenticate.',
        };
    }

    /**
     * Revoke token at Daikin's server
     */
    async revokeTokenAtServer(token, clientId, clientSecret) {
        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams({
                token,
                token_type_hint: 'refresh_token',
                client_id: clientId,
                client_secret: clientSecret,
            }).toString();

            const url = new URL(OIDC_CONFIG.revokeEndpoint);

            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    /**
     * Test connection to Daikin API
     */
    async testConnection() {
        const tokenSet = this.loadTokenSet();

        if (!tokenSet || !tokenSet.access_token) {
            return {
                success: false,
                message: 'Not authenticated. Please authenticate first.',
            };
        }

        try {
            const result = await this.makeApiRequest('/v1/gateway-devices', tokenSet.access_token);

            return {
                success: true,
                message: `Connection successful! Found ${result.length || 0} device(s).`,
                deviceCount: result.length || 0,
            };
        } catch (error) {
            return {
                success: false,
                message: `Connection failed: ${error.message}`,
                error: error.message,
            };
        }
    }

    /**
     * Make authenticated API request
     */
    async makeApiRequest(path, accessToken) {
        return new Promise((resolve, reject) => {
            const url = new URL(OIDC_CONFIG.apiEndpoint + path);

            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 401) {
                        reject(new Error('Token expired or invalid'));
                    } else if (res.statusCode === 429) {
                        reject(new Error('Rate limit exceeded'));
                    } else if (res.statusCode >= 400) {
                        reject(new Error(`API error: ${res.statusCode}`));
                    } else {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Invalid API response'));
                        }
                    }
                });
            });

            req.on('error', reject);
            req.end();
        });
    }

    /**
     * Validate configuration
     */
    async validateConfig(payload) {
        const errors = [];
        const warnings = [];

        const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = payload;

        // Required fields
        if (!clientId) {
            errors.push('Client ID is required. Get it from the Daikin Developer Portal.');
        }

        if (!clientSecret) {
            errors.push('Client Secret is required. Get it from the Daikin Developer Portal.');
        }

        if (!callbackServerExternalAddress) {
            errors.push('Callback Server External Address is required.');
        } else {
            // Validate address format
            if (callbackServerExternalAddress === 'localhost' || callbackServerExternalAddress === '127.0.0.1') {
                errors.push('Callback address cannot be localhost. Use your external IP or domain.');
            }
        }

        // Port validation
        const port = parseInt(callbackServerPort || '8582', 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            errors.push('Invalid port number. Must be between 1 and 65535.');
        } else if (port < 1024) {
            warnings.push('Using a privileged port (< 1024) may require root permissions.');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Load token set from file
     */
    loadTokenSet() {
        try {
            if (fs.existsSync(this.getTokenFilePath())) {
                const data = fs.readFileSync(this.getTokenFilePath(), 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading token set:', error.message);
        }
        return null;
    }

    /**
     * Save token set to file
     */
    saveTokenSet(tokenSet) {
        fs.writeFileSync(this.getTokenFilePath(), JSON.stringify(tokenSet, null, 2), 'utf8');
    }
}

(() => {
    return new DaikinCloudUiServer();
})();
