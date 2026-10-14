import { Router } from 'express';
import { readFile } from 'node:fs/promises';

const router = Router();
const contentUrl = new URL('../../../api/homeContent.json', import.meta.url);

// GET /api/home — home page content.
// Today it returns the same static JSON the client uses.
// Later: build this object from PostgreSQL (components, bays, alerts) with the SAME shape.
router.get('/', async (req, res, next) => {
  try {
    const content = JSON.parse(await readFile(contentUrl, 'utf8'));
    res.json(content);
  } catch (err) {
    next(err);
  }
});

export default router;
