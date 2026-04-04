import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Eye, Edit, Download, Trash2, UserX } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';

export const AuditLogPanel = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useUserRole();

  useEffect(() => {
    if (isAdmin) {
      loadLogs();
    }
  }, [isAdmin]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_access_logs')
        .select('*, user:users(name, email), customer:customers(name, email)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      toast.error('Failed to load audit logs: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    const icons: Record<string, any> = {
      view: Eye,
      edit: Edit,
      export: Download,
      delete: Trash2,
      anonymize: UserX,
    };
    return icons[action] || Eye;
  };

  const getActionColor = (action: string) => {
    const colors: Record<string, string> = {
      view: 'default',
      edit: 'secondary',
      export: 'outline',
      delete: 'destructive',
      anonymize: 'destructive',
    };
    return colors[action] || 'default';
  };

  if (!isAdmin) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Admin access required to view audit logs
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Data Access Audit Logs</h3>
          <p className="text-sm text-muted-foreground">
            GDPR compliance: Track all access and modifications to customer data (Article 30)
          </p>
        </div>

        {logs.length === 0 && !loading && (
          <p className="text-center text-muted-foreground py-8">No audit logs yet</p>
        )}

        <div className="space-y-2">
          {logs.map((log) => {
            const Icon = getActionIcon(log.action);
            return (
              <div key={log.id} className="flex items-center gap-3 p-3 border rounded-lg text-sm">
                <Badge
                  variant={
                    getActionColor(log.action) as
                      | 'default'
                      | 'secondary'
                      | 'destructive'
                      | 'outline'
                  }
                  className="shrink-0"
                >
                  <Icon className="h-3 w-3 mr-1" />
                  {log.action.toUpperCase()}
                </Badge>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{log.user?.name || 'Unknown User'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    Customer: {log.customer?.name || 'Unknown'}
                  </p>
                </div>

                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <p>{new Date(log.created_at).toLocaleDateString()}</p>
                  <p>{new Date(log.created_at).toLocaleTimeString()}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
