/**
 * Sign-in counter for the ClipKraft site (Google Apps Script).
 *
 * What it stores: the time, the Puter username and the page someone signed in from. Nothing else.
 * The site never has anyone's password (Puter handles sign-in), so none can ever arrive here.
 *
 * Setup: see README.md, section "Sign-in log".
 */

const SHEET_NAME = 'Sign-ins';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) sheet.appendRow(['Time', 'Puter username', 'Page']);

    let data = {};
    try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { data = {}; }

    const username = clean(data.username, 64);
    if (!username) return text('ignored');
    sheet.appendRow([new Date(), username, clean(data.page, 40)]);
    return text('ok');
  } finally {
    lock.releaseLock();
  }
}

// Visiting the web app URL in a browser shows this, so you can check the deployment works.
function doGet() {
  return text('Sign-in log is running.');
}

// Keep cells short and stop anything that looks like a spreadsheet formula.
function clean(value, max) {
  let s = String(value || '').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function text(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
