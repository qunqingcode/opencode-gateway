import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

// 确保日志目录存在
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let output = `[${timestamp}] ${level}: ${message}`;
    if (stack) {
      output += `\n${stack}`;
    }
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    if (metaStr !== '{}' && metaStr !== '') {
      output += ` ${metaStr}`;
    }
    return output;
  })
);

export const logger = winston.createLogger({
  level: process.env.DEBUG ? 'debug' : 'info',
  format: logFormat,
  defaultMeta: { service: 'opencode-gateway' },
  transports: [
    // 每天轮转的普通日志
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
    }),
    // 每天轮转的错误日志
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    }),
  ],
});

// 在开发环境下，同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// 导出一个兼容旧有接口的对象，或者直接使用 logger
export const appLogger = {
  info: (msg: string, ...args: unknown[]) => logger.info(msg, ...args),
  error: (msg: string, ...args: unknown[]) => logger.error(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => logger.warn(msg, ...args),
  debug: (msg: string, ...args: unknown[]) => logger.debug(msg, ...args),
};
