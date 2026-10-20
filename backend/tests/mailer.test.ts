import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../src/config.js';
const mocks = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn(), transport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.transport } }));
import { createMailer } from '../src/mailer.js';
import { verificationEmail } from '../src/emails.js';
const config = {
  NODE_ENV: 'development',
  SMTP_URL: 'smtp://127.0.0.1:1026',
  EMAIL_FROM: 'IntellMeet <sender@example.test>',
} as Config;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transport.mockReturnValue({ sendMail: mocks.send, close: mocks.close });
  mocks.send.mockImplementation(async (message) => ({ accepted: [message.to], rejected: [] }));
});

describe('recipient-specific SMTP delivery', () => {
  it('reports only allowlisted failure categories without provider credentials or message content', async () => {
    const report = vi.fn();
    mocks.send.mockRejectedValueOnce(
      Object.assign(new Error('private SMTP password'), { code: 'EAUTH' }),
    );
    await expect(
      createMailer(config, report).send('user@example.test', 'Verify', 'private OTP'),
    ).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE' });
    expect(report).toHaveBeenLastCalledWith('EAUTH');
    mocks.send.mockRejectedValueOnce({ code: 'private-password-in-untrusted-code' });
    await expect(
      createMailer(config, report).send('user@example.test', 'Verify', 'private OTP'),
    ).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE' });
    expect(report).toHaveBeenLastCalledWith('SMTP_ERROR');
  });
  it('sends each provider address to itself without a personal-recipient override', async () => {
    const mail = createMailer(config);
    for (const to of [
      'first@gmail.com',
      'second@outlook.com',
      'third@yahoo.com',
      'fourth@company.test',
    ]) {
      await mail.send(to, 'Verify', 'unique message', 'verification', '<p>Verify</p>');
    }
    expect(mocks.send.mock.calls.map(([message]) => message.to)).toEqual([
      'first@gmail.com',
      'second@outlook.com',
      'third@yahoo.com',
      'fourth@company.test',
    ]);
    for (const [message] of mocks.send.mock.calls) {
      expect(message.from).toBe(config.EMAIL_FROM);
      expect(message.cc).toBeUndefined();
      expect(message.bcc).toBeUndefined();
      expect(message.html).toBe('<p>Verify</p>');
      expect(message.text).toBe('unique message');
    }
    expect(mocks.transport).toHaveBeenCalledOnce();
  });
  it('does not claim delivery when SMTP is absent', async () => {
    await expect(
      createMailer({ ...config, SMTP_URL: undefined }).send('user@example.test', 'Verify', 'text'),
    ).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE', status: 503 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not expose provider details or silently fall back on error', async () => {
    mocks.send.mockRejectedValue(new Error('private credentials and token details'));
    await expect(createMailer(config).send('user@example.test', 'Verify', 'text')).rejects.toThrow(
      'Email could not be delivered',
    );
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('rejects a resolved SMTP response if the intended recipient was not accepted', async () => {
    mocks.send.mockResolvedValue({ accepted: [], rejected: ['user@example.test'] });
    await expect(
      createMailer(config).send('user@example.test', 'Verify', 'text'),
    ).rejects.toMatchObject({ code: 'MAIL_UNAVAILABLE' });
  });
  it('requires TLS in production and keeps transport debugging off', () => {
    const mail = createMailer({ ...config, NODE_ENV: 'production' });
    expect(mocks.transport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        ignoreTLS: false,
        tls: { rejectUnauthorized: true },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    mail.close();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});

describe('branded verification email', () => {
  it('includes a six-digit code with its shorter expiry and attempt limit', () => {
    const message = verificationEmail(
      'https://meet.example.test',
      'unit-email-token',
      'Alex',
      '012345',
    );
    expect(message.text).toContain('verification code: 012345');
    expect(message.html).toContain('012345');
    expect(message.text).toContain('10 minutes');
    expect(message.text).toContain('5 attempts');
  });
  it('builds HTTPS links from APP_URL and includes plain text, expiry and an accessible action', () => {
    const message = verificationEmail('https://meet.example.test', 'unit-email-token', 'Alex');
    expect(message.html).toContain('Verify Email Address');
    expect(message.html).toContain('IntellMeet');
    expect(message.html).toContain('https://meet.example.test/verify-email#token=unit-email-token');
    expect(message.text).toContain('24 hours');
    expect(message.text).toContain('ignore this email');
    expect(message.html).not.toContain('localhost');
    expect(message.html).toContain('lang="en"');
  });
  it('escapes user names and URL attributes without altering the plain-text link', () => {
    const message = verificationEmail(
      'https://meet.example.test',
      'unit-email-token',
      '<img src=x onerror="evil()">',
    );
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
    expect(message.html).not.toContain('onerror="evil()"');
    expect(message.text).toContain('#token=unit-email-token');
  });
});
