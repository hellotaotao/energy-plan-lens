# Energy Plan Lens

Energy Plan Lens is the first product marketing homepage for an Australian electricity plan comparison product.

The product direction is simple: instead of estimating from average household usage, Energy Plan Lens will replay a household's real smart meter interval data through retailer tariff formulas to show what each plan would have actually cost.

## Homepage Scope

This repository currently contains the product explanation site, not the functional calculator. The page explains:

- Why average-based comparison sites can miss the real cheapest plan.
- Who the product is for: smart meter households, solar homes, EV and heat pump owners, renters, homeowners and financially careful families.
- How interval usage can be priced against flat rate, time-of-use, demand, controlled load, solar feed-in, daily supply charge, seasonal, weekend and weekday tariff rules.
- How future upload-and-calculate workflows will produce annual total cost, monthly curves, summer and winter winners, bill shock periods and switching savings.
- Trust, privacy and early access expectations for test data.

## Tech Stack

- Vite
- React
- TypeScript
- Node's built-in test runner for messaging quality checks

Vitest was considered for the test runner, but the install attempt was blocked by local DNS/network access to `registry.npmjs.org`. The current `npm test` script uses `node --test` so the checks run without adding an unavailable dependency.

## Scripts

```bash
npm run dev
npm test
npm run build
npm run lint
```

## Development Notes

The tests in `test/messaging.test.mjs` intentionally check the homepage source for concrete product messaging. They protect against drifting back into generic SaaS copy by verifying the audience, pain points, tariff modelling capabilities, workflow steps and Australian electricity market context.
