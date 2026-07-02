/**
 * AI Pharmacy — Google Apps Script License Server
 *
 * Deploy this as a Web App:
 *   Extensions → Apps Script → Deploy → New deployment
 *   Execute as: Me | Access: Anyone
 *
 * Google Sheet columns (Sheet1):
 *   A: key_id | B: license_key | C: customer_name | D: issued_date
 *   E: expiry_date | F: machine_id | G: current_nonce | H: last_ping
 *   I: reactivation_count | J: is_active
 *
 * Environment (Script Properties):
 *   SERVER_SECRET  — a long random string you choose (used for HMAC signing)
 *   DOWNLOAD_URL   — Google Drive direct download link for PharmacyOS.exe
 *   BUILD_CONSTANT — must match LICENSE_BUILD_CONSTANT in startupCheck.ts
 */

var SHEET_NAME = 'Licenses';
var MAX_REACTIVATIONS = 3;

// ── Entry point ──────────────────────────────────────────────────────────────

function doGet(e) {
  var action = e.parameter.action || '';
  var result;

  try {
    if (action === 'activate')   result = handleActivate(e.parameter);
    else if (action === 'heartbeat') result = handleHeartbeat(e.parameter);
    else if (action === 'status')    result = handleStatus(e.parameter);
    else result = { valid: false, message: 'Unknown action' };
  } catch (err) {
    result = { valid: false, message: 'Server error: ' + err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Activation ───────────────────────────────────────────────────────────────

function handleActivate(p) {
  var key         = (p.key || '').trim().toUpperCase();
  var fingerprint = (p.fingerprint || '').trim();

  if (!key || !fingerprint) {
    return { valid: false, message: 'Missing parameters.' };
  }

  var sheet = getSheet();
  var row   = findRow(sheet, key);

  if (!row) {
    return { valid: false, message: 'License key not found.' };
  }

  if (row.is_active !== 'TRUE' && row.is_active !== true) {
    return { valid: false, message: 'License key has been revoked.' };
  }

  if (isExpired(row.expiry_date)) {
    return { valid: false, message: 'License key has expired.' };
  }

  // Machine binding
  var existingMachineId = (row.machine_id || '').trim();

  if (existingMachineId && existingMachineId !== fingerprint) {
    // Different machine — check reactivation allowance
    var count = parseInt(row.reactivation_count || '0', 10);
    if (count >= MAX_REACTIVATIONS) {
      return {
        valid: false,
        message: 'Maximum reactivations reached. Contact your provider to reset.'
      };
    }
    updateCell(sheet, row._rowIndex, 9, count + 1); // reactivation_count
  }

  var nonce        = generateNonce();
  var sessionToken = generateSessionToken(key, fingerprint, nonce);
  var props        = PropertiesService.getScriptProperties();
  var downloadUrl  = props.getProperty('DOWNLOAD_URL') || '';

  // Update sheet
  updateCell(sheet, row._rowIndex, 6, fingerprint);  // machine_id
  updateCell(sheet, row._rowIndex, 7, nonce);         // current_nonce
  updateCell(sheet, row._rowIndex, 8, new Date().toISOString()); // last_ping

  return {
    valid:        true,
    nonce:        nonce,
    expiry:       row.expiry_date,
    sessionToken: sessionToken,
    downloadUrl:  downloadUrl,
    message:      'Activation successful.'
  };
}

// ── Heartbeat (daily check) ──────────────────────────────────────────────────

function handleHeartbeat(p) {
  var key         = (p.key || '').trim().toUpperCase();
  var fingerprint = (p.fingerprint || '').trim();
  var nonce       = (p.nonce || '').trim();

  if (!key || !fingerprint) {
    return { valid: false, message: 'Missing parameters.' };
  }

  var sheet = getSheet();
  var row   = findRow(sheet, key);

  if (!row) return { valid: false, message: 'License not found.' };

  if (row.is_active !== 'TRUE' && row.is_active !== true) {
    return { valid: false, message: 'License revoked.' };
  }

  if (isExpired(row.expiry_date)) {
    return { valid: false, message: 'License expired.' };
  }

  // Machine fingerprint must match
  if (row.machine_id && row.machine_id !== fingerprint) {
    return { valid: false, message: 'Machine fingerprint mismatch — possible clone detected.' };
  }

  // Nonce check (detects replay / clone using previous nonce)
  if (row.current_nonce && row.current_nonce !== nonce) {
    Logger.log('Nonce mismatch for key ' + key + ' — possible clone or replay.');
    // Allow but flag — don't hard-block to avoid locking legitimate offline installs
  }

  var newNonce = generateNonce();
  updateCell(sheet, row._rowIndex, 7, newNonce);
  updateCell(sheet, row._rowIndex, 8, new Date().toISOString());

  return {
    valid:   true,
    nonce:   newNonce,
    expiry:  row.expiry_date,
    message: 'OK'
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

function handleStatus(p) {
  var key = (p.key || '').trim().toUpperCase();
  var row = findRow(getSheet(), key);
  if (!row) return { valid: false, message: 'Not found.' };
  return {
    valid:      row.is_active === 'TRUE',
    expiry:     row.expiry_date,
    customer:   row.customer_name,
  };
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function findRow(sheet, key) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // skip header
    if ((data[i][1] || '').toString().trim().toUpperCase() === key) {
      return {
        _rowIndex:          i + 1, // 1-based
        key_id:             data[i][0],
        license_key:        data[i][1],
        customer_name:      data[i][2],
        issued_date:        data[i][3],
        expiry_date:        data[i][4] ? data[i][4].toString() : '',
        machine_id:         data[i][5],
        current_nonce:      data[i][6],
        last_ping:          data[i][7],
        reactivation_count: data[i][8],
        is_active:          data[i][9],
      };
    }
  }
  return null;
}

function updateCell(sheet, rowIndex, colIndex, value) {
  // colIndex is 0-based in our mapping, sheet is 1-based
  sheet.getRange(rowIndex, colIndex + 1).setValue(value);
}

function isExpired(expiryDateStr) {
  if (!expiryDateStr) return false;
  return new Date(expiryDateStr) < new Date();
}

function generateNonce() {
  return Utilities.getUuid().replace(/-/g, '');
}

function generateSessionToken(key, fingerprint, nonce) {
  var props  = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SERVER_SECRET') || 'change-me';
  var data   = key + '|' + fingerprint + '|' + nonce;
  var sig    = Utilities.computeHmacSha256Signature(data, secret);
  return Utilities.base64Encode(sig);
}
