import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, TestTube } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const testScenarios = [
  {
    channel: 'sms' as const,
    customer_name: 'Sarah Johnson',
    customer_identifier: '+1-555-0123',
    message_content:
      'I need to speak to a human right now! This is urgent regarding my order #12345. The AI keeps giving me the wrong information!',
    priority: 'high',
    metadata: {
      ai_draft_response:
        "I understand you're frustrated with the information you've received about order #12345. I can see there's been some confusion in our conversation. Let me personally look into this right away and get you accurate information. Could you please give me 2-3 minutes to pull up your complete order history?",
    },
    conversation_context: [
      { role: 'customer', content: 'Where is my order #12345?' },
      {
        role: 'ai',
        content:
          "Hi Sarah! I'd be happy to help you track your order. Let me look that up for you. Order #12345 was shipped on November 15th and should arrive by November 20th.",
      },
      { role: 'customer', content: "That's not right. I ordered it 3 weeks ago, not last week!" },
      {
        role: 'ai',
        content:
          'I apologize for the confusion. Let me verify the order details again. Can you confirm the email address associated with your order?',
      },
      {
        role: 'customer',
        content: "sarah.j@email.com - but I don't need verification, I need answers!",
      },
      {
        role: 'ai',
        content:
          "I understand your frustration. I'm having difficulty accessing the complete order history. Let me escalate this to a human agent who can better assist you.",
      },
    ],
    n8n_workflow_id: 'sms-workflow-001',
  },
  {
    channel: 'whatsapp' as const,
    customer_name: 'Michael Chen',
    customer_identifier: '+1-555-0456',
    message_content:
      "Your AI assistant told me my refund was processed but my bank says otherwise. I've been waiting 2 weeks!",
    priority: 'high',
    metadata: {
      ai_draft_response:
        "I sincerely apologize for this concerning situation with your refund. This definitely requires immediate investigation with our finance team. I can see the refund was marked as processed on November 10th for $249.99. Let me reach out to our payment processor directly to trace this transaction and find out exactly where your money is. I'll prioritize this and get back to you within 24 hours with a definitive answer.",
    },
    conversation_context: [
      {
        role: 'customer',
        content: 'Hi, I returned my product last week. When will I get my refund?',
      },
      {
        role: 'ai',
        content:
          'Hello Michael! Thank you for reaching out. Refunds typically take 5-7 business days to process after we receive the returned item. Let me check the status of your return.',
      },
      { role: 'customer', content: 'You said that a week ago. Where is my money?' },
      {
        role: 'ai',
        content:
          'I apologize for the delay. According to our system, your refund of $249.99 was processed on November 10th. It should appear in your account within 3-5 business days.',
      },
      {
        role: 'customer',
        content: "It's been 2 weeks since November 10th! My bank has no record of this refund.",
      },
      {
        role: 'ai',
        content:
          "I understand this is frustrating. This situation requires immediate attention from our finance team. I'm connecting you with a specialist who can investigate this with your bank.",
      },
    ],
    n8n_workflow_id: 'whatsapp-workflow-001',
  },
  {
    channel: 'email' as const,
    customer_name: 'Jennifer Martinez',
    customer_identifier: 'jennifer.m@company.com',
    message_content:
      'I received a damaged product and the AI chatbot cannot process my return. I need a human to handle this warranty claim immediately.',
    priority: 'medium',
    metadata: {
      ai_draft_response:
        "I'm so sorry about the damaged laptop you received, Jennifer. I can see from your photos that the screen is indeed cracked and the packaging shows shipping damage. Since this is a high-value electronic item under warranty, I'll personally handle this case. I'm arranging for immediate pickup of the damaged unit and expediting a replacement laptop to you. You should receive shipping labels via email within the hour.",
    },
    conversation_context: [
      {
        role: 'customer',
        content: 'I received my laptop yesterday and the screen is cracked. I need to return it.',
      },
      {
        role: 'ai',
        content:
          "I'm sorry to hear about the damaged laptop, Jennifer. I can help you with the return process. To get started, could you please provide your order number?",
      },
      {
        role: 'customer',
        content: 'Order #LT-98765. The laptop was clearly damaged during shipping.',
      },
      {
        role: 'ai',
        content:
          "Thank you for providing that information. I've located your order. For damaged items, we'll need photos of the damage and the packaging. Can you send those?",
      },
      {
        role: 'customer',
        content: "I've attached 4 photos showing the cracked screen and damaged box.",
      },
      {
        role: 'ai',
        content:
          "Thank you for the photos. However, I'm unable to process warranty claims for electronics over $500. I'm escalating this to our warranty department for immediate assistance.",
      },
    ],
    n8n_workflow_id: 'email-workflow-001',
  },
  {
    channel: 'phone' as const,
    customer_name: 'Robert Williams',
    customer_identifier: '+1-555-0789',
    message_content:
      'Transcript: Customer is extremely upset about being billed twice. AI attempted to explain but customer demanded supervisor. Escalating immediately.',
    priority: 'high',
    metadata: {
      ai_draft_response:
        "Robert, I sincerely apologize for this billing error and for the frustration you've experienced. I can confirm there are two charges of $49.99 - one is your regular subscription, and one appears to be from a previous failed payment that processed incorrectly. I'm issuing an immediate refund for the duplicate charge, which should appear in your account within 24-48 hours. I'm also adding a $10 account credit as an apology for this inconvenience.",
    },
    conversation_context: [
      {
        role: 'ai',
        content:
          "Thank you for calling customer support. I'm Claude, your AI assistant. How can I help you today?",
      },
      {
        role: 'customer',
        content:
          'You charged me twice for my subscription! I see two charges of $49.99 on my card!',
      },
      {
        role: 'ai',
        content:
          'I sincerely apologize for this billing issue, Robert. Let me investigate this right away. Can you provide the last 4 digits of the card that was charged?',
      },
      { role: 'customer', content: '4532. This is unacceptable! I want a refund now!' },
      {
        role: 'ai',
        content:
          'I completely understand your frustration. I can see both charges here. One appears to be the monthly subscription and another seems to be from a previous failed payment that just processed.',
      },
      { role: 'customer', content: "I don't care about explanations! Get me a supervisor NOW!" },
      {
        role: 'ai',
        content:
          "Of course, I'm transferring you to a supervisor immediately. Please hold for just a moment.",
      },
    ],
    n8n_workflow_id: 'phone-workflow-001',
  },
  {
    channel: 'webchat' as const,
    customer_name: 'Emma Thompson',
    customer_identifier: 'emma.t.92@email.com',
    message_content:
      'The AI keeps giving me generic responses about my technical issue. I need actual technical support, not canned answers!',
    priority: 'medium',
    metadata: {
      ai_draft_response:
        "Emma, I apologize for the generic responses you've received. You're absolutely right that this requires specific technical expertise. The CSV export crash in version 3.2.1 is a known issue affecting certain data sets with special characters. Our development team is working on a patch for the next update. In the meantime, I can offer you a workaround: export to JSON format instead, or I can manually process your CSV export on our backend. Which would you prefer?",
    },
    conversation_context: [
      { role: 'customer', content: 'My app crashes every time I try to export data' },
      {
        role: 'ai',
        content: "I'm sorry you're experiencing this issue. Have you tried restarting the app?",
      },
      { role: 'customer', content: "Yes, obviously. I've restarted it 5 times." },
      {
        role: 'ai',
        content: 'Thank you for trying that. Have you checked if your app is up to date?',
      },
      {
        role: 'customer',
        content:
          "Yes! It's version 3.2.1, the latest one. The crash happens specifically when exporting to CSV format.",
      },
      {
        role: 'ai',
        content:
          "I understand you're using version 3.2.1. For technical issues like this, our troubleshooting steps include: 1) Clear cache 2) Reinstall app 3) Check device storage",
      },
      {
        role: 'customer',
        content:
          'Those are just generic steps! I need someone who actually understands the technical side of this app!',
      },
      {
        role: 'ai',
        content:
          'I apologize for not providing more specific assistance. Your technical issue with CSV exports requires expertise from our development support team. Let me connect you with a technical specialist.',
      },
    ],
    n8n_workflow_id: 'webchat-workflow-001',
  },
];

