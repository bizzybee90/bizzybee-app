import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FlagshipActivationStep } from '../FlagshipActivationStep';

const mockMutate = vi.fn();
const mockUseAiPhoneConfig = vi.fn();
const mockUseWorkspace = vi.fn();

vi.mock('@/hooks/useAiPhoneConfig', () => ({
  useAiPhoneConfig: () => mockUseAiPhoneConfig(),
}));

vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

describe('FlagshipActivationStep', () => {
  const baseProps = {
    workspaceId: 'workspace-123',
    businessContext: {
      companyName: 'BizzyBee Cleaning',
      websiteUrl: 'https://bizzyb.ee',
      serviceArea: 'Luton',
      businessType: 'window_cleaning',
    },
    knowledgeSummary: {
      industryFaqs: 4,
      websiteFaqs: 8,
    },
    voiceExperience: {
      selectedVoiceId: 'cgSgspJ2msm6clMCkdW9',
      selectedVoiceName: 'Jessica',
      receptionistName: 'Jessica',
      toneDescriptors: ['warm', 'reassuring', 'polished'],
      greeting: 'Hi, thanks for calling BizzyBee Cleaning.',
      signoff: 'Thanks, speak soon.',
    },
    connectedEmail: null as string | null,
    onNext: vi.fn(),
    onBack: vi.fn(),
  };

  beforeEach(() => {
    mockMutate.mockReset();
    mockUseAiPhoneConfig.mockReturnValue({
      config: null,
      createConfig: { mutate: mockMutate },
      isProvisioning: false,
    });
    mockUseWorkspace.mockReturnValue({
      entitlements: { canUseAiPhone: true },
    });
  });

  it('renders the learned summary and both flagship cards', () => {
    render(<FlagshipActivationStep {...baseProps} />);

    expect(screen.getByText(/What BizzyBee has already learned/i)).toBeInTheDocument();
    expect(screen.getByText(/Bring Email and AI Phone online/i)).toBeInTheDocument();
    expect(screen.getByText(/^Email$/i)).toBeInTheDocument();
    expect(screen.getByText(/^AI Phone$/i)).toBeInTheDocument();
    expect(screen.getByText(/12 FAQs/i)).toBeInTheDocument();
    expect(screen.getByText(/Jessica/i)).toBeInTheDocument();
  });

  it('shows a provisioning CTA when AI phone is available and not configured', async () => {
    const user = userEvent.setup();
    render(<FlagshipActivationStep {...baseProps} />);

    const button = screen.getByRole('button', { name: /Provision BizzyBee-managed number/i });
    expect(button).toBeInTheDocument();
    await user.click(button);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        business_name: 'BizzyBee Cleaning',
        voice_id: 'cgSgspJ2msm6clMCkdW9',
        voice_name: 'Jessica',
      }),
    );
  });

  it('shows the existing number when the AI phone config is active', () => {
    mockUseAiPhoneConfig.mockReturnValue({
      config: {
        phone_number: '+441234567890',
        status: 'active',
        is_active: true,
      },
      createConfig: { mutate: mockMutate },
      isProvisioning: false,
    });

    render(<FlagshipActivationStep {...baseProps} connectedEmail="hello@bizzyb.ee" />);

    expect(screen.getAllByText(/hello@bizzyb.ee/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/\+441234567890/i)).toBeInTheDocument();
    expect(screen.getByText(/BizzyBee-managed line is active/i)).toBeInTheDocument();
  });

  it('shows locked copy when AI phone is unavailable', () => {
    mockUseWorkspace.mockReturnValue({
      entitlements: { canUseAiPhone: false },
    });

    render(<FlagshipActivationStep {...baseProps} />);

    expect(screen.getByText(/AI Phone is locked on this plan/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Provision BizzyBee-managed number/i }),
    ).not.toBeInTheDocument();
  });
});
