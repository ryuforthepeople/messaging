import type { MessagingAdapter } from '../adapters/adapter'
import type {
  Conversation,
  Message,
  TypingState,
  PresenceState,
  MessageQuota,
  MessagingCapabilities,
  SendMessageOptions,
  CreateConversationOptions,
  ListOptions,
  MessageListOptions,
  PaginatedResult,
  Unsubscribe,
  EncryptionStatus,
  EncryptedContent,
} from '../types'
import {
  type E2EEncryption,
  createE2EEncryption,
  createEncryptedContent,
  decryptMessageContent,
  bytesToBase64,
  base64ToBytes,
  publicKeyFromPrivate,
} from '../encryption/e2e'
import {
  type KeyStorage,
  createIndexedDBKeyStorage,
} from '../encryption/key-storage'

/**
 * MessagingServiceOptions
 */
export interface MessagingServiceOptions {
  /** Messaging adapter */
  adapter: MessagingAdapter

  /** Key storage for E2E encryption (defaults to IndexedDB) */
  keyStorage?: KeyStorage

  /** E2E encryption implementation (defaults to TweetNaCl) */
  encryption?: E2EEncryption

  /** Enable E2E encryption */
  e2eEnabled?: boolean
}

/**
 * MessagingService - High-level messaging operations with E2E encryption
 */
export class MessagingService {
  private adapter: MessagingAdapter
  private keyStorage: KeyStorage
  private encryption: E2EEncryption
  private e2eEnabled: boolean

  // Current user state
  private currentUserId: string | null = null
  private keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null
  private publicKeyCache: Map<string, Uint8Array> = new Map()

  constructor(options: MessagingServiceOptions) {
    this.adapter = options.adapter
    this.keyStorage = options.keyStorage ?? createIndexedDBKeyStorage()
    this.encryption = options.encryption ?? createE2EEncryption()
    this.e2eEnabled = options.e2eEnabled ?? true
  }

  /** Get adapter capabilities */
  getCapabilities(): MessagingCapabilities {
    return this.adapter.getCapabilities()
  }

  // ============================================================
  // User & Encryption Setup
  // ============================================================

  /**
   * Set the current user ID
   */
  setCurrentUser(userId: string): void {
    if (this.currentUserId !== userId) {
      this.currentUserId = userId
      this.keyPair = null
      this.publicKeyCache.clear()
    }
  }

  /**
   * Get current encryption status
   */
  async getEncryptionStatus(): Promise<EncryptionStatus> {
    if (!this.e2eEnabled) return 'ready'
    if (!this.currentUserId) return 'error'

    // Check if we have local keys
    const localKeys = await this.keyStorage.loadKeyPair(this.currentUserId)
    if (localKeys) {
      // Check if backup exists
      if (this.adapter.getKeyBackup) {
        const { encryptedKey } = await this.adapter.getKeyBackup(this.currentUserId)
        return encryptedKey ? 'ready' : 'needs_pin_setup'
      }
      return 'ready'
    }

    // No local keys - check server
    if (this.adapter.getKeyBackup) {
      const { encryptedKey } = await this.adapter.getKeyBackup(this.currentUserId)
      if (encryptedKey) {
        return 'has_backup'
      }
    }

    // Check if public key exists on server
    if (this.adapter.getPublicKey) {
      const publicKey = await this.adapter.getPublicKey(this.currentUserId)
      if (publicKey) {
        return 'needs_regeneration'
      }
    }

    return 'needs_setup'
  }

  /**
   * Initialize encryption - load existing keys or determine what's needed
   */
  async initializeEncryption(): Promise<boolean> {
    if (!this.e2eEnabled) return true
    if (!this.currentUserId) return false

    // Try to load from local storage
    const localKeys = await this.keyStorage.loadKeyPair(this.currentUserId)
    if (localKeys) {
      this.keyPair = {
        publicKey: base64ToBytes(localKeys.publicKey),
        secretKey: base64ToBytes(localKeys.secretKey),
      }
      return true
    }

    return false
  }

  /**
   * Set up encryption with a new key pair and PIN backup
   */
  async setupEncryption(pin: string): Promise<boolean> {
    if (!this.currentUserId) return false

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
      throw new Error('PIN must be exactly 6 digits')
    }

