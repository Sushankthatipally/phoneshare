export type QuickSaveValue = 'off' | 'favorites' | 'on';

const OPTIONS: ReadonlyArray<{ value: QuickSaveValue; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'on', label: 'On' },
];

interface QuickSaveToggleProps {
  value: QuickSaveValue;
  onChange: (next: QuickSaveValue) => void;
  disabled?: boolean;
}

export function QuickSaveToggle({ value, onChange, disabled }: QuickSaveToggleProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        borderRadius: 'var(--db-radius-xl)',
        border: '1px solid var(--db-panel-border)',
        background: 'rgba(255, 255, 255, 0.03)',
        padding: 4,
        gap: 4,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--db-radius-lg)',
              border: 'none',
              background: active ? 'var(--db-text)' : 'transparent',
              color: active ? '#000000' : 'var(--db-text-soft)',
              fontWeight: 600,
              fontSize: '0.78rem',
              letterSpacing: '0.08em',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'background 120ms ease, color 120ms ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
