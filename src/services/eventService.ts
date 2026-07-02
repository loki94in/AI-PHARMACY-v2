import { EventEmitter } from 'events';

class EventService extends EventEmitter {
  constructor() {
    super();
    // Increase max listeners since many browser tabs could connect
    this.setMaxListeners(100);
  }

  /**
   * Broadcast an event to all connected SSE clients.
   * @param type The type of event (e.g., 'migration_update', 'catalog_job_update')
   * @param payload The data to send with the event
   */
  broadcast(type: string, payload: any) {
    this.emit('server_event', { type, payload });
  }
}

export const eventService = new EventService();
