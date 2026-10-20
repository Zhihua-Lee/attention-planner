import { describe, expect, it } from 'vitest';
import { openUrl } from '../src/ui/markdown';
import helper from '../tools/open-link/open-link.js?raw';

type Decision = { open?: string; kind?: string; error?: string };
// The helper as Windows Script Host runs it; without WScript it only defines its functions.
const decide = new Function(`${helper}\nreturn decide;`)() as (
  url: string,
  roots: string[],
  kindOf: (p: string) => string,
) => Decision;

const folders = ['D:\\notes', 'D:\\notes\\a b', 'D:\\notes\\tool.exe'];
const files = [
  'D:\\notes\\plan.md',
  'D:\\notes\\paper.PDF',
  'D:\\notes\\run.bat',
  'D:\\notes\\x.lnk',
  'D:\\notes\\README',
];
const has = (list: string[], p: string) => list.some((x) => x.toLowerCase() === p.toLowerCase()); // as Windows does
const kindOf = (p: string) => (has(folders, p) ? 'folder' : has(files, p) ? 'file' : '');
const open = (path: string, roots = ['D:\\']) => decide(openUrl(path), roots, kindOf);

describe('open-link helper', () => {
  it('opens folders and notes, PDFs and pictures inside the allowed folders', () => {
    expect(open('D:\\notes')).toEqual({ open: 'D:\\notes', kind: 'folder' });
    expect(open('D:/notes/a b/')).toEqual({ open: 'D:\\notes\\a b', kind: 'folder' });
    expect(open('d:\\notes\\plan.md')).toMatchObject({ open: 'd:\\notes\\plan.md' });
    expect(open('D:\\notes\\paper.PDF').open).toBeDefined();
    expect(open('D:\\notes\\tool.exe').open).toBeDefined(); // a folder, whatever its name
  });

  it('opens nothing that runs, and nothing outside the allowed folders', () => {
    for (const p of ['D:\\notes\\run.bat', 'D:\\notes\\x.lnk', 'D:\\notes\\README'])
      expect(open(p).error).toBeDefined();
    expect(open('C:\\Windows').error).toMatch(/Outside/);
    expect(open('D:\\notes', ['D:\\work']).error).toMatch(/Outside/);
    expect(open('D:\\notesX', ['D:\\notes']).error).toMatch(/Outside/);
    expect(open('D:\\notes\\..\\..\\Windows').error).toBeDefined();
    expect(open('\\\\server\\share').error).toBeDefined();
    expect(open('D:\\notes\\plan.md:hidden').error).toBeDefined();
    expect(open('D:\\notes\\gone.md').error).toBe('Not found');
  });

  it('takes only ap-open: links', () => {
    expect(decide('file:///D:/notes', ['D:\\'], kindOf).error).toBeDefined();
    expect(decide('ap-open:%E0%A4%A', ['D:\\'], kindOf).error).toBeDefined();
    expect(decide('ap-open://D%3A%5Cnotes', ['D:\\'], kindOf).open).toBe('D:\\notes');
  });
});
