import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, AlertCircle } from 'lucide-react';

interface RedBookUploaderProps {
  onUpload: (file: File) => void;
  uploading: boolean;
  error: string | null;
}

export const RedBookUploader: React.FC<RedBookUploaderProps> = ({
  onUpload,
  uploading,
  error
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files[0]);
    }
  };

  const triggerBrowse = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-semibold text-text">RedBook Data Import</h2>
        <p className="text-muted mt-2 text-sm">
          Upload inventory, purchases, sales, or returns data files to begin migration.
        </p>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={triggerBrowse}
        className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 cursor-pointer transition-all duration-200 min-h-[260px] ${
          isDragOver
            ? 'border-sky bg-sky/5 shadow-[0_0_15px_rgba(59,130,246,0.15)] scale-98'
            : 'border-glass-border bg-glass-bg hover:border-border hover:bg-bg2/40'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".csv,.xlsx,.xls,.sql,.zip"
          className="hidden"
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-sky animate-spin" />
            <span className="text-text font-medium mt-2">Uploading and analyzing file...</span>
            <span className="text-muted text-xs">This might take a moment depending on the size</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-bg3/60 border border-border flex items-center justify-center text-muted group-hover:text-text transition-colors">
              <UploadCloud className="w-8 h-8" />
            </div>
            <div>
              <p className="text-text font-semibold text-base">
                Drop your file here, or <span className="text-sky hover:underline font-bold">browse</span>
              </p>
              <p className="text-muted text-xs mt-1.5">
                Supports CSV, Excel (.xlsx, .xls), SQL database backup dumps, or ZIP archives
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Upload Failed</p>
            <p className="opacity-90 mt-0.5">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};
