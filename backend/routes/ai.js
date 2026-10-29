const express = require('express');
const { verifyToken } = require('./auth');

const router = express.Router();
const requestsByUser = new Map();
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_LENGTH = 12000;
const REQUEST_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of requestsByUser) {
    if (now >= entry.resetAt) requestsByUser.delete(userId);
  }
}, REQUEST_WINDOW_MS).unref();

function isValidHistory(messages) {
  if (!Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > MAX_HISTORY_MESSAGES) {
    return false;
  }

  let totalLength = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || !['user', 'model'].includes(message.role) ||
        typeof message.text !== 'string') {
      return false;
    }

    const text = message.text.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH ||
        (index === 0 && message.role !== 'user') ||
        (index > 0 && message.role === messages[index - 1].role)) {
      return false;
    }
    totalLength += text.length;
  }

  return totalLength <= MAX_HISTORY_LENGTH &&
    messages[messages.length - 1].role === 'user';
}

router.post('/chat', verifyToken, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI chat is not configured on this server yet. Add GEMINI_API_KEY to the server environment.'
    });
  }

  const now = Date.now();
  const userId = String(req.user.id);
  let usage = requestsByUser.get(userId);
  if (!usage || now >= usage.resetAt) {
    usage = { count: 0, resetAt: now + REQUEST_WINDOW_MS };
  }
  if (usage.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      error: 'You have reached the AI chat limit. Please wait a minute and try again.'
    });
  }

  const { messages } = req.body || {};
  if (!isValidHistory(messages)) {
    return res.status(400).json({
      error: 'Send up to 12 alternating chat messages, with your latest message last.'
    });
  }
  usage.count++;
  requestsByUser.set(userId, usage);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'You are Campus Loop AI, a helpful assistant for college students. ' +
                'Help with studying, campus life, writing, and general questions. ' +
                'Be clear, supportive, and honest when you are unsure. Never claim to ' +
                'have checked private campus records or current campus events.'
            }]
          },
          contents: messages.map(message => ({
            role: message.role,
            parts: [{ text: message.text.trim() }]
          })),
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.7
          }
        })
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = String(result.error?.message || '');
      console.error('Gemini chat request failed:', {
        status: response.status,
        message: providerMessage || 'No provider error message returned.'
      });
      if (response.status === 429) {
        return res.status(503).json({
          error: 'The AI service is busy or its quota was reached. Please try again later.'
        });
      }
      if (response.status === 401 || response.status === 403 ||
          /api[\s_-]*key|api_key_invalid/i.test(providerMessage)) {
        return res.status(502).json({
          error: 'Gemini rejected the API key or access. In Render, check GEMINI_API_KEY and confirm the key can use the Gemini API.'
        });
      }
      if (response.status === 404 ||
          /model.{0,50}(not found|not available|unsupported)/i.test(providerMessage)) {
        return res.status(502).json({
          error: `Gemini model "${MODEL}" is unavailable. Set GEMINI_MODEL in Render to a model available to your API key.`
        });
      }
      return res.status(502).json({
        error: 'Gemini rejected the request. Check the Render service logs for the provider error, then verify the key and model settings.'
      });
    }

    const answer = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();
    if (!answer) {
      return res.status(502).json({
        error: 'The AI did not return a response. Try rephrasing your message.'
      });
    }

    res.json({ answer });
  } catch (error) {
    console.error('Gemini chat request failed:', error.message);
    res.status(502).json({
      error: 'Could not reach the AI service. Please try again.'
    });
  }
});

module.exports = router;
