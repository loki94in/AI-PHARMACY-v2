import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // If headers already sent, delegate to Express default error handler
  if (res.headersSent) {
    return next(err);
  }

  // Detect transient SQLite busy/locked errors
  const isBusy = err?.code === 'SQLITE_BUSY' || err?.message?.includes('SQLITE_BUSY') || err?.message?.includes('database is locked');
  const status = isBusy ? 503 : (err.status || 500);

  // In development, send more details
  if (process.env.NODE_ENV === 'development') {
    return res.status(status).json({
      error: isBusy ? 'Database busy. Please retry.' : (err.message || 'Internal Server Error'),
      retryable: isBusy,
      stack: err.stack
    });
  }

  // In production, send minimal error info
  res.status(status).json({
    error: isBusy ? 'Database busy. Please retry.' : (err.message || 'Internal Server Error'),
    retryable: isBusy
  });
}