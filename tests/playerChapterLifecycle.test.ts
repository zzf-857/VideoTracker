import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
    source.includes('activeChaptersRef'),
    'chapter data should be synchronized through a ref without recreating ArtPlayer'
  );
});
