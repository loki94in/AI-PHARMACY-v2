import React, { useState } from 'react';
import { Database, RefreshCw, Play, Clock, HardDrive, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../../services/api';
import { useApiQuery } from '../../../hooks/useApiQuery';

export interface LocalBackup {
  name: string;
  fullPath: string;
  sourceLabel: string;
  sizeBytes: number;
  lastModified: string;
  ext: string;
  isDbDump: boolean;
}

interface LocalBackupPanelProps {
  onRunMigration: (backup: LocalBackup) => void;
}

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

export const LocalBackupPanel: React.FC<LocalBackupPanelProps> = ({ onRunMigration }) => {
  const [startingPath, setStartingPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isFetching, error: queryError, refetch } = useApiQuery<LocalBackup[], Error>(
    ['local-backups'],
    async () => {
      const res = await api.getLocalBackups();
      if (res.success) {
        return res.backups || [];
      }
      throw new Error(res.error || 'Failed to scan local backup folders');
    },
  );
  const backups = data || [];
  const loading = isFetching;
  const error = queryError?.message || actionError;
  const fetchBackups = () => refetch();

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return isoStr;
    }
  };

  const handleRun = async (backup: LocalBackup) => {
    setStartingPath(backup.fullPath);
    setActionError(null);
    try {
      await api.runLocalBackupMigration(backup.fullPath, backup.name);
      onRunMigration(backup);
    } catch (err) {
      const e = err as LocalApiError;
      setActionError(e.message || 'Failed to start local backup migration');
    } finally {
      setStartingPath(null);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-glass-bg border border-glass-border rounded-xl p-6 shadow-xl relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-glass-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky/10 border border-sky/20 flex items-center justify-center text-sky">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text flex items-center gap-2">
              Local RedBook & DGH Backups
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sky/15 text-sky border border-sky/30">
                {backups.length}
              </span>
            </h3>
            <p className="text-sm text-muted">Auto-detected backup files from system drives</p>
          </div>
        </div>

        <button
          onClick={fetchBackups}
          disabled={loading}
          className="p-2 rounded-lg border border-glass-border text-muted hover:text-text hover:bg-bg3/60 transition-all cursor-pointer disabled:opacity-50"
          title="Rescan backup directories"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body List */}
      <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-3 min-h-[300px] max-h-[420px]">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center space-y-3"
            >
              <Loader2 className="w-8 h-8 text-sky animate-spin" />
              <p className="text-base text-muted">Scanning D:\redbook, DGH_Backup & local folders...</p>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 flex flex-col items-center gap-3"
            >
              <div className="flex items-start gap-3 w-full">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-base text-left">
                  <p className="font-medium">Backup Scanner Error</p>
                  <p className="opacity-90 mt-0.5 text-sm">{error}</p>
                </div>
              </div>
              <button
                onClick={fetchBackups}
                disabled={loading}
                className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg text-sm font-bold uppercase transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Retry Scan
              </button>
            </motion.div>
          ) : backups.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center text-muted space-y-2 border border-dashed border-glass-border rounded-lg"
            >
              <HardDrive className="w-10 h-10 opacity-40" />
              <p className="text-base font-medium text-text">No Local Backup Files Found</p>
              <p className="text-sm max-w-xs">
                Place SQL dumps or ZIP archives in <code className="text-sky bg-bg3/60 px-1 py-0.5 rounded">D:\redbook\DGH_Backup</code> to enable 1-click auto-import.
              </p>
            </motion.div>
          ) : (
            backups.map((backup, index) => {
              const isStarting = startingPath === backup.fullPath;
              return (
                <motion.div
                  key={backup.fullPath + index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="p-3.5 rounded-xl bg-bg2 border border-glass-border hover:border-border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-lg bg-bg3 flex items-center justify-center text-sky shrink-0 mt-0.5 sm:mt-0">
                      <Database className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-base font-medium text-text truncate group-hover:text-sky transition-colors" title={backup.name}>
                        {backup.name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted">
                        <span className="px-2 py-0.5 rounded bg-bg3 text-text/80 font-mono text-xs">
                          {backup.sourceLabel}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-text/70">{formatFileSize(backup.sizeBytes)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(backup.lastModified)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRun(backup)}
                    disabled={isStarting}
                    className="w-full sm:w-auto px-4 py-2 rounded-lg bg-sky hover:bg-sky/90 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-sky/10 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {isStarting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Run Auto Migration
                      </>
                    )}
                  </button>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Footer Info */}
      <div className="mt-4 pt-3 border-t border-glass-border/50 flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1 text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Multi-pass GZIP & SQL parser active
        </span>
        <button
          onClick={fetchBackups}
          className="hover:text-text underline cursor-pointer"
        >
          Rescan
        </button>
      </div>
    </div>
  );
};
