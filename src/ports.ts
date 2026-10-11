import type { Config } from './config.js';
import type { Logger } from 'pino';
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}
export interface Storage {
  uploadUrl(key: string, contentType: string, size: number): Promise<string>;
  downloadUrl(key: string): Promise<string>;
  inspect(
    key: string,
  ): Promise<{ size: number; contentType: string; prefix: Buffer; etag: string }>;
  seal(key: string, destination: string, etag: string): Promise<void>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export interface Media {
  configured: boolean;
  issue(room: string, identity: string, name: string, publish: boolean): Promise<string>;
  remove(room: string, identity: string): Promise<void>;
  close(room: string): Promise<void>;
  publish(room: string, identity: string, enabled: boolean): Promise<void>;
  startRecording(room: string, key: string): Promise<string>;
  stopRecording(id: string): Promise<void>;
  recordings(room: string): Promise<Array<{ id: string; status: number; key?: string }>>;
  verifyWebhook(
    body: string,
    authorization: string,
  ): Promise<{
    id: string;
    event: string;
    room?: { name: string };
    participant?: { identity: string; kind?: number };
    egressInfo?: {
      egressId: string;
      status: number;
      fileResults: Array<{ filename: string; size: bigint }>;
    };
  }>;
}
export interface SummaryResult {
  overview: string;
  decisions: string[];
  actions: Array<{
    title: string;
    assigneeId: string | null;
    dueDate: string | null;
    evidence: string[];
  }>;
}
export interface AI {
  configured: boolean;
  transcribe(buffer: Buffer, contentType: string): Promise<string>;
  summarize(
    segments: Array<{ id: string; text: string; speakerId?: string }>,
    people: Array<{ id: string; name: string }>,
  ): Promise<SummaryResult>;
}
export interface Coordinator {
  consume(key: string, limit: number, seconds: number): Promise<boolean>;
  lock<T>(key: string, action: () => Promise<T>): Promise<T>;
  enqueue(id: string): Promise<void>;
  healthy(): Promise<boolean>;
}
export interface Events {
  emit(room: string, event: string, payload: unknown): void;
  revokeUser(userId: string): Promise<void>;
  revokeWorkspace(userId: string, workspaceId: string): Promise<void>;
  revokeMeeting(userId: string, meetingId: string): Promise<void>;
}
export interface Runtime {
  config: Config;
  logger: Logger;
  mail: Mailer;
  storage: Storage;
  media: Media;
  ai: AI;
  coordinator: Coordinator;
  events: Events;
}
