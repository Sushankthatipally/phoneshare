import type { HTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {}

export function GlassPanel({ className, ...props }: GlassPanelProps) {
  return <div className={cx('db-panel', className)} {...props} />;
}
