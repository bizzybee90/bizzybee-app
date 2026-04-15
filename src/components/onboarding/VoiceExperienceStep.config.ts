export type VoiceScenarioId = 'new_enquiry' | 'quote_request' | 'booking_change' | 'complaint';

export interface VoiceExperienceDraft {
  selectedVoiceId: string;
  selectedVoiceName: string;
  receptionistName: string;
  toneDescriptors: string[];
  formalityScore: number;
  greeting: string;
  signoff: string;
  scenarioId: VoiceScenarioId;
}

export const DEFAULT_VOICE_EXPERIENCE_DRAFT: VoiceExperienceDraft = {
  selectedVoiceId: 'cgSgspJ2msm6clMCkdW9',
  selectedVoiceName: 'Jessica',
  receptionistName: 'Jessica',
  toneDescriptors: ['warm', 'reassuring', 'professional'],
  formalityScore: 6,
  greeting: '',
  signoff: '',
  scenarioId: 'new_enquiry',
};
