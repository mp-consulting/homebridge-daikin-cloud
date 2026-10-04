const { resolve, join } = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const os = require('os');
const net = require('net');

// Import from compiled src/api modules (single source of truth)
// Use path relative to this file, not cwd
const distPath = join(__dirname, '..', 'dist', 'src', 'api');
const { DaikinOAuth } = require(join(distPath, 'daikin-oauth'));
const { DaikinMobileOAuth } = require(join(distPath, 'daikin-mobile-oauth'));
const { DaikinApi } = require(join(distPath, 'daikin-api'));
const { configureHttpTransport } = require(join(distPath, 'http-transport'));
const { loadTokenFromFile, saveTokenToFile, deleteTokenFile } = require(join(distPath, 'token-storage'));
const {
  TOKEN_FILES,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_CALLBACK_BIND_ADDR,
  PENDING_AUTH_TTL_MS,
  RATE_LIMIT_STATUS_FILE,
} = require(join(__dirname, '..', 'dist', 'src', 'constants'));
const { validateConfig } = require(join(__dirname, '..', 'dist', 'src', 'config', 'config-manager'));
const { registerAssistant } = require('./assistant');

// =============================================================================
// Configuration
// =============================================================================

const CLIMATE_CONTROL_IDS = ['climateControl', 'climateControlMainZone', 'climateControlSecondaryZone'];

/** How long a /devices/list result is reused before calling the Daikin API again */
const DEVICES_CACHE_TTL_MS = 5 * 60 * 1000;

/** Security headers for the OAuth callback page */
const CALLBACK_RESPONSE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'X-Content-Type-Options': 'nosniff',
};

// =============================================================================
// Network Helpers
// =============================================================================

const NetUtils = {
  /**
   * Return the bind address if it is a valid IPv4/IPv6 literal, otherwise the default.
   */
  resolveBindAddress(bindAddr) {
    const value = typeof bindAddr === 'string' ? bindAddr.trim() : '';
    return value && net.isIP(value) !== 0 ? value : DEFAULT_CALLBACK_BIND_ADDR;
  },

  /**
   * True for loopback hosts: 127.0.0.0/8, ::1, IPv4-mapped loopback and "localhost".
   */
  isLoopback(host) {
    if (!host || typeof host !== 'string') {
      return false;
    }
    const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (value === 'localhost' || value.endsWith('.localhost')) {
      return true;
    }
    if (net.isIPv4(value)) {
      return value.startsWith('127.');
    }
    if (net.isIPv6(value)) {
      return value === '::1' || /^::ffff:127\./.test(value);
    }
    return false;
  },
};

// =============================================================================
// HTML Helpers
// =============================================================================

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =============================================================================
// SSL Certificate Utilities
// =============================================================================

const SSLUtils = {
  isIPAddress(str) {
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4Pattern.test(str) || ipv6Pattern.test(str);
  },

  /**
     * Validate that a hostname is safe for use in shell commands.
     * Only allows alphanumeric, dots, hyphens, and colons (for IPv6).
     */
  validateHostname(hostname) {
    if (!hostname || typeof hostname !== 'string') {
      throw new Error('Hostname is required');
    }
    if (!/^[a-zA-Z0-9.:_-]+$/.test(hostname)) {
      throw new Error('Invalid hostname: contains disallowed characters');
    }
    if (hostname.length > 253) {
      throw new Error('Hostname too long (max 253 characters)');
    }
  },

  generateCert(hostname, certDir) {
    this.validateHostname(hostname);

    const keyPath = resolve(certDir, 'server.key');
    const certPath = resolve(certDir, 'server.crt');

    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

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

    try {
      execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });

      const isIP = this.isIPAddress(hostname);
      const sanValue = isIP ? `IP:${hostname}` : `DNS:${hostname}`;
      const subj = `/CN=${hostname}/O=Homebridge Daikin Cloud/C=US`;

      execSync(
        `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "${subj}" -addext "subjectAltName=${sanValue}"`,
        { stdio: 'pipe' },
      );

      return {
        key: fs.readFileSync(keyPath, 'utf8'),
        cert: fs.readFileSync(certPath, 'utf8'),
      };
    } catch (error) {
      throw new Error(`Failed to generate SSL certificate: ${error.message}`, { cause: error });
    }
  },
};

