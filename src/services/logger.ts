import pino from "pino";

const pinoLogger = pino(
  {
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    level: "debug",
  },
  pino.transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "yyyy-mm-dd HH:MM:ss.l",
    },
  }),
);

export class Logger {
  public static info(message: string, obj?: any): void {
    obj ? pinoLogger.info(obj, message) : pinoLogger.info(message);
  }
  public static warn(message: string, obj?: any): void {
    obj ? pinoLogger.warn(obj, message) : pinoLogger.warn(message);
  }
  public static debug(message: string, obj?: any): void {
    obj ? pinoLogger.debug(obj, message) : pinoLogger.debug(message);
  }
  public static error(message: string, obj?: any): void {
    obj ? pinoLogger.error(obj, message) : pinoLogger.error(message);
  }
}

export const initLog = (): string => {
  const currentDate = new Date();
  return `
====================================================
API Accounts now online
----------------------------------------------------
Boot time:                ${process.uptime()}s
Current Time:             ${currentDate.toLocaleString()}
Current Time (ISO):       ${currentDate.toISOString()}
Current Time (epoch, ms): ${currentDate.getTime()}
====================================================
`;
};
