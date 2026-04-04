import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';

export const DataDeletionPanel = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useUserRole();

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_deletion_requests')
        .select('*, customer:customers(name, email)')
        .order('requested_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error: any) {
      toast.error('Failed to load deletion requests: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string, customerId: string) => {
    if (
      !confirm(
        'Are you sure you want to approve this deletion request? This will anonymize all customer data.',
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      // Anonymize customer data
      const anonymizedName = `Deleted User ${Date.now()}`;
      await supabase
        .from('customers')
        .update({
          name: anonymizedName,
          email: `deleted_${Date.now()}@anonymized.local`,
          phone: null,
          notes: '[Data deleted per GDPR request]',
        })
        .eq('id', customerId);

      // Update request status
      await supabase
        .from('data_deletion_requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      // Log the deletion
      await supabase.from('data_access_logs').insert({
        customer_id: customerId,
        action: 'anonymize',
        metadata: { request_id: requestId },
      });

      toast.success('Customer data anonymized successfully');
      loadRequests();
    } catch (error: any) {
      toast.error('Failed to process deletion: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (requestId: string) => {
    setLoading(true);
    try {
      await supabase
        .from('data_deletion_requests')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', requestId);

      toast.success('Deletion request rejected');
      loadRequests();
    } catch (error: any) {
      toast.error('Failed to reject request: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      pending: { variant: 'outline', icon: Clock, label: 'Pending' },
      approved: { variant: 'default', icon: CheckCircle, label: 'Approved' },
      completed: { variant: 'default', icon: CheckCircle, label: 'Completed' },
      rejected: { variant: 'destructive', icon: XCircle, label: 'Rejected' },
    };
    const config = variants[status] || variants.pending;
    const Icon = config.icon;
    return (
      <Badge variant={config.variant as 'default' | 'secondary' | 'destructive' | 'outline'}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Data Deletion Requests</h3>
          <p className="text-sm text-muted-foreground">
            GDPR compliance: Manage customer data deletion requests (Right to Erasure - Article 17)
          </p>
        </div>

        {requests.length === 0 && !loading && (
          <p className="text-center text-muted-foreground py-8">No deletion requests</p>
        )}

        <div className="space-y-3">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex-1">
                <p className="font-medium">{request.customer?.name || 'Unknown'}</p>
                <p className="text-sm text-muted-foreground">{request.customer?.email}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Requested: {new Date(request.requested_at).toLocaleDateString()}
                </p>
                {request.reason && <p className="text-sm mt-2 italic">Reason: {request.reason}</p>}
              </div>

              <div className="flex items-center gap-2">
                {getStatusBadge(request.status)}
                {request.status === 'pending' && isAdmin && (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleApprove(request.id, request.customer_id)}
                      disabled={loading}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Approve & Anonymize
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReject(request.id)}
                      disabled={loading}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};
