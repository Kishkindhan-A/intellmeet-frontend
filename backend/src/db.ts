import mongoose, { Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';

mongoose.set('strictQuery', true);
const id = { type: String, default: randomUUID };
const str = { type: String, required: true };
const options = { timestamps: true, strict: 'throw', versionKey: false } as const;
const userSchema = new Schema(
  {
    _id: id,
    email: { ...str, lowercase: true, unique: true },
    name: str,
    passwordHash: String,
    verified: { type: Boolean, default: false },
    securityVersion: { type: Number, default: 0 },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },
    onboardingCompletedAt: Date,
    analyticsConsent: { type: Boolean, default: false },
    marketingConsent: { type: Boolean, default: false },
    preferencesUpdatedAt: Date,
    googleSub: { type: String, unique: true, sparse: true },
    mfaSecret: String,
    mfaPending: String,
    mfaEnabled: { type: Boolean, default: false },
    mfaLastCounter: { type: Number, default: -1 },
    recoveryHashes: [String],
  },
  options,
);
export const User = mongoose.model('User', userSchema);
const supportSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    userId: str,
    subject: str,
    message: str,
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    response: { type: String, default: '' },
    resolvedAt: Date,
  },
  options,
);
supportSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
supportSchema.index({ workspaceId: 1, userId: 1, createdAt: -1, _id: -1 });
export const SupportTicket = mongoose.model('SupportTicket', supportSchema);
const sessionSchema = new Schema(
  {
    _id: id,
    userId: str,
    securityVersion: { type: Number, default: 0 },
    refreshHash: str,
    previousHashes: [String],
    csrfHash: str,
    csrfCipher: str,
    mfa: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    userAgent: String,
  },
  options,
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });
export const Session = mongoose.model('Session', sessionSchema);
const tokenSchema = new Schema(
  {
    _id: id,
    hash: { ...str, unique: true },
    userId: String,
    email: String,
    kind: { ...str, enum: ['verify', 'reset', 'invite', 'oauth'] },
    workspaceId: String,
    role: { type: String, enum: ['admin', 'member'] },
    payload: String,
    expiresAt: { type: Date, required: true },
  },
  options,
);
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OneTimeToken = mongoose.model('OneTimeToken', tokenSchema);
export const Workspace = mongoose.model(
  'Workspace',
  new Schema(
    {
      _id: id,
      name: str,
      ownerId: str,
      retentionDays: { type: Number, default: 90 },
      aiEnabled: { type: Boolean, default: true },
    },
    options,
  ),
);
const membershipSchema = new Schema(
  { _id: id, workspaceId: str, userId: str, role: { ...str, enum: ['owner', 'admin', 'member'] } },
  options,
);
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });
export const Membership = mongoose.model('Membership', membershipSchema);
const meetingSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    title: str,
    description: { type: String, default: '' },
    hostId: str,
    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60 },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'ended', 'cancelled'],
      default: 'scheduled',
    },
    visibility: { type: String, enum: ['workspace', 'invite'], default: 'workspace' },
    invitees: [String],
    lobbyEnabled: { type: Boolean, default: true },
    locked: { type: Boolean, default: false },
    processingMode: { type: String, enum: ['standard', 'confidential'], default: 'standard' },
    recordingState: {
      type: String,
      enum: ['idle', 'starting', 'recording', 'stopping'],
      default: 'idle',
    },
    egressId: String,
    recordingAssetId: String,
    startedAt: Date,
    endedAt: Date,
    mediaClosePending: { type: Boolean, default: false },
    deletedAt: Date,
  },
  options,
);
meetingSchema.index({ workspaceId: 1, startsAt: -1 });
export const Meeting = mongoose.model('Meeting', meetingSchema);
const participantSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: str,
    userId: str,
    status: { type: String, enum: ['waiting', 'admitted', 'removed', 'left'], default: 'waiting' },
    recordingConsent: { type: Boolean, default: false },
    aiConsent: { type: Boolean, default: false },
    canPublish: { type: Boolean, default: true },
    joinedAt: Date,
    admittedAt: Date,
    leftAt: Date,
    connected: { type: Boolean, default: false },
    connectedAt: Date,
    connectedSeconds: { type: Number, default: 0 },
  },
  options,
);
participantSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
export const Participant = mongoose.model('Participant', participantSchema);
const messageSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: str,
    userId: str,
    clientId: str,
    text: str,
    mentions: [String],
    deletedAt: Date,
  },
  options,
);
messageSchema.index({ meetingId: 1, userId: 1, clientId: 1 }, { unique: true });
messageSchema.index({ meetingId: 1, _id: 1 });
messageSchema.index({ meetingId: 1, createdAt: 1, _id: 1 });
export const Message = mongoose.model('Message', messageSchema);
const noteSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: { ...str, unique: true },
    text: { type: String, default: '' },
    revision: { type: Number, default: 0 },
    updatedBy: str,
  },
  options,
);
export const Note = mongoose.model('Note', noteSchema);
const segmentSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: str,
    assetId: str,
    speakerId: String,
    startSeconds: { type: Number, required: true },
    endSeconds: { type: Number, required: true },
    text: str,
  },
  options,
);
segmentSchema.index({ assetId: 1 }, { unique: true });
segmentSchema.index({ meetingId: 1, startSeconds: 1 });
export const Transcript = mongoose.model('Transcript', segmentSchema);
const summarySchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: { ...str, unique: true },
    overview: str,
    decisions: [String],
    actions: [
      {
        _id: false,
        id: str,
        title: str,
        assigneeId: { type: String, default: null },
        dueDate: { type: String, default: null },
        evidence: [String],
        acceptedTaskId: String,
      },
    ],
    sourceHash: str,
    model: str,
  },
  options,
);
export const Summary = mongoose.model('Summary', summarySchema);
export const Project = mongoose.model(
  'Project',
  new Schema(
    {
      _id: id,
      workspaceId: str,
      name: str,
      description: { type: String, default: '' },
      createdBy: str,
      archived: { type: Boolean, default: false },
    },
    options,
  ),
);
const taskSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    projectId: String,
    meetingId: String,
    title: str,
    description: { type: String, default: '' },
    assigneeId: { type: String, default: null },
    status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    dueAt: Date,
    createdBy: str,
    version: { type: Number, default: 0 },
    sourceActionId: { type: String, unique: true, sparse: true },
  },
  options,
);
taskSchema.index({ workspaceId: 1, projectId: 1, status: 1 });
export const Task = mongoose.model('Task', taskSchema);
const assetSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: str,
    userId: str,
    key: { ...str, unique: true },
    kind: { type: String, enum: ['audio', 'recording', 'attachment'], required: true },
    contentType: str,
    size: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'ready', 'deleting', 'deleted', 'failed'],
      default: 'pending',
    },
    startSeconds: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    expiresAt: Date,
  },
  options,
);
assetSchema.index({ meetingId: 1 });
export const Asset = mongoose.model('Asset', assetSchema);
const jobSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    meetingId: str,
    requestedBy: str,
    kind: { type: String, enum: ['transcribe', 'summarize', 'purge'], required: true },
    retryOf: { type: String, unique: true, sparse: true },
    assetId: String,
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    error: String,
    queuedAt: Date,
    finishedAt: Date,
  },
  options,
);
jobSchema.index({ status: 1, createdAt: 1 });
export const JobRecord = mongoose.model('JobRecord', jobSchema);
const notificationSchema = new Schema(
  {
    _id: id,
    workspaceId: str,
    userId: str,
    kind: str,
    title: str,
    resourceId: String,
    readAt: Date,
  },
  options,
);
notificationSchema.index({ userId: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', notificationSchema);
const auditSchema = new Schema(
  {
    _id: id,
    workspaceId: String,
    actorId: String,
    action: str,
    resourceId: String,
    requestId: String,
    outcome: { type: String, default: 'success' },
  },
  options,
);
auditSchema.index({ workspaceId: 1, createdAt: -1 });
export const Audit = mongoose.model('Audit', auditSchema);
const webhookSchema = new Schema(
  { _id: str, receivedAt: { type: Date, default: Date.now }, processedAt: Date },
  { versionKey: false },
);
webhookSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 604800 });
export const WebhookEvent = mongoose.model('WebhookEvent', webhookSchema);
export const models = [
  User,
  SupportTicket,
  Session,
  OneTimeToken,
  Workspace,
  Membership,
  Meeting,
  Participant,
  Message,
  Note,
  Transcript,
  Summary,
  Project,
  Task,
  Asset,
  JobRecord,
  Notification,
  Audit,
  WebhookEvent,
];
export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
}
export async function ensureIndexes() {
  // Idempotent backfill for accounts created before credential-version invalidation.
  await User.updateMany({ securityVersion: { $exists: false } }, { $set: { securityVersion: 0 } });
  await Session.updateMany(
    { securityVersion: { $exists: false } },
    { $set: { securityVersion: 0 } },
  );
  for (const model of models) await model.createIndexes();
}
export { mongoose };
