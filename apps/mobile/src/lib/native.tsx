/**
 * Bridge to React Native primitives.
 * The existing screens were authored against a web stand-in API (style: CSSProperties, onPress).
 * This module re-exports the real RN components so screens compile against either runtime.
 *
 * Note: some web-only style keys ("display: grid", "background: linear-gradient", etc.) won't
 * render in RN at runtime; those screens render correctly on the web build (`expo start --web`)
 * and will need follow-up styling for native. The component API stays compatible.
 */
import type { PropsWithChildren, ReactNode } from 'react';
import {
  View as RNView,
  Text as RNText,
  ScrollView as RNScrollView,
  SafeAreaView as RNSafeAreaView,
  Pressable as RNPressable,
  TextInput as RNTextInput,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

type AnyStyle = StyleProp<ViewStyle> | StyleProp<TextStyle> | Record<string, unknown>;

export function View({ children, style }: PropsWithChildren<{ style?: AnyStyle }>) {
  return <RNView style={style as StyleProp<ViewStyle>}>{children}</RNView>;
}

export function Text({ children, style }: PropsWithChildren<{ style?: AnyStyle }>) {
  return <RNText style={style as StyleProp<TextStyle>}>{children}</RNText>;
}

export function ScrollView({
  children,
  style,
  contentContainerStyle,
}: PropsWithChildren<{ style?: AnyStyle; contentContainerStyle?: AnyStyle }>) {
  return (
    <RNScrollView
      contentContainerStyle={contentContainerStyle as StyleProp<ViewStyle>}
      style={style as StyleProp<ViewStyle>}
    >
      {children}
    </RNScrollView>
  );
}

export function SafeAreaView({ children, style }: PropsWithChildren<{ style?: AnyStyle }>) {
  return <RNSafeAreaView style={style as StyleProp<ViewStyle>}>{children}</RNSafeAreaView>;
}

export function Pressable({
  children,
  style,
  onPress,
  disabled,
}: PropsWithChildren<{ style?: AnyStyle; onPress?: () => void; disabled?: boolean }>) {
  return (
    <RNPressable
      disabled={disabled}
      onPress={onPress}
      style={style as StyleProp<ViewStyle>}
    >
      {children}
    </RNPressable>
  );
}

export function TextInput({
  style,
  onChangeText,
  value,
  placeholder,
}: {
  style?: AnyStyle;
  onChangeText?: (value: string) => void;
  value: string;
  placeholder?: string;
}) {
  return (
    <RNTextInput
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#5b7894"
      style={[
        {
          backgroundColor: '#0a1320',
          borderColor: '#274860',
          borderWidth: 1,
          borderRadius: 14,
          color: '#edf5ff',
          fontSize: 16,
          padding: 14,
        },
        style as StyleProp<TextStyle>,
      ]}
      value={value}
    />
  );
}

export function Button({
  children,
  style,
  onPress,
  disabled,
}: PropsWithChildren<{ style?: AnyStyle; onPress?: () => void; onClick?: () => void; disabled?: boolean }>) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          backgroundColor: disabled ? '#223448' : '#3aa9ff',
          borderRadius: 16,
          paddingVertical: 14,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style as StyleProp<ViewStyle>,
      ]}
    >
      <RNText
        style={{
          color: disabled ? '#7b8da4' : '#03101b',
          fontSize: 14,
          fontWeight: '700',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        {children as ReactNode}
      </RNText>
    </TouchableOpacity>
  );
}

export function Spacer({ size = 16 }: { size?: number }) {
  return <RNView style={{ height: size }} />;
}
