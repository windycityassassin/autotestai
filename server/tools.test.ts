import assert from "assert";
import { lintFallbackCode, sanitizeGeneratedCode, executeTool, type TestStep, type AssertionStep } from "./tools";

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("server/tools.test.ts");

// lintFallbackCode + synthesizeTestCode: regression for unreachable URL fallback path
test("regression: forced fallback produces no non-generic selectors via lintFallbackCode", () => {
  // Safe deterministic template (Playwright path) should pass linting
  const playwrightTemplate = `import { test, expect } from '@playwright/test';

test.describe('Test suite', () => {
  test('page loads', async ({ page }) => {
    await page.goto('https://example.com');
    await expect(page.locator('body')).toBeVisible();
  });

  test('contains headings', async ({ page }) => {
    await page.goto('https://example.com');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('contains interactive elements', async ({ page }) => {
    await page.goto('https://example.com');
    await expect(page.locator('a').first()).toBeVisible();
  });
});`;
  const { hasNonGenericSelectors } = lintFallbackCode(playwrightTemplate);
  assert.strictEqual(hasNonGenericSelectors, false, "Playwright deterministic template should pass linting");
});

test("regression: Cypress safe template also passes lintFallbackCode", () => {
  // Safe deterministic Cypress template
  const cypressTemplate = `/// <reference types="cypress" />

describe('Test suite', () => {
  it('page loads', () => {
    cy.visit('https://example.com');
    cy.get('body').should('be.visible');
  });

  it('contains headings', () => {
    cy.visit('https://example.com');
    cy.get('h1').should('exist');
  });

  it('contains interactive elements', () => {
    cy.visit('https://example.com');
    cy.get('a').first().should('exist');
  });
});`;
  const { hasNonGenericSelectors } = lintFallbackCode(cypressTemplate);
  assert.strictEqual(hasNonGenericSelectors, false, "Cypress deterministic template should pass linting");
});

// executeTool: phase-aware selector enforcement
test("executeTool: rejects non-generic selector when URL provided but inspection not done", async () => {
  const steps: Array<TestStep | AssertionStep> = [];
  const emptySelectors = new Set<string>();
  const result = await executeTool("write_test_step", { action: "click", selector: ".login-btn" }, steps, emptySelectors, true) as Record<string, unknown>;
  assert.strictEqual(result.success, false);
  assert.ok((result.warning as string).includes("page inspection has not completed"));
  assert.strictEqual(steps.length, 0);
});

test("executeTool: allows generic selector when URL provided but inspection not done", async () => {
  const steps: Array<TestStep | AssertionStep> = [];
  const emptySelectors = new Set<string>();
  const result = await executeTool("write_test_step", { action: "click", selector: "button" }, steps, emptySelectors, true) as Record<string, unknown>;
  assert.strictEqual(result.success, true);
  assert.strictEqual(steps.length, 1);
});

test("executeTool: allows any selector when no URL provided (description-only)", async () => {
  const steps: Array<TestStep | AssertionStep> = [];
  const emptySelectors = new Set<string>();
  const result = await executeTool("write_test_step", { action: "click", selector: "button" }, steps, emptySelectors, false) as Record<string, unknown>;
  assert.strictEqual(result.success, true);
});

test("executeTool: allows verified selector after inspection", async () => {
  const steps: Array<TestStep | AssertionStep> = [];
  const selectors = new Set(["[data-testid=\"submit\"]"]);
  const result = await executeTool("write_test_step", { action: "click", selector: "[data-testid=\"submit\"]" }, steps, selectors, true) as Record<string, unknown>;
  assert.strictEqual(result.success, true);
  assert.strictEqual(steps.length, 1);
});

test("executeTool: rejects non-verified selector after inspection succeeded", async () => {
  const steps: Array<TestStep | AssertionStep> = [];
  const selectors = new Set(["[data-testid=\"submit\"]"]);
  const result = await executeTool("write_test_step", { action: "click", selector: ".invented-class" }, steps, selectors, true) as Record<string, unknown>;
  assert.strictEqual(result.success, false);
  assert.strictEqual(steps.length, 0);
});

test("lintFallbackCode: passes for exact generic selectors", () => {
  const code = `
    import { test, expect } from '@playwright/test';
    test('generic test', async ({ page }) => {
      await page.goto('https://example.com');
      await page.locator('button').click();
      await page.locator('input').fill('hello');
      expect(await page.locator('h1').textContent()).toBe('Title');
    });
  `;
  const { hasNonGenericSelectors } = lintFallbackCode(code);
  assert.strictEqual(hasNonGenericSelectors, false);
});

test("lintFallbackCode: detects hallucinated class selectors", () => {
  const code = `
    import { test, expect } from '@playwright/test';
    test('hallucinated', async ({ page }) => {
      await page.locator('.btn-primary').click();
      await page.locator('[data-testid="login-button"]').click();
    });
  `;
  const { hasNonGenericSelectors, selectors } = lintFallbackCode(code);
  assert.strictEqual(hasNonGenericSelectors, true);
  assert.ok(selectors.includes(".btn-primary"));
});

test("lintFallbackCode: detects Cypress cy.get non-generic selectors", () => {
  const code = `
    describe('test', () => {
      it('works', () => {
        cy.get('.login-form').should('be.visible');
        cy.get('button').click();
      });
    });
  `;
  const { hasNonGenericSelectors, selectors } = lintFallbackCode(code);
  assert.strictEqual(hasNonGenericSelectors, true);
  assert.ok(selectors.includes(".login-form"));
  assert.ok(!selectors.includes("button"));
});

test("lintFallbackCode: passes [role=...] selectors", () => {
  const code = `
    test('role test', async ({ page }) => {
      await page.locator('[role="button"]').click();
    });
  `;
  const { hasNonGenericSelectors } = lintFallbackCode(code);
  assert.strictEqual(hasNonGenericSelectors, false);
});

test("sanitizeGeneratedCode: returns no hallucinations when knownSelectors is empty", () => {
  const code = `page.locator('[data-testid="fancy-button"]')`;
  const { hadHallucinations } = sanitizeGeneratedCode(code, new Set(), "playwright");
  assert.strictEqual(hadHallucinations, false);
});

test("sanitizeGeneratedCode: detects CSS selector not in known set", () => {
  const known = new Set([".real-submit-btn"]);
  const code = `page.locator(".invented-button")`;
  const { hadHallucinations } = sanitizeGeneratedCode(code, known, "playwright");
  assert.strictEqual(hadHallucinations, true);
});

test("sanitizeGeneratedCode: passes CSS selector in known set", () => {
  const known = new Set([".real-submit-btn"]);
  const code = `page.locator(".real-submit-btn")`;
  const { hadHallucinations } = sanitizeGeneratedCode(code, known, "playwright");
  assert.strictEqual(hadHallucinations, false);
});

test("sanitizeGeneratedCode: passes exact generic tag selectors even with known set", () => {
  const known = new Set(["[data-testid=\"submit\"]"]);
  const code = `page.locator('button')`;
  const { hadHallucinations } = sanitizeGeneratedCode(code, known, "playwright");
  assert.strictEqual(hadHallucinations, false);
});

test("sanitizeGeneratedCode: button.btn-primary is NOT considered generic", () => {
  const known = new Set(["button"]);
  const code = `page.locator('button.btn-primary')`;
  const { hadHallucinations } = sanitizeGeneratedCode(code, known, "playwright");
  assert.strictEqual(hadHallucinations, true);
});
