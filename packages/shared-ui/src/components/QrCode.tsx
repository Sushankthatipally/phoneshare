/// <reference path="../types/qrcode.d.ts" />

import { useEffect, useState } from 'react';

import QRCode from 'qrcode';

import { cx } from '../lib/cx.js';

interface QrCodeProps {
  className?: string;
  size?: number;
  value?: string | null;
}

export function QrCode({ className, size = 196, value }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!value?.trim()) {
      setDataUrl(null);
      return;
    }

    void QRCode.toDataURL(value, {
      color: {
        dark: '#f3f7fb',
        light: '#00000000',
      },
      margin: 1,
      width: size,
    }).then((nextUrl: string) => {
      if (!cancelled) {
        setDataUrl(nextUrl);
      }
    }).catch(() => {
      if (!cancelled) {
        setDataUrl(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [size, value]);

  return (
    <div
      className={cx('db-qr', className)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    >
      {dataUrl ? (
        <img
          alt="Pairing QR code"
          className="db-qr__image"
          height={size}
          src={dataUrl}
          width={size}
        />
      ) : (
        <div className="db-qr__fallback">
          <span>QR unavailable</span>
        </div>
      )}
    </div>
  );
}
