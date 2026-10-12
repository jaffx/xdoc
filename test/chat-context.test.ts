import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt, windowMessages, type ChatTurn } from '../src/server/chat';
import type { SpaceInfo } from '../src/server/space';

function turn(role: 'user' | 'assistant', content: string): ChatTurn {
  return { role, content, at: Date.now() };
}

test('windowMessages 空历史返回空数组', () => {
  assert.deepEqual(windowMessages([]), []);
});

test('windowMessages 按条数上限保留最近的消息', () => {
  const turns = [turn('user', 'q1'), turn('assistant', 'a1'), turn('user', 'q2'), turn('assistant', 'a2')];
  const messages = windowMessages(turns, { maxMessages: 2, maxChars: 99999 });
  assert.deepEqual(messages, [
    { role: 'user', content: 'q2' },
    { role: 'assistant', content: 'a2' },
  ]);
});

test('windowMessages 按字符预算裁掉过旧的消息', () => {
  const turns = [turn('user', 'a'.repeat(100)), turn('assistant', 'b'.repeat(100)), turn('user', 'c'.repeat(50))];
  const messages = windowMessages(turns, { maxMessages: 99, maxChars: 160 });
  assert.deepEqual(messages, [
    { role: 'assistant', content: 'b'.repeat(100) },
    { role: 'user', content: 'c'.repeat(50) },
  ]);
});

test('windowMessages 至少保留最新一条，即使超出预算', () => {
  const turns = [turn('user', 'x'.repeat(500))];
  const messages = windowMessages(turns, { maxMessages: 1, maxChars: 10 });
  assert.deepEqual(messages, [{ role: 'user', content: 'x'.repeat(500) }]);
});

test('buildSystemPrompt 包含空间名称与当前文档', () => {
  const info: SpaceInfo = {
    id: 's1',
    name: '知识库',
    slug: 's1',
    dir: '/tmp/s1',
    docRoot: '/tmp/s1/doc',
  };
  const prompt = buildSystemPrompt(info, 'guide/intro.md');
  assert.match(prompt, /知识库/);
  assert.match(prompt, /guide\/intro\.md/);
  assert.match(prompt, /read_doc/);
});

test('buildSystemPrompt 未打开文档时不提当前文档', () => {
  const info: SpaceInfo = { id: 's1', name: '知识库', slug: 's1', dir: '/tmp/s1', docRoot: '/tmp/s1/doc' };
  assert.doesNotMatch(buildSystemPrompt(info), /当前正在浏览/);
});