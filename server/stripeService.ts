import { getUncachableStripeClient } from './stripeClient';
import { db } from './db';
import { sql } from 'drizzle-orm';

export type PlanId = 'free' | 'pro' | 'team';

export interface PlanLimits {
  maxProjects: number;
  maxRunsPerMonth: number;
  selfHealing: boolean;
  monitoring: boolean;
  webhooks: boolean;
  autoDream: boolean;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    maxProjects: 1,
    maxRunsPerMonth: 20,
    selfHealing: false,
    monitoring: false,
    webhooks: false,
    autoDream: false,
  },
  pro: {
    maxProjects: 5,
    maxRunsPerMonth: Infinity,
    selfHealing: true,
    monitoring: true,
    webhooks: false,
    autoDream: false,
  },
  team: {
    maxProjects: Infinity,
    maxRunsPerMonth: Infinity,
    selfHealing: true,
    monitoring: true,
    webhooks: true,
    autoDream: true,
  },
};

export async function getPlanForUser(stripeCustomerId: string | null): Promise<PlanId> {
  if (!stripeCustomerId) return 'free';
  try {
    const result = await db.execute(sql`
      SELECT s.status, p.metadata
      FROM stripe.subscriptions s
      JOIN stripe.prices pr ON pr.id = ANY(
        SELECT jsonb_array_elements_text(s.items::jsonb -> 'data' -> 0 -> 'price' -> 'id'::text)
      )
      JOIN stripe.products p ON p.id = pr.product
      WHERE s.customer = ${stripeCustomerId}
        AND s.status = 'active'
      LIMIT 1
    `);
    if (result.rows.length === 0) return 'free';
    const metadata = result.rows[0].metadata as any;
    return (metadata?.plan_id as PlanId) || 'free';
  } catch {
    return 'free';
  }
}

export async function getPlanFromSubscriptionId(stripeSubscriptionId: string | null): Promise<PlanId> {
  if (!stripeSubscriptionId) return 'free';
  try {
    const result = await db.execute(sql`
      SELECT p.metadata
      FROM stripe.subscriptions s
      JOIN stripe.subscription_items si ON si.subscription = s.id
      JOIN stripe.prices pr ON pr.id = si.price
      JOIN stripe.products p ON p.id = pr.product
      WHERE s.id = ${stripeSubscriptionId}
        AND s.status = 'active'
      LIMIT 1
    `);
    if (result.rows.length === 0) return 'free';
    const metadata = result.rows[0].metadata as any;
    return (metadata?.plan_id as PlanId) || 'free';
  } catch {
    return 'free';
  }
}

export class StripeService {
  async createCustomer(email: string, userId: number) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      metadata: { userId: String(userId) },
    });
  }

  async createCheckoutSession(customerId: string, priceId: string, baseUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/dashboard?billing=success`,
      cancel_url: `${baseUrl}/dashboard?billing=cancelled`,
    });
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async getProductsWithPrices() {
    try {
      const result = await db.execute(sql`
        SELECT
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC NULLS FIRST
      `);
      if (result.rows.length > 0) {
        const map = new Map<string, any>();
        for (const row of result.rows) {
          if (!map.has(row.product_id as string)) {
            map.set(row.product_id as string, {
              id: row.product_id,
              name: row.product_name,
              description: row.product_description,
              metadata: row.product_metadata,
              prices: [],
            });
          }
          if (row.price_id) {
            map.get(row.product_id as string).prices.push({
              id: row.price_id,
              unit_amount: row.unit_amount,
              currency: row.currency,
              recurring: row.recurring,
            });
          }
        }
        return Array.from(map.values());
      }
    } catch {
    }
    return this.getProductsFromStripeAPI();
  }

  async getProductsFromStripeAPI() {
    try {
      const stripe = await getUncachableStripeClient();
      const products = await stripe.products.list({ active: true, limit: 20 });
      const prices = await stripe.prices.list({ active: true, limit: 50 });
      return products.data.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        metadata: p.metadata,
        prices: prices.data
          .filter((pr) => pr.product === p.id)
          .map((pr) => ({
            id: pr.id,
            unit_amount: pr.unit_amount,
            currency: pr.currency,
            recurring: pr.recurring,
          })),
      }));
    } catch {
      return [];
    }
  }
}

export const stripeService = new StripeService();
