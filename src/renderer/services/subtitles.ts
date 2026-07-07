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

export interface SubtitleBatchMatch {
  videoPath: string;
  subtitlePath: string;
  score: number;
  reason: 'manual' | 'exact' | 'fuzzy';
}

export interface SubtitleBatchMatchOptions {
  videoPaths: string[];
  subtitlePaths: string[];
  existingVideoPaths?: Iterable<string>;
  manualMatch?: {
    videoPath: string;
    subtitlePath: string;
  };
}

export interface EditableSubtitleCue {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  text: string;
  timingLine: number;
  textStartLine: number;
  textEndLine: number;
}

export interface EditableSubtitleDocument {
  type: 'srt' | 'vtt';
  cues: EditableSubtitleCue[];
  lineEnding: string;
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
const SUBTITLE_NOISE_TOKENS = new Set([
  ...SUBTITLE_LANGUAGE_PRIORITY,
  'zho',
  'eng',
  'sub',
  'subs',
  'subtitle',
  'subtitles',
  'caption',
  'captions',
  'cc',
  'srt',
  'vtt',
  'ass',
  '字幕',
  '原文',
  '中文字幕',
  '中文',
  '简中',
  '简体',
  '繁中',
  '繁体',
  '双语',
  '中英'
]);
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const SUBTITLE_TIMING_PATTERN = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/;

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

function getLineEnding(content: string): string {
  if (content.includes('\r\n')) return '\r\n';
  if (content.includes('\r')) return '\r';
  return '\n';
}

function splitSubtitleLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/);
}

function parseSubtitleTimestamp(timestamp: string): number | null {
  const parts = timestamp.trim().replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const secondPart = parts[parts.length - 1];
  const [wholeSecondsText, fractionText = '0'] = secondPart.split('.');
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  const minutes = Number(parts[parts.length - 2]);
  const seconds = Number(wholeSecondsText);
  const milliseconds = Number(fractionText.padEnd(3, '0').slice(0, 3));

  if (![hours, minutes, seconds, milliseconds].every(Number.isFinite)) return null;

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function parseTimingLine(line: string): { startTime: number; endTime: number } | null {
  const match = SUBTITLE_TIMING_PATTERN.exec(line);
  if (!match) return null;

  const startTime = parseSubtitleTimestamp(match[1]);
  const endTime = parseSubtitleTimestamp(match[2]);
  if (startTime === null || endTime === null || endTime < startTime) return null;

  return { startTime, endTime };
}

function buildEditableSubtitleCueId(index: number, startTime: number, endTime: number): string {
  return `${index}-${Math.round(startTime * 1000)}-${Math.round(endTime * 1000)}`;
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

function normalizePathKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').toLowerCase();
}

function stripTrailingSubtitleNoise(stem: string): string {
  let current = stem;
  let changed = true;

  while (changed) {
    changed = false;
    const parts = current.split(/[\s._\-()[\]【】]+/).filter(Boolean);
    if (parts.length <= 1) break;

    const last = parts[parts.length - 1].toLowerCase();
    if (SUBTITLE_NOISE_TOKENS.has(last)) {
      parts.pop();
      current = parts.join(' ');
      changed = true;
    }
  }

  return current;
}

function normalizeComparableStem(stem: string): string {
  return stripTrailingSubtitleNoise(stem)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/第\s*(\d+)\s*[章节讲课集]/g, '$1')
    .replace(/[\s._\-()[\]【】《》<>:：,，。!！?？+&/\\|]+/g, '')
    .replace(/[的与和及]/g, '');
}

function extractNumberSignature(stem: string): string {
  const numbers = stem.normalize('NFKC').match(/\d+/g) || [];
  return numbers
    .slice(0, 3)
    .map(part => String(Number(part)))
    .join('.');
}