    // Generate new keys
    const keyPair = this.encryption.generateKeyPair()
    const publicKeyBase64 = bytesToBase64(keyPair.publicKey)
    const secretKeyBase64 = bytesToBase64(keyPair.secretKey)

    // Encrypt private key with PIN for backup
    const encryptedBackup = await this.encryption.encryptPrivateKeyWithPin(
      keyPair.secretKey,
      pin
    )

    // Store public key on server
    if (this.adapter.storePublicKey) {
      await this.adapter.storePublicKey(this.currentUserId, publicKeyBase64)
    }

    // Store encrypted backup on server
    if (this.adapter.storeKeyBackup) {
      await this.adapter.storeKeyBackup(this.currentUserId, encryptedBackup)
    }

    // Store locally
    await this.keyStorage.storeKeyPair(this.currentUserId, {
      publicKey: publicKeyBase64,
      secretKey: secretKeyBase64,
    })

    this.keyPair = keyPair
    return true
  }

  /**
   * Restore encryption from server backup using PIN
   */
  async restoreEncryption(pin: string): Promise<boolean> {
    if (!this.currentUserId) return false

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
      throw new Error('PIN must be exactly 6 digits')
    }

    // Get backup from server
    if (!this.adapter.getKeyBackup) {
      throw new Error('Key backup not supported by adapter')
    }

    const { encryptedKey, rateLimited } = await this.adapter.getKeyBackup(this.currentUserId)

    if (rateLimited) {
      throw new Error('Too many attempts. Please try again in 15 minutes.')
    }

    if (!encryptedKey) {
      throw new Error('No backup found on server')
    }

    // Decrypt with PIN
    const secretKey = await this.encryption.decryptPrivateKeyWithPin(encryptedKey, pin)

    if (!secretKey) {
      if (this.adapter.recordPinAttempt) {
        await this.adapter.recordPinAttempt(this.currentUserId, false)
      }
      throw new Error('Incorrect PIN')
    }

    // PIN was correct
    if (this.adapter.recordPinAttempt) {
      await this.adapter.recordPinAttempt(this.currentUserId, true)
    }

    // Derive public key
    const publicKey = publicKeyFromPrivate(secretKey)

    // Store locally
    await this.keyStorage.storeKeyPair(this.currentUserId, {
      publicKey: bytesToBase64(publicKey),
      secretKey: bytesToBase64(secretKey),
    })

    this.keyPair = { publicKey, secretKey }
    return true
  }

  /**
   * Check if encryption is ready
   */
  isEncryptionReady(): boolean {
    return !this.e2eEnabled || this.keyPair !== null
  }

  /**
   * Get public key for a user (with caching)
   */
  private async getPublicKey(userId: string): Promise<Uint8Array | null> {
    // Check cache
    const cached = this.publicKeyCache.get(userId)
    if (cached) return cached

    // Fetch from server
    if (this.adapter.getPublicKey) {
      const publicKey = await this.adapter.getPublicKey(userId)
      if (publicKey) {
        const bytes = base64ToBytes(publicKey)
        this.publicKeyCache.set(userId, bytes)
        return bytes
      }
    }

    return null
  }

  // ============================================================
  // Conversations
  // ============================================================

  async createConversation(
    participants: string[],
    options?: CreateConversationOptions
  ): Promise<Conversation> {
    return this.adapter.createConversation(participants, options)
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.adapter.getConversation(id)
  }

  async listConversations(options?: ListOptions): Promise<PaginatedResult<Conversation>> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.listConversations(this.currentUserId, options)
  }

  async deleteConversation(id: string): Promise<void> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.deleteConversation(id, this.currentUserId)
  }

  async muteConversation(id: string, mute: boolean): Promise<void> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.muteConversation(id, this.currentUserId, mute)
  }

  // ============================================================
  // Messages
  // ============================================================

  /**
   * Send a message (with E2E encryption if enabled)
   */
  async sendMessage(conversationId: string, message: SendMessageOptions): Promise<Message> {
    if (!this.currentUserId) throw new Error('No user set')

    let content = message.content

    // Encrypt if E2E enabled
    if (this.e2eEnabled && this.keyPair) {
      const conversation = await this.getConversation(conversationId)
      if (!conversation) throw new Error('Conversation not found')

      // Get recipient (for DM) or all participants (for group)
      const otherParticipants = conversation.participants.filter(
        (p) => p.id !== this.currentUserId
      )

      if (otherParticipants.length === 1) {
        // DM - encrypt for single recipient
        const recipientId = otherParticipants[0].id
        const recipientPublicKey = await this.getPublicKey(recipientId)

        if (!recipientPublicKey) {
          throw new Error('Recipient has not set up encryption')
        }

        const encrypted = createEncryptedContent(
          this.encryption,
          message.content,
          this.keyPair.secretKey,
          this.keyPair.publicKey,
          recipientPublicKey,
          recipientId
        )

        content = JSON.stringify(encrypted)
      }
      // For group chats, we'd need to encrypt for each participant
      // This is a simplified implementation for 1:1 DMs
    }

    const sent = await this.adapter.sendMessage(conversationId, this.currentUserId, {
      ...message,
      content,
    })

    // Return with decrypted content for sender
    return {
      ...sent,
      content: message.content, // Original plaintext
      contentEncrypted: this.e2eEnabled ? content : undefined,
    }
  }

  /**
   * List messages (with decryption if E2E enabled)
   */
  async listMessages(
    conversationId: string,
    options?: MessageListOptions
  ): Promise<PaginatedResult<Message>> {
    const result = await this.adapter.listMessages(conversationId, options)

    if (!this.e2eEnabled || !this.keyPair) {
      return result
    }

    // Decrypt messages
    const decryptedMessages = await Promise.all(
      result.data.map(async (msg) => this.decryptMessage(msg))
    )

    return {
      data: decryptedMessages,
      hasMore: result.hasMore,
    }
  }

  /**
   * Decrypt a single message
   */
  private async decryptMessage(message: Message): Promise<Message> {
    if (!this.e2eEnabled || !this.keyPair || !this.currentUserId) {
      return message
    }

    try {
      const senderPublicKey = await this.getPublicKey(message.senderId)
      if (!senderPublicKey) {
        return {
          ...message,
          content: '[Unable to decrypt: sender key not found]',
        }
      }

      const decrypted = decryptMessageContent(
        this.encryption,
        message.content,
        message.senderId,
        this.currentUserId,
        senderPublicKey,
        this.keyPair.secretKey
      )

      if (decrypted) {
        return {
          ...message,
          content: decrypted,
          contentEncrypted: message.content,
        }
      }

      return {
        ...message,
        content: '[Unable to decrypt message]',
      }
    } catch {
      return {
        ...message,
        content: '[Decryption error]',
      }
    }
  }

  async deleteMessage(id: string): Promise<void> {
    return this.adapter.deleteMessage(id)
  }

  async markAsRead(conversationId: string): Promise<void> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.markAsRead(conversationId, this.currentUserId)
  }

  async getQuota(): Promise<MessageQuota> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.getQuota(this.currentUserId)
  }

  // ============================================================
  // Realtime
  // ============================================================

  /**
   * Subscribe to new messages (with decryption)
   */
  onNewMessage(
    conversationId: string,
    callback: (message: Message) => void
  ): Unsubscribe {
    return this.adapter.onNewMessage(conversationId, async (message) => {
      const decrypted = await this.decryptMessage(message)
      callback(decrypted)
    })
  }

  onTyping(
    conversationId: string,
    callback: (state: TypingState) => void
  ): Unsubscribe {
    return this.adapter.onTyping(conversationId, callback)
  }

  onPresence(
    userIds: string[],
    callback: (state: PresenceState) => void
  ): Unsubscribe {
    return this.adapter.onPresence(userIds, callback)
  }

  onConversationUpdate(callback: (conversation: Conversation) => void): Unsubscribe {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.onConversationUpdate(this.currentUserId, callback)
  }

  async setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.setTyping(conversationId, this.currentUserId, isTyping)
  }

  async setPresence(status: PresenceState['status']): Promise<void> {
    if (!this.currentUserId) throw new Error('No user set')
    return this.adapter.setPresence(this.currentUserId, status)
  }
}

/**
 * Create a messaging service
 */
export function createMessagingService(options: MessagingServiceOptions): MessagingService {
  return new MessagingService(options)
}
