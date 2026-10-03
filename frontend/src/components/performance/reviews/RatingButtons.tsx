'use client';

interface RatingButtonsProps {
  label: string;
  value?: number;
  onChange: (value: number) => void;
  max?: number;
  disabled?: boolean;
}

/** 1..max rating picker. Each button is labelled "<label>: <n>". */
export function RatingButtons({ label, value, onChange, max = 5, disabled }: RatingButtonsProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${label}: ${n}`}
          aria-pressed={value === n}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`h-9 w-9 rounded-lg border text-sm font-medium transition-colors ${
            value === n
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-warm-300 text-warm-700 hover:bg-warm-50'
          } disabled:opacity-50`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
