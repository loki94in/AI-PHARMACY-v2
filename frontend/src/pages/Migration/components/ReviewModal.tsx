import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, ArrowRight, CheckCircle, AlertTriangle, AlertCircle, RefreshCw, Database, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ModuleSection } from './ModuleSection';
import { api } from '../../../services/api';
import { invalidateAfterStockWrite } from '../../../utils/cacheInvalidation';
import { toDateInputValue } from '../../../utils/date';

interface FileEntry {
  uploadedFileName: string;
  originalName: string;
  ext: string;
  headers: string[];
  samples: any[];
  totalRows?: number;
  detected: { type: string; confidence: number };
  userSelectedType: string;
  mapping: Record<string, string>;
  status: 'pending' | 'analyzing' | 'ready' | 'error';
  errorMsg?: string;
  initialPhase?: 'review' | 'importing';
}

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileEntry: FileEntry;
  onUpdateFile: (updated: FileEntry) => void;
}

type ModalPhase = 'review' | 'importing' | 'staging' | 'finalizing' | 'success' | 'error';

interface StagingConflict {
  id: number;
  module_type: string;
  conflict_reason: string;
  existing_medicine_name?: string;
  existing_batch_no?: string;
  existing_quantity?: number;
  raw_imported_data: string;
}

interface StagingError {
  id: number;
  file_name: string;
  row_index: number;
  raw_data: string;
  error_message: string;
  created_at?: string;
}

