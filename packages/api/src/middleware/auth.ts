import type { Context, Next } from 'hono'
import type { MessagingService } from '@for-the-people/messaging-core'

/**
 * Auth context added to requests
 */
export interface AuthContext {
  userId: string
}

/**
 * Variables added to Hono context
 */
export interface AuthVariables {
  auth: AuthContext
  messaging: MessagingService
}

/**
 * Auth extractor function type
 */
export type AuthExtractor = (c: Context) => Promise<AuthContext | null>

/**
 * Create auth middleware
 * @param extractAuth - Function to extract auth from request (e.g., from JWT, session)
 * @param messaging - MessagingService instance
 */
export function createAuthMiddleware(
  extractAuth: AuthExtractor,
  messaging: MessagingService
) {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const auth = await extractAuth(c)

    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Set current user on messaging service
    messaging.setCurrentUser(auth.userId)

    // Add to context
    c.set('auth', auth)
    c.set('messaging', messaging)

    await next()
  }
}

/**
 * Helper to get auth from context
 */
export function getAuth(c: Context<{ Variables: AuthVariables }>): AuthContext {
  return c.get('auth')
}

/**
 * Helper to get messaging service from context
 */
export function getMessaging(c: Context<{ Variables: AuthVariables }>): MessagingService {
  return c.get('messaging')
}
