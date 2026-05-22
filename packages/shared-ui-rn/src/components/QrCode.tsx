import { useEffect, useState, type ComponentType } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../tokens.js';

interface QRCodeComponentProps {
  value: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  quietZone?: number;
}

export interface QrCodeProps {
  value?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function QrCode({ value, size = 196, style }: QrCodeProps) {
  const Renderer = useQrRenderer();
  const trimmed = value?.trim();
  const padding = tokens.spacing.md;
  const innerSize = size;
  const outerSize = innerSize + padding * 2;

  return (
    <View
      style={[
        styles.surface,
        { width: outerSize, height: outerSize, padding },
        style,
      ]}
    >
      {trimmed && Renderer ? (
        <Renderer
          value={trimmed}
          size={innerSize}
          color={tokens.color.qrDark}
          backgroundColor={tokens.color.qrLight}
          quietZone={0}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: innerSize, height: innerSize, borderColor: tokens.color.qrFallbackBorder },
          ]}
        >
          <Text style={styles.fallbackText}>{trimmed ? 'QR unavailable' : 'No code'}</Text>
        </View>
      )}
    </View>
  );
}

let cachedRenderer: ComponentType<QRCodeComponentProps> | null | undefined;

function useQrRenderer(): ComponentType<QRCodeComponentProps> | null {
  const [renderer, setRenderer] = useState<ComponentType<QRCodeComponentProps> | null>(
    cachedRenderer === undefined ? null : cachedRenderer,
  );

  useEffect(() => {
    if (cachedRenderer !== undefined) return;
    let cancelled = false;
    import('react-native-qrcode-svg')
      .then((mod) => {
        if (cancelled) return;
        const component = (mod.default ?? null) as ComponentType<QRCodeComponentProps> | null;
        cachedRenderer = component;
        setRenderer(component);
      })
      .catch(() => {
        if (cancelled) return;
        cachedRenderer = null;
        if (typeof console !== 'undefined') {
          console.warn(
            '[shared-ui-rn] react-native-qrcode-svg is not installed; rendering QR fallback.',
          );
        }
        setRenderer(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return renderer;
}

const styles = StyleSheet.create({
  surface: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.xl + 6,
    borderWidth: 1,
    borderColor: tokens.color.panelBorder,
    backgroundColor: tokens.color.qrSurface,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: tokens.radius.xl,
  },
  fallbackText: {
    fontFamily: tokens.fontFamily.sans,
    fontSize: tokens.fontSize.xs,
    color: tokens.color.textSoft,
    letterSpacing: tokens.letterSpacing.widest,
    textTransform: 'uppercase',
  },
});
