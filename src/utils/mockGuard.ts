/**
 * Production Mock Data Protection Guard
 * Ensures mock, seed, or synthetic data scripts NEVER execute against production databases.
 */
export function assertDevOrTestEnvironment(scriptName = 'seed_script'): void {
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  const allowSeed = process.env.ALLOW_MOCK_SEED === 'true';

  if (isProd) {
    const errorMsg = `[MOCK_DATA_PROTECTION] FATAL: Refusing to execute mock/seed script '${scriptName}' in production environment (NODE_ENV=production). Real production databases must never receive mock/synthetic data.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  if (!allowSeed && !isTest) {
    const errorMsg = `[MOCK_DATA_PROTECTION] BLOCKED: Mock/seed script '${scriptName}' is hard-blocked in development unless ALLOW_MOCK_SEED=true is explicitly set.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}
