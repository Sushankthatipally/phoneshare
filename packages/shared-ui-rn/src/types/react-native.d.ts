declare module 'react-native' {
  import type { ComponentType, ReactNode, Ref } from 'react';

  export interface ViewStyle {
    [key: string]: unknown;
  }
  export interface TextStyle extends ViewStyle {}
  export interface ImageStyle extends ViewStyle {}

  type RecursiveArray<T> = ReadonlyArray<T | RecursiveArray<T>>;
  type Falsy = false | 0 | '' | null | undefined;
  export type StyleProp<T> = T | RecursiveArray<T | Falsy> | Falsy;

  export interface AccessibilityProps {
    accessible?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessibilityHint?: string;
    accessibilityState?: Record<string, unknown>;
    testID?: string;
  }

  export interface ViewProps extends AccessibilityProps {
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
    pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
    onLayout?: (event: unknown) => void;
    ref?: Ref<unknown>;
  }

  export const View: ComponentType<ViewProps>;

  export interface TextProps extends AccessibilityProps {
    style?: StyleProp<TextStyle>;
    children?: ReactNode;
    numberOfLines?: number;
    ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
    selectable?: boolean;
  }
  export const Text: ComponentType<TextProps>;

  export interface PressableStateCallbackType {
    pressed: boolean;
  }

  export interface PressableProps extends AccessibilityProps {
    style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
    children?: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
    onPress?: () => void;
    onPressIn?: () => void;
    onPressOut?: () => void;
    onLongPress?: () => void;
    disabled?: boolean;
    hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  }
  export const Pressable: ComponentType<PressableProps>;

  export interface StyleSheetStatic {
    create<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(styles: T): { [K in keyof T]: T[K] };
    flatten<T>(style: StyleProp<T>): T;
    hairlineWidth: number;
    absoluteFillObject: ViewStyle;
  }
  export const StyleSheet: StyleSheetStatic;

  export interface PlatformStatic {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
    select<T>(specifics: { ios?: T; android?: T; web?: T; default?: T; native?: T }): T | undefined;
  }
  export const Platform: PlatformStatic;
}
