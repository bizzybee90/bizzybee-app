import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppRole } from '@/lib/types';
import { isPreviewModeEnabled } from '@/lib/previewMode';

const rolePriority: Record<AppRole, number> = {
  reviewer: 1,
  manager: 2,
  admin: 3,
};

export const useUserRole = () => {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isPreviewModeEnabled()) {
      setRole('admin');
      setLoading(false);
      return;
    }

    let isMounted = true;

    const fetchRole = async () => {
      if (isMounted) {
        setLoading(true);
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (isMounted) {
            setRole(null);
          }
          return;
        }

        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);

        if (error) {
          throw error;
        }

        const resolvedRole =
          (data ?? []).reduce<AppRole | null>((bestRole, row) => {
            const nextRole = row.role as AppRole;
            if (!bestRole || rolePriority[nextRole] > rolePriority[bestRole]) {
              return nextRole;
            }
            return bestRole;
          }, null) ?? null;

        if (isMounted) {
          setRole(resolvedRole);
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        if (isMounted) {
          setRole(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchRole();

    const handleRoleChanged = () => {
      void fetchRole();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void fetchRole();
    });

    window.addEventListener('bizzybee:role-changed', handleRoleChanged);

    return () => {
      isMounted = false;
      window.removeEventListener('bizzybee:role-changed', handleRoleChanged);
      subscription.unsubscribe();
    };
  }, []);

  return {
    role,
    loading,
    isAdmin: role === 'admin',
    isManager: role === 'manager' || role === 'admin',
    isReviewer: !!role,
  };
};
