import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('🚀 Seeding precise 2026 follow-up scenarios...');
  const { prisma } = await import('./config/prisma');

  // Ensure guest user exists
  const guestEmail = 'guest@jobwingman.local';
  let user = await prisma.user.findUnique({
    where: { email: guestEmail }
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: guestEmail,
        name: 'Guest User'
      }
    });
  }

  // Ensure a dummy resume exists
  let resume = await prisma.resume.findFirst({
    where: { filePath: '/dummy/resume.pdf' }
  });
  if (!resume) {
    resume = await prisma.resume.create({
      data: {
        filePath: '/dummy/resume.pdf',
        parsedText: '',
        structuredData: { skills: [] }
      }
    });
  }

  // Scenario 1: Saved Application from 7 days ago (June 23, 2026)
  const sevenDaysAgo = new Date('2026-06-23T12:00:00Z');
  
  const jd1 = await prisma.jobDescription.create({
    data: {
      title: 'Senior Data Analyst',
      company: 'TechCorp Solutions',
      rawText: 'Looking for a Senior Data Analyst proficient in SQL, Python, and data pipelines...',
      url: 'https://techcorp.jobs/analytics-101',
      createdAt: sevenDaysAgo,
      updatedAt: sevenDaysAgo
    }
  });

  await prisma.application.create({
    data: {
      userId: user.id,
      resumeId: resume.id,
      jobDescriptionId: jd1.id,
      status: 'APPLIED',
      matchScore: 78.5,
      gatingFlag: false,
      createdAt: sevenDaysAgo,
      updatedAt: sevenDaysAgo
    }
  });

  // Scenario 2: Draft Application with deadline set for TONIGHT (June 30, 2026)
  const todayDeadline = new Date('2026-06-30T23:59:59Z');
  const today = new Date('2026-06-30T12:00:00Z');

  const jd2 = await prisma.jobDescription.create({
    data: {
      title: 'Machine Learning Engineer',
      company: 'Apex AI Labs',
      rawText: 'Join our model optimization branch. Experience with PyTorch and Transformers preferred...',
      url: 'https://apexai.labs/careers/mle',
      deadline: todayDeadline,
      createdAt: today,
      updatedAt: today
    }
  });

  await prisma.application.create({
    data: {
      userId: user.id,
      resumeId: resume.id,
      jobDescriptionId: jd2.id,
      status: 'DRAFT',
      matchScore: 82.0,
      gatingFlag: false,
      createdAt: today,
      updatedAt: today
    }
  });

  console.log('✅ Seeding complete! 1 Saved (7 days old) and 1 Draft (Deadline Today) are now live.');
}

main()
  .catch(async (e) => {
    console.error('❌ Error seeding records:', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const { prisma } = await import('./config/prisma');
      await prisma.$disconnect();
    } catch (e) {}
  });
