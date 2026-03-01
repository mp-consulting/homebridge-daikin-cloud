/**
 * WebSocket Test Script
 *
 * Tests the DaikinWebSocket implementation with a real token.
 */

const WebSocket = require('ws');

// Read token from file
const fs = require('fs');
const tokenData = JSON.parse(
  fs.readFileSync('./hbConfig/.daikin-controller-cloud-tokenset', 'utf8'),
);

const WEBSOCKET_URL = 'wss://wsapi.onecta.daikineurope.com';

console.log('=== Daikin WebSocket Test ===\n');
console.log('Token expires at:', new Date(tokenData.expires_at * 1000).toISOString());
console.log('Current time:', new Date().toISOString());

const now = Math.floor(Date.now() / 1000);
if (tokenData.expires_at < now) {
  console.log('\n⚠️  WARNING: Token is EXPIRED! You may need to refresh it.\n');
}

console.log('\nConnecting to:', WEBSOCKET_URL);
console.log('---\n');

const ws = new WebSocket(WEBSOCKET_URL, {
  headers: {
    'Authorization': 'Bearer ' + tokenData.access_token,
  },
});

let messageCount = 0;
const deviceUpdates = new Map();

ws.on('open', () => {
  console.log('✅ CONNECTED!\n');
  console.log('Listening for device updates... (press Ctrl+C to stop)\n');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());

    // Skip internal server errors (from invalid message formats)
    if (message.message === 'Internal server error') {
      return;
    }

    messageCount++;

    if (message.event === 'gateway:managementpoint:characteristic') {
      const deviceId = message.gatewayDeviceId;
      const characteristic = message.data.name;
      const value = message.data.value;

      // Track unique devices
      if (!deviceUpdates.has(deviceId)) {
        deviceUpdates.set(deviceId, new Set());
        console.log('📱 New device discovered:', deviceId.substring(0, 8) + '...');
      }
      deviceUpdates.get(deviceId).add(characteristic);

      // Log the update
      const timestamp = new Date().toLocaleTimeString();
      console.log('[' + timestamp + '] Device: ' + deviceId.substring(0, 8) + '... | ' + characteristic + ':', JSON.stringify(value).substring(0, 80));
    } else if (message.event === 'group:characteristic') {
      const groupId = message.groupId;
      const characteristic = message.data.name;
      const value = message.data.value;

      const timestamp = new Date().toLocaleTimeString();
      console.log('[' + timestamp + '] Group: ' + groupId.substring(0, 8) + '... | ' + characteristic + ':', JSON.stringify(value).substring(0, 80));
    } else {
      console.log('Unknown event type:', message.event || 'N/A');
    }

  } catch (e) {
    // Ignore parse errors
  }
});

ws.on('error', (err) => {
  console.log('❌ ERROR:', err.message);
});

ws.on('close', (code, reason) => {
  console.log('\n--- Connection closed ---');
  console.log('Code:', code);
  console.log('Reason:', reason.toString() || 'none');
  console.log('\nTotal messages received:', messageCount);
  console.log('Unique devices:', deviceUpdates.size);

  if (deviceUpdates.size > 0) {
    console.log('\nDevice characteristics received:');
    deviceUpdates.forEach((chars, deviceId) => {
      console.log('  ' + deviceId.substring(0, 8) + '...:', Array.from(chars).join(', '));
    });
  }

  process.exit(0);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  ws.close();
});

// Keep running for 60 seconds max
setTimeout(() => {
  console.log('\n\n⏱️  Test timeout (60s) - closing connection');
  ws.close();
}, 60000);
