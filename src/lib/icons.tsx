import type { ComponentType } from 'react';
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Copy,
  Cpu,
  Dna,
  Download,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  Gauge,
  Layers3,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Terminal,
  Trash2,
  Undo2,
  Workflow,
  X,
  Zap,
} from 'lucide-react';

export const Icons = {
  alert: AlertTriangle,
  boxes: Boxes,
  check: Check,
  chevron: ChevronDown,
  clock: Clock,
  copy: Copy,
  cpu: Cpu,
  dna: Dna,
  download: Download,
  eye: Eye,
  eyeOff: EyeOff,
  file: FileText,
  flask: FlaskConical,
  gauge: Gauge,
  layers: Layers3,
  loader: Loader2,
  expand: Maximize2,
  pause: Pause,
  play: Play,
  redo: Redo2,
  rotate: RotateCcw,
  search: Search,
  start: SkipBack,
  end: SkipForward,
  spark: Sparkles,
  terminal: Terminal,
  trash: Trash2,
  undo: Undo2,
  flow: Workflow,
  close: X,
  zap: Zap,
  dot: CircleDot,
} as const;

export type IconName = keyof typeof Icons;

export function Glyph({ name, size = 14, ...rest }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  const C = Icons[name];
  return <C size={size} aria-hidden="true" {...rest} />;
}

const MODEL_ICON: Record<string, IconName> = {
  'i-doc': 'file',
  'i-search': 'search',
  'i-spark': 'spark',
  'i-layers': 'layers',
  'i-flow': 'flow',
  'i-seq': 'dna',
  'i-check': 'check',
  'i-download': 'download',
};

export function modelIcon(glyph: string): IconName {
  return MODEL_ICON[glyph] || 'spark';
}

export function Lucide({ icon: C, size = 14, ...rest }: { icon: ComponentType<any>; size?: number; className?: string }) {
  return <C size={size} aria-hidden="true" {...rest} />;
}
