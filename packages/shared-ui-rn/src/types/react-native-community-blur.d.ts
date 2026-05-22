declare module '@react-native-community/blur' {
  import type { ComponentType } from 'react';
  import type { ViewProps } from 'react-native';

  export interface BlurViewProps extends ViewProps {
    blurType?: 'dark' | 'light' | 'xlight' | 'extraDark' | 'regular' | 'prominent';
    blurAmount?: number;
    reducedTransparencyFallbackColor?: string;
  }

  export const BlurView: ComponentType<BlurViewProps>;
}
