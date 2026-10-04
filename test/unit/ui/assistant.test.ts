/**
 * Tests for the Assistant routes of the custom UI (homebridge-ui/assistant.js).
 *
 * assistant.js is CommonJS and loads @mp-consulting/homebridge-ai-core (ESM-only)
 * with import(); registerAssistant resolves once the routes are registered.
 * No network: the provider is a fake.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { ASSISTANT_PLUGIN_NAME, DAIKIN_AI_CONTEXT, registerAssistant } = require('../../../homebridge-ui/assistant.js');

interface ChatRequest {
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
}

const usage = { inputTokens: 10, outputTokens: 5 };

/** Provider stand-in: no network, replies with `reply` (streamed in two chunks). */
function fakeProvider(reply: string) {
  const requests: ChatRequest[] = [];
  const result = (text: string) => ({
    text,
    toolCalls: [],
    usage,
    stopReason: 'end',
    model: 'fake-model',
    message: { role: 'assistant', content: text },
  });
  const provider = {
    name: 'anthropic',
    model: 'fake-model',
    capabilities: { tools: false, streaming: true, contextTokens: 100_000, jsonMode: false },
    async chat(request: ChatRequest) {
      requests.push(request);
      return result(reply);
    },
    async *stream(request: ChatRequest) {
      requests.push(request);
      const half = Math.ceil(reply.length / 2);
      yield { type: 'text', delta: reply.slice(0, half) };
      yield { type: 'text', delta: reply.slice(half) };
      yield { type: 'done', usage, stopReason: 'end', result: result(reply) };
    },
  };
  return { provider, requests };
}

function fakeServer(homebridgeConfigPath?: string) {
  const handlers = new Map<string, (body: unknown) => unknown>();
  const events: Array<[string, unknown]> = [];
  const server = {
    homebridgeConfigPath,
    onRequest: (path: string, fn: (body: unknown) => unknown) => handlers.set(path, fn),
    pushEvent: (event: string, data: unknown) => events.push([event, data]),
  };
  const call = (path: string, body: unknown = {}) => Promise.resolve(handlers.get(path)!(body));
  return { server, handlers, events, call };
}

async function writeConfig(platforms: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'daikin-assistant-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ bridge: { name: 'Homebridge' }, platforms }));
  return path;
}

describe('homebridge-ui Assistant routes', () => {
  it('registers the four Assistant routes', async () => {
    const ui = fakeServer();
    await registerAssistant(ui.server, { loadConfig: async () => null });
    expect([...ui.handlers.keys()].sort()).toEqual(['/ai/ask', '/ai/config', '/ai/explain', '/ai/status']);
  });

  it('reports the Assistant as off when the AI Kit block is missing', async () => {
    const ui = fakeServer(await writeConfig([{ platform: 'DaikinCloud', daikinEmail: 'u@example.com', daikinPassword: 'p' }]));
    await registerAssistant(ui.server);
    expect(await ui.call('/ai/status')).toEqual({ enabled: false, provider: null, model: null, capabilities: null });
    await expect(ui.call('/ai/explain', { error: 'x' })).rejects.toThrow('The Assistant is not set up');
  });

  it('reads the shared HomebridgeAiKit block and never returns its key', async () => {
    const ui = fakeServer(await writeConfig([
      { platform: 'DaikinCloud' },
      { platform: 'HomebridgeAiKit', provider: 'anthropic', apiKey: 'sk-ant-secret-key' },
    ]));
    await registerAssistant(ui.server);
    const status = await ui.call('/ai/status');
    expect(status).toMatchObject({ enabled: true, provider: 'anthropic' });
    expect(JSON.stringify(status)).not.toContain('sk-ant-secret-key');
  });

  it('explains a device error with the Daikin context and streams it', async () => {
    const { provider, requests } = fakeProvider('Check the Wi-Fi.');
    const ui = fakeServer();
    await registerAssistant(ui.server, {
      loadConfig: async () => ({ enabled: true, provider: 'anthropic', model: 'fake-model' }),
      createProvider: () => provider,
    });

    const result = await ui.call('/ai/explain', {
      error: 'The Daikin Onecta cloud reports this unit as offline.',
      context: 'Authentication method: mobile_app.',
      device: { name: 'Living room', id: 'b7c2a1e0-unit', model: 'BRP069C4x', type: 'Climate Control', online: false },
      requestId: 'r1',
    });

    expect(result).toEqual({ text: 'Check the Wi-Fi.', usage });
    expect(ui.events).toEqual([
      ['ai:chunk', { requestId: 'r1', delta: 'Check th' }],
      ['ai:chunk', { requestId: 'r1', delta: 'e Wi-Fi.' }],
      ['ai:done', { requestId: 'r1' }],
    ]);
    expect(requests[0].system).toContain(ASSISTANT_PLUGIN_NAME);
    expect(requests[0].system).toContain(DAIKIN_AI_CONTEXT);
    expect(JSON.stringify(requests[0].messages)).toContain('b7c2a1e0-unit');
  });

  it('describes the auth modes, callback server, quotas and common errors in its context', () => {
    expect(ASSISTANT_PLUGIN_NAME).toBe('@mp-consulting/homebridge-daikin-cloud');
    for (const fact of ['"developer_portal"', '"mobile_app"', '200', '3000', '8582', 'invalid_grant', '429', '504', 'offline', '"curl"']) {
      expect(DAIKIN_AI_CONTEXT).toContain(fact);
    }
  });
});
