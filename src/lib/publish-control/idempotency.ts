import { createHash } from 'crypto';

export function hashHtml(html: string): string {
  return createHash('sha256').update(html, 'utf8').digest('hex');
}

export function isValidRequestId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id);
}
