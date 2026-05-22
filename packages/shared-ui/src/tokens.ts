import tokensJson from './tokens.json' with { type: 'json' };

export type DesignTokens = typeof tokensJson;

export const tokens: DesignTokens = tokensJson;

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
