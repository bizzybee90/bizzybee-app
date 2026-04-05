import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Shield, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useUserRole } from '@/hooks/useUserRole';
import type { AppRole } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PanelNotice } from './PanelNotice';

interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: AppRole | null;
}

const roleLabels: Record<AppRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  reviewer: 'Reviewer',
};

const rolePriority: Record<AppRole, number> = {
  reviewer: 1,
  manager: 2,
  admin: 3,
};

export function WorkspaceAccessPanel() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const { role, loading: roleLoading, isAdmin } = useUserRole();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [claimingAdmin, setClaimingAdmin] = useState(false);

  const adminCount = useMemo(
    () => members.filter((member) => member.role === 'admin').length,
    [members],
  );
  const managersCount = useMemo(
    () => members.filter((member) => member.role === 'manager').length,
    [members],
  );
  const reviewersCount = useMemo(
    () => members.filter((member) => member.role === 'reviewer').length,
    [members],
  );
  const missingRoleCount = useMemo(
    () => members.filter((member) => !member.role).length,
    [members],
  );

  const loadMembers = useCallback(async () => {
    if (workspaceLoading || roleLoading) {
      return;
    }

    if (!workspace?.id) {
      setMembers([]);
      setCurrentUserId(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setCurrentUserId(user?.id ?? null);

      const { data: memberRows, error: memberError } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: true });

      if (memberError) {
        throw memberError;
      }

      const roleMap = new Map<string, AppRole>();

      if (isAdmin && memberRows && memberRows.length > 0) {
        const { data: roleRows, error: roleError } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .in(
            'user_id',
            memberRows.map((member) => member.id),
          );

        if (roleError) {
          throw roleError;
        }

        for (const roleRow of roleRows ?? []) {
          const nextRole = roleRow.role as AppRole;
          const currentRole = roleMap.get(roleRow.user_id);

          if (!currentRole || rolePriority[nextRole] > rolePriority[currentRole]) {
            roleMap.set(roleRow.user_id, nextRole);
          }
        }
      } else if (user?.id && role) {
        roleMap.set(user.id, role);
      }

      setMembers(
        (memberRows ?? []).map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: roleMap.get(member.id) ?? null,
        })),
      );
    } catch (error) {
      console.error('Error loading workspace access:', error);
      toast.error('Failed to load workspace access');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, role, roleLoading, workspace?.id, workspaceLoading]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleRoleChange = async (memberId: string, nextRole: AppRole) => {
    if (!isAdmin) {
      return;
    }

    const targetMember = members.find((member) => member.id === memberId);
    if (!targetMember || targetMember.role === nextRole) {
      return;
    }

    if (
      memberId === currentUserId &&
      targetMember.role === 'admin' &&
      nextRole !== 'admin' &&
      adminCount <= 1
    ) {
      toast.error('You need at least one admin in the workspace');
      return;
    }

    setSavingUserId(memberId);

    try {
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', memberId);

      if (deleteError) {
        throw deleteError;
      }

      const { error: insertError } = await supabase.from('user_roles').insert({
        user_id: memberId,
        role: nextRole,
      });

      if (insertError) {
        throw insertError;
      }

      setMembers((currentMembers) =>
        currentMembers.map((member) =>
          member.id === memberId ? { ...member, role: nextRole } : member,
        ),
      );
      window.dispatchEvent(new Event('bizzybee:role-changed'));

      toast.success(`Updated ${targetMember.name}'s access to ${roleLabels[nextRole]}`);
    } catch (error) {
      console.error('Error updating user role:', error);
      toast.error('Failed to update permissions');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleClaimAdmin = async () => {
    setClaimingAdmin(true);

    try {
      const { error } = await supabase.functions.invoke('claim-workspace-admin');

      if (error) {
        throw error;
      }

      window.dispatchEvent(new Event('bizzybee:role-changed'));
      await loadMembers();
      toast.success('Admin access claimed for this workspace');
    } catch (error) {
      console.error('Error claiming admin access:', error);
      toast.error(
        error instanceof Error ? error.message : 'Could not claim admin access for this workspace',
      );
    } finally {
      setClaimingAdmin(false);
    }
  };

  const scrollToPermissions = () => {
    document.getElementById('workspace-team-permissions')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  if (workspaceLoading || roleLoading || loading) {
    return (
      <Card className="flex items-center justify-center border-[0.5px] border-bb-border bg-bb-white p-6">
        <Loader2 className="h-5 w-5 animate-spin text-bb-warm-gray" />
      </Card>
    );
  }

  if (!workspace?.id) {
    return (
      <PanelNotice
        icon={Users}
        title="Finish setup to manage access"
        description="BizzyBee needs a workspace before team permissions and channels can be configured."
        actionLabel="Open onboarding"
        actionTo="/onboarding?reset=true"
      />
    );
  }

  const workspaceChecklist = [
    {
      label: 'Workspace exists',
      complete: Boolean(workspace?.id),
    },
    {
      label: 'At least one admin assigned',
      complete: adminCount > 0,
    },
    {
      label: 'Every teammate has a role',
      complete: missingRoleCount === 0,
    },
    {
      label: 'More than one operator can work the system',
      complete: managersCount + reviewersCount + adminCount > 1,
    },
  ];
  const nextWorkspaceStep =
    workspaceChecklist.find((item) => !item.complete)?.label ?? 'Workspace access is ready';
  const workspaceReadyForHandoff = workspaceChecklist.every((item) => item.complete);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="border-[0.5px] border-bb-border bg-bb-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
            Current access
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded-full bg-bb-linen p-2 text-bb-gold">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-bb-text">
                {role ? roleLabels[role] : 'No role assigned yet'}
              </p>
              <p className="text-sm text-bb-warm-gray">
                {role
                  ? 'Admins can change team permissions below.'
                  : 'Ask an admin to assign a role, or finish setup if this is a new workspace.'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-[0.5px] border-bb-border bg-bb-white p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
            Workspace
          </p>
          <div className="mt-3">
            <p className="text-sm font-medium text-bb-text">{workspace.name}</p>
            <p className="text-sm text-bb-warm-gray">
              {members.length} team {members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
        </Card>
      </div>

      <Card className="border-[0.5px] border-bb-border bg-bb-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
              Launch readiness
            </p>
            <h3 className="mt-2 text-sm font-medium text-bb-text">Workspace control center</h3>
          </div>
          <Badge
            className={
              workspaceChecklist.every((item) => item.complete)
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
            }
          >
            {workspaceChecklist.filter((item) => item.complete).length}/{workspaceChecklist.length}{' '}
            ready
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {workspaceChecklist.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3"
            >
              <span className="text-sm text-bb-text">{item.label}</span>
              <Badge
                className={
                  item.complete
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                    : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                }
              >
                {item.complete ? 'Ready' : 'Pending'}
              </Badge>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
          <p className="text-sm font-medium text-bb-text">Next workspace step</p>
          <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
            {nextWorkspaceStep === 'Workspace access is ready'
              ? 'Permissions and ownership are now in a good place for a production workspace.'
              : `${nextWorkspaceStep} is the next blocker before Workspace feels fully operational.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {missingRoleCount > 0 && isAdmin && (
              <Button size="sm" variant="outline" onClick={scrollToPermissions}>
                Assign missing roles
              </Button>
            )}
            {!isAdmin && (
              <Button asChild size="sm" variant="outline">
                <Link to="/onboarding?reset=true">Re-run setup wizard</Link>
              </Button>
            )}
            {workspaceReadyForHandoff && (
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                Internal handoff ready
              </Badge>
            )}
          </div>
        </div>
      </Card>

      <Card className="border-[0.5px] border-bb-border bg-bb-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
              Ownership
            </p>
            <h3 className="mt-2 text-sm font-medium text-bb-text">Workspace handoff</h3>
          </div>
          <Badge
            className={
              workspaceReadyForHandoff
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
            }
          >
            {workspaceReadyForHandoff ? 'Ready' : 'Needs attention'}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">Owner model</p>
            <p className="mt-2 text-sm text-bb-text">
              {adminCount > 0
                ? `${adminCount} admin${adminCount === 1 ? '' : 's'} can control access and launch settings.`
                : 'No admin is currently assigned.'}
            </p>
          </div>
          <div className="rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">Coverage</p>
            <p className="mt-2 text-sm text-bb-text">
              {members.length > 1
                ? `${members.length} teammates can now be coordinated through one workspace access model.`
                : 'Add at least one more operator so the workspace is not single-threaded.'}
            </p>
          </div>
          <div className="rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3">
            <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">Next blocker</p>
            <p className="mt-2 text-sm text-bb-text">
              {workspaceReadyForHandoff
                ? 'Workspace access is in a good place for launch.'
                : `${nextWorkspaceStep} is still the final blocker here.`}
            </p>
          </div>
        </div>
      </Card>

      {!isAdmin && (
        <PanelNotice
          icon={Shield}
          title="Only admins can change permissions"
          description="You can still see your current access here. An admin can update team roles from this panel, and a brand-new workspace with no admin can be claimed once."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleClaimAdmin}
                disabled={claimingAdmin}
              >
                {claimingAdmin && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Claim admin access
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/onboarding?reset=true">Re-run setup wizard</Link>
              </Button>
            </div>
          }
        />
      )}

      <Card
        id="workspace-team-permissions"
        className="border-[0.5px] border-bb-border bg-bb-white p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-bb-text">Team permissions</h3>
            <p className="mt-1 text-sm text-bb-warm-gray">
              Reviewer can work the inbox, manager can operate settings, admin can manage workspace
              access and channels.
            </p>
          </div>
          <Badge variant="outline" className="border-bb-border text-bb-warm-gray">
            {adminCount} {adminCount === 1 ? 'admin' : 'admins'}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Admins', value: adminCount },
            { label: 'Managers', value: managersCount },
            { label: 'Reviewers', value: reviewersCount },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3"
            >
              <p className="text-xs uppercase tracking-[0.12em] text-bb-warm-gray">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-bb-text">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex flex-col gap-3 rounded-xl border border-bb-border bg-bb-cream/40 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-bb-text">{member.name}</p>
                  {member.id === currentUserId && (
                    <Badge variant="secondary" className="bg-bb-linen text-bb-text">
                      You
                    </Badge>
                  )}
                </div>
                <p className="truncate text-sm text-bb-warm-gray">{member.email}</p>
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-2">
                  {savingUserId === member.id && (
                    <Loader2 className="h-4 w-4 animate-spin text-bb-warm-gray" />
                  )}
                  <Select
                    value={member.role ?? 'reviewer'}
                    onValueChange={(value) => handleRoleChange(member.id, value as AppRole)}
                  >
                    <SelectTrigger className="w-[160px] bg-bb-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reviewer">Reviewer</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Badge variant="outline" className="w-fit border-bb-border text-bb-warm-gray">
                  {member.role ? roleLabels[member.role] : 'Role hidden'}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
