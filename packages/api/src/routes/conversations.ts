import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth'
import { getMessaging } from '../middleware/auth'

/**
 * Conversations routes
 */
export const conversationsRoutes = new Hono<{ Variables: AuthVariables }>()

// List conversations
conversationsRoutes.get('/', async (c) => {
  const messaging = getMessaging(c)
  const limit = parseInt(c.req.query('limit') ?? '20')
  const offset = parseInt(c.req.query('offset') ?? '0')

  try {
    const result = await messaging.listConversations({ limit, offset })
    return c.json(result)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Get conversation by ID
conversationsRoutes.get('/:id', async (c) => {
  const messaging = getMessaging(c)
  const id = c.req.param('id')

  try {
    const conversation = await messaging.getConversation(id)
    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404)
    }
    return c.json(conversation)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Create conversation
conversationsRoutes.post('/', async (c) => {
  const messaging = getMessaging(c)
  const body = await c.req.json<{
    participants: string[]
    name?: string
    type?: 'dm' | 'group'
  }>()

  if (!body.participants || body.participants.length === 0) {
    return c.json({ error: 'Participants required' }, 400)
  }

  try {
    const conversation = await messaging.createConversation(body.participants, {
      name: body.name,
      type: body.type,
    })
    return c.json(conversation, 201)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Delete (leave) conversation
conversationsRoutes.delete('/:id', async (c) => {
  const messaging = getMessaging(c)
  const id = c.req.param('id')

  try {
    await messaging.deleteConversation(id)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Mute/unmute conversation
conversationsRoutes.post('/:id/mute', async (c) => {
  const messaging = getMessaging(c)
  const id = c.req.param('id')
  const body = await c.req.json<{ mute: boolean }>()

  try {
    await messaging.muteConversation(id, body.mute)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Mark as read
conversationsRoutes.post('/:id/read', async (c) => {
  const messaging = getMessaging(c)
  const id = c.req.param('id')

  try {
    await messaging.markAsRead(id)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})
