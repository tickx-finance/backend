import { Logger } from '@nestjs/common';

export function createNewLog(
  logger: Logger,
  context: string,
  task: string,
  level: 'log' | 'error' | 'warn' | 'debug',
  message: string,
  error?: any,
) {
  const logMessage = `[${context}] [${task}] ${message}`;
  
  switch (level) {
    case 'error':
      logger.error(logMessage, error?.stack || '');
      break;
    case 'warn':
      logger.warn(logMessage);
      break;
    case 'debug':
      logger.debug(logMessage);
      break;
    default:
      logger.log(logMessage);
  }
}
