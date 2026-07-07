import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shouldPausePlaybackOnWindowBlur,
  SUPPRESS_NEXT_PLAYER_BLUR_PAUSE_EVENT
} from '../src/renderer/services/playerFocus';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('chapter list updates do not recreate the ArtPlayer instance', () => {
  const source = readFileSync('src/renderer/components/Player.tsx', 'utf8');
  const artplayerEffect = source.match(
    /\/\/ 1\. 初始化和销毁 ArtPlayer[\s\S]*?\n  \}, \[([^\]]*)\]\);/
  );

  assert.ok(artplayerEffect, 'ArtPlayer lifecycle effect was not found');
  assert.ok(
    !artplayerEffect[1].includes('activeChapters'),
    'activeChapters in the lifecycle effect dependencies recreates the player and pauses playback'
  );
  assert.ok(
    !artplayerEffect[1].includes('nextVideoName'),
    'nextVideoName in the lifecycle effect dependencies recreates the player when search updates the play queue'
  );
  assert.ok(
    source.includes('activeChaptersRef'),
    'chapter data should be synchronized through a ref without recreating ArtPlayer'
  );
  assert.ok(
    source.includes('nextVideoNameRef'),
    'next video name should be synchronized through a ref without recreating ArtPlayer'
  );
});

test('ended handler uses the latest onEnded callback without recreating ArtPlayer', () => {
  const source = readFileSync('src/renderer/components/Player.tsx', 'utf8');

  assert.ok(
    source.includes('onEndedRef'),
    'onEnded should be synchronized through a ref so autoplay sees the latest play queue'
  );
  assert.ok(
    source.includes('onEndedRef.current'),
    'video ended handler should call the latest onEnded callback from the ref'
  );
});

test('search focus suppression prevents the next blur from pausing playback', () => {
  assert.equal(SUPPRESS_NEXT_PLAYER_BLUR_PAUSE_EVENT, 'videotracker:suppress-next-player-blur-pause');
  assert.equal(
    shouldPausePlaybackOnWindowBlur({
      pauseOnBlur: true,
      isPlaying: true,
      suppressNextBlurPause: true,
      activeElementId: ''
    }),
    false
  );
  assert.equal(
    shouldPausePlaybackOnWindowBlur({
      pauseOnBlur: true,
      isPlaying: true,
      suppressNextBlurPause: false,
      activeElementId: 'sidebar-search-input'
    }),
    false
  );
  assert.equal(
    shouldPausePlaybackOnWindowBlur({
      pauseOnBlur: true,
      isPlaying: true,
      suppressNextBlurPause: false,
      activeElementId: ''
    }),
    true
  );
});

test('picture-in-picture stays on ArtPlayer native control flow', () => {
  const source = readFileSync('src/renderer/components/Player.tsx', 'utf8');

  assert.ok(
    source.includes('pip: true'),
    'ArtPlayer native PiP control should stay enabled'
  );
  assert.ok(
    !source.includes('art-control-pip'),
    'Player should not intercept ArtPlayer PiP button clicks'
  );
  assert.ok(
    !source.includes('openDetachedPictureInPicture'),
    'Player should not replace ArtPlayer PiP with a custom Electron mini window'
  );
});
