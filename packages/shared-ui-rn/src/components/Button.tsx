import type { ReactNode } from 'react';
import { Pressable, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';

import { tokens } from '../lib/tokens.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function Button({
  children,
  onPress,
  disabled,
  variant = 'secondary',
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : null,
        variant === 'ghost' ? styles.ghost : null,
        variant === 'danger' ? styles.danger : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.labelPrimary : null,
          variant === 'danger' ? styles.labelDanger : null,
          textStyle,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    backgroundColor: tokens.color.inputBg,
    borderColor: tokens.color.panelBorder,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
  },
  primary: {
    backgroundColor: tokens.color.primary,
    borderColor: tokens.color.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: 'transparent',
    borderColor: tokens.color.danger,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    borderColor: tokens.color.panelBorderStrong,
    opacity: 0.85,
  },
  label: {
    color: tokens.color.text,
    fontFamily: tokens.font.sans,
    fontSize: tokens.fontSize.body,
    fontWeight: tokens.fontWeight.semibold,
    letterSpacing: 0.4,
  },
  labelPrimary: {
    color: tokens.color.primaryFg,
  },
  labelDanger: {
    color: tokens.color.danger,
  },
});
