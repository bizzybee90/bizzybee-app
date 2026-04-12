import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { supabase } from '@/integrations/supabase/client';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Mail,
  Brain,
  FileText,
  Mic,
  Image,
  Users,
  Globe,
  Zap,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const TEST_WORKSPACE_ID = '81d18f85-1106-4a20-ab66-038870e3dc49';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
  response?: any;
  error?: string;
}

interface TestCategory {
  name: string;
  icon: React.ReactNode;
  tests: {
    name: string;
    function: string;
    payload: Record<string, any>;
    description: string;
  }[];
}

const TEST_CATEGORIES: TestCategory[] = [
  {
    name: 'Onboarding',
    icon: <Mail className="h-4 w-4" />,
    tests: [
      {
        name: 'Email Import',
        function: 'email-import',
        payload: { workspace_id: TEST_WORKSPACE_ID, import_mode: 'last_100', limit: 5 },
        description: 'Import emails from connected account',
      },
      {
        name: 'Email Classify',
        function: 'email-classify',
        payload: { workspace_id: TEST_WORKSPACE_ID },
        description: 'Classify email types in inbox',
      },
      {
        name: 'Voice Learn',
        function: 'voice-learn',
        payload: { workspace_id: TEST_WORKSPACE_ID },
        description: 'Analyze voice/tone from sent emails (needs 10+ sent emails)',
      },
      {
        name: 'Industry Keywords',
        function: 'industry-keywords',
        payload: { workspace_id: TEST_WORKSPACE_ID },
        description: 'Generate industry search keywords',
      },
      {
        name: 'Website Scrape',
        function: 'website-scrape',
        payload: { workspace_id: TEST_WORKSPACE_ID, website_url: 'https://example.com' },
        description: 'Scrape website for FAQs',
      },
      {
        name: 'Test Conversation',
        function: 'test-conversation',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          test_message: 'How much do you charge for a basic service?',
        },
        description: 'Test AI draft generation (needs voice profile)',
      },
    ],
  },
  {
    name: 'Core AI',
    icon: <Brain className="h-4 w-4" />,
    tests: [
      {
        name: 'Draft Verify',
        function: 'draft-verify',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          draft_text: 'Thanks for your inquiry. Our prices start at $50.',
          customer_message: 'What are your prices?',
        },
        description: 'Verify draft quality and facts',
      },
      {
        name: 'Learn Correction',
        function: 'learn-correction',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          original_draft: 'Thanks for asking!',
          edited_draft: 'Hi there! Thanks so much for reaching out.',
          conversation_id: null, // Requires real conversation_id
        },
        description: 'Learn from user corrections (needs real workspace)',
      },
      {
        name: 'Pattern Detect',
        function: 'pattern-detect',
        payload: { workspace_id: TEST_WORKSPACE_ID },
        description: 'Detect communication patterns',
      },
    ],
  },
  {
    name: 'Advanced',
    icon: <Zap className="h-4 w-4" />,
    tests: [
      {
        name: 'Customer Intelligence',
        function: 'customer-intelligence',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          customer_id: 'test-customer-1',
          action: 'analyze',
        },
        description: 'Generate customer insights',
      },
      {
        name: 'Document Process',
        function: 'document-process',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          document_id: 'test-doc-1',
          action: 'process',
        },
        description: 'Process uploaded document',
      },
      {
        name: 'Image Analyze',
        function: 'image-analyze',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          image_url:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png',
          customer_message: 'Can you give me a quote for this?',
        },
        description: 'Analyze image attachment',
      },
      {
        name: 'Audio Process',
        function: 'audio-process',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          audio_url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        },
        description: 'Transcribe voicemail',
      },
      {
        name: 'AI Inbox Summary',
        function: 'ai-inbox-summary',
        payload: { workspace_id: TEST_WORKSPACE_ID },
        description: 'Generate inbox summary',
      },
    ],
  },
  {
    name: 'Competitors',
    icon: <Users className="h-4 w-4" />,
    tests: [
      {
        name: 'Competitor Discover',
        function: 'competitor-discover',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          industry: 'cleaning services',
          location: 'London',
        },
        description: 'Discover competitor websites (needs business profile)',
      },
      {
        name: 'Competitor Scrape',
        function: 'competitor-scrape',
        payload: {
          workspace_id: TEST_WORKSPACE_ID,
          url: 'https://example-competitor.com',
        },
        description: 'Scrape competitor website',
      },
    ],
  },
];