interface StagingAudit {
  id: number;
  file_name?: string;
  record_type: string;
  record_identifier: string;
  entity_type: string;
  raw_value?: string;
  status: 'preserved_null' | 'skipped';
  reason: string;
  created_at?: string;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  fileEntry,
  onUpdateFile
}) => {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<ModalPhase>('review');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<any>({
    errors: [],
    requiredFieldsMapped: false,
    missingRequired: []
  });
  const [validating, setValidating] = useState(false);

  const [status, setStatus] = useState<any>(null);
  const [stagingConflicts, setStagingConflicts] = useState<StagingConflict[]>([]);
  const [stagingErrors, setStagingErrors] = useState<StagingError[]>([]);
  const [stagingAudits, setStagingAudits] = useState<StagingAudit[]>([]);
  const [auditSummary, setAuditSummary] = useState<{
    unresolvedCustomers: number;
    unresolvedDoctors: number;
    unresolvedDistributors: number;
    unresolvedMedicines: number;
    skippedRecords: number;
    preservedNullRecords: number;
    totalAuditEntries: number;
  } | null>(null);
  const [showErrorsExpanded, setShowErrorsExpanded] = useState<boolean>(true);
  const [showAuditsExpanded, setShowAuditsExpanded] = useState<boolean>(true);
  const [resolvingConflictId, setResolvingConflictId] = useState<number | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importStats, setImportStats] = useState<{ totalRows: number; errorRows: number; validRows: number } | null>(null);
  const [reportCutoverDate, setReportCutoverDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState({
    medicines: 0,
    inventory: 0,
    purchases: 0,
    sales: 0,
    returns: 0,
    distributors: 0,
    customers: 0,
    doctors: 0,
    errors: 0,
    conflicts: 0
  });

  const getRequiredFields = (type: string) => {
    switch (type) {
      case 'inventory':
        return ['name', 'batch_no', 'expiry_date'];
      case 'purchases':
        return ['invoice_no', 'date'];
      case 'sales':
        return ['invoice_no', 'date'];
      case 'returns':
        return ['return_no', 'date'];
      default:
        return ['name'];
    }
  };

  const getModuleLabel = (type: string) => {
    switch (type) {
      case 'inventory': return '📦 Inventory';
      case 'purchases': return '🛒 Purchases';
      case 'sales': return '💰 Sales';
      case 'returns': return '🔄 Returns';
      default: return '📁 Data Import';
    }
  };

  const loadStagingData = useCallback(async () => {
    try {
      const [stagingRes, conflicts, errorsRes, auditsRes] = await Promise.all([
        api.getStagingSummary(),
        api.getStagingConflicts(),
        api.getStagingErrors().catch(() => ({ rows: [], total: 0 })),
        api.getStagingAudits().catch(() => ({ rows: [], total: 0 })),
      ]);
      if (stagingRes.success && stagingRes.stats) {
        setSummary({
          medicines: stagingRes.stats.medicines || 0,
          inventory: stagingRes.stats.inventory || 0,
          purchases: stagingRes.stats.purchases || 0,
          sales: stagingRes.stats.sales || 0,
          returns: stagingRes.stats.returns || 0,
          distributors: stagingRes.stats.distributors || 0,
          customers: stagingRes.stats.customers || 0,
          doctors: stagingRes.stats.doctors || 0,
          errors: stagingRes.errorCount || 0,
          conflicts: stagingRes.conflictCount || 0,
        });
        setImportWarnings(Array.isArray(stagingRes.warnings) ? stagingRes.warnings : []);
        if (stagingRes.importStats) {
          setImportStats({
            totalRows: stagingRes.importStats.totalRows || 0,
            errorRows: stagingRes.importStats.errorRows || 0,
            validRows: stagingRes.importStats.validRows || 0,
          });
        }
        if (stagingRes.auditSummary) {
          setAuditSummary(stagingRes.auditSummary);
        }
      }
      setStagingConflicts(Array.isArray(conflicts) ? conflicts : []);
      setStagingErrors(Array.isArray(errorsRes?.rows) ? errorsRes.rows : []);
      setStagingAudits(Array.isArray(auditsRes?.rows) ? auditsRes.rows : []);
    } catch (err) {
      console.warn('Failed to load staging summary:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen && fileEntry) {
      setMappings(fileEntry.mapping || {});
      setPhase(fileEntry.initialPhase || 'review');
      setErrorMessage(null);
      setStagingConflicts([]);
    }
  }, [isOpen, fileEntry]);

  useEffect(() => {
    if (isOpen && fileEntry && Object.keys(mappings).length > 0) {
      const delayDebounce = setTimeout(() => {
        runValidation(mappings);
      }, 300);
      return () => clearTimeout(delayDebounce);
    }
  }, [mappings, isOpen]);

  const runValidation = async (currentMappings: Record<string, string>) => {
    setValidating(true);
    try {
      const result = await api.preMigrationAnalyze(
        fileEntry.uploadedFileName,
        0,
        0,
        currentMappings
      );
      if (result.success) {
        setValidation({
          errors: result.validation?.errors || [],
          requiredFieldsMapped: result.validation?.requiredFieldsMapped ?? false,
          missingRequired: result.validation?.missingRequired || []
        });
      }
    } catch (err: any) {
      console.error('Validation error:', err);
    } finally {
      setValidating(false);
    }
  };

  const handleMappingChange = (header: string, targetCol: string) => {
    const updated = { ...mappings, [header]: targetCol };
    setMappings(updated);
    onUpdateFile({ ...fileEntry, mapping: updated });
  };

  const handleStartImport = async () => {
    setPhase('importing');
    setErrorMessage(null);
    try {
      await api.runMigration(
        fileEntry.uploadedFileName,
        fileEntry.userSelectedType,
        mappings,
        0,
        0
      );
    } catch (err: any) {
      setPhase('error');
      setErrorMessage(err.message || 'Failed to start import');
    }
  };

  const handleResolveConflict = async (conflictId: number, resolution: string) => {
    setResolvingConflictId(conflictId);
    try {
      await api.resolveStagingConflict(conflictId, resolution);
      await loadStagingData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve conflict');
    } finally {
      setResolvingConflictId(null);
    }
  };

  const handleDiscardStaging = async () => {
    try {
      await api.rollbackMigration();
      setPhase('review');
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to discard staging');
    }
  };

  const handleFinalize = async () => {
    setPhase('finalizing');
    setErrorMessage(null);
    try {
      const res = await api.finalizeMigration(false, reportCutoverDate);
      if (res.success) {
        if (res.stats) {
          setSummary(prev => ({
            ...prev,
            medicines: res.stats.medicines || 0,
            inventory: res.stats.inventory || 0,
            purchases: res.stats.purchases || 0,
            sales: res.stats.sales || 0,
            returns: res.stats.returns || 0,
            distributors: res.stats.distributors || 0,
          }));
        }
        invalidateAfterStockWrite(queryClient);
        window.dispatchEvent(new Event('clear-module-cache'));
        setPhase('success');
      } else {
        setPhase('error');
        setErrorMessage(res.error || 'Failed to finalize database import');
      }
    } catch (err: any) {
      setPhase('error');
      setErrorMessage(err.message || 'Database finalize error');
    }
  };

  // Live import status via the global SSE stream (backend broadcasts
  // migration_update on every migrationStatus write; mapped to
  // sse-migration-update in useGlobalSseInvalidation — P1 "events, not timers").
  // The interval below is only a 10s safety net for missed frames; both paths
  // pause while the tab is hidden — the import keeps running server-side and
  // polling resumes on return.
  useEffect(() => {
    if (phase !== 'importing') return;

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let lastPushAt = 0;
    let transitioning = false;

    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const applyLiveStatus = async (liveStatus: {
      isStagingReady?: boolean;
      message?: string;
      progress?: number;
      active?: boolean;
      errorCount?: number;
    } | null | undefined) => {
      if (!liveStatus) return;
      setStatus(liveStatus);

      if (transitioning) return;
      if (liveStatus.isStagingReady) {
        transitioning = true;
        stopPolling();
        await loadStagingData();
        setPhase('staging');
      } else if (liveStatus.message && liveStatus.message.toLowerCase().includes('failed')) {
        transitioning = true;
        stopPolling();
        setPhase('error');
        setErrorMessage(liveStatus.message);
      }
    };

    const checkStatus = async () => {
      try {
        await applyLiveStatus(await api.getMigrationStatus());
      } catch (err: any) {
        console.error('Status polling error:', err);
      }
    };

    // Primary path: push frames from the single global EventSource.
    // Throttle non-terminal frames so bulk-import passes don't thrash renders;
    // terminal transitions (staging ready / failed) always apply immediately.
    const onSseUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const now = Date.now();
      const terminal = detail.isStagingReady ||
        (typeof detail.message === 'string' && detail.message.toLowerCase().includes('failed'));
      if (!terminal && now - lastPushAt < 500) return;
      lastPushAt = now;
      applyLiveStatus(detail);
    };
    window.addEventListener('sse-migration-update', onSseUpdate);

    const startPolling = () => {
      if (pollInterval) return;
      pollInterval = setInterval(checkStatus, 10000);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
        checkStatus();
      } else {
        stopPolling();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    startPolling();
    checkStatus();

    return () => {
      stopPolling();
      window.removeEventListener('sse-migration-update', onSseUpdate);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, loadStagingData]);

  if (!isOpen) return null;

  const statRows = [
    { label: '💊 Medicines', value: summary.medicines },
    { label: '📦 Inventory batches', value: summary.inventory },
    { label: '🛒 Purchases', value: summary.purchases },
    { label: '💰 Sales', value: summary.sales },
    { label: '🔄 Returns', value: summary.returns },
    { label: '🏢 Distributors', value: summary.distributors },
    { label: '👥 Customers', value: summary.customers },
    { label: '🩺 Doctors', value: summary.doctors },
  ].filter(r => r.value > 0);

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase === 'review' ? onClose : undefined}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl bg-bg2 border border-border shadow-2xl flex flex-col z-10"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <div>
            <h3 className="text-lg font-semibold text-text">
              {phase === 'review' && 'Review & Map Columns'}
              {phase === 'importing' && 'Importing Data...'}
              {phase === 'staging' && 'Review Staging Data'}
              {phase === 'finalizing' && 'Committing to Live Database...'}
              {phase === 'success' && 'Import Complete!'}
              {phase === 'error' && 'Import Failed'}
            </h3>
            <p className="text-xs text-muted mt-0.5 font-mono">{fileEntry.originalName}</p>
          </div>
          {(phase === 'review' || phase === 'staging') && (
            <button onClick={onClose} className="text-muted hover:text-text transition-colors">
              ✕
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 relative">
          <AnimatePresence mode="wait">

            {phase === 'review' && (
              <motion.div key="review" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-6">
                {['zip', 'sql', 'gz', 'tgz', 'db'].includes(fileEntry.ext) ? (
                  <div className="p-8 rounded-xl bg-sky/5 border border-sky/20 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-sky/10 flex items-center justify-center text-sky">
                      <Database size={32} />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-text">Database Backup / SQL Dump Detected</h4>
                      <p className="text-sm text-muted mt-1 max-w-md">
                        Column mapping is not required. Import writes to a staging database first — you will review counts and conflicts before committing to the live database.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <ModuleSection
                      dataType={fileEntry.userSelectedType}
                      label={getModuleLabel(fileEntry.userSelectedType)}
                      totalRows={fileEntry.totalRows || fileEntry.samples.length}
                      headers={fileEntry.headers}
                      mapping={mappings}
                      onMappingChange={handleMappingChange}
                      validationErrors={validation.errors}
                      requiredFields={getRequiredFields(fileEntry.userSelectedType)}
                      missingRequired={validation.missingRequired}
                      samples={fileEntry.samples}
                    />
                    {validation.errors.length > 0 && (
                      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-semibold">Format Warnings Detected</p>
                          <p className="opacity-90 mt-0.5">
                            {validation.errors.length} formatting anomalies found in the sample rows. Review mappings before continuing.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {phase === 'importing' && (
              <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
                <Loader2 className="w-16 h-16 text-sky animate-spin" />
                <div className="space-y-2">
                  <h4 className="text-lg font-medium text-text">Writing to Staging Database</h4>
                  <p className="text-sm text-muted max-w-md h-5 font-mono">{status?.message || 'Processing rows...'}</p>
                </div>
                {status && (
                  <div className="w-full max-w-md space-y-2">
                    <div className="relative h-2 bg-bg3/60 rounded-full overflow-hidden border border-glass-border">
                      <motion.div className="absolute top-0 bottom-0 left-0 bg-sky" animate={{ width: `${status.progress || 0}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted font-mono">
                      <span>{status.progress || 0}% Completed</span>
                      {status.errorCount > 0 && <span className="text-rose-400">{status.errorCount} skips/errors</span>}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {phase === 'staging' && (
              <motion.div key="staging" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-5">
                <div className="p-4 rounded-xl bg-sky/5 border border-sky/20">
                  <p className="text-sm text-text">
                    Import finished into <span className="font-mono text-sky">staging.db</span>. Review the counts below before committing. A backup of your current database will be created automatically.
                  </p>
                </div>

                {statRows.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {statRows.map(row => (
                      <div key={row.label} className="p-3 rounded-lg bg-bg3/40 border border-glass-border text-center">
                        <p className="text-xs text-muted">{row.label}</p>
                        <p className="text-lg font-mono font-semibold text-text mt-1">{row.value.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}

                {(summary.errors > 0 || summary.conflicts > 0 || importWarnings.length > 0 || stagingErrors.length > 0) && (
                  <div className="space-y-3">
                    {importStats && (
                      <div className="p-3 rounded-lg bg-bg3/40 border border-glass-border text-sm text-muted">
                        File validation: {importStats.validRows.toLocaleString()} valid / {importStats.totalRows.toLocaleString()} total rows
                        {importStats.errorRows > 0 && ` (${importStats.errorRows.toLocaleString()} skipped)`}
                      </div>
                    )}
                    {importWarnings.map((w, i) => (
                      <div key={i} className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-start gap-2">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                    {summary.errors > 0 && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={16} />
                          <span>{summary.errors.toLocaleString()} row(s) were skipped due to missing required information or validation errors.</span>
                        </div>
                        {stagingErrors.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowErrorsExpanded(!showErrorsExpanded)}
                            className="text-xs underline hover:text-amber-300 ml-2"
                          >
                            {showErrorsExpanded ? 'Hide Details' : 'View Skipped Reasons'}
                          </button>
                        )}
                      </div>
                    )}

                    {stagingErrors.length > 0 && showErrorsExpanded && (
                      <div className="border border-glass-border rounded-xl overflow-hidden bg-bg3/20">
                        <div className="px-4 py-2 bg-bg3/60 border-b border-glass-border flex items-center justify-between text-xs font-semibold text-text uppercase tracking-wider">
                          <span>Skipped Records Audit Log ({stagingErrors.length})</span>
                          <span className="text-muted font-mono font-normal lowercase">no placeholder records created</span>
                        </div>
                        <div className="divide-y divide-glass-border/30 max-h-56 overflow-y-auto">
                          {stagingErrors.map((err, idx) => (
                            <div key={err.id || idx} className="p-3 text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-muted">Row #{err.row_index} {err.file_name ? `(${err.file_name})` : ''}</span>
                                <span className="text-rose-400 font-medium">{err.error_message}</span>
                              </div>
                              {err.raw_data && (
                                <p className="font-mono text-[11px] text-muted truncate max-w-full bg-bg/50 px-2 py-1 rounded">
                                  {typeof err.raw_data === 'string' ? err.raw_data : JSON.stringify(err.raw_data)}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {auditSummary && (auditSummary.unresolvedCustomers > 0 || auditSummary.unresolvedDoctors > 0 || auditSummary.unresolvedMedicines > 0 || stagingAudits.length > 0) && (
                      <div className="space-y-2">
                        <div className="p-3 rounded-lg bg-sky/10 border border-sky/30 text-sky text-sm flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Database size={16} />
                            <span>
                              Relationship Audit: {auditSummary.unresolvedCustomers} unresolved customer(s), {auditSummary.unresolvedDoctors} unresolved doctor(s){auditSummary.unresolvedMedicines > 0 ? `, ${auditSummary.unresolvedMedicines} unresolved medicine(s) — sale items skipped` : ''} (Preserved with NULL · 0 phantom IDs)
                            </span>
                          </div>
                          {stagingAudits.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowAuditsExpanded(!showAuditsExpanded)}
                              className="text-xs underline hover:text-sky-300 ml-2"
                            >
                              {showAuditsExpanded ? 'Hide Audit Log' : 'View Audit Log'}
                            </button>
                          )}
                        </div>

                        {stagingAudits.length > 0 && showAuditsExpanded && (
                          <div className="border border-glass-border rounded-xl overflow-hidden bg-bg3/20">
                            <div className="px-4 py-2 bg-bg3/60 border-b border-glass-border flex items-center justify-between text-xs font-semibold text-text uppercase tracking-wider">
                              <span>Relationship Integrity Audit ({stagingAudits.length})</span>
                              <span className="text-sky font-mono font-normal lowercase">preserved NULL / safe skip</span>
                            </div>
                            <div className="divide-y divide-glass-border/30 max-h-56 overflow-y-auto">
                              {stagingAudits.map((aud, idx) => (
                                <div key={aud.id || idx} className="p-3 text-xs space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-muted">
                                      {aud.record_type.toUpperCase()} #{aud.record_identifier} {aud.file_name ? `(${aud.file_name})` : ''}
                                    </span>
                                    <span className={`font-medium ${aud.status === 'skipped' ? 'text-amber-400' : 'text-sky'}`}>
                                      {aud.status === 'skipped' ? 'SKIPPED' : 'PRESERVED NULL'}
                                    </span>
                                  </div>
                                  <p className="text-text font-mono text-[11px]">
                                    {aud.reason}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {summary.conflicts > 0 && (
                      <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
                        <AlertCircle size={16} />
                        {summary.conflicts} duplicate batch conflict(s) need resolution before commit.
                      </div>
                    )}
                  </div>
                )}

                <div className="p-4 rounded-xl border border-glass-border bg-bg3/30 space-y-2">
                  <label className="text-sm font-medium text-text">Report cutover date (GST/P&amp;L)</label>
                  <p className="text-xs text-muted">Sales and purchase reports will exclude transactions before this date. Pre-migration history stays in the database but won&apos;t appear in financial reports.</p>
                  <input
                    type="date"
                    value={toDateInputValue(reportCutoverDate)}
                    onChange={(e) => setReportCutoverDate(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-bg border border-glass-border text-text text-sm"
                  />
                </div>

                {stagingConflicts.length > 0 && (
                  <div className="border border-glass-border rounded-xl overflow-hidden">
                    <div className="px-4 py-2 bg-bg3/60 border-b border-glass-border text-sm font-medium text-text">
                      Batch Conflicts ({stagingConflicts.length})
                    </div>
                    <div className="divide-y divide-glass-border/30 max-h-48 overflow-y-auto">
                      {stagingConflicts.map(c => {
                        let imported: any = {};
                        try { imported = JSON.parse(c.raw_imported_data); } catch (_) {}
                        return (
                          <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <p className="font-medium text-text truncate">{c.existing_medicine_name || 'Unknown'}</p>
                              <p className="text-xs text-muted font-mono">
                                Batch {c.existing_batch_no} · existing qty {c.existing_quantity ?? 0} → import qty {imported.quantity ?? 0}
                              </p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              {(['merge', 'overwrite', 'skip'] as const).map(action => (
                                <button
                                  key={action}
                                  disabled={resolvingConflictId === c.id}
                                  onClick={() => handleResolveConflict(c.id, action)}
                                  className="px-2 py-1 rounded text-xs border border-glass-border hover:bg-bg3/60 text-text capitalize disabled:opacity-50"
                                >
                                  {action}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {phase === 'finalizing' && (
              <motion.div key="finalizing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
                <Loader2 className="w-16 h-16 text-sky animate-spin" />
                <h4 className="text-lg font-medium text-text">Swapping staging database to live...</h4>
                <p className="text-sm text-muted">Creating backup and rebuilding search indexes.</p>
              </motion.div>
            )}

            {phase === 'success' && (
              <motion.div key="success" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col items-center justify-center py-8 space-y-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xl font-semibold text-text">Migration Complete!</h4>
                  <p className="text-sm text-muted">Records committed to the live pharmacy database. No placeholder entities were created.</p>
                </div>
                <div className="w-full max-w-lg border border-glass-border rounded-xl overflow-hidden bg-bg3/20">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-bg3/60 text-muted border-b border-glass-border">
                        <th className="px-4 py-2 font-medium">Status / Entity</th>
                        <th className="px-4 py-2 font-medium text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-glass-border/30 text-text/90">
                      {statRows.map(row => (
                        <tr key={row.label}>
                          <td className="px-4 py-2.5">{row.label} (Migrated)</td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{row.value.toLocaleString()}</td>
                        </tr>
                      ))}
                      {summary.errors > 0 && (
                        <tr>
                          <td className="px-4 py-2.5 text-rose-400">⚠️ Skipped / Missing Info</td>
                          <td className="px-4 py-2.5 text-right font-mono text-rose-400">{summary.errors.toLocaleString()}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {stagingErrors.length > 0 && (
                  <div className="w-full max-w-lg text-left border border-glass-border rounded-xl overflow-hidden bg-bg3/20">
                    <div className="px-4 py-2 bg-bg3/60 border-b border-glass-border text-xs font-semibold text-text uppercase">
                      Exact Reason for Skipped Records ({stagingErrors.length})
                    </div>
                    <div className="divide-y divide-glass-border/30 max-h-40 overflow-y-auto p-2">
                      {stagingErrors.map((err, idx) => (
                        <div key={err.id || idx} className="py-1.5 px-2 text-xs">
                          <span className="font-mono text-muted">Row #{err.row_index}: </span>
                          <span className="text-rose-400">{err.error_message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {phase === 'error' && (
              <motion.div key="error" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col items-center justify-center py-8 space-y-6 text-center">
                <div className="w-16 h-16 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <AlertCircle className="w-10 h-10" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xl font-semibold text-text">Import Process Failed</h4>
                  <p className="text-sm text-rose-400 bg-rose-500/5 border border-rose-500/20 px-4 py-2 rounded-lg max-w-lg font-mono">
                    {errorMessage || 'Unknown error'}
                  </p>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        <div className="px-6 py-4 border-t border-glass-border flex justify-end gap-3 bg-bg3/20 h-16 items-center shrink-0">
          <AnimatePresence mode="wait">
            {phase === 'review' && (
              <motion.div key="review-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-end gap-3 w-full">
                <button onClick={onClose} className="px-4 py-2 rounded-lg border border-glass-border text-text text-sm hover:bg-bg3/60">Cancel</button>
                <button
                  disabled={validating || (!validation.requiredFieldsMapped && !['zip', 'sql', 'gz', 'tgz', 'db'].includes(fileEntry.ext))}
                  onClick={handleStartImport}
                  className={`px-5 py-2 rounded-lg text-white font-medium text-sm flex items-center gap-2 ${
                    validation.requiredFieldsMapped || ['zip', 'sql', 'gz', 'tgz', 'db'].includes(fileEntry.ext)
                      ? 'bg-sky hover:bg-sky/90 cursor-pointer'
                      : 'bg-muted cursor-not-allowed opacity-50'
                  }`}
                >
                  {validating ? <><Loader2 size={16} className="animate-spin" /> Validating...</> : <>Import to Staging <ArrowRight size={16} /></>}
                </button>
              </motion.div>
            )}

            {phase === 'staging' && (
              <motion.div key="staging-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-between w-full">
                <button onClick={handleDiscardStaging} className="px-4 py-2 rounded-lg border border-rose-500/30 text-rose-400 text-sm hover:bg-rose-500/10 flex items-center gap-2">
                  <XCircle size={14} /> Discard Staging
                </button>
                <button
                  onClick={handleFinalize}
                  disabled={summary.conflicts > 0}
                  className={`px-5 py-2 rounded-lg text-white font-medium text-sm flex items-center gap-2 ${
                    summary.conflicts > 0 ? 'bg-muted cursor-not-allowed opacity-50' : 'bg-emerald-600 hover:bg-emerald-500 cursor-pointer'
                  }`}
                  title={summary.conflicts > 0 ? 'Resolve all batch conflicts before committing' : 'Commit staging data to live database'}
                >
                  Commit to Live Database <ArrowRight size={16} />
                </button>
              </motion.div>
            )}

            {phase === 'success' && (
              <motion.div key="success-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <button onClick={onClose} className="px-6 py-2 rounded-lg bg-sky hover:bg-sky/90 text-white font-medium text-sm">Done</button>
              </motion.div>
            )}

            {phase === 'error' && (
              <motion.div key="error-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <button onClick={() => setPhase('review')} className="px-5 py-2 rounded-lg bg-sky hover:bg-sky/90 text-white font-medium text-sm flex items-center gap-2">
                  <RefreshCw size={14} /> Try Again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
