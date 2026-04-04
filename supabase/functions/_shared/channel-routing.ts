interface ChannelRouteCandidates {
  raw?: string[];
  phone?: string[];
}

const normalizeText = (value: string) => value.trim().toLowerCase();

const normalizePhone = (value: string) =>
  value
    .replace(/^whatsapp:/i, '')
    .replace(/[^\d+]/g, '')
    .trim();

const collectStringValues = (value: unknown, values: string[] = []) => {
  if (typeof value === 'string') {
    values.push(value);
    return values;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, values);
    }
    return values;
  }

  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, values);
    }
  }

  return values;
};

const matchesChannelConfig = (config: unknown, candidates: ChannelRouteCandidates) => {
  const configValues = collectStringValues(config);
  if (configValues.length === 0) {
    return false;
  }

  const rawCandidates = new Set((candidates.raw || []).filter(Boolean).map(normalizeText));
  const phoneCandidates = new Set((candidates.phone || []).filter(Boolean).map(normalizePhone));

  return configValues.some((value) => {
    const normalizedText = normalizeText(value);
    const normalizedPhone = normalizePhone(value);

    return rawCandidates.has(normalizedText) || phoneCandidates.has(normalizedPhone);
  });
};

export async function resolveWorkspaceIdForChannel(
  supabase: any,
  channel: string,
  candidates: ChannelRouteCandidates,
  logPrefix: string,
) {
  const { data, error } = await supabase
    .from('workspace_channels')
    .select('workspace_id, config')
    .eq('channel', channel)
    .eq('enabled', true);

  if (error) {
    throw new Error(`Failed to load workspace channel config: ${error.message || 'unknown error'}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length === 1) {
    return data[0].workspace_id;
  }

  const matches = data.filter((row) => matchesChannelConfig(row.config, candidates));

  if (matches.length === 1) {
    return matches[0].workspace_id;
  }

  if (matches.length > 1) {
    console.error(
      `${logPrefix} Multiple workspace channel configs matched the same inbound identifier`,
      {
        channel,
        matchCount: matches.length,
      },
    );
    return null;
  }

  console.error(
    `${logPrefix} Multiple workspaces are enabled but none matched the inbound identifier`,
    {
      channel,
      workspaceCount: data.length,
    },
  );
  return null;
}
