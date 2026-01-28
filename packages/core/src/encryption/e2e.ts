import nacl from 'tweetnacl'
import * as tweetnaclUtil from 'tweetnacl-util'
import type { E2EKeyPair, EncryptedContent, EncryptionStatus } from '../types'

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = tweetnaclUtil

/**
 * E2EEncryption - Interface for E2E encryption operations
 */
export interface E2EEncryption {
  /** Generate a new key pair */
  generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array }

  /** Encrypt a message for a recipient */
  encryptMessage(
    plaintext: string,
    recipientPublicKey: Uint8Array,
    senderSecretKey: Uint8Array
  ): string

  /** Decrypt a message from a sender */
  decryptMessage(
    ciphertext: string,
    senderPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array
  ): string | null

  /** Encrypt private key with PIN for backup */
  encryptPrivateKeyWithPin(secretKey: Uint8Array, pin: string): Promise<string>

  /** Decrypt private key backup with PIN */
  decryptPrivateKeyWithPin(encryptedBase64: string, pin: string): Promise<Uint8Array | null>
}

/**
 * TweetNaClEncryption - E2E encryption using TweetNaCl library
 *
 * Uses:
 * - X25519 for key exchange
 * - XSalsa20-Poly1305 for message encryption (nacl.box)
 * - PBKDF2 for PIN-based key derivation
 */
export class TweetNaClEncryption implements E2EEncryption {
  /**
   * Generate a new X25519 key pair
   */
  generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
    return nacl.box.keyPair()
  }

  /**
   * Encrypt a message for a recipient
   * Returns base64 encoded: nonce (24 bytes) + ciphertext
   */
  encryptMessage(
    plaintext: string,
    recipientPublicKey: Uint8Array,
    senderSecretKey: Uint8Array
  ): string {
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const messageUint8 = decodeUTF8(plaintext)

    const encrypted = nacl.box(
      messageUint8,
      nonce,
      recipientPublicKey,
      senderSecretKey
    )

    if (!encrypted) {
      throw new Error('Encryption failed')
    }

    // Combine nonce + ciphertext
    const fullMessage = new Uint8Array(nonce.length + encrypted.length)
    fullMessage.set(nonce)
    fullMessage.set(encrypted, nonce.length)

    return encodeBase64(fullMessage)
  }

  /**
   * Decrypt a message from a sender
   * Expects base64 encoded: nonce (24 bytes) + ciphertext
   */
  decryptMessage(
    ciphertextBase64: string,
    senderPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array
  ): string | null {
    try {
      const fullMessage = decodeBase64(ciphertextBase64)

      // Extract nonce and ciphertext
      const nonce = fullMessage.slice(0, nacl.box.nonceLength)
      const ciphertext = fullMessage.slice(nacl.box.nonceLength)

      const decrypted = nacl.box.open(
        ciphertext,
        nonce,
        senderPublicKey,
        recipientSecretKey
      )

      if (!decrypted) {
        return null
      }

      return encodeUTF8(decrypted)
    } catch {
      return null
    }
  }

  /**
   * Derive a 32-byte encryption key from a PIN using PBKDF2
   */
  private async deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
    const encoder = new TextEncoder()
    const pinData = encoder.encode(pin)

    // Import PIN as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      pinData,
      'PBKDF2',
      false,
      ['deriveBits']
    )

    // Derive 32 bytes using PBKDF2
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256 // 32 bytes
    )

    return new Uint8Array(derivedBits)
  }

  /**
   * Encrypt private key with PIN for server backup
   * Returns base64: salt (16) + nonce (24) + encrypted data
   */
  async encryptPrivateKeyWithPin(secretKey: Uint8Array, pin: string): Promise<string> {
    const salt = nacl.randomBytes(16)
    const derivedKey = await this.deriveKeyFromPin(pin, salt)

    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const encrypted = nacl.secretbox(secretKey, nonce, derivedKey)

    if (!encrypted) {
      throw new Error('Failed to encrypt private key')
    }

    // Combine: salt (16) + nonce (24) + encrypted data
    const combined = new Uint8Array(
      salt.length + nonce.length + encrypted.length
    )
    combined.set(salt, 0)
    combined.set(nonce, salt.length)
    combined.set(encrypted, salt.length + nonce.length)

    return encodeBase64(combined)
  }

  /**
   * Decrypt private key backup with PIN
   */
  async decryptPrivateKeyWithPin(
    encryptedBase64: string,
    pin: string
  ): Promise<Uint8Array | null> {
    try {
      const combined = decodeBase64(encryptedBase64)

      // Extract: salt (16) + nonce (24) + encrypted data
      const salt = combined.slice(0, 16)
      const nonce = combined.slice(16, 16 + nacl.secretbox.nonceLength)
      const encrypted = combined.slice(16 + nacl.secretbox.nonceLength)

      const derivedKey = await this.deriveKeyFromPin(pin, salt)
      const decrypted = nacl.secretbox.open(encrypted, nonce, derivedKey)

      return decrypted
    } catch {
      return null
    }
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Encode bytes to base64
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes)
}

/**
 * Decode base64 to bytes
 */
export function base64ToBytes(base64: string): Uint8Array {
  return decodeBase64(base64)
}

/**
 * Derive public key from private key
 */
export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  const keyPair = nacl.box.keyPair.fromSecretKey(privateKey)
  return keyPair.publicKey
}

/**
 * Create encrypted content for a conversation message
 * Encrypts for both sender and recipient so both can decrypt
 */
export function createEncryptedContent(
  encryption: E2EEncryption,
  plaintext: string,
  senderSecretKey: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
  recipientId: string
): EncryptedContent {
  // Encrypt for recipient
  const forRecipient = encryption.encryptMessage(
    plaintext,
    recipientPublicKey,
    senderSecretKey
  )

  // Encrypt for sender (so they can read their own sent messages)
  const forSender = encryption.encryptMessage(
    plaintext,
    senderPublicKey,
    senderSecretKey
  )

  return {
    s: forSender,
    r: forRecipient,
    recipientId,
  }
}

/**
 * Parse encrypted content from stored message
 */
export function parseEncryptedContent(content: string): EncryptedContent | null {
  try {
    const parsed = JSON.parse(content)
    if (parsed.s && parsed.r) {
      return parsed as EncryptedContent
    }
    return null
  } catch {
    return null
  }
}

/**
 * Decrypt message content
 * @param encryption - E2E encryption instance
 * @param content - Encrypted content string (JSON with s and r)
 * @param senderId - Sender's user ID
 * @param currentUserId - Current user's ID
 * @param senderPublicKey - Sender's public key
 * @param currentUserSecretKey - Current user's secret key
 */
export function decryptMessageContent(
  encryption: E2EEncryption,
  content: string,
  senderId: string,
  currentUserId: string,
  senderPublicKey: Uint8Array,
  currentUserSecretKey: Uint8Array
): string | null {
  const encrypted = parseEncryptedContent(content)

  if (encrypted) {
    // New format: dual-encrypted
    const isSender = senderId === currentUserId
    const ciphertext = isSender ? encrypted.s : encrypted.r

    return encryption.decryptMessage(
      ciphertext,
      senderPublicKey,
      currentUserSecretKey
    )
  }

  // Legacy format: single encryption for recipient only
  return encryption.decryptMessage(
    content,
    senderPublicKey,
    currentUserSecretKey
  )
}

/**
 * Create a new TweetNaCl encryption instance
 */
export function createE2EEncryption(): E2EEncryption {
  return new TweetNaClEncryption()
}
