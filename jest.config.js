export default {
  testMatch: ["**/tests/utilities.test.ts", "**/tests/crm.test.ts", "**/tests/inventoryParser.test.ts", "**/tests/returnsParser.test.ts", "**/tests/salesParser.test.ts", "**/tests/services/productNameFilterService.test.ts", "**/tests/aiCamera.test.ts", "**/tests/auth.test.ts", "**/tests/email_attachments.test.ts", "**/tests/paddleOcr.test.ts", "**/tests/onlineEnrichment.test.ts", "**/tests/distributorLearning.test.ts", "**/tests/catalogPipeline.test.ts", "**/tests/refills.test.ts", "**/tests/automation.test.ts", "**/tests/whatsappRouting.test.ts", "**/tests/investigation.test.ts", "**/tests/backupRecovery.test.ts", "**/tests/duplicateCatalog.test.ts", "**/tests/ocrParser.test.ts", "**/tests/distributorNotification.test.ts", "**/tests/processGuardian.test.ts", "**/tests/dbIntegrity.test.ts", "**/tests/migrationV2.test.ts", "**/tests/telegramBot.test.ts", "**/tests/pharmarackCartNotif.test.ts"],
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/', '<rootDir>/\\.gemini/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.claude/', '<rootDir>/\\.gemini/'],
  watchPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/', '<rootDir>/\\.gemini/']
};
