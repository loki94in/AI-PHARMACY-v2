import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
        <h2 className="text-2xl font-bold text-text bg-gradient-to-r from-text to-muted bg-clip-text text-transparent">
          RedBook Data Import
        </h2>
        <p className="text-muted mt-2 text-sm max-w-md mx-auto">
          Upload inventory, purchases, sales, or returns data files to begin migration.
        </p>
      </div>

      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={!uploading ? triggerBrowse : undefined}
        whileHover={!uploading ? { scale: 1.01, boxShadow: "0px 12px 30px rgba(14, 165, 233, 0.05)" } : undefined}
        whileTap={!uploading ? { scale: 0.99 } : undefined}
        className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 cursor-pointer transition-colors duration-300 min-h-[260px] ${
          isDragOver
            ? 'border-sky bg-sky/5 shadow-[0_0_20px_rgba(14,165,233,0.15)] scale-[0.99]'
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

        <AnimatePresence mode="wait">
          {uploading ? (
            <motion.div
              key="uploading"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center gap-4 text-center"
            >
              <div className="relative">
                <Loader2 className="w-12 h-12 text-sky animate-spin" />
                <div className="absolute inset-0 bg-sky/10 rounded-full blur-md -z-10" />
              </div>
              <div>
                <span className="text-text font-semibold block text-base">Uploading and analyzing file...</span>
                <span className="text-muted text-xs block mt-1">This might take a moment depending on the size</span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center gap-4 text-center"
            >
              <motion.div
                whileHover={{ rotate: 12, scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400, damping: 10 }}
                className="w-16 h-16 rounded-full bg-bg3/60 border border-glass-border flex items-center justify-center text-muted hover:text-sky hover:border-sky/40 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
              >
                <UploadCloud className="w-8 h-8" />
              </motion.div>
              <div>
                <p className="text-text font-semibold text-base">
                  Drop your file here, or <span className="text-sky hover:underline font-bold">browse</span>
                </p>
                <p className="text-muted text-xs mt-1.5 max-w-xs mx-auto">
                  Supports CSV, Excel (.xlsx, .xls), SQL database backup dumps, or ZIP archives
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="mt-4 p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-start gap-3 shadow-lg shadow-rose-500/5"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Upload Failed</p>
              <p className="opacity-90 mt-0.5">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
