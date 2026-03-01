/**
 * Daikin Mobile App Authentication Flow
 *
 * Replicates the Gigya (SAP CDC) PKCE authentication flow used by the Daikin Onecta mobile app.
 *
 * Flow:
 * 1. Call /authorize with PKCE to get context JWT
 * 2. Call accounts.login with email/password to get login_token
 * 3. Call /authorize/continue with context + login_token to get authorization code
 * 4. Exchange code for tokens at /token endpoint with PKCE verifier
 */

const https = require('https');
const crypto = require('crypto');
const readline = require('readline');

// Configuration from mobile app
const CONFIG = {
  apiKey: '3_xRB3jaQ62bVjqXU1omaEsPDVYC0Twi1zfq1zHPu_5HFT0zWkDvZJS97Yw1loJnTm',
  clientId: 'FjS6T5oZHvzpZENIDybFRdtK',
  clientSecret: '_yWGLBGUnQFrN-u7uIOAZhSBsJOfcnBs0IS87wTgUvUmnLnEOs4NQmaKagqZBpQpG0XYl07KeCx8XHHKxAn24w',
  redirectUri: 'daikinunified://cdc/',
  baseUrl: 'https://cdc.daikin.eu',
  idpTokenEndpoint: 'https://idp.onecta.daikineurope.com/v1/oidc/token',
  scope: 'openid onecta:onecta.application offline_access',
};

const OIDC_BASE = `${CONFIG.baseUrl}/oidc/op/v1.0/${CONFIG.apiKey}`;

// Generate PKCE challenge pair
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Helper to make HTTPS requests
function httpsRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Step 1: Get OIDC context via authorize endpoint with PKCE
async function getOidcContext(pkce) {
  console.log('\n[1/4] Getting OIDC context with PKCE...');

  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.redirectUri,
    response_type: 'code',
    scope: CONFIG.scope,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: crypto.randomBytes(16).toString('hex'),
  });

  const url = `${OIDC_BASE}/authorize?${params}`;
  const response = await httpsRequest(url, { method: 'GET' });

  if (response.statusCode === 302) {
    const location = response.headers.location;

    // Extract context from redirect URL
    const contextMatch = location.match(/context=([^&]+)/);
    if (contextMatch) {
      const context = decodeURIComponent(contextMatch[1]);
      console.log('   ✓ Context obtained');
      return context;
    }
  }

  throw new Error('Failed to get OIDC context');
}

// Generate riskContext fingerprint (simplified)
function generateRiskContext() {
  const now = new Date();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  return JSON.stringify({
    b0: 14063,
    b1: [0, 2, 2, 0],
    b2: 4,
    b3: [],
    b4: 2,
    b5: 1,
    b6: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
    b7: [],
    b8: timeStr,
    b9: 0,
    b10: { state: 'denied' },
    b11: false,
    b12: null,
    b13: [5, '402|874|24', false, true],
  });
}

// Step 1.5: Initialize Gigya SDK and get required cookies
async function initGigyaSdk(context) {
  console.log('\n[1.5/4] Initializing Gigya SDK...');

  // Build the pageURL like the mobile app does (with context from authorize)
  const proxyUrl = `https://id.daikin.eu/cdc/onecta/oidc/proxy.html?context=${encodeURIComponent(context)}&client_id=${CONFIG.clientId}&mode=login&scope=${encodeURIComponent(CONFIG.scope)}&gig_skipConsent=true`;

  const params = new URLSearchParams({
    apiKey: CONFIG.apiKey,
    pageURL: proxyUrl,
    sdk: 'js_latest',
    sdkBuild: '18305',
    format: 'json',
  });

  const response = await httpsRequest(
    `${CONFIG.baseUrl}/accounts.webSdkBootstrap?${params}`,
    {
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'Origin': 'https://id.daikin.eu',
        'Referer': 'https://id.daikin.eu/',
      },
    },
  );

  // Extract cookies from response headers (gmid, ucid, hasGmid)
  const cookies = [];
  const setCookies = response.headers['set-cookie'];
  if (setCookies) {
    const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const cookie of cookieArray) {
      const match = cookie.match(/^([^=]+=[^;]+)/);
      if (match) {
        cookies.push(match[1]);
      }
    }
  }

  // Add bootstrap cookie
  cookies.push(`gig_bootstrap_${CONFIG.apiKey}=cdc_ver4`);

  const cookieStr = cookies.join('; ');
  console.log('   ✓ SDK initialized (got', cookies.length, 'cookies)');
  return cookieStr;
}

