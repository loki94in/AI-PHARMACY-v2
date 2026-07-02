import React, { useState, useEffect } from 'react';
import {
  Shield,
  HardDrive,
  Cloud,
  Send,
  Database,
  RefreshCw,
  Play,
  Pause,
  Trash2,
  Clock,
  Settings,
  X,
  Download,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { apiClient } from '../services/api';
import { toastEvent } from '../services/events';

interface Archive {
  filename: string;
  date: string;
  sizeBytes: number;
  source: string;
}

interface BackupStatus {
  showRestorePopup: boolean;
  availableArchives: Archive[];
  localBackupStatus: string;
  gdriveStatus: string;
  telegramStatus: string;
  lastBackupDate: string;
  lastUploadDate: string;
  nextScheduledBackup: string;
  totalBackupSize: number;
  backupStorageLocations: {
    local: string;
    gdrive: string;
    telegram: string;
  };
  isPaused: boolean;
}

interface BackupCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  isStartupMode?: boolean;
}

const BackupCenterModal: React.FC<BackupCenterModalProps> = ({
  isOpen,
  onClose,
  isStartupMode = false,
}) => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/utilities/backup/status');
      if (data.success) {
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to load backup status:', err);
      toastEvent.trigger('Failed to retrieve backup system status', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualBackup = async () => {
    setActionLoading(true);
    try {
      const { data } = await apiClient.post('/utilities/backup/manual');
      if (data.success) {
        toastEvent.trigger('Manual backup and cloud upload completed successfully!', 'success');
        fetchStatus();
      }
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Manual backup failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async (filename: string) => {
    setActionLoading(true);
    try {
      const { data } = await apiClient.post('/utilities/backup/archive/restore', { filename });
      if (data.success) {
        toastEvent.trigger('Database successfully restored! Reloading application...', 'success');
        setConfirmRestore(null);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Restore failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (filename: string) => {
    setActionLoading(true);
    try {
      const { data } = await apiClient.delete(`/utilities/backup/archive/${encodeURIComponent(filename)}`);
      if (data.success) {
        toastEvent.trigger('Backup archive deleted from system', 'success');
        setConfirmDelete(null);
        fetchStatus();
      }
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Delete failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePause = async () => {
    setActionLoading(true);
    try {
      const { data } = await apiClient.post('/utilities/backup/toggle-pause');
      if (data.success) {
        toastEvent.trigger(data.message, 'success');
        fetchStatus();
      }
    } catch (err: any) {
      toastEvent.trigger(err.response?.data?.error || 'Failed to toggle pause status', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFreshInstall = async () => {
    setActionLoading(true);
    try {
      const { data } = await apiClient.post('/utilities/backup/fresh-install');
      if (data.success) {
        toastEvent.trigger('Fresh installation initialized.', 'success');
        onClose();
      }
    } catch (err: any) {
      toastEvent.trigger('Failed to initialize fresh install', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="bg-bg border border-glass-border rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border bg-bg3/50">
          <div className="flex items-center gap-2">
            <Shield className="text-sky animate-pulse" size={20} />
            <div>
              <h3 className="text-base font-bold text-text">Multi-Layer Backup & Recovery Center</h3>
              <p className="text-xs text-muted">Visibility and management of database safety layers</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted gap-2">
            <RefreshCw className="animate-spin text-sky" size={28} />
            <span className="text-xs font-semibold">Retrieving backup layers status...</span>
          </div>
        ) : status ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {isStartupMode && (
              <div className="bg-amber/10 border border-amber/25 p-4 rounded-xl flex gap-3 text-left">
                <AlertTriangle className="text-amber shrink-0 mt-0.5" size={18} />
                <div className="space-y-1.5">
                  <h4 className="text-xs font-black uppercase text-amber tracking-wider">New Installation Detected</h4>
                  <p className="text-[11px] text-muted leading-relaxed">
                    This computer appears to have a new installation with no existing pharmacy transaction records.
                    We have detected existing backups. You can restore data from an archive below or proceed with a fresh installation.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleFreshInstall}
                      disabled={actionLoading}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-text rounded text-[10px] font-black uppercase transition-all"
                    >
                      Continue Fresh Installation
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Status cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-bg2/40 border border-glass-border/30 p-4 rounded-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-sky/10 flex items-center justify-center flex-shrink-0">
                  <HardDrive className="text-sky" size={18} />
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Local Backup</p>
                  <p className="text-sm font-bold text-text">{status.localBackupStatus}</p>
                </div>
              </div>

              <div className="bg-bg2/40 border border-glass-border/30 p-4 rounded-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <Cloud className="text-green" size={18} />
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Google Drive</p>
                  <p className="text-sm font-bold text-text">{status.gdriveStatus}</p>
                </div>
              </div>

              <div className="bg-bg2/40 border border-glass-border/30 p-4 rounded-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center flex-shrink-0">
                  <Send className="text-sky" size={18} />
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Telegram Cloud</p>
                  <p className="text-sm font-bold text-text">{status.telegramStatus}</p>
                </div>
              </div>
            </div>

            {/* Storage Locations & Schedule Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-bg3 border border-glass-border rounded-xl p-4 space-y-3">
                <h4 className="text-[11px] font-black uppercase text-sky tracking-wider flex items-center gap-1.5 border-b border-glass-border/40 pb-1.5">
                  <Clock size={12} /> Backup Schedule Metrics
                </h4>
                <div className="grid grid-cols-2 gap-y-3.5 text-xs text-left">
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Last Backup</span>
                    <span className="font-semibold text-text">{status.lastBackupDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Last Upload</span>
                    <span className="font-semibold text-text">{status.lastUploadDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Next Scheduled Run</span>
                    <span className="font-semibold text-text">{status.nextScheduledBackup}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Total Backup Size</span>
                    <span className="font-semibold text-text">{formatFileSize(status.totalBackupSize)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-bg3 border border-glass-border rounded-xl p-4 space-y-3">
                <h4 className="text-[11px] font-black uppercase text-sky tracking-wider flex items-center gap-1.5 border-b border-glass-border/40 pb-1.5">
                  <Database size={12} /> Storage Sandbox Paths
                </h4>
                <div className="space-y-2.5 text-xs text-left">
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Local Archives Folder</span>
                    <span className="font-mono text-[10px] text-text bg-bg p-1 rounded block border border-glass-border/20 truncate">
                      {status.backupStorageLocations.local}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Google Drive Storage</span>
                    <span className="font-semibold text-text">{status.backupStorageLocations.gdrive}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase tracking-wider block">Telegram Notification Stream</span>
                    <span className="font-semibold text-text">{status.backupStorageLocations.telegram}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Archives List */}
            <div className="border border-glass-border/40 rounded-xl overflow-hidden text-left bg-bg3">
              <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border/30 bg-bg2/50">
                <h4 className="font-bold text-sm flex items-center gap-2">
                  <Database size={14} className="text-sky" /> Available Backup Archives
                  <span className="text-xs text-muted font-normal">({status.availableArchives.length})</span>
                </h4>
                <button
                  onClick={fetchStatus}
                  disabled={loading}
                  className="text-xs font-bold text-sky hover:text-sky/80 flex items-center gap-1 transition-colors"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>

              {status.availableArchives.length === 0 ? (
                <div className="p-8 text-center text-muted text-sm italic">No backup archives discovered.</div>
              ) : (
                <div className="overflow-x-auto max-h-60 custom-scrollbar">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bg border-b border-glass-border text-[10px] font-bold text-muted uppercase tracking-wider">
                        <th className="py-2.5 px-4 font-bold text-left">Archive Filename</th>
                        <th className="py-2.5 px-4 font-bold text-left">Created Date</th>
                        <th className="py-2.5 px-4 font-bold text-right">Size</th>
                        <th className="py-2.5 px-4 font-bold text-left">Targets / Layers</th>
                        <th className="py-2.5 px-4 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.availableArchives.map((archive) => (
                        <tr key={archive.filename} className="border-b border-glass-border/20 hover:bg-bg2/30 transition-all">
                          <td className="py-2.5 px-4 font-mono font-bold text-text truncate max-w-[200px]" title={archive.filename}>
                            {archive.filename}
                          </td>
                          <td className="py-2.5 px-4 text-muted">{archive.date}</td>
                          <td className="py-2.5 px-4 text-right text-muted">{formatFileSize(archive.sizeBytes)}</td>
                          <td className="py-2.5 px-4">
                            <span className="px-2 py-0.5 bg-green/10 text-green border border-green/20 rounded-full font-bold uppercase text-[9px]">
                              {archive.source}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <div className="flex justify-end gap-2">
                              {confirmRestore === archive.filename ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-amber font-black mr-1">RESTORE?</span>
                                  <button
                                    onClick={() => handleRestore(archive.filename)}
                                    disabled={actionLoading}
                                    className="text-[9px] font-bold bg-amber/20 text-amber px-2 py-0.5 rounded hover:bg-amber/30 transition-all disabled:opacity-50"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    onClick={() => setConfirmRestore(null)}
                                    className="text-[9px] font-bold bg-bg3/50 text-muted px-2 py-0.5 rounded hover:bg-bg3 transition-all"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmRestore(archive.filename)}
                                  disabled={actionLoading}
                                  className="text-[10px] font-bold bg-sky-500/10 text-sky px-2 py-0.5 rounded-full hover:bg-sky-500/25 transition-all flex items-center gap-1"
                                >
                                  <RotateCcw size={10} /> Restore
                                </button>
                              )}

                              {confirmDelete === archive.filename ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-[9px] text-red font-black mr-1">DELETE?</span>
                                  <button
                                    onClick={() => handleDelete(archive.filename)}
                                    disabled={actionLoading}
                                    className="text-[9px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded hover:bg-red-500/30 transition-all disabled:opacity-50"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    onClick={() => setConfirmDelete(null)}
                                    className="text-[9px] font-bold bg-bg3/50 text-muted px-2 py-0.5 rounded hover:bg-bg3 transition-all"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDelete(archive.filename)}
                                  disabled={actionLoading}
                                  className="text-[10px] font-bold bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full hover:bg-red-500/20 hover:text-red transition-all flex items-center gap-1"
                                >
                                  <Trash2 size={10} /> Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 py-16 text-center text-muted">Failed to retrieve status metrics.</div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-glass-border bg-bg3/50">
          {status && (
            <button
              onClick={handleTogglePause}
              disabled={actionLoading}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 ${
                status.isPaused
                  ? 'bg-green text-white hover:bg-emerald-600 shadow-[0_4px_14px_rgba(16,185,129,0.4)]'
                  : 'bg-amber text-white hover:bg-amber-600 shadow-[0_4px_14px_rgba(245,158,11,0.4)]'
              }`}
            >
              {status.isPaused ? (
                <>
                  <Play size={12} /> Resume Automatic Backups
                </>
              ) : (
                <>
                  <Pause size={12} /> Pause Automatic Backups
                </>
              )}
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleManualBackup}
              disabled={actionLoading || !!(status && status.isPaused)}
              className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-blue-500/25 disabled:opacity-40"
            >
              Create Manual Backup
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 border border-glass-border text-text rounded-xl text-xs font-bold uppercase transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackupCenterModal;
