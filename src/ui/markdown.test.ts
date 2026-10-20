import { describe, expect, it } from 'vitest';
import { noteMarkdown, openUrl, pathOf } from './markdown';

const hrefs = (md: string) => [...noteMarkdown(md).matchAll(/href="([^"]+)"/g)].map((m) => pathOf(m[1]) ?? m[1]);

describe('local paths in a note', () => {
  it('a bare path becomes a link, up to a space or Chinese punctuation', () => {
    expect(hrefs('See D:\\notes\\plan.md, then D:\\work')).toEqual(['D:\\notes\\plan.md', 'D:\\work']);
    expect(hrefs('先看D:\\笔记\\读书.md，再写')).toEqual(['D:\\笔记\\读书.md']);
  });

  it('keeps a backslash that Markdown would take as an escape', () => {
    expect(hrefs('D:\\code\\.ai\\HANDOFF.md')).toEqual(['D:\\code\\.ai\\HANDOFF.md']);
  });

  it('a path with spaces goes in backticks', () => {
    const html = noteMarkdown('Open `D:\\portable apps\\notes` first');
    expect(html).toContain(`<a href="${openUrl('D:\\portable apps\\notes')}"`);
    expect(html).toContain('<code>D:\\portable apps\\notes</code>');
  });

  it('a Markdown link to a path opens the path', () => {
    expect(hrefs('[plan](<D:/my notes/plan.md>)')).toEqual(['D:/my notes/plan.md']);
  });

  it('leaves web links, words and other code alone', () => {
    expect(hrefs('https://example.com/a and ABC:\\x and `npm test`')).toEqual(['https://example.com/a']);
    expect(noteMarkdown('```\nD:\\in\\a\\block\n```')).not.toContain('href');
  });

  it('the link carries the whole path, quotes and all, safely', () => {
    const url = openUrl('D:\\a "b"\\c&d.md');
    expect(url).not.toMatch(/["\s&]/);
    expect(pathOf(url)).toBe('D:\\a "b"\\c&d.md');
    expect(pathOf('https://example.com')).toBeUndefined();
  });
});
