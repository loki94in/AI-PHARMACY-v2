import React, { useState, useEffect } from 'react';
import { Phone } from 'lucide-react';
import { sanitizePhoneInput } from '../utils/phone';

interface PhoneInputWithBadgeProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  allowEmpty?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  shakeOnError?: boolean;
  onValidationChange?: (isValid: boolean) => void;
}

export const PhoneInputWithBadge: React.FC<PhoneInputWithBadgeProps> = ({
  value,
  onChange,
  placeholder = '10-digit phone number...',
  label,
  required = false,
  allowEmpty = true,
  className = '',
  disabled = false,
  id,
  shakeOnError = false,
  onValidationChange
}) => {
  const [isShaking, setIsShaking] = useState(false);

  const cleanDigits = (value || '').replace(/\D/g, '');
  const isComplete = cleanDigits.length === 10;
  const isPartial = cleanDigits.length > 0 && cleanDigits.length < 10;
  const isEmpty = cleanDigits.length === 0;

  const isValid = (isEmpty && allowEmpty && !required) || isComplete;

  useEffect(() => {
    if (onValidationChange) {
      onValidationChange(isValid);
    }
  }, [isValid, onValidationChange]);

  useEffect(() => {
    if (shakeOnError || isPartial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shake must react to parent error-prop signal
      setIsShaking(true);
      const timer = setTimeout(() => setIsShaking(false), 400);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- adding isPartial would re-shake on every keystroke
  }, [shakeOnError]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizePhoneInput(e.target.value);
    onChange(sanitized);
  };

  const handleBlur = () => {
    if (isPartial || (isEmpty && required)) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  let badgeText;
  let badgeColor;

  if (isComplete) {
    badgeText = '10/10 ✓ Valid';
    badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold';
  } else if (isPartial) {
    const remaining = 10 - cleanDigits.length;
    badgeText = `${remaining} left (${cleanDigits.length}/10)`;
    badgeColor = 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-mono animate-pulse font-bold';
  } else if (required && isEmpty) {
    badgeText = '10 digits required';
    badgeColor = 'bg-rose-500/15 text-rose-400 border-rose-500/30 font-bold';
  } else {
    badgeText = 'Optional (10 digits)';
    badgeColor = 'bg-bg2 text-muted border-border';
  }

  const borderClass = isShaking
    ? 'border-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)] animate-shake'
    : isPartial
    ? 'border-amber-500/70 focus:border-amber-400'
    : isComplete
    ? 'border-emerald-500/70 focus:border-emerald-400'
    : 'border-border focus:border-primary';

  const inputId = id || 'phone-input-badge';

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between text-xs font-bold text-text">
          <label htmlFor={inputId} className="flex items-center gap-1.5">
            <Phone size={13} className="text-muted" />
            {label} {required && <span className="text-rose-400">*</span>}
          </label>
          <span className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${badgeColor}`}>
            {badgeText}
          </span>
        </div>
      )}

      <div className="relative flex items-center">
        <input
          id={inputId}
          name={inputId}
          type="tel"
          autoComplete="off"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={10}
          className={`
            w-full bg-bg border rounded-xl px-3.5 py-2.5 text-xs text-text placeholder:text-muted/60
            focus:outline-none transition-all duration-200
            ${borderClass}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        />
        {!label && (
          <span className={`absolute right-2 text-[10px] px-2 py-0.5 rounded-md border transition-all ${badgeColor}`}>
            {badgeText}
          </span>
        )}
      </div>
    </div>
  );
};
