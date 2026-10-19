import { Meeting, Membership, Participant, User } from './db.js';
import { assert } from './lib.js';
import type { Runtime } from './ports.js';

export async function membership(userId: string, workspaceId: string) {
  const member = await Membership.findOne({ workspaceId, userId });
  assert(member, 404, 'NOT_FOUND', 'Workspace not found');
  return member;
}
export async function admin(
  rt: Runtime,
  auth: { userId: string; mfa: boolean },
  workspaceId: string,
) {
  const member = await membership(auth.userId, workspaceId);
  assert(
    ['owner', 'admin'].includes(member.role),
    403,
    'FORBIDDEN',
    'Workspace administrator required',
  );
  assert(
    !rt.config.REQUIRE_ADMIN_MFA || auth.mfa,
    403,
    'MFA_REQUIRED',
    'Enable MFA and authenticate before administering this workspace',
  );
  return member;
}
export async function meetingAccess(userId: string, meetingId: string, workspaceId?: string) {
  const meeting = await Meeting.findOne({
    _id: meetingId,
    deletedAt: null,
    ...(workspaceId ? { workspaceId } : {}),
  });
  assert(meeting, 404, 'NOT_FOUND', 'Meeting not found');
  const member = await membership(userId, meeting.workspaceId);
  assert(
    meeting.visibility === 'workspace' ||
      meeting.hostId === userId ||
      meeting.invitees.includes(userId) ||
      member.role !== 'member',
    404,
    'NOT_FOUND',
    'Meeting not found',
  );
  const participant = await Participant.findOne({ meetingId, userId });
  assert(participant?.status !== 'removed', 403, 'REMOVED', 'You were removed from this meeting');
  return { meeting, member, participant };
}
export async function hostAccess(
  rt: Runtime,
  auth: { userId: string; mfa: boolean },
  meetingId: string,
  workspaceId?: string,
) {
  const access = await meetingAccess(auth.userId, meetingId, workspaceId);
  assert(
    access.meeting.hostId === auth.userId || access.member.role !== 'member',
    403,
    'FORBIDDEN',
    'Meeting host required',
  );
  // Hosting your assigned meeting does not use workspace administrator privileges.
  if (access.meeting.hostId !== auth.userId && access.member.role !== 'member')
    assert(
      !rt.config.REQUIRE_ADMIN_MFA || auth.mfa,
      403,
      'MFA_REQUIRED',
      'MFA authentication required',
    );
  return access;
}
export async function admitted(userId: string, meetingId: string) {
  const access = await meetingAccess(userId, meetingId);
  assert(
    access.meeting.status === 'live' && access.participant?.status === 'admitted',
    403,
    'NOT_ADMITTED',
    'Join the live meeting first',
  );
  return access;
}
export async function contentAccess(userId: string, meetingId: string) {
  const access = await meetingAccess(userId, meetingId);
  if (
    access.meeting.status === 'live' &&
    access.meeting.hostId !== userId &&
    access.member.role === 'member'
  ) {
    assert(
      access.participant?.status === 'admitted',
      403,
      'NOT_ADMITTED',
      'Admission is required to access live meeting content',
    );
  }
  return access;
}
export async function validateMembers(workspaceId: string, users: string[]) {
  const unique = [...new Set(users)];
  assert(
    (await Membership.countDocuments({ workspaceId, userId: { $in: unique } })) === unique.length,
    400,
    'INVALID_MEMBER',
    'All referenced users must belong to this workspace',
  );
}
export async function displayMembers(workspaceId: string) {
  const members = await Membership.find({ workspaceId }).limit(1000).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } })
    .select('_id name email')
    .lean();
  return members.map((m) => ({ ...m, user: users.find((u) => u._id === m.userId) }));
}
