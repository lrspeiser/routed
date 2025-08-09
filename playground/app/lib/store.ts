// Ephemeral in-memory store for channel mappings: channelId -> signed code
// Note: For production, move to a durable store.

export const channelIdToCode = new Map<string, string>();
