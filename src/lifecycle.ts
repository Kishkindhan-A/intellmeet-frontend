import { Router } from 'express';
import { z } from 'zod';
import { Membership, SupportTicket, User } from './db.js';
import { requireAuth } from './auth.js';
import { admin, membership } from './policy.js';
import { assert, audit, body, param, text, uuid } from './lib.js';
import type { Runtime } from './ports.js';

export function publicLaunchRoutes(rt: Runtime) {
  const router = Router();
  // Crawlers must be allowed to fetch responses to observe X-Robots-Tag.
  // Authorization protects private content; robots.txt is not an access control.
  router.get('/robots.txt', (_req, res) =>
    res.type('text/plain').send('User-agent: *\nAllow: /\n'),
  );
  router.get('/.well-known/security.txt', (_req, res) => {
    const { SECURITY_CONTACT: contact, SECURITY_CONTACT_EXPIRES: expires } = rt.config;
    assert(
      contact && expires && Date.parse(expires) > Date.now(),
      404,
      'NOT_FOUND',
      'Security disclosure contact is not configured',
    );
    const canonical = rt.config.API_URL.startsWith('https://')
      ? `Canonical: ${rt.config.API_URL.replace(/\/$/, '')}/.well-known/security.txt\n`
      : '';
    res
      .type('text/plain')
      .send(`Contact: ${contact}\nExpires: ${expires}\n${canonical}Preferred-Languages: en\n`);
  });
  router.get('/help', (_req, res) =>
    res.json({
      articles: [
        {
          id: 'sign-in',
          title: 'Access your account',
          text: 'Verify your email before signing in. Password reset links are single-use. MFA recovery codes can each be used once.',
        },
        {
          id: 'meetings',
          title: 'Join a meeting',
          text: 'Join a workspace and request meeting admission. A host admits lobby participants. Camera and screen sharing also require browser permission.',
        },
        {
          id: 'privacy',
          title: 'Recording and AI consent',
          text: 'Server recording and AI require consent from everyone admitted. Confidential meetings disable server recording and AI. Withdrawing AI consent removes your stored transcript and the current summary; it cannot recall material already processed or downloaded.',
        },
        {
          id: 'support',
          title: 'Request workspace support',
          text: 'Signed-in members can create a support request for their workspace. Requests are stored for workspace administrators to review; this is not an external support desk or an emergency channel.',
        },
      ],
    }),
  );
  return router;
}

const settingsFields =
  'timezone locale onboardingCompletedAt analyticsConsent marketingConsent preferencesUpdatedAt';
export function accountRoutes(rt: Runtime) {
  const router = Router();
  router.use(requireAuth(rt));
  router.get('/preferences', async (req, res) => {
    const preferences = await User.findById(req.auth!.userId).select(settingsFields + ' -_id');
    assert(preferences, 401, 'SESSION_EXPIRED', 'Session has expired');
    res.json({ preferences, essentialCookies: true });
  });
  router.patch('/preferences', async (req, res) => {
    const input = body(
      z
        .object({
          timezone: text(100)
            .refine((value) => {
              try {
                new Intl.DateTimeFormat('en', { timeZone: value });
                return true;
              } catch {
                return false;
              }
            }, 'Unknown time zone')
            .optional(),
          locale: text(35)
            .refine((value) => {
              try {
                return Intl.DateTimeFormat.supportedLocalesOf([value]).length === 1;
              } catch {
                return false;
              }
            }, 'Unsupported locale')
            .optional(),
          analyticsConsent: z.boolean().optional(),
          marketingConsent: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, 'Provide at least one preference'),
      req,
    );
    const preferences = await User.findByIdAndUpdate(
      req.auth!.userId,
      { $set: { ...input, preferencesUpdatedAt: new Date() } },
      { returnDocument: 'after' },
    ).select(settingsFields + ' -_id');
    await audit(req, 'account.preferences.updated');
    res.json({ preferences, essentialCookies: true });
  });
  router.get('/onboarding', async (req, res) => {
    const user = await User.findById(req.auth!.userId).select(
      'onboardingCompletedAt verified mfaEnabled',
    );
    const workspaces = await Membership.countDocuments({ userId: req.auth!.userId });
    res.json({
      verified: user!.verified,
      mfaEnabled: user!.mfaEnabled,
      workspaceCount: workspaces,
      completedAt: user!.onboardingCompletedAt ?? null,
    });
  });
  router.post('/onboarding/complete', async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    assert(
      await Membership.exists({ userId: req.auth!.userId }),
      409,
      'WORKSPACE_REQUIRED',
      'Create or join a workspace first',
    );
    await User.updateOne(
      { _id: req.auth!.userId, onboardingCompletedAt: null },
      { $set: { onboardingCompletedAt: new Date() } },
    );
    res.status(204).end();
  });
  router.post('/support', async (req, res) => {
    const input = body(
      z.object({ workspaceId: uuid, subject: text(200), message: text(5000) }).strict(),
      req,
    );
    await membership(req.auth!.userId, input.workspaceId);
    assert(
      await rt.coordinator.consume(`support:${req.auth!.userId}`, 5, 3600),
      429,
      'RATE_LIMITED',
      'Support request limit reached',
    );
    const ticket = await SupportTicket.create({ ...input, userId: req.auth!.userId });
    await audit(req, 'support.created', ticket._id, input.workspaceId);
    res.status(201).json({ ticket });
  });
  router.get('/support', async (req, res) => {
    const input = z
      .object({
        workspaceId: uuid,
        scope: z.enum(['mine', 'workspace']).default('mine'),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        before: z.iso.datetime().optional(),
        beforeId: uuid.optional(),
      })
      .strict()
      .refine((value) => !(value.before && value.beforeId), 'Choose one cursor')
      .parse(req.query);
    if (input.scope === 'workspace') await admin(rt, req.auth!, input.workspaceId);
    else await membership(req.auth!.userId, input.workspaceId);
    const scope = {
      workspaceId: input.workspaceId,
      ...(input.scope === 'mine' ? { userId: req.auth!.userId } : {}),
    };
    const cursor = input.beforeId
      ? await SupportTicket.findOne({ ...scope, _id: input.beforeId })
      : null;
    assert(!input.beforeId || cursor, 404, 'NOT_FOUND', 'Support cursor not found');
    const tickets = await SupportTicket.find({
      ...scope,
      ...(cursor
        ? {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
            ],
          }
        : input.before
          ? { createdAt: { $lt: new Date(input.before) } }
          : {}),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(input.limit);
    res.json({
      tickets,
      nextBeforeId: tickets.length === input.limit ? tickets.at(-1)!._id : null,
    });
  });
  router.patch('/support/:ticketId', async (req, res) => {
    const ticket = await SupportTicket.findById(param(req, 'ticketId'));
    assert(ticket, 404, 'NOT_FOUND', 'Support request not found');
    await admin(rt, req.auth!, ticket.workspaceId);
    const input = body(
      z.object({ status: z.enum(['open', 'resolved']), response: text(5000) }).strict(),
      req,
    );
    const updated = await SupportTicket.findByIdAndUpdate(
      ticket._id,
      { $set: { ...input, resolvedAt: input.status === 'resolved' ? new Date() : null } },
      { returnDocument: 'after' },
    );
    await audit(req, 'support.updated', ticket._id, ticket.workspaceId);
    res.json({ ticket: updated });
  });
  return router;
}
