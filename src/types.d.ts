import type { Logger } from 'pino';
declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string; mfa: boolean };
      id: string;
      log: Logger;
    }
  }
}
export {};
