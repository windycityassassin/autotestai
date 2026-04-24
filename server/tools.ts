import { chromium } from "playwright";
import dns from "dns";
import { promisify } from "util";

const dnsLookup = promisify(dns.lookup);

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string; items?: { type: string } }>;
    required: string[];
  };
};

export type PageElement = {
  tag: string;
  type?: string;
  testId?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  text?: string;
  href?: string;
  role?: string;
  ariaLabel?: string;
  selector: string;
};

export type InspectPageResult = {
  success: boolean;
  url?: string;
  title?: string;
  elements?: PageElement[];
  selectors?: string[];
  error?: string;
};

export type IdentifyFlowsResult = {
  flows: Array<{
    name: string;
    description: string;
    steps: string[];
  }>;
};

export type TestStep = {
  action: string;
  selector: string;
  value?: string;
  isVerified: boolean;
};

export type AssertionStep = {
  selector: string;
  expected: string;
  isVerified: boolean;
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "inspect_page",
    description: "Fetches a real URL and returns all interactive elements as structured JSON. Use this first to understand the actual page structure before writing any selectors.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to inspect" },
      },
      required: ["url"],
    },
  },
  {
    name: "identify_flows",
    description: "Given a list of page elements, identifies the main testable user flows on the page.",
    input_schema: {
      type: "object",
      properties: {
        elements: {
          type: "array",
          description: "The elements returned from inspect_page",
          items: { type: "object" },
        },
        prompt: { type: "string", description: "The user's description of what to test" },
      },
      required: ["elements", "prompt"],
    },
  },
  {
    name: "write_test_step",
    description: "Appends one verified test step to the test being written. Use real selectors from inspect_page results.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "The action to perform: goto, click, fill, press, waitForSelector, expect_visible, expect_text, expect_url" },
        selector: { type: "string", description: "The selector to target (testId, role, text, CSS, etc.)" },
        value: { type: "string", description: "Value for fill actions or URL for goto actions" },
      },
      required: ["action", "selector"],
    },
  },
  {
    name: "assert",
    description: "Appends one assertion step to the test being written.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "The selector to assert on" },
        expected: { type: "string", description: "What to assert: visible, hidden, text:..., url:..., count:..." },
      },
      required: ["selector", "expected"],
    },
  },
  {
    name: "get_memory",
    description: "Retrieves semantically similar past selectors and test patterns that were successful for this project. Call this before writing test steps to discover selectors that have already been verified in previous tests.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "A description of what you are looking for, e.g. 'checkout button', 'login form', 'navigation menu'" },
      },
      required: ["pattern"],
    },
  },
];

function isPrivateIp(ip: string): boolean {
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^::1$/,
    /^fd[0-9a-f]{2}:/i,
    /^fe80:/i,
    /^0\.0\.0\.0$/,
    /^169\.254\./,
    /^localhost$/i,
  ];
  return privateRanges.some((re) => re.test(ip));
}

async function validateUrl(rawUrl: string): Promise<{ valid: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: `Protocol '${parsed.protocol}' is not allowed. Only http and https are permitted.` };
  }

  const hostname = parsed.hostname;

  if (isPrivateIp(hostname)) {
    return { valid: false, error: "Requests to private/internal network addresses are not allowed." };
  }

  try {
    const { address } = await dnsLookup(hostname);
    if (isPrivateIp(address)) {
      return { valid: false, error: "Requests to private/internal network addresses are not allowed." };
    }
  } catch {
    return { valid: false, error: `Could not resolve hostname: ${hostname}` };
  }

  return { valid: true };
}

const EXACT_GENERIC_TAGS = new Set([
  "body", "html", "head", "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "span", "a", "button", "input", "form", "select",
  "textarea", "nav", "main", "section", "article", "header",
  "footer", "ul", "li", "table", "tr", "td", "th", "img", "label",
]);

