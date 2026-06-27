import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { emailQueue } from '../config/queue';

const router = express.Router();
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Set up file storage for resume uploads (saved to root 'resume' folder)
const uploadDir = path.join(__dirname, '..', '..', '..', 'resume');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// 1. Upload and process application
router.post('/', upload.single('resume'), async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      title,
      company,
      jobDescriptionText,
      email,
      jobPostingDate,
      deadline,
      jobLink,
      referralName,
      referralEmail
    } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Resume file is required' });
    }

    if (!jobDescriptionText) {
      return res.status(400).json({ error: 'Job description text is required' });
    }

    // Find or create user
    const userEmail = email || 'guest@jobwingman.local';
    let user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: userEmail,
          name: 'Guest User'
        }
      });
    }

    // Call Python ML microservice to evaluate the resume file using multipart/form-data
    const mlFormData = new FormData();
    const fileBuffer = fs.readFileSync(file.path);
    const blob = new Blob([fileBuffer], { type: file.mimetype });
    mlFormData.append('file', blob, file.originalname);
    mlFormData.append('position', title || 'Untitled Position');
    mlFormData.append('company', company || 'Unknown Company');
    mlFormData.append('job_description', jobDescriptionText);
    mlFormData.append('job_posting_date', jobPostingDate || new Date().toISOString());
    if (deadline) {
      mlFormData.append('deadline', deadline);
    }
    if (referralName) {
      mlFormData.append('referral_name', referralName);
    }
    if (referralEmail) {
      mlFormData.append('referral_email', referralEmail);
    }

    let evaluationData: any;
    try {
      const evaluateResponse = await fetch(`${ML_SERVICE_URL}/api/v1/evaluate`, {
        method: 'POST',
        body: mlFormData
      });
      if (!evaluateResponse.ok) {
        throw new Error(`ML service evaluate returned status ${evaluateResponse.status}`);
      }
      evaluationData = await evaluateResponse.json();
    } catch (err) {
      console.error('Failed to connect to ML service evaluator:', err);
      evaluationData = {
        markdown: '# John Doe\nSoftware Engineer',
        extracted_profile: {
          name: 'John Doe',
          email: 'guest@jobwingman.local',
          phone: '',
          summary: ['Software Engineer'],
          education: [],
          experience: [],
          skills: []
        },
        evaluation_metrics: {
          match_score: 65.0,
          summary_analysis: 'Fallback evaluation due to service error',
          missing_keywords: [],
          tailoring_recommendations: [],
          suggestions: [
            {
              regionId: 'sec_experience',
              regionText: 'Experience section placeholder',
              type: 'EXPAND',
              content: 'Add details about Node.js and REST API architectures.',
              rationale: 'The JD requires Node.js Express backend expertise.'
            }
          ]
        }
      };
    }

    const matchScore = evaluationData.evaluation_metrics.match_score;
    const gatingFlag = matchScore < 70.0;

    // Persist Resume in database
    const resume = await prisma.resume.create({
      data: {
        filePath: file.path,
        parsedText: evaluationData.markdown || '',
        structuredData: evaluationData.extracted_profile || {
          name: '',
          email: '',
          phone: '',
          summary: '',
          education: [],
          experience: [],
          skills: []
        }
      }
    });

    // Persist Job Description
    const jobDescription = await prisma.jobDescription.create({
      data: {
        title: title || 'Untitled Position',
        company: company || 'Unknown Company',
        rawText: jobDescriptionText,
        postingDate: jobPostingDate ? new Date(jobPostingDate) : null,
        deadline: deadline ? new Date(deadline) : null,
        url: jobLink || null,
        referralName: referralName || null,
        referralEmail: referralEmail || null
      }
    });

    const application = await prisma.application.create({
      data: {
        userId: user.id,
        resumeId: resume.id,
        jobDescriptionId: jobDescription.id,
        matchScore: matchScore,
        gatingFlag: gatingFlag,
        status: 'DRAFT',
        suggestions: {
          create: evaluationData.evaluation_metrics.suggestions.map((s: any) => ({
            regionId: s.regionId,
            regionText: s.regionText,
            type: s.type,
            content: s.content,
            rationale: s.rationale
          }))
        }
      },
      include: {
        suggestions: true,
        resume: true,
        jobDescription: true
      }
    });

    return res.status(201).json(application);
  } catch (error: any) {
    console.error('Error creating application:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 2. Get list of applications
router.get('/', async (req: Request, res: Response) => {
  try {
    const applications = await prisma.application.findMany({
      include: {
        resume: true,
        jobDescription: true,
        suggestions: true,
        emailDrafts: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(applications);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 3. Get application by ID
router.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const application = await prisma.application.findUnique({
      where: { id },
      include: {
        resume: true,
        jobDescription: true,
        suggestions: true,
        emailDrafts: true
      }
    });
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    return res.json(application);
  } catch (error: any) {
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 4. Gate enforcement on Apply transition
router.post('/:id/apply', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { bypassGate } = req.body;

    const application = await prisma.application.findUnique({
      where: { id },
      include: { suggestions: true }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (application.gatingFlag && !bypassGate) {
      return res.status(403).json({
        error: 'Application gated due to low match score (< 70%). Please review suggestions or request bypass.',
        matchScore: application.matchScore,
        suggestions: (application as any).suggestions
      });
    }

    const updatedApp = await prisma.application.update({
      where: { id },
      data: {
        status: 'APPLIED',
        appliedAt: new Date()
      }
    });

    // Schedule Day-7 check in Redis using BullMQ (delay of 30 seconds for test/debug)
    await emailQueue.add(
      'DAY_7_CHECK',
      { applicationId: id },
      { delay: 30 * 1000 }
    );

    return res.json({ message: 'Application status marked as APPLIED', application: updatedApp });
  } catch (error: any) {
    console.error('Error marking application as applied:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 5. Get draft lists
router.get('/:id/email-drafts', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const drafts = await prisma.emailDraft.findMany({
      where: { applicationId: id }
    });
    return res.json(drafts);
  } catch (error: any) {
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 6. Compile structured resume into PDF using Typst
router.get('/:id/compile-pdf', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const application = await prisma.application.findUnique({
      where: { id },
      include: { resume: true }
    });

    if (!application || !(application as any).resume) {
      return res.status(404).json({ error: 'Application or resume not found' });
    }

    const structuredData = (application as any).resume.structuredData;
    if (!structuredData) {
      return res.status(400).json({ error: 'Resume structured JSON data is empty' });
    }

    const response = await fetch(`${ML_SERVICE_URL}/api/v1/compile-typst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(structuredData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(500).json({ error: 'Failed to compile Typst PDF', details: errorText });
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=resume_${id}.pdf`);
    return res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('Error compiling Typst resume:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// 7. Update application details
router.put('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { status, appliedAt, downloadedAt } = req.body;

    const application = await prisma.application.findUnique({
      where: { id }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const updatedData: any = {};
    if (status !== undefined) updatedData.status = status;
    if (appliedAt !== undefined) updatedData.appliedAt = appliedAt ? new Date(appliedAt) : null;
    if (downloadedAt !== undefined) updatedData.downloadedAt = downloadedAt ? new Date(downloadedAt) : null;

    const updatedApp = await prisma.application.update({
      where: { id },
      data: updatedData,
      include: {
        resume: true,
        jobDescription: true,
        suggestions: true,
        emailDrafts: true
      }
    });

    // If the application is updated to APPLIED, schedule the DAY_7_CHECK if not already scheduled
    if (status === 'APPLIED' && application.status !== 'APPLIED') {
      try {
        await emailQueue.add(
          'DAY_7_CHECK',
          { applicationId: id },
          { delay: 30 * 1000 } // delay for testing
        );
      } catch (queueErr) {
        console.error('Failed to add DAY_7_CHECK to queue:', queueErr);
      }
    }

    return res.json(updatedApp);
  } catch (error: any) {
    console.error('Error updating application:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default router;
