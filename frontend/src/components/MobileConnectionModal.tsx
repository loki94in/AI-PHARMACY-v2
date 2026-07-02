import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, QrCode, RefreshCw, AlertCircle, Copy, Check } from 'lucide-react';
import { api } from '../services/api';

interface Props {
  onClose: () => void;
}

export const MobileConnectionModal: React.FC<Props> = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ ips: string[]; port: string | number; serverUrls: string[]; qrCodeUrl: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const fetchConnectionInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getConnectionInfo();
      if (data && data.success) {
        setInfo(data);
      } else {
        setError('Failed to fetch connection details.');
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
  }, []);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center p-4 sm:p-6 fade-in">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative bg-[#18181b] border border-glass-border rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden slide-up">
        {/* Header */}
        <div className="p-5 border-b border-glass-border bg-white/5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary">
              <QrCode size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white leading-tight">Connect Mobile Device</h3>
              <p className="text-xs text-muted mt-0.5">Setup sync and camera interface</p>
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
              <p className="text-sm font-medium">Detecting local network interfaces...</p>
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
            <div className="space-y-5 flex flex-col items-center">
              {/* QR Code Container */}
              <div className="p-4 bg-white rounded-2xl border-4 border-primary/25 shadow-[0_0_25px_rgba(108,99,255,0.15)] flex justify-center items-center">
                <img 
                  src={info.qrCodeUrl} 
                  alt="Connection QR Code" 
                  className="w-56 h-56 object-contain"
                />
              </div>

              {/* Instructions */}
              <div className="w-full text-center space-y-1.5">
                <p className="text-xs text-muted leading-relaxed">
                  Open the <strong>Pharmacy Genius</strong> mobile app, go to the connection setup screen, and scan the QR code above.
                </p>
                <p className="text-[10px] text-amber-500 font-semibold bg-amber-500/10 border border-amber-500/20 py-1 px-3 rounded-lg inline-block">
                  Note: Both PC and mobile must be on the same Wi-Fi network.
                </p>
              </div>

              {/* Manual Entry Section */}
              <div className="w-full space-y-2.5 pt-4 border-t border-glass-border">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Manual Connection Urls</h4>
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
        <div className="p-5 border-t border-glass-border bg-black/40 flex justify-end shrink-0">
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
