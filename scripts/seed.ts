import { readConfig } from '../src/config.js';
import {
  connectDatabase,
  ensureIndexes,
  mongoose,
  User,
  Workspace,
  Membership,
  Project,
  Task,
} from '../src/db.js';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
const config = readConfig();
if (config.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
await connectDatabase(config.MONGODB_URI);
await ensureIndexes();
try {
  const email = process.env.SEED_EMAIL ?? 'demo@intellmeet.local';
  if (await User.exists({ email })) {
    console.log('Demo user already exists; no changes made.');
  } else {
    const password = randomBytes(18).toString('base64url');
    const user = await User.create({
      email,
      name: 'Demo Owner',
      verified: true,
      passwordHash: await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
    });
    const workspace = await Workspace.create({ name: 'IntellMeet Demo', ownerId: user._id });
    await Membership.create({ userId: user._id, workspaceId: workspace._id, role: 'owner' });
    const project = await Project.create({
      name: 'Product launch',
      workspaceId: workspace._id,
      createdBy: user._id,
    });
    await Task.create({
      title: 'Review the launch agenda',
      workspaceId: workspace._id,
      projectId: project._id,
      createdBy: user._id,
      assigneeId: user._id,
    });
    console.log(
      `Synthetic demo created. Email: ${email}\nOne-time displayed password: ${password}\nStore securely; no production credentials were created.`,
    );
  }
} finally {
  await mongoose.disconnect();
}
