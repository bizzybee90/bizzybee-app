import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RefreshCw,
  Building2,
  User,
  Mail,
  MessageSquare,
  HelpCircle,
  Mic,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface WorkspaceData {
  profile: Record<string, unknown> | null;
  emailConfig: Record<string, unknown>[] | null;
  voiceProfile: Record<string, unknown> | null;
  stats: {
    faqs: number;
    customers: number;
    conversations: number;
    emails: number;
  };
  recentConversations: Record<string, unknown>[] | null;
  onboardingStatus: Record<string, unknown> | null;
}

export function WorkspaceInspector() {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaceData = useCallback(async () => {
    if (!selectedWorkspace) return;

    setLoading(true);
    try {
      const [
        profileRes,
        emailConfigRes,
        voiceProfileRes,
        faqsRes,
        customersRes,
        conversationsRes,
        emailsRes,
        recentConversationsRes,
        userRes,
      ] = await Promise.all([
        supabase
          .from('business_profile')
          .select('*')
          .eq('workspace_id', selectedWorkspace)
          .maybeSingle(),
        supabase
          .from('email_provider_configs')
          .select('id, provider, email_address, created_at')
          .eq('workspace_id', selectedWorkspace),
        supabase
          .from('voice_profiles')
          .select('*')
          .eq('workspace_id', selectedWorkspace)
          .maybeSingle(),
        supabase
          .from('faq_database')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', selectedWorkspace),
        supabase
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', selectedWorkspace),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', selectedWorkspace),
        supabase
          .from('raw_emails')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', selectedWorkspace),
        supabase
          .from('conversations')
          .select('id, title, status, created_at, email_classification')
          .eq('workspace_id', selectedWorkspace)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('users')
          .select('onboarding_completed, onboarding_step')
          .eq('workspace_id', selectedWorkspace)
          .maybeSingle(),
      ]);

      setData({
        profile: profileRes.data,
        emailConfig: emailConfigRes.data,
        voiceProfile: voiceProfileRes.data,
        stats: {
          faqs: faqsRes.count || 0,
          customers: customersRes.count || 0,
          conversations: conversationsRes.count || 0,
          emails: emailsRes.count || 0,
        },
        recentConversations: recentConversationsRes.data,
        onboardingStatus: userRes.data,
      });
    } catch (error) {
      console.error('Error fetching workspace data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    if (selectedWorkspace) {
      void fetchWorkspaceData();
    }
  }, [fetchWorkspaceData, selectedWorkspace]);

  const fetchWorkspaces = async () => {
    const { data } = await supabase.from('workspaces').select('id, name').order('name');

    setWorkspaces(data || []);
    if (data && data.length > 0) {
      setSelectedWorkspace(data[0].id);
    }
  };

  const renderJson = (obj: Record<string, unknown> | null) => {
    if (!obj) return <p className="text-muted-foreground">No data</p>;
    return (
      <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
        {JSON.stringify(obj, null, 2)}
      </pre>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Workspace Inspector</CardTitle>
        <div className="flex items-center gap-4">
          <div className="w-64">
            <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
              <SelectTrigger>
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name || ws.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchWorkspaceData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="text-center py-8 text-muted-foreground">
            Select a workspace to inspect
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <Card className="bg-muted/30">
                <CardContent className="p-4 text-center">
                  <HelpCircle className="h-5 w-5 mx-auto mb-1 text-cyan-500" />
                  <p className="text-2xl font-bold">{data.stats.faqs}</p>
                  <p className="text-xs text-muted-foreground">FAQs</p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="p-4 text-center">
                  <User className="h-5 w-5 mx-auto mb-1 text-green-500" />
                  <p className="text-2xl font-bold">{data.stats.customers}</p>
                  <p className="text-xs text-muted-foreground">Customers</p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="p-4 text-center">
                  <MessageSquare className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-2xl font-bold">{data.stats.conversations}</p>
                  <p className="text-xs text-muted-foreground">Conversations</p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="p-4 text-center">
                  <Mail className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                  <p className="text-2xl font-bold">{data.stats.emails}</p>
                  <p className="text-xs text-muted-foreground">Raw Emails</p>
                </CardContent>
              </Card>
            </div>

            {/* Onboarding Status */}
            <div className="mb-6 p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-4 w-4" />
                <span className="font-medium">Onboarding Status</span>
                {data.onboardingStatus?.onboarding_completed ? (
                  <Badge className="bg-green-500/10 text-green-500">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Completed
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-500/10 text-yellow-500">
                    <XCircle className="h-3 w-3 mr-1" />
                    In Progress
                  </Badge>
                )}
              </div>
              {data.onboardingStatus?.onboarding_step && (
                <p className="text-sm text-muted-foreground">
                  Current step: {String(data.onboardingStatus.onboarding_step)}
                </p>
              )}
            </div>

            {/* Tabs for detailed data */}
            <Tabs defaultValue="profile">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="email">Email Config</TabsTrigger>
                <TabsTrigger value="voice">Voice Profile</TabsTrigger>
                <TabsTrigger value="conversations">Recent Convos</TabsTrigger>
                <TabsTrigger value="raw">Raw Data</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="mt-4">
                <ScrollArea className="h-[300px]">{renderJson(data.profile)}</ScrollArea>
              </TabsContent>

              <TabsContent value="email" className="mt-4">
                <ScrollArea className="h-[300px]">
                  {data.emailConfig && data.emailConfig.length > 0 ? (
                    <div className="space-y-2">
                      {data.emailConfig.map((config, idx) => (
                        <Card key={idx} className="bg-muted/30">
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              <span className="font-medium">
                                {String(config.email_address) || 'Unknown'}
                              </span>
                              <Badge variant="outline">{String(config.provider)}</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No email configured</p>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="voice" className="mt-4">
                <ScrollArea className="h-[300px]">
                  {data.voiceProfile ? (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Mic className="h-4 w-4" />
                        <span className="font-medium">Voice Profile</span>
                        <Badge className="bg-green-500/10 text-green-500">Active</Badge>
                      </div>
                      {renderJson(data.voiceProfile)}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No voice profile created</p>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="conversations" className="mt-4">
                <ScrollArea className="h-[300px]">
                  {data.recentConversations && data.recentConversations.length > 0 ? (
                    <div className="space-y-2">
                      {data.recentConversations.map((conv, idx) => (
                        <Card key={idx} className="bg-muted/30">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-sm line-clamp-1">
                                  {String(conv.title) || 'Untitled'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {String(conv.email_classification) || 'Unclassified'}
                                </p>
                              </div>
                              <Badge variant="outline">{String(conv.status)}</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No conversations</p>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <ScrollArea className="h-[300px]">
                  {renderJson(data as unknown as Record<string, unknown>)}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
}
