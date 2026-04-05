export type ChannelKey =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'google_business'
  | 'webchat'
  | 'phone';

export type ChannelSurface = 'settings' | 'dashboard' | 'onboarding' | 'conversation';
export type ChannelModule = 'channels' | 'reviews' | 'ai_phone';
export type ChannelSettingsSection = 'email' | 'messaging' | 'provider';
export type ChannelSetupMode =
  | 'self_serve'
  | 'provider_setup'
  | 'account_linking'
  | 'coming_soon'
  | 'separate_module';
export type ChannelConnectionState =
  | 'disabled'
  | 'ready'
  | 'needs_connection'
  | 'provider_setup_required'
  | 'coming_soon'
  | 'separate_module';

export interface ChannelDefinition {
  key: ChannelKey;
  module: ChannelModule;
  label: string;
  shortLabel: string;
  description: string;
  onboardingNote?: string;
  setupMode: ChannelSetupMode;
  surfaces: ChannelSurface[];
}

export interface WorkspaceChannelRecord {
  id?: string;
  channel: string;
  enabled: boolean | null;
  automation_level: string | null;
  config?: unknown;
}

export interface EmailChannelRecord {
  id: string;
  email_address: string;
  provider: string;
  import_mode: string;
  last_sync_at: string | null;
  connected_at: string;
  workspace_id: string;
}

export interface ChannelProviderGroup {
  id: string;
  title: string;
  description: string;
  status: string;
  channelKeys: ChannelKey[];
}

export interface ChannelRoutingField {
  key: string;
  label: string;
  placeholder: string;
  helpText: string;
  required?: boolean;
}

export interface ChannelSetupProgress {
  requiredCount: number;
  completedCount: number;
  missingLabels: string[];
  isComplete: boolean;
}

const CHANNEL_ALIASES: Record<string, ChannelKey> = {
  email: 'email',
  sms: 'sms',
  whatsapp: 'whatsapp',
  facebook: 'facebook',
  messenger: 'facebook',
  instagram: 'instagram',
  google_business: 'google_business',
  'google-business': 'google_business',
  googlebusiness: 'google_business',
  google_business_messages: 'google_business',
  googlebusinessmessages: 'google_business',
  webchat: 'webchat',
  web_chat: 'webchat',
  web: 'webchat',
  chat: 'webchat',
  phone: 'phone',
  voice: 'phone',
  ai_phone: 'phone',
};

export const CHANNEL_DEFINITIONS: Record<ChannelKey, ChannelDefinition> = {
  email: {
    key: 'email',
    module: 'channels',
    label: 'Email',
    shortLabel: 'Email',
    description: 'Connect Gmail, Outlook, Apple Mail, or IMAP directly from BizzyBee.',
    setupMode: 'self_serve',
    surfaces: ['settings', 'dashboard', 'conversation'],
  },
  sms: {
    key: 'sms',
    module: 'channels',
    label: 'SMS',
    shortLabel: 'SMS',
    description: 'Text message communication through your business number.',
    onboardingNote: 'Best for urgent updates and short replies.',
    setupMode: 'provider_setup',
    surfaces: ['settings', 'dashboard', 'onboarding', 'conversation'],
  },
  whatsapp: {
    key: 'whatsapp',
    module: 'channels',
    label: 'WhatsApp',
    shortLabel: 'WhatsApp',
    description: 'WhatsApp Business messaging for quick customer replies.',
    onboardingNote: 'Popular for quick customer replies.',
    setupMode: 'provider_setup',
    surfaces: ['settings', 'dashboard', 'onboarding', 'conversation'],
  },
  facebook: {
    key: 'facebook',
    module: 'channels',
    label: 'Facebook Messenger',
    shortLabel: 'Facebook',
    description: 'Messages from your Facebook business page.',
    onboardingNote: 'Useful for enquiries from your page.',
    setupMode: 'account_linking',
    surfaces: ['settings', 'dashboard', 'onboarding', 'conversation'],
  },
  instagram: {
    key: 'instagram',
    module: 'channels',
    label: 'Instagram DMs',
    shortLabel: 'Instagram',
    description: 'Instagram Direct Messages for social-first customer contact.',
    onboardingNote: 'Ideal for service businesses on social.',
    setupMode: 'account_linking',
    surfaces: ['settings', 'dashboard', 'onboarding', 'conversation'],
  },
  google_business: {
    key: 'google_business',
    module: 'channels',
    label: 'Google Business Messages',
    shortLabel: 'Google Business',
    description:
      'Messages from your Google Business Profile. Reviews belong in the Reviews module.',
    onboardingNote: 'Messages work today. Review management is the next big module.',
    setupMode: 'account_linking',
    surfaces: ['settings', 'dashboard', 'onboarding', 'conversation'],
  },
  webchat: {
    key: 'webchat',
    module: 'channels',
    label: 'Web Chat',
    shortLabel: 'Web Chat',
    description: 'Website chat widget entry point for customer enquiries.',
    onboardingNote: 'Planned website entry point for live enquiries.',
    setupMode: 'coming_soon',
    surfaces: ['settings', 'dashboard', 'onboarding', 'conversation'],
  },
  phone: {
    key: 'phone',
    module: 'ai_phone',
    label: 'AI Phone',
    shortLabel: 'AI Phone',
    description: 'Voice conversations live in the separate AI Phone module.',
    setupMode: 'separate_module',
    surfaces: ['conversation'],
  },
};

