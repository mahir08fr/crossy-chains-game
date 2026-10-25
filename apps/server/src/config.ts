export type ServerConfig = {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
};

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const deployed = env.RENDER === 'true';
  if (deployed && (env.HOST !== '0.0.0.0' || !env.PORT || !env.ALLOWED_ORIGINS)) {
    throw new Error('Render requires HOST=0.0.0.0, PORT and explicit ALLOWED_ORIGINS');
  }
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(host)) throw new Error('HOST must be 127.0.0.1, localhost or 0.0.0.0');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173')
    .split(',').map((value) => value.trim());
  if (!allowedOrigins.length || allowedOrigins.some((value) => {
    try {
      const url = new URL(value);
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== value
        || (deployed && (url.protocol !== 'https:' || url.hostname === 'localhost'
          || url.hostname.endsWith('.localhost') || url.hostname.startsWith('127.')
          || ['0.0.0.0', '[::1]'].includes(url.hostname)));
    }
    catch { return true; }
  })) throw new Error('ALLOWED_ORIGINS must contain explicit HTTP(S) origins without paths or wildcards (non-loopback HTTPS on Render)');
  return { host, port, allowedOrigins };
}
