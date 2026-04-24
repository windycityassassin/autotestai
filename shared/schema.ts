import { pgTable, serial, text, timestamp, integer, boolean, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  company: text("company"),
  role: text("role"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({
  id: true,
  createdAt: true,
});

export type Waitlist = typeof waitlist.$inferSelect;
export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").default("free").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  plan: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url"),
  description: text("description"),
  monitoringSchedule: text("monitoring_schedule").default("off").notNull(),
  webhookSecret: text("webhook_secret"),
  monitoringPaused: boolean("monitoring_paused").default(false).notNull(),
  lastScheduledRunAt: timestamp("last_scheduled_run_at"),
  openclawWebhookUrl: text("openclaw_webhook_url"),
  alertEmail: text("alert_email"),
  isDemo: boolean("is_demo").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  userId: true,
  createdAt: true,
  lastScheduledRunAt: true,
  isDemo: true,
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export const generatedTests = pgTable("generated_tests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title"),
  framework: text("framework"),
  prompt: text("prompt"),
  url: text("url"),
  code: text("code").notNull(),
  review: jsonb("review"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertGeneratedTestSchema = createInsertSchema(generatedTests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GeneratedTest = typeof generatedTests.$inferSelect;
export type InsertGeneratedTest = z.infer<typeof insertGeneratedTestSchema>;

export type ReviewFlag = {
  level: "green" | "yellow" | "red";
  message: string;
  line?: number;
};

export type TestReview = {
  score: number;
  flags: ReviewFlag[];
};

export const testRuns = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  generatedTestId: integer("generated_test_id").notNull().references(() => generatedTests.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  output: text("output"),
  passedCount: integer("passed_count"),
  failedCount: integer("failed_count"),
  totalCount: integer("total_count"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  healAttempts: integer("heal_attempts").default(0),
  healLog: text("heal_log"),
  healed: boolean("healed").default(false),
  trigger: text("trigger").default("manual").notNull(),
  healedVia: text("healed_via"),
});

export const insertTestRunSchema = createInsertSchema(testRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type TestRun = typeof testRuns.$inferSelect;
export type InsertTestRun = z.infer<typeof insertTestRunSchema>;

export const projectMemory = pgTable("project_memory", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("selector"),
  pattern: text("pattern").notNull(),
  selector: text("selector").notNull(),
  confidence: real("confidence").notNull().default(1.0),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProjectMemorySchema = createInsertSchema(projectMemory).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProjectMemory = typeof projectMemory.$inferSelect;
export type InsertProjectMemory = z.infer<typeof insertProjectMemorySchema>;

export const scheduledRunLog = pgTable("scheduled_run_log", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  trigger: text("trigger").notNull(),
  testsEvaluated: jsonb("tests_evaluated"),
  testsRun: integer("tests_run").default(0).notNull(),
  passed: integer("passed").default(0).notNull(),
  failed: integer("failed").default(0).notNull(),
  notificationSent: boolean("notification_sent").default(false).notNull(),
  dreamSummary: text("dream_summary"),
});

export const insertScheduledRunLogSchema = createInsertSchema(scheduledRunLog).omit({
  id: true,
  triggeredAt: true,
});

export type ScheduledRunLog = typeof scheduledRunLog.$inferSelect;
export type InsertScheduledRunLog = z.infer<typeof insertScheduledRunLogSchema>;
