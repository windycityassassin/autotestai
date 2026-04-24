import { db } from "./db";
import {
  waitlist, type Waitlist, type InsertWaitlist,
  users, type User, type InsertUser,
  projects, type Project, type InsertProject,
  generatedTests, type GeneratedTest, type InsertGeneratedTest,
  testRuns, type TestRun,
  projectMemory, type ProjectMemory, type InsertProjectMemory,
  scheduledRunLog, type ScheduledRunLog, type InsertScheduledRunLog,
} from "@shared/schema";
import { eq, ne, and, sql, desc, ilike, or, inArray, gte } from "drizzle-orm";

export interface IStorage {
  addToWaitlist(entry: InsertWaitlist): Promise<Waitlist>;
  getWaitlistCount(): Promise<number>;
  isEmailOnWaitlist(email: string): Promise<boolean>;

  createUser(data: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  updateUserBilling(id: number, data: { stripeCustomerId?: string; stripeSubscriptionId?: string; plan?: string }): Promise<User>;
  getRunCountThisMonth(userId: number): Promise<number>;

  getProjectsByUser(userId: number): Promise<Project[]>;
  getProjectById(id: number): Promise<Project | undefined>;
  createProject(userId: number, data: InsertProject): Promise<Project>;
  createDemoProject(userId: number): Promise<Project>;
  deleteProject(id: number): Promise<void>;
  updateProjectMonitoring(id: number, data: {
    monitoringSchedule?: string;
    webhookSecret?: string;
    monitoringPaused?: boolean;
    lastScheduledRunAt?: Date;
  }): Promise<Project>;
  getProjectsDueForMonitoring(): Promise<Project[]>;
  getOpenclawConfig(projectId: number): Promise<{ openclawWebhookUrl: string | null; alertEmail: string | null }>;
  setOpenclawConfig(projectId: number, openclawWebhookUrl: string | null, alertEmail?: string | null): Promise<void>;

  getGeneratedTestsByProject(projectId: number): Promise<GeneratedTest[]>;
  getGeneratedTestsByProjectId(projectId: number): Promise<GeneratedTest[]>;
  getGeneratedTestById(id: number): Promise<GeneratedTest | undefined>;
  createGeneratedTest(data: InsertGeneratedTest): Promise<GeneratedTest>;
  updateGeneratedTest(id: number, data: Partial<InsertGeneratedTest> & { review?: unknown }): Promise<GeneratedTest>;
  deleteGeneratedTest(id: number): Promise<void>;

  getTestRunsByTest(generatedTestId: number): Promise<TestRun[]>;
  getTestRunById(id: number): Promise<TestRun | undefined>;
  createTestRun(generatedTestId: number, trigger?: string): Promise<TestRun>;
  updateTestRun(id: number, data: {
    status?: string;
    output?: string;
    passedCount?: number;
    failedCount?: number;
    totalCount?: number;
    completedAt?: Date;
    healAttempts?: number;
    healLog?: string;
    healed?: boolean;
    healedVia?: string;
  }): Promise<TestRun>;

  getMemoryByProject(projectId: number): Promise<ProjectMemory[]>;
  searchMemoryByText(projectId: number, query: string, limit?: number): Promise<ProjectMemory[]>;
  upsertMemory(data: InsertProjectMemory): Promise<ProjectMemory>;
  upsertMemoryItem(projectId: number, type: string, pattern: string, selector: string, confidenceDelta?: number): Promise<ProjectMemory>;
  deleteMemory(id: number): Promise<void>;
  compactMemory(projectId: number): Promise<number>;
  createScheduledRunLog(data: InsertScheduledRunLog): Promise<ScheduledRunLog>;
  getScheduledRunLogsByProject(projectId: number, limit?: number): Promise<ScheduledRunLog[]>;
}

export class DatabaseStorage implements IStorage {
  async addToWaitlist(entry: InsertWaitlist): Promise<Waitlist> {
    const [result] = await db.insert(waitlist).values(entry).returning();
    return result;
  }

  async getWaitlistCount(): Promise<number> {
    const result = await db.select().from(waitlist);
    return result.length;
  }

