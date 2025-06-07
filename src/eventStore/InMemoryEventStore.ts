import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types';
// Adjust the path below if StreamableHTTPServerTransport defines these types elsewhere
// or if they should also come from the SDK. For now, assume they are exported from the transport.
import { EventStore, EventId, StreamId } from '../transports/StreamableHTTPServerTransport.js';
import { randomUUID } from 'crypto';

interface StoredEvent {
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
  timestamp: number;
}

export class InMemoryEventStore implements EventStore {
  private events: StoredEvent[] = [];
  private readonly MAX_EVENTS = 1000; // Simple way to avoid memory leak
  private logger = console; // Replace with pino logger if available globally or passed in

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = randomUUID() as EventId; // Cast to EventId
    if (this.events.length >= this.MAX_EVENTS) {
      this.events.shift(); // Remove oldest event
    }
    this.events.push({ eventId, streamId, message, timestamp: Date.now() });
    this.logger.log(`InMemoryEventStore: Stored event ${eventId} for stream ${streamId}`);
    return eventId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    this.logger.log(`InMemoryEventStore: Attempting to replay events after ${lastEventId}`);
    const lastEventIndex = this.events.findIndex(e => e.eventId === lastEventId);

    if (lastEventIndex === -1) {
      this.logger.warn(`InMemoryEventStore: EventId ${lastEventId} not found for replay.`);
      throw new Error('EventId not found for replay');
    }

    const eventsToReplay = this.events.slice(lastEventIndex + 1);
    let streamId: StreamId | undefined;

    if (eventsToReplay.length > 0) {
        streamId = eventsToReplay[0].streamId; // Get streamId from the first event to replay
    } else if (this.events.length > 0) {
        // If no events to replay, but there was a lastEventId, use its streamId
        streamId = this.events[lastEventIndex]?.streamId;
    }


    if (!streamId) {
        this.logger.warn(`InMemoryEventStore: Could not determine streamId for replay after ${lastEventId}.`);
        throw new Error('Could not determine streamId for replay');
    }

    this.logger.log(`InMemoryEventStore: Replaying ${eventsToReplay.length} events for stream ${streamId}.`);

    for (const event of eventsToReplay) {
      // Basic check: only replay if streamId matches. A more robust system might handle multiple client streams.
      if (event.streamId !== streamId) {
          this.logger.warn(`InMemoryEventStore: Event ${event.eventId} has different streamId (${event.streamId}) than expected (${streamId}). Skipping.`);
          continue;
      }
      await send(event.eventId, event.message);
      this.logger.log(`InMemoryEventStore: Replayed event ${event.eventId}`);
    }

    return streamId;
  }
}
