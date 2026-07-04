import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Check, AlertCircle } from 'lucide-react';
import { ColumnMapper } from './ColumnMapper';
import { ErrorRows } from './ErrorRows';
import { motion, AnimatePresence } from 'motion/react';

interface ModuleSectionProps {
  dataType: string;
  label: string;
  totalRows: number;
  headers: string[];
  mapping: Record<string, string>;
  onMappingChange: (header: string, targetCol: string) => void;
  validationErrors: any[];
  requiredFields: string[];
  missingRequired: string[];
  samples: any[];
}

const tableVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1
    }
  }
} as const;

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { 
    opacity: 1, 
    y: 0, 
    transition: { duration: 0.25, ease: 'easeOut' as const } 
  }
} as const;

export const ModuleSection: React.FC<ModuleSectionProps> = ({
  dataType,
  label,
  totalRows,
  headers,
  mapping,
  onMappingChange,
  validationErrors,
  requiredFields,
  missingRequired,
  samples
}) => {
  const [isOpen, setIsOpen] = useState(true);

  // Group validation errors specific to this module type
  const moduleErrors = validationErrors.filter((err) => {
    // Check if error is related to mapped column for this dataType
    const mappedHeader = Object.keys(mapping).find((k) => mapping[k] === err.column);
    return !!mappedHeader;
  });

  const isAllRequiredMapped = missingRequired.length === 0;

  return (
    <div className={`border rounded-xl bg-glass-bg transition-all ${
      !isAllRequiredMapped 
        ? 'border-rose-500/30 shadow-[0_0_10px_rgba(239,68,68,0.05)]' 
        : 'border-glass-border hover:border-border'
    }`}>
      {/* Header Bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-6 py-4 cursor-pointer select-none"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{label}</span>
          <span className="text-muted text-sm">({totalRows.toLocaleString()} rows)</span>
          {!isAllRequiredMapped && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">
              <AlertCircle size={12} />
              Missing {missingRequired.join(', ')}
            </span>
          )}
          {isAllRequiredMapped && headers.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Check size={12} />
              Mapped
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {moduleErrors.length > 0 && (
            <span className="text-xs bg-rose-500/15 text-rose-400 px-2 py-0.5 rounded border border-rose-500/20">
              {moduleErrors.length} Errors
            </span>
          )}
          {isOpen ? <ChevronUp size={20} className="text-muted" /> : <ChevronDown size={20} className="text-muted" />}
        </div>
      </div>

      {/* Body Content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden border-t border-glass-border"
          >
            <div className="p-6 space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-glass-border text-muted pb-2">
                      <th className="py-2.5 font-medium">File Column Header</th>
                      <th className="py-2.5 font-medium px-4">Preview Value</th>
                      <th className="py-2.5 font-medium w-64">Map to App Field</th>
                    </tr>
                  </thead>
                  <motion.tbody
                    variants={tableVariants}
                    initial="hidden"
                    animate="show"
                    className="divide-y divide-glass-border/30"
                  >
                    {headers.map((header) => {
                      const mappedField = mapping[header] || '';
                      const sampleValue = samples[0]?.[header];
                      const isRequired = requiredFields.includes(mappedField);
                      const isFieldMissing = missingRequired.includes(mappedField);

                      return (
                        <motion.tr
                          key={header}
                          variants={rowVariants}
                          className="hover:bg-bg2/20 transition-colors"
                        >
                          <td className="py-3 font-mono text-xs text-text/90">
                            {header}
                            {isRequired && <span className="text-rose-400 ml-1 font-sans">*</span>}
                          </td>
                          <td className="py-3 px-4 text-muted text-xs truncate max-w-[200px]" title={String(sampleValue || '')}>
                            {sampleValue !== undefined && sampleValue !== null ? String(sampleValue) : '-'}
                          </td>
                          <td className="py-2">
                            <div className={isFieldMissing ? 'border border-rose-500/40 rounded-lg p-0.5 bg-rose-500/5' : ''}>
                              <ColumnMapper
                                header={header}
                                value={mappedField}
                                onChange={(newVal) => onMappingChange(header, newVal)}
                                dataType={dataType}
                              />
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </motion.tbody>
                </table>
              </div>

              <ErrorRows errors={moduleErrors} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
