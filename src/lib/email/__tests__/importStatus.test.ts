import { describe, expect, it } from 'vitest';
import {
  deriveEmailImportState,
  getEmailImportProgressPercent,
  getEmailImportStatusMessage,
} from '../importStatus';

describe('deriveEmailImportState', () => {
  it('treats pending config without activity as queued', () => {
    const state = deriveEmailImportState({
      config: {
        sync_status: 'pending',
        sync_stage: 'queued',
        sync_progress: 12,
      },
    });

    expect(state.phase).toBe('queued');
    expect(getEmailImportProgressPercent(state)).toBe(12);
  });

  it('prefers live progress rows for classifying state', () => {
    const state = deriveEmailImportState({
      progress: {
        current_phase: 'classifying',
        emails_received: 250,
        emails_classified: 100,
      },
      config: {
        sync_status: 'pending',
      },
    });

    expect(state.phase).toBe('classifying');
    expect(getEmailImportStatusMessage(state)).toContain('100');
    expect(getEmailImportProgressPercent(state)).toBeGreaterThanOrEqual(70);
  });

  it('treats queued progress with an active run as importing', () => {
    const state = deriveEmailImportState({
      progress: {
        current_phase: 'queued',
      },
      activeRun: {
        state: 'running',
        metrics: {
          fetched_so_far: 25,
        },
      },
    });

    expect(state.phase).toBe('fetching_inbox');
    expect(state.emailsReceived).toBe(25);
  });

  it('treats voice-complete progress as complete', () => {
    const state = deriveEmailImportState({
      progress: {
        current_phase: 'learning',
        inbox_email_count: 200,
        sent_email_count: 50,
        voice_profile_complete: true,
      },
    });

    expect(state.phase).toBe('complete');
    expect(getEmailImportProgressPercent(state)).toBe(100);
  });

  it('maps provider throttling to rate limited', () => {
    const state = deriveEmailImportState({
      progress: {
        current_phase: 'queued',
        last_error: '429 rate limit exceeded',
      },
    });

    expect(state.phase).toBe('rate_limited');
    expect(getEmailImportStatusMessage(state)).toContain('rate limit');
  });
});
