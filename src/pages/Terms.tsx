import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-2 text-primary hover:underline mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to BizzyBee
        </Link>

        <div className="bg-card rounded-lg border p-8 space-y-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
            <p className="text-muted-foreground">Last updated: January 2026</p>
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">1. Agreement to Terms</h2>
            <p className="text-muted-foreground">
              By accessing or using BizzyBee ("the Service"), you agree to be bound by these Terms
              of Service. If you disagree with any part of these terms, you may not access the
              Service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">2. Description of Service</h2>
            <p className="text-muted-foreground mb-2">
              BizzyBee is an AI-powered email assistant that helps small businesses manage customer
              communications. The Service:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Connects to your email account (with your permission)</li>
              <li>Analyzes your communication style</li>
              <li>Drafts email responses for your review</li>
              <li>Helps organize and prioritize customer inquiries</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">3. Account Registration</h2>
            <div>
              <h3 className="text-lg font-medium mb-2">Requirements</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>You must be at least 18 years old</li>
                <li>You must provide accurate information</li>
                <li>You are responsible for maintaining account security</li>
                <li>One account per business</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">4. Acceptable Use</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">You May</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Use BizzyBee for legitimate business email management</li>
                <li>Connect business email accounts you own or are authorized to use</li>
                <li>Review and edit AI-generated responses before sending</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">You May Not</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Use the Service for spam or bulk unsolicited emails</li>
                <li>Attempt to reverse-engineer or copy our AI systems</li>
                <li>Share account access with unauthorized users</li>
                <li>Use the Service for illegal purposes</li>
                <li>Abuse, harass, or send harmful content through the Service</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">5. Email Access & Permissions</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">What You're Granting</h3>
              <p className="text-muted-foreground mb-2">
                When you connect your email account, you grant BizzyBee permission to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Read your email messages</li>
                <li>Send emails on your behalf (only when you approve)</li>
                <li>Access email metadata</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Your Control</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>You can disconnect your email at any time</li>
                <li>You review all AI-drafted emails before sending</li>
                <li>We never send emails without your explicit approval</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">6. AI-Generated Content</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">No Guarantee of Accuracy</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>AI responses are suggestions, not final communications</li>
                <li>Always review before sending</li>
                <li>You are responsible for emails sent from your account</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">7. Intellectual Property</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">Our Property</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>BizzyBee software, AI models, and branding are our property</li>
                <li>You may not copy, modify, or distribute our technology</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Your Property</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Your emails and business data remain yours</li>
                <li>We do not claim ownership of your content</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">8. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. TO THE MAXIMUM EXTENT
              PERMITTED BY LAW, WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
              DAMAGES.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">9. Termination</h2>
            <p className="text-muted-foreground mb-2">
              You may cancel anytime through your account settings or by emailing support@bizzyb.ee.
            </p>
            <p className="text-muted-foreground">
              We may terminate accounts that violate these Terms or engage in abusive behavior.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">10. Governing Law</h2>
            <p className="text-muted-foreground">
              These Terms are governed by the laws of England and Wales.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">11. Contact Us</h2>
            <p className="text-muted-foreground">Questions about these Terms? Contact us:</p>
            <p className="text-muted-foreground">
              <strong>Email:</strong> support@bizzyb.ee
            </p>
          </section>

          <section className="pt-4 border-t">
            <p className="text-sm text-muted-foreground italic">
              We may update these Terms from time to time. We will notify you of material changes
              via email or through the Service. Continued use after changes constitutes acceptance.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
