import assert from 'node:assert/strict';
import {
  buildArtPlayerSubtitleOption,
  buildCanvasPipSubtitleLines,
  buildSubtitleContainerStyle,
  buildSubtitleLineStyle,
  clampSubtitleOffset,
  createSubtitleAttachment,
  DEFAULT_SUBTITLE_STYLE,
  findSubtitleCueAtTime,
  pickAutoMatchedSubtitlesForVideos,
  pickAutoMatchedSubtitle,
  getSubtitleMimeType,
  getSubtitleTypeFromPath,
  normalizeSubtitleStyle,
  parseEditableSubtitleDocument,
  stepSubtitleOffset,
  updateSubtitleCueText
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

test('creates disabled auto-matched subtitle attachments', () => {
  const attachment = createSubtitleAttachment('D:\\Course\\lesson.srt', {
    enabled: false,
    autoMatched: true,
    now: 1234
  });

  assert.equal(attachment.enabled, false);
  assert.equal(attachment.autoMatched, true);
  assert.equal(attachment.lastUsedTime, 1234);
});

test('picks exact same-name subtitles before language-suffixed files', () => {
  const picked = pickAutoMatchedSubtitle('D:\\Course\\lesson.mp4', [
    'D:\\Course\\lesson.zh.srt',
    'D:\\Course\\lesson.ass',
    'D:\\Course\\notes.txt'
  ]);

  assert.equal(picked, 'D:\\Course\\lesson.ass');
});

test('picks preferred language-suffixed subtitles in the same directory', () => {
  const picked = pickAutoMatchedSubtitle('D:\\Course\\lesson.mp4', [
    'D:\\Other\\lesson.zh.srt',
    'D:\\Course\\lesson.en.vtt',
    'D:\\Course\\lesson.zh.srt'
  ]);

  assert.equal(picked, 'D:\\Course\\lesson.zh.srt');
});

test('uses a single subtitle in the same directory as a low-risk fallback', () => {
  const picked = pickAutoMatchedSubtitle('D:\\Course\\lesson.mp4', [
    'D:\\Course\\中文字幕.srt',
    'D:\\Other\\lesson.srt'
  ]);

  assert.equal(picked, 'D:\\Course\\中文字幕.srt');
});

test('does not auto-match ambiguous unrelated subtitles', () => {
  const picked = pickAutoMatchedSubtitle('D:\\Course\\lesson.mp4', [
    'D:\\Course\\part1.srt',
    'D:\\Course\\part2.srt'
  ]);

  assert.equal(picked, null);
});

test('batch fuzzy matches subtitles with course numbers, punctuation, and language suffixes', () => {
  const matches = pickAutoMatchedSubtitlesForVideos({
    videoPaths: [
      'D:\\Course\\9-3 多Agent规划步骤与记忆模型的设计与开发.mp4',
      'D:\\Course\\9-4 应用任务事件Domain模型的设计与完善.mp4',
      'D:\\Course\\9-5 LLM结构化输出缺陷与JSON修复解析器开发.mp4'
    ],
    subtitlePaths: [
      'D:\\Course\\09_03 多Agent规划步骤 记忆模型 设计开发.zh.srt',
      'D:\\Course\\9.4 应用任务事件 Domain模型 设计完善.ass',
      'D:\\Course\\第09章-05 LLM结构化输出缺陷 JSON修复解析器开发.en.vtt'
    ]
  });

  assert.deepEqual(
    matches.map(match => [match.videoPath, match.subtitlePath]),
    [
      [
        'D:\\Course\\9-3 多Agent规划步骤与记忆模型的设计与开发.mp4',
        'D:\\Course\\09_03 多Agent规划步骤 记忆模型 设计开发.zh.srt'
      ],
      [
        'D:\\Course\\9-4 应用任务事件Domain模型的设计与完善.mp4',
        'D:\\Course\\9.4 应用任务事件 Domain模型 设计完善.ass'
      ],
      [
        'D:\\Course\\9-5 LLM结构化输出缺陷与JSON修复解析器开发.mp4',
        'D:\\Course\\第09章-05 LLM结构化输出缺陷 JSON修复解析器开发.en.vtt'
      ]
    ]
  );
});

test('batch fuzzy matching skips existing subtitles but lets the manual selection win', () => {
  const matches = pickAutoMatchedSubtitlesForVideos({
    videoPaths: [
      'D:\\Course\\1-1 Intro.mp4',
      'D:\\Course\\1-2 Setup.mp4'
    ],
    subtitlePaths: [
      'D:\\Course\\manually-picked.srt',
      'D:\\Course\\1-1 Intro.zh.srt',
      'D:\\Course\\1-2 Setup.zh.srt'
    ],
    existingVideoPaths: [
      'D:\\Course\\1-1 Intro.mp4',
      'D:\\Course\\1-2 Setup.mp4'
    ],
    manualMatch: {
      videoPath: 'D:\\Course\\1-1 Intro.mp4',
      subtitlePath: 'D:\\Course\\manually-picked.srt'
    }
  });

  assert.deepEqual(
    matches.map(match => [match.videoPath, match.subtitlePath]),
    [['D:\\Course\\1-1 Intro.mp4', 'D:\\Course\\manually-picked.srt']]
  );
});

test('batch fuzzy matching never reuses the manually selected subtitle for another video', () => {
  const matches = pickAutoMatchedSubtitlesForVideos({
    videoPaths: [
      'D:\\Course\\1-1 Intro.mp4',
      'D:\\Course\\1-2 Setup.mp4'
    ],
    subtitlePaths: [
      'D:\\Course\\1-1 Intro.zh.srt',
      'D:\\Course\\1-2 Setup.zh.srt'
    ],
    manualMatch: {
      videoPath: 'D:\\Course\\1-1 Intro.mp4',
      subtitlePath: 'D:\\Course\\1-2 Setup.zh.srt'
    }
  });

  assert.deepEqual(
    matches.map(match => [match.videoPath, match.subtitlePath]),
    [['D:\\Course\\1-1 Intro.mp4', 'D:\\Course\\1-2 Setup.zh.srt']]
  );
});

test('batch fuzzy matching supports centralized subtitle folders outside chapter directories', () => {
  const matches = pickAutoMatchedSubtitlesForVideos({
    videoPaths: [
      'D:\\Course\\第10章 工具模块开发\\10-1 本章介绍-工具模块开发.mp4',
      'D:\\Course\\第10章 工具模块开发\\10-2 bing搜索引擎工具的设计思路与模型定义.mp4'
    ],
    subtitlePaths: [
      'D:\\Course\\外挂字幕\\10-1 本章介绍-工具模块开发_原文.srt',
      'D:\\Course\\外挂字幕\\10-2 bing搜索引擎工具的设计思路与模型定义_原文.srt'
    ]
  });

  assert.deepEqual(
    matches.map(match => [match.videoPath, match.subtitlePath]),
    [
      [
        'D:\\Course\\第10章 工具模块开发\\10-1 本章介绍-工具模块开发.mp4',
        'D:\\Course\\外挂字幕\\10-1 本章介绍-工具模块开发_原文.srt'
      ],
      [
        'D:\\Course\\第10章 工具模块开发\\10-2 bing搜索引擎工具的设计思路与模型定义.mp4',
        'D:\\Course\\外挂字幕\\10-2 bing搜索引擎工具的设计思路与模型定义_原文.srt'
      ]
    ]
  );
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

test('wraps canvas picture-in-picture subtitle text to the available width', () => {
  const lines = buildCanvasPipSubtitleLines(
    '首先目的学习并掌握不是优酷的相关使用技巧',
    110,
    text => text.length * 10
  );

  assert.deepEqual(lines, [
    '首先目的学习并掌握不是',
    '优酷的相关使用技巧'
  ]);
});

test('parses editable srt cues and locates current cue with subtitle offset', () => {
  const doc = parseEditableSubtitleDocument(
    [
      '1',
      '00:00:10,000 --> 00:00:12,500',
      'Hello',
      'world',
      '',
      '2',
      '00:00:13,000 --> 00:00:15,000',
      'Next line'
    ].join('\n'),
    'srt'
  );

  assert.equal(doc.cues.length, 2);
  assert.equal(doc.cues[0].id, '0-10000-12500');
  assert.equal(doc.cues[0].startTime, 10);
  assert.equal(doc.cues[0].endTime, 12.5);
  assert.equal(doc.cues[0].text, 'Hello\nworld');
  assert.equal(findSubtitleCueAtTime(doc.cues, 9.2, -1)?.id, doc.cues[0].id);
  assert.equal(findSubtitleCueAtTime(doc.cues, 12.2, 1)?.id, doc.cues[0].id);
});

test('updates only the text lines of an srt cue and preserves line endings', () => {
  const source = [
    '1',
    '00:00:10,000 --> 00:00:12,500',
    'Old text',
    '',
    '2',
    '00:00:13,000 --> 00:00:15,000',
    'Keep me',
    ''
  ].join('\r\n');
  const doc = parseEditableSubtitleDocument(source, 'srt');

  const updated = updateSubtitleCueText(source, 'srt', doc.cues[0].id, 'New text\nSecond row');

  assert.equal(updated, [
    '1',
    '00:00:10,000 --> 00:00:12,500',
    'New text',
    'Second row',
    '',
    '2',
    '00:00:13,000 --> 00:00:15,000',
    'Keep me',
    ''
  ].join('\r\n'));
});

test('updates vtt cue text while preserving cue id and timing settings', () => {
  const source = [
    'WEBVTT',
    '',
    'intro-cue',
    '00:00:01.000 --> 00:00:03.000 align:start position:10%',
    'Old caption',
    '',
    'NOTE editor should ignore this block',
    '',
    '00:00:04.000 --> 00:00:05.000',
    'Other caption',
    ''
  ].join('\n');
  const doc = parseEditableSubtitleDocument(source, 'vtt');

  assert.equal(doc.cues.length, 2);
  assert.equal(doc.cues[0].text, 'Old caption');
  const updated = updateSubtitleCueText(source, 'vtt', doc.cues[0].id, 'Corrected caption');

  assert.equal(updated, [
    'WEBVTT',
    '',
    'intro-cue',
    '00:00:01.000 --> 00:00:03.000 align:start position:10%',
    'Corrected caption',
    '',
    'NOTE editor should ignore this block',
    '',
    '00:00:04.000 --> 00:00:05.000',
    'Other caption',
    ''
  ].join('\n'));
});
