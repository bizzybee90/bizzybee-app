import { describe, expect, it } from 'vitest';
import {
  deriveEmailImportState,
  getEmailImportProgressPercent,
  getEmailImportStatusMessage,
  isMailboxWarmupError,
  isMailboxWarmupStuckError,
  shouldKickEmailImport,
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

  it('treats mailbox warmup responses as queued instead of hard failure', () => {
    const state = deriveEmailImportState({
      progress: {
        current_phase: 'error',
        last_error: 'MAILBOX_WARMUP_RETRY: Fastmail is still exposing folders to BizzyBee.',
      },
    });

    expect(isMailboxWarmupError(state.errorMessage)).toBe(true);
    expect(state.phase).toBe('queued');
  });

  it('treats mailbox warmup stuck responses as a real error', () => {
    const state = deriveEmailImportState({
      progress: {
        current_phase: 'error',
        last_error:
          'MAILBOX_WARMUP_STUCK: Fastmail stalled before import could begin. Disconnect and reconnect this inbox to continue importing historical email.',
      },
    });

    expect(isMailboxWarmupStuckError(state.errorMessage)).toBe(true);
    expect(state.phase).toBe('error');
    expect(getEmailImportStatusMessage(state)).toContain('Disconnect and reconnect');
  });
});

// Regression: aurinko-create-imap-account seeds current_phase='queued' on connect.
// If the Continue-button gate doesn't treat 'queued' as kickable, new IMAP
// connections silently never start their import.
describe('shouldKickEmailImport', () => {
  it('returns true for idle status', () => {
    expect(shouldKickEmailImport('idle')).toBe(true);
  });

  it('returns true for error status so retry kicks import', () => {
    expect(shouldKickEmailImport('error')).toBe(true);
  });

  it('returns true for queued status so Continue button starts the IMAP import', () => {
    expect(shouldKickEmailImport('queued')).toBe(true);
  });

  it('returns true when progress is undefined (never loaded)', () => {
    expect(shouldKickEmailImport(undefined)).toBe(true);
  });

  it('returns false for importing status (already running)', () => {
    expect(shouldKickEmailImport('importing')).toBe(false);
  });

  it('returns false for classifying status', () => {
    expect(shouldKickEmailImport('classifying')).toBe(false);
  });

  it('returns false for learning status', () => {
    expect(shouldKickEmailImport('learning')).toBe(false);
  });

  it('returns false for complete status', () => {
    expect(shouldKickEmailImport('complete')).toBe(false);
  });
});
