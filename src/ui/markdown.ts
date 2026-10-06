import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** A note's Markdown as safe HTML: line breaks kept, links may open in a new tab. */
export const noteHtml = (md: string) =>
  DOMPurify.sanitize(marked.parse(md, { async: false, breaks: true }) as string, { ADD_ATTR: ['target'] });
