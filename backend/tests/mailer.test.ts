import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../src/config.js';
const mocks = vi.hoisted(() => ({ local: vi.fn(), resend: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: unknown) => ({
      sendMail: typeof options === 'string' ? mocks.local : mocks.resend,
      close: vi.fn(),
    }),
  },
}));
import { createMailer } from '../src/mailer.js';
const config = {
  SMTP_URL: 'smtp://127.0.0.1:1026',
  EMAIL_FROM: 'Local <local@example.test>',
  RESEND_VERIFICATION_API_KEY: 'test-only-placeholder',
  RESEND_TEST_RECIPIENT: 'owner@example.test',
} as Config;
beforeEach(() => {
  vi.resetAllMocks();
});
describe('verification-only Resend routing', () => {
  it('sends verification only to the configured account address', async () => {
    await createMailer(config).send(
      'owner@example.test',
      'Verify',
      'token-content',
      'verification',
    );
    expect(mocks.resend).toHaveBeenCalledWith({
      from: 'IntellMeet <onboarding@resend.dev>',
      to: 'owner@example.test',
      subject: 'Verify',
      text: 'token-content',
    });
    expect(mocks.local).not.toHaveBeenCalled();
  });
  it('keeps other recipients and password resets local without redirecting tokens', async () => {
    const mail = createMailer(config);
    await mail.send('other@example.test', 'Verify', 'other-token', 'verification');
    await mail.send('owner@example.test', 'Reset', 'reset-token');
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.local).toHaveBeenCalledTimes(2);
    expect(mocks.local.mock.calls[0][0].to).toBe('other@example.test');
  });
  it('retains local delivery when no API key is configured', async () => {
    await createMailer({ ...config, RESEND_VERIFICATION_API_KEY: undefined }).send(
      'owner@example.test',
      'Verify',
      'token',
      'verification',
    );
    expect(mocks.resend).not.toHaveBeenCalled();
    expect(mocks.local).toHaveBeenCalledOnce();
  });
  it('does not expose provider details or silently fall back after delivery failure', async () => {
    mocks.resend.mockRejectedValue(new Error('private provider details'));
    await expect(
      createMailer(config).send('owner@example.test', 'Verify', 'token', 'verification'),
    ).rejects.toThrow('Verification email could not be delivered');
    expect(mocks.local).not.toHaveBeenCalled();
  });
});
