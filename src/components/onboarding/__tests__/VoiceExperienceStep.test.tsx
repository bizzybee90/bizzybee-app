import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText(/BizzyBee would answer as Jessica/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^warm$/i }));
    await waitFor(() => {
      expect(screen.getByText('reassuring · professional', { selector: 'p' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /quote request/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Could you give me a rough price for the job\?/i),
      ).toBeInTheDocument();
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
