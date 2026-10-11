export interface Workspace {
  _id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  aiEnabled: boolean;
  retentionDays: number;
}
export interface Meeting {
  _id: string;
  title: string;
  description: string;
  hostId: string;
  startsAt: string;
  durationMinutes: number;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  processingMode: 'standard' | 'confidential';
  lobbyEnabled: boolean;
}
export interface Task {
  _id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: string;
  version: number;
  dueAt?: string;
  assigneeId?: string;
}
export interface Member {
  userId: string;
  role: string;
  user?: { _id: string; name: string; email: string };
}
export interface Participant {
  userId: string;
  status: string;
  recordingConsent: boolean;
  aiConsent: boolean;
}
export interface Message {
  _id: string;
  userId?: string;
  authorId?: string;
  text: string;
  createdAt: string;
  deletedAt?: string;
}
export interface Summary {
  overview: string;
  decisions: string[];
  actions: { id: string; title: string; evidence: string[] }[];
}
