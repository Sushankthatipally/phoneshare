import tokensJsonRaw from './tokens.json' with { type: 'json' };

type FontWeightValue = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

interface TokensShape {
  color: Record<string, string>;
  radius: Record<string, number>;
  spacing: Record<string, number>;
  font: Record<string, string>;
  fontFamily: Record<string, string>;
  fontSize: Record<string, number>;
  fontWeight: Record<string, FontWeightValue>;
  letterSpacing: Record<string, number>;
  lineHeight: Record<string, number>;
  opacity: Record<string, number>;
  shadow: {
    default: string;
    panel: {
      color: string;
      opacity: number;
      offsetX: number;
      offsetY: number;
      blur: number;
      elevation: number;
    };
  };
}

export type DesignTokens = TokensShape;

type DotPath<T, P extends string = ''> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? DotPath<T[K], `${P}${K}.`> : `${P}${K}` }[keyof T & string]
  : never;

export type DesignTokenPath = DotPath<DesignTokens>;

export const tokens: DesignTokens = tokensJsonRaw as DesignTokens;

/**
 * Resolve a token via dot-path notation.
 *
 * @example
 *   getDesignToken('color.bgPrimary')
 *   getDesignToken('radius.lg')
 */
export function getDesignToken(path: string): string | undefined {
  if (!path) return undefined;
  const segments = path.split('.');
  let cursor: unknown = tokens;
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

export default tokens;
