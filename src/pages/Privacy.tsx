import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-2 text-primary hover:underline mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to BizzyBee
        </Link>

        <div className="bg-card rounded-lg border p-8 space-y-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-muted-foreground">Last updated: January 2026</p>
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Introduction</h2>
            <p className="text-muted-foreground">
              BizzyBee ("we", "our", or "us") is an AI-powered email assistant for small businesses.
              This privacy policy explains how we collect, use, and protect your information when
              you use our service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">What Data We Collect</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">Account Information</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Email address</li>
                <li>Business name</li>
                <li>Business type</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Email Data (with your permission)</h3>
              <p className="text-muted-foreground mb-2">
                When you connect your Gmail account, we access:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>
                  <strong>Email messages</strong> - To learn your communication style and help draft
                  responses
                </li>
                <li>
                  <strong>Email metadata</strong> - Sender, recipient, subject lines, timestamps
                </li>
                <li>
                  <strong>Sent emails</strong> - To understand how you typically respond to
                  customers
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">What We Do NOT Collect</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Passwords (we use secure Google OAuth)</li>
                <li>Payment/financial information from emails</li>
                <li>Emails you haven't given us access to</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">How We Use Your Data</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">AI Training</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>We analyze your past email conversations to learn your writing style</li>
                <li>This includes your tone, common phrases, greetings, and sign-offs</li>
                <li>
                  This training is specific to YOUR account only - we don't share your style with
                  other users
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Email Assistance</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Draft responses that match your communication style</li>
                <li>Categorize incoming emails (quotes, complaints, bookings, etc.)</li>
                <li>Help you respond faster to customer inquiries</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Data Storage & Security</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">Where Data is Stored</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>All data is stored securely on our cloud database</li>
                <li>Servers are located in the EU/UK</li>
                <li>Data is encrypted in transit (HTTPS) and at rest</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Security Measures</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>OAuth 2.0 for secure Google authentication</li>
                <li>We never see or store your Google password</li>
                <li>Access tokens are encrypted</li>
                <li>Regular security reviews</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Data Sharing</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">We Do NOT Sell Your Data</h3>
              <p className="text-muted-foreground">
                Your email content and personal information are never sold to third parties.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">Limited Sharing</h3>
              <p className="text-muted-foreground mb-2">We only share data with:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>
                  <strong>Cloud Infrastructure</strong> - Database hosting
                </li>
                <li>
                  <strong>AI Providers</strong> - To generate AI responses (email content is
                  processed but not stored by them)
                </li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Your Rights</h2>

            <div>
              <h3 className="text-lg font-medium mb-2">Access & Control</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>
                  <strong>View your data</strong> - See what information we hold about you
                </li>
                <li>
                  <strong>Disconnect anytime</strong> - Revoke Gmail access through your Google
                  Account settings
                </li>
                <li>
                  <strong>Delete your data</strong> - Request complete deletion of your account and
                  all associated data
                </li>
                <li>
                  <strong>Export your data</strong> - Request a copy of your data
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">How to Disconnect Gmail</h3>
              <ol className="list-decimal list-inside text-muted-foreground space-y-1">
                <li>Go to your Google Account (myaccount.google.com)</li>
                <li>Security → Third-party apps with account access</li>
                <li>Find BizzyBee and click "Remove Access"</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">How to Delete Your Account</h3>
              <p className="text-muted-foreground">
                Email us at privacy@bizzyb.ee and we will delete all your data within 30 days.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Data Retention</h2>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                <strong>Active accounts</strong> - Data is retained while your account is active
              </li>
              <li>
                <strong>Deleted accounts</strong> - All data is permanently deleted within 30 days
                of account deletion
              </li>
              <li>
                <strong>Email content</strong> - Processed for AI training, then only
                summaries/patterns are retained
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Cookies</h2>
            <p className="text-muted-foreground mb-2">We use essential cookies only:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                <strong>Authentication</strong> - To keep you logged in
              </li>
              <li>
                <strong>Preferences</strong> - To remember your settings
              </li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We do not use advertising or tracking cookies.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">GDPR (For EU/UK Users)</h2>
            <p className="text-muted-foreground mb-2">Under GDPR, you have the right to:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Access your personal data</li>
              <li>Rectify inaccurate data</li>
              <li>Erase your data ("right to be forgotten")</li>
              <li>Restrict processing</li>
              <li>Data portability</li>
              <li>Object to processing</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              To exercise these rights, contact privacy@bizzyb.ee
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Google API Services User Data Policy</h2>
            <p className="text-muted-foreground">
              BizzyBee's use and transfer of information received from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Contact Us</h2>
            <p className="text-muted-foreground">
              If you have questions about this privacy policy or your data:
            </p>
            <p className="text-muted-foreground">
              <strong>Email:</strong> privacy@bizzyb.ee
            </p>
          </section>

          <section className="pt-4 border-t">
            <p className="text-sm text-muted-foreground italic">
              We may update this privacy policy from time to time. We will notify you of significant
              changes by email or through the app.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
