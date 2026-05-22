import { useEffect } from 'react';
import type { PropsWithChildren } from 'react';

interface ModalProps {
  onClose?: () => void;
  size?: 'md' | 'lg';
}

export function Modal({ children, onClose, size = 'md' }: PropsWithChildren<ModalProps>) {
  useEffect(() => {
    if (!onClose) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${size === 'lg' ? ' modal--lg' : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
