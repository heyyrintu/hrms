import { BadRequestException } from '@nestjs/common';
import {
  formatLetterDate,
  letterContentToPlainText,
  renderLetterContent,
  renderLetterPdf,
} from './letter-render';

describe('renderLetterContent', () => {
  it('substitutes variables', () => {
    expect(renderLetterContent('Dear {{firstName}} of {{companyName}}', {
      firstName: 'Asha',
      companyName: 'Acme',
    })).toBe('Dear Asha of Acme');
  });

  it('renders unknown variables empty instead of throwing', () => {
    expect(renderLetterContent('A{{missing}}B', {})).toBe('AB');
  });

  it('HTML-escapes variable values', () => {
    expect(renderLetterContent('{{name}}', { name: '<script>x</script>' })).toBe(
      '&lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('does not expose helpers registered on the shared Handlebars instance', () => {
    const globalHandlebars = require('handlebars');
    const leaked = jest.fn().mockReturnValue('LEAKED');
    globalHandlebars.registerHelper('sharedHelper', leaked);
    try {
      const out = renderLetterContent('X{{sharedHelper}}X', {});
      expect(leaked).not.toHaveBeenCalled();
      expect(out).not.toContain('LEAKED');
    } finally {
      globalHandlebars.unregisterHelper('sharedHelper');
    }
  });

  it('refuses prototype traversal', () => {
    const out = renderLetterContent('{{constructor.name}}|{{__proto__}}', { a: 'b' });
    expect(out).not.toContain('Object');
  });

  it('throws BadRequestException on template syntax errors', () => {
    expect(() => renderLetterContent('{{#if}}', {})).toThrow(BadRequestException);
  });
});

describe('formatLetterDate', () => {
  it('formats a date as "15 March 2026"', () => {
    expect(formatLetterDate(new Date('2026-03-15T12:00:00Z'))).toBe('15 March 2026');
  });

  it('returns empty text for null', () => {
    expect(formatLetterDate(null)).toBe('');
  });
});

describe('letterContentToPlainText', () => {
  it('strips tags and decodes the basic entities', () => {
    expect(letterContentToPlainText('<p>A &amp; B</p><p>C<br/>D &lt;x&gt;</p>')).toBe(
      'A & B\n\nC\nD <x>',
    );
  });
});

describe('renderLetterPdf', () => {
  it('produces a PDF buffer', async () => {
    const pdf = await renderLetterPdf({
      badge: 'OFFER LETTER',
      date: new Date('2026-03-15T12:00:00Z'),
      recipientName: 'Asha Rao',
      recipientLine: 'Software Engineer',
      content: '<p>Hello</p>',
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
