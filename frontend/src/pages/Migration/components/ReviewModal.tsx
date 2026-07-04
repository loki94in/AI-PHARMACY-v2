import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, ArrowRight, CheckCircle, AlertTriangle, AlertCircle, RefreshCw, Database } from 'lucide-react';
import { ModuleSection } from './ModuleSection';
import { api } from '../../../services/api';

interface FileEntry {
  uploadedFileName: string;
  originalName: string;
  ext: string;
  headers: string[];
  samples: any[];
  detected: { type: string; confidence: number };
  userSelectedType: string;
  mapping: Record<string, string>;
  status: 'pending' | 'analyzing' | 'ready' | 'error';
  errorMsg?: string;
}

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileEntry: FileEntry;
  onUpdateFile: (updated: FileEntry) => void;
}

type ModalPhase = 'review' | 'importing' | 'success' | 'error';

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  fileEntry,
  onUpdateFile
}) => {
  const [phase, setPhase] = useState<ModalPhase>('review');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Mappings local state for editing
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<any>({
    errors: [],
    requiredFieldsMapped: false,
    missingRequired: []
  });
  const [validating, setValidating] = useState(false);

  // Migration status and results
  const [status, setStatus] = useState<any>(null);
  const [summary, setSummary] = useState({
    inventory: 0,
    purchases: 0,
    sales: 0,
    returns: 0,
    errors: 0
  });

  // Required fields configuration based on file data type
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

  // Sync mapping state with fileEntry
  useEffect(() => {
    if (isOpen && fileEntry) {
      setMappings(fileEntry.mapping || {});
      setPhase('review');
      setErrorMessage(null);
    }
  }, [isOpen, fileEntry]);

  // Run validation check when mappings change
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
    // Propagate up
    onUpdateFile({
      ...fileEntry,
      mapping: updated
    });
  };

  // Start background import
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

  // Poll migration worker status
  useEffect(() => {
    if (phase !== 'importing') return;

    let pollInterval: any;
    
    const checkStatus = async () => {
      try {
        const liveStatus = await api.getMigrationStatus();
        setStatus(liveStatus);

        if (liveStatus.isStagingReady) {
          clearInterval(pollInterval);
          // Auto finalize staging
          handleFinalize();
        } else if (liveStatus.message && liveStatus.message.toLowerCase().includes('failed')) {
          clearInterval(pollInterval);
          setPhase('error');
          setErrorMessage(liveStatus.message);
        }
      } catch (err: any) {
        console.error('Status polling error:', err);
      }
    };

    pollInterval = setInterval(checkStatus, 1500);
    checkStatus(); // Initial call

    return () => clearInterval(pollInterval);
  }, [phase]);

  const handleFinalize = async () => {
    try {
      // Get counts from staging before final swap
      try {
        const invData = await api.getStagingInventory();
        const purData = await api.getStagingPurchases();
        const salData = await api.getStagingSales();
        const retData = await api.getStagingReturns();
        const errData = await api.getStagingErrors();

        setSummary({
          inventory: Array.isArray(invData) ? invData.length : 0,
          purchases: Array.isArray(purData) ? purData.length : 0,
          sales: Array.isArray(salData) ? salData.length : 0,
          returns: Array.isArray(retData) ? retData.length : 0,
          errors: Array.isArray(errData) ? errData.length : 0
        });
      } catch (e) {
        console.warn('Failed to fetch counts from staging db', e);
      }

      const res = await api.finalizeMigration(false);
      if (res.success) {
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

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={phase === 'review' ? onClose : undefined} />
      
      {/* Modal Container */}
      <div className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl bg-bg2 border border-border shadow-2xl flex flex-col z-10">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <div>
            <h3 className="text-lg font-semibold text-text">
              {phase === 'review' && 'Review & Map Columns'}
              {phase === 'importing' && 'Importing Data...'}
              {phase === 'success' && 'Import Complete!'}
              {phase === 'error' && 'Import Failed'}
            </h3>
            <p className="text-xs text-muted mt-0.5 font-mono">{fileEntry.originalName}</p>
          </div>
          {phase === 'review' && (
            <button onClick={onClose} className="text-muted hover:text-text transition-colors">
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Phase: Review */}
          {phase === 'review' && (
            <div className="space-y-6">
              {['zip', 'sql', 'gz', 'tgz'].includes(fileEntry.ext) ? (
                <div className="p-8 rounded-xl bg-sky/5 border border-sky/20 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-sky/10 flex items-center justify-center text-sky">
                    <Database size={32} />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-text">Database Backup / SQL Dump Detected</h4>
                    <p className="text-sm text-muted mt-1 max-w-md">
                      This file contains a full database schema or automated SQL backup. Column mapping is not required. Click "Import Now" to restore or merge this data.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <ModuleSection
                    dataType={fileEntry.userSelectedType}
                    label={getModuleLabel(fileEntry.userSelectedType)}
                    totalRows={fileEntry.samples.length} // placeholder total rows
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
                          We detected {validation.errors.length} formatting anomalies in your mapping configuration. Click "Show Errors" in the section above to inspect rows before continuing.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Phase: Importing */}
          {phase === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center">
              <Loader2 className="w-16 h-16 text-sky animate-spin" />
              <div className="space-y-2">
                <h4 className="text-lg font-medium text-text">Writing to Staging Database</h4>
                <p className="text-sm text-muted max-w-md">
                  {status?.message || 'Processing rows and building relationships...'}
                </p>
              </div>

              {/* Progress Bar */}
              {status && (
                <div className="w-full max-w-md space-y-2">
                  <div className="relative h-2 bg-bg3/60 rounded-full overflow-hidden border border-glass-border">
                    <div 
                      className="absolute top-0 bottom-0 left-0 bg-sky transition-all duration-300"
                      style={{ width: `${status.progress || 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted font-mono">
                    <span>{status.progress || 0}% Completed</span>
                    {status.errorCount > 0 && (
                      <span className="text-rose-400">{status.errorCount} skips/errors</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Phase: Success */}
          {phase === 'success' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xl font-semibold text-text">Migration Complete!</h4>
                <p className="text-sm text-muted">All staging records successfully committed to main database.</p>
              </div>

              {/* Import Results Table */}
              <div className="w-full max-w-md border border-glass-border rounded-xl overflow-hidden bg-bg3/20">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-bg3/60 text-muted border-b border-glass-border">
                      <th className="px-4 py-2 font-medium">Module</th>
                      <th className="px-4 py-2 font-medium text-right">Imported Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-glass-border/30 text-text/90">
                    {summary.inventory > 0 && (
                      <tr>
                        <td className="px-4 py-2.5 font-medium">📦 Inventory</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{summary.inventory}</td>
                      </tr>
                    )}
                    {summary.purchases > 0 && (
                      <tr>
                        <td className="px-4 py-2.5 font-medium">🛒 Purchases</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{summary.purchases}</td>
                      </tr>
                    )}
                    {summary.sales > 0 && (
                      <tr>
                        <td className="px-4 py-2.5 font-medium">💰 Sales Invoices</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{summary.sales}</td>
                      </tr>
                    )}
                    {summary.returns > 0 && (
                      <tr>
                        <td className="px-4 py-2.5 font-medium">🔄 Returns / Expiry</td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{summary.returns}</td>
                      </tr>
                    )}
                    {summary.errors > 0 && (
                      <tr className="bg-rose-500/5">
                        <td className="px-4 py-2.5 font-medium text-rose-400">⚠️ Skipped / Errors</td>
                        <td className="px-4 py-2.5 text-right font-mono text-rose-400">{summary.errors}</td>
                      </tr>
                    )}
                    {summary.inventory === 0 && summary.purchases === 0 && summary.sales === 0 && summary.returns === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-center text-muted italic" colSpan={2}>
                          No records were written to staging
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Phase: Error */}
          {phase === 'error' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6 text-center">
              <div className="w-16 h-16 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <AlertCircle className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h4 className="text-xl font-semibold text-text animate-pulse">Import Process Encountered a Crash</h4>
                <p className="text-sm text-rose-400 bg-rose-500/5 border border-rose-500/20 px-4 py-2 rounded-lg max-w-lg font-mono">
                  {errorMessage || 'Unknown background processing error'}
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-glass-border flex justify-end gap-3 bg-bg3/20">
          {phase === 'review' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-glass-border text-text text-sm hover:bg-bg3/60 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={validating || (!validation.requiredFieldsMapped && !['zip', 'sql', 'gz', 'tgz'].includes(fileEntry.ext))}
                onClick={handleStartImport}
                className={`px-5 py-2 rounded-lg text-white font-medium text-sm flex items-center gap-2 transition-all ${
                  validation.requiredFieldsMapped || ['zip', 'sql', 'gz', 'tgz'].includes(fileEntry.ext)
                    ? 'bg-sky hover:bg-sky/90 cursor-pointer shadow-lg shadow-sky/15'
                    : 'bg-muted cursor-not-allowed opacity-50'
                }`}
              >
                {validating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    Import Now
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </>
          )}

          {phase === 'success' && (
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg bg-sky hover:bg-sky/90 text-white font-medium text-sm transition-colors cursor-pointer"
            >
              Done
            </button>
          )}

          {phase === 'error' && (
            <button
              onClick={() => setPhase('review')}
              className="px-5 py-2 rounded-lg bg-sky hover:bg-sky/90 text-white font-medium text-sm flex items-center gap-2 transition-colors cursor-pointer"
            >
              <RefreshCw size={14} />
              Try Again / Fix Columns
            </button>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
};
