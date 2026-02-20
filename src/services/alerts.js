export class AlertService {
  constructor({ enabled = false, webhookUrl = '', timeoutMs = 5000 } = {}) {
    this.enabled = enabled;
    this.webhookUrl = webhookUrl;
    this.timeoutMs = timeoutMs;
  }

  async notify(type, payload = {}) {
    if (!this.enabled || !this.webhookUrl) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          ts: new Date().toISOString(),
          payload
        }),
        signal: controller.signal
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

