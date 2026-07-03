import React from 'react';

interface VirtualRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  start: number;
  size: number;
}

export const VirtualRow = React.forwardRef<HTMLTableRowElement, VirtualRowProps>(
  ({ start, size, style, children, className = '', ...props }, ref) => {
    return (
      <tr
        ref={ref}
        className={`absolute top-0 left-0 w-full hover:bg-white/5 cursor-pointer transition-colors border-b border-glass-border flex items-center ${className}`}
        style={{
          height: `${size}px`,
          transform: `translateY(${start}px)`,
          ...style,
        }}
        {...props}
      >
        {children}
      </tr>
    );
  }
);

VirtualRow.displayName = 'VirtualRow';
