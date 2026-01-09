/**
 * WebSocket Test Script - Mobile App Token
 *
 * Tests WebSocket with the mobile app token from mobile-tokens.json.
 * Run test-gigya-auth.js first to generate the token.
 */

const WebSocket = require('ws');
const fs = require('fs');

// Load token from mobile-tokens.json
let tokens;
try {
    tokens = JSON.parse(fs.readFileSync('mobile-tokens.json', 'utf8'));
} catch (e) {
    console.error('Error: Could not load mobile-tokens.json');
    console.error('Run test-gigya-auth.js first to generate the token.');
    process.exit(1);
}

const MOBILE_TOKEN = tokens.access_token;
const WEBSOCKET_URL = 'wss://wsapi.onecta.daikineurope.com';

console.log('=== Daikin WebSocket Test (Mobile App Token) ===\n');

// Decode token to check expiry
const payload = JSON.parse(Buffer.from(MOBILE_TOKEN.split('.')[1], 'base64').toString());
console.log('Token scope:', payload.scope);
console.log('Token expires at:', new Date(payload.exp * 1000).toISOString());
console.log('Current time:', new Date().toISOString());

const now = Math.floor(Date.now() / 1000);
if (payload.exp < now) {
    console.log('\n⚠️  WARNING: Token is EXPIRED!\n');
    console.log('Run test-gigya-auth.js to get a new token.');
    process.exit(1);
} else {
    console.log('Token valid for:', Math.round((payload.exp - now) / 60), 'minutes\n');
}

console.log('Connecting to:', WEBSOCKET_URL);
console.log('---\n');

const ws = new WebSocket(WEBSOCKET_URL, {
    headers: {
        'Authorization': 'Bearer ' + MOBILE_TOKEN,
    },
});

let messageCount = 0;
const deviceUpdates = new Map();

ws.on('open', function() {
    console.log('✅ CONNECTED!\n');
    console.log('Listening for device updates... (press Ctrl+C to stop)\n');
});

ws.on('message', function(data) {
    try {
        const message = JSON.parse(data.toString());

        if (message.message === 'Internal server error') {
            return;
        }

        messageCount++;

        if (message.event === 'gateway:managementpoint:characteristic') {
            const deviceId = message.gatewayDeviceId;
            const characteristic = message.data.name;
            const value = message.data.value;

            if (!deviceUpdates.has(deviceId)) {
                deviceUpdates.set(deviceId, new Set());
                console.log('📱 New device discovered:', deviceId.substring(0, 8) + '...');
            }
            deviceUpdates.get(deviceId).add(characteristic);

            const timestamp = new Date().toLocaleTimeString();
            console.log('[' + timestamp + '] Device ' + characteristic + ':', JSON.stringify(value).substring(0, 100));
        } else if (message.event === 'group:characteristic') {
            const characteristic = message.data.name;
            const value = message.data.value;

            const timestamp = new Date().toLocaleTimeString();
            console.log('[' + timestamp + '] Group ' + characteristic + ':', JSON.stringify(value).substring(0, 100));
        }

    } catch (e) {
        // Ignore parse errors
    }
});

ws.on('error', function(err) {
    console.log('❌ ERROR:', err.message);
});

ws.on('close', function(code, reason) {
    console.log('\n--- Connection closed ---');
    console.log('Code:', code);
    console.log('Reason:', reason.toString() || 'none');
    console.log('\nTotal messages received:', messageCount);
    console.log('Unique devices:', deviceUpdates.size);

    if (deviceUpdates.size > 0) {
        console.log('\nDevice characteristics received:');
        deviceUpdates.forEach(function(chars, deviceId) {
            console.log('  ' + deviceId.substring(0, 8) + '...:', Array.from(chars).join(', '));
        });
    }

    process.exit(0);
});

process.on('SIGINT', function() {
    console.log('\n\nShutting down...');
    ws.close();
});

setTimeout(function() {
    console.log('\n\n⏱️  Test timeout (30s) - closing connection');
    ws.close();
}, 30000);
