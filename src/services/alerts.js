export class AlertService {
  constructor({ enabled = false, webhookUrl = '', timeoutMs = 5000, logger = null } = {}) {
    this.enabled = enabled;
    this.webhookUrl = webhookUrl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
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
    } catch (error) {
      if (this.logger) {
        this.logger.log('alert.delivery_failed', {
          alertType: type,
          error: error.message || 'unknown'
        });
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