// =============================================================================
// Token Management
// =============================================================================

const TokenManager = {
  // File access is shared with the plugin (Zod-validated reads, 0600 writes)
  load: (filePath) => loadTokenFromFile(filePath),
  save: (filePath, tokenSet) => saveTokenToFile(filePath, tokenSet),
  delete: (filePath) => deleteTokenFile(filePath),

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
// Device Data Extraction
// =============================================================================

const DeviceExtractor = {
  getManagementPoint(device, embeddedId) {
    return device.managementPoints?.find(mp => mp.embeddedId === embeddedId) || null;
  },

  getClimateControlPoint(device) {
    for (const id of CLIMATE_CONTROL_IDS) {
      const mp = this.getManagementPoint(device, id);
      if (mp) {
        return mp;
      }
    }
    return null;
  },

  extractName(device) {
    const climateControl = this.getClimateControlPoint(device);
    return climateControl?.name?.value || device.id || 'Unknown Device';
  },

  extractModel(device) {
    const gateway = this.getManagementPoint(device, 'gateway');
    return gateway?.modelInfo?.value || device.deviceModel || 'Unknown Model';
  },

  extractType(device) {
    if (!device.managementPoints) {
      return device.type || 'Unknown Type';
    }

    for (const mp of device.managementPoints) {
      if (mp.embeddedId === 'climateControl') {
        return 'Climate Control';
      }
      if (mp.embeddedId === 'domesticHotWaterTank') {
        return 'Hot Water Tank';
      }
    }
    return device.type || 'Unknown Type';
  },

  isOnline(device) {
    return device.isCloudConnectionUp?.value ?? false;
  },

  extractRoomTemp(device) {
    const climateControl = this.getClimateControlPoint(device);
    const roomTemp = climateControl?.sensoryData?.value?.roomTemperature;
    return roomTemp?.value !== undefined ? `${roomTemp.value}${roomTemp.unit || '°C'}` : null;
  },

  extractOutdoorTemp(device) {
    const climateControl = this.getClimateControlPoint(device);
    const outdoorTemp = climateControl?.sensoryData?.value?.outdoorTemperature;
    return outdoorTemp?.value !== undefined ? `${outdoorTemp.value}${outdoorTemp.unit || '°C'}` : null;
  },

  extractOperationMode(device) {
    const climateControl = this.getClimateControlPoint(device);
    return climateControl?.operationMode?.value || null;
  },

  extractPowerState(device) {
    const climateControl = this.getClimateControlPoint(device);
    return climateControl?.onOffMode?.value || null;
  },

  extractFeatures(device) {
    const features = [];
    if (!device.managementPoints) {
      return features;
    }

    for (const mp of device.managementPoints) {
      if (CLIMATE_CONTROL_IDS.includes(mp.embeddedId)) {
        if (mp.onOffMode) {
          features.push('Power');
        }
        if (mp.temperatureControl) {
          features.push('Temperature');
        }
        if (mp.operationMode) {
          features.push('Mode');
        }
        if (mp.fanControl) {
          features.push('Fan');
        }
        if (mp.sensoryData) {
          features.push('Sensors');
        }
      }
      if (mp.embeddedId === 'domesticHotWaterTank') {
        if (mp.onOffMode) {
          features.push('Hot Water');
        }
        if (mp.temperatureControl) {
          features.push('Water Temp');
        }
      }
    }
    return features;
  },

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
// Callback Server
// =============================================================================

class CallbackServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.connections = new Set();
    this.ttlTimer = null;
  }

  /**
   * Start the HTTPS callback server.
   * @param {object} options
   * @param {number} options.port - Port to listen on
   * @param {string} options.hostname - External hostname/IP used for the certificate
   * @param {string} [options.bindAddr] - Interface to bind (validated IP literal)
   * @param {string} options.certDir - Directory for the self-signed certificate
   * @param {Function} options.requestHandler - HTTPS request handler
   * @param {number} [options.ttlMs] - Auto-stop delay (defaults to the pending auth lifetime)
   */
  async start({ port, hostname, bindAddr, certDir, requestHandler, ttlMs = PENDING_AUTH_TTL_MS }) {
    await this.stop();

    const host = NetUtils.resolveBindAddress(bindAddr);

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
              this.server = null;
              reject(err);
            }
          });

          this.server.listen(port, host, () => {
            console.log(`HTTPS callback server listening on ${host}:${port}`);
            this.port = port;
            this.scheduleAutoStop(ttlMs);
            resolve({ success: true, port, host });
          });
        } catch (error) {
          reject(error);
        }
      };

      tryStart();
    });
  }

  scheduleAutoStop(ttlMs) {
    this.clearAutoStop();
    this.ttlTimer = setTimeout(() => {
      this.ttlTimer = null;
      console.log('[DaikinCloud] Authorization window expired, stopping callback server');
      this.stop().catch(() => {});
    }, ttlMs);
    if (typeof this.ttlTimer.unref === 'function') {
      this.ttlTimer.unref();
    }
  }

  clearAutoStop() {
    if (this.ttlTimer) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }
  }

  async stop() {
    this.clearAutoStop();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve({ success: true });
        return;
      }

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
    const icon = success
      ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      : '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f44336" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daikin Authentication</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 1rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            padding: 2.5rem;
            background: white;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 400px;
            width: 100%;
        }
        .icon { margin-bottom: 1.5rem; }
        h1 {
            margin: 0 0 0.75rem;
            font-size: 1.75rem;
            font-weight: 600;
            color: ${success ? '#4caf50' : '#f44336'};
        }
        .message {
            color: #333;
            font-size: 1rem;
            line-height: 1.5;
            margin: 0 0 1.5rem;
        }
        .hint {
            color: #888;
            font-size: 0.875rem;
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">${icon}</div>
        <h1>${success ? 'Success!' : 'Error'}</h1>
        <p class="message">${escapeHtml(message)}</p>
        <p class="hint">You can close this window and return to Homebridge.</p>
    </div>
</body>
</html>`;
  },
};

// =============================================================================
// Main Server Class
// =============================================================================

/**
 * Build the UI server class on top of HomebridgePluginUiServer. The base is
 * passed in because @homebridge/plugin-ui-utils is ESM-only: require() loads it
 * on Node >= 20.19 / 22.12, older runtimes need import() (see loadUiUtils).
 */
function createDaikinCloudUiServer(HomebridgePluginUiServer) {
  return class DaikinCloudUiServer extends HomebridgePluginUiServer {
    constructor() {
      super();

      this.pendingAuth = null;
      this.authResult = null;
      this.callbackServer = new CallbackServer();
      this.devicesCache = new Map();

      this.applyTransportFromConfig();
      this.registerHandlers();

      // Assistant: /ai/status, /ai/explain, /ai/ask, /ai/config (configured in Homebridge AI Kit).
      // ai-core is ESM and loaded with import(); report ready once its routes are in place
      // (registerAssistant never rejects) so the UI's first /ai/status call finds them.
      this.assistantReady = registerAssistant(this).then(() => this.ready());
    }

    getStoragePath() {
      return this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '';
    }

    /**
   * Read the DaikinCloud platform block from the Homebridge config.json.
   * Throws if the config file cannot be read or parsed.
   */
    readPlatformConfig() {
      const configPath = this.homebridgeConfigPath || resolve(this.getStoragePath(), 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return (config.platforms || []).find((p) => p.platform === 'DaikinCloud') || null;
    }

    /**
   * Honour the plugin's httpTransport setting in the setup wizard too, so a
   * network that blocks Node's TLS fingerprint (issue #6) can still complete
   * authentication from the UI. Env var DAIKIN_HTTP_TRANSPORT wins.
   */
    applyTransportFromConfig() {
      try {
        const platform = this.readPlatformConfig();
        configureHttpTransport(platform && platform.httpTransport);
      } catch (e) {
        console.log('[DaikinCloud] Could not read httpTransport from config, using default:', e.message);
      }
    }

    /**
   * Resolve the callback server bind address from the request payload, then the
   * saved platform config, falling back to DEFAULT_CALLBACK_BIND_ADDR when the
   * value is missing or not an IPv4/IPv6 literal.
   */
    getCallbackBindAddress(payload) {
      let configured = payload?.oidcCallbackServerBindAddr;
      if (configured === undefined || configured === null || configured === '') {
        try {
          configured = this.readPlatformConfig()?.oidcCallbackServerBindAddr;
        } catch (e) {
          configured = undefined;
        }
      }

      const bindAddr = NetUtils.resolveBindAddress(configured);
      if (configured && bindAddr !== String(configured).trim()) {
        console.warn(`[DaikinCloud] Invalid callback bind address "${configured}", using ${bindAddr}`);
      }
      return bindAddr;
    }

    getTokenFilePath() {
      return resolve(this.getStoragePath(), TOKEN_FILES.developer_portal);
    }

    getMobileTokenFilePath() {
      return resolve(this.getStoragePath(), TOKEN_FILES.mobile_app);
    }

    getCertDir() {
      return resolve(this.getStoragePath(), 'daikin-cloud-certs');
    }

    getRateLimitFilePath() {
      return resolve(this.getStoragePath(), RATE_LIMIT_STATUS_FILE);
    }

    /**
   * Active token set and the auth mode it belongs to (mobile takes precedence).
   */
    getActiveToken() {
      const mobileTokenSet = TokenManager.load(this.getMobileTokenFilePath());
      if (mobileTokenSet?.access_token) {
        return { tokenSet: mobileTokenSet, mode: 'mobile_app' };
      }
      return { tokenSet: TokenManager.load(this.getTokenFilePath()), mode: 'developer_portal' };
    }

    getActiveTokenSet() {
      return this.getActiveToken().tokenSet;
    }

    /**
   * Token set for the requested mode, falling back to the active token set.
   */
    resolveToken(mode) {
      let tokenSet = null;
      if (mode === 'mobile_app') {
        tokenSet = TokenManager.load(this.getMobileTokenFilePath());
      } else if (mode === 'developer_portal') {
        tokenSet = TokenManager.load(this.getTokenFilePath());
      }

      if (tokenSet?.access_token) {
        return { tokenSet, mode };
      }
      return this.getActiveToken();
    }

    invalidateDevicesCache() {
      this.devicesCache.clear();
    }

    isPendingAuthExpired() {
      return !!this.pendingAuth && Date.now() - this.pendingAuth.createdAt > PENDING_AUTH_TTL_MS;
    }

    registerHandlers() {
      this.onRequest('/auth/status', this.handleGetAuthStatus.bind(this));
      this.onRequest('/auth/start', this.handleStartAuth.bind(this));
      this.onRequest('/auth/', this.handleCallback.bind(this));
      this.onRequest('/auth/revoke', this.handleRevokeAuth.bind(this));
      this.onRequest('/auth/test', this.handleTestConnection.bind(this));
      this.onRequest('/auth/poll', this.handlePollAuthResult.bind(this));
      this.onRequest('/auth/stop-server', this.handleStopServer.bind(this));
      this.onRequest('/auth/mobile-test', this.handleMobileAuthTest.bind(this));
      this.onRequest('/config/validate', this.handleValidateConfig.bind(this));
      this.onRequest('/devices/list', this.handleListDevices.bind(this));
      this.onRequest('/api/rate-limit', this.handleGetRateLimit.bind(this));
      this.onRequest('/server/info', this.handleGetServerInfo.bind(this));
    }

    // -------------------------------------------------------------------------
    // Server Info Handler
    // -------------------------------------------------------------------------

    async handleGetServerInfo() {
      const ipAddresses = this.getServerIpAddresses();
      return {
        ipAddresses,
        primaryIp: ipAddresses[0] || null,
        hostname: os.hostname(),
      };
    }

    getServerIpAddresses() {
      const interfaces = os.networkInterfaces();
      const addresses = [];

      for (const nets of Object.values(interfaces)) {
        if (!nets) {
          continue;
        }
        for (const net of nets) {
        // Skip internal and non-IPv4 addresses
          if (net.internal || net.family !== 'IPv4') {
            continue;
          }
          addresses.push(net.address);
        }
      }

      return addresses;
    }

    // -------------------------------------------------------------------------
    // Auth Status Handler
    // -------------------------------------------------------------------------

    async handleGetAuthStatus() {
      try {
      // Check both token files - mobile takes precedence if exists
        const mobileTokenSet = TokenManager.load(this.getMobileTokenFilePath());
        const devPortalTokenSet = TokenManager.load(this.getTokenFilePath());

        if (mobileTokenSet?.access_token) {
          const status = TokenManager.getStatus(mobileTokenSet);
          status.authMode = 'mobile_app';
          return status;
        }

        if (devPortalTokenSet?.access_token) {
          const status = TokenManager.getStatus(devPortalTokenSet);
          status.authMode = 'developer_portal';
          return status;
        }

        return { authenticated: false, message: 'Not authenticated' };
      } catch (error) {
        return { authenticated: false, error: error.message, message: 'Error reading token status' };
      }
    }

    // -------------------------------------------------------------------------
    // Start Auth Handler
    // -------------------------------------------------------------------------

    async handleStartAuth(payload) {
      const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = payload;

      if (!clientId || !clientSecret) {
        throw new Error('Client ID and Client Secret are required');
      }
      if (!callbackServerExternalAddress) {
        throw new Error('Callback Server Address is required');
      }

      const bindAddr = this.getCallbackBindAddress(payload);
      if (NetUtils.isLoopback(bindAddr) && !NetUtils.isLoopback(callbackServerExternalAddress)) {
      // The browser is redirected to the external address, which can never reach a loopback-only server
        throw new Error(
          `The callback server bind address is ${bindAddr} (this machine only), but the callback address is ` +
        `${callbackServerExternalAddress}, so Daikin's redirect could never reach it. Set "Callback Server Bind Address" ` +
        'to 0.0.0.0 (or this host\'s LAN IP) in Settings > Network, then start authentication again.',
        );
      }

      const port = parseInt(callbackServerPort || String(DEFAULT_CALLBACK_PORT), 10);
      const redirectUri = `https://${callbackServerExternalAddress}:${port}`;
      const state = crypto.randomBytes(32).toString('hex');

      this.pendingAuth = { state, clientId, clientSecret, redirectUri, port, createdAt: Date.now() };
      this.authResult = null;
      this.invalidateDevicesCache();

      // Use static method from compiled src/api
      const authUrl = DaikinOAuth.buildAuthUrlStatic(clientId, redirectUri, state);
      console.log('[DaikinCloud] Redirect URI:', redirectUri);

      // Try to start callback server for automatic code capture
      let callbackServerRunning = false;
      let callbackServerError = null;

      try {
        await this.callbackServer.start({
          port,
          hostname: callbackServerExternalAddress,
          bindAddr,
          certDir: this.getCertDir(),
          requestHandler: this.handleHttpsCallback.bind(this),
        });
        callbackServerRunning = true;
        console.log('[DaikinCloud] Callback server started successfully');
      } catch (error) {
        callbackServerError = error.message;
        console.warn('[DaikinCloud] Failed to start callback server:', error.message);
      }

      return {
        authUrl,
        state,
        redirectUri,
        callbackServerRunning,
        callbackServerError,
        message: callbackServerRunning
          ? 'Callback server is running. Authentication will complete automatically.'
          : 'Could not start callback server. After authenticating, copy the full callback URL and paste it below.',
      };
    }

    // -------------------------------------------------------------------------
    // HTTPS Callback Handler
    // -------------------------------------------------------------------------

    handleHttpsCallback(req, res) {
      let url;
      try {
        url = new URL(req.url, 'https://localhost');
      } catch (e) {
        this.sendCallbackResponse(res, false, 'Invalid request', 400);
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      // Requests that do not carry the pending state are not ours: reject them
      // without touching authResult so they cannot disrupt a running login.
      if (!this.pendingAuth || !state || state !== this.pendingAuth.state) {
        this.sendCallbackResponse(res, false, 'Invalid or missing state parameter', 400);
        return;
      }

      if (this.isPendingAuthExpired()) {
        this.pendingAuth = null;
        this.authResult = { success: false, error: 'Authorization request expired. Please try again.' };
        this.sendCallbackResponse(res, false, 'Authorization request expired. Please start again from Homebridge.', 400);
        this.callbackServer.stop().catch(() => {});
        return;
      }

      if (error) {
        this.authResult = { success: false, error: errorDescription || error };
        this.sendCallbackResponse(res, false, errorDescription || error);
        return;
      }

      if (!code) {
        this.authResult = { success: false, error: 'Missing code parameter' };
        this.sendCallbackResponse(res, false, 'Missing authorization code', 400);
        return;
      }

      const { clientId, clientSecret, redirectUri } = this.pendingAuth;

      // Use static method from compiled src/api
      return DaikinOAuth.exchangeCodeStatic(code, clientId, clientSecret, redirectUri)
        .then((tokenSet) => {
          TokenManager.save(this.getTokenFilePath(), tokenSet);
          this.invalidateDevicesCache();
          this.authResult = {
            success: true,
            message: 'Authentication successful!',
            expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
          };
          this.pendingAuth = null;
          this.sendCallbackResponse(res, true, 'Authentication successful! You can close this window.');
          this.callbackServer.stop().catch(() => {});
        })
        .catch((err) => {
          this.authResult = { success: false, error: err.message };
          this.sendCallbackResponse(res, false, `Token exchange failed: ${err.message}`);
        });
    }

    sendCallbackResponse(res, success, message, statusCode = 200) {
      res.writeHead(statusCode, CALLBACK_RESPONSE_HEADERS);
      res.end(HtmlTemplates.callbackResponse(success, message));
    }

    // -------------------------------------------------------------------------
    // Manual Callback Handler
    // -------------------------------------------------------------------------

    async handleCallback(payload) {
      let { code, state, callbackUrl } = payload;

      if (callbackUrl) {
        try {
          const url = new URL(callbackUrl);
          code = url.searchParams.get('code');
          state = url.searchParams.get('state');
        } catch (e) {
          throw new Error('Invalid callback URL format', { cause: e });
        }
      }

      if (!code) {
        throw new Error('Authorization code is required');
      }
      if (!this.pendingAuth) {
        throw new Error('No pending authorization. Please start the auth flow again.');
      }
      if (!state || state !== this.pendingAuth.state) {
        throw new Error('Invalid or missing state parameter. Please paste the full callback URL or start again.');
      }
      if (this.isPendingAuthExpired()) {
        this.pendingAuth = null;
        throw new Error('Authorization request expired. Please try again.');
      }

      const { clientId, clientSecret, redirectUri } = this.pendingAuth;

      try {
      // Use static method from compiled src/api
        const tokenSet = await DaikinOAuth.exchangeCodeStatic(code, clientId, clientSecret, redirectUri);
        TokenManager.save(this.getTokenFilePath(), tokenSet);
        this.invalidateDevicesCache();
        this.pendingAuth = null;

        await this.callbackServer.stop();

        return {
          success: true,
          message: 'Authentication successful! Restart Homebridge to apply.',
          expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
        };
      } catch (error) {
        throw new Error(`Token exchange failed: ${error.message}`, { cause: error });
      }
    }

    // -------------------------------------------------------------------------
    // Poll Auth Result Handler
    // -------------------------------------------------------------------------

    async handlePollAuthResult() {
      if (this.authResult) {
        const result = { ...this.authResult };
        if (result.success) {
          this.authResult = null;
          await this.callbackServer.stop();
        }
        return result;
      }

      const tokenSet = TokenManager.load(this.getTokenFilePath());
      if (tokenSet && tokenSet.access_token) {
        return {
          success: true,
          message: 'Authentication successful!',
          expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
        };
      }
      return { pending: true };
    }

    // -------------------------------------------------------------------------
    // Stop Server Handler
    // -------------------------------------------------------------------------

    async handleStopServer() {
      this.pendingAuth = null;
      this.authResult = null;
      await this.callbackServer.stop();
      return { success: true };
    }

    // -------------------------------------------------------------------------
    // Mobile Auth Test Handler
    // -------------------------------------------------------------------------

    async handleMobileAuthTest(payload) {
      const { email, password } = payload;

      if (!email || !password) {
        return { success: false, message: 'Email and password are required' };
      }

      const tokenFilePath = this.getMobileTokenFilePath();
      this.invalidateDevicesCache();

      try {
      // Create a temporary mobile OAuth client
        const mobileOAuth = new DaikinMobileOAuth({
          email,
          password,
          tokenFilePath,
        });

        // Perform authentication
        console.log('[DaikinCloud] Testing mobile app authentication...');
        const tokenSet = await mobileOAuth.authenticate();
        console.log('[DaikinCloud] Mobile authentication successful');

        // Test API access and get device count
        let deviceCount = 0;
        let rateLimit = null;

        try {
          const result = await DaikinApi.requestStatic('/v1/gateway-devices', tokenSet.access_token);
          deviceCount = Array.isArray(result.data) ? result.data.length : 0;
          rateLimit = result.rateLimit;
        } catch (apiError) {
          console.warn('[DaikinCloud] API test failed:', apiError.message);
        }

        return {
          success: true,
          message: 'Authentication successful!',
          deviceCount,
          rateLimit,
          expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
        };
      } catch (error) {
        console.error('[DaikinCloud] Mobile auth test failed:', error.message);
        return {
          success: false,
          message: error.message || 'Authentication failed',
        };
      }
    }

    // -------------------------------------------------------------------------
    // Revoke Auth Handler
    // -------------------------------------------------------------------------

    async handleRevokeAuth(payload) {
      this.invalidateDevicesCache();

      const devPortalTokenSet = TokenManager.load(this.getTokenFilePath());
      const mobileTokenSet = TokenManager.load(this.getMobileTokenFilePath());

      if (!devPortalTokenSet && !mobileTokenSet) {
        return { success: true, message: 'No tokens to revoke' };
      }

      const { clientId, clientSecret } = payload;

      if (devPortalTokenSet?.refresh_token && clientId && clientSecret) {
        try {
        // Use static method from compiled src/api
          await DaikinOAuth.revokeTokenStatic(devPortalTokenSet.refresh_token, clientId, clientSecret);
        } catch (error) {
          console.warn('Failed to revoke token at server:', error.message);
        }
      }

      // Delete both token files
      TokenManager.delete(this.getTokenFilePath());
      TokenManager.delete(this.getMobileTokenFilePath());
      return { success: true, message: 'Authentication revoked. You will need to re-authenticate.' };
    }

    // -------------------------------------------------------------------------
    // Test Connection Handler
    // -------------------------------------------------------------------------

    async handleTestConnection() {
      const tokenSet = this.getActiveTokenSet();
      if (!tokenSet?.access_token) {
        return { success: false, message: 'Not authenticated. Please authenticate first.' };
      }

      try {
      // Use static method from compiled src/api
        const result = await DaikinApi.requestStatic('/v1/gateway-devices', tokenSet.access_token);
        const devices = result.data;
        return {
          success: true,
          message: `Connection successful! Found ${Array.isArray(devices) ? devices.length : 0} device(s).`,
          deviceCount: Array.isArray(devices) ? devices.length : 0,
        };
      } catch (error) {
        return { success: false, message: `Connection failed: ${error.message}`, error: error.message };
      }
    }

    // -------------------------------------------------------------------------
    // List Devices Handler
    // -------------------------------------------------------------------------

    async handleListDevices(payload) {
    // Token for the requested mode, or fall back to the active token
      const { tokenSet, mode } = this.resolveToken(payload?.mode);

      if (!tokenSet?.access_token) {
        return { success: false, devices: [], message: 'Not authenticated. Please authenticate first.' };
      }

      // Reuse a recent result to spare the daily API quota (explicit refresh bypasses it)
      if (payload?.refresh) {
        this.devicesCache.delete(mode);
      }
      const cached = this.devicesCache.get(mode);
      if (cached && Date.now() - cached.fetchedAt < DEVICES_CACHE_TTL_MS) {
        return { ...cached.result, cached: true, fetchedAt: new Date(cached.fetchedAt).toISOString() };
      }

      try {
      // Use static method from compiled src/api
        const result = await DaikinApi.requestStatic('/v1/gateway-devices', tokenSet.access_token);
        const gatewayDevices = result.data;
        const devices = Array.isArray(gatewayDevices)
          ? gatewayDevices.map(device => DeviceExtractor.extractAll(device))
          : [];

        const response = { success: true, devices, message: `Found ${devices.length} device(s).` };
        const fetchedAt = Date.now();
        this.devicesCache.set(mode, { result: response, fetchedAt });
        return { ...response, cached: false, fetchedAt: new Date(fetchedAt).toISOString() };
      } catch (error) {
        return { success: false, devices: [], message: `Failed to fetch devices: ${error.message}`, error: error.message };
      }
    }

    // -------------------------------------------------------------------------
    // Get Rate Limit Handler
    // -------------------------------------------------------------------------

    /**
   * Report the rate limit status the running plugin records after each API
   * response, instead of spending an API call just to read the headers.
   */
    async handleGetRateLimit() {
      let status;
      try {
        status = JSON.parse(fs.readFileSync(this.getRateLimitFilePath(), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') {
          return {
            success: false,
            noData: true,
            message: 'No data yet — the plugin records this after its next API call.',
          };
        }
        return { success: false, message: `Could not read rate limit status: ${error.message}` };
      }

      if (!status || typeof status !== 'object') {
        return { success: false, message: 'Could not read rate limit status: invalid file contents' };
      }

      const { limitMinute, remainingMinute, limitDay, remainingDay, mode, updatedAt } = status;
      const updatedAtMs = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
      const hasTime = Number.isFinite(updatedAtMs);

      return {
        success: true,
        rateLimit: { limitMinute, remainingMinute, limitDay, remainingDay },
        mode: mode || null,
        updatedAt: hasTime ? new Date(updatedAtMs).toISOString() : null,
        ageMs: hasTime ? Math.max(0, Date.now() - updatedAtMs) : null,
      };
    }

    // -------------------------------------------------------------------------
    // Validate Config Handler
    // -------------------------------------------------------------------------

    /**
   * Validate the Developer Portal wizard fields with the plugin's own rules
   * (ConfigManager), so the UI and the plugin can never disagree.
   * Response: { valid, errors, warnings }.
   */
    async handleValidateConfig(payload) {
      const { clientId, clientSecret, callbackServerExternalAddress, callbackServerPort } = payload || {};
      return validateConfig({
        platform: 'DaikinCloud',
        authMode: 'developer_portal',
        clientId,
        clientSecret,
        callbackServerExternalAddress,
        callbackServerPort,
      });
    }
  };
}

