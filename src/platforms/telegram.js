import { apiRequest, assertConfigured } from './http.js';

export class TelegramClient {
  constructor(config) {
    this.botToken = config.botToken;
    this.channelId = config.channelId;
  }

  #url(method) {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  async post(content) {
    assertConfigured('TELEGRAM_BOT_TOKEN', this.botToken);
    assertConfigured('TELEGRAM_CHANNEL_ID', this.channelId);

    const { data } = await apiRequest({
      url: this.#url('sendMessage'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        chat_id: this.channelId,
        text: content,
        parse_mode: 'Markdown'
      }
    });

    const messageId = data?.result?.message_id;
    return {
      platform: 'telegram',
      id: messageId,
      url: null,
      chars: content.length
    };
  }

  async analytics(_period = '7d') {
    assertConfigured('TELEGRAM_BOT_TOKEN', this.botToken);
    assertConfigured('TELEGRAM_CHANNEL_ID', this.channelId);

    const { data } = await apiRequest({
      url: this.#url('getChatMemberCount'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { chat_id: this.channelId }
    });

    return {
      subscribers: data?.result ?? 0
    };
  }
}
