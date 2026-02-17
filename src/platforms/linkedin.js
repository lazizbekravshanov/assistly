import { apiRequest, assertConfigured } from './http.js';

function toAuthorUrn(profileId) {
  if (!profileId) return '';
  if (profileId.startsWith('urn:li:')) return profileId;
  return `urn:li:person:${profileId}`;
}

export class LinkedInClient {
  constructor(config) {
    this.token = config.accessToken;
    this.profileId = config.profileId;
    this.baseUrl = 'https://api.linkedin.com/v2';
  }

  async post(content) {
    assertConfigured('LINKEDIN_ACCESS_TOKEN', this.token);
    assertConfigured('LINKEDIN_PROFILE_ID', this.profileId);

    const author = toAuthorUrn(this.profileId);
    const { data } = await apiRequest({
      url: `${this.baseUrl}/ugcPosts`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json'
      },
      body: {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      }
    });

    const id = data?.id || null;
    return {
      platform: 'linkedin',
      id,
      url: null,
      chars: content.length
    };
  }

  async analytics(_period = '7d') {
    assertConfigured('LINKEDIN_ACCESS_TOKEN', this.token);
    assertConfigured('LINKEDIN_PROFILE_ID', this.profileId);

    const urn = toAuthorUrn(this.profileId);
    const encodedUrn = encodeURIComponent(urn);
    const { data } = await apiRequest({
      url: `${this.baseUrl}/networkSizes/${encodedUrn}?edgeType=CompanyFollowedByMember`,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });

    return {
      followers: data?.firstDegreeSize ?? 0
    };
  }
}
