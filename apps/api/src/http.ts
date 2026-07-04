import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApiError } from '@fcm/contracts';

/** Send a uniform error envelope (matches the contracts ApiError shape). */
export function sendError(res: Response, status: number, code: string, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(status).json(body);
}

/** Wrap an async handler so rejected promises reach Express's error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
