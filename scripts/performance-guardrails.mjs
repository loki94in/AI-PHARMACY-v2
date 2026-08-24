#!/usr/bin/env node

/**
 * Performance Guardrails Scanner (mandatory, blocking)
 *
 * Verifies that changed code does NOT regress the event-driven / cache-first
 * performance architecture or violate the binding contracts in AGENTS.md and
 * API_OPTIMIZATION_IMPLEMENTATION_PLAN.md.
 *
 * Modes:
 *   node scripts/performance-guardrails.mjs              # scan ADDED/MODIFIED lines vs git HEAD (<2s)
 *   node scripts/performance-guardrails.mjs --all        # full repository scan (legacy audit)
 *   node scripts/performance-guardrails.mjs --self-test  # prove every rule fires on known-bad samples
 *
 * Exit codes: 0 = pass, 1 = violations found (MUST be fixed before the task ends).
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MODE = process.argv.includes('--all') ? 'all'
  : process.argv.includes('--self-test') ? 'self-test' : 'changed';

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-pkg', 'build', 'uploads',
  '.wwebjs_auth', 'pharmarack_profile', '.understand-anything', 'backup', 'data']);

function norm(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }
const isFrontend = p => norm(p).startsWith('frontend/src/');
const isBackendSrc = p => norm(p).startsWith('src/') && !norm(p).startsWith('src/scripts/');

/** Skip comment-only lines so documented forbidden patterns never self-trigger. */
function looksLikeComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

// ---------------------------------------------------------------------------
// Allowlists — each entry carries its sanctioning rationale. Extend ONLY with
// a written reference to the governing contract.
// ---------------------------------------------------------------------------
const ALLOW = {
  // Single Global SSE Connection Rule: this hook owns THE one EventSource and
  // the sanctioned CHROME_INSTANT_KEYS instant refetch for chrome-owned keys.
  eventSource: ['frontend/src/hooks/useglobalsseinvalidation.ts'],
  refetchQueries: [
    'frontend/src/hooks/useglobalsseinvalidation.ts',
    'frontend/src/lib/keepalive/pagequerytracker.tsx',
  ],
  refetchInterval: ['frontend/src/pages/settings/index.tsx'], // visibility-gated
  setIntervalFrontend: [
    'frontend/src/components/layout.tsx',                      // Hidden-window polling rule
    'frontend/src/components/connecteddevicesfooterbar.tsx',
    'frontend/src/components/whatsappqueuepopover.tsx',        // only while popover open
    'frontend/src/components/mobileconnectionmodal.tsx',
    'frontend/src/pages/settings/index.tsx',
    'frontend/src/pages/phonesales/index.tsx',                 // only while device session connected
    'frontend/src/pages/migration/components/reviewmodal.tsx', // 10s visibility-gated safety poll
    'frontend/src/pages/dispatch/index.tsx',
    'frontend/src/pages/compositionqueue/index.tsx',
    // Transient 2s poll armed ONLY between a user's Stop click and worker halt,
    // self-clearing on completion — same class as the while-open queue poll.
    'frontend/src/pages/aiengineering/panels/compositionpanel.tsx',
  ],
  directSendWorkers: ['src/services/whatsappqueueworker.ts'], // flushes USER-clicked queue items only
};

// Paths whose CONTENT legitimately documents/contains banned dummy tokens:
// auditEngine.ts is the app's own detector; tests assert banned values are rejected.
const DUMMY_TOKEN_SANCTIONED = ['src/utils/auditengine.ts', 'tests/', 'scripts/importmedicinenames.mjs'];

// Normalize allowlist entries once so comparisons are typo-proof.
const ALLOW_NORM = Object.fromEntries(Object.entries(ALLOW).map(([k, v]) => [k, new Set(v.map(norm))]));