function getBigrams(value: string): string[] {
  if (value.length <= 1) return value ? [value] : [];
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aGrams = getBigrams(a);
  const bGrams = getBigrams(b);
  if (aGrams.length === 0 || bGrams.length === 0) return 0;

  const counts = new Map<string, number>();
  aGrams.forEach(gram => counts.set(gram, (counts.get(gram) || 0) + 1));

  let intersection = 0;
  bGrams.forEach(gram => {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      intersection += 1;
      counts.set(gram, count - 1);
    }
  });

  return (2 * intersection) / (aGrams.length + bGrams.length);
}

function scoreSubtitleMatch(videoPath: string, subtitlePath: string): { score: number; reason: 'exact' | 'fuzzy' } {
  const videoParts = parsePathParts(videoPath);
  const subtitleParts = parsePathParts(subtitlePath);
  if (!getSubtitleTypeFromPath(subtitlePath)) return { score: 0, reason: 'fuzzy' };

  const exactNameRank = subtitleParts.stem === videoParts.stem ? 0 : Number.MAX_SAFE_INTEGER;
  const languageRank = getLanguageSuffixRank(videoParts.stem, subtitleParts.stem);
  if (exactNameRank === 0) return { score: 1.3, reason: 'exact' };
  if (languageRank < Number.MAX_SAFE_INTEGER) return { score: 1.2 - languageRank * 0.01, reason: 'exact' };

  const videoComparable = normalizeComparableStem(videoParts.stem);
  const subtitleComparable = normalizeComparableStem(subtitleParts.stem);
  const videoNumbers = extractNumberSignature(videoParts.stem);
  const subtitleNumbers = extractNumberSignature(subtitleParts.stem);

  if (videoNumbers && subtitleNumbers && videoNumbers !== subtitleNumbers) {
    return { score: 0, reason: 'fuzzy' };
  }

  const baseScore = diceCoefficient(videoComparable, subtitleComparable);
  const numberBoost = videoNumbers && subtitleNumbers && videoNumbers === subtitleNumbers ? 0.18 : 0;
  const containsBoost = (
    videoComparable.includes(subtitleComparable) ||
    subtitleComparable.includes(videoComparable)
  ) ? 0.1 : 0;

  return {
    score: Math.min(1.1, baseScore + numberBoost + containsBoost),
    reason: 'fuzzy'
  };
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

export function pickAutoMatchedSubtitlesForVideos(options: SubtitleBatchMatchOptions): SubtitleBatchMatch[] {
  const existingVideoPathSet = new Set(
    Array.from(options.existingVideoPaths || []).map(pathValue => normalizePathKey(pathValue))
  );
  const manualVideoKey = options.manualMatch ? normalizePathKey(options.manualMatch.videoPath) : '';
  const manualSubtitleKey = options.manualMatch ? normalizePathKey(options.manualMatch.subtitlePath) : '';
  const matches: SubtitleBatchMatch[] = [];
  const usedSubtitleKeys = new Set<string>();

  if (
    options.manualMatch &&
    getSubtitleTypeFromPath(options.manualMatch.subtitlePath)
  ) {
    matches.push({
      videoPath: options.manualMatch.videoPath,
      subtitlePath: options.manualMatch.subtitlePath,
      score: Number.POSITIVE_INFINITY,
      reason: 'manual'
    });
    usedSubtitleKeys.add(manualSubtitleKey);
  }

  const candidates: SubtitleBatchMatch[] = [];

  options.videoPaths.forEach(videoPath => {
    const videoKey = normalizePathKey(videoPath);
    if (videoKey === manualVideoKey) return;
    if (existingVideoPathSet.has(videoKey)) return;

    let bestMatch: SubtitleBatchMatch | null = null;
    let secondBestScore = 0;

    options.subtitlePaths.forEach(subtitlePath => {
      const subtitleKey = normalizePathKey(subtitlePath);
      if (subtitleKey === manualSubtitleKey) return;

      const { score, reason } = scoreSubtitleMatch(videoPath, subtitlePath);
      if (score <= 0) return;

      if (!bestMatch || score > bestMatch.score) {
        secondBestScore = bestMatch?.score || 0;
        bestMatch = { videoPath, subtitlePath, score, reason };
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    });

    if (!bestMatch) return;
    const isStrongExact = bestMatch.reason === 'exact';
    const isConfidentFuzzy = bestMatch.score >= 0.62 && bestMatch.score - secondBestScore >= 0.04;
    if (isStrongExact || isConfidentFuzzy) {
      candidates.push(bestMatch);
    }
  });

  candidates
    .sort((a, b) => (
      b.score - a.score ||
      a.videoPath.localeCompare(b.videoPath, 'zh-CN')
    ))
    .forEach(candidate => {
      const subtitleKey = normalizePathKey(candidate.subtitlePath);
      if (usedSubtitleKeys.has(subtitleKey)) return;
      matches.push(candidate);
      usedSubtitleKeys.add(subtitleKey);
    });

  return matches.sort((a, b) => {
    if (a.reason === 'manual' && b.reason !== 'manual') return -1;
    if (a.reason !== 'manual' && b.reason === 'manual') return 1;
    return a.videoPath.localeCompare(b.videoPath, 'zh-CN');
  });
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

export function parseEditableSubtitleDocument(content: string, type: SubtitleType): EditableSubtitleDocument {
  if (type !== 'srt' && type !== 'vtt') {
    throw new Error('Subtitle editing supports only srt and vtt files');
  }

  const lines = splitSubtitleLines(content);
  const cues: EditableSubtitleCue[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    while (lineIndex < lines.length && lines[lineIndex].trim() === '') {
      lineIndex += 1;
    }
    if (lineIndex >= lines.length) break;

    const blockStartLine = lineIndex;
    while (lineIndex < lines.length && lines[lineIndex].trim() !== '') {
      lineIndex += 1;
    }
    const blockEndLine = lineIndex;
    const blockLines = lines.slice(blockStartLine, blockEndLine);
    const timingOffset = blockLines.findIndex(line => Boolean(parseTimingLine(line)));

    if (timingOffset >= 0) {
      const timingLine = blockStartLine + timingOffset;
      const timing = parseTimingLine(lines[timingLine]);
      if (timing) {
        const textStartLine = timingLine + 1;
        const textEndLine = blockEndLine;
        const cueIndex = cues.length;
        cues.push({
          id: buildEditableSubtitleCueId(cueIndex, timing.startTime, timing.endTime),
          index: cueIndex,
          startTime: timing.startTime,
          endTime: timing.endTime,
          text: lines.slice(textStartLine, textEndLine).join('\n'),
          timingLine,
          textStartLine,
          textEndLine
        });
      }
    }
  }

  return {
    type,
    cues,
    lineEnding: getLineEnding(content)
  };
}

export function updateSubtitleCueText(
  content: string,
  type: SubtitleType,
  cueId: string,
  nextText: string
): string {
  const document = parseEditableSubtitleDocument(content, type);
  const cue = document.cues.find(item => item.id === cueId);
  if (!cue) {
    throw new Error('Subtitle cue not found');
  }

  const lines = splitSubtitleLines(content);
  const nextTextLines = nextText.replace(/\r\n|\r/g, '\n').split('\n');
  lines.splice(cue.textStartLine, cue.textEndLine - cue.textStartLine, ...nextTextLines);
  return lines.join(document.lineEnding);
}

export function findSubtitleCueAtTime(
  cues: EditableSubtitleCue[],
  currentTime: number,
  subtitleOffset = 0
): EditableSubtitleCue | null {
  if (!Number.isFinite(currentTime)) return null;
  const effectiveTime = currentTime - clampSubtitleOffset(subtitleOffset);
  return cues.find(cue => effectiveTime >= cue.startTime && effectiveTime <= cue.endTime) || null;
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

export function buildCanvasPipSubtitleLines(
  text: string,
  maxWidth: number,
  measureTextWidth: (text: string) => number,
  maxLines = 3
): string[] {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return [];

  const lines: string[] = [];
  let currentLine = '';

  Array.from(normalizedText).forEach(char => {
    const nextLine = `${currentLine}${char}`;
    if (currentLine && measureTextWidth(nextLine) > maxWidth) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = nextLine;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines);
}
