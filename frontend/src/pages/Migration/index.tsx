import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RedBookUploader } from './components/RedBookUploader';
import { LocalBackupPanel, type LocalBackup } from './components/LocalBackupPanel';
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
  initialPhase?: 'review' | 'importing';
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
      const uploadRes = await api.uploadMigrationFile(file);
      if (!uploadRes.success || !uploadRes.file) {
        throw new Error(uploadRes.error || 'Upload failed');
      }

      const uploadedFileName = uploadRes.file;
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      const analyzeRes = await api.preMigrationAnalyze(uploadedFileName, 0, 0);
      if (!analyzeRes.success) {
        throw new Error(analyzeRes.details || 'Analysis failed');
      }

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
        status: 'ready',
        initialPhase: 'review'
      };

      setFileEntry(newEntry);
      setModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'An error occurred during file upload');
    } finally {
      setUploading(false);
    }
  };

  const handleRunLocalBackup = (backup: LocalBackup) => {
    const newEntry: FileEntry = {
      uploadedFileName: backup.name,
      originalName: backup.name,
      ext: backup.ext,
      headers: [],
      samples: [],
      detected: { type: 'database_dump', confidence: 1.0 },
      userSelectedType: 'inventory',
      mapping: {},
      status: 'ready',
      initialPhase: 'importing'
    };
    setFileEntry(newEntry);
    setModalOpen(true);
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
      className="container mx-auto px-6 py-10 max-w-7xl relative"
    >
      {/* Background glow decoration */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-sky/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text bg-gradient-to-r from-text to-muted bg-clip-text text-transparent">
          Data Migration & Backup Restore
        </h1>
        <p className="text-muted text-sm mt-1">
          Import legacy software files (RedBook, Marg, SQL, Excel) or auto-restore local database backup dumps seamlessly.
        </p>
      </div>

      {/* 2-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Upload Box */}
        <div className="lg:col-span-6 flex flex-col space-y-6">
          <RedBookUploader
            onUpload={handleUpload}
            uploading={uploading}
            error={error}
          />
        </div>

        {/* Right Column: Local Detected Backups Panel */}
        <div className="lg:col-span-6 flex flex-col space-y-6">
          <LocalBackupPanel onRunMigration={handleRunLocalBackup} />
        </div>
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