// ---------------------------------------------------------------------------
// Rules. Line rules: scope(file) -> bool, optional fileGate(content),
// check(file, line) -> msg | null. File rules: fileRule:true,
// checkFile(file, content) -> [{rule,name,file,line,msg}].
// ---------------------------------------------------------------------------
function nativeConfirmHit(line) {
  let i = line.indexOf('confirm');
  while (i !== -1) {
    const before = i > 0 ? line[i - 1] : '';
    const win = line.slice(Math.max(0, i - 7), i) === 'window.';
    if ((before === '' || !/[\w.$]/.test(before) || win) && /^\s*\(/.test(line.slice(i + 7))) return true;
    i = line.indexOf('confirm', i + 1);
  }
  return false;
}

const RULES = [
  {
    id: 'F1', name: 'eager-refetch-storm', scope: p => isFrontend(p),
    check(file, line) {
      if (!/\brefetchQueries\s*\(/.test(line)) return null;
      if (ALLOW_NORM.refetchQueries.has(norm(file))) return null;
      return 'Eager refetchQueries() re-introduced. Deferred-SSE contract: writes must only MARK stale '
        + "(invalidateQueries with refetchType:'none'); PageQueryTracker refreshes on activation. "
        + 'Chrome-owned keys belong in CHROME_INSTANT_KEYS (useGlobalSseInvalidation.ts).';
    },
  },
  {
    id: 'F2', name: 'sse-invalidate-not-mark-stale',
    scope: p => isFrontend(p) && /(sse|cacheinvalidation|settingsync)/i.test(norm(p)),
    check(file, line) {
      if (!/\.invalidateQueries\s*\(/.test(line)) return null;
      if (/refetchType:\s*['"]none['"]/.test(line)) return null;
      return 'invalidateQueries inside an SSE/cache-invalidation module must use refetchType none '
        + '(mark-stale-only) so hidden kept-alive pages never background-refetch.';
    },
  },
  {
    id: 'F3', name: 'second-eventsource-connection', scope: p => isFrontend(p),
    check(file, line) {
      if (!/new\s+EventSource\s*\(/.test(line)) return null;
      if (ALLOW_NORM.eventSource.has(norm(file))) return null;
      return 'Second EventSource connection. Single Global SSE Connection Rule: consume DOM CustomEvents '
        + 'dispatched by useGlobalSseInvalidation; add mappings to SSE_QUERY_MAP/SSE_CUSTOM_EVENTS instead.';
    },
  },
  {
    id: 'F4', name: 'ungated-refetch-interval', scope: p => isFrontend(p),
    check(file, line) {
      if (!/refetchInterval\s*:/.test(line)) return null;
      if (ALLOW.refetchInterval.includes(norm(file))) return null;
      return 'refetchInterval polling re-introduced. P1 events-not-timers: map query keys to SSE events in '
        + 'SSE_QUERY_MAP. If a poll is truly required it MUST gate on usePageActive()/visibility AND be '
        + 'added to the F4 allowlist with rationale.';
    },
  },
  {
    id: 'F5', name: 'ungated-setinterval-frontend', scope: p => isFrontend(p),
    check(file, line) {
      if (!/\bsetInterval\s*\(/.test(line)) return null;
      if (ALLOW_NORM.setIntervalFrontend.has(norm(file))) return null;
      return 'New setInterval timer in the SPA. Prefer SSE events (P1). If unavoidable, gate it on '
        + 'document.visibilityState/usePageActive() and add the file to the F5 allowlist with rationale.';
    },
  },
  {
    id: 'F6', name: 'raw-tailwind-color',
    scope: p => isFrontend(p) && /\.(tsx|ts)$/.test(norm(p)),
    check(file, line) {
      // Modal scrim exception: `bg-black/50|60|80` overlay backdrops carry
      // explicit light-mode overrides in index.css (softened to 0.35), so they
      // are theme-safe by design. Buttons/text on colored surfaces are NOT.
      if (/inset-0/.test(line) && /backdrop-blur|z-(modal|global-modal|drawer)/.test(line)) return null;
      // Accent-fill label exception: `text-white` (incl. hover:/group-hover:)
      // on an element that also carries a solid accent background class is
      // THEME-SAFE BY CONTRACT — index.css's light-mode override
      // (.light .text-white:not([class*="bg-primary"])…) keeps such labels
      // white in Day mode. This combination is the sanctioned fix for
      // unreadable same-hue text when `text-text` sat on colored fills
      // (bug register P2-05); `text-text` stays reserved for neutral surfaces
      // per AGENTS.md UI Development Guidelines.
      if (/text-white/.test(line)
        && /(?:bg-(?:primary|red|green|blue|purple|emerald|sky|indigo|yellow|amber|cyan|orange)|from-primary)/.test(line)) return null;
      const cls = /(bg|text|border|ring|divide|outline|decoration|from|to|via)-(black|white)([^a-z0-9-]|$)/.test(line);
      if (cls) return 'Raw Tailwind black/white class breaks the light-mode/theme toggle. Use semantic tokens: bg-bg/bg2/bg3, text-text/text-muted, border-border.';
      if (/(bg|text|border|ring|from|to|via|shadow)-\[(#|rgb|hsl)/.test(line)) return 'Hardcoded arbitrary color value breaks theming. Use semantic Tailwind variables.';
      return null;
    },
  },
  {
    id: 'F7', name: 'simulation-mock-ui', scope: p => isFrontend(p),
    check(file, line) {
      if (/simulat(ed|ion)/i.test(line) || /\bmock[\s-]?mode\b/i.test(line)) {
        return 'Simulation/mock UI surface detected (No Simulated/Mock Features Rule). Only live features '
          + 'and live data may render; remove badges/toggles/modes referencing simulation.';
      }
      return null;
    },
  },
  {
    id: 'F8', name: 'forbidden-dummy-data', scope: () => true,
    check(file, line) {
      if (DUMMY_TOKEN_SANCTIONED.some(s => norm(file).includes(s))) return null;
      const m = line.match(/\bB-(GEN|CATALOG|IMPORT|OFFLINE|REISSUE|MANUAL|NEW)\b/)
        || line.match(/\bBATCH123\b/)
        || line.match(/\+91\s?99999\s?99999/)
        || line.match(/123 Health Ave/i)
        || line.match(/['"]Generic Medicine['"]/)
        // 'MANUAL' is only banned as an invented BATCH value; user-action
        // provenance tags like `cartSource: 'manual'` are legitimate.
        || line.match(/\bbatch[\w]*['"]?\s*[:=]\s*['"]MANUAL['"]/i);
      if (m) return 'Forbidden dummy/fabricated data token "' + m[0] + '" (Strict Legitimate Data contract). '
        + 'Real data only; missing data must be requested/validated, never invented.';
      return null;
    },
  },
  {
    id: 'F9', name: 'native-blocking-dialog', scope: p => isFrontend(p),
    check(file, line) {
      if (/\balert\s*\(/.test(line) || nativeConfirmHit(line)) {
        return 'Native blocking alert()/confirm(). Use toastEvent.trigger(...) or styled modal overlays (frontend/AGENTS.md).';
      }
      return null;
    },
  },
  {
    id: 'F10', name: 'delivery-boy-read-outside-dispatch',
    scope: p => isFrontend(p) && !norm(p).startsWith('frontend/src/pages/dispatch/'),
    check(file, line) {
      // Same-line co-occurrence only: a delivery-boy identifier fed from the
      // store-profile settings fields. Settings' own profile editor and
      // generic store-contact displays never put both on one line.
      if (/delivery[\s_-]?boy/i.test(line) && /(owner_whatsapp_number|shop_phone)/.test(line)
        && !/admin|store owner/i.test(line)) {
        return 'Delivery-boy details must resolve ONLY from the delivery_boys table via /api/dispatch/delivery-boys '
          + 'on /dispatch — never from app_settings/store profile fields (Page Feature Ownership contract).';
      }
      return null;
    },
  },
  {
    id: 'B1', name: 'ungated-backend-timer',
    scope: p => isBackendSrc(p) && !/tests?\//.test(norm(p)),
    fileRule: true,
    checkFile(file, content) {
      if (!/\bsetInterval\s*\(/.test(content)) return [];
      const gated = ['activityTracker', 'isIdle', 'dataFetchControl', 'getBackendFetchMode']
        .some(k => content.includes(k));
      if (gated) return [];
      const out = [];
      content.split('\n').forEach((l, i) => {
        if (/\bsetInterval\s*\(/.test(l) && !looksLikeComment(l)) {
          out.push({
            rule: 'B1', name: 'ungated-backend-timer', file, line: i + 1,
            msg: 'Backend setInterval loop without idle/dataFetchControl gating. P3 Gated Workers: read the '
              + 'dataFetchControl registry, skip/backoff via activityTracker.isIdle(), lazy-start on first work item.',
          });
        }
      });
      return out;
    },
  },
  {
    id: 'B2', name: 'sync-pharmarack-profile-copy',
    scope: p => isBackendSrc(p) && /(pharmarack|tokenrefreshscheduler)/i.test(norm(p)),
    check(file, line) {
      if (/\bcopyFileSync\s*\(|\bcpSync\s*\(/.test(line)) {
        return 'Synchronous Pharmarack profile copy blocks the event loop during lock-fallbacks. Session '
          + 'Persistence contract: profile copies stay async (copyProfileFolder) with dynamic lock cleanup '
          + '+ session copy-back on exit.';
      }
      return null;
    },
  },
  {
    id: 'B3', name: 'autonomous-patient-messaging',
    scope: p => isBackendSrc(p) && /(cron|scheduler|worker)/i.test(norm(p)),
    check(file, line) {
      if (!/\b(sendMessage|sendText|sendRawMessage)\s*\(/.test(line)) return null;
      if (ALLOW_NORM.directSendWorkers.has(norm(file))) return null;
      return 'Direct message send inside a cron/scheduler/worker file. Strict Manual-Only Patient Messaging: '
        + 'workers may ONLY stage records/statuses; dispatch requires an explicit user click '
        + '(or the sanctioned queue worker flushing user-staged items).';
    },
  },
];

// ---------------------------------------------------------------------------
// Target collection
// ---------------------------------------------------------------------------
function git(args) {
  try { return execSync('git ' + args, { cwd: ROOT, encoding: 'utf8' }); }
  catch { return null; }
}

/** Added-line numbers per file from unified diff -U0 (staged+unstaged vs HEAD). */
function collectChangedLines() {
  const diff = git('diff HEAD -U0 --no-color');
  if (diff === null) return null;
  const targets = new Map();
  let cur = null;
  let ln = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      cur = raw.slice(6).trim();
    } else if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      if (m && cur) ln = parseInt(m[1], 10);
    } else if (cur && raw.startsWith('+') && !raw.startsWith('+++')) {
      if (!targets.has(cur)) targets.set(cur, new Set());
      targets.get(cur).add(ln);
      ln++;
    } else if (cur && raw.startsWith(' ')) {
      ln++;
    }
    // '-' lines do not advance the + side counter under -U0
  }
  return targets;
}

function collectUntracked() {
  const out = git('ls-files --others --exclude-standard');
  if (!out) return [];
  return out.split('\n').map(s => s.trim()).filter(Boolean);
}

function walkAll(dirRel, acc) {
  dirRel = dirRel || '';
  acc = acc || [];
  const abs = dirRel ? join(ROOT, dirRel) : ROOT;
  let names = [];
  try { names = readdirSync(abs); } catch { return acc; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = dirRel ? dirRel + '/' + name : name;
    let st = null;
    try { st = statSync(join(ROOT, rel)); } catch { continue; }
    if (st.isDirectory()) walkAll(rel, acc);
    else {
      const dot = name.lastIndexOf('.');
      if (dot > -1 && SCAN_EXTS.has(name.slice(dot).toLowerCase())) acc.push(rel);
    }
  }
  return acc;
}

function scannable(f) {
  const n = norm(f);
  // The scanner itself documents forbidden patterns as self-test samples.
  if (n === 'scripts/performance-guardrails.mjs') return false;
  const dot = f.lastIndexOf('.');
  if (dot < 0 || !SCAN_EXTS.has(f.slice(dot).toLowerCase())) return false;
  return !SKIP_DIRS.has(f.split(/[\\/]/)[0]);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
let FILE_CONTENT_CACHE = new Map();
function getFileContent(file) {
  if (!FILE_CONTENT_CACHE.has(file)) {
    try { FILE_CONTENT_CACHE.set(file, readFileSync(join(ROOT, file), 'utf8')); }
    catch { FILE_CONTENT_CACHE.set(file, null); }
  }
  return FILE_CONTENT_CACHE.get(file);
}

function scanLines(file, lineNos) {
  const content = getFileContent(file);
  if (content === null) return [];
  const allLines = content.split('\n');
  const findings = [];
  const active = RULES.filter(r => r.scope(file));
  const gates = new Map();

  for (const n of lineNos) {
    const line = allLines[n - 1];
    if (line === undefined || looksLikeComment(line)) continue;
    for (const r of active) {
      if (r.fileRule) continue;
      if (r.fileGate) {
        if (!gates.has(r.id)) gates.set(r.id, r.fileGate(content));
        if (!gates.get(r.id)) continue;
      }
      const msg = r.check(file, line);
      if (msg) findings.push({ rule: r.id, name: r.name, file, line: n, msg });
    }
  }
  for (const r of active) if (r.fileRule) findings.push(...r.checkFile(file, content));
  return findings;
}

// ---------------------------------------------------------------------------
// Self-test: every rule must fire on its bad sample and stay silent on clean ones.
// ---------------------------------------------------------------------------
function selfTest() {
  const FE = 'frontend/src/pages/FakePage/index.tsx';
  const cases = [
    ['F1', 'queryClient.refetchQueries({ queryKey: ["x"], type: "active" });'],
    ['F2', 'queryClient.invalidateQueries({ queryKey: key });'],
    ['F3', "const es = new EventSource('/api/notifications/stream');"],
    ['F4', '{ enabled: isVisible, refetchInterval: 15000 }'],
    ['F5', 'const t = setInterval(tick, 30000);'],
    ['F6', '<div className="bg-black/20 text-white">hi</div>'],
    ['F7', '<span className="badge">Simulated Cart</span>'],
    ['F8', "batch: 'BATCH123'"],
    ['F9', 'alert("saved!");'],
    ['F10', "deliveryBoyPhone: s.owner_whatsapp_number || ''"],
    ['B2', 'fs.copyFileSync(tempProfile, mainProfile);'],
    ['B3', 'await client.sendMessage(number + "@c.us", text);'],
  ];
  const negatives = [
    ['F1', "void queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });"],
    ['F5', 'const id = setTimeout(settle, 100);'],
    ['F6', '<div className="bg-bg2 text-muted border-border">ok</div>'],
    ['F6', '<button className="bg-primary text-white font-bold">Save</button>'],
    ['F6', '<span className="bg-sky/10 group-hover:bg-sky group-hover:text-white">Add</span>'],
    ['F8', "source: invoice.source_flag"],
    ['F9', 'if (modalRef.confirm()) close();'],
  ];
  let failed = 0;
  for (const [id, sample] of cases) {
    const r = RULES.find(x => x.id === id);
    const gateOk = r.fileGate ? r.fileGate(sample) : true;
    const hit = gateOk && !r.fileRule ? r.check(FE, sample) : [];
    if (!hit) { console.error('SELF-TEST FAIL: ' + id + ' silent on bad sample.'); failed++; }
  }
  for (const [id, sample] of negatives) {
    const r = RULES.find(x => x.id === id);
    const hit = r.check(FE, sample);
    if (hit) { console.error('SELF-TEST FAIL: ' + id + ' fired on clean sample: ' + sample); failed++; }
  }
  const b1 = RULES.find(r => r.id === 'B1');
  if (!b1.checkFile('src/services/newThing.ts', 'setInterval(() => run(), 5000);').length) {
    console.error('SELF-TEST FAIL: B1 silent on ungated timer.'); failed++;
  }
  if (b1.checkFile('src/services/newThing.ts', "await getBackendFetchMode('bg.x','auto');\nsetInterval(run, 5000);").length) {
    console.error('SELF-TEST FAIL: B1 flagged gated timer.'); failed++;
  }
  if (failed) { console.error('\n--self-test: ' + failed + ' failure(s)'); process.exit(1); }
  console.log('--self-test: PASS — every rule fires on bad samples, stays silent on clean ones.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (MODE === 'self-test') return selfTest();

  let jobs = []; // {file, lines:Set|null}
  let label = '';
  if (MODE === 'all') {
    label = 'FULL REPOSITORY (--all)';
    jobs = walkAll().filter(scannable).map(f => ({ file: f, lines: null }));
  } else {
    const changed = collectChangedLines();
    if (changed === null) {
      console.warn('git unavailable — falling back to FULL scan.\n');
      jobs = walkAll().filter(scannable).map(f => ({ file: f, lines: null }));
      label = 'FULL REPOSITORY (fallback)';
    } else {
      for (const [f, lines] of changed) if (scannable(f) && lines.size) jobs.push({ file: f, lines });
      for (const f of collectUntracked()) {
        if (!scannable(f)) continue;
        const c = getFileContent(f);
        if (c === null) continue;
        jobs.push({ file: f, lines: new Set(c.split('\n').map((_, i) => i + 1)) });
      }
      label = 'changed-lines vs git HEAD' + (jobs.length ? '' : ' (nothing to scan)');
    }
  }

  const findings = [];
  for (const j of jobs) {
    if (j.lines) findings.push(...scanLines(j.file, j.lines));
    else {
      const c = getFileContent(j.file);
      if (c !== null) findings.push(...scanLines(j.file, new Set(c.split('\n').map((_, i) => i + 1))));
    }
  }

  console.log('Performance Guardrails — scanning ' + jobs.length + ' file(s) (' + label + ')\n');
  if (!findings.length) {
    console.log('PASS — no guardrail violations. Speed architecture intact.');
    return;
  }
  findings.sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
  for (const f of findings) {
    console.log('  ' + f.file + ':' + f.line);
    console.log('    [' + f.rule + '] ' + f.name + ': ' + f.msg + '\n');
  }
  console.error('FAIL — ' + findings.length + ' guardrail violation(s). Fix before finishing the task.');
  console.error('     Sanctioned exceptions live in the ALLOW block of scripts/performance-guardrails.mjs');
  console.error('     (extend only with a written rationale referencing the governing contract).');
  process.exit(1);
}

main();