export const CHANNEL_PROVIDER_GROUPS: ChannelProviderGroup[] = [
  {
    id: 'email',
    title: 'Email',
    description: 'Self-serve inside BizzyBee with real account linking and sync.',
    status: 'Self-serve in BizzyBee',
    channelKeys: ['email'],
  },
  {
    id: 'twilio',
    title: 'SMS & WhatsApp',
    description:
      'Workspace enablement happens in BizzyBee. Provider credentials and numbers still need operational setup.',
    status: 'Provider setup required',
    channelKeys: ['sms', 'whatsapp'],
  },
  {
    id: 'meta-google',
    title: 'Facebook, Instagram & Google Business',
    description:
      'These channels use account linking rather than just a toggle, and should share one managed setup flow.',
    status: 'Account linking required',
    channelKeys: ['facebook', 'instagram', 'google_business'],
  },
  {
    id: 'webchat',
    title: 'Web Chat',
    description:
      'The website widget is part of the Channels product, but it is not ready to self-serve yet.',
    status: 'Coming soon',
    channelKeys: ['webchat'],
  },
  {
    id: 'ai-phone',
    title: 'AI Phone',
    description: 'Voice uses a separate provisioning path and should be treated as its own module.',
    status: 'Separate provisioning',
    channelKeys: ['phone'],
  },
];

export const CHANNEL_ROUTING_FIELDS: Partial<Record<ChannelKey, ChannelRoutingField[]>> = {
  sms: [
    {
      key: 'phoneNumber',
      label: 'Business SMS number',
      placeholder: '+447700900123',
      helpText: 'Used to route inbound SMS to the right workspace.',
      required: true,
    },
  ],
  whatsapp: [
    {
      key: 'businessNumber',
      label: 'WhatsApp business number',
      placeholder: '+447700900123',
      helpText: 'Use the exact WhatsApp-enabled number connected to Twilio.',
      required: true,
    },
  ],
  facebook: [
    {
      key: 'pageId',
      label: 'Facebook Page ID',
      placeholder: '123456789012345',
      helpText: 'Used to match Messenger webhooks to this workspace.',
      required: true,
    },
  ],
  instagram: [
    {
      key: 'instagramAccountId',
      label: 'Instagram account ID',
      placeholder: '17841400000000000',
      helpText: 'Used to match Instagram DM events to this workspace.',
      required: true,
    },
  ],
  google_business: [
    {
      key: 'agentId',
      label: 'Google Business agent ID',
      placeholder: 'brands/123456/agents/654321',
      helpText: 'Used to match Google Business messaging events to this workspace.',
      required: true,
    },
    {
      key: 'placeId',
      label: 'Google place ID',
      placeholder: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      helpText: 'Optional extra routing identifier for a specific business location.',
      required: false,
    },
  ],
};

function hasMeaningfulConfigValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'number') {
    return true;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulConfigValue(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      hasMeaningfulConfigValue(entry),
    );
  }

  return false;
}

export function normalizeChannelKey(value: string | null | undefined): ChannelKey | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  return CHANNEL_ALIASES[normalized] ?? null;
}

export function getChannelDefinition(value: string | null | undefined): ChannelDefinition | null {
  const channelKey = normalizeChannelKey(value);
  return channelKey ? CHANNEL_DEFINITIONS[channelKey] : null;
}

export function getChannelDefinitionsForSurface(surface: ChannelSurface) {
  return Object.values(CHANNEL_DEFINITIONS).filter((definition) =>
    definition.surfaces.includes(surface),
  );
}

export function getChannelRoutingFields(value: string | null | undefined): ChannelRoutingField[] {
  const channelKey = normalizeChannelKey(value);
  return channelKey ? (CHANNEL_ROUTING_FIELDS[channelKey] ?? []) : [];
}

export function getMissingChannelRoutingFields(
  value: string | null | undefined,
  config: unknown,
): ChannelRoutingField[] {
  const routingFields = getChannelRoutingFields(value).filter((field) => field.required !== false);

  if (!routingFields.length) {
    return [];
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return routingFields;
  }

  const configObject = config as Record<string, unknown>;

  return routingFields.filter((field) => !hasMeaningfulConfigValue(configObject[field.key]));
}

export function getMissingChannelRoutingLabels(value: string | null | undefined, config: unknown) {
  return getMissingChannelRoutingFields(value, config).map((field) => field.label);
}

