import { describe, it, expect } from 'vitest';
import { parseCurlResponse, configureHttpTransport, getHttpTransportMode } from '../../../src/api/http-transport';

describe('configureHttpTransport', () => {
  it('defaults to node and accepts curl', () => {
    configureHttpTransport(undefined);
    expect(getHttpTransportMode()).toBe('node');
    configureHttpTransport('curl');
    expect(getHttpTransportMode()).toBe('curl');
    configureHttpTransport('node');
    expect(getHttpTransportMode()).toBe('node');
  });
});

describe('parseCurlResponse', () => {
  it('parses a simple HTTP/1.1 response', () => {
    const raw = 'HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\n\r\n{"error":"invalid_client"}';
    const res = parseCurlResponse(raw);
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body).toBe('{"error":"invalid_client"}');
  });

  it('parses an HTTP/2 status line', () => {
    const raw = 'HTTP/2 200\r\ncontent-type: text/plain\r\n\r\nok';
    const res = parseCurlResponse(raw);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('collects repeated set-cookie headers into an array (Gigya flow depends on it)', () => {
    const raw = 'HTTP/1.1 200 OK\r\nset-cookie: gig_canary=a; Path=/\r\nset-cookie: gig_b=c; Path=/\r\n\r\n{}';
    const res = parseCurlResponse(raw);
    expect(res.headers['set-cookie']).toEqual(['gig_canary=a; Path=/', 'gig_b=c; Path=/']);
  });

  it('skips interim 1xx header blocks', () => {
    const raw = 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 201 Created\r\nlocation: /x\r\n\r\ndone';
    const res = parseCurlResponse(raw);
    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe('/x');
    expect(res.body).toBe('done');
  });

  it('exposes redirect responses instead of following them (mobile OAuth handles 302s itself)', () => {
    const raw = 'HTTP/1.1 302 Found\r\nlocation: daikinunified://cdc/?code=abc\r\n\r\n';
    const res = parseCurlResponse(raw);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('daikinunified://cdc/?code=abc');
  });

  it('throws on output with no HTTP status line', () => {
    expect(() => parseCurlResponse('garbage')).toThrow('no HTTP status line');
  });
});
