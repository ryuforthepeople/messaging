# @for-the-people/messaging

Provider-agnostic messaging module with end-to-end encryption support.

## Features

- 🔐 **E2E Encryption** — TweetNaCl-based encryption (X25519 + XSalsa20-Poly1305)
- 💬 **1:1 DMs** — Direct messages between users
- 👥 **Group Chats** — Multi-participant conversations
- ⚡ **Realtime** — Supabase Realtime subscriptions
- 🔑 **PIN Backup** — Encrypted key backup with PIN protection
- 🔌 **Provider Agnostic** — Swap adapters without changing code

## Installation

```bash
pnpm add @for-the-people/messaging-core
```

## Quick Start

```typescript
import {
  createSupabaseMessagingAdapter,
  createMessagingService,
} from '@for-the-people/messaging-core'
import { createClient } from '@supabase/supabase-js'

// Create Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

// Create adapter
const adapter = createSupabaseMessagingAdapter({
  client: supabase,
})

// Create service
const messaging = createMessagingService({
  adapter,
  e2eEnabled: true,
})

// Set current user
messaging.setCurrentUser(userId)

// Initialize encryption
const status = await messaging.getEncryptionStatus()
if (status === 'needs_setup') {
  await messaging.setupEncryption('123456') // 6-digit PIN
} else if (status === 'has_backup') {
  await messaging.restoreEncryption('123456')
} else {
  await messaging.initializeEncryption()
}

// Send a message
const message = await messaging.sendMessage(conversationId, {
  content: 'Hello, world!',
})

// List messages
const { data: messages, hasMore } = await messaging.listMessages(conversationId)

// Subscribe to new messages
const unsubscribe = messaging.onNewMessage(conversationId, (message) => {
  console.log('New message:', message.content)
})
```

## Adapters

### Supabase Adapter

Uses Supabase Realtime for live updates and PostgreSQL for storage.

```typescript
import { createSupabaseMessagingAdapter } from '@for-the-people/messaging-core'

const adapter = createSupabaseMessagingAdapter({
  client: supabaseClient,
  tables: {
    conversations: 'conversations',
    participants: 'conversation_participants',
    messages: 'messages',
    userKeys: 'user_keys',
    rateLimits: 'message_rate_limits',
  },
  rateLimit: {
    messagesPerWindow: 100,
    windowSeconds: 3600,
  },
})
```

### Memory Adapter (Testing)

In-memory adapter for unit tests.

```typescript
import { createMemoryMessagingAdapter } from '@for-the-people/messaging-core'

const adapter = createMemoryMessagingAdapter()

// Clear data between tests
adapter.clear()
```

## E2E Encryption

Messages are encrypted using TweetNaCl:

- **Key Exchange:** X25519 (Curve25519)
- **Encryption:** XSalsa20-Poly1305 (nacl.box)
- **Key Derivation:** PBKDF2 for PIN-based backup

### Encryption Flow

1. Each user generates an X25519 key pair
2. Public key is stored on server, private key in browser IndexedDB
3. Optional: PIN-encrypted backup on server for multi-device support
4. Messages are encrypted twice (for sender and recipient) so both can read

### Key Storage

Private keys are stored in browser IndexedDB and never leave the device.

```typescript
import { createIndexedDBKeyStorage } from '@for-the-people/messaging-core'

const keyStorage = createIndexedDBKeyStorage('MyAppEncryption')
```

## Database Schema

Required tables for Supabase adapter:

```sql
-- Conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Participants
CREATE TABLE conversation_participants (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  is_muted BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (conversation_id, user_id)
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- User encryption keys
CREATE TABLE user_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT,
  pin_attempts INTEGER DEFAULT 0,
  pin_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## API Reference

### MessagingService

| Method | Description |
|--------|-------------|
| `setCurrentUser(userId)` | Set the current user |
| `getEncryptionStatus()` | Get encryption setup status |
| `initializeEncryption()` | Load existing encryption keys |
| `setupEncryption(pin)` | Set up new encryption with PIN backup |
| `restoreEncryption(pin)` | Restore encryption from server backup |
| `createConversation(participants, options?)` | Create a new conversation |
| `getConversation(id)` | Get a conversation by ID |
| `listConversations(options?)` | List user's conversations |
| `deleteConversation(id)` | Leave a conversation |
| `sendMessage(conversationId, message)` | Send a message |
| `listMessages(conversationId, options?)` | List messages |
| `deleteMessage(id)` | Soft delete a message |
| `markAsRead(conversationId)` | Mark conversation as read |
| `onNewMessage(conversationId, callback)` | Subscribe to new messages |
| `onTyping(conversationId, callback)` | Subscribe to typing indicators |
| `setTyping(conversationId, isTyping)` | Set typing status |

### Encryption Status

| Status | Description |
|--------|-------------|
| `ready` | Encryption initialized and ready |
| `needs_setup` | No keys exist, need to create |
| `needs_pin_setup` | Keys exist locally but no backup |
| `has_backup` | Backup exists, can restore with PIN |
| `needs_regeneration` | Keys lost, need to regenerate |
| `error` | Error state |

## License

MIT
