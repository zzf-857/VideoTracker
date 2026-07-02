export type SubtitleType = 'srt' | 'vtt' | 'ass';

export interface SubtitleStyleSettings {
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  positionX: number;
  positionY: number;
}

export interface SubtitleAttachment {
  path: string;
  name: string;
  type: SubtitleType;
  offset: number;
  encoding?: string;
  enabled: boolean;
  style?: SubtitleStyleSettings;
  autoMatched?: boolean;
  lastUsedTime: number;
}

export interface ArtPlayerSubtitleOption {
  url: string;
  name: string;
  type: SubtitleType;
  encoding: string;
  escape: boolean;
  style: Partial<CSSStyleDeclaration>;
  onVttLoad: (vtt: string) => string;
}

export const MIN_SUBTITLE_OFFSET = -10;
export const MAX_SUBTITLE_OFFSET = 10;
export const MIN_SUBTITLE_FONT_SIZE = 14;
export const MAX_SUBTITLE_FONT_SIZE = 48;
export const MIN_SUBTITLE_POSITION_X = 5;
export const MAX_SUBTITLE_POSITION_X = 95;
export const MIN_SUBTITLE_POSITION_Y = 8;
export const MAX_SUBTITLE_POSITION_Y = 92;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  fontSize: 24,
  textColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.72,
  positionX: 50,
  positionY: 82
};

const SUPPORTED_SUBTITLE_TYPES = new Set<SubtitleType>(['srt', 'vtt', 'ass']);
const SUBTITLE_TYPE_PRIORITY: Record<SubtitleType, number> = {
  srt: 0,
  vtt: 1,
  ass: 2
};
const SUBTITLE_LANGUAGE_PRIORITY = ['zh', 'cn', 'chs', 'cht', 'hans', 'hant', 'en', 'ja', 'jp', 'ko'];
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

interface ParsedPath {
  directory: string;
  fileName: string;
  stem: string;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatCssNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number, digits = 2): number {
  if (!Number.isFinite(value)) return fallback;
  return roundTo(Math.min(max, Math.max(min, value as number)), digits);
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (!value || !HEX_COLOR_PATTERN.test(value)) return fallback;

  const color = value.toLowerCase();
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }

  return color;
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color, DEFAULT_SUBTITLE_STYLE.backgroundColor);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  };
}

export function getSubtitleTypeFromPath(filePath: string): SubtitleType | null {
  const match = /\.([^.\\/]+)$/.exec(filePath.trim());
  if (!match) return null;

  const ext = match[1].toLowerCase();
  if (SUPPORTED_SUBTITLE_TYPES.has(ext as SubtitleType)) {
    return ext as SubtitleType;
  }

  return null;
}

export function getSubtitleFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function parsePathParts(filePath: string): ParsedPath {
  const normalized = filePath.trim().replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex).toLowerCase() : '';
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf('.');
  const stem = (dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName).toLowerCase();

  return { directory, fileName, stem };
}

function getLanguageSuffixRank(videoStem: string, subtitleStem: string): number {
  if (!subtitleStem.startsWith(`${videoStem}.`)) return Number.MAX_SAFE_INTEGER;

  const suffix = subtitleStem.slice(videoStem.length + 1);
  const tokens = suffix.split(/[\s._-]+/).filter(Boolean);
  const ranks = tokens.map(token => SUBTITLE_LANGUAGE_PRIORITY.indexOf(token)).filter(rank => rank >= 0);

  if (ranks.length === 0) return SUBTITLE_LANGUAGE_PRIORITY.length;
  return Math.min(...ranks);
}

