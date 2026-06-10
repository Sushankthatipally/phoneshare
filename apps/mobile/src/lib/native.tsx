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
import { tokens } from '@dropbeam/shared-ui-rn';

type AnyStyle = StyleProp<ViewStyle> | StyleProp<TextStyle> | Record<string, unknown>;

export function View({ children, style }: PropsWithChildren<{ style?: AnyStyle }>) {
  return <RNView style={style as StyleProp<ViewStyle>}>{children}</RNView>;
}

export function Text({
  children,
  style,
  onPress,
  numberOfLines,
}: PropsWithChildren<{ style?: AnyStyle; onPress?: () => void; numberOfLines?: number }>) {
  return (
    <RNText numberOfLines={numberOfLines} onPress={onPress} style={style as StyleProp<TextStyle>}>
      {children}
    </RNText>
  );
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
  hitSlop,
}: PropsWithChildren<{
  style?: AnyStyle | ((state: { pressed: boolean }) => AnyStyle);
  onPress?: () => void;
  disabled?: boolean;
  hitSlop?: number | { top?: number; right?: number; bottom?: number; left?: number };
}>) {
  return (
    <RNPressable
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop}
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
  multiline,
  numberOfLines,
  placeholderTextColor,
}: {
  style?: AnyStyle;
  onChangeText?: (value: string) => void;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  placeholderTextColor?: string;
}) {
  return (
    <RNTextInput
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor ?? tokens.color.textDim}
      multiline={multiline}
      numberOfLines={numberOfLines}
      style={[
        {
          backgroundColor: tokens.color.inputBg,
          borderColor: tokens.color.panelBorder,
          borderWidth: 1,
          borderRadius: tokens.radius.md,
          color: tokens.color.text,
          fontFamily: tokens.fontFamily.sans,
          fontSize: tokens.fontSize.base,
          padding: tokens.spacing.md,
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
      activeOpacity={0.82}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          backgroundColor: tokens.color.text,
          borderRadius: tokens.radius.xl,
          paddingVertical: tokens.spacing.md,
          paddingHorizontal: tokens.spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? tokens.opacity.disabled : 1,
        },
        style as StyleProp<ViewStyle>,
      ]}
    >
      <RNText
        style={{
          color: tokens.color.textInverse,
          fontFamily: tokens.fontFamily.sans,
          fontSize: tokens.fontSize.sm,
          fontWeight: tokens.fontWeight.semibold,
          letterSpacing: tokens.letterSpacing.wide,
        }}
      >
        {children as ReactNode}
      </RNText>
    </TouchableOpacity>
  );
}

export function Spacer({ size = tokens.spacing.lg }: { size?: number }) {
  return <RNView style={{ height: size }} />;
}
