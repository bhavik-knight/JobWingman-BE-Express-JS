import express, { Request, Response } from 'express';
import prisma from '../config/prisma';

const router = express.Router();

// Update resume structured JSON data
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { structuredData } = req.body;

    const resume = await prisma.resume.update({
      where: { id },
      data: { structuredData }
    });

    res.json(resume);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default router;
