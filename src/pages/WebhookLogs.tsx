import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, RefreshCw, Code } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BackButton } from '@/components/shared/BackButton';

export default function WebhookLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('webhook_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      toast.error('Failed to load webhook logs: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (statusCode: number | null) => {
    if (!statusCode) return <Badge variant="outline">Pending</Badge>;
    if (statusCode >= 200 && statusCode < 300) return <Badge>Success</Badge>;
    if (statusCode >= 400 && statusCode < 500)
      return <Badge variant="destructive">Client Error</Badge>;
    if (statusCode >= 500) return <Badge variant="destructive">Server Error</Badge>;
    return <Badge variant="outline">{statusCode}</Badge>;
  };

  return (
    <div className="container mx-auto py-4 md:py-6 px-4 max-w-7xl">
      <div className="mb-4 md:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <BackButton to="/" label="Back to Dashboard" />
          <h1 className="text-2xl md:text-3xl font-bold mt-2">Webhook Logs</h1>
          <p className="text-sm text-muted-foreground mt-1 md:mt-2">
            Monitor webhook communications across the native automation pipeline
          </p>
        </div>
        <Button onClick={loadLogs} disabled={loading} size="sm" className="self-start sm:self-auto">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <div className="divide-y">
          {logs.length === 0 && !loading && (
            <div className="p-8 text-center text-muted-foreground">No webhook logs yet</div>
          )}

          {logs.map((log) => (
            <div
              key={log.id}
              className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => setSelectedLog(log)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {log.direction === 'inbound' ? (
                    <ArrowDown className="h-5 w-5 text-blue-500 shrink-0" />
                  ) : (
                    <ArrowUp className="h-5 w-5 text-green-500 shrink-0" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium capitalize">{log.direction}</span>
                      {getStatusBadge(log.status_code)}
                      {log.retry_count > 0 && (
                        <Badge variant="outline">Retry {log.retry_count}</Badge>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground truncate">
                      {new Date(log.created_at).toLocaleString()}
                    </p>

                    {log.error_message && (
                      <p className="text-sm text-destructive mt-1 truncate">
                        Error: {log.error_message}
                      </p>
                    )}
                  </div>
                </div>

                <Button variant="ghost" size="sm">
                  <Code className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Webhook Details</DialogTitle>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Request Payload</h4>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
                  {JSON.stringify(selectedLog.payload, null, 2)}
                </pre>
              </div>

              {selectedLog.response_payload && (
                <div>
                  <h4 className="font-medium mb-2">Response</h4>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
                    {JSON.stringify(selectedLog.response_payload, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.error_message && (
                <div>
                  <h4 className="font-medium mb-2 text-destructive">Error</h4>
                  <p className="bg-destructive/10 p-4 rounded-lg text-sm">
                    {selectedLog.error_message}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
