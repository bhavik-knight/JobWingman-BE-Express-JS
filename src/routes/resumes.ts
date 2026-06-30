import express, { Request, Response } from 'express';
import prisma from '../config/prisma';

const router = express.Router();

// Update resume structured JSON and/or raw parsed text
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { structuredData, parsedText } = req.body;

    const updateData: any = {};
    if (structuredData !== undefined) updateData.structuredData = structuredData;
    if (parsedText !== undefined) updateData.parsedText = parsedText;

    const resume = await prisma.resume.update({
      where: { id },
      data: updateData
    });

    res.json(resume);
  } catch (error: any) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default router;
