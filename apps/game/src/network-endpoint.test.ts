import { describe, expect, it } from 'vitest';
import { readTransportEndpoint } from './network-endpoint';

describe('deployment transport endpoint', () => {
  it('preserves local defaults while requiring an explicit secure hosted endpoint', () => {
    expect(readTransportEndpoint()).toBe('http://127.0.0.1:2567');
    expect(readTransportEndpoint('http://localhost:2567')).toBe('http://localhost:2567');
    expect(readTransportEndpoint('https://transport.example', true)).toBe('https://transport.example');
    for (const value of [undefined, '', 'http://transport.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]']) {
      expect(() => readTransportEndpoint(value, true)).toThrow();
    }
  });

  it('rejects credentials, paths, query parameters and unsupported endpoint schemes', () => {
    for (const value of ['not a URL', 'wss://transport.example', 'https://user:password@transport.example',
      'https://transport.example/', 'https://transport.example/path', 'https://transport.example?token=secret']) {
      expect(() => readTransportEndpoint(value)).toThrow();
    }
  });
});
