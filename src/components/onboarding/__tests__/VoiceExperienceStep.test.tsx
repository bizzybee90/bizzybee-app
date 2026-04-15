import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_VOICE_EXPERIENCE_DRAFT } from '../VoiceExperienceStep.config';
import { VoiceExperienceStep } from '../VoiceExperienceStep';

vi.mock('@/components/ui/slider', () => ({
  Slider: ({
    value,
    onValueChange,
  }: {
    value: number[];
    onValueChange: (value: number[]) => void;
  }) => (
    <input
      aria-label="Formality slider"
      type="range"
      min={1}
      max={10}
      step={1}
      value={value?.[0] ?? 6}
      onChange={(event) => onValueChange([Number(event.target.value)])}
    />
  ),
}));

describe('VoiceExperienceStep', () => {
  it('lets the user shape voice, tone, and preview scenarios', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onNext = vi.fn();
    const onBack = vi.fn();

    const Wrapper = () => {
      const [value, setValue] = useState(DEFAULT_VOICE_EXPERIENCE_DRAFT);

      return (
        <VoiceExperienceStep
          businessContext={{
            companyName: 'BizzyBee Cleaning',
            businessType: 'window_cleaning',
            websiteUrl: 'https://bizzyb.ee',
          }}
          knowledgeSummary={{
            industryFaqs: 4,
            websiteFaqs: 6,
          }}
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          onNext={onNext}
          onBack={onBack}
        />
      );
    };

    render(<Wrapper />);

    expect(screen.getByText(/Shape how BizzyBee sounds/i)).toBeInTheDocument();
    expect(
      screen.getByText('warm · reassuring · professional', { selector: 'p' }),
    ).toBeInTheDocument();
    // Reply is now an actual receptionist reply, not a narrative about the reply.
    // Look for a phrase that only appears in the new_enquiry reply body.
    expect(
      screen.getByText(/If you share a postcode I can confirm we cover the area/i),
    ).toBeInTheDocument();
    // "What this unlocks" is now a concrete checklist, not a generic paragraph.
    expect(screen.getByText(/Custom rules/i)).toBeInTheDocument();
    expect(screen.getByText(/Escalation triggers/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^warm$/i }));
    await waitFor(() => {
      expect(screen.getByText('reassuring · professional', { selector: 'p' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /quote request/i }));
    await waitFor(() => {
      expect(screen.getByText(/How much would it be for a regular clean/i)).toBeInTheDocument();
    });

    // Complaint scenario shows the guard-rail demo note (no refund commitment).
    await user.click(screen.getByRole('button', { name: /complaint/i }));
    await waitFor(() => {
      expect(screen.getByText(/Guard-rail demo/i)).toBeInTheDocument();
      expect(screen.getByText(/I can't commit to a refund on the call/i)).toBeInTheDocument();
    });

    // Formality slider now has FIVE bands, so moving across any band boundary
    // should visibly rewrite the reply. Casual(1-2) / friendly(3-4) /
    // balanced(5-6) / polished(7-8) / formal(9-10).
    await user.click(screen.getByRole('button', { name: /new enquiry/i }));
    const slider = screen.getByLabelText('Formality slider') as HTMLInputElement;

    // → formal (10): greeting uses "Good day", sign-off becomes "Thank you. Goodbye."
    fireEvent.change(slider, { target: { value: '10' } });
    await waitFor(() => {
      expect(screen.getByText(/Good day, you're through to/i)).toBeInTheDocument();
      expect(screen.getByText(/Thank you\. Goodbye\./i)).toBeInTheDocument();
    });

    // → polished (7): "Hello, thank you for calling" + "Thank you. Speak soon."
    fireEvent.change(slider, { target: { value: '7' } });
    await waitFor(() => {
      expect(screen.getByText(/Hello, thank you for calling/i)).toBeInTheDocument();
      expect(screen.getByText(/Thank you\. Speak soon\./i)).toBeInTheDocument();
    });

    // → friendly (3): greeting uses "Jessica here", sign-off "Thanks, speak soon!"
    fireEvent.change(slider, { target: { value: '3' } });
    await waitFor(() => {
      expect(screen.getByText(/Jessica here/i)).toBeInTheDocument();
      expect(screen.getByText(/Thanks, speak soon!/i)).toBeInTheDocument();
    });

    // → casual (1): "Hey — thanks for the call!" + "Cheers — speak soon!"
    fireEvent.change(slider, { target: { value: '1' } });
    await waitFor(() => {
      expect(screen.getByText(/Hey — thanks for the call!/i)).toBeInTheDocument();
      expect(screen.getByText(/Cheers — speak soon!/i)).toBeInTheDocument();
    });

    // Tone chips each add a UNIQUE distinct pleasantry.
    // Reset slider to balanced so tone effects are clean.
    fireEvent.change(slider, { target: { value: '6' } });
    // Start from current state (warm was toggled off earlier, reassuring + professional
    // still selected). Toggle calm ON and assert its phrase appears.
    await user.click(screen.getByRole('button', { name: /^calm$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Take your time with this\./i)).toBeInTheDocument();
    });

    // Toggling 'polished' chip should bump the band by +1 without touching the
    // slider, producing the "Hello, thank you for calling" polished greeting.
    await user.click(screen.getByRole('button', { name: /^polished$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Hello, thank you for calling/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Select Chris voice/i }));
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedVoiceId: 'iP95p4xoKVk53GoZ742B',
          selectedVoiceName: 'Chris',
        }),
      );
    });

    await user.click(screen.getByRole('button', { name: /Continue/i }));
    expect(onNext).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Back/i }));
    expect(onBack).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });
});
