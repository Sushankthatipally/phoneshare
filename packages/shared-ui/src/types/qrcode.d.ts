declare module 'qrcode' {
  export interface QrCodeOptions {
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  const QRCode: {
    toDataURL(value: string, options?: QrCodeOptions): Promise<string>;
  };

  export default QRCode;
}
