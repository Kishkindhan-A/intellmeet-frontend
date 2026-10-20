import { Router } from 'express';
import { z } from 'zod';
import {
  Workspace,
  Membership,
  User,
  OneTimeToken,
  Project,
  Task,
  Notification,
  Audit,
  Meeting,
  Participant,
  mongoose,
} from './db.js';
import { assert, audit, body, email, hash, pagination, param, text, token, uuid } from './lib.js';
import { admin, displayMembers, membership, validateMembers } from './policy.js';
import type { Runtime } from './ports.js';
import { requireAuth } from './auth.js';

export async function notify(
  rt: Runtime,
  workspaceId: string,
  userId: string,
  kind: string,
  title: string,
  resourceId: string,
) {
  const notification = await Notification.create({ workspaceId, userId, kind, title, resourceId });
  rt.events.emit(`user:${userId}`, 'notification.created', notification.toObject());
}
export function workspaceRoutes(rt: Runtime) {
  const router = Router();
  router.use(requireAuth(rt));
  router.get('/workspaces', async (req, res) => {
    const members = await Membership.find({ userId: req.auth!.userId }).lean();
    const workspaces = await Workspace.find({
      _id: { $in: members.map((m) => m.workspaceId) },
    }).lean();
    res.json({
      workspaces: workspaces.map((w) => ({
        ...w,
        role: members.find((m) => m.workspaceId === w._id)!.role,
      })),
    });
  });
  router.post('/workspaces', async (req, res) => {
    const input = body(z.object({ name: text(100) }).strict(), req);
    assert(
      (await Membership.countDocuments({ userId: req.auth!.userId, role: 'owner' })) < 20,
      409,
      'WORKSPACE_LIMIT',
      'Workspace creation limit reached',
    );
    const session = await mongoose.startSession();
    let workspace;
    try {
      await session.withTransaction(async () => {
        [workspace] = await Workspace.create([{ name: input.name, ownerId: req.auth!.userId }], {
          session,
        });
        await Membership.create(
          [{ workspaceId: workspace!._id, userId: req.auth!.userId, role: 'owner' }],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    await audit(req, 'workspace.created', workspace!._id, workspace!._id);
    res.status(201).json({ workspace });
  });
  router.get('/workspaces/:workspaceId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const member = await membership(req.auth!.userId, workspaceId);
    res.json({ workspace: await Workspace.findById(workspaceId), role: member.role });
  });
  router.patch('/workspaces/:workspaceId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await admin(rt, req.auth!, workspaceId);
    const input = body(
      z
        .object({
          name: text(100).optional(),
          retentionDays: z.number().int().min(1).max(3650).optional(),
          aiEnabled: z.boolean().optional(),
        })
        .strict(),
      req,
    );
    const workspace = await Workspace.findByIdAndUpdate(
      workspaceId,
      { $set: input },
      { returnDocument: 'after' },
    );
    await audit(req, 'workspace.updated', workspaceId, workspaceId);
    res.json({ workspace });
  });
  router.get('/workspaces/:workspaceId/members', async (req, res) => {
    const id = param(req, 'workspaceId');
    await membership(req.auth!.userId, id);
    res.json({ members: await displayMembers(id) });
  });
  router.post('/workspaces/:workspaceId/invitations', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await admin(rt, req.auth!, workspaceId);
    const input = body(
      z.object({ email, role: z.enum(['admin', 'member']).default('member') }).strict(),
      req,
    );
    assert(
      await rt.coordinator.consume(`invites:${workspaceId}`, 50, 86400),
      429,
      'INVITE_LIMIT',
      'Daily invitation limit reached',
    );
    const raw = token();
    const invite = await OneTimeToken.create({
      hash: hash(raw),
      workspaceId,
      email: input.email,
      role: input.role,
      kind: 'invite',
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    const workspace = await Workspace.findById(workspaceId);
    await rt.mail.send(
      input.email,
      'IntellMeet workspace invitation',
      `You have been invited to ${workspace!.name}. Sign in with ${input.email} and open ${rt.config.APP_URL}/invite#token=${raw}`,
    );
    await audit(req, 'workspace.invited', invite._id, workspaceId);
    res.status(201).json({
      invitation: {
        id: invite._id,
        email: input.email,
        role: input.role,
        expiresAt: invite.expiresAt,
      },
    });
  });
  router.get('/workspaces/:workspaceId/invitations', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await admin(rt, req.auth!, workspaceId);
    res.json({
      invitations: await OneTimeToken.find({
        workspaceId,
        kind: 'invite',
        expiresAt: { $gt: new Date() },
      }).select('_id email role expiresAt'),
    });
  });
  router.delete('/workspaces/:workspaceId/invitations/:invitationId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await admin(rt, req.auth!, workspaceId);
    await OneTimeToken.deleteOne({ _id: param(req, 'invitationId'), workspaceId, kind: 'invite' });
    res.status(204).end();
  });
  router.post('/invitations/accept', async (req, res) => {
    const input = body(z.object({ token: text(200) }).strict(), req);
    const user = await User.findById(req.auth!.userId);
    const session = await mongoose.startSession();
    let workspaceId: string | undefined;
    try {
      await session.withTransaction(async () => {
        const invite = await OneTimeToken.findOneAndDelete(
          {
            hash: hash(input.token),
            kind: 'invite',
            email: user!.email,
            expiresAt: { $gt: new Date() },
          },
          { session },
        );
        assert(
          invite?.workspaceId,
          400,
          'INVITATION_INVALID',
          'Invitation is expired, used, or belongs to a different email',
        );
        workspaceId = invite.workspaceId;
        await Membership.updateOne(
          { workspaceId, userId: user!._id },
          { $setOnInsert: { role: invite.role ?? 'member' } },
          { upsert: true, session },
        );
      });
    } finally {
      await session.endSession();
    }
    await audit(req, 'workspace.invitation.accepted', workspaceId, workspaceId);
    res.json({ workspaceId });
  });
  router.patch('/workspaces/:workspaceId/members/:userId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const actor = await admin(rt, req.auth!, workspaceId);
    const userId = param(req, 'userId');
    assert(actor.role === 'owner', 403, 'OWNER_REQUIRED', 'Only the owner can change roles');
    const input = body(z.object({ role: z.enum(['admin', 'member']) }).strict(), req);
    const member = await Membership.findOneAndUpdate(
      { workspaceId, userId, role: { $ne: 'owner' } },
      { $set: input },
      { returnDocument: 'after' },
    );
    assert(member, 404, 'NOT_FOUND', 'Member not found or is workspace owner');
    await rt.events.revokeWorkspace(userId, workspaceId);
    await audit(req, 'workspace.role.changed', userId, workspaceId);
    res.json({ member });
  });
  router.post('/workspaces/:workspaceId/transfer', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const actor = await admin(rt, req.auth!, workspaceId);
    assert(actor.role === 'owner', 403, 'OWNER_REQUIRED', 'Only the owner can transfer ownership');
    const input = body(z.object({ userId: uuid }).strict(), req);
    assert(input.userId !== req.auth!.userId, 400, 'INVALID_OWNER', 'Choose another member');
    await validateMembers(workspaceId, [input.userId]);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const result = await Workspace.updateOne(
          { _id: workspaceId, ownerId: req.auth!.userId },
          { $set: { ownerId: input.userId } },
          { session },
        );
        assert(result.modifiedCount === 1, 409, 'CONFLICT', 'Ownership changed');
        await Membership.updateOne(
          { workspaceId, userId: req.auth!.userId },
          { $set: { role: 'admin' } },
          { session },
        );
        await Membership.updateOne(
          { workspaceId, userId: input.userId },
          { $set: { role: 'owner' } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    await audit(req, 'workspace.ownership.transferred', input.userId, workspaceId);
    res.status(204).end();
  });
  router.delete('/workspaces/:workspaceId/members/:userId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const userId = param(req, 'userId');
    const actor = await membership(req.auth!.userId, workspaceId);
    if (userId !== req.auth!.userId) await admin(rt, req.auth!, workspaceId);
    const target = await membership(userId, workspaceId);
    assert(target.role !== 'owner', 409, 'OWNER_REQUIRED', 'Transfer ownership before leaving');
    assert(
      target.role !== 'admin' || actor.role === 'owner' || userId === req.auth!.userId,
      403,
      'OWNER_REQUIRED',
      'Only the owner can remove another administrator',
    );
    await Membership.deleteOne({ _id: target._id });
    await rt.events.revokeWorkspace(userId, workspaceId);
    const active = await Participant.find({ workspaceId, userId, status: 'admitted' });
    await Participant.updateMany({ workspaceId, userId }, { $set: { status: 'removed' } });
    for (const p of active) {
      if (rt.media.configured)
        await rt.media
          .remove(p.meetingId, userId)
          .catch(() =>
            rt.logger.warn({ meetingId: p.meetingId }, 'Media removal pending reconciliation'),
          );
    }
    await audit(req, 'workspace.member.removed', userId, workspaceId);
    res.status(204).end();
  });
  router.get('/workspaces/:workspaceId/projects', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await membership(req.auth!.userId, workspaceId);
    res.json({ projects: await Project.find({ workspaceId }).sort({ createdAt: -1 }).limit(100) });
  });
  router.post('/workspaces/:workspaceId/projects', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await membership(req.auth!.userId, workspaceId);
    const input = body(
      z.object({ name: text(100), description: z.string().max(5000).default('') }).strict(),
      req,
    );
    const project = await Project.create({ ...input, workspaceId, createdBy: req.auth!.userId });
    await audit(req, 'project.created', project._id, workspaceId);
    res.status(201).json({ project });
  });
  router.patch('/workspaces/:workspaceId/projects/:projectId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const member = await membership(req.auth!.userId, workspaceId);
    const project = await Project.findOne({ _id: param(req, 'projectId'), workspaceId });
    assert(project, 404, 'NOT_FOUND', 'Project not found');
    assert(
      project.createdBy === req.auth!.userId || member.role !== 'member',
      403,
      'FORBIDDEN',
      'Project creator or administrator required',
    );
    const input = body(
      z
        .object({
          name: text(100).optional(),
          description: z.string().max(5000).optional(),
          archived: z.boolean().optional(),
        })
        .strict(),
      req,
    );
    Object.assign(project, input);
    await project.save();
    res.json({ project });
  });
  const taskInput = z
    .object({
      title: text(300),
      description: z.string().max(10000).default(''),
      projectId: uuid.optional(),
      assigneeId: uuid.nullable().optional(),
      dueAt: z.iso.datetime().optional(),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
    })
    .strict();
  router.get('/workspaces/:workspaceId/tasks', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await membership(req.auth!.userId, workspaceId);
    const input = z
      .object({
        projectId: uuid.optional(),
        status: z.enum(['todo', 'in_progress', 'done']).optional(),
        assigneeId: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        before: z.iso.datetime().optional(),
      })
      .parse(req.query);
    const { limit, before, ...filter } = input;
    res.json({
      tasks: await Task.find({
        workspaceId,
        ...filter,
        ...(before ? { createdAt: { $lt: new Date(before) } } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(limit),
    });
  });
  router.post('/workspaces/:workspaceId/tasks', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await membership(req.auth!.userId, workspaceId);
    const input = body(taskInput, req);
    if (input.projectId)
      assert(
        await Project.exists({ _id: input.projectId, workspaceId, archived: false }),
        400,
        'INVALID_PROJECT',
        'Active project required',
      );
    if (input.assigneeId) await validateMembers(workspaceId, [input.assigneeId]);
    const task = await Task.create({ ...input, workspaceId, createdBy: req.auth!.userId });
    if (task.assigneeId)
      await notify(
        rt,
        workspaceId,
        task.assigneeId,
        'task.assigned',
        'A task was assigned to you',
        task._id,
      );
    rt.events.emit(`workspace:${workspaceId}`, 'task.created', task.toObject());
    await audit(req, 'task.created', task._id, workspaceId);
    res.status(201).json({ task });
  });
  router.patch('/workspaces/:workspaceId/tasks/:taskId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const member = await membership(req.auth!.userId, workspaceId);
    const taskId = param(req, 'taskId');
    const task = await Task.findOne({ _id: taskId, workspaceId });
    assert(task, 404, 'NOT_FOUND', 'Task not found');
    assert(
      task.createdBy === req.auth!.userId ||
        task.assigneeId === req.auth!.userId ||
        member.role !== 'member',
      403,
      'FORBIDDEN',
      'Task creator, assignee or administrator required',
    );
    const input = body(
      taskInput
        .partial()
        .extend({
          status: z.enum(['todo', 'in_progress', 'done']).optional(),
          version: z.number().int().min(0),
        })
        .strict(),
      req,
    );
    if (input.assigneeId) await validateMembers(workspaceId, [input.assigneeId]);
    if (input.projectId)
      assert(
        await Project.exists({ _id: input.projectId, workspaceId, archived: false }),
        400,
        'INVALID_PROJECT',
        'Active project required',
      );
    const { version, ...changes } = input;
    const updated = await Task.findOneAndUpdate(
      { _id: taskId, workspaceId, version },
      { $set: changes, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    assert(updated, 409, 'VERSION_CONFLICT', 'Task changed; reload and merge your changes');
    if (input.assigneeId && input.assigneeId !== task.assigneeId)
      await notify(
        rt,
        workspaceId,
        input.assigneeId,
        'task.assigned',
        'A task was assigned to you',
        taskId,
      );
    rt.events.emit(`workspace:${workspaceId}`, 'task.updated', updated.toObject());
    await audit(req, 'task.updated', taskId, workspaceId);
    res.json({ task: updated });
  });
  router.delete('/workspaces/:workspaceId/tasks/:taskId', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const member = await membership(req.auth!.userId, workspaceId);
    const taskId = param(req, 'taskId');
    const task = await Task.findOne({ _id: taskId, workspaceId });
    assert(task, 404, 'NOT_FOUND', 'Task not found');
    assert(
      task.createdBy === req.auth!.userId || member.role !== 'member',
      403,
      'FORBIDDEN',
      'Task creator or administrator required',
    );
    await task.deleteOne();
    rt.events.emit(`workspace:${workspaceId}`, 'task.deleted', { id: taskId });
    await audit(req, 'task.deleted', taskId, workspaceId);
    res.status(204).end();
  });
  router.get('/notifications', async (req, res) => {
    const input = pagination.parse(req.query);
    const member = await Membership.find({ userId: req.auth!.userId });
    res.json({
      notifications: await Notification.find({
        userId: req.auth!.userId,
        workspaceId: { $in: member.map((m) => m.workspaceId) },
        ...(input.before ? { createdAt: { $lt: new Date(input.before) } } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(input.limit),
    });
  });
  router.post('/notifications/:notificationId/read', async (req, res) => {
    await Notification.updateOne(
      { _id: param(req, 'notificationId'), userId: req.auth!.userId },
      { $set: { readAt: new Date() } },
    );
    res.status(204).end();
  });
  router.get('/workspaces/:workspaceId/audit', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await admin(rt, req.auth!, workspaceId);
    const input = pagination.parse(req.query);
    res.json({
      events: await Audit.find({
        workspaceId,
        ...(input.before ? { createdAt: { $lt: new Date(input.before) } } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(input.limit),
    });
  });
  router.get('/workspaces/:workspaceId/analytics', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await admin(rt, req.auth!, workspaceId);
    const input = z
      .object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() })
      .parse(req.query);
    const from = input.from ? new Date(input.from) : new Date(Date.now() - 30 * 86400000);
    const to = input.to ? new Date(input.to) : new Date();
    assert(
      to > from && +to - +from <= 366 * 86400000,
      400,
      'INVALID_RANGE',
      'Choose a range of at most one year',
    );
    const [meetings, tasks, attendance] = await Promise.all([
      Meeting.aggregate([
        { $match: { workspaceId, deletedAt: null, startsAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            durationMinutes: {
              $sum: {
                $cond: [
                  { $and: ['$startedAt', '$endedAt'] },
                  { $divide: [{ $subtract: ['$endedAt', '$startedAt'] }, 60000] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      Task.aggregate([
        { $match: { workspaceId, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Participant.aggregate([
        { $match: { workspaceId, joinedAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            attendees: { $addToSet: '$userId' },
            totalConnectedSeconds: { $sum: '$connectedSeconds' },
          },
        },
      ]),
    ]);
    res.json({
      from,
      to,
      meetings,
      tasks,
      attendance: {
        uniqueAttendees: attendance[0]?.attendees.length ?? 0,
        totalConnectedSeconds: attendance[0]?.totalConnectedSeconds ?? 0,
      },
      note: 'Attendance measures connection time, not attention or productivity.',
    });
  });
  return router;
}
