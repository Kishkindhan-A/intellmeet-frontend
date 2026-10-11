import nodemailer from 'nodemailer';
import type { Config } from './config.js';
import type { Mailer } from './ports.js';
import { assert } from './lib.js';

export function createMailer(config: Config): Mailer & { close(): void } {
  const local = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  const verification =
    config.RESEND_VERIFICATION_API_KEY && config.RESEND_TEST_RECIPIENT
      ? nodemailer.createTransport({
          host: 'smtp.resend.com',
          port: 465,
          secure: true,
          auth: { user: 'resend', pass: config.RESEND_VERIFICATION_API_KEY },
          connectionTimeout: 10000,
          socketTimeout: 20000,
        })
      : null;
  return {
    close() {
      local?.close();
      verification?.close();
    },
    async send(to, subject, text, purpose) {
      // Resend's domain-free sender permits only the account owner's address.
      // Never redirect another user's verification token to that owner.
      if (
        verification &&
        purpose === 'verification' &&
        to.toLowerCase() === config.RESEND_TEST_RECIPIENT!.toLowerCase()
      ) {
        try {
          await verification.sendMail({
            from: 'IntellMeet <onboarding@resend.dev>',
            to,
            subject,
            text,
          });
        } catch {
          // Provider errors may contain credential or message details.
          assert(
            false,
            503,
            'MAIL_UNAVAILABLE',
            'Verification email could not be delivered. Check the email service configuration.',
          );
        }
        return;
      }
      assert(local, 503, 'MAIL_UNAVAILABLE', 'Email delivery is not configured');
      await local.sendMail({ from: config.EMAIL_FROM, to, subject, text });
    },
  };
}
