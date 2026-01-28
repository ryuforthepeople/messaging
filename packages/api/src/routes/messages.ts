import { Hono } from 'hono'
import type { AuthVariables } from '../middleware/auth'
import { getMessaging } from '../middleware/auth'

/**
 * Messages routes
 */
export const messagesRoutes = new Hono<{ Variables: AuthVariables }>()

// List messages in a conversation
messagesRoutes.get('/conversations/:conversationId/messages', async (c) => {
  const messaging = getMessaging(c)
  const conversationId = c.req.param('conversationId')
  const limit = parseInt(c.req.query('limit') ?? '20')
  const before = c.req.query('before')
  const after = c.req.query('after')

  try {
    const result = await messaging.listMessages(conversationId, {
      limit,
      before: before ?? undefined,
      after: after ?? undefined,
    })
    return c.json(result)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Send a message
messagesRoutes.post('/conversations/:conversationId/messages', async (c) => {
  const messaging = getMessaging(c)
  const conversationId = c.req.param('conversationId')
  const body = await c.req.json<{
    content: string
    type?: 'text' | 'image' | 'file' | 'voice'
    replyTo?: string
  }>()

  if (!body.content || body.content.trim().length === 0) {
    return c.json({ error: 'Message content required' }, 400)
  }

  if (body.content.length > 2000) {
    return c.json({ error: 'Message too long (max 2000 characters)' }, 400)
  }

  try {
    const message = await messaging.sendMessage(conversationId, {
      content: body.content.trim(),
      type: body.type,
      replyTo: body.replyTo,
    })
    return c.json(message, 201)
  } catch (error) {
    const message = (error as Error).message
    if (message.includes('Rate limit')) {
      return c.json({ error: message }, 429)
    }
    return c.json({ error: message }, 500)
  }
})

// Delete a message
messagesRoutes.delete('/messages/:id', async (c) => {
  const messaging = getMessaging(c)
  const id = c.req.param('id')

  try {
    await messaging.deleteMessage(id)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})

// Get message quota
messagesRoutes.get('/quota', async (c) => {
  const messaging = getMessaging(c)

  try {
    const quota = await messaging.getQuota()
    return c.json(quota)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500)
  }
})
