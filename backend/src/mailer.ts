import nodemailer from 'nodemailer';
import type { Config } from './config.js';
import type { Mailer } from './ports.js';
import { assert, HttpError } from './lib.js';

export function createMailer(
  config: Config,
  reportFailure?: (code: string) => void,
): Mailer & { close(): void } {
  const smtp = config.SMTP_URL
    ? nodemailer.createTransport({
        url: config.SMTP_URL,
        connectionTimeout: 10000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        dnsTimeout: 5000,
        requireTLS: config.NODE_ENV === 'production',
        ignoreTLS: false,
        tls: { rejectUnauthorized: true },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : null;
  return {
    close() {
      smtp?.close();
    },
    async send(to, subject, text, _purpose, html) {
      assert(
        smtp,
        503,
        'MAIL_UNAVAILABLE',
        'Email delivery is not configured. Contact support or try again later.',
      );
      try {
        const result = await smtp.sendMail({
          from: config.EMAIL_FROM,
          to,
          subject,
          text,
          ...(html ? { html } : {}),
        });
        const accepted = result.accepted?.some(
          (address) => address.toLowerCase() === to.toLowerCase(),
        );
        assert(
          accepted && !result.rejected?.length,
          503,
          'MAIL_UNAVAILABLE',
          'Email could not be delivered. Try again later.',
        );
      } catch (error) {
        // Only allow known categories into diagnostics, never provider text or recipient data.
        const providerCode =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        const safeCodes = [
          'EAUTH',
          'ECONNECTION',
          'ESOCKET',
          'ETIMEDOUT',
          'EDNS',
          'ETLS',
          'EENVELOPE',
          'EMESSAGE',
        ];
        reportFailure?.(
          typeof providerCode === 'string' && safeCodes.includes(providerCode)
            ? providerCode
            : 'SMTP_ERROR',
        );
        throw new HttpError(
          503,
          'MAIL_UNAVAILABLE',
          'Email could not be delivered. Try again later.',
        );
      }
    },
  };
}
