// Contract index with operation-specific request shapes. Detailed workflows: docs/API.md.
type JsonSchema = Record<string, unknown>;
const string = { type: 'string' };
const id = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date-time' };
const bool = { type: 'boolean' };
const object = (properties: Record<string, JsonSchema>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const routes: Array<[string, string, string, JsonSchema?, boolean?]> = [
  ['get', '/api/auth/config', 'Public authentication policy', undefined, true],
  ['get', '/help', 'Public help articles', undefined, true],
  ['get', '/api/account/preferences', 'Read cookie, locale and time-zone preferences'],
  [
    'patch',
    '/api/account/preferences',
    'Update preferences; does not enable tracking',
    object({ timezone: string, locale: string, analyticsConsent: bool, marketingConsent: bool }),
  ],
  ['get', '/api/account/onboarding', 'Read onboarding progress'],
  [
    'post',
    '/api/account/onboarding/complete',
    'Complete onboarding after workspace membership',
    object({}),
  ],
  [
    'get',
    '/api/account/support',
    'List own support requests; workspace scope requires administrator',
  ],
  [
    'post',
    '/api/account/support',
    'Create a workspace support request',
    object({ workspaceId: id, subject: string, message: string }, [
      'workspaceId',
      'subject',
      'message',
    ]),
  ],
  [
    'patch',
    '/api/account/support/{ticketId}',
    'Administrator response to a support request',
    object({ status: { type: 'string', enum: ['open', 'resolved'] }, response: string }, [
      'status',
      'response',
    ]),
  ],
  [
    'post',
    '/api/auth/register',
    'Register and send email verification OTP',
    object(
      {
        email: { type: 'string', format: 'email' },
        name: string,
        password: { type: 'string', minLength: 12, maxLength: 128 },
      },
      ['email', 'name', 'password'],
    ),
    true,
  ],
  [
    'post',
    '/api/auth/login',
    'Sign in',
    object({ email: string, password: string, code: string }, ['email', 'password']),
    true,
  ],
  ...[
    'verify-email',
    'reset-password',
    'forgot-password',
    'resend-verification',
    'refresh',
    'google/complete',
  ].map(
    (path) =>
      ['post', `/api/auth/${path}`, path, undefined, true] as [
        string,
        string,
        string,
        JsonSchema?,
        boolean?,
      ],
  ),
  [
    'post',
    '/api/auth/verify-email-otp',
    'Verify email using a six-digit OTP',
    object(
      {
        email: { type: 'string', format: 'email' },
        code: { type: 'string', pattern: '^[0-9]{6}$' },
      },
      ['email', 'code'],
    ),
    true,
  ],
  ['get', '/api/auth/google', 'Start Google OAuth', undefined, true],
  ['get', '/api/auth/google/callback', 'Google OAuth callback', undefined, true],
  ['post', '/api/auth/logout', 'Revoke current session'],
  ['get', '/api/auth/me', 'Get current profile'],
  ['patch', '/api/auth/me', 'Update profile', object({ name: string }, ['name'])],
  ['get', '/api/auth/csrf', 'Recover CSRF token using current refresh cookie'],
  [
    'post',
    '/api/auth/change-password',
    'Change password and revoke sessions',
    object({ currentPassword: string, password: string, code: string }, [
      'currentPassword',
      'password',
    ]),
  ],
  ['get', '/api/auth/sessions', 'List active sessions'],
  ['delete', '/api/auth/sessions/{sessionId}', 'Revoke session'],
  ['post', '/api/auth/mfa/setup', 'Enroll authenticator', object({ password: string })],
  ['post', '/api/auth/mfa/confirm', 'Confirm authenticator', object({ code: string }, ['code'])],
  [
    'post',
    '/api/auth/mfa/disable',
    'Disable MFA and revoke sessions',
    object({ code: string }, ['code']),
  ],
  ['get', '/api/workspaces', 'List my workspaces'],
  ['post', '/api/workspaces', 'Create workspace', object({ name: string }, ['name'])],
  ['get', '/api/workspaces/{workspaceId}', 'Get workspace'],
  [
    'patch',
    '/api/workspaces/{workspaceId}',
    'Update workspace settings',
    object({
      name: string,
      retentionDays: { type: 'integer', minimum: 1, maximum: 3650 },
      aiEnabled: bool,
    }),
  ],
  ['get', '/api/workspaces/{workspaceId}/members', 'List members'],
  [
    'patch',
    '/api/workspaces/{workspaceId}/members/{userId}',
    'Change member role',
    object({ role: { type: 'string', enum: ['admin', 'member'] } }, ['role']),
  ],
  ['delete', '/api/workspaces/{workspaceId}/members/{userId}', 'Remove member or leave workspace'],
  [
    'post',
    '/api/workspaces/{workspaceId}/transfer',
    'Transfer ownership',
    object({ userId: id }, ['userId']),
  ],
  ['get', '/api/workspaces/{workspaceId}/invitations', 'List invitations'],
  [
    'post',
    '/api/workspaces/{workspaceId}/invitations',
    'Send invitation',
    object({ email: string, role: { type: 'string', enum: ['admin', 'member'] } }, ['email']),
  ],
  ['delete', '/api/workspaces/{workspaceId}/invitations/{invitationId}', 'Revoke invitation'],
  ['post', '/api/invitations/accept', 'Accept invitation', object({ token: string }, ['token'])],
  ['get', '/api/workspaces/{workspaceId}/projects', 'List projects'],
  [
    'post',
    '/api/workspaces/{workspaceId}/projects',
    'Create project',
    object({ name: string, description: string }, ['name']),
  ],
  [
    'patch',
    '/api/workspaces/{workspaceId}/projects/{projectId}',
    'Update or archive project',
    object({ name: string, description: string, archived: bool }),
  ],
  ['get', '/api/workspaces/{workspaceId}/tasks', 'List tasks'],
  ['post', '/api/workspaces/{workspaceId}/tasks', 'Create task'],
  ['patch', '/api/workspaces/{workspaceId}/tasks/{taskId}', 'Update task using version'],
  ['delete', '/api/workspaces/{workspaceId}/tasks/{taskId}', 'Delete task'],
  ['get', '/api/notifications', 'List my notifications'],
  ['post', '/api/notifications/{notificationId}/read', 'Mark notification read'],
  ['get', '/api/workspaces/{workspaceId}/audit', 'List workspace audit events'],
  ['get', '/api/workspaces/{workspaceId}/analytics', 'Aggregate workspace analytics'],
  ['get', '/api/workspaces/{workspaceId}/meetings', 'List or search accessible meetings'],
  [
    'post',
    '/api/workspaces/{workspaceId}/meetings',
    'Schedule meeting',
    object(
      {
        title: string,
        description: string,
        startsAt: date,
        durationMinutes: { type: 'integer' },
        visibility: { type: 'string', enum: ['workspace', 'invite'] },
        invitees: { type: 'array', items: id },
        lobbyEnabled: bool,
        processingMode: { type: 'string', enum: ['standard', 'confidential'] },
      },
      ['title', 'startsAt'],
    ),
  ],
  ['get', '/api/meetings/{meetingId}', 'Get meeting'],
  ['patch', '/api/meetings/{meetingId}', 'Update scheduled meeting or live title/lock'],
  ['delete', '/api/meetings/{meetingId}', 'Request permanent artifact deletion'],
  ...[
    'start',
    'end',
    'cancel',
    'leave',
    'media-token',
    'summarize',
    'recordings/start',
    'recordings/stop',
  ].map((path) => ['post', `/api/meetings/{meetingId}/${path}`, path] as [string, string, string]),
  [
    'post',
    '/api/meetings/{meetingId}/join',
    'Join lobby',
    object({ aiConsent: bool, recordingConsent: bool }),
  ],
  [
    'patch',
    '/api/meetings/{meetingId}/consent',
    'Change processing consent',
    object({ aiConsent: bool, recordingConsent: bool }, ['aiConsent', 'recordingConsent']),
  ],
  ['get', '/api/meetings/{meetingId}/participants', 'List participants'],
  ['post', '/api/meetings/{meetingId}/participants/{userId}/admit', 'Admit participant'],
  ['post', '/api/meetings/{meetingId}/participants/{userId}/remove', 'Remove participant'],
  [
    'patch',
    '/api/meetings/{meetingId}/participants/{userId}/media',
    'Change publishing permission',
    object({ canPublish: bool }, ['canPublish']),
  ],
  ['get', '/api/meetings/{meetingId}/transcript', 'Read transcript segments'],
  ['get', '/api/meetings/{meetingId}/summary', 'Read summary'],
  [
    'post',
    '/api/meetings/{meetingId}/actions/{actionId}/accept',
    'Approve action into task',
    object({ projectId: id, assigneeId: { anyOf: [id, { type: 'null' }] }, dueAt: date }),
  ],
  ['get', '/api/jobs/{jobId}', 'Get asynchronous job status'],
  ['get', '/api/meetings/{meetingId}/export', 'Export JSON, Markdown or WebVTT'],
  ['post', '/api/jobs/{jobId}/retry', 'Retry failed job after reauthorization'],
  [
    'post',
    '/api/meetings/{meetingId}/audio-uploads',
    'Reserve a private audio upload',
    object(
      {
        contentType: {
          type: 'string',
          enum: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'],
        },
        size: { type: 'integer' },
        startSeconds: { type: 'number' },
        durationSeconds: { type: 'number', maximum: 300 },
      },
      ['contentType', 'size', 'startSeconds', 'durationSeconds'],
    ),
  ],
  [
    'post',
    '/api/assets/{assetId}/complete',
    'Validate and seal uploaded audio; enqueue transcription',
  ],
  ['get', '/api/meetings/{meetingId}/assets', 'List private meeting assets'],
  ['get', '/api/assets/{assetId}/download', 'Create short-lived download URL'],
  ['delete', '/api/assets/{assetId}', 'Delete stored asset'],
  ['get', '/api/meetings/{meetingId}/messages', 'Read durable chat history'],
  [
    'post',
    '/api/meetings/{meetingId}/messages',
    'Send idempotent chat message',
    object({ clientId: id, text: string, mentions: { type: 'array', items: id } }, [
      'clientId',
      'text',
    ]),
  ],
  ['delete', '/api/meetings/{meetingId}/messages/{messageId}', 'Delete chat message'],
  ['get', '/api/meetings/{meetingId}/notes', 'Get collaborative notes'],
  [
    'put',
    '/api/meetings/{meetingId}/notes',
    'Replace notes with optimistic concurrency',
    object({ text: string, revision: { type: 'integer', minimum: 0 } }, ['text', 'revision']),
  ],
];
export function openapi(url: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, summary, schema, anonymous] of routes) {
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: id,
    }));
    if (!anonymous && !['get', 'head', 'options'].includes(method))
      parameters.push({
        name: 'X-CSRF-Token',
        in: 'header',
        required: false,
        description: 'Required when authenticating using cookies',
        schema: string,
      });
    paths[path] ??= {};
    paths[path]![method] = {
      summary,
      operationId: `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      security: anonymous ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
      parameters,
      ...(schema
        ? { requestBody: { required: true, content: { 'application/json': { schema } } } }
        : {}),
      responses: {
        '200': { description: 'Successful operation; see API guide for resource shape' },
        '201': { description: 'Resource created' },
        '202': { description: 'Asynchronous operation accepted' },
        '204': { description: 'Successful operation with no response body' },
        '400': { description: 'Validation failed' },
        '401': { description: 'Authentication required' },
        '403': { description: 'Permission or consent denied' },
        '404': { description: 'Resource not found or inaccessible' },
        '409': { description: 'State or version conflict' },
        '429': { description: 'Quota exceeded' },
        '503': { description: 'Dependency unavailable' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'IntellMeet Backend',
      version: '1.0.0',
      description:
        'REST contract index. See docs/API.md for request details, pagination, cookie/CSRF flow, and Socket.IO events.',
    },
    servers: [{ url }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'im_access' },
      },
    },
    paths,
  };
}
