import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Audit } from './db.js';
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, code, message);
}
export const token = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encrypt(value: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function decrypt(value: string, key: string) {
  const b = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8');
}
export const uuid = z.uuid();
export const text = (max: number) => z.string().trim().min(1).max(max);
export const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((v) => v.toLowerCase());
export const password = z.string().min(12).max(128);
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.iso.datetime().optional(),
});
export function body<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.body);
}
export const param = (req: Request, key: string) => uuid.parse(req.params[key]);
export async function audit(
  req: Request,
  action: string,
  resourceId?: string,
  workspaceId?: string,
) {
  await Audit.create({
    actorId: req.auth?.userId,
    workspaceId,
    action,
    resourceId,
    requestId: String(req.id),
  });
}
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    _next(err);
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      requestId: req.id,
    });
    return;
  }
  const dependencyUnavailable =
    err instanceof Error &&
    [
      'MongoServerSelectionError',
      'MongooseServerSelectionError',
      'MongoNetworkError',
      'MongoNetworkTimeoutError',
      'MaxRetriesPerRequestError',
    ].includes(err.name);
  const duplicate = typeof err === 'object' && err !== null && 'code' in err && err.code === 11000;
  const malformed =
    typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed';
  const tooLarge =
    typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large';
  const status =
    err instanceof HttpError
      ? err.status
      : duplicate
        ? 409
        : malformed
          ? 400
          : tooLarge
            ? 413
            : dependencyUnavailable
              ? 503
              : 500;
  if (dependencyUnavailable) res.setHeader('Retry-After', '5');
  if (status >= 500)
    req.log?.error(
      {
        code: dependencyUnavailable
          ? 'DEPENDENCY_UNAVAILABLE'
          : err instanceof HttpError
            ? err.code
            : 'INTERNAL_ERROR',
        requestId: req.id,
      },
      'Request failed',
    );
  res.status(status).json({
    error: {
      code:
        err instanceof HttpError
          ? err.code
          : duplicate
            ? 'CONFLICT'
            : malformed
              ? 'INVALID_JSON'
              : tooLarge
                ? 'PAYLOAD_TOO_LARGE'
                : dependencyUnavailable
                  ? 'DEPENDENCY_UNAVAILABLE'
                  : 'INTERNAL_ERROR',
      message:
        err instanceof HttpError
          ? err.message
          : duplicate
            ? 'Resource already exists'
            : malformed
              ? 'Malformed JSON'
              : tooLarge
                ? 'Request body exceeds the limit'
                : dependencyUnavailable
                  ? 'A required service is temporarily unavailable. Please try again shortly.'
                  : 'Request could not be completed',
    },
    requestId: req.id,
  });
}
