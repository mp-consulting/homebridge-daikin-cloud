const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { resolve, join } = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const os = require('os');

// Import from compiled src/api modules (single source of truth)
// Use path relative to this file, not cwd
const distPath = join(__dirname, '..', 'dist', 'src', 'api');
const { DaikinOAuth } = require(join(distPath, 'daikin-oauth'));
const { DaikinMobileOAuth } = require(join(distPath, 'daikin-mobile-oauth'));
const { DaikinApi } = require(join(distPath, 'daikin-api'));

// =============================================================================
// Configuration
// =============================================================================

const CLIMATE_CONTROL_IDS = ['climateControl', 'climateControlMainZone', 'climateControlSecondaryZone'];

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
      throw new Error(`Failed to generate SSL certificate: ${error.message}`);
    }
  },
};

// =============================================================================
// Token Management
// =============================================================================

const TokenManager = {
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

  save(filePath, tokenSet) {
    fs.writeFileSync(filePath, JSON.stringify(tokenSet, null, 2), { encoding: 'utf8', mode: 0o600 });
  },

  delete(filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  },

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
  }

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

  async stop() {
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
        <p class="message">${message}</p>
        <p class="hint">You can close this window and return to Homebridge.</p>
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
    this.callbackServer = new CallbackServer();

    this.registerHandlers();
    this.ready();
  }

  getTokenFilePath() {
    return resolve(this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '', '.daikin-controller-cloud-tokenset');
  }

  getMobileTokenFilePath() {
    return resolve(this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '', '.daikin-mobile-tokenset');
  }

  getCertDir() {
    return resolve(this.homebridgeStoragePath || process.env.UIX_STORAGE_PATH || '', 'daikin-cloud-certs');
  }

  getActiveTokenSet() {
    // Check mobile token first (takes precedence)
    const mobileTokenSet = TokenManager.load(this.getMobileTokenFilePath());
    if (mobileTokenSet?.access_token) {
      return mobileTokenSet;
    }
    // Fall back to developer portal token
    return TokenManager.load(this.getTokenFilePath());
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

    const port = parseInt(callbackServerPort || '8582', 10);
    const redirectUri = `https://${callbackServerExternalAddress}:${port}`;
    const state = crypto.randomBytes(32).toString('hex');

    this.pendingAuth = { state, clientId, clientSecret, redirectUri, port, createdAt: Date.now() };
    this.authResult = null;

    // Use static method from compiled src/api
    const authUrl = DaikinOAuth.buildAuthUrlStatic(clientId, redirectUri, state);
    console.log('[DaikinCloud] Generated auth URL:', authUrl);
    console.log('[DaikinCloud] Redirect URI:', redirectUri);

    // Try to start callback server for automatic code capture
    let callbackServerRunning = false;
    let callbackServerError = null;

    try {
      await this.callbackServer.start(
        port,
        callbackServerExternalAddress,
        this.getCertDir(),
        this.handleHttpsCallback.bind(this),
      );
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
    const url = new URL(req.url, `https://${req.headers.host}`);

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

    // Use static method from compiled src/api
    DaikinOAuth.exchangeCodeStatic(code, clientId, clientSecret, redirectUri)
      .then((tokenSet) => {
        TokenManager.save(this.getTokenFilePath(), tokenSet);
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

  sendCallbackResponse(res, success, message) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
        throw new Error('Invalid callback URL format');
      }
    }

    if (!code) {
      throw new Error('Authorization code is required');
    }
    if (!this.pendingAuth) {
      throw new Error('No pending authorization. Please start the auth flow again.');
    }
    if (state && state !== this.pendingAuth.state) {
      throw new Error('Invalid state parameter. Please try again.');
    }
    if (Date.now() - this.pendingAuth.createdAt > 10 * 60 * 1000) {
      this.pendingAuth = null;
      throw new Error('Authorization request expired. Please try again.');
    }

    const { clientId, clientSecret, redirectUri } = this.pendingAuth;

    try {
      // Use static method from compiled src/api
      const tokenSet = await DaikinOAuth.exchangeCodeStatic(code, clientId, clientSecret, redirectUri);
      TokenManager.save(this.getTokenFilePath(), tokenSet);
      this.pendingAuth = null;

      await this.callbackServer.stop();

      return {
        success: true,
        message: 'Authentication successful! Restart Homebridge to apply.',
        expiresAt: tokenSet.expires_at ? new Date(tokenSet.expires_at * 1000).toISOString() : null,
      };
    } catch (error) {
      throw new Error(`Token exchange failed: ${error.message}`);
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
    const mode = payload?.mode;

    // Get token based on mode parameter, or fall back to active token
    let tokenSet;
    if (mode === 'mobile_app') {
      tokenSet = TokenManager.load(this.getMobileTokenFilePath());
    } else if (mode === 'developer_portal') {
      tokenSet = TokenManager.load(this.getTokenFilePath());
    } else {
      tokenSet = this.getActiveTokenSet();
    }

    // If the requested mode's token doesn't exist or is invalid, fall back to active token
    if (!tokenSet?.access_token) {
      tokenSet = this.getActiveTokenSet();
    }

    if (!tokenSet?.access_token) {
      return { success: false, devices: [], message: 'Not authenticated. Please authenticate first.' };
    }

    try {
      // Use static method from compiled src/api
      const result = await DaikinApi.requestStatic('/v1/gateway-devices', tokenSet.access_token);
      const gatewayDevices = result.data;
      const devices = Array.isArray(gatewayDevices)
        ? gatewayDevices.map(device => DeviceExtractor.extractAll(device))
        : [];

      return { success: true, devices, message: `Found ${devices.length} device(s).` };
    } catch (error) {
      return { success: false, devices: [], message: `Failed to fetch devices: ${error.message}`, error: error.message };
    }
  }

  // -------------------------------------------------------------------------
  // Get Rate Limit Handler
  // -------------------------------------------------------------------------

  async handleGetRateLimit(payload) {
    const mode = payload?.mode;

    // Get token based on mode parameter, or fall back to active token
    let tokenSet;
    if (mode === 'mobile_app') {
      tokenSet = TokenManager.load(this.getMobileTokenFilePath());
    } else if (mode === 'developer_portal') {
      tokenSet = TokenManager.load(this.getTokenFilePath());
    } else {
      tokenSet = this.getActiveTokenSet();
    }

    if (!tokenSet?.access_token) {
      return { success: false, message: 'Not authenticated' };
    }

    try {
      // Use static method from compiled src/api
      const result = await DaikinApi.requestStatic('/v1/gateway-devices', tokenSet.access_token);
      return { success: true, rateLimit: result.rateLimit };
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

    if (!clientId) {
      errors.push('Client ID is required. Get it from the Daikin Developer Portal.');
    }
    if (!clientSecret) {
      errors.push('Client Secret is required. Get it from the Daikin Developer Portal.');
    }

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
