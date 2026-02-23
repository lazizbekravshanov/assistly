import { apiRequest, assertConfigured } from './http.js';

export class TelegramClient {
  constructor(config) {
    this.botToken = config.botToken;
    this.channelId = config.channelId;
    this.ownerChatId = config.ownerChatId;
    this.pollingIntervalMs = config.pollingIntervalMs ?? 2000;
    this.httpTimeoutMs = config.httpTimeoutMs ?? 10000;
    this.httpRetries = config.httpRetries ?? 2;
    this.httpBackoffMs = config.httpBackoffMs ?? 250;
    this._polling = false;
    this._pollOffset = 0;
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
        parse_mode: 'HTML'
      },
      timeoutMs: this.httpTimeoutMs,
      retries: this.httpRetries,
      backoffMs: this.httpBackoffMs
    });

    const messageId = data?.result?.message_id;
    return {
      platform: 'telegram',
      id: messageId,
      url: null,
      chars: content.length
    };
  }

  async sendMessage(chatId, text) {
    assertConfigured('TELEGRAM_BOT_TOKEN', this.botToken);

    const { data } = await apiRequest({
      url: this.#url('sendMessage'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      },
      timeoutMs: this.httpTimeoutMs,
      retries: this.httpRetries,
      backoffMs: this.httpBackoffMs
    });

    return data?.result;
  }

  async getUpdates(offset) {
    assertConfigured('TELEGRAM_BOT_TOKEN', this.botToken);

    const { data } = await apiRequest({
      url: this.#url('getUpdates'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        offset,
        timeout: 0,
        allowed_updates: ['message']
      },
      timeoutMs: this.httpTimeoutMs,
      retries: 0,
      backoffMs: this.httpBackoffMs
    });

    return data?.result || [];
  }

  async setMyCommands(commands) {
    assertConfigured('TELEGRAM_BOT_TOKEN', this.botToken);

    const { data } = await apiRequest({
      url: this.#url('setMyCommands'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { commands },
      timeoutMs: this.httpTimeoutMs,
      retries: this.httpRetries,
      backoffMs: this.httpBackoffMs
    });

    return data?.result;
  }

  startPolling(onMessage) {
    this._polling = true;

    const poll = async () => {
      while (this._polling) {
        try {
          const updates = await this.getUpdates(this._pollOffset);
          for (const update of updates) {
            this._pollOffset = update.update_id + 1;
            if (update.message) {
              try {
                await onMessage(update.message);
              } catch (err) {
                console.error('Telegram polling handler error:', err.message);
              }
            }
          }
        } catch (err) {
          console.error('Telegram getUpdates error:', err.message);
        }
        await new Promise((r) => setTimeout(r, this.pollingIntervalMs));
      }
    };

    poll();
  }

  stopPolling() {
    this._polling = false;
  }

  async analytics(_period = '7d') {
    assertConfigured('TELEGRAM_BOT_TOKEN', this.botToken);
    assertConfigured('TELEGRAM_CHANNEL_ID', this.channelId);

    const { data } = await apiRequest({
      url: this.#url('getChatMemberCount'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { chat_id: this.channelId },
      timeoutMs: this.httpTimeoutMs,
      retries: this.httpRetries,
      backoffMs: this.httpBackoffMs
    });

    return {
      subscribers: data?.result ?? 0
    };
  }
}
