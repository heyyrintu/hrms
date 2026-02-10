import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  template?: string;
  context?: Record<string, unknown>;
  html?: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  private readonly templatesDir: string;
  private readonly isEnabled: boolean;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    this.from = this.configService.get<string>(
      'SMTP_FROM',
      'HRMS <noreply@hrms.local>',
    );
    this.templatesDir = path.join(__dirname, 'templates');
    this.isEnabled = !!host;

    if (this.isEnabled) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.configService.get<number>('SMTP_PORT', 587),
        secure: this.configService.get<number>('SMTP_PORT', 587) === 465,
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
      this.logger.log('Email service initialized with SMTP');
    } else {
      this.logger.warn(
        'Email service disabled: SMTP_HOST not configured. Emails will be logged only.',
      );
    }
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    let html = options.html || '';

    if (options.template) {
      html = this.renderTemplate(options.template, options.context || {});
    }

    if (!this.isEnabled || !this.transporter) {
      this.logger.log(
        `[Email Preview] To: ${Array.isArray(options.to) ? options.to.join(', ') : options.to} | Subject: ${options.subject}`,
      );
      this.logger.debug(`[Email Preview] Body: ${html || options.text}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html,
        text: options.text,
      });
      this.logger.log(
        `Email sent to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}: ${options.subject}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private renderTemplate(
    templateName: string,
    context: Record<string, unknown>,
  ): string {
    const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);

    if (!fs.existsSync(templatePath)) {
      this.logger.warn(`Email template not found: ${templatePath}`);
      return `<p>Template "${templateName}" not found</p>`;
    }

    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const template = handlebars.compile(templateSource);
    return template(context);
  }
}
