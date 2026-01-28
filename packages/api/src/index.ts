import { Hono } from 'hono'
import type { MessagingService } from '@for-the-people/messaging-core'
import {
  createAuthMiddleware,
  type AuthExtractor,
  type AuthVariables,
  type AuthContext,
} from './middleware/auth'
import { conversationsRoutes } from './routes/conversations'
import { messagesRoutes } from './routes/messages'

export type { AuthContext, AuthExtractor, AuthVariables }
export { createAuthMiddleware }

/**
 * Options for creating the messaging API
 */
export interface MessagingApiOptions {
  /** Messaging service instance */
  messaging: MessagingService

  /** Function to extract auth from request */
  extractAuth: AuthExtractor

  /** Base path for routes (default: '/api/messaging') */
  basePath?: string
}

/**
 * Create Hono app with messaging routes
 */
export function createMessagingApi(options: MessagingApiOptions): Hono {
  const { messaging, extractAuth, basePath = '/api/messaging' } = options

  const app = new Hono()
  const authMiddleware = createAuthMiddleware(extractAuth, messaging)

  // Mount routes with auth middleware
  const router = new Hono<{ Variables: AuthVariables }>()
  router.use('*', authMiddleware)
  router.route('/conversations', conversationsRoutes)
  router.route('/', messagesRoutes)

  // Health check (no auth)
  app.get(`${basePath}/health`, (c) => c.json({ status: 'ok' }))

  // Mount authenticated routes
  app.route(basePath, router)

  return app
}

/**
 * Create just the routes (for mounting in existing Hono app)
 */
export function createMessagingRoutes(
  messaging: MessagingService,
  extractAuth: AuthExtractor
): Hono<{ Variables: AuthVariables }> {
  const router = new Hono<{ Variables: AuthVariables }>()
  const authMiddleware = createAuthMiddleware(extractAuth, messaging)

  router.use('*', authMiddleware)
  router.route('/conversations', conversationsRoutes)
  router.route('/', messagesRoutes)

  return router
}
