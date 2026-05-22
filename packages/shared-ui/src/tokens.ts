import tokensJson from './tokens.json';

export const tokens = tokensJson;

export type DesignTokens = typeof tokensJson;

type Path<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends object
    ? Path<T[K], `${Prefix}${K}.`> | `${Prefix}${K}`
    : `${Prefix}${K}`;
}[keyof T & string];

export type DesignTokenPath = Path<DesignTokens>;

export function getDesignToken(path: DesignTokenPath): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, tokens as unknown);
}
