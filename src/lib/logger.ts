import type { LoggerOptions } from 'pino';
import type { AppConfig } from '../config/index.js';

export function buildLoggerOptions(
  config: Pick<AppConfig, 'NODE_ENV' | 'LOG_LEVEL'>,
): LoggerOptions {
  const base: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.secret',
        '*.apiKey',
        '*.webhookSecretRef',
      ],
      censor: '[REDACTED]',
    },
  };

  if (config.NODE_ENV !== 'development') {
    return base;
  }

  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  };
}
