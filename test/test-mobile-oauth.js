/**
 * Mobile App OAuth Flow Test
 *
 * Tests if we can authenticate using the mobile app's OAuth flow.
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Mobile app OAuth config (extracted from JWT)
const GIGYA_API_KEY = '3_xRB3jaQ62bVjqXU1omaEsPDVYC0Twi1zfq1zHPu_5HFT0zWkDvZJS97Yw1loJnTm';
const MOBILE_CLIENT_ID = 'FjS6T5oZHvzpZENIDybFRdtK';
const BASE_URL = `https://cdc.daikin.eu/oidc/op/v1.0/${GIGYA_API_KEY}`;

// Scopes needed for WebSocket access
const SCOPES = 'openid onecta:onecta.application offline_access';

// Generate PKCE challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Generate state
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

console.log('=== Daikin Mobile App OAuth Flow Test ===\n');
console.log('Gigya API Key:', GIGYA_API_KEY.substring(0, 20) + '...');
console.log('Mobile Client ID:', MOBILE_CLIENT_ID);
console.log('Requested Scopes:', SCOPES);
console.log('');

// Generate PKCE values
const pkce = generatePKCE();
const state = generateState();

console.log('PKCE Verifier:', pkce.verifier.substring(0, 20) + '...');
console.log('PKCE Challenge:', pkce.challenge.substring(0, 20) + '...');
console.log('State:', state);
console.log('');

// We need a redirect URI - let's try a few options
const redirectUris = [
  'daikin://auth',  // Mobile app custom scheme
  'https://my.daikin.eu/oauth/callback',  // Possible web callback
  'http://localhost:8888/callback',  // Local callback for testing
];

// Build authorization URL
const authUrl = new URL(`${BASE_URL}/authorize`);
authUrl.searchParams.set('client_id', MOBILE_CLIENT_ID);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('redirect_uri', redirectUris[2]); // localhost for testing
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('code_challenge', pkce.challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

console.log('Authorization URL:');
console.log(authUrl.toString());
console.log('');

// Start local callback server
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, 'http://localhost:8888');

  if (reqUrl.pathname === '/callback') {
    const code = reqUrl.searchParams.get('code');
    const returnedState = reqUrl.searchParams.get('state');
    const error = reqUrl.searchParams.get('error');

    console.log('\n--- Callback received ---');

    if (error) {
      console.log('Error:', error);
      console.log('Description:', reqUrl.searchParams.get('error_description'));
      res.writeHead(200);
      res.end('Error: ' + error);
      server.close();
      return;
    }

    if (returnedState !== state) {
      console.log('State mismatch!');
      res.writeHead(400);
      res.end('State mismatch');
      server.close();
      return;
    }

    console.log('Authorization code received:', code.substring(0, 20) + '...');
    console.log('');

    // Exchange code for tokens
    console.log('Exchanging code for tokens...');

    const tokenUrl = `${BASE_URL}/token`;
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: MOBILE_CLIENT_ID,
      code: code,
      redirect_uri: redirectUris[2],
      code_verifier: pkce.verifier,
    });

    const tokenReq = https.request(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(tokenParams.toString()),
      },
    }, (tokenRes) => {
      let data = '';
      tokenRes.on('data', chunk => data += chunk);
      tokenRes.on('end', () => {
        console.log('Token response status:', tokenRes.statusCode);
        console.log('Token response:');
        try {
          const tokens = JSON.parse(data);
          console.log(JSON.stringify(tokens, null, 2));

          if (tokens.access_token) {
            console.log('\n✅ SUCCESS! Got access token');
            console.log('Token expires in:', tokens.expires_in, 'seconds');

            // Decode token to verify scope
            const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64').toString());
            console.log('Token scope:', payload.scope);
            console.log('WebSocket access:', payload.aud?.includes('wss://wsapi.onecta.daikineurope.com') ? 'YES' : 'NO');
          }
        } catch (e) {
          console.log('Raw response:', data);
        }

        res.writeHead(200);
        res.end('Authentication complete! Check terminal for results.');
        server.close();
      });
    });

    tokenReq.on('error', (e) => {
      console.log('Token request error:', e.message);
      res.writeHead(500);
      res.end('Token request failed');
      server.close();
    });

    tokenReq.write(tokenParams.toString());
    tokenReq.end();
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8888, () => {
  console.log('Callback server listening on http://localhost:8888');
  console.log('');
  console.log('Open this URL in your browser to authenticate:');
  console.log(authUrl.toString());
  console.log('');
  console.log('Waiting for callback... (Ctrl+C to cancel)');
});

// Timeout after 5 minutes
setTimeout(() => {
  console.log('\nTimeout - no callback received');
  server.close();
  process.exit(1);
}, 300000);
