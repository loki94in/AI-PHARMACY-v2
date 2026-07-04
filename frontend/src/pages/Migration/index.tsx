import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RedBookUploader } from './components/RedBookUploader';
import { ReviewModal } from './components/ReviewModal';
import { api } from '../../services/api';

export interface FileEntry {
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

const Migration: React.FC = () => {
  const [fileEntry, setFileEntry] = useState<FileEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // 1. Upload file
      const uploadRes = await api.uploadMigrationFile(file);
      if (!uploadRes.success || !uploadRes.file) {
        throw new Error(uploadRes.error || 'Upload failed');
      }

      const uploadedFileName = uploadRes.file;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      // 2. Pre-migration analyze to detect headers, type and generate auto-mapping
      const analyzeRes = await api.preMigrationAnalyze(uploadedFileName, 0, 0);
      if (!analyzeRes.success) {
        throw new Error(analyzeRes.details || 'Analysis failed');
      }

      // We need to fetch the samples from the file since they are required for preview.
      // If pre-migration-analyze response doesn't contain samples directly,
      // we fallback to analyzeMigrationFile (which reads CSV samples) or provide empty samples.
      let samples: any[] = [];
      try {
        const sampleData = await api.analyzeMigrationFile(uploadedFileName, 0);
        samples = sampleData.samples || [];
      } catch (err) {
        console.warn('Failed to retrieve preview samples', err);
      }

      const newEntry: FileEntry = {
        uploadedFileName,
        originalName: file.name,
        ext,
        headers: analyzeRes.columns || [],
        samples,
        detected: analyzeRes.module || { type: 'unknown', confidence: 0 },
        userSelectedType: analyzeRes.module?.type || 'inventory',
        mapping: analyzeRes.autoMapping || {},
        status: 'ready'
      };

      setFileEntry(newEntry);
      setModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'An error occurred during file upload');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateFile = (updated: FileEntry) => {
    setFileEntry(updated);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setFileEntry(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="container mx-auto px-6 py-12 max-w-5xl relative"
    >
      {/* Background glow decoration */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-sky/5 rounded-full blur-[80px] pointer-events-none -z-10" />

      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8">
        <RedBookUploader
          onUpload={handleUpload}
          uploading={uploading}
          error={error}
        />
      </div>

      <AnimatePresence>
        {modalOpen && fileEntry && (
          <ReviewModal
            isOpen={modalOpen}
            onClose={handleCloseModal}
            fileEntry={fileEntry}
            onUpdateFile={handleUpdateFile}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default Migration;
