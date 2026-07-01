import assert from 'node:assert/strict';
import {
  buildArtPlayerSubtitleOption,
  buildSubtitleContainerStyle,
  buildSubtitleLineStyle,
  clampSubtitleOffset,
  createSubtitleAttachment,
  DEFAULT_SUBTITLE_STYLE,
  getSubtitleMimeType,
  getSubtitleTypeFromPath,
  normalizeSubtitleStyle,
  stepSubtitleOffset
} from '../src/renderer/services/subtitles';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('detects supported subtitle file types case-insensitively', () => {
  assert.equal(getSubtitleTypeFromPath('D:\\Course\\lesson.zh.SRT'), 'srt');
  assert.equal(getSubtitleTypeFromPath('D:\\Course\\lesson.en.vtt'), 'vtt');
  assert.equal(getSubtitleTypeFromPath('D:\\Course\\lesson.ass'), 'ass');
});

test('rejects unsupported subtitle file types', () => {
  assert.equal(getSubtitleTypeFromPath('D:\\Course\\lesson.txt'), null);
  assert.equal(getSubtitleTypeFromPath('D:\\Course\\lesson.mp4'), null);
});

test('maps subtitle types to browser-readable mime types', () => {
  assert.equal(getSubtitleMimeType('vtt'), 'text/vtt; charset=utf-8');
  assert.equal(getSubtitleMimeType('srt'), 'application/x-subrip; charset=utf-8');
  assert.equal(getSubtitleMimeType('ass'), 'text/plain; charset=utf-8');
});

test('keeps subtitle offset inside the supported range', () => {
  assert.equal(clampSubtitleOffset(4.8), 4.8);
  assert.equal(clampSubtitleOffset(99), 10);
  assert.equal(clampSubtitleOffset(-99), -10);
});

test('steps subtitle offset by one second and rounds floating point noise', () => {
  assert.equal(stepSubtitleOffset(0, 1), 1);
  assert.equal(stepSubtitleOffset(1.0000000001, -1), 0);
  assert.equal(stepSubtitleOffset(10, 1), 10);
});

test('creates a persisted subtitle attachment from a local path', () => {
  const attachment = createSubtitleAttachment('D:\\Course\\lesson.zh.srt');

  assert.equal(attachment.path, 'D:\\Course\\lesson.zh.srt');
  assert.equal(attachment.name, 'lesson.zh.srt');
  assert.equal(attachment.type, 'srt');
  assert.equal(attachment.offset, 0);
  assert.equal(attachment.enabled, true);
  assert.equal(attachment.encoding, 'utf-8');
  assert.deepEqual(attachment.style, DEFAULT_SUBTITLE_STYLE);
  assert.equal(typeof attachment.lastUsedTime, 'number');
});

test('normalizes subtitle style defaults and clamps unsafe values', () => {
  assert.deepEqual(normalizeSubtitleStyle(), DEFAULT_SUBTITLE_STYLE);

  const style = normalizeSubtitleStyle({
    fontSize: 99,
    textColor: 'white',
    backgroundColor: '#12ABef',
    backgroundOpacity: -2,
    positionX: -50,
    positionY: 120
  });

  assert.deepEqual(style, {
    ...DEFAULT_SUBTITLE_STYLE,
    fontSize: 48,
    textColor: DEFAULT_SUBTITLE_STYLE.textColor,
    backgroundColor: '#12abef',
    backgroundOpacity: 0,
    positionX: 5,
    positionY: 92
  });
});

test('builds CSS styles for positioned subtitle container and cue lines', () => {
  const style = normalizeSubtitleStyle({
    fontSize: 30,
    textColor: '#ffd700',
    backgroundColor: '#101820',
    backgroundOpacity: 0.45,
    positionX: 32.456,
    positionY: 70.123
  });

  const containerStyle = buildSubtitleContainerStyle(style);
  assert.equal(containerStyle.left, '32.46%');
  assert.equal(containerStyle.top, '70.12%');
  assert.equal(containerStyle.bottom, 'auto');
  assert.equal(containerStyle.fontSize, '30px');
  assert.equal(containerStyle.color, '#ffd700');
  assert.equal(containerStyle.pointerEvents, 'auto');

  const lineStyle = buildSubtitleLineStyle(style);
  assert.equal(lineStyle.backgroundColor, 'rgba(16, 24, 32, 0.45)');
  assert.equal(lineStyle.padding, '3px 8px');
  assert.equal(lineStyle.display, 'inline-flex');
  assert.equal(lineStyle.width, 'fit-content');
  assert.equal(lineStyle.justifyContent, 'center');
  assert.equal(lineStyle.alignSelf, 'center');
  assert.equal(lineStyle.whiteSpace, 'normal');
});

test('builds an ArtPlayer subtitle option with strict boolean fields', () => {
  const option = buildArtPlayerSubtitleOption(
    createSubtitleAttachment('D:\\Course\\lesson.zh.srt'),
    'http://127.0.0.1:3000/subtitle?path=abc'
  );

  assert.equal(option.url, 'http://127.0.0.1:3000/subtitle?path=abc');
  assert.equal(option.type, 'srt');
  assert.equal(option.escape, true);
  assert.equal(option.encoding, 'utf-8');
  assert.equal(typeof option.onVttLoad, 'function');
  assert.equal(option.style.fontSize, '24px');
  assert.equal(option.style.left, '50%');
  assert.equal(option.style.top, '82%');
  assert.equal(option.onVttLoad('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi');
});
