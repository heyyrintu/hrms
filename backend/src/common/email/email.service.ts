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

type Transport = 'graph' | 'smtp' | 'console';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private smtpTransporter: nodemailer.Transporter | null = null;
  private graphClient: any = null;
  private readonly senderEmail: string;
  private readonly templatesDir: string;
  private readonly transport: Transport;

  constructor(private configService: ConfigService) {
    this.templatesDir = path.join(__dirname, 'templates');

    const graphTenantId = this.configService.get<string>('MS_GRAPH_TENANT_ID');
    const graphClientId = this.configService.get<string>('MS_GRAPH_CLIENT_ID');
    const graphClientSecret = this.configService.get<string>('MS_GRAPH_CLIENT_SECRET');
    const graphSender = this.configService.get<string>('MS_GRAPH_SENDER_EMAIL');

    if (graphTenantId && graphClientId && graphClientSecret && graphSender) {
      this.senderEmail = graphSender;
      this.transport = 'graph';
      this.initGraphClient(graphTenantId, graphClientId, graphClientSecret);
      return;
    }

    const smtpHost = this.configService.get<string>('SMTP_HOST');
    this.senderEmail = this.configService.get<string>(
      'SMTP_FROM',
      'HRMS <noreply@hrms.local>',
    );

    if (smtpHost) {
      this.transport = 'smtp';
      this.smtpTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.configService.get<number>('SMTP_PORT', 587),
        secure: this.configService.get<number>('SMTP_PORT', 587) === 465,
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
      this.logger.log('Email service initialized with SMTP');
      return;
    }

    this.transport = 'console';
    this.logger.warn(
      'Email service: no transport configured. Emails will be logged only.',
    );
  }

  private async initGraphClient(
    tenantId: string,
    clientId: string,
    clientSecret: string,
  ) {
    try {
      const { ClientSecretCredential } = await import('@azure/identity');
      const { Client } = await import('@microsoft/microsoft-graph-client');
      const {
        TokenCredentialAuthenticationProvider,
      } = await import(
        '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials'
      );

      const credential = new ClientSecretCredential(
        tenantId,
        clientId,
        clientSecret,
      );

      const authProvider = new TokenCredentialAuthenticationProvider(
        credential,
        { scopes: ['https://graph.microsoft.com/.default'] },
      );

      this.graphClient = Client.initWithMiddleware({ authProvider });
      this.logger.log(
        `Email service initialized with Microsoft Graph (sender: ${this.senderEmail})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize Microsoft Graph client: ${error instanceof Error ? error.message : error}`,
      );
      this.logger.warn('Falling back to console-only email logging');
      (this as any).transport = 'console';
    }
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    let html = options.html || '';

    if (options.template) {
      html = this.renderTemplate(options.template, options.context || {});
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    switch (this.transport) {
      case 'graph':
        await this.sendViaGraph(recipients, options.subject, html, options.text);
        break;
      case 'smtp':
        await this.sendViaSmtp(recipients, options.subject, html, options.text);
        break;
      default:
        this.logEmail(recipients, options.subject, html, options.text);
    }
  }

  private async sendViaGraph(
    recipients: string[],
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.graphClient) {
      this.logEmail(recipients, subject, html, text);
      return;
    }

    const message = {
      subject,
      body: {
        contentType: html ? 'HTML' : 'Text',
        content: html || text || '',
      },
      toRecipients: recipients.map((email) => ({
        emailAddress: { address: email },
      })),
    };

    try {
      await this.graphClient
        .api(`/users/${this.senderEmail}/sendMail`)
        .post({ message, saveToSentItems: false });

      this.logger.log(
        `Email sent via Graph to ${recipients.join(', ')}: ${subject}`,
      );
    } catch (error) {
      this.logger.error(
        `Graph email failed to ${recipients.join(', ')}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async sendViaSmtp(
    recipients: string[],
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.smtpTransporter) {
      this.logEmail(recipients, subject, html, text);
      return;
    }

    try {
      await this.smtpTransporter.sendMail({
        from: this.senderEmail,
        to: recipients.join(', '),
        subject,
        html,
        text,
      });
      this.logger.log(
        `Email sent via SMTP to ${recipients.join(', ')}: ${subject}`,
      );
    } catch (error) {
      this.logger.error(
        `SMTP email failed to ${recipients.join(', ')}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private logEmail(
    recipients: string[],
    subject: string,
    html: string,
    text?: string,
  ): void {
    this.logger.log(
      `[Email Preview] To: ${recipients.join(', ')} | Subject: ${subject}`,
    );
    this.logger.debug(`[Email Preview] Body: ${html || text}`);
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
