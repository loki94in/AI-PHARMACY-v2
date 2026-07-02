import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, ScanLine, Loader2 } from 'lucide-react';
import { apiClient } from '../services/api';

interface AICameraProps {
  onScanResult: (result: any) => void;
  onClose: () => void;
}

const AICamera: React.FC<AICameraProps> = ({ onScanResult, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      setError('Could not access camera. Please allow permissions.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setProcessing(true);
    setError(null);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);

    try {
      // Endpoint from the backend: POST /api/aicamera/analyze
      const response = await apiClient.post('/aicamera/analyze', { image: base64Image });
      if (response.data) {
        onScanResult({ ...response.data, capturedImage: base64Image });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to process image');
    } finally {
      setProcessing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-camera flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm fade-in">
      <div className="bg-bg2 border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="p-4 border-b border-border flex justify-between items-center bg-black/40">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Camera className="text-primary" /> AI Prescription & Product Scanner
          </h3>
          <button onClick={onClose} aria-label="Close camera" title="Close camera" className="p-2 text-muted hover:text-white rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="relative aspect-video bg-black flex items-center justify-center">
          {error ? (
            <div className="text-red p-4 text-center">{error}</div>
          ) : (
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
          )}
          
          {/* Scanning Overlay */}
          <div className="absolute inset-0 pointer-events-none border-2 border-primary/30 m-8 rounded-xl flex items-center justify-center">
            {processing && (
              <div className="flex flex-col items-center bg-black/60 p-4 rounded-xl backdrop-blur">
                <Loader2 className="animate-spin text-primary mb-2" size={32} />
                <span className="font-semibold text-white animate-pulse">AI Analyzing...</span>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
        
        <div className="p-6 bg-black/40 flex justify-center border-t border-border">
          <button 
            onClick={captureAndAnalyze} 
            disabled={processing || !!error}
            className={`
              flex items-center gap-2 px-8 py-4 rounded-full font-bold text-lg transition-all
              ${processing || !!error 
                ? 'bg-muted/20 text-muted cursor-not-allowed' 
                : 'bg-primary text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] hover:scale-105 active:scale-95'}
            `}
          >
            {processing ? <Loader2 className="animate-spin" /> : <ScanLine />}
            {processing ? 'Processing OCR...' : 'Capture & Analyze'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AICamera;
