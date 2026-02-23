import { apiRequest } from '../platforms/http.js';

const PLATFORM_LIMITS = { twitter: 280, telegram: 4096, linkedin: 3000 };

const SYSTEM_PROMPT = `You are a social-media content writer. Given a topic, produce three platform-tailored drafts.

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "twitter": "...",
  "telegram": "...",
  "linkedin": "..."
}

Rules per platform:
- twitter: max 280 chars, punchy hook, 1-2 relevant hashtags
- telegram: max 4096 chars, bold headline, context, practical takeaways
- linkedin: max 3000 chars, professional tone, framework or insight, 2-3 hashtags`;

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + '...';
}

export class AiContentService {
  constructor({ apiKey, model, maxTokens, httpTimeoutMs, httpRetries, httpBackoffMs }) {
    this.apiKey = apiKey;
    this.model = model || 'claude-sonnet-4-20250514';
    this.maxTokens = maxTokens || 2048;
    this.httpTimeoutMs = httpTimeoutMs || 30000;
    this.httpRetries = httpRetries ?? 1;
    this.httpBackoffMs = httpBackoffMs || 500;
  }

  async generateDrafts(topic) {
    const { data } = await apiRequest({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: {
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Topic: ${topic}` }]
      },
      timeoutMs: this.httpTimeoutMs,
      retries: this.httpRetries,
      backoffMs: this.httpBackoffMs
    });

    const raw = data?.content?.[0]?.text;
    if (!raw) throw new Error('Empty response from AI API');

    const cleaned = stripCodeFences(raw);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('AI returned invalid JSON');
    }

    const drafts = {};
    for (const platform of ['twitter', 'telegram', 'linkedin']) {
      const text = typeof parsed[platform] === 'string' ? parsed[platform] : '';
      if (!text) throw new Error(`AI response missing ${platform} draft`);
      drafts[platform] = {
        text: truncate(text, PLATFORM_LIMITS[platform]),
        chars: Math.min(text.length, PLATFORM_LIMITS[platform])
      };
    }

    return drafts;
  }
}
