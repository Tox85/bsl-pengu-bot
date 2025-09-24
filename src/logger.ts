import pino from 'pino';

export const logger = pino({
  name: 'bsl-pengu-bot',
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true },
      },
});
