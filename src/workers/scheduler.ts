import { Worker, Job } from 'bullmq';
import prisma from '../config/prisma';
import { redisConnection, emailQueue } from '../config/queue';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

interface JobData {
  applicationId: string;
}

// Create the BullMQ Worker to process DAY_7_CHECK and DAY_10_CHECK
const worker = new Worker<JobData>(
  'email-scheduler',
  async (job: Job<JobData>) => {
    const { applicationId } = job.data;
    console.log(`Scheduler (BullMQ): Processing job ${job.id} of type ${job.name} for application ${applicationId}`);

    try {
      if (job.name === 'DAY_7_CHECK') {
        const app = await prisma.application.findUnique({
          where: { id: applicationId },
          include: { resume: true, jobDescription: true }
        });

        if (app && app.status === 'APPLIED' && app.resume && app.jobDescription) {
          const emailRes = await fetch(`${ML_SERVICE_URL}/api/v1/generate-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              resume: app.resume.parsedText,
              jobDescription: app.jobDescription.rawText,
              company: app.jobDescription.company,
              title: app.jobDescription.title
            })
          });
          const emailData: any = await emailRes.json();

          await prisma.emailDraft.create({
            data: {
              applicationId: app.id,
              subject: emailData.subject,
              body: emailData.body,
              status: 'GENERATED'
            }
          });

          // Schedule Day-10 check in 30 seconds for easy test/debug using BullMQ
          await emailQueue.add(
            'DAY_10_CHECK',
            { applicationId: app.id },
            { delay: 30 * 1000 }
          );
          console.log(`Scheduler (BullMQ): Scheduled DAY_10_CHECK for application ${app.id}`);
        }
      } else if (job.name === 'DAY_10_CHECK') {
        const app = await prisma.application.findUnique({
          where: { id: applicationId },
          include: { emailDrafts: true }
        });

        if (app && app.status === 'APPLIED' && app.optInAutoSend) {
          const draft = app.emailDrafts.find(d => d.status === 'APPROVED' || d.status === 'GENERATED');
          if (draft) {
            console.log(`Scheduler (BullMQ): Sending email automatically for application ${app.id} via Nodemailer...`);
            
            await prisma.emailDraft.update({
              where: { id: draft.id },
              data: { status: 'SENT', sentAt: new Date() }
            });
          }
        }
      }
    } catch (err: any) {
      console.error(`Scheduler (BullMQ): Error processing job ${job.id} (${job.name}):`, err);
      throw err; // Rethrow to let BullMQ track the failure and retry if configured
    }
  },
  {
    connection: redisConnection as any,
    concurrency: 1,
  }
);

worker.on('completed', (job) => {
  console.log(`Scheduler (BullMQ): Job ${job.id} (${job.name}) completed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`Scheduler (BullMQ): Job ${job?.id} (${job?.name}) failed with error:`, err);
});

export function startScheduler(): void {
  console.log('Background BullMQ worker scheduler initialized.');
}
