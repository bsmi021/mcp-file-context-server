import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Default options for pino-pretty
const prettyPrintOptions = {
  colorize: true,
  translateTime: 'SYS:standard',
  ignore: 'pid,hostname',
};

// Conditional transport configuration
const transport = isProduction
  ? undefined // Default JSON output for production
  : {
      target: 'pino-pretty',
      options: prettyPrintOptions,
    };

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: transport,
});

export default logger;
