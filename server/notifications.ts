import { storage } from "./storage";

export interface AlertPayload {
  projectId: number;
  projectName: string;
  failedCount: number;
  totalCount: number;
  failedTestNames?: string[];
  deepLinkUrl: string;
  timestamp: string;
}

export async function sendAlert(payload: AlertPayload): Promise<{ channel: "openclaw" | "email" | "none"; error?: string }> {
  const config = await storage.getOpenclawConfig(payload.projectId);

  if (config.openclawWebhookUrl) {
    try {
      const body = {
        event: "test_run_failed",
        projectName: payload.projectName,
        failedCount: payload.failedCount,
        totalCount: payload.totalCount,
        failedTestNames: payload.failedTestNames ?? [],
        deepLinkUrl: payload.deepLinkUrl,
        timestamp: payload.timestamp,
        message: `❌ ${payload.projectName}: ${payload.failedCount}/${payload.totalCount} tests failed. View results: ${payload.deepLinkUrl}`,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(config.openclawWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`OpenClaw webhook returned ${response.status}: ${errorText}`);
      }

      console.log(`[notifications] Alert sent via OpenClaw for project ${payload.projectId}`);
      return { channel: "openclaw" };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[notifications] OpenClaw delivery failed, falling back to email: ${errorMessage}`);
      const emailResult = await sendEmailFallback(payload, config.alertEmail);
      return { channel: "email", error: errorMessage };
    }
  }

  const emailResult = await sendEmailFallback(payload, config.alertEmail);
  return emailResult;
}

async function sendEmailFallback(
  payload: AlertPayload,
  alertEmail: string | null
): Promise<{ channel: "email" | "none"; error?: string }> {
  if (!alertEmail) {
    console.log(`[notifications] No alert email configured for project ${payload.projectId}, skipping notification`);
    return { channel: "none" };
  }

  try {
    const nodemailer = await import("nodemailer");

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || "noreply@autotestai.com";

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn(`[notifications] SMTP not configured, skipping email fallback`);
      return { channel: "none", error: "SMTP not configured" };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const failedList = payload.failedTestNames && payload.failedTestNames.length > 0
      ? `\n\nFailed tests:\n${payload.failedTestNames.map((n) => `  - ${n}`).join("\n")}`
      : "";

    await transporter.sendMail({
      from: smtpFrom,
      to: alertEmail,
      subject: `❌ Test failure: ${payload.projectName} (${payload.failedCount}/${payload.totalCount} failed)`,
      text: `AutoTestAI detected test failures in project "${payload.projectName}".

Failed: ${payload.failedCount} of ${payload.totalCount} tests${failedList}

View results: ${payload.deepLinkUrl}

Timestamp: ${payload.timestamp}`,
    });

    console.log(`[notifications] Alert sent via email to ${alertEmail} for project ${payload.projectId}`);
    return { channel: "email" };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[notifications] Email delivery failed: ${errorMessage}`);
    return { channel: "none", error: errorMessage };
  }
}

export async function sendTestNotification(webhookUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const body = {
      event: "test_connection",
      message: "Test notification from AutoTestAI — your OpenClaw webhook is connected successfully!",
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return { success: false, error: `Webhook returned ${response.status}: ${errorText}` };
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error
      ? (err.name === "AbortError" ? "Request timed out after 10 seconds" : err.message)
      : String(err);
    return { success: false, error: errorMessage };
  }
}
