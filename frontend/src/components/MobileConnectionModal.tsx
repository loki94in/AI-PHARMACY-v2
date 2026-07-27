import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, QrCode, RefreshCw, AlertCircle, Copy, Check, Smartphone, Edit2, Save, Wifi, WifiOff } from 'lucide-react';
import { api } from '../services/api';

interface DeviceItem {
  token: string;
  device_name: string;
  os: string;
  is_online: number;
  last_seen: string;
  offline_seconds?: number;
}

interface Props {
  onClose: () => void;
}

export const MobileConnectionModal: React.FC<Props> = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ ips: string[]; port: string | number; serverUrls: string[]; qrCodeUrl: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Registered devices state
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [renamingToken, setRenamingToken] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  const fetchConnectionInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const [connData, devData] = await Promise.all([
        api.getConnectionInfo().catch(() => null),
        api.getRegisteredDevices().catch(() => null),
      ]);

      if (connData && connData.success) {
        setInfo(connData);
      } else {
        setError('Failed to fetch connection details.');
      }

      if (devData && Array.isArray(devData.devices)) {
        setDevices(devData.devices);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.error || err.message || 'Failed to fetch connection details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectionInfo();
    const interval = setInterval(async () => {
      try {
        const devData = await api.getRegisteredDevices();
        if (devData && Array.isArray(devData.devices)) {
          setDevices(devData.devices);
        }
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleStartRename = (dev: DeviceItem) => {
    setRenamingToken(dev.token);
    setRenameText(dev.device_name || '');
  };

  const handleSaveRename = async (token: string) => {
    if (!renameText.trim()) return;
    setSavingRename(true);
    try {
      await api.renameDevice(token, renameText.trim());
      setDevices(prev =>
        prev.map(d => (d.token === token ? { ...d, device_name: renameText.trim() } : d))
      );
      setRenamingToken(null);
    } catch (err) {
      console.error('Failed to rename device:', err);
    } finally {
      setSavingRename(false);
    }
  };

  const renderPlatformBadge = (osStr: string) => {
    const lower = osStr.toLowerCase();
    if (lower.includes('ios') || lower.includes('iphone') || lower.includes('ipad') || lower.includes('apple')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-white border border-white/20">
           Apple iOS
        </span>
      );
    }
    if (lower.includes('android')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          🤖 Android
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">
        🌐 Web / Mobile
      </span>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative bg-[#18181b] border border-glass-border rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden slide-up max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-glass-border bg-white/5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <QrCode size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white leading-tight">Mobile Device Management</h3>
              <p className="text-xs text-muted mt-0.5">Persistent connection, QR setup & device naming</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-muted hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted">
              <RefreshCw size={32} className="animate-spin mb-4 text-primary" />
              <p className="text-sm font-medium">Detecting network interfaces & devices...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red/10 border border-red/20 flex items-start gap-3">
              <AlertCircle className="text-red shrink-0" size={20} />
              <div className="space-y-2">
                <p className="text-sm text-red">{error}</p>
                <button
                  onClick={fetchConnectionInfo}
                  className="flex items-center gap-1.5 text-xs text-red hover:underline font-bold"
                >
                  <RefreshCw size={12} />
                  <span>Try Again</span>
                </button>
              </div>
            </div>
          ) : info ? (
            <div className="space-y-6">
              {/* Registered Devices List */}
              {devices.length > 0 && (
                <div className="w-full space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Smartphone size={14} className="text-primary" />
                      <span>Registered Connected Devices ({devices.length})</span>
                    </h4>
                    <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Persistent Auto-Sync
                    </span>
                  </div>

                  <div className="space-y-2">
                    {devices.map(dev => {
                      const isEditing = renamingToken === dev.token;
                      const isOnline = dev.is_online === 1;

                      return (
                        <div
                          key={dev.token}
                          className="flex items-center justify-between p-3 rounded-xl bg-bg2/60 border border-glass-border hover:border-primary/40 transition-all"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0 mr-2">
                            <div className="relative">
                              <div className="w-9 h-9 rounded-xl bg-white/5 border border-glass-border flex items-center justify-center text-white">
                                <Smartphone size={18} />
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#18181b] ${
                                  isOnline ? 'bg-emerald-500' : 'bg-rose-500'
                                }`}
                              />
                            </div>

                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={renameText}
                                    onChange={e => setRenameText(e.target.value)}
                                    className="bg-bg border border-primary px-2 py-1 rounded text-xs text-white outline-none w-full"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => handleSaveRename(dev.token)}
                                    disabled={savingRename}
                                    className="p-1 rounded bg-primary text-white hover:bg-primary/80"
                                  >
                                    <Save size={14} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-sm text-white truncate">
                                    {dev.device_name}
                                  </span>
                                  <button
                                    onClick={() => handleStartRename(dev)}
                                    className="text-muted hover:text-white transition-colors"
                                    title="Rename device"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                </div>
                              )}

                              <div className="flex items-center gap-2 mt-0.5">
                                {renderPlatformBadge(dev.os)}
                                <span className="text-[11px] text-muted">
                                  {isOnline ? (
                                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                      <Wifi size={10} /> Online
                                    </span>
                                  ) : (
                                    <span className="text-muted flex items-center gap-1">
                                      <WifiOff size={10} /> Offline ({Math.round((dev.offline_seconds || 0) / 60)}m ago)
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* QR Code Container */}
              <div className="w-full flex flex-col items-center pt-2">
                <div className="p-4 bg-white rounded-2xl border-4 border-primary/25 shadow-[0_0_25px_rgba(108,99,255,0.15)] flex justify-center items-center">
                  <img 
                    src={info.qrCodeUrl} 
                    alt="Connection QR Code" 
                    className="w-52 h-52 object-contain"
                  />
                </div>

                <div className="w-full text-center space-y-1.5 mt-3">
                  <p className="text-xs text-muted leading-relaxed">
                    Scan once to pair phone with PC. Device auto-connects persistently without rescanning.
                  </p>
                  <p className="text-[10px] text-amber-500 font-semibold bg-amber-500/10 border border-amber-500/20 py-1 px-3 rounded-lg inline-block">
                    Note: Both PC and mobile must be on the same Wi-Fi network.
                  </p>
                </div>
              </div>

              {/* Manual Entry Section */}
              <div className="w-full space-y-2.5 pt-4 border-t border-glass-border">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Manual Connection URLs</h4>
                <div className="space-y-1.5">
                  {info.serverUrls.map((url, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between p-2 rounded-xl bg-bg2/40 border border-glass-border"
                    >
                      <span className="font-mono text-xs text-muted truncate select-all">{url}</span>
                      <button
                        onClick={() => copyToClipboard(url)}
                        className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-all"
                        title="Copy to clipboard"
                      >
                        {copiedUrl === url ? (
                          <Check size={14} className="text-emerald-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-glass-border bg-black/40 flex justify-end shrink-0">
          <button 
            type="button" 
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl border border-glass-border hover:bg-white/10 text-muted hover:text-white font-semibold transition-colors w-full"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
