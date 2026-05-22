import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { tokens } from '../tokens.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label?: string;
  children?: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  leading?: ReactNode;
  trailing?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

export function Button({
  label,
  children,
  onPress,
  variant = 'primary',
  disabled,
  style,
  labelStyle,
  leading,
  trailing,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const palette = paletteFor(variant);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={(state: PressableStateCallbackType) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: disabled ? tokens.opacity.disabled : state.pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {leading}
      {label !== undefined ? (
        <Text style={[styles.label, { color: palette.fg }, labelStyle]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {children}
      {trailing}
    </Pressable>
  );
}

function paletteFor(variant: ButtonVariant) {
  switch (variant) {
    case 'primary':
      return {
        bg: tokens.color.text,
        fg: tokens.color.textInverse,
        border: tokens.color.text,
      };
    case 'secondary':
      return {
        bg: tokens.color.surfaceSoft,
        fg: tokens.color.text,
        border: tokens.color.panelBorder,
      };
    case 'danger':
      return {
        bg: tokens.color.surfaceSoft,
        fg: tokens.color.amber,
        border: tokens.color.panelBorderStrong,
      };
    case 'ghost':
    default:
      return {
        bg: 'transparent',
        fg: tokens.color.text,
        border: tokens.color.panelBorder,
      };
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    gap: tokens.spacing.sm,
  },
  label: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.sm,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: tokens.letterSpacing.wide,
  },
});
