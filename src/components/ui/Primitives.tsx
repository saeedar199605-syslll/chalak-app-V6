import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function BodyPortal({ children }: { children: React.ReactNode }) {
  return typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
}

const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function getVisibleDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(MODAL_SELECTOR)).filter(isVisible);
}

function getDialogLayer(dialog: HTMLElement): number {
  let layer = 0;
  let current: HTMLElement | null = dialog;
  while (current && current !== document.body) {
    const zIndex = Number.parseInt(getComputedStyle(current).zIndex, 10);
    if (Number.isFinite(zIndex)) layer = Math.max(layer, zIndex);
    current = current.parentElement;
  }
  return layer;
}

function getTopmostDialog(): HTMLElement | null {
  return getVisibleDialogs().reduce<HTMLElement | null>((top, candidate) => {
    if (!top || getDialogLayer(candidate) >= getDialogLayer(top)) return candidate;
    return top;
  }, null);
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => isVisible(element) && !element.hasAttribute('aria-hidden'));
}

/** Gives all active app dialogs the same focus containment, restoration, and scroll behavior. */
export function ModalFocusManager() {
  React.useEffect(() => {
    const returnFocus = new Map<HTMLElement, HTMLElement | null>();
    let originalBodyOverflow: string | null = null;

    const focusInside = (dialog: HTMLElement, backwards = false) => {
      const focusable = getFocusableElements(dialog);
      const target = backwards ? focusable.at(-1) : focusable[0];
      if (target) target.focus({ preventScroll: true });
      else {
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        dialog.focus({ preventScroll: true });
      }
    };

    const syncDialogs = () => {
      const visibleDialogs = getVisibleDialogs();
      const visibleSet = new Set(visibleDialogs);
      for (const dialog of visibleDialogs) {
        if (returnFocus.has(dialog)) continue;
        const active = document.activeElement;
        returnFocus.set(dialog, active instanceof HTMLElement ? active : null);
        if (returnFocus.size === 1) {
          originalBodyOverflow = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
        }
        focusInside(dialog);
      }

      for (const [dialog, opener] of returnFocus) {
        if (visibleSet.has(dialog)) continue;
        returnFocus.delete(dialog);
        if (returnFocus.size === 0 && originalBodyOverflow !== null) {
          document.body.style.overflow = originalBodyOverflow;
          originalBodyOverflow = null;
        }
        const topmost = getTopmostDialog();
        if (opener?.isConnected && (!topmost || topmost.contains(opener))) opener.focus({ preventScroll: true });
      }
    };

    const keepFocusInside = (event: FocusEvent) => {
      const topmost = getTopmostDialog();
      if (!topmost || (event.target instanceof Node && topmost.contains(event.target))) return;
      focusInside(topmost);
    };

    const containTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const topmost = getTopmostDialog();
      if (!topmost) return;
      const focusable = getFocusableElements(topmost);
      if (!focusable.length) {
        event.preventDefault();
        focusInside(topmost);
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !topmost.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !topmost.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const observer = new MutationObserver(syncDialogs);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'class', 'style', 'hidden'] });
    document.addEventListener('focusin', keepFocusInside);
    document.addEventListener('keydown', containTab);
    syncDialogs();

    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', keepFocusInside);
      document.removeEventListener('keydown', containTab);
      if (originalBodyOverflow !== null) document.body.style.overflow = originalBodyOverflow;
      returnFocus.clear();
    };
  }, []);

  return null;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'info' | 'neutral';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'action-primary border shadow-sm',
  secondary: 'action-secondary border shadow-sm',
  ghost: 'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white',
  danger: 'action-danger border shadow-sm',
  success: 'action-success border shadow-sm',
  warning: 'action-warning border shadow-sm',
  info: 'action-info border shadow-sm',
  neutral: 'action-neutral border shadow-sm',
};

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold leading-5 transition-all duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
    />
  );
}

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      type={props.type || 'button'}
      aria-label={label}
      title={props.title || label}
      className={`inline-grid min-h-10 min-w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm shadow-slate-950/[0.03] placeholder:text-slate-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:shadow-none ${className}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props;
  return <select {...rest} className={`min-h-11 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm shadow-slate-950/[0.03] transition-colors focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:shadow-none ${className}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea {...rest} className={`w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-7 text-slate-800 shadow-sm shadow-slate-950/[0.03] placeholder:text-slate-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:shadow-none ${className}`} />;
}

export function Badge({ children, tone = 'neutral', className = '' }: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300',
    success: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300',
    warning: 'bg-amber-500/10 text-amber-700 ring-amber-600/20 dark:text-amber-300',
    danger: 'bg-rose-500/10 text-rose-700 ring-rose-600/20 dark:text-rose-300',
    info: 'bg-sky-500/10 text-sky-700 ring-sky-600/20 dark:text-sky-300',
  };
  return <span className={`inline-flex min-h-7 min-w-0 max-w-full shrink items-center gap-1.5 whitespace-normal break-words rounded-full px-2.5 py-1 text-right text-xs font-semibold leading-5 [overflow-wrap:anywhere] ring-1 ring-inset ${tones[tone]} ${className}`}>{children}</span>;
}

export function Card({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={`min-w-0 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm shadow-slate-950/[0.035] dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/10 ${className}`} />;
}

export function Toolbar({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm shadow-slate-950/[0.03] dark:border-slate-800 dark:bg-slate-900/75 sm:flex-row sm:items-center sm:justify-between ${className}`} />;
}

export function Table({ className = '', ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <div className="table-responsive max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60"><table {...props} className={`w-full border-collapse text-right text-sm ${className}`} /></div>;
}

export function Dialog({ open, title, onClose, children, className = '' }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  if (!open) return null;
  return <BodyPortal><div className="fixed inset-0 layer-modal grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${className}`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800"><h2 className="text-base font-black text-slate-900 dark:text-white">{title}</h2><IconButton label="بستن" onClick={onClose} className="min-h-9 min-w-9 rounded-lg"><X className="h-4 w-4" aria-hidden="true" /></IconButton></div>
      {children}
    </section>
  </div></BodyPortal>;
}

export function EmptyState({ title, description, action }: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-8 text-center dark:border-slate-700 dark:bg-slate-900/40">
    <div className="max-w-md">
      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  </div>;
}
