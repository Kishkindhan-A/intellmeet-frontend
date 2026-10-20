import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../src/lib.js';

function context(headersSent = false) {
  const logger = vi.fn();
  const req = { id: 'audit-request', log: { error: logger } } as unknown as Request;
  const response = { headersSent, status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  response.status.mockReturnValue(response);
  const next = vi.fn();
  return {
    req,
    response,
    res: response as unknown as Response,
    next: next as NextFunction,
    nextMock: next,
    logger,
  };
}

describe('exception response handling', () => {
  it('delegates late failures instead of writing a second response', () => {
    const c = context(true);
    const failure = new Error('stream already started');
    errorHandler(failure, c.req, c.res, c.next);
    expect(c.nextMock).toHaveBeenCalledWith(failure);
    expect(c.response.status).not.toHaveBeenCalled();
    expect(c.response.json).not.toHaveBeenCalled();
  });
  it.each([
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MaxRetriesPerRequestError',
  ])('maps %s to a safe retryable service error', (name) => {
    const c = context();
    errorHandler(
      Object.assign(new Error('private connection URI and credentials'), { name }),
      c.req,
      c.res,
      c.next,
    );
    expect(c.response.status).toHaveBeenCalledWith(503);
    expect(c.response.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(c.response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'A required service is temporarily unavailable. Please try again shortly.',
        },
        requestId: 'audit-request',
      }),
    );
    expect(JSON.stringify(c.logger.mock.calls)).not.toContain('private');
  });
  it('does not expose unexpected exception details in the response or logs', () => {
    const c = context();
    errorHandler(new Error('private provider token'), c.req, c.res, c.next);
    expect(c.response.status).toHaveBeenCalledWith(500);
    expect(c.response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'INTERNAL_ERROR', message: 'Request could not be completed' },
      }),
    );
    expect(JSON.stringify(c.logger.mock.calls)).not.toContain('private provider token');
    expect(JSON.stringify(c.response.json.mock.calls)).not.toContain('private provider token');
  });
});