export default function TestDashboard() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [isRunningAll, setIsRunningAll] = useState(false);

  const KEPT_FUNCTIONS = [
    'ai-enrich-conversation',
    'audio-process',
    'aurinko-auth-callback',
    'aurinko-auth-start',
    'aurinko-exchange-token',
    'aurinko-webhook',
    'check-consent',
    'classify-conversation',
    'create-consent',
    'document-process',
    'draft-verify',
    'email-send',
    'export-customer-data',
    'fetch-email-body',
    'gdpr-portal-request',
    'gdpr-portal-verify',
    'google-places-autocomplete',
    'image-analyze',
    'mark-email-read',
    'nuclear-reset',
    'pre-triage-rules',
    'refresh-aurinko-subscriptions',
    'request-deletion',
    'start-email-import',
    'start-faq-generation',
    'start-onboarding-discovery',
    'start-own-website-analysis',
    'withdraw-consent',
  ];

  const runTest = async (functionName: string, payload: Record<string, any>, testName: string) => {
    // Check if function is in the kept list
    if (!KEPT_FUNCTIONS.includes(functionName)) {
      setResults((prev) => ({
        ...prev,
        [testName]: {
          name: testName,
          status: 'error',
          duration: 0,
          error: `Function "${functionName}" is no longer part of the direct test surface`,
        },
      }));
      return;
    }

    setResults((prev) => ({
      ...prev,
      [testName]: { name: testName, status: 'running' },
    }));

    const startTime = Date.now();

    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: payload,
      });

      const duration = Date.now() - startTime;

      if (error) {
        setResults((prev) => ({
          ...prev,
          [testName]: {
            name: testName,
            status: 'error',
            duration,
            error: error.message,
          },
        }));
      } else {
        setResults((prev) => ({
          ...prev,
          [testName]: {
            name: testName,
            status: 'success',
            duration,
            response: data,
          },
        }));
      }
    } catch (err: any) {
      const duration = Date.now() - startTime;
      setResults((prev) => ({
        ...prev,
        [testName]: {
          name: testName,
          status: 'error',
          duration,
          error: err.message,
        },
      }));
    }
  };

  const runAllTests = async () => {
    setIsRunningAll(true);

    for (const category of TEST_CATEGORIES) {
      for (const test of category.tests) {
        await runTest(test.function, test.payload, test.name);
        // Small delay between tests
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    setIsRunningAll(false);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'running':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: TestResult['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'running':
        return (
          <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            Running
          </Badge>
        );
      case 'success':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Success
          </Badge>
        );
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  const totalTests = TEST_CATEGORIES.reduce((acc, cat) => acc + cat.tests.length, 0);
  const passedTests = Object.values(results).filter((r) => r.status === 'success').length;
  const failedTests = Object.values(results).filter((r) => r.status === 'error').length;

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="hidden md:flex border-r border-border bg-card">
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {/* Back Button */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to Dashboard</span>
          </Link>

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Test Dashboard</h1>
                  <Badge variant="outline" className="mt-1">
                    Development Only
                  </Badge>
                </div>
              </div>
              <p className="text-muted-foreground">
                Test all edge functions and verify they're working correctly
              </p>
            </div>
            <Button onClick={runAllTests} disabled={isRunningAll} className="gap-2">
              {isRunningAll ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run All Tests
                </>
              )}
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{totalTests}</p>
                <p className="text-xs text-muted-foreground">Total Tests</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{passedTests}</p>
                <p className="text-xs text-muted-foreground">Passed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-destructive">{failedTests}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-muted-foreground">
                  {totalTests - passedTests - failedTests}
                </p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
          </div>

          {/* Test Categories */}
          <Tabs defaultValue={TEST_CATEGORIES[0].name} className="space-y-4">
            <TabsList>
              {TEST_CATEGORIES.map((category) => (
                <TabsTrigger key={category.name} value={category.name} className="gap-2">
                  {category.icon}
                  {category.name}
                </TabsTrigger>
              ))}
            </TabsList>

            {TEST_CATEGORIES.map((category) => (
              <TabsContent key={category.name} value={category.name} className="space-y-4">
                {category.tests.map((test) => {
                  const result = results[test.name];

                  return (
                    <Card key={test.name}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {result ? (
                              getStatusIcon(result.status)
                            ) : (
                              <Clock className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div>
                              <CardTitle className="text-base">{test.name}</CardTitle>
                              <CardDescription className="text-xs">
                                {test.description} •{' '}
                                <code className="text-xs">{test.function}</code>
                              </CardDescription>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {result && (
                              <>
                                {getStatusBadge(result.status)}
                                {result.duration && (
                                  <span className="text-xs text-muted-foreground">
                                    {result.duration}ms
                                  </span>
                                )}
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => runTest(test.function, test.payload, test.name)}
                              disabled={result?.status === 'running'}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      {result && (result.response || result.error) && (
                        <CardContent className="pt-0">
                          <ScrollArea className="h-32 w-full rounded border bg-muted/30 p-3">
                            <pre className="text-xs">
                              {result.error
                                ? `Error: ${result.error}`
                                : JSON.stringify(result.response, null, 2)}
                            </pre>
                          </ScrollArea>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
