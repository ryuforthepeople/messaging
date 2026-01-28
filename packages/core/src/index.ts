// Types
export * from './types'

// Adapters
export type { MessagingAdapter } from './adapters/adapter'
export { createSupabaseMessagingAdapter, SupabaseMessagingAdapter } from './adapters/supabase'
export type { SupabaseMessagingAdapterOptions } from './adapters/supabase'
export { createMemoryMessagingAdapter, MemoryMessagingAdapter } from './adapters/memory'

// Encryption
export {
  type E2EEncryption,
  TweetNaClEncryption,
  createE2EEncryption,
  bytesToBase64,
  base64ToBytes,
  publicKeyFromPrivate,
  createEncryptedContent,
  parseEncryptedContent,
  decryptMessageContent,
} from './encryption/e2e'

export {
  type KeyStorage,
  type StoredKeyPair,
  IndexedDBKeyStorage,
  MemoryKeyStorage,
  createIndexedDBKeyStorage,
  createMemoryKeyStorage,
} from './encryption/key-storage'

// Services
export {
  MessagingService,
  createMessagingService,
} from './services/messaging'
export type { MessagingServiceOptions } from './services/messaging'
