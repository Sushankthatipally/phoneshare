import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { tokens } from '@dropbeam/shared-ui-rn';

// Line icons rendered from lucide path data (lucide-react v1.7.0), so the
// mobile app uses the exact same icon set as the desktop (lucide-react).
// Keep stroke/viewBox identical to lucide's defaults: 24x24, strokeWidth 2,
// round caps/joins, no fill.
type IconNode =
  | ['path', { d: string }]
  | ['circle', { cx: number; cy: number; r: number }]
  | ['line', { x1: number; y1: number; x2: number; y2: number }]
  | ['rect', { x: number; y: number; width: number; height: number; rx?: number; ry?: number }];

const ICONS = {
  download: [
    ['path', { d: 'M12 15V3' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }],
  ],
  'send-horizontal': [
    ['path', { d: 'M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z' }],
    ['path', { d: 'M6 12h16' }],
  ],
  settings: [
    ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  'file-text': [
    ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
    ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
    ['path', { d: 'M10 9H8' }],
    ['path', { d: 'M16 13H8' }],
    ['path', { d: 'M16 17H8' }],
  ],
  folder: [
    ['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }],
  ],
  type: [
    ['path', { d: 'M12 4v16' }],
    ['path', { d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' }],
    ['path', { d: 'M9 20h6' }],
  ],
  clipboard: [
    ['rect', { width: 8, height: 4, x: 8, y: 2, rx: 1, ry: 1 }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
  ],
  monitor: [
    ['rect', { width: 20, height: 14, x: 2, y: 3, rx: 2 }],
    ['line', { x1: 8, x2: 16, y1: 21, y2: 21 }],
    ['line', { x1: 12, x2: 12, y1: 17, y2: 21 }],
  ],
  smartphone: [
    ['rect', { width: 14, height: 20, x: 5, y: 2, rx: 2, ry: 2 }],
    ['path', { d: 'M12 18h.01' }],
  ],
  tablet: [
    ['rect', { width: 16, height: 20, x: 4, y: 2, rx: 2, ry: 2 }],
    ['line', { x1: 12, x2: 12.01, y1: 18, y2: 18 }],
  ],
  heart: [
    ['path', { d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5' }],
  ],
} satisfies Record<string, IconNode[]>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Pass the same value as `color` for a solid glyph (e.g. an active heart). */
  fill?: string;
}

export function Icon({ name, size = 18, color = tokens.color.text, strokeWidth = 2, fill = 'none' }: IconProps) {
  const nodes = ICONS[name] as IconNode[];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {nodes.map((node, index) => {
        const [tag, attrs] = node;
        if (tag === 'path') return <Path key={index} {...attrs} />;
        if (tag === 'circle') return <Circle key={index} {...attrs} />;
        if (tag === 'line') return <Line key={index} {...attrs} />;
        return <Rect key={index} {...attrs} />;
      })}
    </Svg>
  );
}
