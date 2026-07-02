import { detectDataModules, autoMapColumn, matchesFilters, runSimulation } from '../src/utils/preMigrationIntelligence.js';

describe('Pre-Migration Intelligence Tests', () => {
  describe('detectDataModules', () => {
    it('should detect inventory modules with high confidence', () => {
      const headers = ['medicine name', 'batch_no', 'expiry', 'quantity', 'mrp'];
      const modules = detectDataModules(headers);
      const inventoryModule = modules.find(m => m.type === 'inventory');
      expect(inventoryModule).toBeDefined();
      expect(inventoryModule!.confidence).toBeGreaterThan(0.5);
    });

    it('should detect sales modules with high confidence', () => {
      const headers = ['invoice_no', 'date', 'customer', 'doctor', 'total_amount'];
      const modules = detectDataModules(headers);
      const salesModule = modules.find(m => m.type === 'sales');
      expect(salesModule).toBeDefined();
      expect(salesModule!.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('autoMapColumn', () => {
    it('should correctly map common column variants', () => {
      expect(autoMapColumn('Medicine Name')).toBe('name');
      expect(autoMapColumn('qty')).toBe('quantity');
      expect(autoMapColumn('exp date')).toBe('expiry_date');
      expect(autoMapColumn('invoice number')).toBe('invoice_no');
    });
  });

  describe('matchesFilters', () => {
    it('should filter out inactive stock if onlyActiveStock is set', () => {
      const row = { 'Stock Qty': '0', 'Item Name': 'Aspirin' };
      const mapping = { 'Stock Qty': 'quantity', 'Item Name': 'name' };
      const filters = { onlyActiveStock: true };
      expect(matchesFilters(row, mapping, filters)).toBe(false);
    });

    it('should keep active stock if onlyActiveStock is set', () => {
      const row = { 'Stock Qty': '15', 'Item Name': 'Aspirin' };
      const mapping = { 'Stock Qty': 'quantity', 'Item Name': 'name' };
      const filters = { onlyActiveStock: true };
      expect(matchesFilters(row, mapping, filters)).toBe(true);
    });

    it('should filter out expired items if excludeExpired is set', () => {
      const row = { 'Expiry': '2020-01-01', 'Item Name': 'Aspirin' };
      const mapping = { 'Expiry': 'expiry_date', 'Item Name': 'name' };
      const filters = { excludeExpired: true };
      expect(matchesFilters(row, mapping, filters)).toBe(false);
    });

    it('should keep non-expired items if excludeExpired is set', () => {
      const row = { 'Expiry': '2030-01-01', 'Item Name': 'Aspirin' };
      const mapping = { 'Expiry': 'expiry_date', 'Item Name': 'name' };
      const filters = { excludeExpired: true };
      expect(matchesFilters(row, mapping, filters)).toBe(true);
    });
  });

  describe('runSimulation', () => {
    it('should correctly predict created, updated, and skipped counts', () => {
      const samples = [
        { 'Med Name': 'Aspirin' }, // update
        { 'Med Name': 'Paracetamol' }, // create
        { 'Med Name': '' }, // skip
      ];
      const mapping = { 'Med Name': 'name' };
      const existingMedicines = ['Aspirin'];
      const result = runSimulation(samples, mapping, 'inventory', existingMedicines);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });
});
