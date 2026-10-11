// Checks only the explicitly selected local services; never reads cloud .env credentials.
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RoomServiceClient, AccessToken, TokenVerifier } from 'livekit-server-sdk';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import nodemailer from 'nodemailer';

const directory = '.data/local-run';
const running = JSON.parse(await readFile(`${directory}/running.json`, 'utf8'));
if (!running.services) throw new Error('Start npm run local:services first.');
const credentials = JSON.parse(await readFile(`${directory}/credentials.json`, 'utf8'));
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`${name}: PASS`);
  } catch (error) {
    results.push({ name, passed: false, errorType: error.name });
    console.log(`${name}: FAIL (${error.name})`);
    process.exitCode = 1;
  }
}
const redis = new Redis(`redis://:${credentials.redis}@127.0.0.1:6380`, {
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', () => {});
const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: credentials.storageKey, secretAccessKey: credentials.storageSecret },
  maxAttempts: 1,
});
const transport = nodemailer.createTransport('smtp://127.0.0.1:1026');
try {
  await check('API readiness', async () => {
    const response = await fetch('http://127.0.0.1:4000/health/ready', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('NotReady');
  });
  await check('Redis authentication and worker heartbeat', async () => {
    if ((await redis.ping()) !== 'PONG') throw new Error('Ping');
    const heartbeat = Number(await redis.get('intellmeet:worker:heartbeat'));
    if (!heartbeat || Date.now() - heartbeat > 120000) throw new Error('WorkerNotReady');
  });
  await check('LiveKit authenticated room API and signed participant token', async () => {
    const rooms = new RoomServiceClient(
      'http://127.0.0.1:7880',
      credentials.livekitKey,
      credentials.livekitSecret,
    );
    const name = `local-check-${randomUUID()}`;
    await rooms.createRoom({ name, emptyTimeout: 60, maxParticipants: 2 });
    if (!(await rooms.listRooms([name])).some((room) => room.name === name))
      throw new Error('RoomMissing');
    const token = new AccessToken(credentials.livekitKey, credentials.livekitSecret, {
      identity: 'local-check',
      ttl: 60,
    });
    token.addGrant({ roomJoin: true, room: name, canPublish: true, canSubscribe: true });
    const claims = await new TokenVerifier(
      credentials.livekitKey,
      credentials.livekitSecret,
    ).verify(await token.toJwt());
    if (claims.video?.room !== name) throw new Error('InvalidToken');
  });
  await check('S3 presigned upload, inspection, conditional seal and download', async () => {
    const Bucket = 'intellmeet';
    const Key = `local-check/${randomUUID()}.txt`;
    const Body = 'IntellMeet local storage integration test';
    const put = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket,
        Key,
        ContentType: 'text/plain',
        ContentLength: Buffer.byteLength(Body),
      }),
      { expiresIn: 60 },
    );
    if (
      !(
        await fetch(put, {
          method: 'PUT',
          body: Body,
          headers: { 'Content-Type': 'text/plain' },
          signal: AbortSignal.timeout(10000),
        })
      ).ok
    )
      throw new Error('Upload');
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
    if (head.ContentLength !== Buffer.byteLength(Body)) throw new Error('Size');
    const sealed = `${Key}.sealed`;
    await s3.send(
      new CopyObjectCommand({
        Bucket,
        Key: sealed,
        CopySource: `${Bucket}/${Key}`,
        CopySourceIfMatch: head.ETag,
      }),
    );
    const get = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: sealed }), {
      expiresIn: 60,
    });
    if ((await (await fetch(get, { signal: AbortSignal.timeout(10000) })).text()) !== Body)
      throw new Error('Download');
    const anonymous = await fetch(`http://127.0.0.1:9000/${Bucket}/${sealed}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (anonymous.ok) throw new Error('AnonymousAccess');
  });
  await check('SMTP delivery captured locally', async () => {
    await transport.verify();
    const subject = `IntellMeet local check ${randomUUID()}`;
    await transport.sendMail({
      from: 'IntellMeet Local <no-reply@example.test>',
      to: 'local-check@example.test',
      subject,
      text: 'Local test message. No external delivery.',
    });
    const response = await fetch(
      `http://127.0.0.1:8026/api/v1/search?query=${encodeURIComponent(subject)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    const inbox = await response.json();
    if (!inbox.messages?.some((message) => message.Subject === subject))
      throw new Error('MessageMissing');
  });
} finally {
  redis.disconnect();
  s3.destroy();
  transport.close();
  await writeFile(
    `${directory}/services-report.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        results,
        limitations: [
          'No browser WebRTC media exchange verified',
          'Recording egress not configured',
          'OpenAI and Google OAuth disabled',
        ],
        retained: 'Local test objects and captured messages retained.',
      },
      null,
      2,
    ),
  );
}
