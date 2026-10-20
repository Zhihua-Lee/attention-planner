import type { MouseEvent } from 'react';
import { local } from '../store/store';
import { toast } from './common';
import { pathOf } from './markdown';
import type { T } from './text';

/** Set on a device where the open-link helper (tools/open-link) is installed, so its links open paths. */
export const OPEN_PATHS = 'ap:open-paths';

/** A click in a note: a link to a local path is copied instead, unless this device opens such paths. */
export function onNoteClick(e: MouseEvent, t: T) {
  const a = (e.target as HTMLElement).closest('a');
  const path = a && pathOf(a.getAttribute('href') ?? '');
  if (path === undefined || path === null || local.get(OPEN_PATHS) === '1') return;
  e.preventDefault();
  navigator.clipboard?.writeText(path).then(
    () => toast(t(`已复制路径：${path}`, `Path copied: ${path}`)),
    () => toast(path),
  ) ?? toast(path);
}