// Step 2: Login with Gigya
async function gigyaLogin(email, password, cookies) {
  console.log('\n[2/4] Authenticating with Gigya...');

  const params = new URLSearchParams({
    loginID: email,
    password: password,
    sessionExpiration: '31536000',
    targetEnv: 'jssdk',
    include: 'profile,data,emails,subscriptions,preferences,',
    includeUserInfo: 'true',
    loginMode: 'standard',
    lang: 'en',
    riskContext: generateRiskContext(),
    APIKey: CONFIG.apiKey,
    source: 'showScreenSet',
    sdk: 'js_latest',
    authMode: 'cookie',
    pageURL: `https://id.daikin.eu/cdc/onecta/oidc/registration-login.html?gig_client_id=${CONFIG.clientId}`,
    sdkBuild: '18305',
    format: 'json',
  });

  const response = await httpsRequest(
    `${CONFIG.baseUrl}/accounts.login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString()),
        'Origin': 'https://id.daikin.eu',
        'Referer': 'https://id.daikin.eu/',
        'Cookie': cookies,
      },
    },
    params.toString(),
  );

  const result = JSON.parse(response.body);

  if (result.errorCode !== 0) {
    console.log('   Debug - Full error response:', JSON.stringify(result, null, 2));
    throw new Error(`Login failed (code ${result.errorCode}): ${result.errorMessage || result.errorDetails}`);
  }

  console.log('   ✓ Login successful');

  // Get login_token from sessionInfo
  if (result.sessionInfo && result.sessionInfo.login_token) {
    return result.sessionInfo.login_token;
  }

  throw new Error('No login_token in response');
}

// Step 3: Continue authorization with login token
async function authorizeWithToken(context, loginToken, cookies) {
  console.log('\n[3/4] Exchanging login token for authorization code...');

  const params = new URLSearchParams({
    context: context,
    login_token: loginToken,
  });

  // Add login token cookie (glt_{apiKey}) - required for authorize/continue
  const cookieStr = cookies + `; glt_${CONFIG.apiKey}=${loginToken}`;

  const url = `${OIDC_BASE}/authorize/continue?${params}`;
  const response = await httpsRequest(url, {
    method: 'GET',
    headers: {
      'Cookie': cookieStr,
      'Referer': 'https://id.daikin.eu/',
    },
  });

  // Debug output
  console.log('   Debug - Status:', response.statusCode);
  if (response.headers.location) {
    console.log('   Debug - Location:', response.headers.location.substring(0, 150) + '...');
  } else {
    console.log('   Debug - Body:', response.body.substring(0, 300));
  }

  if (response.statusCode === 302) {
    const location = response.headers.location;

    // Extract code from redirect
    const codeMatch = location.match(/code=([^&]+)/);
    if (codeMatch) {
      console.log('   ✓ Authorization code obtained');
      return codeMatch[1];
    }

    // Check for error
    const errorMatch = location.match(/error=([^&]+)/);
    if (errorMatch) {
      const errorDesc = location.match(/error_description=([^&]+)/);
      throw new Error(`Authorization error: ${decodeURIComponent(errorDesc ? errorDesc[1] : errorMatch[1])}`);
    }
  }

  throw new Error('Failed to get authorization code');
}

// Step 4: Exchange authorization code for tokens at IDP endpoint
async function exchangeCodeForTokens(code, pkce) {
  console.log('\n[4/4] Exchanging authorization code for tokens at IDP...');

  // Build Basic Auth header with client_id:client_secret
  const basicAuth = Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: CONFIG.redirectUri,
    code_verifier: pkce.verifier,
  });

  const response = await httpsRequest(
    CONFIG.idpTokenEndpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
        'Content-Length': Buffer.byteLength(params.toString()),
      },
    },
    params.toString(),
  );

  console.log('   Debug - Status:', response.statusCode);

  const result = JSON.parse(response.body);

  if (result.error) {
    console.log('   Debug - Error response:', JSON.stringify(result, null, 2));
    throw new Error(`Token exchange failed: ${result.error_description || result.error}`);
  }

  console.log('   ✓ Tokens obtained from IDP');
  return result;
}

// Test API access
async function testApiAccess(accessToken) {
  console.log('\n[Test] Testing API access...');

  const response = await httpsRequest(
    'https://api.onecta.daikineurope.com/v1/gateway-devices',
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    },
  );

  if (response.statusCode === 200) {
    const devices = JSON.parse(response.body);
    console.log('   ✓ API access successful! Found', devices.length, 'device(s)');

    // Show rate limit
    const limitDay = response.headers['x-ratelimit-limit-day'];
    const remainingDay = response.headers['x-ratelimit-remaining-day'];
    console.log('   Rate limit:', remainingDay + '/' + limitDay, 'requests/day');

    return devices;
  } else {
    console.log('   ✗ API access failed:', response.statusCode);
    return null;
  }
}

// Test WebSocket access
async function testWebSocket(accessToken) {
  console.log('\n[Test] Testing WebSocket access...');

  // We just check if the token has WebSocket in audience
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());

  if (payload.aud && payload.aud.includes('wss://wsapi.onecta.daikineurope.com')) {
    console.log('   ✓ WebSocket access: ENABLED');
    return true;
  } else {
    console.log('   ✗ WebSocket access: NOT in token audience');
    return false;
  }
}

// Main flow
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Daikin Mobile App Authentication (Gigya + PKCE)        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('This uses the official Daikin Onecta mobile app OAuth flow.');
  console.log('Benefits: WebSocket access, 5000 API calls/day (vs 200 for Developer Portal)\n');

  // Get credentials from env vars or prompt
  let email = process.env.DAIKIN_EMAIL;
  let password = process.env.DAIKIN_PASSWORD;
  let rl;

  if (!email || !password) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (q) => new Promise(resolve => rl.question(q, resolve));

    if (!email) {
      email = await question('Daikin account email: ');
    }
    if (!password) {
      password = await question('Daikin account password: ');
    }
    rl.close();
  } else {
    console.log('Using credentials from environment variables\n');
  }

  try {

    // Generate PKCE
    const pkce = generatePKCE();
    console.log('\nPKCE generated');

    // Execute the authentication flow
    const context = await getOidcContext(pkce);
    const cookies = await initGigyaSdk(context);
    const loginToken = await gigyaLogin(email, password, cookies);
    const code = await authorizeWithToken(context, loginToken, cookies);
    const tokens = await exchangeCodeForTokens(code, pkce);

    // Success!
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    AUTHENTICATION SUCCESS                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('Token type:', tokens.token_type);
    console.log('Expires in:', tokens.expires_in, 'seconds');
    console.log('Access token:', tokens.access_token.substring(0, 50) + '...');

    if (tokens.refresh_token) {
      console.log('Refresh token:', tokens.refresh_token.substring(0, 30) + '...');
    }

    // Decode and show scope
    const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64').toString());
    console.log('\nToken scope:', payload.scope);

    // Test API and WebSocket
    await testApiAccess(tokens.access_token);
    await testWebSocket(tokens.access_token);

    // Save tokens
    const fs = require('fs');
    const tokenData = {
      ...tokens,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
    };
    fs.writeFileSync('mobile-tokens.json', JSON.stringify(tokenData, null, 2));
    console.log('\n✓ Tokens saved to mobile-tokens.json');

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    rl.close();
    process.exit(1);
  }
}

main();
