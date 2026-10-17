import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-accent to-accent-2 text-accent-fg shadow-[0_8px_20px_-8px_var(--accent)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-panel-2 text-fg border border-line hover:bg-hover',
  ghost: 'text-muted hover:text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110 active:brightness-95',
};

export function Button({
  variant = 'secondary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  active,
  danger,
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; danger?: boolean; label: string }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cx(
        'grid size-10 place-items-center rounded-xl transition-all duration-150 disabled:opacity-40',
        danger
          ? 'bg-danger-soft text-danger hover:bg-danger hover:text-white'
          : active
            ? 'bg-accent text-accent-fg hover:brightness-110'
            : 'text-muted hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform duration-200',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl border border-line bg-panel-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all',
            value === o.value ? 'bg-elev text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-xl border border-line bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'h-11 w-full rounded-xl border border-line bg-panel-2 px-3.5 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent focus:bg-elev',
        props.className,
      )}
    />
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="animate-fade fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(
          'animate-pop flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-soft',
          wide ? 'max-w-4xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({
  name,
  size = 36,
  speaking,
  className,
}: {
  name: string;
  size?: number;
  speaking?: boolean;
  className?: string;
}) {
  const h = hue(name);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <div
      className={cx('grid shrink-0 place-items-center rounded-full font-bold text-white transition-shadow', speaking && 'speaking', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 75% 62%), hsl(${(h + 40) % 360} 70% 48%))`,
      }}
    >
      {initials || '?'}
    </div>
  );
}
