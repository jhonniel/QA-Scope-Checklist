/**
 * Outbound mail boundary. Phase 2 ships a console transport (no SMTP in
 * development); a real provider is a drop-in implementation of this
 * interface and nothing else in the codebase changes.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailService {
  send(message: MailMessage): Promise<void>;
}

export class ConsoleMailService implements MailService {
  constructor(private readonly log: (msg: string) => void = console.log) {}

  async send(message: MailMessage): Promise<void> {
    this.log(`\n[mail] To: ${message.to}\n[mail] Subject: ${message.subject}\n${message.text}\n`);
  }
}
