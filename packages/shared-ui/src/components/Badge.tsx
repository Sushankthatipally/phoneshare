import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cx('db-badge', tone !== 'neutral' && `db-badge--${tone}`, className)}
      {...props}
    />
  );
}
