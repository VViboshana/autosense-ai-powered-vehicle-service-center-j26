import { Router } from 'express';
import { checkDatabase } from '../db/pool.js';

const router = Router();

// GET /api/health — is the API up, and can it reach PostgreSQL?
router.get('/', async (req, res) => {
  const database = await checkDatabase();
  res.json({ status: 'ok', database, time: new Date().toISOString() });
});

export default router;
