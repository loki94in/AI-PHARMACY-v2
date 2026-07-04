import React from 'react';

interface InfiniteTableProps {
  totalSize: number;
  header: React.ReactNode;
  body: React.ReactNode;
  footer?: React.ReactNode;
  containerRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

export function InfiniteTable({
  totalSize,
  header,
  body,
  footer,
  containerRef,
  className = '',
}: InfiniteTableProps) {
  return (
    <div
      ref={containerRef as any}
      className={`flex-1 overflow-auto bg-black/20 relative w-full scrollbar-thin ${className}`}
    >
      <table className="w-full min-w-max text-left border-collapse flex flex-col">
        <thead className="sticky top-0 bg-[#18181b]/95 backdrop-blur z-20 flex flex-col border-b border-glass-border">
          {header}
        </thead>
        <tbody
          className="relative w-full"
          style={{
            height: `${totalSize}px`,
          }}
        >
          {body}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
