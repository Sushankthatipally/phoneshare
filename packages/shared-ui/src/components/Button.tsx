import type { ButtonHTMLAttributes } from 'react';

import { cx } from '../lib/cx.js';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  className,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx('db-button', `db-button--${variant}`, className)}
      type={type}
      {...props}
    />
  );
}