export function getChannelSetupProgress(
  value: string | null | undefined,
  config: unknown,
): ChannelSetupProgress {
  const requiredFields = getChannelRoutingFields(value).filter((field) => field.required !== false);
  const missingFields = getMissingChannelRoutingFields(value, config);

  return {
    requiredCount: requiredFields.length,
    completedCount: Math.max(requiredFields.length - missingFields.length, 0),
    missingLabels: missingFields.map((field) => field.label),
    isComplete: missingFields.length === 0,
  };
}

export function getChannelSetupDescription(
  definition: ChannelDefinition,
  state: ChannelConnectionState,
  config?: unknown,
) {
  const missingRoutingLabels = getMissingChannelRoutingLabels(definition.key, config);

  if (state === 'ready') {
    return 'This channel is configured and ready for live customer traffic.';
  }

  if (state === 'needs_connection') {
    if (missingRoutingLabels.length > 0) {
      return `BizzyBee still needs ${missingRoutingLabels.join(', ')} before it can route ${definition.shortLabel.toLowerCase()} traffic reliably.`;
    }

    return definition.setupMode === 'account_linking'
      ? 'The external business account still needs to be linked before this channel is fully ready.'
      : 'This channel still needs to be connected before traffic can flow reliably.';
  }

  if (state === 'provider_setup_required') {
    if (missingRoutingLabels.length > 0) {
      return `${missingRoutingLabels.join(', ')} still needs to be added for inbound routing.`;
    }

    return 'Provider-level credentials or business numbers still need operational setup.';
  }

  if (state === 'coming_soon') {
    return 'This entry point is part of the product direction, but it is not ready for self-serve activation yet.';
  }

  if (state === 'separate_module') {
    return 'This channel is managed through a separate product module.';
  }

  return 'Turn this channel on when your business is ready to use it.';
}

export function getChannelSetupActionLabel(
  definition: ChannelDefinition,
  state: ChannelConnectionState,
  config?: unknown,
) {
  const missingRoutingFields = getMissingChannelRoutingFields(definition.key, config);

  if (definition.key === 'email' && state === 'needs_connection') {
    return 'Connect email account';
  }

  if (missingRoutingFields.length === 1) {
    return `Add ${missingRoutingFields[0].label}`;
  }

  if (missingRoutingFields.length > 1) {
    return 'Add routing details';
  }

  if (state === 'needs_connection') {
    return definition.setupMode === 'account_linking' ? 'Link business account' : 'Connect channel';
  }

  if (state === 'provider_setup_required') {
    return 'Finish provider setup';
  }

  if (state === 'separate_module') {
    return 'Open separate module';
  }

  if (state === 'coming_soon') {
    return 'Planned rollout';
  }

  return 'Open setup';
}

export function deriveChannelConnectionState(
  definition: ChannelDefinition,
  record?: WorkspaceChannelRecord | null,
  emailConfigs: EmailChannelRecord[] = [],
): ChannelConnectionState {
  if (definition.setupMode === 'coming_soon') {
    return 'coming_soon';
  }

  if (definition.setupMode === 'separate_module') {
    return 'separate_module';
  }

  if (!record?.enabled) {
    return 'disabled';
  }

  if (definition.key === 'email') {
    return emailConfigs.length > 0 ? 'ready' : 'needs_connection';
  }

  const missingRoutingFields = getMissingChannelRoutingFields(definition.key, record?.config);
  if (missingRoutingFields.length > 0) {
    return definition.setupMode === 'provider_setup'
      ? 'provider_setup_required'
      : 'needs_connection';
  }

  if (definition.setupMode === 'provider_setup') {
    return hasMeaningfulConfigValue(record.config) ? 'ready' : 'provider_setup_required';
  }

  return hasMeaningfulConfigValue(record?.config) ? 'ready' : 'needs_connection';
}

export function getChannelConnectionLabel(
  definition: ChannelDefinition,
  state: ChannelConnectionState,
) {
  switch (state) {
    case 'disabled':
      return 'Disabled';
    case 'ready':
      return 'Ready';
    case 'needs_connection':
      return definition.setupMode === 'account_linking'
        ? 'Account linking needed'
        : 'Needs connection';
    case 'provider_setup_required':
      return 'Provider setup required';
    case 'coming_soon':
      return 'Coming soon';
    case 'separate_module':
      return 'Separate module';
    default:
      return 'Unknown';
  }
}

export function getChannelSettingsSection(
  value: string | null | undefined,
): ChannelSettingsSection {
  const channelKey = normalizeChannelKey(value);

  switch (channelKey) {
    case 'email':
      return 'email';
    case 'phone':
      return 'provider';
    default:
      return 'messaging';
  }
}

export function getChannelSetupHref(value: string | null | undefined) {
  const channelKey = normalizeChannelKey(value);
  const params = new URLSearchParams({
    category: 'connections',
    section: getChannelSettingsSection(value),
  });

  if (channelKey && channelKey !== 'email') {
    params.set('channel', channelKey);
  }

  return `/settings?${params.toString()}`;
}
