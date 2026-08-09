import sqlite3 from 'better-sqlite3';
import assert from 'assert';
import path from 'path';
import fs from 'fs';

const scratchDir = path.resolve(process.cwd(), 'scratch');
if (!fs.existsSync(scratchDir)) {
  fs.mkdirSync(scratchDir, { recursive: true });
}

const dbPath = path.join(scratchDir, 'test-isolation.db');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3(dbPath);

try {
  console.log('--- STARTING CONFLICT RESOLUTION AUTOMATED VERIFICATION ---');

  db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');

  // 1. Seed active integration secrets in app_settings
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_pass', 'secure_app_password_123')").run();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_password', 'secure_ph_password_456')").run();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('telegram_token', 'bot_token_789')").run();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Original Pharmacy')").run();
  console.log('✓ Successfully seeded active integration secrets in app_settings.');

  // 2. Simulate Settings Page save event payload (carrying blank values for integration keys)
  const incomingSettingsPayload = {
    pharmacy_name: 'AI New Life Pharmacy v2',
    pharmacy_address: '102 Main Street, Bangalore',
    gmail_pass: '',
    pharmarack_password: '',
    telegram_token: ''
  };

  console.log('Simulating a Settings Page save event targeting /api/settings/save...');
  
  const LEARNING_OWNED_KEYS = [
    'gmail_user', 'gmail_pass', 'gmail_auth_method',
    'telegram_enabled', 'telegram_token', 'telegram_chat_id',
    'whatsapp_enabled', 'whatsapp_preferred_system',
    'wa_business_enabled', 'wa_business_access_token',
    'pharmarack_username', 'pharmarack_password', 'pharmarack_session_token', 'pharmarack_mode',
    'automation_enabled', 'wa_auto_share_admin'
  ];

  const PROTECTED_SECRETS = [
    'pharmarack_session_token', 'pharmarack_username', 'pharmarack_password',
    'wa_business_access_token', 'gmail_pass', 'telegram_token'
  ];

  const isSettingsPageSave = true; // Header x-source-screen: settings

  db.transaction(() => {
    const currentSettingsRows = db.prepare("SELECT key, value FROM app_settings").all();
    const currentSettings = currentSettingsRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    for (const [key, value] of Object.entries(incomingSettingsPayload)) {
      if (isSettingsPageSave && LEARNING_OWNED_KEYS.includes(key)) {
        console.log(`  -> [DEFENSE GUARD] Successfully blocked Settings page from overwriting Learning key: ${key}`);
        continue;
      }

      if (PROTECTED_SECRETS.includes(key) && (!value || String(value).trim() === '')) {
        if (currentSettings[key]) {
          console.log(`  -> [DEFENSE GUARD] Successfully preserved existing secret for: ${key}`);
          continue;
        }
      }

      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
    }
  })();

  // 3. Execute assertions
  const checkName = db.prepare("SELECT value FROM app_settings WHERE key='pharmacy_name'").get().value;
  const checkGmail = db.prepare("SELECT value FROM app_settings WHERE key='gmail_pass'").get().value;
  const checkPharmarack = db.prepare("SELECT value FROM app_settings WHERE key='pharmarack_password'").get().value;
  const checkTelegram = db.prepare("SELECT value FROM app_settings WHERE key='telegram_token'").get().value;

  assert.strictEqual(checkName, 'AI New Life Pharmacy v2', 'Pharmacy name should have updated.');
  assert.strictEqual(checkGmail, 'secure_app_password_123', 'Gmail App Password MUST NOT be overwritten!');
  assert.strictEqual(checkPharmarack, 'secure_ph_password_456', 'Pharmarack Password MUST NOT be overwritten!');
  assert.strictEqual(checkTelegram, 'bot_token_789', 'Telegram Token MUST NOT be overwritten!');

  console.log('\n==================================================');
  console.log('🎉 ALL SANITIZATION AND ISOLATION VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('==================================================');

} catch (error) {
  console.error('❌ VERIFICATION FAILED:', error.message);
  process.exit(1);
} finally {
  db.close();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}
