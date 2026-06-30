import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import prisma from './config/prisma';
import applicationRouter from './routes/applications';
import resumeRouter from './routes/resumes';
import emailDraftRouter from './routes/emailDrafts';
import { startScheduler } from './workers/scheduler';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Mount modular routes
app.use('/api/applications', applicationRouter);
app.use('/api/resumes', resumeRouter);
app.use('/api/email-drafts', emailDraftRouter);

// Health check endpoint
app.get('/health', async (req: Request, res: Response): Promise<any> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ok', database: 'connected', service: 'jobwingman-api' });
  } catch (error: any) {
    return res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// Start background scheduler
startScheduler();

app.listen(PORT, () => {
  console.log(`Express Backend running on port ${PORT} in TypeScript mode`);
});
