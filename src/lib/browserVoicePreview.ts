type BrowserVoicePreviewOptions = {
  preferredVoiceName?: string;
  preferredGender?: 'Male' | 'Female';
  text: string;
};

const voiceHints: Record<string, string[]> = {
  Jessica: ['Karen', 'Moira', 'Samantha', 'Daniel'],
  Chris: ['Daniel', 'Moira', 'Samantha'],
  Charlotte: ['Moira', 'Karen', 'Samantha'],
  Will: ['Daniel', 'Moira', 'Samantha'],
  Sarah: ['Samantha', 'Karen', 'Moira'],
  Daniel: ['Daniel', 'Moira', 'Samantha'],
};

function scoreVoice(
  voice: SpeechSynthesisVoice,
  preferredVoiceName?: string,
  preferredGender?: 'Male' | 'Female',
) {
  const normalizedName = voice.name.toLowerCase();
  let score = 0;

  if (voice.lang.toLowerCase().startsWith('en-gb')) score += 4;
  else if (voice.lang.toLowerCase().startsWith('en')) score += 2;

  const directHints = preferredVoiceName ? (voiceHints[preferredVoiceName] ?? []) : [];
  if (directHints.some((hint) => normalizedName.includes(hint.toLowerCase()))) score += 6;

  if (preferredGender === 'Female' && /(karen|moira|samantha|tessa|kathy)/i.test(voice.name)) {
    score += 2;
  }

  if (preferredGender === 'Male' && /(daniel|fred|ralph|alex)/i.test(voice.name)) {
    score += 2;
  }

  return score;
}

async function getVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [] as SpeechSynthesisVoice[];
  }

  const initial = window.speechSynthesis.getVoices();
  if (initial.length > 0) {
    return initial;
  }

  return await new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timeout = window.setTimeout(() => {
      resolve(window.speechSynthesis.getVoices());
    }, 300);

    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        window.clearTimeout(timeout);
        resolve(window.speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}

export async function playBrowserVoicePreview({
  preferredVoiceName,
  preferredGender,
  text,
}: BrowserVoicePreviewOptions) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    throw new Error('Voice previews are not supported in this browser.');
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const voices = await getVoices();
  const voice = [...voices].sort(
    (a, b) =>
      scoreVoice(b, preferredVoiceName, preferredGender) -
      scoreVoice(a, preferredVoiceName, preferredGender),
  )[0];

  return await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice ?? null;
    utterance.lang = voice?.lang || 'en-GB';
    utterance.rate = 0.95;
    utterance.pitch = preferredGender === 'Male' ? 0.92 : 1.05;

    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Voice preview failed to play.'));

    synth.speak(utterance);
  });
}
