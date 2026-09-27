import { BadRequestException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as Handlebars from 'handlebars';

/**
 * Rendering shared by generated letters and job offers (Keka wave D).
 *
 * Templates render here, not on the shared Handlebars singleton, so helpers
 * registered elsewhere in the process are unreachable from template content.
 * Nothing is registered on it deliberately: only the variables passed at
 * render time are in scope.
 */
const LETTER_TEMPLATE_ENV = Handlebars.create();

export const TEMPLATE_RENDER_ERROR = 'Failed to render template — check template syntax';

/**
 * Render HR-authored template content with the given variables.
 * Values are HTML-escaped (`{{x}}`); unknown fields render empty.
 * Throws BadRequestException when the template does not compile.
 */
export function renderLetterContent(
  content: string,
  variables: Record<string, string>,
): string {
  try {
    // Letter templates are authored content: compiling them on the shared
    // instance would hand every app helper to whoever can edit a template.
    // The runtime flags additionally refuse prototype traversal, the usual
    // route from template injection to code execution.
    const compiled = LETTER_TEMPLATE_ENV.compile(content, { strict: false });
    return compiled(variables, {
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    });
  } catch {
    throw new BadRequestException(TEMPLATE_RENDER_ERROR);
  }
}

/** "15 March 2026" (en-IN), or '' for a missing date. */
export function formatLetterDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Letter HTML as plain text for the PDF (tags stripped, basic entities decoded). */
export function letterContentToPlainText(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x3D;/g, '=')
    .replace(/&#x60;/g, '`')
    .replace(/&amp;/g, '&')
    .trim();
}

export interface LetterPdfInput {
  /** Top-right label, e.g. "OFFER LETTER". */
  badge: string;
  date: Date | string;
  recipientName: string;
  /** Second line under the name (employee code · department, job title…). */
  recipientLine: string;
  /** Rendered letter content (HTML or text). */
  content: string;
}

/** A4 letter PDF: header bar, badge, date, recipient, content, footer. */
export function renderLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 6).fill('#1a56db');

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#6b7280')
      .text(input.badge, 60, 30, { align: 'right' });

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#374151')
      .text(`Date: ${formatLetterDate(input.date)}`, 60, 50);

    doc
      .moveDown(0.5)
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(input.recipientName);

    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(input.recipientLine);

    const divY = doc.y + 12;
    doc.moveTo(60, divY).lineTo(535, divY).strokeColor('#e5e7eb').lineWidth(1).stroke();

    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor('#111827')
      .text(letterContentToPlainText(input.content), 60, divY + 16, {
        width: 475,
        lineGap: 4,
        paragraphGap: 8,
      });

    const footY = doc.page.height - 60;
    doc.moveTo(60, footY).lineTo(535, footY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#9ca3af')
      .text('This is a computer-generated document.', 60, footY + 6, {
        align: 'center',
        width: 475,
      });

    doc.end();
  });
}
