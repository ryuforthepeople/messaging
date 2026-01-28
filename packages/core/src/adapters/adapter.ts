import type {
  MessagingCapabilities,
  Conversation,
  Message,
  TypingState,
  PresenceState,
  MessageQuota,
  SendMessageOptions,
  CreateConversationOptions,
  ListOptions,
  MessageListOptions,
  PaginatedResult,
  Unsubscribe,
} from '../types'

/**
 * MessagingAdapter - Interface that all messaging providers must implement
 */
export interface MessagingAdapter {
  /** Provider identifier */
  readonly provider: string

  /** Get adapter capabilities */
  getCapabilities(): MessagingCapabilities

  // ============================================================
  // Conversations
  // ============================================================

  /**
   * Create a new conversation
   * @param participants - User IDs to include
   * @param options - Additional options (name, type, metadata)
   */
  createConversation(
    participants: string[],
    options?: CreateConversationOptions
  ): Promise<Conversation>

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Promise<Conversation | null>

  /**
   * List conversations for a user
   * @param userId - The user whose conversations to list
   * @param options - Pagination options
   */
  listConversations(
    userId: string,
    options?: ListOptions
  ): Promise<PaginatedResult<Conversation>>

  /**
   * Update conversation properties
   */
  updateConversation(
    id: string,
    updates: Partial<Pick<Conversation, 'name' | 'metadata'>>
  ): Promise<Conversation>

  /**
   * Delete/leave a conversation
   */
  deleteConversation(id: string, userId: string): Promise<void>

  /**
   * Add participants to a group conversation
   */
  addParticipants(conversationId: string, userIds: string[]): Promise<Conversation>

  /**
   * Remove participants from a group conversation
   */
  removeParticipants(conversationId: string, userIds: string[]): Promise<Conversation>

  /**
   * Mute/unmute a conversation for a user
   */
  muteConversation(conversationId: string, userId: string, mute: boolean): Promise<void>

  // ============================================================
  // Messages
  // ============================================================

  /**
   * Send a message to a conversation
   * @param conversationId - Target conversation
   * @param senderId - Sender's user ID
   * @param message - Message content and options
   */
  sendMessage(
    conversationId: string,
    senderId: string,
    message: SendMessageOptions
  ): Promise<Message>

  /**
   * Get a message by ID
   */
  getMessage(id: string): Promise<Message | null>

  /**
   * List messages in a conversation
   * @param conversationId - The conversation
   * @param options - Pagination options (before/after cursor)
   */
  listMessages(
    conversationId: string,
    options?: MessageListOptions
  ): Promise<PaginatedResult<Message>>

  /**
   * Edit a message
   */
  editMessage(id: string, content: string): Promise<Message>

  /**
   * Delete (soft delete) a message
   */
  deleteMessage(id: string): Promise<void>

  // ============================================================
  // Reactions
  // ============================================================

  /**
   * Add a reaction to a message
   */
  addReaction(messageId: string, userId: string, emoji: string): Promise<void>

  /**
   * Remove a reaction from a message
   */
  removeReaction(messageId: string, userId: string, emoji: string): Promise<void>

  // ============================================================
  // Read Status
  // ============================================================

  /**
   * Mark a conversation as read up to a specific message
   */
  markAsRead(conversationId: string, userId: string, messageId?: string): Promise<void>

  /**
   * Get total unread count across all conversations
   */
  getUnreadCount(userId: string): Promise<number>

  // ============================================================
  // Rate Limiting
  // ============================================================

  /**
   * Get message quota for a user
   */
  getQuota(userId: string): Promise<MessageQuota>

  // ============================================================
  // Realtime
  // ============================================================

  /**
   * Subscribe to new messages in a conversation
   */
  onNewMessage(
    conversationId: string,
    callback: (message: Message) => void
  ): Unsubscribe

  /**
   * Subscribe to typing indicators
   */
  onTyping(
    conversationId: string,
    callback: (state: TypingState) => void
  ): Unsubscribe

  /**
   * Subscribe to presence changes
   */
  onPresence(
    userIds: string[],
    callback: (state: PresenceState) => void
  ): Unsubscribe

  /**
   * Subscribe to conversation list updates
   */
  onConversationUpdate(
    userId: string,
    callback: (conversation: Conversation) => void
  ): Unsubscribe

  /**
   * Set typing status
   */
  setTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void>

  /**
   * Set presence status
   */
  setPresence(userId: string, status: PresenceState['status']): Promise<void>

  // ============================================================
  // E2E Encryption (optional)
  // ============================================================

  /**
   * Store a user's public key
   */
  storePublicKey?(userId: string, publicKey: string): Promise<void>

  /**
   * Get a user's public key
   */
  getPublicKey?(userId: string): Promise<string | null>

  /**
   * Store encrypted private key backup
   */
  storeKeyBackup?(userId: string, encryptedPrivateKey: string): Promise<void>

  /**
   * Get encrypted private key backup
   */
  getKeyBackup?(userId: string): Promise<{ encryptedKey: string | null; rateLimited: boolean }>

  /**
   * Record a PIN attempt (for rate limiting)
   */
  recordPinAttempt?(userId: string, success: boolean): Promise<void>
}
