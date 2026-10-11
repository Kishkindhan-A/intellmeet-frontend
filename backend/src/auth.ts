import { Router, type Request, type Response, type RequestHandler } from 'express';
import argon2 from 'argon2';
import { SignJWT, jwtVerify, createRemoteJWKSet, errors } from 'jose';
import { generateSecret, generateURI, verify } from 'otplib';
import { z } from 'zod';
import { Session, User, OneTimeToken, mongoose } from './db.js';
import {
  assert,
  audit,
  body,
  decrypt,
  email,
  encrypt,
  hash,
  HttpError,
  password,
  safeEqual,
  text,
  token,
} from './lib.js';
import type { Runtime } from './ports.js';

const secretKey = (rt: Runtime) => new TextEncoder().encode(rt.config.JWT_SECRET);
const publicUser = (u: {
  _id: string;
  email: string;
  name: string;
  verified: boolean;
  mfaEnabled: boolean;
}) => ({ id: u._id, email: u.email, name: u.name, verified: u.verified, mfaEnabled: u.mfaEnabled });
const hashPassword = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const cookieOptions = (rt: Runtime) => ({
  httpOnly: true,
  secure: rt.config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
});

export async function authenticate(rt: Runtime, access: string) {
  try {
    const { payload } = await jwtVerify(access, secretKey(rt), {
      algorithms: ['HS256'],
      issuer: rt.config.JWT_ISSUER,
      audience: rt.config.JWT_AUDIENCE,
    });
    assert(
      typeof payload.sub === 'string' && typeof payload.sid === 'string',
      401,
      'UNAUTHENTICATED',
      'Sign in required',
    );
    const session = await Session.findOne({
      _id: payload.sid,
      userId: payload.sub,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    assert(session, 401, 'SESSION_EXPIRED', 'Session has expired');
    const user = await User.findById(session.userId).select('securityVersion');
    assert(
      user && user.securityVersion === session.securityVersion,
      401,
      'SESSION_EXPIRED',
      'Session has expired',
    );
    return { userId: session.userId, sessionId: session._id, mfa: session.mfa };
  } catch (err) {
    if (err instanceof errors.JWTExpired)
      throw new HttpError(401, 'SESSION_EXPIRED', 'Session has expired');
    if (err instanceof errors.JOSEError)
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
    throw err;
  }
}
export function requireAuth(rt: Runtime): RequestHandler {
  return async (req, _res, next) => {
    try {
      const access = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : req.cookies?.im_access;
      assert(typeof access === 'string', 401, 'UNAUTHENTICATED', 'Sign in required');
      req.auth = await authenticate(rt, access);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.cookies?.im_access || req.cookies?.im_refresh)
      )
        await checkCsrf(req, req.auth.sessionId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
async function checkCsrf(req: Request, sessionId: string) {
  const csrf = req.headers['x-csrf-token'];
  const session = await Session.findById(sessionId);
  assert(
    typeof csrf === 'string' && session && safeEqual(hash(csrf), session.csrfHash),
    403,
    'CSRF_INVALID',
    'Valid CSRF token required',
  );
}
async function accessToken(rt: Runtime, sessionId: string, userId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(rt.config.JWT_ISSUER)
    .setAudience(rt.config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${rt.config.ACCESS_TOKEN_SECONDS}s`)
    .sign(secretKey(rt));
}
async function sessionResponse(
  rt: Runtime,
  res: Response,
  sessionId: string,
  userId: string,
  refresh: string,
  csrf: string,
) {
  const access = await accessToken(rt, sessionId, userId);
  res.cookie('im_access', access, {
    ...cookieOptions(rt),
    path: '/api',
    maxAge: rt.config.ACCESS_TOKEN_SECONDS * 1000,
  });
  res.cookie('im_refresh', `${sessionId}.${refresh}`, {
    ...cookieOptions(rt),
    path: '/api/auth',
    maxAge: rt.config.SESSION_DAYS * 86400000,
  });
  res.setHeader('Cache-Control', 'no-store');
  return { accessToken: access, csrfToken: csrf, expiresIn: rt.config.ACCESS_TOKEN_SECONDS };
}
async function createSession(
  rt: Runtime,
  req: Request,
  res: Response,
  userId: string,
  mfa: boolean,
  securityVersion: number,
) {
  const refresh = token();
  const csrf = token();
  const session = await Session.create({
    userId,
    securityVersion,
    refreshHash: hash(refresh),
    csrfHash: hash(csrf),
    csrfCipher: encrypt(csrf, rt.config.ENCRYPTION_KEY),
    mfa,
    expiresAt: new Date(Date.now() + rt.config.SESSION_DAYS * 86400000),
    userAgent: req.get('user-agent')?.slice(0, 300),
  });
  const current = await User.findById(userId).select('securityVersion');
  assert(
    current?.securityVersion === securityVersion,
    401,
    'SESSION_EXPIRED',
    'Account security changed; sign in again',
  );
  return sessionResponse(rt, res, session._id, userId, refresh, csrf);
}
async function sendToken(rt: Runtime, kind: 'verify' | 'reset', userId: string, address: string) {
  if (!(await rt.coordinator.consume(`email:${kind}:${hash(address)}`, 3, 3600))) return;
  const raw = token();
  await OneTimeToken.create({
    hash: hash(raw),
    userId,
    kind,
    expiresAt: new Date(Date.now() + (kind === 'reset' ? 1800000 : 86400000)),
  });
  await rt.mail.send(
    address,
    kind === 'reset' ? 'Reset your IntellMeet password' : 'Verify your IntellMeet email',
    `Open ${rt.config.APP_URL}/${kind === 'reset' ? 'reset-password' : 'verify-email'}#token=${raw}\nThis link is single-use. If you did not request it, ignore this email.`,
    kind === 'reset' ? undefined : 'verification',
  );
}
async function validateMfa(
  rt: Runtime,
  user: { _id: string; mfaSecret?: string | null; recoveryHashes: string[] },
  code?: string,
) {
  assert(code && user.mfaSecret, 401, 'MFA_REQUIRED', 'Authenticator or recovery code required');
  const recovery = hash(code);
  if (user.recoveryHashes.includes(recovery)) {
    const used = await User.updateOne(
      { _id: user._id, recoveryHashes: recovery },
      { $pull: { recoveryHashes: recovery } },
    );
    assert(used.modifiedCount === 1, 401, 'MFA_INVALID', 'Invalid authentication code');
    return;
  }
  assert(/^\d{6}$/.test(code), 401, 'MFA_INVALID', 'Invalid authentication code');
  const result = await verify({
    secret: decrypt(user.mfaSecret, rt.config.ENCRYPTION_KEY),
    token: code,
  });
  assert(result.valid, 401, 'MFA_INVALID', 'Invalid authentication code');
  const counter = Math.floor(Date.now() / 30000);
  const used = await User.updateOne(
    { _id: user._id, mfaLastCounter: { $lt: counter } },
    { $set: { mfaLastCounter: counter } },
  );
  assert(used.modifiedCount === 1, 401, 'MFA_REUSED', 'Wait for a new authentication code');
}
export function authRoutes(rt: Runtime) {
  const router = Router();
  const auth = requireAuth(rt);
  router.use(async (req, _res, next) => {
    try {
      if (['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/google')) return next();
      assert(
        await rt.coordinator.consume(`auth:${req.ip}`, 40, 900),
        429,
        'RATE_LIMITED',
        'Too many authentication requests',
      );
      next();
    } catch (e) {
      next(e);
    }
  });
  router.post('/register', async (req, res) => {
    const input = body(z.object({ email, name: text(100), password }).strict(), req);
    const exists = await User.exists({ email: input.email });
    if (!exists) {
      const user = await User.create({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      });
      await sendToken(rt, 'verify', user._id, user.email);
      await audit(req, 'auth.register', user._id);
    }
    res
      .status(202)
      .json({ message: 'If registration is eligible, check your email to verify your account.' });
  });
  router.post('/verify-email', async (req, res) => {
    const input = body(z.object({ token: text(200) }).strict(), req);
    await mongoose.connection.transaction(async (transaction) => {
      const one = await OneTimeToken.findOneAndDelete(
        {
          hash: hash(input.token),
          kind: 'verify',
          expiresAt: { $gt: new Date() },
        },
        { session: transaction },
      );
      assert(one, 400, 'TOKEN_INVALID', 'Link is invalid or expired');
      await User.updateOne(
        { _id: one.userId },
        { $set: { verified: true } },
        { session: transaction },
      );
    });
    res.json({ message: 'Email verified' });
  });
  router.post('/resend-verification', async (req, res) => {
    const input = body(z.object({ email }).strict(), req);
    const user = await User.findOne({ email: input.email, verified: false });
    if (user) await sendToken(rt, 'verify', user._id, user.email);
    res.status(202).json({ message: 'If eligible, a verification email has been sent.' });
  });
  router.post('/login', async (req, res) => {
    const input = body(
      z.object({ email, password: z.string().max(128), code: text(100).optional() }).strict(),
      req,
    );
    assert(
      await rt.coordinator.consume(`login:${hash(input.email)}`, 10, 900),
      429,
      'RATE_LIMITED',
      'Try signing in later',
    );
    const user = await User.findOne({ email: input.email });
    // Perform a password hash even for unknown users to reduce account enumeration timing.
    const valid = user?.passwordHash
      ? await argon2.verify(user.passwordHash, input.password)
      : (await hashPassword(input.password), false);
    assert(valid && user, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    assert(user.verified, 403, 'EMAIL_UNVERIFIED', 'Verify your email before signing in');
    if (user.mfaEnabled) await validateMfa(rt, user, input.code);
    const session = await createSession(
      rt,
      req,
      res,
      user._id,
      user.mfaEnabled,
      user.securityVersion,
    );
    req.auth = { userId: user._id, sessionId: '', mfa: user.mfaEnabled };
    await audit(req, 'auth.login');
    res.json({ ...session, user: publicUser(user) });
  });
  router.post('/refresh', async (req, res) => {
    const value = req.cookies?.im_refresh;
    assert(typeof value === 'string', 401, 'UNAUTHENTICATED', 'Refresh cookie required');
    const [id, raw] = value.split('.');
    assert(id && raw, 401, 'UNAUTHENTICATED', 'Invalid session');
    const session = await Session.findOne({
      _id: id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    assert(session, 401, 'SESSION_EXPIRED', 'Session has expired');
    const user = await User.findById(session.userId).select('securityVersion');
    assert(
      user?.securityVersion === session.securityVersion,
      401,
      'SESSION_EXPIRED',
      'Session has expired',
    );
    if (!safeEqual(session.refreshHash, hash(raw))) {
      if (session.previousHashes.includes(hash(raw))) {
        await Session.updateOne({ _id: id }, { $set: { revokedAt: new Date() } });
        await rt.events.revokeUser(session.userId);
      }
      throw new HttpError(401, 'REFRESH_INVALID', 'Session refresh rejected');
    }
    await checkCsrf(req, id);
    const refresh = token();
    const csrf = token();
    const updated = await Session.findOneAndUpdate(
      { _id: id, refreshHash: hash(raw), revokedAt: null },
      {
        $set: {
          refreshHash: hash(refresh),
          csrfHash: hash(csrf),
          csrfCipher: encrypt(csrf, rt.config.ENCRYPTION_KEY),
        },
        $push: { previousHashes: hash(raw) },
      },
    );
    assert(updated, 409, 'REFRESH_CONFLICT', 'Refresh already in progress');
    res.json(await sessionResponse(rt, res, id, session.userId, refresh, csrf));
  });
  router.post('/logout', auth, async (req, res) => {
    await Session.updateOne({ _id: req.auth!.sessionId }, { $set: { revokedAt: new Date() } });
    await rt.events.revokeUser(req.auth!.userId);
    res.clearCookie('im_access', { ...cookieOptions(rt), path: '/api' });
    res.clearCookie('im_refresh', { ...cookieOptions(rt), path: '/api/auth' });
    res.status(204).end();
  });
  router.get('/csrf', async (req, res) => {
    const value = req.cookies?.im_refresh;
    assert(typeof value === 'string', 401, 'UNAUTHENTICATED', 'Refresh cookie required');
    const [id, raw] = value.split('.');
    assert(id && raw, 401, 'UNAUTHENTICATED', 'Invalid session');
    const session = await Session.findOne({
      _id: id,
      refreshHash: hash(raw),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    assert(session, 401, 'UNAUTHENTICATED', 'Sign in required');
    res.json({ csrfToken: decrypt(session.csrfCipher, rt.config.ENCRYPTION_KEY) });
  });
  router.post('/change-password', auth, async (req, res) => {
    const input = body(
      z
        .object({ currentPassword: z.string().max(128), password, code: text(100).optional() })
        .strict(),
      req,
    );
    const user = await User.findById(req.auth!.userId);
    assert(
      user?.passwordHash && (await argon2.verify(user.passwordHash, input.currentPassword)),
      401,
      'INVALID_CREDENTIALS',
      'Current password is incorrect',
    );
    if (user.mfaEnabled) await validateMfa(rt, user, input.code);
    const passwordHash = await hashPassword(input.password);
    await mongoose.connection.transaction(async (transaction) => {
      const updated = await User.updateOne(
        { _id: user._id, securityVersion: user.securityVersion },
        { $set: { passwordHash }, $inc: { securityVersion: 1 } },
        { session: transaction },
      );
      assert(
        updated.modifiedCount === 1,
        409,
        'SECURITY_CHANGED',
        'Account security changed; sign in again',
      );
      await Session.updateMany(
        { userId: user._id },
        { $set: { revokedAt: new Date() } },
        { session: transaction },
      );
      await OneTimeToken.deleteMany({ userId: user._id, kind: 'reset' }, { session: transaction });
    });
    await rt.events.revokeUser(user._id);
    await audit(req, 'auth.password.changed');
    res.json({ message: 'Password updated; sign in again' });
  });
  router.post('/forgot-password', async (req, res) => {
    const input = body(z.object({ email }).strict(), req);
    const user = await User.findOne({ email: input.email });
    if (user) await sendToken(rt, 'reset', user._id, user.email);
    res.status(202).json({ message: 'If eligible, a password reset email has been sent.' });
  });
  router.post('/reset-password', async (req, res) => {
    const input = body(z.object({ token: text(200), password }).strict(), req);
    const passwordHash = await hashPassword(input.password);
    const userId = await mongoose.connection.transaction(async (transaction) => {
      const one = await OneTimeToken.findOneAndDelete(
        {
          hash: hash(input.token),
          kind: 'reset',
          expiresAt: { $gt: new Date() },
        },
        { session: transaction },
      );
      assert(one?.userId, 400, 'TOKEN_INVALID', 'Link is invalid or expired');
      await User.updateOne(
        { _id: one.userId },
        { $set: { passwordHash }, $inc: { securityVersion: 1 } },
        { session: transaction },
      );
      await Session.updateMany(
        { userId: one.userId },
        { $set: { revokedAt: new Date() } },
        { session: transaction },
      );
      await OneTimeToken.deleteMany(
        { userId: one.userId, kind: 'reset' },
        { session: transaction },
      );
      return one.userId;
    });
    await rt.events.revokeUser(userId);
    res.json({ message: 'Password updated; sign in again' });
  });
  router.get('/me', auth, async (req, res) => {
    const user = await User.findById(req.auth!.userId);
    assert(user, 401, 'UNAUTHENTICATED', 'Sign in required');
    res.json({ user: publicUser(user) });
  });
  router.patch('/me', auth, async (req, res) => {
    const input = body(z.object({ name: text(100) }).strict(), req);
    const user = await User.findByIdAndUpdate(
      req.auth!.userId,
      { $set: input },
      { returnDocument: 'after' },
    );
    res.json({ user: publicUser(user!) });
  });
  router.get('/sessions', auth, async (req, res) => {
    res.json({
      sessions: await Session.find({
        userId: req.auth!.userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).select('_id createdAt userAgent expiresAt'),
    });
  });
  router.delete('/sessions/:sessionId', auth, async (req, res) => {
    await Session.updateOne(
      { _id: req.params.sessionId, userId: req.auth!.userId },
      { $set: { revokedAt: new Date() } },
    );
    await rt.events.revokeUser(req.auth!.userId);
    res.status(204).end();
  });
  router.post('/mfa/setup', auth, async (req, res) => {
    const input = z
      .object({ password: z.string().max(128).optional() })
      .strict()
      .parse(req.body ?? {});
    const user = await User.findById(req.auth!.userId);
    assert(user && !user.mfaEnabled, 409, 'MFA_ENABLED', 'MFA is already enabled');
    if (user.passwordHash)
      assert(
        input.password && (await argon2.verify(user.passwordHash, input.password)),
        401,
        'REAUTH_REQUIRED',
        'Confirm your password to enroll MFA',
      );
    else {
      const session = await Session.findById(req.auth!.sessionId);
      assert(
        session && Date.now() - session.createdAt.getTime() < 600000,
        401,
        'REAUTH_REQUIRED',
        'Sign in again before enrolling MFA',
      );
    }
    const secret = generateSecret();
    const pending = await User.updateOne(
      { _id: user._id, mfaEnabled: false, securityVersion: user.securityVersion },
      { $set: { mfaPending: encrypt(secret, rt.config.ENCRYPTION_KEY) } },
    );
    assert(
      pending.modifiedCount === 1,
      409,
      'SECURITY_CHANGED',
      'Account security changed; sign in again',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ secret, uri: generateURI({ issuer: 'IntellMeet', label: user.email, secret }) });
  });
  router.post('/mfa/confirm', auth, async (req, res) => {
    const input = body(z.object({ code: z.string().regex(/^\d{6}$/) }).strict(), req);
    const user = await User.findById(req.auth!.userId);
    assert(
      user?.mfaPending && !user.mfaEnabled,
      409,
      'MFA_NOT_PENDING',
      'Start MFA enrollment first',
    );
    const result = await verify({
      secret: decrypt(user.mfaPending, rt.config.ENCRYPTION_KEY),
      token: input.code,
    });
    assert(result.valid, 400, 'MFA_INVALID', 'Invalid authentication code');
    const recoveryCodes = Array.from({ length: 8 }, () => token().slice(0, 20));
    await mongoose.connection.transaction(async (transaction) => {
      const enabled = await User.updateOne(
        {
          _id: user._id,
          mfaEnabled: false,
          mfaPending: user.mfaPending,
          securityVersion: user.securityVersion,
        },
        {
          $set: {
            mfaEnabled: true,
            mfaSecret: user.mfaPending,
            recoveryHashes: recoveryCodes.map(hash),
            mfaLastCounter: Math.floor(Date.now() / 30000),
          },
          $inc: { securityVersion: 1 },
          $unset: { mfaPending: 1 },
        },
        { session: transaction },
      );
      assert(
        enabled.modifiedCount === 1,
        409,
        'MFA_NOT_PENDING',
        'Enrollment changed; start again',
      );
      await Session.updateMany(
        { userId: user._id, _id: { $ne: req.auth!.sessionId } },
        { $set: { revokedAt: new Date() } },
        { session: transaction },
      );
      await Session.updateOne(
        { _id: req.auth!.sessionId },
        { $set: { mfa: true, securityVersion: user.securityVersion + 1 } },
        { session: transaction },
      );
    });
    await rt.events.revokeUser(user._id);
    await audit(req, 'auth.mfa.enabled');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ recoveryCodes });
  });
  router.post('/mfa/disable', auth, async (req, res) => {
    const input = body(z.object({ code: text(100) }).strict(), req);
    const user = await User.findById(req.auth!.userId);
    assert(user?.mfaEnabled, 400, 'MFA_DISABLED', 'MFA is not enabled');
    await validateMfa(rt, user, input.code);
    await mongoose.connection.transaction(async (transaction) => {
      const disabled = await User.updateOne(
        { _id: user._id, securityVersion: user.securityVersion },
        {
          $set: { mfaEnabled: false, recoveryHashes: [] },
          $unset: { mfaSecret: 1, mfaPending: 1 },
          $inc: { securityVersion: 1 },
        },
        { session: transaction },
      );
      assert(
        disabled.modifiedCount === 1,
        409,
        'SECURITY_CHANGED',
        'Account security changed; sign in again',
      );
      await Session.updateMany(
        { userId: user._id },
        { $set: { revokedAt: new Date() } },
        { session: transaction },
      );
    });
    await rt.events.revokeUser(user._id);
    await audit(req, 'auth.mfa.disabled');
    res.json({ message: 'MFA disabled; sign in again' });
  });
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  router.get('/google', async (_req, res) => {
    assert(
      rt.config.GOOGLE_CLIENT_ID && rt.config.GOOGLE_CLIENT_SECRET,
      503,
      'OAUTH_UNAVAILABLE',
      'Google login is not configured',
    );
    const state = token();
    const verifier = token();
    const nonce = token();
    await OneTimeToken.create({
      hash: hash(state),
      kind: 'oauth',
      payload: encrypt(JSON.stringify({ verifier, nonce }), rt.config.ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + 600000),
    });
    res.cookie('im_oauth', state, {
      ...cookieOptions(rt),
      path: '/api/auth/google/callback',
      maxAge: 600000,
    });
    const query = new URLSearchParams({
      client_id: rt.config.GOOGLE_CLIENT_ID,
      redirect_uri: `${rt.config.API_URL}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'),
      code_challenge_method: 'S256',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
  });
  router.get('/google/callback', async (req, res) => {
    const input = z.object({ state: text(200), code: text(2000) }).parse(req.query);
    assert(
      typeof req.cookies?.im_oauth === 'string' && safeEqual(input.state, req.cookies.im_oauth),
      400,
      'OAUTH_STATE',
      'Invalid OAuth state',
    );
    const one = await OneTimeToken.findOneAndDelete({
      hash: hash(input.state),
      kind: 'oauth',
      expiresAt: { $gt: new Date() },
    });
    assert(one?.payload, 400, 'OAUTH_STATE', 'OAuth session expired');
    const data = JSON.parse(decrypt(one.payload, rt.config.ENCRYPTION_KEY)) as {
      verifier: string;
      nonce: string;
    };
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        client_id: rt.config.GOOGLE_CLIENT_ID!,
        client_secret: rt.config.GOOGLE_CLIENT_SECRET!,
        code: input.code,
        code_verifier: data.verifier,
        redirect_uri: `${rt.config.API_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    assert(response.ok, 401, 'OAUTH_FAILED', 'Google login failed');
    const result = (await response.json()) as { id_token: string };
    const { payload } = await jwtVerify(result.id_token, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: rt.config.GOOGLE_CLIENT_ID,
      algorithms: ['RS256'],
    });
    assert(
      payload.nonce === data.nonce &&
        payload.email_verified === true &&
        typeof payload.email === 'string' &&
        payload.sub,
      401,
      'OAUTH_FAILED',
      'Google identity could not be verified',
    );
    let user = await User.findOne({ googleSub: payload.sub });
    if (!user) {
      assert(
        !(await User.exists({ email: payload.email.toLowerCase() })),
        409,
        'ACCOUNT_EXISTS',
        'Use your existing account login; automatic account linking is disabled',
      );
      user = await User.create({
        email: payload.email.toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name.slice(0, 100) : payload.email,
        googleSub: payload.sub,
        verified: true,
      });
    }
    // MFA users finish a challenge using this short-lived, single-use login ticket.
    const ticket = token();
    await OneTimeToken.create({
      hash: hash(ticket),
      userId: user._id,
      kind: 'oauth',
      expiresAt: new Date(Date.now() + 120000),
    });
    res.clearCookie('im_oauth', { ...cookieOptions(rt), path: '/api/auth/google/callback' });
    res.redirect(`${rt.config.APP_URL}/auth/callback#ticket=${ticket}`);
  });
  router.post('/google/complete', async (req, res) => {
    const input = body(z.object({ ticket: text(200), code: text(100).optional() }).strict(), req);
    const one = await OneTimeToken.findOne({
      hash: hash(input.ticket),
      kind: 'oauth',
      expiresAt: { $gt: new Date() },
    });
    assert(one?.userId, 401, 'OAUTH_FAILED', 'Login ticket expired');
    const user = await User.findById(one.userId);
    assert(user, 401, 'OAUTH_FAILED', 'User unavailable');
    if (user.mfaEnabled) await validateMfa(rt, user, input.code);
    const used = await OneTimeToken.findOneAndDelete({ _id: one._id });
    assert(used, 401, 'OAUTH_FAILED', 'Ticket already used');
    res.json({
      ...(await createSession(rt, req, res, user._id, user.mfaEnabled, user.securityVersion)),
      user: publicUser(user),
    });
  });
  return router;
}
