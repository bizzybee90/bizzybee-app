import { describe, expect, it } from 'vitest';
import {
  REVIEW_CONFIG_FIELDS,
  REVIEW_PROVIDER_DEFINITIONS,
  deriveReviewConnectionState,
  getReviewSetupActionLabel,
  getReviewSetupDescription,
  getReviewSetupProgress,
} from '@/lib/reviews';
import {
  CHANNEL_DEFINITIONS,
  CHANNEL_PROVIDER_GROUPS,
  CHANNEL_ROUTING_FIELDS,
} from '@/lib/channels';

describe('Reviews and channel readiness copy', () => {
  it('keeps Google place handling optional while requiring the core profile fields', () => {
    const googleFields = REVIEW_CONFIG_FIELDS.google;

    expect(googleFields).toHaveLength(3);
    expect(googleFields[0]).toMatchObject({
      label: 'Google Business Profile account reference',
      required: true,
    });
    expect(googleFields[1]).toMatchObject({
      label: 'Google Business Profile location reference',
      required: true,
    });
    expect(googleFields[2]).toMatchObject({
      label: 'Google place ID',
      required: false,
    });
    expect(googleFields[2].helpText).toContain(
      'Optional extra identifier for analytics and location linking.',
    );

    const connectedConfig = {
      accountRef: 'accounts/100200300',
      locationRef: 'locations/200300400',
      placeId: 'ChIJ7d3x0k8LdkgR4I3Q9x6nStA',
    };

    expect(getReviewSetupProgress('google', connectedConfig)).toEqual({
      requiredCount: 2,
      completedCount: 2,
      missingLabels: [],
      isComplete: true,
    });
    expect(
      deriveReviewConnectionState(
        'google',
        {
          provider: 'google',
          status: null,
          config: connectedConfig,
        },
        [{ provider_location_ref: 'locations/200300400' }],
      ),
    ).toBe('ready');
    expect(
      getReviewSetupDescription(REVIEW_PROVIDER_DEFINITIONS.google, 'ready', connectedConfig),
    ).toContain('ready for live review sync');
    expect(
      getReviewSetupActionLabel(REVIEW_PROVIDER_DEFINITIONS.google, 'ready', connectedConfig),
    ).toBe('Open reviews');
  });

  it('keeps the production-readiness copy pointed at Reviews, managed provisioning, and WhatsApp defaults', () => {
    expect(CHANNEL_DEFINITIONS.google_business.description).toContain('Reviews module');
    expect(CHANNEL_DEFINITIONS.google_business.onboardingNote).toContain(
      'Messaging here is legacy transport',
    );

    const twilioGroup = CHANNEL_PROVIDER_GROUPS.find((group) => group.id === 'twilio');
    const googleGroup = CHANNEL_PROVIDER_GROUPS.find((group) => group.id === 'google');

    expect(twilioGroup).toBeDefined();
    expect(twilioGroup?.status).toBe('Managed provisioning recommended');
    expect(googleGroup).toBeDefined();
    expect(googleGroup?.description).toContain('dedicated Reviews module');

    expect(CHANNEL_ROUTING_FIELDS.sms?.[0].helpText).toContain(
      'BizzyBee-managed SMS number by default.',
    );
    expect(CHANNEL_ROUTING_FIELDS.whatsapp?.[0].helpText).toContain(
      'BizzyBee-managed WhatsApp sender by default.',
    );
  });
});
