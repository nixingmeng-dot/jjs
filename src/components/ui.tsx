import { Check, LoaderCircle, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useToasts } from '../store';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 border-transparent',
  secondary: 'bg-panel border-line hover:bg-hover',
  ghost: 'border-transparent hover:bg-hover',
  danger: 'border-transparent text-danger hover:bg-danger/10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8.5 px-3 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  title,
  className,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={cx(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-ink disabled:opacity-40',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className,
      )}
      {...rest}
    />
  );
}

const fieldCore =
  'rounded-md border border-line bg-paper px-2.5 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15';
// 调用方传了宽度类时不再加 w-full，避免两个宽度类互相覆盖
const fieldBase = (className?: string) => cx(fieldCore, !/(^|\s)(w-|flex-1)/.test(className ?? '') && 'w-full');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase(className), 'h-8.5', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase(className), 'h-8.5 pr-7', className)} {...rest}>
      {children}
    </select>
  );
}

/** 自动增高的多行输入框 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; minRows?: number }>(
  function Textarea({ className, autoGrow = true, minRows = 3, value, ...rest }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
      const el = inner.current;
      if (!el || !autoGrow) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 2 + 'px';
    }, [value, autoGrow]);
    return (
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        rows={minRows}
        value={value}
        className={cx(fieldBase(className), 'py-2 leading-relaxed', autoGrow ? 'resize-none overflow-hidden' : 'resize-y', className)}
        {...rest}
      />
    );
  },
);

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <div className="mb-1 flex items-baseline gap-2 text-xs font-medium text-muted">
        <span>{label}</span>
        {hint && <span className="font-normal text-muted/80">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[84vh] w-full flex-col rounded-xl border border-line bg-panel shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton title="关闭" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-muted">
      {icon && <div className="text-muted/60">{icon}</div>}
      <div className="text-sm font-medium text-ink/80">{title}</div>
      {children && <div className="max-w-sm text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx('animate-spin text-muted', className ?? 'size-5')} />;
}

export function Toasts() {
  const { list, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed top-3 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {list.slice(-3).map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="pop-in pointer-events-auto flex max-w-md cursor-pointer items-center gap-2 rounded-lg bg-[#2f2f2f] px-3.5 py-2 text-[13px] text-white shadow-lg ring-1 ring-white/10"
        >
          <span className={cx('size-1.5 shrink-0 rounded-full', t.kind === 'error' ? 'bg-red-400' : t.kind === 'ok' ? 'bg-emerald-400' : 'bg-white/60')} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** 轻量下拉菜单：点外面或按 Esc 关闭 */
export function Menu({
  trigger,
  children,
  align = 'right',
  width = 232,
  placement = 'bottom',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: number;
  placement?: 'bottom' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          className={cx(
            'pop-in absolute z-40 rounded-lg border border-line bg-paper p-1 shadow-[0_12px_32px_rgba(15,15,15,0.12),0_2px_6px_rgba(15,15,15,0.06)]',
            align === 'right' ? 'right-0' : 'left-0',
            placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
          )}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  checked,
  danger,
  onClick,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  checked?: boolean;
  danger?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition hover:bg-hover disabled:opacity-40',
        danger && 'text-danger',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-muted">{hint}</span>}
      {checked !== undefined && <Check className={cx('size-3.5 shrink-0', checked ? 'text-ink' : 'invisible')} />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-line" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-md bg-hover p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded px-2.5 py-1 text-xs whitespace-nowrap transition',
            o.value === value ? 'bg-paper font-medium text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none', className ?? 'bg-hover text-muted')}>{children}</span>;
}

export function confirmAsk(message: string) {
  return window.confirm(message);
}

export function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 86400_000 * 7) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
