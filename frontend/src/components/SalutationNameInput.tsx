import React from 'react';
import { User } from 'lucide-react';

export const SALUTATION_OPTIONS = ['Mr.', 'Mrs.', 'Miss', 'Dr.', 'Other'] as const;
export type SalutationType = typeof SALUTATION_OPTIONS[number];

/**
 * Combines salutation (and optional custom salutation) with an uppercase customer/patient name.
 * Avoids duplicate prefixes if the user types a salutation into the name field.
 */
export function combineSalutationAndName(salutation: string, customSalutation: string = '', name: string = ''): string {
  const trimmedName = (name || '').trim().toUpperCase();
  if (!trimmedName) return '';

  // Check if name already has a recognized salutation prefix
  const match = trimmedName.match(/^(MR\.|MRS\.|MISS|MS\.|DR\.|SHRI|SMT\.)\s*(.*)$/i);
  if (match) {
    const rawPrefix = match[1].toUpperCase();
    const actualName = match[2].trim();
    let normalizedPrefix = match[1];
    if (rawPrefix === 'MR.' || rawPrefix === 'MR') normalizedPrefix = 'Mr.';
    else if (rawPrefix === 'MRS.' || rawPrefix === 'MRS') normalizedPrefix = 'Mrs.';
    else if (rawPrefix === 'MISS' || rawPrefix === 'MS.') normalizedPrefix = 'Miss';
    else if (rawPrefix === 'DR.' || rawPrefix === 'DR') normalizedPrefix = 'Dr.';
    else if (rawPrefix === 'SHRI') normalizedPrefix = 'Shri';
    else if (rawPrefix === 'SMT.' || rawPrefix === 'SMT') normalizedPrefix = 'Smt.';
    return actualName ? `${normalizedPrefix} ${actualName}` : normalizedPrefix;
  }

  const activeSal = salutation === 'Other' ? (customSalutation || '').trim() : salutation;
  if (activeSal) {
    return `${activeSal} ${trimmedName}`;
  }
  return trimmedName;
}

/**
 * Parses a full name into standard salutation, custom salutation (if any), and uppercase name.
 */
export function parseSalutationAndName(fullName?: string | null): { salutation: string; customSalutation: string; name: string } {
  if (!fullName || !fullName.trim()) {
    return { salutation: 'Mr.', customSalutation: '', name: '' };
  }
  const trimmed = fullName.trim();
  const match = trimmed.match(/^(Mr\.|Mrs\.|Miss|Ms\.|Dr\.|Shri|Smt\.)\s*(.*)$/i);
  if (match) {
    const rawSal = match[1];
    const restName = match[2].trim().toUpperCase();
    const salUpper = rawSal.toUpperCase();

    if (salUpper === 'MR.' || salUpper === 'MR') {
      return { salutation: 'Mr.', customSalutation: '', name: restName };
    }
    if (salUpper === 'MRS.' || salUpper === 'MRS') {
      return { salutation: 'Mrs.', customSalutation: '', name: restName };
    }
    if (salUpper === 'MISS' || salUpper === 'MS.') {
      return { salutation: 'Miss', customSalutation: '', name: restName };
    }
    if (salUpper === 'DR.' || salUpper === 'DR') {
      return { salutation: 'Dr.', customSalutation: '', name: restName };
    }

    return { salutation: 'Other', customSalutation: rawSal, name: restName };
  }

  return { salutation: 'Mr.', customSalutation: '', name: trimmed.toUpperCase() };
}

interface SalutationNameInputProps {
  salutation: string;
  customSalutation?: string;
  name: string;
  onSalutationChange: (salutation: string, customSalutation?: string) => void;
  onNameChange: (name: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  inputClassName?: string;
  containerClassName?: string;
  label?: string;
  showIcon?: boolean;
}

export const SalutationNameInput: React.FC<SalutationNameInputProps> = ({
  salutation = 'Mr.',
  customSalutation = '',
  name,
  onSalutationChange,
  onNameChange,
  placeholder = 'CUSTOMER NAME',
  required = false,
  disabled = false,
  id,
  inputClassName = '',
  containerClassName = '',
  label,
  showIcon = true,
}) => {
  const isOther = salutation === 'Other' || (!SALUTATION_OPTIONS.includes(salutation as any) && Boolean(salutation));

  const handleSalChange = (newSal: string) => {
    if (newSal === 'Other') {
      onSalutationChange('Other', customSalutation);
    } else {
      onSalutationChange(newSal, '');
    }
  };

  const handleCustomSalChange = (val: string) => {
    onSalutationChange('Other', val);
  };

  const handleNameInput = (val: string) => {
    // Strictly force UPPERCASE for all customer/patient names
    onNameChange(val.toUpperCase());
  };

  return (
    <div className={`space-y-1 ${containerClassName}`}>
      {label && (
        <label className="block text-xs font-semibold text-text">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="flex gap-1.5 items-center w-full">
        {/* Salutation Select */}
        <select
          value={SALUTATION_OPTIONS.includes(salutation as any) ? salutation : 'Other'}
          onChange={(e) => handleSalChange(e.target.value)}
          disabled={disabled}
          className="px-2.5 py-2.5 text-xs font-bold rounded-xl bg-bg border border-border text-text focus:outline-none focus:border-primary cursor-pointer shrink-0 transition-colors shadow-sm"
          title="Salutation / Title (Mr / Mrs / Miss / Dr / Other)"
        >
          <option value="Mr.">Mr.</option>
          <option value="Mrs.">Mrs.</option>
          <option value="Miss">Miss</option>
          <option value="Dr.">Dr.</option>
          <option value="Other">Other</option>
        </select>

        {/* Custom Salutation text input if Other is selected */}
        {isOther && (
          <input
            type="text"
            value={customSalutation || (SALUTATION_OPTIONS.includes(salutation as any) ? '' : salutation)}
            onChange={(e) => handleCustomSalChange(e.target.value)}
            disabled={disabled}
            placeholder="TITLE"
            className="w-20 uppercase px-2.5 py-2.5 text-xs font-bold rounded-xl bg-bg border border-border text-text focus:outline-none focus:border-primary shrink-0 transition-colors shadow-sm"
            maxLength={10}
            title="Custom Title / Prefix"
          />
        )}

        {/* Uppercase Name Input */}
        <div className="relative flex-1">
          {showIcon && (
            <User size={14} className="absolute left-3 top-3 text-muted pointer-events-none" />
          )}
          <input
            id={id}
            type="text"
            value={name}
            onChange={(e) => handleNameInput(e.target.value)}
            placeholder={placeholder.toUpperCase()}
            required={required}
            disabled={disabled}
            autoComplete="off"
            className={`w-full uppercase font-semibold text-xs px-3 py-2.5 bg-bg border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-none focus:border-primary transition-all shadow-sm ${
              showIcon ? 'pl-8' : ''
            } ${inputClassName}`}
          />
        </div>
      </div>
    </div>
  );
};
