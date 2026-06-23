import { Queue } from 'bullmq';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// maxRetriesPerRequest: null is required for BullMQ to function correctly
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue('email-scheduler', {
  connection: redisConnection as any,
});
