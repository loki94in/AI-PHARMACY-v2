// Triggers & Automations API
import express from 'express';
import { triggerSchedulerService } from '../services/triggerSchedulerService.js';

const router = express.Router();

// GET /api/triggers/upcoming - Get upcoming automations within lookahead minutes (default 5 min)
router.get('/upcoming', async (req, res) => {
  try {
    const lookaheadMinutes = parseInt((req.query.lookahead as string) || '5', 10);
    const upcoming = await triggerSchedulerService.getUpcomingTriggers(lookaheadMinutes);
    res.json({ success: true, upcoming });
  } catch (err: any) {
    console.error('Error fetching upcoming triggers:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch upcoming triggers' });
  }
});

// POST /api/triggers/run-now - Trigger an upcoming task immediately
router.post('/run-now', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Trigger ID is required' });
    }
    const result = await triggerSchedulerService.runTriggerNow(id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err: any) {
    console.error('Error running trigger now:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to execute trigger' });
  }
});

// POST /api/triggers/snooze - Snooze an upcoming trigger for specified minutes (default 10 min)
router.post('/snooze', async (req, res) => {
  try {
    const { id, minutes } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Trigger ID is required' });
    }
    const result = triggerSchedulerService.snoozeTrigger(id, minutes ? parseInt(minutes, 10) : 10);
    res.json(result);
  } catch (err: any) {
    console.error('Error snoozing trigger:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to snooze trigger' });
  }
});

export default router;
