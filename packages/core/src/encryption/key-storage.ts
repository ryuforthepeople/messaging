import { bytesToBase64, base64ToBytes } from './e2e'

/**
 * StoredKeyPair - Key pair stored in IndexedDB
 */
export interface StoredKeyPair {
  publicKey: string  // Base64 encoded
  secretKey: string  // Base64 encoded
}

/**
 * KeyStorage - Interface for storing encryption keys
 */
export interface KeyStorage {
  /** Store a key pair for a user */
  storeKeyPair(userId: string, keys: StoredKeyPair): Promise<void>

  /** Load a key pair for a user */
  loadKeyPair(userId: string): Promise<StoredKeyPair | null>

  /** Delete key pair for a user */
  deleteKeyPair(userId: string): Promise<void>

  /** Check if storage is available */
  isAvailable(): boolean
}

/**
 * IndexedDBKeyStorage - Store encryption keys in browser IndexedDB
 *
 * Keys are stored per-user and never leave the device.
 * This is the most secure storage option for browser environments.
 */
export class IndexedDBKeyStorage implements KeyStorage {
  private readonly dbName: string
  private readonly storeName = 'keys'

  constructor(dbName = 'MessagingEncryption') {
    this.dbName = dbName
  }

  isAvailable(): boolean {
    if (typeof window === 'undefined') return false
    if (typeof indexedDB === 'undefined') return false
    return true
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (!this.isAvailable()) {
      throw new Error('IndexedDB not available')
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' })
        }
      }
    })
  }

  async storeKeyPair(userId: string, keys: StoredKeyPair): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('IndexedDB not available - cannot store encryption keys')
    }

    const db = await this.openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put({ id: userId, ...keys })

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async loadKeyPair(userId: string): Promise<StoredKeyPair | null> {
    if (!this.isAvailable()) {
      return null
    }

    try {
      const db = await this.openDatabase()
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly')
        const store = transaction.objectStore(this.storeName)
        const request = store.get(userId)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const result = request.result
          if (result) {
            resolve({
              publicKey: result.publicKey,
              secretKey: result.secretKey,
            })
          } else {
            resolve(null)
          }
        }
      })
    } catch {
      return null
    }
  }

  async deleteKeyPair(userId: string): Promise<void> {
    if (!this.isAvailable()) {
      return
    }

    const db = await this.openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.delete(userId)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }
}

/**
 * MemoryKeyStorage - In-memory key storage for testing
 */
export class MemoryKeyStorage implements KeyStorage {
  private keys: Map<string, StoredKeyPair> = new Map()

  isAvailable(): boolean {
    return true
  }

  async storeKeyPair(userId: string, keys: StoredKeyPair): Promise<void> {
    this.keys.set(userId, keys)
  }

  async loadKeyPair(userId: string): Promise<StoredKeyPair | null> {
    return this.keys.get(userId) || null
  }

  async deleteKeyPair(userId: string): Promise<void> {
    this.keys.delete(userId)
  }

  /** Clear all keys (for testing) */
  clear(): void {
    this.keys.clear()
  }
}

/**
 * Create IndexedDB key storage
 */
export function createIndexedDBKeyStorage(dbName?: string): KeyStorage {
  return new IndexedDBKeyStorage(dbName)
}

/**
 * Create in-memory key storage (for testing)
 */
export function createMemoryKeyStorage(): MemoryKeyStorage {
  return new MemoryKeyStorage()
}
