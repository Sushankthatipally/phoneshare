import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';

export function View({ children, style }: { children?: ReactNode; style?: CSSProperties; key?: any }) {
  return <div style={style}>{children}</div>;
}

export function Text({ children, style }: { children?: ReactNode; style?: CSSProperties; key?: any }) {
  return <div style={style}>{children}</div>;
}

export function ScrollView({ children, style }: { children?: ReactNode; style?: CSSProperties; key?: any }) {
  return <div style={{ overflowY: 'auto', ...style }}>{children}</div>;
}

export function SafeAreaView({ children, style }: { children?: ReactNode; style?: CSSProperties; key?: any }) {
  return <div style={style}>{children}</div>;
}

export function Pressable({
  children,
  style,
  onPress,
  disabled,
  key,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  onPress?: () => void;
  disabled?: boolean;
  key?: any;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onPress}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'transparent',
        border: 0,
        color: 'inherit',
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
  key,
}: {
  style?: CSSProperties;
  onChangeText?: (value: string) => void;
  value: string;
  placeholder?: string;
  key?: any;
}) {
  return (
    <input
      onChange={(event: any) => onChangeText?.(event.target.value)}
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
  disabled,
  key,
}: {
  children?: ReactNode;
  style?: CSSProperties;
  onPress?: () => void;
  disabled?: boolean;
  key?: any;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onPress}
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
