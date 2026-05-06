import { Router, type IRouter } from "express";

const router: IRouter = Router();

const baseStyle = `
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:780px;margin:40px auto;padding:0 24px;color:#222;line-height:1.7;}
  h1{font-size:28px;border-bottom:2px solid #ff2741;padding-bottom:8px;}
  h2{font-size:18px;margin-top:32px;color:#ff2741;}
  p,li{font-size:14px;color:#444;}
  .meta{color:#888;font-size:12px;margin-bottom:24px;}
  a{color:#ff2741;}
`;

const APP_NAME = "LuLian Viral Suite (鹿联)";
const CONTACT = "lulianxiandao@gmail.com";
const OPERATOR = "an independent developer based in Singapore";
const TODAY = new Date().toISOString().slice(0, 10);

router.get("/static/terms.html", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Terms of Service · ${APP_NAME}</title><style>${baseStyle}</style></head><body>
<h1>Terms of Service</h1>
<p class="meta">Last updated: ${TODAY}</p>

<p>Welcome to ${APP_NAME} ("we", "our", "the Service"), operated by ${OPERATOR}. By accessing or using the Service, you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

<h2>1. Service Description</h2>
<p>${APP_NAME} is an AI-assisted content creation and multi-platform publishing tool. Users may connect their third-party social-media accounts (including TikTok, Facebook, Instagram, and Xiaohongshu) and use the Service to draft, schedule and publish content to those connected accounts.</p>

<h2>2. Account & Authorization</h2>
<ul>
  <li>You must have the legal right to operate any social-media account you connect to the Service.</li>
  <li>You authorize the Service to access, post to and read engagement metrics from connected accounts strictly for the features you enable.</li>
  <li>You may revoke authorization at any time from the Accounts page or from the third-party platform's own settings.</li>
</ul>

<h2>3. User Content</h2>
<p>You retain ownership of all content you create or upload. By using the Service, you grant us a limited license to store, process and transmit such content solely for the purpose of providing the Service to you.</p>

<h2>4. Acceptable Use</h2>
<ul>
  <li>No content that is illegal, defamatory, infringing, hateful, sexually explicit involving minors, or that violates the policies of the connected social-media platforms.</li>
  <li>No spam, automated mass account creation, vote manipulation, or fraudulent engagement.</li>
  <li>No reverse engineering, scraping, or attempting to bypass platform rate limits.</li>
</ul>

<h2>5. Third-Party Platforms</h2>
<p>The Service interacts with TikTok, Meta (Facebook & Instagram) and other platforms through their official APIs. Your use of those platforms remains subject to their own Terms of Service. We are not responsible for changes, outages or policy enforcement actions taken by those platforms.</p>

<h2>6. AI-Generated Content</h2>
<p>The Service uses third-party AI models to assist with content generation. You are solely responsible for reviewing and approving any AI-generated output before publishing.</p>

<h2>7. Fees & Credits</h2>
<p>Certain features consume credits. Credit packages are non-refundable except where required by law. We may modify pricing with reasonable advance notice.</p>

<h2>8. Termination</h2>
<p>We may suspend or terminate accounts that violate these Terms. You may delete your account at any time; upon deletion we will purge your stored credentials within 30 days, except where retention is required by law.</p>

<h2>9. Disclaimer & Limitation of Liability</h2>
<p>The Service is provided "as is" without warranty of any kind. To the maximum extent permitted by law, our aggregate liability for any claim shall not exceed the fees you paid for the Service in the prior 12 months.</p>

<h2>10. Governing Law</h2>
<p>These Terms are governed by the laws of Singapore, without regard to conflict-of-law principles.</p>

<h2>11. Contact</h2>
<p>Questions: <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</body></html>`);
});

router.get("/static/privacy.html", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Privacy Policy · ${APP_NAME}</title><style>${baseStyle}</style></head><body>
<h1>Privacy Policy</h1>
<p class="meta">Last updated: ${TODAY}</p>

<p>This Privacy Policy describes how ${APP_NAME} ("we"), operated by ${OPERATOR}, collects, uses and shares information when you use our content-creation and multi-platform publishing service (the "Service").</p>

<h2>1. Information We Collect</h2>
<ul>
  <li><strong>Account information:</strong> email, display name, profile image (via Clerk authentication).</li>
  <li><strong>Connected platform credentials:</strong> OAuth access tokens, refresh tokens, expiry timestamps, platform user IDs and usernames for TikTok, Facebook, Instagram and other connected services. We do <em>not</em> store your passwords for those platforms.</li>
  <li><strong>Content you create:</strong> drafts, captions, image/video uploads, scheduling preferences.</li>
  <li><strong>Engagement metrics:</strong> public likes/comments/views/keyword-rankings retrieved from the platforms, attached to content you have linked in the Service.</li>
  <li><strong>Usage telemetry:</strong> request logs, error reports, feature-usage events.</li>
</ul>

<h2>2. How We Use Information</h2>
<ul>
  <li>To authenticate users and operate the Service.</li>
  <li>To publish content to connected platforms on your explicit request.</li>
  <li>To display analytics and engagement metrics back to you.</li>
  <li>To improve the Service (aggregated/anonymized usage analysis).</li>
  <li>To respond to support inquiries.</li>
</ul>

<h2>3. Information We Share</h2>
<ul>
  <li><strong>Connected platforms:</strong> when you publish or read data, we send the necessary content/credentials to the relevant platform's official API (TikTok, Meta Graph, Ayrshare, etc.).</li>
  <li><strong>AI providers:</strong> drafts and prompts are sent to OpenAI / ByteDance Volcano Ark / other AI providers solely to generate the requested output.</li>
  <li><strong>Infrastructure providers:</strong> Replit (hosting), PostgreSQL (database), Replit Object Storage (file storage).</li>
  <li>We do <strong>not</strong> sell your personal information to third parties.</li>
</ul>

<h2>4. Data Retention</h2>
<p>We retain your data while your account is active. You may delete your account at any time; OAuth tokens and personal data are purged within 30 days of deletion. Backups are rotated within 90 days. Aggregated/anonymized analytics may be retained indefinitely.</p>

<h2>5. Security</h2>
<p>OAuth tokens are stored encrypted-at-rest in our database. All traffic to and from the Service uses TLS. Access to production data is restricted to authorized personnel.</p>

<h2>6. Your Rights</h2>
<p>You may at any time: (a) view your data via the Accounts and Settings pages; (b) revoke any connected social-media account's OAuth grant; (c) request deletion of your account by contacting us.</p>

<h2>7. International Transfers</h2>
<p>Our infrastructure is hosted on Replit (United States). By using the Service you consent to your data being processed in the United States and other jurisdictions where our service providers operate.</p>

<h2>8. Children</h2>
<p>The Service is not directed to children under 16. We do not knowingly collect data from children under 16.</p>

<h2>9. Changes</h2>
<p>We will post any changes to this Policy on this page and update the "Last updated" date.</p>

<h2>10. Contact</h2>
<p>Privacy inquiries: <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</body></html>`);
});

export default router;
