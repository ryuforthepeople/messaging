import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
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
 * SupabaseMessagingAdapterOptions
 */
export interface SupabaseMessagingAdapterOptions {
  /** Supabase client instance */
  client: SupabaseClient

  /** Table names (for customization) */
  tables?: {
    conversations?: string
    participants?: string
    messages?: string
    userKeys?: string
    rateLimits?: string
  }

  /** Rate limit configuration */
  rateLimit?: {
    messagesPerWindow?: number
    windowSeconds?: number
  }
}

/**
 * SupabaseMessagingAdapter - Messaging adapter using Supabase Realtime
 */
export class SupabaseMessagingAdapter implements MessagingAdapter {
  readonly provider = 'supabase'

  private client: SupabaseClient
  private tables: Required<NonNullable<SupabaseMessagingAdapterOptions['tables']>>
  private rateLimit: Required<NonNullable<SupabaseMessagingAdapterOptions['rateLimit']>>
  private channels: Map<string, RealtimeChannel> = new Map()

  constructor(options: SupabaseMessagingAdapterOptions) {
    this.client = options.client
    this.tables = {
      conversations: options.tables?.conversations ?? 'conversations',
      participants: options.tables?.participants ?? 'conversation_participants',
      messages: options.tables?.messages ?? 'messages',
      userKeys: options.tables?.userKeys ?? 'user_keys',
      rateLimits: options.tables?.rateLimits ?? 'message_rate_limits',
    }
    this.rateLimit = {
      messagesPerWindow: options.rateLimit?.messagesPerWindow ?? 100,
      windowSeconds: options.rateLimit?.windowSeconds ?? 3600,
    }
  }

  getCapabilities(): MessagingCapabilities {
    return {
      provider: 'supabase',
      version: '1.0.0',
      encryption: {
        e2eSupported: true,
        e2eRequired: false,
        atRestEncryption: false, // Depends on Supabase setup
      },
      conversations: {
        maxParticipants: 100,
        groupChats: true,
        channels: false,
      },
      messages: {
        maxLength: 2000,
        editing: false,
        editWindow: 0,
        deletion: true,
        reactions: false, // Not implemented yet
        threads: false,
        media: false, // Requires storage integration
        voice: false,
      },
      realtime: {
        method: 'websocket',
        typingIndicators: false, // Can be added via presence
        presence: true,
        readReceipts: true,
      },
      rateLimit: {
        messagesPerWindow: this.rateLimit.messagesPerWindow,
        windowSeconds: this.rateLimit.windowSeconds,
      },
    }
  }

  // ============================================================
  // Conversations
  // ============================================================

  async createConversation(
    participants: string[],
    options?: CreateConversationOptions
  ): Promise<Conversation> {
    // Create conversation
    const { data: conversation, error: convError } = await this.client
      .from(this.tables.conversations)
      .insert({})
      .select()
      .single()

    if (convError) throw convError

    // Add participants
    const participantRows = participants.map((userId) => ({
      conversation_id: conversation.id,
      user_id: userId,
    }))

    const { error: partError } = await this.client
      .from(this.tables.participants)
      .insert(participantRows)

    if (partError) throw partError

    return this.getConversation(conversation.id) as Promise<Conversation>
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const { data, error } = await this.client
      .from(this.tables.conversations)
      .select('id, created_at, updated_at')
      .eq('id', id)
      .single()

    if (error || !data) return null

    // Get participants
    const { data: participantsData } = await this.client
      .from(this.tables.participants)
      .select('user_id')
      .eq('conversation_id', id)

    // Get last message
    const { data: lastMessage } = await this.client
      .from(this.tables.messages)
      .select('id, content, sender_id, created_at')
      .eq('conversation_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const participants: User[] = (participantsData ?? []).map(
      (p) => ({ id: p.user_id })
    )

    const convData = data as { id: string; created_at: string; updated_at: string }

    return {
      id: convData.id,
      type: participants.length > 2 ? 'group' : 'dm',
      participants,
      createdAt: convData.created_at,
      updatedAt: convData.updated_at,
      lastMessage: lastMessage ? {
        id: lastMessage.id,
        conversationId: id,
        senderId: lastMessage.sender_id,
        content: lastMessage.content,
        type: 'text',
        createdAt: lastMessage.created_at,
      } : undefined,
      unreadCount: 0, // Will be calculated separately
    }
  }

