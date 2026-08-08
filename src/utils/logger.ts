import fs from 'fs';
import path from 'path';
import { getAppDataDir } from '../config/index.js';

class AsyncLogger {
  private logBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private logFilePath: string;

  constructor() {
    const logsDir = path.join(getAppDataDir(), 'logs');
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
    } catch (_) {}
    this.logFilePath = path.join(logsDir, 'app.log');
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 200);
  }

  private flush() {
    if (this.logBuffer.length === 0) return;
    const lines = this.logBuffer.join('\n') + '\n';
    this.logBuffer = [];
    fs.appendFile(this.logFilePath, lines, (err) => {
      if (err) {
        process.stderr.write(`[Logger Error] ${err.message}\n`);
      }
    });
  }

  public info(msg: string, ...meta: any[]) {
    const time = new Date().toISOString();
    const formatted = `[INFO] [${time}] ${msg} ${meta.length ? JSON.stringify(meta) : ''}`.trim();
    process.stdout.write(formatted + '\n');
    this.logBuffer.push(formatted);
    this.scheduleFlush();
  }

  public warn(msg: string, ...meta: any[]) {
    const time = new Date().toISOString();
    const formatted = `[WARN] [${time}] ${msg} ${meta.length ? JSON.stringify(meta) : ''}`.trim();
    process.stderr.write(formatted + '\n');
    this.logBuffer.push(formatted);
    this.scheduleFlush();
  }

  public error(msg: string, ...meta: any[]) {
    const time = new Date().toISOString();
    const formatted = `[ERROR] [${time}] ${msg} ${meta.length ? JSON.stringify(meta) : ''}`.trim();
    process.stderr.write(formatted + '\n');
    this.logBuffer.push(formatted);
    this.scheduleFlush();
  }
}

export const logger = new AsyncLogger();
export default logger;
