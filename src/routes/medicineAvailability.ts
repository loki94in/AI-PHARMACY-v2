import express from 'express';
import { medicineAvailabilityEngine } from '../services/medicineAvailabilityEngine.js';
import { recalculateStockLimits } from '../worker/stockCalculatorWorker.js';
import { precomputeSubstitutes } from '../worker/substituteCacheWorker.js';

const router = express.Router();

router.get('/medicines/availability', async (req, res) => {
  try {
    const query = (req.query.query as string) || '';
    const mode = (req.query.mode as 'POS' | 'CATALOG' | 'EMERGENCY' | 'TELEGRAM') || 'POS';
    const includeOutOfStock = req.query.includeOutOfStock === 'true';
    const limit = parseInt(req.query.limit as string) || 20;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const result = await medicineAvailabilityEngine.getAvailableMedicinesOrAlternatives(query, {
      mode,
      includeOutOfStock,
      limit
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error in availability endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/medicines/search-full', async (req, res) => {
  try {
    const query = (req.query.query as string) || '';
    const mode = (req.query.mode as 'POS' | 'CATALOG' | 'EMERGENCY' | 'TELEGRAM') || 'POS';
    const includeOutOfStock = req.query.includeOutOfStock === 'true';
    const category = req.query.category as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const result = await medicineAvailabilityEngine.getAvailableMedicinesOrAlternatives(query, {
      mode,
      includeOutOfStock,
      category,
      limit
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error in search-full endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/medicines/substitutes/:medicineId', async (req, res) => {
  try {
    const medicineId = parseInt(req.params.medicineId);
    if (isNaN(medicineId)) {
      return res.status(400).json({ error: 'Invalid medicine ID' });
    }

    const mode = (req.query.mode as 'POS' | 'CATALOG' | 'EMERGENCY' | 'TELEGRAM') || 'CATALOG';
    const maxDistance = parseInt(req.query.maxDistance as string) || 10;

    const substitutes = await medicineAvailabilityEngine.getSubstitutes(medicineId, {
      mode,
      maxDistance
    });

    res.json({ medicineId, substitutes });
  } catch (error: any) {
    console.error('Error in substitutes endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/medicines/emergency-stock', async (req, res) => {
  try {
    const categories = (req.query.categories as string)?.split(',') || [
      'Injured soldiers medicaments',
      'Critical trauma medications',
      'Allergy rescue medications'
    ];

    const stock = await medicineAvailabilityEngine.getEmergencyStock(categories);
    res.json({ categories, stock });
  } catch (error: any) {
    console.error('Error in emergency-stock endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/medicines/learn-correction', async (req, res) => {
  try {
    const { originalQuery, correctedMedicineId, context } = req.body;

    if (!originalQuery || !correctedMedicineId) {
      return res.status(400).json({ error: 'originalQuery and correctedMedicineId are required' });
    }

    await medicineAvailabilityEngine.learnCorrection(
      originalQuery,
      correctedMedicineId,
      context
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error in learn-correction endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/medicines/recalculate-stock', async (req, res) => {
  try {
    await recalculateStockLimits();
    medicineAvailabilityEngine.refreshStockCache();
    res.json({ success: true, message: 'Stock limits recalculated' });
  } catch (error: any) {
    console.error('Error recalculating stock:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/medicines/rebuild-substitutes', async (req, res) => {
  try {
    await precomputeSubstitutes();
    res.json({ success: true, message: 'Substitutes rebuilt' });
  } catch (error: any) {
    console.error('Error rebuilding substitutes:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
