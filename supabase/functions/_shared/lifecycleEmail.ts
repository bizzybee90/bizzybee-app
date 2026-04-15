import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

import {
  buildTransactionalEmailPayload,
  sendResendEmail,
  type TransactionalEmailKind,
} from './resend.ts';

type WorkspaceOwnerRow = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
};

type WorkspaceRow = {
  id: string;
  name: string | null;
  owner_id: string | null;
};

export async function loadWorkspaceLifecycleRecipient(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ workspace: WorkspaceRow | null; owner: WorkspaceOwnerRow | null }> {
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id, name, owner_id')
    .eq('id', workspaceId)
    .maybeSingle();

  if (workspaceError) {
    throw new Error(`Failed to resolve workspace: ${workspaceError.message}`);
  }

  if (!workspace) {
    return { workspace: null, owner: null };
  }

  const ownerQuery = workspace.owner_id
    ? supabase
        .from('users')
        .select('id, name, email, created_at')
        .eq('id', workspace.owner_id)
        .maybeSingle()
    : supabase
        .from('users')
        .select('id, name, email, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle();

  const { data: owner, error: ownerError } = await ownerQuery;
  if (ownerError) {
    throw new Error(`Failed to resolve workspace owner: ${ownerError.message}`);
  }

  return { workspace, owner };
}

export async function sendWorkspaceLifecycleEmail(params: {
  supabase: SupabaseClient;
  resendApiKey: string;
  workspaceId: string;
  kind: TransactionalEmailKind;
  appUrl: string;
  supportEmail: string;
  transactionalFrom: string;
  details?: string[];
  idempotencyKey?: string;
}): Promise<{
  sent: boolean;
  reason?: 'workspace_not_found' | 'recipient_not_found';
  messageId?: string | null;
}> {
  const { workspace, owner } = await loadWorkspaceLifecycleRecipient(
    params.supabase,
    params.workspaceId,
  );

  if (!workspace) {
    return { sent: false, reason: 'workspace_not_found' };
  }

  if (!owner?.email) {
    return { sent: false, reason: 'recipient_not_found' };
  }

  const fromName = params.transactionalFrom.split('<')[0]?.trim() || 'BizzyBee';
  const fromEmail = params.transactionalFrom.match(/<([^>]+)>/)?.[1]?.trim() || 'noreply@bizzyb.ee';

  const payload = buildTransactionalEmailPayload({
    kind: params.kind,
    recipientEmail: owner.email,
    recipientName: owner.name,
    workspaceName: workspace.name,
    appUrl: params.appUrl,
    supportEmail: params.supportEmail,
    fromName,
    fromEmail,
    replyTo: params.supportEmail,
    details: params.details,
  });

  const result = await sendResendEmail(params.resendApiKey, payload, {
    idempotencyKey: params.idempotencyKey,
  });

  return {
    sent: true,
    messageId: result.messageId,
  };
}