  async isEmailOnWaitlist(email: string): Promise<boolean> {
    const [result] = await db.select().from(waitlist).where(eq(waitlist.email, email));
    return !!result;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [result] = await db.insert(users).values(data).returning();
    return result;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [result] = await db.select().from(users).where(eq(users.email, email));
    return result;
  }

  async getUserById(id: number): Promise<User | undefined> {
    const [result] = await db.select().from(users).where(eq(users.id, id));
    return result;
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const [result] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return result;
  }

  async updateUserBilling(id: number, data: { stripeCustomerId?: string; stripeSubscriptionId?: string; plan?: string }): Promise<User> {
    const [result] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return result;
  }

  async getRunCountThisMonth(userId: number): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
    if (userProjects.length === 0) return 0;
    const projectIds = userProjects.map((p) => p.id);
    const allTests = await db.select().from(generatedTests)
      .where(inArray(generatedTests.projectId, projectIds));
    if (allTests.length === 0) return 0;
    const testIds = allTests.map((t) => t.id);
    const runs = await db.select().from(testRuns)
      .where(and(
        inArray(testRuns.generatedTestId, testIds),
        gte(testRuns.startedAt, startOfMonth),
      ));
    return runs.length;
  }

  async getProjectsByUser(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId));
  }

  async getProjectById(id: number): Promise<Project | undefined> {
    const [result] = await db.select().from(projects).where(eq(projects.id, id));
    return result;
  }

  async createProject(userId: number, data: InsertProject): Promise<Project> {
    const [result] = await db.insert(projects).values({ ...data, userId }).returning();
    return result;
  }

  async createDemoProject(userId: number): Promise<Project> {
    const [result] = await db.insert(projects).values({
      userId,
      name: "Twenty CRM",
      url: "https://app.twenty.com",
      description: "Official AutoTestAI demo playground — the open-source Salesforce alternative.",
      isDemo: true,
      monitoringSchedule: "hourly",
      lastScheduledRunAt: new Date(Date.now() - 42 * 60 * 1000),
    }).returning();
    await this.seedDemoData(result.id);
    return result;
  }

  async seedDemoData(projectId: number): Promise<void> {
    const existing = await db.select().from(generatedTests).where(eq(generatedTests.projectId, projectId));
    if (existing.length > 0) return;

    const now = Date.now();
    const min = (m: number) => new Date(now - m * 60 * 1000);
    const hr = (h: number) => new Date(now - h * 60 * 60 * 1000);
    const day = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

    const loginTestCode = `import { test, expect } from '@playwright/test';

test('login flow with valid credentials', async ({ page }) => {
  await page.goto('https://app.twenty.com');
  await page.fill('input[name="email"]', 'demo@twenty.com');
  await page.fill('input[name="password"]', 'TwentyDemo2026');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*objects\\/people/);
  await expect(page.locator('[data-testid="sidebar-nav"]')).toBeVisible();
});`;

    const contactTestCode = `import { test, expect } from '@playwright/test';

test('create a new contact', async ({ page }) => {
  await page.goto('https://app.twenty.com/objects/people');
  await page.click('button:has-text("Add Person")');
  await page.fill('input[name="firstName"]', 'Ada');
  await page.fill('input[name="lastName"]', 'Lovelace');
  await page.fill('input[name="email"]', 'ada@analytical.engine');
  await page.click('button:has-text("Save")');
  await expect(page.locator('text=Ada Lovelace')).toBeVisible();
});`;

    const searchTestCode = `import { test, expect } from '@playwright/test';

test('search filters People list', async ({ page }) => {
  await page.goto('https://app.twenty.com/objects/people');
  const initialCount = await page.locator('[data-testid="row-person"]').count();
  await page.fill('input[placeholder="Search..."]', 'Ada');
  await page.waitForTimeout(400);
  const filteredCount = await page.locator('[data-testid="row-person"]').count();
  expect(filteredCount).toBeLessThan(initialCount);
  expect(filteredCount).toBeGreaterThan(0);
});`;

    const [test1] = await db.insert(generatedTests).values({
      projectId, framework: "playwright",
      title: "Login flow with valid credentials",
      prompt: "Test the login flow with valid demo credentials and verify the user lands on the People page",
      url: "https://app.twenty.com",
      code: loginTestCode,
      review: { score: 92, flags: [{ level: "green", message: "All selectors verified against live DOM" }] },
    }).returning();

    const [test2] = await db.insert(generatedTests).values({
      projectId, framework: "playwright",
      title: "Create a new contact",
      prompt: "Test creating a new person in the CRM with first name, last name, and email",
      url: "https://app.twenty.com/objects/people",
      code: contactTestCode,
      review: { score: 88, flags: [
        { level: "green", message: "Form fields use semantic name attributes" },
        { level: "yellow", message: "Consider asserting the new contact persists after page reload" },
      ]},
    }).returning();

    const [test3] = await db.insert(generatedTests).values({
      projectId, framework: "playwright",
      title: "Search filters People list",
      prompt: "Test that typing in the search bar filters the People list down to matching results",
      url: "https://app.twenty.com/objects/people",
      code: searchTestCode,
      review: { score: 85, flags: [
        { level: "green", message: "Compares row counts before and after filter" },
        { level: "yellow", message: "Hardcoded 400ms debounce wait — consider waitForResponse" },
      ]},
    }).returning();

    // Test runs — mix of pass / heal / fail
    const healLog = `[heal:01] Test failed — selector 'input[name="password"]' not found
[heal:02] Re-inspecting page DOM at https://app.twenty.com
[heal:03] Discovered: Twenty renamed password input to data-testid="auth-password"
[heal:04] Patching test code: input[name="password"] → [data-testid="auth-password"]
[heal:05] Re-running with patched selector...
[heal:06] PASS — 1 assertion, 0 failures, recovered in 14.2s
[heal:07] Memory updated: anti_pattern recorded, new selector cached`;

    await db.insert(testRuns).values([
      { generatedTestId: test1.id, status: "passed", passedCount: 2, failedCount: 0, totalCount: 2, output: "✓ login flow with valid credentials (3.4s)\n  ✓ navigates to /objects/people\n  ✓ sidebar visible", startedAt: hr(2), completedAt: new Date(hr(2).getTime() + 3400), trigger: "manual" },
      { generatedTestId: test1.id, status: "passed", passedCount: 2, failedCount: 0, totalCount: 2, output: "✓ login flow with valid credentials (3.1s)", startedAt: hr(8), completedAt: new Date(hr(8).getTime() + 3100), trigger: "kairos" },
      { generatedTestId: test1.id, status: "passed", passedCount: 2, failedCount: 0, totalCount: 2, output: "✓ login flow (after self-heal — 14.2s total)\nHealed: input[name=\"password\"] → [data-testid=\"auth-password\"]", startedAt: day(1), completedAt: new Date(day(1).getTime() + 14200), trigger: "kairos", healed: true, healAttempts: 1, healLog, healedVia: "selector_swap" },
      { generatedTestId: test2.id, status: "passed", passedCount: 1, failedCount: 0, totalCount: 1, output: "✓ create a new contact (5.8s)", startedAt: hr(4), completedAt: new Date(hr(4).getTime() + 5800), trigger: "manual" },
      { generatedTestId: test2.id, status: "passed", passedCount: 1, failedCount: 0, totalCount: 1, output: "✓ create a new contact (5.5s)", startedAt: day(2), completedAt: new Date(day(2).getTime() + 5500), trigger: "kairos" },
      { generatedTestId: test3.id, status: "passed", passedCount: 1, failedCount: 0, totalCount: 1, output: "✓ search filters list (2.1s) — 47 → 1 row", startedAt: hr(6), completedAt: new Date(hr(6).getTime() + 2100), trigger: "manual" },
      { generatedTestId: test3.id, status: "failed", passedCount: 0, failedCount: 1, totalCount: 1, output: "✗ search filters list\n  Error: Expected count > 0 after filter, got 0\n  Likely: search debounce changed or input selector renamed", startedAt: min(35), completedAt: new Date(min(35).getTime() + 2400), trigger: "kairos" },
    ]);

    // Project memory — verified selectors and learned patterns
    await db.insert(projectMemory).values([
      { projectId, type: "selector", pattern: "login_email_input", selector: 'input[name="email"]', confidence: 1.0, tags: ["auth", "verified"] },
      { projectId, type: "selector", pattern: "login_password_input", selector: '[data-testid="auth-password"]', confidence: 0.95, tags: ["auth", "healed"] },
      { projectId, type: "selector", pattern: "login_submit_button", selector: 'button[type="submit"]', confidence: 1.0, tags: ["auth"] },
      { projectId, type: "selector", pattern: "sidebar_nav", selector: '[data-testid="sidebar-nav"]', confidence: 1.0, tags: ["layout"] },
      { projectId, type: "selector", pattern: "person_row", selector: '[data-testid="row-person"]', confidence: 1.0, tags: ["people"] },
      { projectId, type: "selector", pattern: "search_input", selector: 'input[placeholder="Search..."]', confidence: 0.9, tags: ["people"] },
      { projectId, type: "selector", pattern: "add_person_button", selector: 'button:has-text("Add Person")', confidence: 1.0, tags: ["people"] },
      { projectId, type: "anti_pattern", pattern: "broken:login_password_input", selector: 'input[name="password"]', confidence: 1.0, tags: ["broken", "renamed_2026-04"] },
      { projectId, type: "pattern", pattern: "passmark_step:fill login form with demo credentials", selector: "fill login form with demo credentials", confidence: 1.0, tags: ["passmark"] },
      { projectId, type: "pattern", pattern: "passmark_assertion:user lands on /objects/people after login", selector: "user lands on /objects/people after login", confidence: 1.0, tags: ["passmark"] },
    ]);

    // KAIROS scheduled monitoring logs
    await db.insert(scheduledRunLog).values([
      { projectId, trigger: "hourly", testsEvaluated: { ranked: [{ id: test1.id, risk: 0.62 }, { id: test2.id, risk: 0.31 }, { id: test3.id, risk: 0.78 }], rationale: "search test failed last cycle — high risk" }, testsRun: 3, passed: 2, failed: 1, notificationSent: true, triggeredAt: min(35) as any },
      { projectId, trigger: "hourly", testsEvaluated: { ranked: [{ id: test1.id, risk: 0.18 }, { id: test2.id, risk: 0.22 }, { id: test3.id, risk: 0.41 }], rationale: "stable cycle, no recent failures" }, testsRun: 3, passed: 3, failed: 0, notificationSent: false, triggeredAt: hr(2) as any },
      { projectId, trigger: "hourly", testsEvaluated: { ranked: [{ id: test1.id, risk: 0.20 }] }, testsRun: 1, passed: 1, failed: 0, notificationSent: false, triggeredAt: hr(8) as any },
      { projectId, trigger: "hourly", testsEvaluated: { ranked: [{ id: test1.id, risk: 0.71 }], rationale: "selector renamed — heal triggered" }, testsRun: 1, passed: 1, failed: 0, notificationSent: true, triggeredAt: day(1) as any, dreamSummary: "Self-heal recovered login test after Twenty renamed password input from name='password' to data-testid='auth-password'. Selector cached for future runs. Pass rate restored to 100%." },
      { projectId, trigger: "weekly_dream", testsEvaluated: { ranked: [] }, testsRun: 0, passed: 0, failed: 0, notificationSent: false, triggeredAt: day(7) as any, dreamSummary: "Weekly review: 21 runs, 19 passed (90.5%), 1 self-heal succeeded (login). 1 active anti-pattern flagged (input[name='password'] removed in Twenty 0.43)." },
    ]);
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async updateProjectMonitoring(id: number, data: {
    monitoringSchedule?: string;
    webhookSecret?: string;
    monitoringPaused?: boolean;
    lastScheduledRunAt?: Date;
  }): Promise<Project> {
    const [result] = await db.update(projects)
      .set(data)
      .where(eq(projects.id, id))
      .returning();
    return result;
  }

  async getProjectsDueForMonitoring(): Promise<Project[]> {
    const now = new Date();
    const allMonitored = await db.select().from(projects)
      .where(and(
        ne(projects.monitoringSchedule, "off"),
        eq(projects.monitoringPaused, false),
      ));

    return allMonitored.filter((p) => {
      const schedule = p.monitoringSchedule;
      const last = p.lastScheduledRunAt;
      if (!last) return true;
      const intervalMs = schedule === "hourly" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      return now.getTime() - last.getTime() >= intervalMs;
    });
  }

  async getOpenclawConfig(projectId: number): Promise<{ openclawWebhookUrl: string | null; alertEmail: string | null }> {
    const [result] = await db.select({
      openclawWebhookUrl: projects.openclawWebhookUrl,
      alertEmail: projects.alertEmail,
    }).from(projects).where(eq(projects.id, projectId));
    if (!result) return { openclawWebhookUrl: null, alertEmail: null };
    return { openclawWebhookUrl: result.openclawWebhookUrl ?? null, alertEmail: result.alertEmail ?? null };
  }

  async setOpenclawConfig(projectId: number, openclawWebhookUrl: string | null, alertEmail?: string | null): Promise<void> {
    const updateData: Record<string, unknown> = { openclawWebhookUrl };
    if (alertEmail !== undefined) updateData.alertEmail = alertEmail;
    await db.update(projects).set(updateData as never).where(eq(projects.id, projectId));
  }

  async getGeneratedTestsByProject(projectId: number): Promise<GeneratedTest[]> {
    return db.select().from(generatedTests).where(eq(generatedTests.projectId, projectId));
  }

  async getGeneratedTestsByProjectId(projectId: number): Promise<GeneratedTest[]> {
    return this.getGeneratedTestsByProject(projectId);
  }

  async getGeneratedTestById(id: number): Promise<GeneratedTest | undefined> {
    const [result] = await db.select().from(generatedTests).where(eq(generatedTests.id, id));
    return result;
  }

  async createGeneratedTest(data: InsertGeneratedTest): Promise<GeneratedTest> {
    const [result] = await db.insert(generatedTests).values(data).returning();
    return result;
  }

  async updateGeneratedTest(id: number, data: Partial<InsertGeneratedTest> & { review?: unknown }): Promise<GeneratedTest> {
    const [result] = await db.update(generatedTests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(generatedTests.id, id))
      .returning();
    return result;
  }

  async deleteGeneratedTest(id: number): Promise<void> {
    await db.delete(generatedTests).where(eq(generatedTests.id, id));
  }

  async getTestRunsByTest(generatedTestId: number): Promise<TestRun[]> {
    return db.select().from(testRuns)
      .where(eq(testRuns.generatedTestId, generatedTestId))
      .orderBy(testRuns.startedAt);
  }

  async getTestRunById(id: number): Promise<TestRun | undefined> {
    const [result] = await db.select().from(testRuns).where(eq(testRuns.id, id));
    return result;
  }

  async createTestRun(generatedTestId: number, trigger = "manual"): Promise<TestRun> {
    const [result] = await db.insert(testRuns)
      .values({ generatedTestId, status: "running", trigger })
      .returning();
    return result;
  }

  async updateTestRun(id: number, data: {
    status?: string;
    output?: string;
    passedCount?: number;
    failedCount?: number;
    totalCount?: number;
    completedAt?: Date;
    healAttempts?: number;
    healLog?: string;
    healed?: boolean;
    healedVia?: string;
  }): Promise<TestRun> {
    const [result] = await db.update(testRuns)
      .set(data)
      .where(eq(testRuns.id, id))
      .returning();
    return result;
  }

  async getMemoryByProject(projectId: number): Promise<ProjectMemory[]> {
    return db.select()
      .from(projectMemory)
      .where(eq(projectMemory.projectId, projectId))
      .orderBy(desc(projectMemory.confidence), desc(projectMemory.updatedAt));
  }

  async searchMemoryByText(projectId: number, query: string, limit = 10): Promise<ProjectMemory[]> {
    return db.select()
      .from(projectMemory)
      .where(
        and(
          eq(projectMemory.projectId, projectId),
          or(
            ilike(projectMemory.pattern, `%${query}%`),
            ilike(projectMemory.selector, `%${query}%`)
          )
        )
      )
      .orderBy(desc(projectMemory.confidence), desc(projectMemory.updatedAt))
      .limit(limit);
  }

  async upsertMemory(data: InsertProjectMemory): Promise<ProjectMemory> {
    const [existingExact] = await db.select()
      .from(projectMemory)
      .where(
        and(
          eq(projectMemory.projectId, data.projectId),
          eq(projectMemory.selector, data.selector),
          eq(projectMemory.type, data.type ?? "selector")
        )
      )
      .limit(1);

    if (existingExact) {
      const [result] = await db.update(projectMemory)
        .set({
          pattern: data.pattern,
          confidence: data.confidence ?? existingExact.confidence,
          tags: data.tags,
          updatedAt: new Date(),
        })
        .where(eq(projectMemory.id, existingExact.id))
        .returning();
      return result;
    }

    const [result] = await db.insert(projectMemory)
      .values(data)
      .returning();
    return result;
  }

  async upsertMemoryItem(projectId: number, type: string, pattern: string, selector: string, confidenceDelta = 1): Promise<ProjectMemory> {
    const [existing] = await db.select().from(projectMemory)
      .where(and(
        eq(projectMemory.projectId, projectId),
        eq(projectMemory.selector, selector),
        eq(projectMemory.type, type),
      ));

    if (existing) {
      const [updated] = await db.update(projectMemory)
        .set({
          pattern,
          confidence: existing.confidence + confidenceDelta,
          updatedAt: new Date(),
        })
        .where(eq(projectMemory.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(projectMemory)
      .values({ projectId, type, pattern, selector, confidence: confidenceDelta })
      .returning();

    const count = await db.select({ count: sql<number>`count(*)` })
      .from(projectMemory)
      .where(eq(projectMemory.projectId, projectId));
    if (Number(count[0].count) > 100) {
      await this.compactMemory(projectId);
    }
    return created;
  }

  async deleteMemory(id: number): Promise<void> {
    await db.delete(projectMemory).where(eq(projectMemory.id, id));
  }

  async compactMemory(projectId: number): Promise<number> {
    const items = await db.select().from(projectMemory)
      .where(eq(projectMemory.projectId, projectId));

    const bySelector: Record<string, ProjectMemory[]> = {};
    for (const item of items) {
      const key = `${item.type}:${item.selector}`;
      if (!bySelector[key]) bySelector[key] = [];
      bySelector[key].push(item);
    }

    let pruned = 0;
    for (const group of Object.values(bySelector)) {
      if (group.length <= 1) continue;
      group.sort((a: ProjectMemory, b: ProjectMemory) => b.confidence - a.confidence);
      const keep = group[0];
      const rest = group.slice(1);
      const totalConfidence = group.reduce((s: number, i: ProjectMemory) => s + i.confidence, 0);
      await db.update(projectMemory)
        .set({ confidence: totalConfidence })
        .where(eq(projectMemory.id, keep.id));
      for (const dup of rest) {
        await db.delete(projectMemory).where(eq(projectMemory.id, dup.id));
        pruned++;
      }
    }

    const remaining = await db.select().from(projectMemory)
      .where(eq(projectMemory.projectId, projectId))
      .orderBy(projectMemory.confidence);

    if (remaining.length > 100) {
      const toPrune = remaining.slice(0, remaining.length - 100);
      for (const item of toPrune) {
        await db.delete(projectMemory).where(eq(projectMemory.id, item.id));
        pruned++;
      }
    }

    return pruned;
  }

  async createScheduledRunLog(data: InsertScheduledRunLog): Promise<ScheduledRunLog> {
    const [result] = await db.insert(scheduledRunLog).values(data).returning();
    return result;
  }

  async getScheduledRunLogsByProject(projectId: number, limit = 20): Promise<ScheduledRunLog[]> {
    const rows = await db.select().from(scheduledRunLog)
      .where(eq(scheduledRunLog.projectId, projectId))
      .orderBy(scheduledRunLog.triggeredAt);
    return rows.slice(-limit).reverse();
  }

}

export const storage = new DatabaseStorage();
