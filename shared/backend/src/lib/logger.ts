/** Structured logging: one JSON object per line, so logs can be searched and filtered. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
// Tests simulate failures on purpose; keep their output readable.
let minLevel: LogLevel | 'silent' = process.env.VITEST ? 'silent' : 'info';

export function setLogLevel(level: LogLevel) {
  minLevel = level;
}

function write(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  if (order[level] < order[minLevel]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
