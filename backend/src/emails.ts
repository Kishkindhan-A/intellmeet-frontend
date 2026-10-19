const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

export function verificationEmail(appUrl: string, rawToken: string, name: string, otp?: string) {
  const url = new URL('verify-email', appUrl.endsWith('/') ? appUrl : `${appUrl}/`);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  const link = url.toString();
  const safeLink = escapeHtml(link);
  const safeName = escapeHtml(name);
  return {
    subject: 'Verify your IntellMeet email',
    text: `Welcome to IntellMeet, ${name}!\n\n${otp ? `Your verification code: ${otp}\nEnter it on the verification page. This code expires in 10 minutes and allows at most 5 attempts. Never share it.\n\n` : ''}Alternatively, verify your email address by opening ${link}\n\nThis link expires in 24 hours and can be used once. If you did not create this account, ignore this email. No account can sign in until its email has been verified.\n\nIntellMeet — Less meeting. More meaning.`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify your IntellMeet email</title></head>
<body style="margin:0;padding:24px 12px;background:#f8f7f2;color:#253c32;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">Welcome to IntellMeet. Verify your email to start collaborating with your team.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffefa;border:1px solid #dee3d5;border-radius:16px">
<tr><td style="padding:28px 32px;background:#253c32;border-radius:15px 15px 0 0;color:#d8ed9a;font-size:23px;font-weight:bold">✳ IntellMeet</td></tr>
<tr><td style="padding:32px"><p style="font-size:12px;letter-spacing:2px;color:#65715e">YOUR TEAM’S NEXT CHAPTER</p>
<h1 style="font-size:28px;line-height:1.2;font-weight:normal;margin:16px 0">Welcome, ${safeName}.</h1>
${otp ? `<p style="font-size:16px;line-height:1.7">Enter this verification code in IntellMeet:</p><p style="font-size:36px;font-weight:bold;letter-spacing:8px;background:#eef2e3;padding:20px;border-radius:8px;text-align:center">${escapeHtml(otp)}</p><p style="font-size:14px;line-height:1.7">Your code expires in <strong>10 minutes</strong>. You have five attempts. Never share it.</p>` : ''}
<p style="font-size:16px;line-height:1.7">A little more connection. A lot more clarity. Confirm your email address to activate your IntellMeet account.</p>
<p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;background:#304b36;color:#ffffff;border-radius:8px;padding:16px 24px;font-size:16px;font-weight:bold;text-decoration:none">Verify Email Address ↗</a></p>
<p style="font-size:14px;line-height:1.7">This link expires in <strong>24 hours</strong> and can be used once. Only the account that requested it will be verified.</p>
<p style="font-size:13px;line-height:1.7;color:#65715e">If the button does not work, copy this link into your browser:<br><a href="${safeLink}" style="color:#304b36;word-break:break-all">${safeLink}</a></p>
<hr style="border:0;border-top:1px solid #dee3d5;margin:24px 0">
<p style="font-size:13px;line-height:1.7;color:#65715e">Didn’t create an account? You can safely ignore this email. Do not share this verification link with anyone.</p>
</td></tr></table><p style="font-size:12px;color:#65715e;line-height:1.7">IntellMeet · Less meeting. More meaning.</p>
</td></tr></table></body></html>`,
  };
}
