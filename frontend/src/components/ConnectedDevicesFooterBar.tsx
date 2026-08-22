import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, QrCode, Wifi, WifiOff, Edit2, Save, X } from 'lucide-react';
import { api } from '../services/api';

export interface RegisteredDevice {
  token: string;
  device_name: string;
  os: string;
  is_online: number;
  last_seen: string;
  offline_seconds?: number;
}

interface ConnectedDevicesFooterBarProps {
  onOpenConnectModal: () => void;
}

export const ConnectedDevicesFooterBar: React.FC<ConnectedDevicesFooterBarProps> = ({
  onOpenConnectModal,
}) => {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [, setWaReady] = useState<boolean | null>(null);

  const fetchDevicesStatus = useCallback(async () => {
    try {
      if (typeof api.getRegisteredDevices === 'function') {
        const res = await api.getRegisteredDevices();
        if (res && Array.isArray(res.devices)) {
          setDevices(res.devices);
        }
      }
    } catch {
      // Ignore background fetch errors
    }
  }, []);

  const fetchWhatsAppStatus = useCallback(async () => {
    try {
      if (typeof api.getWhatsAppStatus === 'function') {
        const waRes = await api.getWhatsAppStatus();
        setWaReady(!!waRes?.isReady);
      }
    } catch {
      // Ignore background fetch errors
    }
  }, []);

  useEffect(() => {
    fetchDevicesStatus();
    fetchWhatsAppStatus();
    // P1 "events, not timers": slow fallback refresh ONLY while the tab is
    // visible; WA status also updates instantly via SSE push.
    const handleSse = () => fetchWhatsAppStatus();
    window.addEventListener('sse-wa-status-changed', handleSse);
    let devInterval: ReturnType<typeof setInterval> | null = null;
    let waInterval: ReturnType<typeof setInterval> | null = null;
    const startTimers = () => {
      if (document.visibilityState !== 'visible') return;
      if (!devInterval) devInterval = setInterval(fetchDevicesStatus, 120000);
      if (!waInterval) waInterval = setInterval(fetchWhatsAppStatus, 520000);
    };
    const stopTimers = () => {
      if (devInterval) { clearInterval(devInterval); devInterval = null; }
      if (waInterval) { clearInterval(waInterval); waInterval = null; }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchDevicesStatus();
        fetchWhatsAppStatus();
        startTimers();
      } else {
        stopTimers();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    startTimers();
    return () => {
      window.removeEventListener('sse-wa-status-changed', handleSse);
      document.removeEventListener('visibilitychange', handleVisibility);
      stopTimers();
    };
  }, [fetchDevicesStatus, fetchWhatsAppStatus]);

  const handleSaveRename = async (token: string) => {
    if (!editName.trim()) return;
    try {
      await api.renameDevice(token, editName.trim());
      setDevices(prev =>
        prev.map(d => (d.token === token ? { ...d, device_name: editName.trim() } : d))
      );
      setEditingToken(null);
    } catch (err) {
      console.warn('Failed to rename device:', err);
    }
  };

  const getPlatformIcon = (osStr: string) => {
    const lower = (osStr || '').toLowerCase();
    if (lower.includes('ios') || lower.includes('iphone') || lower.includes('ipad') || lower.includes('apple')) {
      return <span className="font-bold text-xs mr-1 text-white"></span>;
    }
    if (lower.includes('android')) {
      return <span className="font-bold text-xs mr-1 text-emerald-400">🤖</span>;
    }
    return <Smartphone size={12} className="mr-1 text-primary" />;
  };

  const onlineCount = devices.filter(d => d.is_online === 1).length;

  return (
    <footer className="h-9 bg-bg2/90 border-t border-glass-border px-3 flex items-center justify-between text-xs shrink-0 select-none z-20 backdrop-blur-md">
      {/* Left: Device status pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          onClick={onOpenConnectModal}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary font-bold transition-all shrink-0"
          title="Connect mobile app or scan QR"
        >
          <QrCode size={12} />
          <span>Mobile Devices ({onlineCount}/{devices.length} Online)</span>
        </button>

        <div className="h-3 w-[1px] bg-glass-border shrink-0" />

        {devices.length === 0 ? (
          <span className="text-[11px] text-muted flex items-center gap-1">
            <WifiOff size={11} /> No mobile devices registered yet (scan QR to pair)
          </span>
        ) : (
          devices.map(dev => {
            const isOnline = dev.is_online === 1;
            const isEditing = editingToken === dev.token;

            return (
              <div
                key={dev.token}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] transition-all shrink-0 ${
                  isOnline
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    : 'bg-white/5 border-glass-border text-muted'
                }`}
              >
                {getPlatformIcon(dev.os)}

                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="bg-bg border border-primary px-1.5 py-0.5 rounded text-[11px] text-white outline-none w-24"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveRename(dev.token)}
                      className="text-primary hover:text-white"
                    >
                      <Save size={11} />
                    </button>
                    <button
                      onClick={() => setEditingToken(null)}
                      className="text-muted hover:text-white"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white truncate max-w-[120px]">
                      {dev.device_name}
                    </span>

                    <button
                      onClick={() => {
                        setEditingToken(dev.token);
                        setEditName(dev.device_name);
                      }}
                      className="text-muted hover:text-white opacity-0 hover:opacity-100 transition-opacity"
                      title="Rename device"
                    >
                      <Edit2 size={10} />
                    </button>

                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                      }`}
                      title={isOnline ? 'Connected' : 'Offline'}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Right: Connectivity indicator */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={onOpenConnectModal}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-white transition-colors"
        >
          <Wifi size={11} className="text-emerald-400" />
          <span>Auto-Sync Active</span>
        </button>
      </div>
    </footer>
  );
};
