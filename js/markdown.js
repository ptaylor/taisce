import { Marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

// Markdown from a shared Dropbox folder can be written by someone else, so
// everything is sanitised before it reaches the DOM. The tests inject their own
// `sanitize` so the renderer can be checked without a browser.
const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
};

if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * @param {{sanitize?: (html: string) => string}} [options]
 * @returns {(source: string) => string}
 */
export function createRenderer({ sanitize } = {}) {
  const parser = new Marked({ gfm: true, breaks: false });
  const clean = sanitize ?? ((html) => DOMPurify.sanitize(html, PURIFY_CONFIG));
  return (source) => clean(parser.parse(source));
}

export const renderMarkdown = createRenderer();