export function pickAutoMatchedSubtitle(videoPath: string, candidatePaths: string[]): string | null {
  const videoParts = parsePathParts(videoPath);
  const supportedCandidates = candidatePaths
    .map(candidatePath => {
      const type = getSubtitleTypeFromPath(candidatePath);
      if (!type) return null;

      const subtitleParts = parsePathParts(candidatePath);
      if (subtitleParts.directory !== videoParts.directory) return null;

      const exactNameRank = subtitleParts.stem === videoParts.stem ? 0 : Number.MAX_SAFE_INTEGER;
      const languageRank = getLanguageSuffixRank(videoParts.stem, subtitleParts.stem);
      const relationRank = exactNameRank === 0 ? 0 : languageRank < Number.MAX_SAFE_INTEGER ? 1 : 2;

      return {
        path: candidatePath,
        relationRank,
        languageRank,
        typeRank: SUBTITLE_TYPE_PRIORITY[type],
        stableName: subtitleParts.fileName.toLowerCase()
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const namedMatches = supportedCandidates
    .filter(candidate => candidate.relationRank < 2)
    .sort((a, b) => (
      a.relationRank - b.relationRank ||
      a.languageRank - b.languageRank ||
      a.typeRank - b.typeRank ||
      a.stableName.localeCompare(b.stableName)
    ));

  if (namedMatches.length > 0) {
    return namedMatches[0].path;
  }

  const fallbackCandidates = supportedCandidates
    .filter(candidate => candidate.relationRank === 2)
    .sort((a, b) => a.typeRank - b.typeRank || a.stableName.localeCompare(b.stableName));

  return fallbackCandidates.length === 1 ? fallbackCandidates[0].path : null;
}

export function getSubtitleMimeType(type: SubtitleType): string {
  if (type === 'vtt') return 'text/vtt; charset=utf-8';
  if (type === 'srt') return 'application/x-subrip; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

export function clampSubtitleOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  const clamped = Math.min(MAX_SUBTITLE_OFFSET, Math.max(MIN_SUBTITLE_OFFSET, offset));
  return Math.round(clamped * 100) / 100;
}

export function stepSubtitleOffset(currentOffset: number, stepSeconds: number): number {
  return clampSubtitleOffset(currentOffset + stepSeconds);
}

export function normalizeSubtitleStyle(style?: Partial<SubtitleStyleSettings> | null): SubtitleStyleSettings {
  return {
    fontSize: Math.round(clampNumber(
      style?.fontSize,
      DEFAULT_SUBTITLE_STYLE.fontSize,
      MIN_SUBTITLE_FONT_SIZE,
      MAX_SUBTITLE_FONT_SIZE,
      0
    )),
    textColor: normalizeHexColor(style?.textColor, DEFAULT_SUBTITLE_STYLE.textColor),
    backgroundColor: normalizeHexColor(style?.backgroundColor, DEFAULT_SUBTITLE_STYLE.backgroundColor),
    backgroundOpacity: clampNumber(style?.backgroundOpacity, DEFAULT_SUBTITLE_STYLE.backgroundOpacity, 0, 1),
    positionX: clampNumber(
      style?.positionX,
      DEFAULT_SUBTITLE_STYLE.positionX,
      MIN_SUBTITLE_POSITION_X,
      MAX_SUBTITLE_POSITION_X
    ),
    positionY: clampNumber(
      style?.positionY,
      DEFAULT_SUBTITLE_STYLE.positionY,
      MIN_SUBTITLE_POSITION_Y,
      MAX_SUBTITLE_POSITION_Y
    )
  };
}

export function getSubtitleBackgroundCss(style?: Partial<SubtitleStyleSettings> | null): string {
  const normalizedStyle = normalizeSubtitleStyle(style);
  const { r, g, b } = hexToRgb(normalizedStyle.backgroundColor);
  return `rgba(${r}, ${g}, ${b}, ${normalizedStyle.backgroundOpacity})`;
}

export function buildSubtitleContainerStyle(style?: Partial<SubtitleStyleSettings> | null): Partial<CSSStyleDeclaration> {
  const normalizedStyle = normalizeSubtitleStyle(style);

  return {
    left: `${formatCssNumber(normalizedStyle.positionX)}%`,
    top: `${formatCssNumber(normalizedStyle.positionY)}%`,
    bottom: 'auto',
    width: 'auto',
    maxWidth: '88%',
    padding: '0',
    transform: 'translate(-50%, -50%)',
    transition: 'none',
    textAlign: 'center',
    alignItems: 'center',
    color: normalizedStyle.textColor,
    fontSize: `${normalizedStyle.fontSize}px`,
    lineHeight: '1.35',
    textShadow: '0 2px 6px rgba(0,0,0,0.95)',
    pointerEvents: 'auto',
    cursor: 'move'
  };
}

export function buildSubtitleLineStyle(style?: Partial<SubtitleStyleSettings> | null): Partial<CSSStyleDeclaration> {
  return {
    display: 'inline-flex',
    width: 'fit-content',
    maxWidth: '100%',
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '3px 8px',
    borderRadius: '4px',
    backgroundColor: getSubtitleBackgroundCss(style),
    color: 'inherit',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    lineHeight: '1.35'
  };
}

export function createSubtitleAttachment(filePath: string, options?: {
  offset?: number;
  enabled?: boolean;
  autoMatched?: boolean;
  style?: Partial<SubtitleStyleSettings>;
  now?: number;
}): SubtitleAttachment {
  const type = getSubtitleTypeFromPath(filePath);
  if (!type) {
    throw new Error('Unsupported subtitle file type');
  }

  return {
    path: filePath,
    name: getSubtitleFileName(filePath),
    type,
    offset: clampSubtitleOffset(options?.offset ?? 0),
    encoding: 'utf-8',
    enabled: options?.enabled ?? true,
    style: normalizeSubtitleStyle(options?.style),
    autoMatched: options?.autoMatched,
    lastUsedTime: options?.now ?? Date.now()
  };
}

export function buildArtPlayerSubtitleOption(
  attachment: SubtitleAttachment,
  subtitleUrl: string
): ArtPlayerSubtitleOption {
  return {
    url: subtitleUrl,
    name: attachment.name,
    type: attachment.type,
    encoding: attachment.encoding || 'utf-8',
    escape: true,
    style: buildSubtitleContainerStyle(attachment.style),
    onVttLoad: (vtt: string) => vtt
  };
}
