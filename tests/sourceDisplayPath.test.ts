import { strict as assert } from 'assert';
import { getSourceDisplayPath } from '../src/renderer/services/sourceDisplayPath';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('keeps local paths with a literal percent sign unchanged', () => {
  const path = 'D:\\Videos\\本地学习课程\\【大模型RAG】2026年吃透B站最全最细的RAG知识库搭建系统教程，手把手教你训练RAG，从入门到实战全流程教学！全程干货！少走99%的弯路';

  assert.equal(getSourceDisplayPath({ type: 'local', path }), path);
});

test('decodes percent-encoded remote source paths for display', () => {
  assert.equal(
    getSourceDisplayPath({
      type: 'alist',
      path: 'https://example.com/dav/%E8%A7%82%E5%BD%B1%E5%8C%BA/04%20Videos/'
    }),
    'https://example.com/dav/观影区/04 Videos/'
  );
});

test('falls back to the original remote path when URI encoding is malformed', () => {
  const path = 'https://example.com/dav/少走99%的弯路';

  assert.equal(getSourceDisplayPath({ type: 'webdav', path }), path);
});
