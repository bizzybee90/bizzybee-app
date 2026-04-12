import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingProgress } from '../useOnboardingProgress';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

describe('useOnboardingProgress', () => {
  const setIntervalSpy = vi.spyOn(window, 'setInterval');

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.loggerError.mockReset();
    setIntervalSpy.mockClear();
  });

  afterEach(() => {
    setIntervalSpy.mockClear();
  });

  it('loads onboarding progress via the bb_get_onboarding_progress RPC and refreshes on a timer', async () => {
    const firstPayload = {
      workspace_id: 'ws-1',
      tracks: {
        discovery: {
          run_id: 'run-discovery-1',
          agent_status: 'queued',
          current_step: 'acquire',
          counts: { queued: 1 },
          latest_error: null,
          updated_at: '2026-04-12T10:00:00.000Z',
        },
        website: {
          run_id: null,
          agent_status: 'idle',
          current_step: null,
          counts: {},
          latest_error: null,
          updated_at: null,
        },
        faq_generation: {
          run_id: null,
          agent_status: 'idle',
          current_step: null,
          counts: {},
          latest_error: null,
          updated_at: null,
        },
        email_import: {
          run_id: null,
          agent_status: 'idle',
          current_step: null,
          counts: {},
          latest_error: null,
          updated_at: null,
        },
      },
    };

    const secondPayload = {
      ...firstPayload,
      tracks: {
        ...firstPayload.tracks,
        discovery: {
          ...firstPayload.tracks.discovery,
          agent_status: 'running',
          current_step: 'qualify',
          counts: { queued: 0, running: 1 },
        },
      },
    };

    mocks.rpc
      .mockResolvedValueOnce({ data: firstPayload, error: null })
      .mockResolvedValueOnce({ data: secondPayload, error: null });

    const { result } = renderHook(() => useOnboardingProgress('ws-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mocks.rpc).toHaveBeenCalledWith('bb_get_onboarding_progress', {
      p_workspace_id: 'ws-1',
    });
    expect(result.current.data).toEqual(firstPayload);
    expect(result.current.error).toBeNull();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);

    mocks.rpc.mockResolvedValueOnce({ data: secondPayload, error: null });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
    });

    expect(result.current.data).toEqual(secondPayload);
  });

  it('surfaces RPC failures as a readable error', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC exploded' },
    });

    const { result } = renderHook(() => useOnboardingProgress('ws-2'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('RPC exploded');
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to load onboarding progress',
      expect.objectContaining({ message: 'RPC exploded' }),
    );
  });
});