function isGenericSelector(selector: string): boolean {
  const s = selector.trim();
  if (EXACT_GENERIC_TAGS.has(s)) return true;
  if (/^\[role="[^"]+"\]$/.test(s)) return true;
  return false;
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  testSteps: Array<TestStep | AssertionStep>,
  knownSelectors: Set<string>,
  urlProvided: boolean
): Promise<unknown> {
  switch (toolName) {
    case "inspect_page": {
      const url = toolInput.url as string;
      return await inspectPage(url, knownSelectors);
    }
    case "identify_flows": {
      const elements = toolInput.elements as PageElement[];
      const prompt = toolInput.prompt as string;
      return identifyFlows(elements, prompt);
    }
    case "write_test_step": {
      const selector = toolInput.selector as string;
      const action = toolInput.action as string;
      const value = toolInput.value as string | undefined;

      const isGoto = action === "goto";
      const isGeneric = isGenericSelector(selector);
      // When URL is provided but inspection hasn't populated knownSelectors yet (size === 0),
      // do NOT treat empty set as "all selectors valid" — enforce generic-only until inspection succeeds.
      const inspectionPopulated = knownSelectors.size > 0;
      const bypassAllowed = !urlProvided && !inspectionPopulated;
      const isVerified = isGoto || bypassAllowed || knownSelectors.has(selector) || isGeneric;

      if (!isVerified) {
        return {
          success: false,
          selectorVerified: false,
          warning: inspectionPopulated
            ? `Selector '${selector}' was NOT found during page inspection and is not a generic selector. This step was REJECTED. You MUST use only selectors from inspect_page results. Verified selectors are: ${Array.from(knownSelectors).slice(0, 30).join(", ")}`
            : `Selector '${selector}' cannot be used yet — page inspection has not completed. Call inspect_page first to get verified selectors, or use a generic selector (body, h1, a, button, input).`,
        };
      }

      const step: TestStep = { action, selector, value, isVerified: true };
      testSteps.push(step);
      return {
        success: true,
        stepIndex: testSteps.length - 1,
        step,
        selectorVerified: true,
      };
    }
    case "assert": {
      const selector = toolInput.selector as string;
      const expected = toolInput.expected as string;

      const isGeneric = isGenericSelector(selector) || selector === "page" || selector === "url";
      const inspectionPopulated = knownSelectors.size > 0;
      const bypassAllowed = !urlProvided && !inspectionPopulated;
      const isVerified = bypassAllowed || knownSelectors.has(selector) || isGeneric;

      if (!isVerified) {
        return {
          success: false,
          selectorVerified: false,
          warning: inspectionPopulated
            ? `Selector '${selector}' was NOT found during page inspection. This assertion was REJECTED. Use only selectors from inspect_page results.`
            : `Selector '${selector}' cannot be used yet — call inspect_page first to get verified selectors.`,
        };
      }

      const step: AssertionStep = { selector, expected, isVerified: true };
      testSteps.push(step);
      return {
        success: true,
        stepIndex: testSteps.length - 1,
        step,
        selectorVerified: true,
      };
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

async function inspectPage(url: string, knownSelectors: Set<string>): Promise<InspectPageResult> {
  const validation = await validateUrl(url);
  if (!validation.valid) {
    return {
      success: false,
      error: `Could not inspect page — ${validation.error}`,
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setDefaultTimeout(10000);

    let finalUrl = url;
    page.on("response", (res) => {
      if (res.status() >= 300 && res.status() < 400) {
        const location = res.headers()["location"];
        if (location) finalUrl = location;
      }
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });

    finalUrl = page.url();
    const postNavValidation = await validateUrl(finalUrl);
    if (!postNavValidation.valid) {
      return {
        success: false,
        error: `Could not inspect page — redirect led to a disallowed URL: ${postNavValidation.error}`,
      };
    }

    if (!response || response.status() >= 400) {
      return {
        success: false,
        error: `Could not inspect page — page returned status ${response?.status() ?? "unknown"}`,
      };
    }

    const title = await page.title();

    const elements = await page.evaluate(() => {
      const results: PageElement[] = [];

      const interactiveSelectors = [
        "button",
        "a[href]",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='link']",
        "[role='menuitem']",
        "[role='tab']",
        "[data-testid]",
        "form",
        "[onclick]",
        "label",
        "nav a",
        "h1",
        "h2",
        "h3",
      ];

      const seen = new Set<Element>();

      for (const sel of interactiveSelectors) {
        const nodes = document.querySelectorAll(sel);
        nodes.forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);

          const tag = el.tagName.toLowerCase();
          const testId = el.getAttribute("data-testid") || undefined;
          const id = el.id || undefined;
          const name = (el as HTMLInputElement).name || undefined;
          const placeholder = (el as HTMLInputElement).placeholder || undefined;
          const href = (el as HTMLAnchorElement).href || undefined;
          const role = el.getAttribute("role") || undefined;
          const ariaLabel = el.getAttribute("aria-label") || undefined;
          const type = (el as HTMLInputElement).type || undefined;
          const rawText = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || undefined;
          const text = rawText && rawText.length > 0 ? rawText : undefined;

          let selector = tag;
          if (testId) {
            selector = `[data-testid="${testId}"]`;
          } else if (id) {
            selector = `#${id}`;
          } else if (name) {
            selector = `${tag}[name="${name}"]`;
          } else if (role) {
            selector = `[role="${role}"]`;
          } else if (text && ["button", "a"].includes(tag)) {
            selector = `${tag}:has-text("${text.slice(0, 40)}")`;
          }

          results.push({ tag, type, testId, id, name, placeholder, text, href, role, ariaLabel, selector });
        });
      }

      return results.slice(0, 80);
    });

    const selectors = elements.map((e) => e.selector);
    selectors.forEach((s) => knownSelectors.add(s));
    knownSelectors.add("body");
    knownSelectors.add("page");
    knownSelectors.add("url");

    return { success: true, url: finalUrl, title, elements, selectors };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Could not inspect page — ${message}`,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function identifyFlows(elements: PageElement[], prompt: string): IdentifyFlowsResult {
  const flows: IdentifyFlowsResult["flows"] = [];

  const hasForm = elements.some((e) => e.tag === "form" || e.tag === "input");
  const hasNav = elements.some((e) => e.tag === "nav" || (e.tag === "a" && e.href));
  const hasButtons = elements.some((e) => e.tag === "button" || e.role === "button");

  if (hasForm) {
    flows.push({
      name: "Form submission flow",
      description: "Test form inputs and submission",
      steps: ["Fill in form fields", "Submit the form", "Verify success or error state"],
    });
  }

  if (hasNav) {
    flows.push({
      name: "Navigation flow",
      description: "Test page navigation and links",
      steps: ["Click navigation links", "Verify page content changes", "Verify URL updates"],
    });
  }

  if (hasButtons) {
    flows.push({
      name: "Interactive elements flow",
      description: "Test buttons and interactive controls",
      steps: ["Click each button", "Verify expected behavior", "Check for state changes"],
    });
  }

  flows.push({
    name: "Page load flow",
    description: "Verify the page loads correctly with expected content",
    steps: ["Navigate to URL", "Verify title", "Verify key elements are visible"],
  });

  return { flows };
}

export function synthesizeTestCode(
  testSteps: Array<TestStep | AssertionStep>,
  framework: string,
  targetUrl: string | undefined,
  prompt: string
): string | null {
  const verifiedSteps = testSteps.filter((s) => s.isVerified);
  if (verifiedSteps.length === 0) return null;
  testSteps = verifiedSteps;

  const isPlaywright = framework === "playwright";
  const lines: string[] = [];

  // Detect dynamic value type to use Passmark {{run.*}} placeholders
  function passmarkDynamicValue(value: string, selectorHint: string): string {
    const lc = value.toLowerCase();
    const hint = selectorHint.toLowerCase();
    if (lc.includes("@") && lc.includes(".")) return "{{run.email}}";
    if (hint.includes("email")) return "{{run.email}}";
    if (hint.includes("password") || hint.includes("pass")) return "{{run.password}}";
    if (hint.includes("name") && !hint.includes("username")) return "{{run.name}}";
    if (hint.includes("username") || hint.includes("user")) return "{{run.username}}";
    if (hint.includes("phone") || hint.includes("mobile")) return "{{run.phone}}";
    return value;
  }

  if (isPlaywright) {
    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push(`import { runSteps, assert } from 'passmark';`);
    lines.push(``);
    lines.push(`test.describe('Generated tests', () => {`);
    if (targetUrl) {
      lines.push(`  // Tests for: ${targetUrl}`);
    }
    lines.push(`  // ${prompt}`);
    lines.push(``);
    lines.push(`  test('main flow', async ({ page }) => {`);
    lines.push(`    test.setTimeout(120_000);`);

    const passmarkSteps: string[] = [];
    const passmarkAssertions: string[] = [];
    const standaloneAssertions: string[] = [];

    for (const step of testSteps) {
      if ("action" in step) {
        const s = step as TestStep;
        switch (s.action) {
          case "goto":
            passmarkSteps.push(`      { description: 'Navigate to ${s.value || s.selector}' },`);
            break;
          case "click":
            passmarkSteps.push(`      { description: 'Click on ${s.selector}' },`);
            break;
          case "fill": {
            const dynValue = s.value ? passmarkDynamicValue(s.value, s.selector) : null;
            if (dynValue) {
              passmarkSteps.push(`      { description: 'Fill in ${s.selector}', data: { value: '${dynValue}' } },`);
            } else {
              passmarkSteps.push(`      { description: 'Fill in ${s.selector}' },`);
            }
            break;
          }
          case "press":
            passmarkSteps.push(`      { description: 'Press ${s.value || "Enter"} on ${s.selector}' },`);
            break;
          case "waitForSelector":
            passmarkSteps.push(`      { description: 'Wait for ${s.selector} to be visible' },`);
            break;
          case "expect_visible":
            passmarkAssertions.push(`      { assertion: '${s.selector} is visible on the page' },`);
            break;
          case "expect_text":
            passmarkAssertions.push(`      { assertion: '${s.selector} contains the text "${s.value || ""}"' },`);
            break;
          case "expect_url":
            passmarkAssertions.push(`      { assertion: 'The current URL is ${s.value || s.selector}' },`);
            break;
          default:
            passmarkSteps.push(`      { description: '${s.action} on ${s.selector}' },`);
        }
      } else {
        const a = step as AssertionStep;
        let assertionText = "";
        if (a.expected === "visible") {
          assertionText = `${a.selector} is visible on the page`;
        } else if (a.expected === "hidden") {
          assertionText = `${a.selector} is not visible / is hidden`;
        } else if (a.expected.startsWith("text:")) {
          assertionText = `${a.selector} contains the text "${a.expected.slice(5)}"`;
        } else if (a.expected.startsWith("url:")) {
          assertionText = `The current URL is ${a.expected.slice(4)}`;
        } else if (a.expected.startsWith("count:")) {
          assertionText = `There are ${a.expected.slice(6)} elements matching ${a.selector}`;
        } else {
          assertionText = `${a.selector}: ${a.expected}`;
        }
        passmarkAssertions.push(`      { assertion: '${assertionText}' },`);
        standaloneAssertions.push(assertionText);
      }
    }

    lines.push(`    await runSteps({`);
    lines.push(`      page,`);
    lines.push(`      userFlow: '${prompt.slice(0, 80).replace(/'/g, "\\'")}',`);
    lines.push(`      steps: [`);
    for (const s of passmarkSteps) lines.push(s);
    lines.push(`      ],`);
    if (passmarkAssertions.length > 0) {
      lines.push(`      assertions: [`);
      for (const a of passmarkAssertions) lines.push(a);
      lines.push(`      ],`);
    }
    lines.push(`      test,`);
    lines.push(`      expect,`);
    lines.push(`    });`);
    lines.push(``);
    // Use Passmark assert() for multi-model consensus on key post-run checks
    if (standaloneAssertions.length > 0) {
      lines.push(`    // Multi-model consensus assertions (Claude + Gemini)`);
      for (const assertion of standaloneAssertions) {
        lines.push(`    await assert({ page, assertion: '${assertion}', test, expect });`);
      }
    }
    lines.push(`  });`);
    lines.push(`});`);

    return lines.join("\n");
  }

  // Cypress: keep original selector-based format (Passmark is Playwright-only)
  const cypressLines: string[] = [];
  cypressLines.push(`/// <reference types="cypress" />`);
  cypressLines.push(``);
  cypressLines.push(`describe('Generated tests', () => {`);
  if (targetUrl) {
    cypressLines.push(`  // Tests for: ${targetUrl}`);
  }
  cypressLines.push(`  // ${prompt}`);
  cypressLines.push(``);
  cypressLines.push(`  it('main flow', () => {`);

  for (const step of testSteps) {
    if ("action" in step) {
      const s = step as TestStep;
      switch (s.action) {
        case "goto":
          cypressLines.push(`    cy.visit('${s.value || s.selector}');`);
          break;
        case "click":
          cypressLines.push(`    cy.get('${s.selector}').click();`);
          break;
        case "fill":
          cypressLines.push(`    cy.get('${s.selector}').type('${s.value || ""}');`);
          break;
        case "press":
          cypressLines.push(`    cy.get('${s.selector}').type('{${s.value || "enter"}}');`);
          break;
        case "waitForSelector":
          cypressLines.push(`    cy.get('${s.selector}').should('exist');`);
          break;
        case "expect_visible":
          cypressLines.push(`    cy.get('${s.selector}').should('be.visible');`);
          break;
        case "expect_text":
          cypressLines.push(`    cy.get('${s.selector}').should('contain', '${s.value || ""}');`);
          break;
        case "expect_url":
          cypressLines.push(`    cy.url().should('include', '${s.value || s.selector}');`);
          break;
        default:
          cypressLines.push(`    // ${s.action} on ${s.selector}`);
      }
    } else {
      const a = step as AssertionStep;
      if (a.expected === "visible") {
        cypressLines.push(`    cy.get('${a.selector}').should('be.visible');`);
      } else if (a.expected === "hidden") {
        cypressLines.push(`    cy.get('${a.selector}').should('not.be.visible');`);
      } else if (a.expected.startsWith("text:")) {
        cypressLines.push(`    cy.get('${a.selector}').should('contain', '${a.expected.slice(5)}');`);
      } else if (a.expected.startsWith("url:")) {
        cypressLines.push(`    cy.url().should('include', '${a.expected.slice(4)}');`);
      } else if (a.expected.startsWith("count:")) {
        cypressLines.push(`    cy.get('${a.selector}').should('have.length', ${a.expected.slice(6)});`);
      } else {
        cypressLines.push(`    // Assert ${a.selector}: ${a.expected}`);
      }
    }
  }

  cypressLines.push(`  });`);
  cypressLines.push(`});`);

  return cypressLines.join("\n");
}

// Matches selector strings from both Playwright and Cypress APIs.
// Playwright: locator("sel"), getByTestId("sel"), querySelector("sel"), waitForSelector("sel")
// Cypress: cy.get("sel"), cy.contains("sel"), .get("sel"), .contains("sel")
const SELECTOR_PATTERN = /(?:locator|getByTestId|querySelector|waitForSelector|\.get|cy\.get|\.contains|cy\.contains)\((['"`])([^'"`,)]+)\1/g;

function extractSelectors(code: string): string[] {
  const results: string[] = [];
  SELECTOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELECTOR_PATTERN.exec(code)) !== null) {
    const sel = match[2];
    if (sel) results.push(sel);
  }
  return results;
}

export function lintFallbackCode(code: string): { hasNonGenericSelectors: boolean; selectors: string[] } {
  const nonGeneric: string[] = [];
  for (const sel of extractSelectors(code)) {
    const isGeneric = EXACT_GENERIC_TAGS.has(sel.trim()) || /^\[role="[^"]+"\]$/.test(sel.trim());
    if (!isGeneric) nonGeneric.push(sel);
  }
  return { hasNonGenericSelectors: nonGeneric.length > 0, selectors: nonGeneric };
}

export function sanitizeGeneratedCode(
  code: string,
  knownSelectors: Set<string>,
  framework: string
): { code: string; hadHallucinations: boolean; hallucinatedSelectors: string[] } {
  if (knownSelectors.size === 0) {
    return { code, hadHallucinations: false, hallucinatedSelectors: [] };
  }

  const selectorPattern = /(?:locator|getByTestId|querySelector|waitForSelector|\.get|cy\.get|\.contains|cy\.contains)\((['"`])([^'"`,)]+)\1/g;
  const hallucinatedSelectors: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = selectorPattern.exec(code)) !== null) {
    const sel = match[2];
    if (!sel) continue;

    const isKnown = knownSelectors.has(sel);

    const selId = sel.match(/data-testid="([^"]+)"/)?.[1] ?? sel.match(/data-testid='([^']+)'/)?.[1];
    const isKnownById = selId != null && Array.from(knownSelectors).some((known) => {
      const knownId = known.match(/data-testid="([^"]+)"/)?.[1] ?? known.match(/\[data-testid=([^\]]+)\]/)?.[1]?.replace(/['"]/g, "");
      return knownId === selId;
    });

    const isGeneric = EXACT_GENERIC_TAGS.has(sel) || /^\[role="[^"]+"\]$/.test(sel);

    if (!isKnown && !isKnownById && !isGeneric) {
      hallucinatedSelectors.push(sel);
    }
  }

  return {
    code,
    hadHallucinations: hallucinatedSelectors.length > 0,
    hallucinatedSelectors,
  };
}