// =============================================================================
// Initialize Server
// =============================================================================

/**
 * Load @homebridge/plugin-ui-utils synchronously when the runtime supports
 * require() of ES modules, otherwise return null so the caller uses import().
 */
function loadUiUtilsSync() {
  try {
    return require('@homebridge/plugin-ui-utils');
  } catch (error) {
    if (error.code === 'ERR_REQUIRE_ESM') {
      return null;
    }
    throw error;
  }
}

async function loadUiUtils() {
  return loadUiUtilsSync() || import('@homebridge/plugin-ui-utils');
}

const uiUtils = loadUiUtilsSync();

module.exports = {
  // undefined on runtimes without require(esm); use createDaikinCloudUiServer
  DaikinCloudUiServer: uiUtils ? createDaikinCloudUiServer(uiUtils.HomebridgePluginUiServer) : undefined,
  createDaikinCloudUiServer,
  loadUiUtils,
  CallbackServer,
  SSLUtils,
  NetUtils,
  TokenManager,
  DeviceExtractor,
  HtmlTemplates,
  escapeHtml,
  DEVICES_CACHE_TTL_MS,
};

// Homebridge UI forks this file as a child process; only start the server then,
// so tests can require it without side effects.
if (require.main === module) {
  loadUiUtils()
    .then(({ HomebridgePluginUiServer }) => {
      const DaikinCloudUiServer = createDaikinCloudUiServer(HomebridgePluginUiServer);
      return new DaikinCloudUiServer();
    })
    .catch((error) => {
      console.error('Failed to start the Daikin Cloud UI server:', error);
      process.exit(1);
    });
}
