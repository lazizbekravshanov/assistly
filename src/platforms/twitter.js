import { apiRequest, assertConfigured } from './http.js';

export class TwitterClient {
  constructor(config) {
    this.token = config.accessToken;
    this.baseUrl = 'https://api.twitter.com/2';
  }

  async post(content) {
    assertConfigured('TWITTER_ACCESS_TOKEN', this.token);

    const { data } = await apiRequest({
      url: `${this.baseUrl}/tweets`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: { text: content }
    });

    const id = data?.data?.id;
    return {
      platform: 'twitter',
      id,
      url: id ? `https://x.com/i/web/status/${id}` : null,
      chars: content.length
    };
  }

  async analytics(_period = '7d') {
    assertConfigured('TWITTER_ACCESS_TOKEN', this.token);

    const meResp = await apiRequest({
      url: `${this.baseUrl}/users/me?user.fields=public_metrics`,
      headers: { Authorization: `Bearer ${this.token}` }
    });

    const me = meResp.data;
    const userId = me?.data?.id;
    let impressions = 0;
    let engagements = 0;

    if (userId) {
      const tweetsResp = await apiRequest({
        url: `${this.baseUrl}/users/${userId}/tweets?max_results=10&tweet.fields=public_metrics`,
        headers: { Authorization: `Bearer ${this.token}` }
      });

      for (const tweet of tweetsResp.data?.data || []) {
        const m = tweet.public_metrics || {};
        impressions += Number(m.impression_count || 0);
        engagements += Number(m.like_count || 0) + Number(m.retweet_count || 0) + Number(m.reply_count || 0);
      }
    }

    return {
      impressions,
      engagements,
      followers: me?.data?.public_metrics?.followers_count ?? 0
    };
  }
}
