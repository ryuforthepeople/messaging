export * from './capabilities'

/**
 * User - Minimal user representation for messaging
 */
export interface User {
  id: string
  name?: string
  avatar?: string
}

/**
 * Conversation - A messaging thread between participants
 */
export interface Conversation {
  id: string
  type: 'dm' | 'group' | 'channel'
  name?: string
  participants: User[]
  createdAt: string
  updatedAt: string
  lastMessage?: Message
  unreadCount: number
  metadata?: Record<string, unknown>
}

/**
 * Message - A single message in a conversation
 */
export interface Message {
  id: string
  conversationId: string
  senderId: string
  /** Plain text content (after decryption if E2E) */
  content: string
  /** Encrypted content (if E2E enabled, stored in DB) */
  contentEncrypted?: string
  type: 'text' | 'image' | 'file' | 'voice' | 'system'
  /** Reply to another message */
  replyTo?: string
  reactions?: Reaction[]
  /** User IDs who have read this message */
  readBy?: string[]
  editedAt?: string
  deletedAt?: string
  createdAt: string
  metadata?: Record<string, unknown>
}

/**
 * Reaction - Emoji reaction on a message
 */
export interface Reaction {
  emoji: string
  userId: string
  createdAt: string
}

/**
 * TypingState - User typing indicator
 */
export interface TypingState {
  conversationId: string
  userId: string
  isTyping: boolean
}

/**
 * PresenceState - User online status
 */
export interface PresenceState {
  userId: string
  status: 'online' | 'away' | 'offline'
  lastSeen?: string
}

/**
 * MessageQuota - Rate limit status
 */
export interface MessageQuota {
  remaining: number
  limit: number
  resetsAt: string | null
}

// ============================================================
// E2E Encryption Types
// ============================================================

/**
 * E2EKeyPair - Asymmetric key pair for E2E encryption
 */
export interface E2EKeyPair {
  /** Base64 encoded public key */
  publicKey: string
  /** Base64 encoded private key (encrypted with user's password/PIN) */
  privateKey: string
}

/**
 * EncryptedMessage - Encrypted message payload
 */
export interface EncryptedMessage {
  /** Base64 encoded ciphertext */
  ciphertext: string
  /** Base64 encoded nonce */
  nonce: string
  /** Base64 encoded sender's public key */
  senderPublicKey: string
}

/**
 * EncryptedContent - Dual-encrypted message for storage
 * Both sender and recipient can decrypt their own copy
 */
export interface EncryptedContent {
  /** Ciphertext encrypted for sender (they can read their sent messages) */
  s: string
  /** Ciphertext encrypted for recipient */
  r: string
  /** Recipient's user ID */
  recipientId: string
}

/**
 * EncryptionStatus - Current state of encryption setup
 */
export type EncryptionStatus =
  | 'ready'             // Keys loaded and ready
  | 'needs_setup'       // No keys exist, need to create
  | 'needs_pin_setup'   // Keys exist locally but no backup
  | 'has_backup'        // Backup exists on server, can restore with PIN
  | 'needs_regeneration' // Keys exist on server but no backup
  | 'error'             // Error state

// ============================================================
// Adapter Types
// ============================================================

/**
 * SendMessageOptions - Options for sending a message
 */
export interface SendMessageOptions {
  content: string
  type?: Message['type']
  replyTo?: string
  metadata?: Record<string, unknown>
}

/**
 * CreateConversationOptions - Options for creating a conversation
 */
export interface CreateConversationOptions {
  name?: string
  type?: 'dm' | 'group'
  metadata?: Record<string, unknown>
}

/**
 * ListOptions - Pagination options
 */
export interface ListOptions {
  limit?: number
  offset?: number
}

/**
 * MessageListOptions - Options for listing messages
 */
export interface MessageListOptions {
  limit?: number
  /** Fetch messages before this message ID or timestamp */
  before?: string
  /** Fetch messages after this message ID or timestamp */
  after?: string
}

/**
 * PaginatedResult - Paginated response
 */
export interface PaginatedResult<T> {
  data: T[]
  hasMore: boolean
}

/**
 * Unsubscribe - Function to unsubscribe from realtime events
 */
export type Unsubscribe = () => void
