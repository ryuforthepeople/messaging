/**
 * MessagingCapabilities - Describes what features a messaging adapter supports
 */
export interface MessagingCapabilities {
  /** Provider identifier */
  provider: string
  /** Version of the adapter */
  version: string

  encryption: {
    /** End-to-end encryption supported */
    e2eSupported: boolean
    /** E2E encryption required for all messages */
    e2eRequired: boolean
    /** Messages encrypted at rest in database */
    atRestEncryption: boolean
  }

  conversations: {
    /** Maximum participants in a conversation (0 = unlimited) */
    maxParticipants: number
    /** Group chats with 3+ participants */
    groupChats: boolean
    /** Public channels anyone can join */
    channels: boolean
  }

  messages: {
    /** Maximum message length in characters (0 = unlimited) */
    maxLength: number
    /** Message editing allowed */
    editing: boolean
    /** Edit window in seconds (0 = unlimited) */
    editWindow: number
    /** Message deletion allowed */
    deletion: boolean
    /** Emoji reactions */
    reactions: boolean
    /** Reply threads */
    threads: boolean
    /** Media attachments (images, files) */
    media: boolean
    /** Voice messages */
    voice: boolean
  }

  realtime: {
    /** Realtime method used */
    method: 'websocket' | 'sse' | 'polling'
    /** Typing indicators */
    typingIndicators: boolean
    /** Online/offline presence */
    presence: boolean
    /** Read receipts */
    readReceipts: boolean
  }

  rateLimit: {
    /** Messages per window */
    messagesPerWindow: number
    /** Window duration in seconds */
    windowSeconds: number
  }
}
