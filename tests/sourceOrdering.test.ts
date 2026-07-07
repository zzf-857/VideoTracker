import assert from 'node:assert/strict';
import { moveItemById } from '../src/renderer/services/sourceOrdering';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const sources = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' }
];

test('moves a dragged source before the hovered source', () => {
  const reordered = moveItemById(sources, 'd', 'b');
  assert.deepEqual(reordered.map(source => source.id), ['a', 'd', 'b', 'c']);
});

test('keeps source order unchanged when drag ids are invalid', () => {
  const reordered = moveItemById(sources, 'missing', 'b');
  assert.deepEqual(reordered, sources);
});

test('returns the same order when dragged onto itself', () => {
  const reordered = moveItemById(sources, 'b', 'b');
  assert.deepEqual(reordered, sources);
});
