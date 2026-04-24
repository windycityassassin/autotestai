import { getUncachableStripeClient } from '../server/stripeClient';

async function seedProducts() {
  const stripe = await getUncachableStripeClient();
  console.log('Seeding AutoTestAI plans in Stripe...');

  const plans = [
    {
      name: 'Pro',
      description: '5 projects, unlimited test runs, self-healing tests, hourly/daily monitoring',
      metadata: { plan_id: 'pro' },
      monthly: 4900,
      yearly: 47000,
    },
    {
      name: 'Team',
      description: 'Unlimited projects & runs, all Pro features + webhooks, CI/CD integration, weekly autoDream summaries',
      metadata: { plan_id: 'team' },
      monthly: 14900,
      yearly: 143000,
    },
  ];

  for (const plan of plans) {
    const existing = await stripe.products.search({
      query: `name:'${plan.name}' AND active:'true'`,
    });

    if (existing.data.length > 0) {
      console.log(`  ${plan.name} already exists (${existing.data[0].id}) — skipping`);
      continue;
    }

    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: plan.metadata,
    });

    const monthly = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.monthly,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { plan_id: plan.metadata.plan_id, interval: 'month' },
    });

    const yearly = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.yearly,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { plan_id: plan.metadata.plan_id, interval: 'year' },
    });

    console.log(`  ✓ ${plan.name}: $${plan.monthly / 100}/mo (${monthly.id}), $${plan.yearly / 100}/yr (${yearly.id})`);
  }

  console.log('\nDone. Webhooks will sync these to your database automatically.');
}

seedProducts().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
