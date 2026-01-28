import type { MessagingAdapter } from './adapter'
import type {
  MessagingCapabilities,
  Conversation,
  Message,
  User,
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
 * MemoryMessagingAdapter - In-memory adapter for testing
 */
export class MemoryMessagingAdapter implements MessagingAdapter {
  readonly provider = 'memory'

  private conversations: Map<string, Conversation> = new Map()
  private messages: Map<string, Message[]> = new Map()
  private publicKeys: Map<string, string> = new Map()
  private keyBackups: Map<string, string> = new Map()
  private messageCallbacks: Map<string, Set<(message: Message) => void>> = new Map()
  private idCounter = 1

  getCapabilities(): MessagingCapabilities {
    return {
      provider: 'memory',
      version: '1.0.0',
      encryption: {
        e2eSupported: true,
        e2eRequired: false,
        atRestEncryption: false,
      },
      conversations: {
        maxParticipants: 100,
        groupChats: true,
        channels: false,
      },
      messages: {
        maxLength: 2000,
        editing: true,
        editWindow: 0,
        deletion: true,
        reactions: false,
        threads: false,
        media: false,
        voice: false,
      },
      realtime: {
        method: 'polling',
        typingIndicators: false,
        presence: false,
        readReceipts: true,
      },
      rateLimit: {
        messagesPerWindow: 100,
        windowSeconds: 3600,
      },
    }
  }

  private generateId(): string {
    return `${this.idCounter++}`
  }

  // ============================================================
  // Conversations
  // ============================================================

  async createConversation(
    participants: string[],
    options?: CreateConversationOptions
  ): Promise<Conversation> {
    const id = this.generateId()
    const now = new Date().toISOString()

    const conversation: Conversation = {
      id,
      type: options?.type ?? (participants.length > 2 ? 'group' : 'dm'),
      name: options?.name,
      participants: participants.map((p) => ({ id: p })),
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
      metadata: options?.metadata,
    }

    this.conversations.set(id, conversation)
    this.messages.set(id, [])

    return conversation
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null
  }

  async listConversations(
    userId: string,
    options?: ListOptions
  ): Promise<PaginatedResult<Conversation>> {
    const userConversations = Array.from(this.conversations.values())
      .filter((c) => c.participants.some((p) => p.id === userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 20

    const data = userConversations.slice(offset, offset + limit)

    return {
      data,
      hasMore: offset + limit < userConversations.length,
    }
  }

  async updateConversation(
    id: string,
    updates: Partial<Pick<Conversation, 'name' | 'metadata'>>
  ): Promise<Conversation> {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error('Conversation not found')

    Object.assign(conversation, updates, { updatedAt: new Date().toISOString() })
    return conversation
  }

  async deleteConversation(id: string, userId: string): Promise<void> {
    const conversation = this.conversations.get(id)
    if (!conversation) return

    conversation.participants = conversation.participants.filter((p) => p.id !== userId)

    if (conversation.participants.length === 0) {
      this.conversations.delete(id)
      this.messages.delete(id)
    }
  }

  async addParticipants(conversationId: string, userIds: string[]): Promise<Conversation> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) throw new Error('Conversation not found')

    for (const userId of userIds) {
      if (!conversation.participants.some((p) => p.id === userId)) {
        conversation.participants.push({ id: userId })
      }
    }

    conversation.updatedAt = new Date().toISOString()
    return conversation
  }

  async removeParticipants(conversationId: string, userIds: string[]): Promise<Conversation> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) throw new Error('Conversation not found')

    conversation.participants = conversation.participants.filter(
      (p) => !userIds.includes(p.id)
    )

    conversation.updatedAt = new Date().toISOString()
    return conversation
  }

  async muteConversation(conversationId: string, userId: string, mute: boolean): Promise<void> {
    // No-op for in-memory adapter
  }

  // ============================================================
  // Messages
  // ============================================================

  async sendMessage(
    conversationId: string,
    senderId: string,
    message: SendMessageOptions
  ): Promise<Message> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) throw new Error('Conversation not found')

    const id = this.generateId()
    const now = new Date().toISOString()

    const newMessage: Message = {
      id,
      conversationId,
      senderId,
      content: message.content,
      type: message.type ?? 'text',
      replyTo: message.replyTo,
      createdAt: now,
      metadata: message.metadata,
    }

    const messages = this.messages.get(conversationId) ?? []
    messages.push(newMessage)
    this.messages.set(conversationId, messages)

    conversation.lastMessage = newMessage
    conversation.updatedAt = now

    // Notify subscribers
    const callbacks = this.messageCallbacks.get(conversationId)
    if (callbacks) {
      for (const callback of callbacks) {
        callback(newMessage)
      }
    }

    return newMessage
  }

  async getMessage(id: string): Promise<Message | null> {
    for (const messages of this.messages.values()) {
      const message = messages.find((m) => m.id === id && !m.deletedAt)
      if (message) return message
    }
    return null
  }

  async listMessages(
    conversationId: string,
    options?: MessageListOptions
  ): Promise<PaginatedResult<Message>> {
    const allMessages = (this.messages.get(conversationId) ?? [])
      .filter((m) => !m.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    let filtered = allMessages

    if (options?.before) {
      filtered = filtered.filter((m) => m.createdAt < options.before!)
    }
    if (options?.after) {
      filtered = filtered.filter((m) => m.createdAt > options.after!)
    }

    const limit = options?.limit ?? 20
    const data = filtered.slice(0, limit)

    // Reverse to show oldest first
    data.reverse()

    return {
      data,
      hasMore: filtered.length > limit,
    }
  }

  async editMessage(id: string, content: string): Promise<Message> {
    const message = await this.getMessage(id)
    if (!message) throw new Error('Message not found')

    message.content = content
    message.editedAt = new Date().toISOString()

    return message
  }

  async deleteMessage(id: string): Promise<void> {
    for (const messages of this.messages.values()) {
      const message = messages.find((m) => m.id === id)
      if (message) {
        message.deletedAt = new Date().toISOString()
        return
      }
    }
  }

  // ============================================================
  // Reactions
  // ============================================================

  async addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const message = await this.getMessage(messageId)
    if (!message) throw new Error('Message not found')

    message.reactions = message.reactions ?? []
    message.reactions.push({
      emoji,
      userId,
      createdAt: new Date().toISOString(),
    })
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const message = await this.getMessage(messageId)
    if (!message) return

    message.reactions = (message.reactions ?? []).filter(
      (r) => !(r.emoji === emoji && r.userId === userId)
    )
  }

  // ============================================================
  // Read Status
  // ============================================================

  async markAsRead(conversationId: string, userId: string, messageId?: string): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (conversation) {
      conversation.unreadCount = 0
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    let total = 0
    for (const conversation of this.conversations.values()) {
      if (conversation.participants.some((p) => p.id === userId)) {
        total += conversation.unreadCount
      }
    }
    return total
  }

  // ============================================================
  // Rate Limiting
  // ============================================================

  async getQuota(userId: string): Promise<MessageQuota> {
    return {
      remaining: 100,
      limit: 100,
      resetsAt: null,
    }
  }

  // ============================================================
  // Realtime
  // ============================================================

  onNewMessage(conversationId: string, callback: (message: Message) => void): Unsubscribe {
    let callbacks = this.messageCallbacks.get(conversationId)
    if (!callbacks) {
      callbacks = new Set()
      this.messageCallbacks.set(conversationId, callbacks)
    }
    callbacks.add(callback)

    return () => {
      callbacks!.delete(callback)
    }
  }

  onTyping(conversationId: string, callback: (state: TypingState) => void): Unsubscribe {
    return () => {}
  }

  onPresence(userIds: string[], callback: (state: PresenceState) => void): Unsubscribe {
    return () => {}
  }

  onConversationUpdate(userId: string, callback: (conversation: Conversation) => void): Unsubscribe {
    return () => {}
  }

  async setTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    // No-op for in-memory adapter
  }

  async setPresence(userId: string, status: PresenceState['status']): Promise<void> {
    // No-op for in-memory adapter
  }

  // ============================================================
  // E2E Encryption Key Storage
  // ============================================================

  async storePublicKey(userId: string, publicKey: string): Promise<void> {
    this.publicKeys.set(userId, publicKey)
  }

  async getPublicKey(userId: string): Promise<string | null> {
    return this.publicKeys.get(userId) ?? null
  }

  async storeKeyBackup(userId: string, encryptedPrivateKey: string): Promise<void> {
    this.keyBackups.set(userId, encryptedPrivateKey)
  }

  async getKeyBackup(userId: string): Promise<{ encryptedKey: string | null; rateLimited: boolean }> {
    return {
      encryptedKey: this.keyBackups.get(userId) ?? null,
      rateLimited: false,
    }
  }

  async recordPinAttempt(userId: string, success: boolean): Promise<void> {
    // No-op for in-memory adapter
  }

  // ============================================================
  // Testing Utilities
  // ============================================================

  /** Clear all data (for testing) */
  clear(): void {
    this.conversations.clear()
    this.messages.clear()
    this.publicKeys.clear()
    this.keyBackups.clear()
    this.messageCallbacks.clear()
    this.idCounter = 1
  }
}

/**
 * Create an in-memory messaging adapter (for testing)
 */
export function createMemoryMessagingAdapter(): MemoryMessagingAdapter {
  return new MemoryMessagingAdapter()
}
