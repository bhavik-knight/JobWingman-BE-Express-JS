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
    const { title, company, jobDescriptionText, email } = req.body;
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

    // Call Python ML microservice to parse the resume file
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(file.path);
    const blob = new Blob([fileBuffer], { type: file.mimetype });
    formData.append('file', blob, file.originalname);

    let parsedResumeData: any;
    try {
      const parseResponse = await fetch(`${ML_SERVICE_URL}/api/v1/parse`, {
        method: 'POST',
        body: formData
      });
      if (!parseResponse.ok) {
        throw new Error(`ML service parse returned status ${parseResponse.status}`);
      }
      parsedResumeData = await parseResponse.json();
    } catch (err) {
      console.error('Failed to connect to ML service parser:', err);
      parsedResumeData = {
        rawText: 'John Doe - Resume mock content',
        markdown: '# John Doe\nSoftware Engineer',
        sections: []
      };
    }

    let evaluationData: any;
    try {
      const evaluateResponse = await fetch(`${ML_SERVICE_URL}/api/v1/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parsedResume: parsedResumeData,
          jobDescription: jobDescriptionText
        })
      });
      if (!evaluateResponse.ok) {
        throw new Error(`ML service evaluate returned status ${evaluateResponse.status}`);
      }
      evaluationData = await evaluateResponse.json();
    } catch (err) {
      console.error('Failed to connect to ML service evaluator:', err);
      evaluationData = {
        score: 65.0,
        confidence: 0.9,
        suggestions: [
          {
            regionId: 'sec_experience',
            regionText: 'Experience section placeholder',
            type: 'EXPAND',
            content: 'Add details about Node.js and REST API architectures.',
            rationale: 'The JD requires Node.js Express backend expertise.'
          }
        ]
      };
    }

    const matchScore = evaluationData.score;
    if (matchScore < 70.0) {
      // Clean up local file upload to avoid orphans
      if (file && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkErr) {
          console.error('Failed to clean up uploaded file:', unlinkErr);
        }
      }
      return res.status(422).json({
        error: 'Application tracking blocked due to low match score (< 70%).',
        matchScore: matchScore,
        suggestions: evaluationData.suggestions
      });
    }

    // Persist Resume in database
    const resume = await prisma.resume.create({
      data: {
        filePath: file.path,
        parsedText: parsedResumeData.markdown || parsedResumeData.rawText || '',
        structuredData: parsedResumeData.structured || {
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
        rawText: jobDescriptionText
      }
    });

    const gatingFlag = false; // Never gated because we enforce score >= 70

    const application = await prisma.application.create({
      data: {
        userId: user.id,
        resumeId: resume.id,
        jobDescriptionId: jobDescription.id,
        matchScore: matchScore,
        gatingFlag: gatingFlag,
        status: 'DRAFT',
        suggestions: {
          create: evaluationData.suggestions.map((s: any) => ({
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
        suggestions: true
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

export default router;
