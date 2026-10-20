import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';

/** The scheme the open-link helper (tools/open-link) registers on a computer; it opens the path in Explorer. */
const SCHEME = 'ap-open:';
const DRIVE = /^[A-Za-z]:[\\/]/;
/** A bare drive path runs up to a space, a quote, a character Windows forbids, or Chinese punctuation. */
const BARE = /^[A-Za-z]:[\\/][^\s<>"|?*`，。；、！？（）「」『』【】《》]*/;
const TRAILING = /[.,;:!?)\]}'’”…]+$/;

export const openUrl = (path: string) => SCHEME + encodeURIComponent(path);

/** The local path a link opens, if it opens one. */
export function pathOf(href: string): string | undefined {
  if (!href.toLowerCase().startsWith(SCHEME)) return undefined;
  try {
    return decodeURIComponent(href.slice(SCHEME.length));
  } catch {
    return undefined;
  }
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type PathToken = Tokens.Generic & { path: string; code: boolean };

const marked = new Marked({
  async: false,
  breaks: true,
  extensions: [
    {
      // D:\notes\a.md, or `D:\with spaces\a.md` in backticks, as a link. Read from the source, so a backslash
      // before punctuation (D:\.ai) is kept rather than taken as a Markdown escape.
      name: 'localPath',
      level: 'inline',
      start: (src) => {
        const m = /(^|[^A-Za-z0-9_])`?[A-Za-z]:[\\/]/.exec(src);
        return m ? m.index + m[1].length : undefined;
      },
      tokenizer: (src) => {
        const code = /^`([A-Za-z]:[\\/][^`\n]*)`/.exec(src);
        if (code) return { type: 'localPath', raw: code[0], path: code[1].trim(), code: true };
        const m = BARE.exec(src);
        const path = m?.[0].replace(TRAILING, '');
        return path && path.length > 3 ? { type: 'localPath', raw: path, path, code: false } : undefined;
      },
      renderer: (token) => {
        const { path, code } = token as PathToken;
        const text = code ? `<code>${escape(path)}</code>` : escape(path);
        return `<a href="${openUrl(path)}" title="${escape(path)}">${text}</a>`;
      },
    },
  ],
  // [plan](<D:/notes/plan.md>): a Markdown link to a path opens it too.
  walkTokens: (token) => {
    if (token.type !== 'link' || !DRIVE.test(token.href)) return;
    let path = token.href;
    try {
      path = decodeURI(path);
    } catch {
      /* keep it as written */
    }
    token.href = openUrl(path);
  },
});

/** A note's Markdown as HTML, before it is made safe; local paths become links that open them. */
export const noteMarkdown = (md: string) => marked.parse(md) as string;

/** DOMPurify's own list of allowed link targets, plus the local-path scheme. */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|ap-open):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** A note's Markdown as safe HTML: line breaks kept, links may open in a new tab. */
export const noteHtml = (md: string) =>
  DOMPurify.sanitize(noteMarkdown(md), { ADD_ATTR: ['target'], ALLOWED_URI_REGEXP });