  async listConversations(
    userId: string,
    options?: ListOptions
  ): Promise<PaginatedResult<Conversation>> {
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0

    // Get conversation IDs the user is part of
    const { data: participantData, error: partError } = await this.client
      .from(this.tables.participants)
      .select('conversation_id')
      .eq('user_id', userId)

    if (partError) throw partError

    const conversationIds = participantData?.map((p) => p.conversation_id) ?? []

    if (conversationIds.length === 0) {
      return { data: [], hasMore: false }
    }

    // Fetch conversations
    const { data, error } = await this.client
      .from(this.tables.conversations)
      .select('id, created_at, updated_at')
      .in('id', conversationIds)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit)

    if (error) throw error

    const conversations: Conversation[] = await Promise.all(
      (data ?? []).map(async (conv: { id: string; created_at: string; updated_at: string }) => {
        // Get participants
        const { data: participantsData } = await this.client
          .from(this.tables.participants)
          .select('user_id')
          .eq('conversation_id', conv.id)

        // Get last message
        const { data: lastMessage } = await this.client
          .from(this.tables.messages)
          .select('id, content, sender_id, created_at')
          .eq('conversation_id', conv.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Get unread count
        const { data: unreadData } = await this.client.rpc('get_unread_count', {
          p_conversation_id: conv.id,
          p_user_id: userId,
        })

        const participants: User[] = (participantsData ?? []).map(
          (p) => ({ id: p.user_id })
        )

        return {
          id: conv.id,
          type: participants.length > 2 ? 'group' : 'dm',
          participants,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
          lastMessage: lastMessage ? {
            id: lastMessage.id,
            conversationId: conv.id,
            senderId: lastMessage.sender_id,
            content: lastMessage.content,
            type: 'text' as const,
            createdAt: lastMessage.created_at,
          } : undefined,
          unreadCount: (unreadData as number | null) ?? 0,
        }
      })
    )

    return {
      data: conversations,
      hasMore: data?.length === limit + 1,
    }
  }

  async updateConversation(
    id: string,
    updates: Partial<Pick<Conversation, 'name' | 'metadata'>>
  ): Promise<Conversation> {
    // Note: Basic conversations table doesn't have name/metadata
    // This would require schema extension
    const conversation = await this.getConversation(id)
    if (!conversation) throw new Error('Conversation not found')
    return conversation
  }

  async deleteConversation(id: string, userId: string): Promise<void> {
    const { error } = await this.client
      .from(this.tables.participants)
      .delete()
      .eq('conversation_id', id)
      .eq('user_id', userId)

    if (error) throw error
  }

  async addParticipants(conversationId: string, userIds: string[]): Promise<Conversation> {
    const rows = userIds.map((userId) => ({
      conversation_id: conversationId,
      user_id: userId,
    }))

    const { error } = await this.client
      .from(this.tables.participants)
      .insert(rows)

    if (error) throw error

    return this.getConversation(conversationId) as Promise<Conversation>
  }

  async removeParticipants(conversationId: string, userIds: string[]): Promise<Conversation> {
    const { error } = await this.client
      .from(this.tables.participants)
      .delete()
      .eq('conversation_id', conversationId)
      .in('user_id', userIds)

    if (error) throw error

    return this.getConversation(conversationId) as Promise<Conversation>
  }

  async muteConversation(conversationId: string, userId: string, mute: boolean): Promise<void> {
    const { error } = await this.client
      .from(this.tables.participants)
      .update({ is_muted: mute })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)

