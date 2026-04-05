import type { ReactNode } from 'react';

interface PageShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Skip the white content card wrapper (for pages that manage their own layout) */
  bare?: boolean;
}

export function PageShell({ title, subtitle, actions, children, bare }: PageShellProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-bb-linen p-6">
      {/* Page header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-medium text-bb-text">{title}</h1>
          {subtitle && <p className="mt-1 text-[12px] text-bb-warm-gray">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Content area */}
      {bare ? (
        children
      ) : (
        <div className="rounded-xl border-[0.5px] border-bb-border bg-bb-white p-5">{children}</div>
      )}
    </div>
  );
}
