import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

type NativeStyle = CSSProperties;

export function View({ children, style }: PropsWithChildren<{ style?: NativeStyle }>) {
  return <div style={style}>{children}</div>;
}

export function Text({ children, style }: PropsWithChildren<{ style?: NativeStyle }>) {
  return <div style={style}>{children}</div>;
}

export function ScrollView({ children, style }: PropsWithChildren<{ style?: NativeStyle }>) {
  return <div style={{ overflowY: 'auto', ...style }}>{children}</div>;
}

export function SafeAreaView({ children, style }: PropsWithChildren<{ style?: NativeStyle }>) {
  return <div style={style}>{children}</div>;
}

export function Pressable({
  children,
  style,
  onPress,
  disabled,
}: PropsWithChildren<{ style?: NativeStyle; onPress?: () => void; disabled?: boolean }>) {
  return (
    <button
      disabled={disabled}
      onClick={onPress}
      style={{
        background: 'transparent',
        border: 0,
        color: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        ...style,
      }}
      type="button"
    >
      {children}
    </button>
  );
}

export function TextInput({
  style,
  onChangeText,
  value,
  placeholder,
}: {
  style?: NativeStyle;
  onChangeText?: (value: string) => void;
  value: string;
  placeholder?: string;
}) {
  return (
    <input
      onChange={(event) => onChangeText?.(event.target.value)}
      placeholder={placeholder}
      style={{
        backgroundColor: '#0a1320',
        border: '1px solid #274860',
        borderRadius: 14,
        color: '#edf5ff',
        fontSize: 16,
        padding: '14px 16px',
        width: '100%',
        ...style,
      }}
      value={value}
    />
  );
}

export function Button({
  children,
  style,
  onPress,
  onClick,
  disabled,
}: PropsWithChildren<{
  style?: NativeStyle;
  onPress?: () => void;
  onClick?: () => void;
  disabled?: boolean;
}>) {
  return (
    <button
      disabled={disabled}
      onClick={onPress ?? onClick}
      style={{
        backgroundColor: disabled ? '#223448' : '#3aa9ff',
        border: '1px solid transparent',
        borderRadius: 16,
        color: disabled ? '#7b8da4' : '#03101b',
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: 0.4,
        padding: '14px 16px',
        textTransform: 'uppercase',
        ...style,
      }}
      type="button"
    >
      {children}
    </button>
  );
}

export function Spacer({ size = 16 }: { size?: number }) {
  return <div style={{ height: size }} />;
}
