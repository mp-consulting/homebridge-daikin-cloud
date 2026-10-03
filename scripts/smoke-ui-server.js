/**
 * Smoke test for the custom UI server: fork homebridge-ui/server.js the way
 * homebridge-config-ui-x does (IPC child process), wait for it to report ready,
 * then make one request. Run after `npm run build`; exits non-zero on failure.
 */
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 15000;
const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'daikin-ui-smoke-'));
const configPath = path.join(storagePath, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({ platforms: [{ platform: 'DaikinCloud' }] }));

const child = fork(path.join(__dirname, '..', 'homebridge-ui', 'server.js'), [], {
  env: { ...process.env, HOMEBRIDGE_STORAGE_PATH: storagePath, HOMEBRIDGE_CONFIG_PATH: configPath },
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
});

let timer;

function finish(code, message) {
  clearTimeout(timer);
  console[code === 0 ? 'log' : 'error'](message);
  child.kill();
  fs.rmSync(storagePath, { recursive: true, force: true });
  process.exit(code);
}

timer = setTimeout(() => finish(1, `UI server did not respond within ${TIMEOUT_MS}ms`), TIMEOUT_MS);

child.on('exit', (code) => finish(1, `UI server exited early with code ${code}`));
child.on('message', (message) => {
  if (message.action === 'ready') {
    child.send({ action: 'request', requestId: 1, path: '/auth/status', body: {} });
  } else if (message.action === 'response' && message.payload.requestId === 1) {
    if (!message.payload.success) {
      finish(1, `/auth/status failed: ${JSON.stringify(message.payload.data)}`);
    }
    finish(0, `UI server started and answered /auth/status on Node ${process.version}`);
  }
});
