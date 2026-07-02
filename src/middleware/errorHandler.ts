import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // If headers already sent, delegate to Express default error handler
  if (res.headersSent) {
    return next(err);
  }

  // Default to 500 if no status code
  const status = err.status || 500;

  // In development, send more details
  if (process.env.NODE_ENV === 'development') {
    return res.status(status).json({
      error: err.message || 'Internal Server Error',
      stack: err.stack
    });
  }

  // In production, send minimal error info
  res.status(status).json({
    error: err.message || 'Internal Server Error'
  });
}