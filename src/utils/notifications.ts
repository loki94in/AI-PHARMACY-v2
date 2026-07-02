import { Response } from 'express';

export interface NotificationPayload {
  type: 'telegram_bill' | 'new_email';
  title: string;
  message: string;
  distributorName?: string;
  invoiceNo?: string;
  timestamp?: string;
  whatsappSent?: boolean;
  whatsappNumber?: string;
}

class NotificationManager {
  private clients: Response[] = [];

  public addClient(res: Response): void {
    this.clients.push(res);
    res.on('close', () => {
      this.clients = this.clients.filter(c => c !== res);
    });
  }

  public broadcast(payload: NotificationPayload): void {
    const data = JSON.stringify(payload);
    this.clients.forEach(client => {
      client.write(`data: ${data}\n\n`);
    });
  }
}

export const notificationManager = new NotificationManager();
