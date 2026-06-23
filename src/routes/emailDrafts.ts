import express, { Request, Response } from 'express';
import prisma from '../config/prisma';

const router = express.Router();

// Update email draft status or content
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { subject, body, status, optInAutoSend } = req.body;

    const draft = await prisma.emailDraft.update({
      where: { id },
      data: {
        subject,
        body,
        status
      }
    });

    if (optInAutoSend !== undefined) {
      await prisma.application.update({
        where: { id: draft.applicationId },
        data: { optInAutoSend }
      });
    }

    res.json(draft);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default router;
