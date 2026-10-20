import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { Registry, Counter, Histogram, collectDefaultMetrics } from '@prometheus-io/client';
import { mongoose } from './db.js';
import { assert, errorHandler, HttpError, safeEqual } from './lib.js';
import { authRoutes } from './auth.js';
import { workspaceRoutes } from './workspaces.js';
import { meetingRoutes } from './meetings.js';
import { assetRoutes } from './assets.js';
import { collaborationRoutes } from './collaboration.js';
import { webhookRoutes } from './webhooks.js';
import { openapi } from './openapi.js';
import { accountRoutes, publicLaunchRoutes } from './lifecycle.js';
import type { Runtime } from './ports.js';

export function createApp(rt: Runtime) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', rt.config.TRUST_PROXY_HOPS);
  const metrics = new Registry();
  if (rt.config.NODE_ENV !== 'test') collectDefaultMetrics({ register: metrics });
  const count = new Counter({
    name: 'intellmeet_http_requests_total',
    help: 'HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [metrics],
  });
  const latency = new Histogram({
    name: 'intellmeet_http_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'],
    registers: [metrics],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 3, 10],
  });
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-ID', req.id);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
  });
  app.use(
    pinoHttp({
      logger: rt.logger,
      genReqId: (req) => req.id,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
      contentSecurityPolicy: { directives: { frameAncestors: ["'none'"] } },
    }),
  );
  const origins = rt.config.CORS_ORIGINS.split(',').map((v) => v.trim());
  app.use(
    cors({
      credentials: true,
      origin: (origin, callback) =>
        callback(
          origin && !origins.includes(origin)
            ? new HttpError(403, 'ORIGIN_DENIED', 'Origin is not allowed')
            : null,
          true,
        ),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
      exposedHeaders: ['X-Request-ID', 'Retry-After'],
    }),
  );
  app.use((req, res, next) => {
    const stop = latency.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ?? 'unmatched';
      count.inc({ method: req.method, route, status: res.statusCode });
      stop({ method: req.method, route });
    });
    next();
  });
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.use(publicLaunchRoutes(rt));
  app.get('/health/ready', async (_req, res) => {
    if (rt.config.MAINTENANCE_MODE) {
      res.setHeader('Retry-After', String(rt.config.MAINTENANCE_RETRY_SECONDS));
      res.status(503).json({ status: 'maintenance' });
      return;
    }
    const mongo = mongoose.connection.readyState === 1;
    let redis = false;
    try {
      redis = await rt.coordinator.healthy();
    } catch {
      /* unavailable */
    }
    res
      .status(mongo && redis ? 200 : 503)
      .json({ status: mongo && redis ? 'ready' : 'unavailable' });
  });
  app.get('/metrics', async (req, res) => {
    const access = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    assert(
      rt.config.METRICS_TOKEN && safeEqual(access, rt.config.METRICS_TOKEN),
      401,
      'UNAUTHENTICATED',
      'Metrics credentials required',
    );
    res.type(metrics.contentType).send(await metrics.metrics());
  });
  app.get('/openapi.json', (_req, res) => res.json(openapi(rt.config.API_URL)));
  app.use('/webhooks', webhookRoutes(rt));
  app.use('/api', (_req, res, next) => {
    if (rt.config.MAINTENANCE_MODE) {
      res.setHeader('Retry-After', String(rt.config.MAINTENANCE_RETRY_SECONDS));
      return next(new HttpError(503, 'MAINTENANCE', 'Service is temporarily under maintenance'));
    }
    next();
  });
  app.use('/api', (req, _res, next) => {
    // Fetch metadata supplements CSRF tokens; approved separate frontend origins remain supported.
    if (req.get('Sec-Fetch-Site') === 'cross-site' && !origins.includes(req.get('Origin') || ''))
      return next(new HttpError(403, 'CROSS_SITE_DENIED', 'Cross-site API request denied'));
    const hasBody =
      Number(req.get('Content-Length') || 0) > 0 || Boolean(req.get('Transfer-Encoding'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && hasBody && !req.is('application/json'))
      return next(
        new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json for API requests'),
      );
    next();
  });
  // Apply the shared quota before parsing attacker-controlled JSON.
  app.use('/api', async (req, res, next) => {
    try {
      const allowed = await rt.coordinator.consume(`http:${req.ip}`, 600, 60);
      if (!allowed) res.setHeader('Retry-After', '60');
      assert(allowed, 429, 'RATE_LIMITED', 'Request limit exceeded');
      next();
    } catch (err) {
      next(err);
    }
  });
  app.use(express.json({ limit: '150kb', strict: true }));
  app.use(cookieParser());
  app.use('/api/auth', authRoutes(rt));
  app.use('/api/account', accountRoutes(rt));
  app.use('/api', workspaceRoutes(rt), meetingRoutes(rt), assetRoutes(rt), collaborationRoutes(rt));
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
