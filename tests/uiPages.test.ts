import { promises as fs } from 'fs';
import path from 'path';

test('sales UI page file exists', async () => {
  const filePath = path.resolve(__dirname, '..', 'src', 'ui', 'sales', 'index.html');
  await expect(fs.access(filePath)).resolves.toBeUndefined();
});

test('inventory UI page file exists', async () => {
  const filePath = path.resolve(__dirname, '..', 'src', 'ui', 'inventory', 'index.html');
  await expect(fs.access(filePath)).resolves.toBeUndefined();
});

test('customers UI page file exists', async () => {
  const filePath = path.resolve(__dirname, '..', 'src', 'ui', 'customers', 'index.html');
  await expect(fs.access(filePath)).resolves.toBeUndefined();
});