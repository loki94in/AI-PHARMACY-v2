import { assertDevOrTestEnvironment } from '../src/utils/mockGuard.js';

describe('Production Mock Data Protection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('assertDevOrTestEnvironment throws error when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_MOCK_SEED;

    expect(() => {
      assertDevOrTestEnvironment('testScript');
    }).toThrow(/Refusing to execute mock\/seed script 'testScript' in production environment/);
  });

  test('assertDevOrTestEnvironment throws even if ALLOW_MOCK_SEED is true when in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_MOCK_SEED = 'true';

    expect(() => {
      assertDevOrTestEnvironment('testScript');
    }).toThrow(/Refusing to execute mock\/seed script 'testScript' in production environment/);
  });

  test('assertDevOrTestEnvironment blocks execution in development without ALLOW_MOCK_SEED', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_MOCK_SEED;

    expect(() => {
      assertDevOrTestEnvironment('testScript');
    }).toThrow(/hard-blocked in development unless ALLOW_MOCK_SEED=true/);
  });

  test('assertDevOrTestEnvironment allows execution in development when ALLOW_MOCK_SEED=true', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_MOCK_SEED = 'true';

    expect(() => {
      assertDevOrTestEnvironment('testScript');
    }).not.toThrow();
  });

  test('assertDevOrTestEnvironment allows execution when NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_MOCK_SEED;

    expect(() => {
      assertDevOrTestEnvironment('testScript');
    }).not.toThrow();
  });
});