    if (error) throw error
  }

  // ============================================================
  // Messages
  // ============================================================

  async sendMessage(
    conversationId: string,
    senderId: string,
    message: SendMessageOptions
  ): Promise<Message> {
    const { data, error } = await this.client
      .from(this.tables.messages)
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content: message.content,
      })
      .select()
      .single()

    if (error) {
      if (error.message?.includes('Rate limit exceeded')) {
        throw new Error('Rate limit exceeded. Please wait before sending more messages.')
      }
      throw error
    }

    // Update conversation timestamp
    await this.client
      .from(this.tables.conversations)
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    return {
      id: data.id,
      conversationId: data.conversation_id,
      senderId: data.sender_id,
      content: data.content,
      type: message.type ?? 'text',
      replyTo: message.replyTo,
      createdAt: data.created_at,
      metadata: message.metadata,
    }
  }

  async getMessage(id: string): Promise<Message | null> {
    const { data, error } = await this.client
      .from(this.tables.messages)
      .select()
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (error || !data) return null

    return {
      id: data.id,
      conversationId: data.conversation_id,
      senderId: data.sender_id,
      content: data.content,
      type: 'text',
      editedAt: data.edited_at,
      deletedAt: data.deleted_at,
      createdAt: data.created_at,
    }
  }

  async listMessages(
    conversationId: string,
    options?: MessageListOptions
  ): Promise<PaginatedResult<Message>> {
    const limit = options?.limit ?? 20

    let query = this.client
      .from(this.tables.messages)
      .select()
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (options?.before) {
      query = query.lt('created_at', options.before)
    }
    if (options?.after) {
      query = query.gt('created_at', options.after)
    }

    const { data, error } = await query

    if (error) throw error

    const messages: Message[] = (data ?? []).slice(0, limit).map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      content: m.content,
      type: 'text',
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      createdAt: m.created_at,
    }))

    // Reverse to show oldest first
    messages.reverse()

    return {
      data: messages,
      hasMore: (data?.length ?? 0) > limit,
    }
  }

  async editMessage(id: string, content: string): Promise<Message> {
    const { data, error } = await this.client
      .from(this.tables.messages)
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return {
      id: data.id,
      conversationId: data.conversation_id,
      senderId: data.sender_id,
      content: data.content,
      type: 'text',
      editedAt: data.edited_at,
      createdAt: data.created_at,
    }
  }

  async deleteMessage(id: string): Promise<void> {
    // Try RPC function first (for RLS compatibility)
    const { error: rpcError } = await this.client.rpc('soft_delete_message', {
      p_message_id: id,
    })

    if (rpcError) {
      // Fallback to direct update
      const { error } = await this.client
        .from(this.tables.messages)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    }
  }

  // ============================================================
  // Reactions (not implemented)
  // ============================================================

  async addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    throw new Error('Reactions not implemented')
  }

  async removeReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    throw new Error('Reactions not implemented')
  }

  // ============================================================
  // Read Status
  // ============================================================

  async markAsRead(conversationId: string, userId: string, messageId?: string): Promise<void> {
    const { error } = await this.client.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
      p_user_id: userId,
    })

    if (error) throw error
  }

  async getUnreadCount(userId: string): Promise<number> {
    // Get all conversations and sum unread
    const result = await this.listConversations(userId, { limit: 100 })
    return result.data.reduce((sum: number, c: Conversation) => sum + c.unreadCount, 0)
  }

  // ============================================================
  // Rate Limiting
  // ============================================================

  async getQuota(userId: string): Promise<MessageQuota> {
    const { data, error } = await this.client.rpc('get_message_quota', {
      p_user_id: userId,
    })

    if (error) throw error

    return {
      remaining: data?.remaining ?? this.rateLimit.messagesPerWindow,
      limit: data?.limit ?? this.rateLimit.messagesPerWindow,
      resetsAt: data?.resets_at ?? null,
    }
  }

  // ============================================================
  // Realtime
  // ============================================================

  onNewMessage(conversationId: string, callback: (message: Message) => void): Unsubscribe {
    const channelKey = `messages:${conversationId}`

    const channel = this.client
      .channel(channelKey)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: this.tables.messages,
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as any
          callback({
            id: m.id,
            conversationId: m.conversation_id,
            senderId: m.sender_id,
            content: m.content,
            type: 'text',
            createdAt: m.created_at,
          })
        }
      )
      .subscribe()

    this.channels.set(channelKey, channel)

    return () => {
      this.client.removeChannel(channel)
      this.channels.delete(channelKey)
    }
  }

  onTyping(conversationId: string, callback: (state: TypingState) => void): Unsubscribe {
    // Typing indicators via presence
    const channelKey = `typing:${conversationId}`

    const channel = this.client.channel(channelKey, {
      config: { presence: { key: 'typing' } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        // Process presence state for typing indicators
      })
      .subscribe()

    this.channels.set(channelKey, channel)

    return () => {
      this.client.removeChannel(channel)
      this.channels.delete(channelKey)
    }
  }

  onPresence(userIds: string[], callback: (state: PresenceState) => void): Unsubscribe {
    const channelKey = 'presence:global'

    const channel = this.client.channel(channelKey, {
      config: { presence: { key: 'users' } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        // Process presence for online status
      })
      .subscribe()

    this.channels.set(channelKey, channel)

    return () => {
      this.client.removeChannel(channel)
      this.channels.delete(channelKey)
    }
  }

  onConversationUpdate(userId: string, callback: (conversation: Conversation) => void): Unsubscribe {
    const channelKey = `conversations:${userId}`

    const channel = this.client
      .channel(channelKey)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: this.tables.messages,
        },
        async () => {
          // Refresh conversation on new message
          // This is a simplified approach; production would be more targeted
        }
      )
      .subscribe()

    this.channels.set(channelKey, channel)

    return () => {
      this.client.removeChannel(channel)
      this.channels.delete(channelKey)
    }
  }

  async setTyping(conversationId: string, userId: string, isTyping: boolean): Promise<void> {
    const channelKey = `typing:${conversationId}`
    let channel = this.channels.get(channelKey)

    if (!channel) {
      channel = this.client.channel(channelKey, {
        config: { presence: { key: 'typing' } },
      })
      await channel.subscribe()
      this.channels.set(channelKey, channel)
    }

    if (isTyping) {
      await channel.track({ userId })
    } else {
      await channel.untrack()
    }
  }

  async setPresence(userId: string, status: PresenceState['status']): Promise<void> {
    const channelKey = 'presence:global'
    let channel = this.channels.get(channelKey)

    if (!channel) {
      channel = this.client.channel(channelKey, {
        config: { presence: { key: 'users' } },
      })
      await channel.subscribe()
      this.channels.set(channelKey, channel)
    }

    if (status === 'offline') {
      await channel.untrack()
    } else {
      await channel.track({ userId, status })
    }
  }

  // ============================================================
  // E2E Encryption Key Storage
  // ============================================================

  async storePublicKey(userId: string, publicKey: string): Promise<void> {
    const { error } = await this.client
      .from(this.tables.userKeys)
      .upsert({
        user_id: userId,
        public_key: publicKey,
      }, { onConflict: 'user_id' })

    if (error) throw error
  }

  async getPublicKey(userId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from(this.tables.userKeys)
      .select('public_key')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error
    return data?.public_key ?? null
  }

  async storeKeyBackup(userId: string, encryptedPrivateKey: string): Promise<void> {
    const { error } = await this.client.rpc('save_key_backup', {
      p_user_id: userId,
      p_encrypted_key: encryptedPrivateKey,
    })

    if (error) throw error
  }

  async getKeyBackup(userId: string): Promise<{ encryptedKey: string | null; rateLimited: boolean }> {
    const { data, error } = await this.client.rpc('get_key_backup', {
      p_user_id: userId,
    })

    if (error) throw error

    if (data && Array.isArray(data) && data.length > 0) {
      return {
        encryptedKey: data[0].encrypted_key ?? null,
        rateLimited: data[0].rate_limited ?? false,
      }
    }

    return { encryptedKey: null, rateLimited: false }
  }

  async recordPinAttempt(userId: string, success: boolean): Promise<void> {
    const { error } = await this.client.rpc('record_pin_attempt', {
      p_user_id: userId,
      p_success: success,
    })

    if (error) throw error
  }
}

/**
 * Create a Supabase messaging adapter
 */
export function createSupabaseMessagingAdapter(
  options: SupabaseMessagingAdapterOptions
): MessagingAdapter {
  return new SupabaseMessagingAdapter(options)
}