export const TestMessageGenerator = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const generateTestMessage = async (scenario: (typeof testScenarios)[0]) => {
    setLoading(true);
    try {
      // Call the receive-message edge function to trigger the full AI flow
      const messagePayload = {
        channel: scenario.channel,
        customer_identifier: scenario.customer_identifier,
        customer_name: scenario.customer_name,
        message_content: scenario.message_content,
        message_id: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        session_id: `test-session-${scenario.channel}-${Date.now()}`,
        // Add test flag
        test_message: true,
        test_priority: scenario.priority,
      };

      // receive-message edge function removed
      toast({
        title: 'Test message generator disabled',
        description: 'This test function has moved to the native automation pipeline.',
      });
      return;
    } catch (error: any) {
      console.error('Test message error:', error);
      toast({
        title: 'Error sending test message',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const generateAll = async () => {
    setLoading(true);
    try {
      let successCount = 0;
      for (const scenario of testScenarios) {
        try {
          await generateTestMessage(scenario);
          successCount++;
          // Add small delay between messages to avoid overwhelming the AI
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Failed to generate test for ${scenario.channel}:`, error);
        }
      }

      toast({
        title: 'Test messages sent',
        description: `Successfully sent ${successCount}/${testScenarios.length} test messages to AI agent`,
      });
      setOpen(false);
    } catch (error: any) {
      toast({
        title: 'Error generating tests',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <TestTube className="mr-2 h-4 w-4" />
          Test Messages
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test AI Agent Flow</DialogTitle>
          <DialogDescription>
            Send realistic customer messages to test the AI agent's response handling across
            different channels (SMS, WhatsApp, Email)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button onClick={generateAll} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating all scenarios...
              </>
            ) : (
              `Generate All ${testScenarios.length} Test Messages`
            )}
          </Button>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Or create individual scenarios:</p>
            <div className="space-y-2">
              {testScenarios.map((scenario, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {scenario.channel}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          scenario.priority === 'high'
                            ? 'bg-urgent/10 text-urgent'
                            : 'bg-warning/10 text-warning'
                        }`}
                      >
                        {scenario.priority} priority
                      </span>
                    </div>
                    <p className="text-sm font-medium">{scenario.customer_name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {scenario.message_content}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generateTestMessage(scenario)}
                    disabled={loading}
                  >
                    Create
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
