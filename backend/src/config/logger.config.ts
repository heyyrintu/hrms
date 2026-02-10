import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

export const loggerConfig = (logLevel?: string): WinstonModuleOptions => ({
  transports: [
    new winston.transports.Console({
      level: logLevel || 'debug',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
          const ctx = context ? `[${context}]` : '';
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level} ${ctx} ${message}${metaStr}`;
        }),
      ),
    }),
  ],
});
