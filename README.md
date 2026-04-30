# EnergyLens

EnergyLens is an early browser-local Australian electricity usage and bill analysis product.

The product direction is simple: instead of estimating from average household usage, EnergyLens will replay a household's real smart meter interval data through retailer tariff formulas to show what each plan would have actually cost.

## Current Scope

This repository contains the product explanation site plus a first local calculator slice. The page currently supports:

- Why average-based comparison sites can miss the real cheapest plan.
- Who the product is for: smart meter households, solar homes, EV and heat pump owners, renters, homeowners and financially careful families.
- How interval usage can be priced against flat rate, time-of-use, demand, controlled load, solar feed-in, daily supply charge, seasonal, weekend and weekday tariff rules.
- Browser-local upload of AGL `MyUsageData` CSV files, or ZIP files containing an AGL usage CSV.
- Local parsing of import, solar/export, quality flags, timestamps, inferred interval length and timestamp gaps.
- Editable flat-rate tariff inputs for plan name, daily supply charge, import rate and solar feed-in credit.
- A simple local comparison between the editable flat-rate plan and an AGL Three for Free style time-of-use assumption when timestamps, or an assumed start datetime, are available.
- Future upload-and-calculate workflows for annual total cost, monthly curves, summer and winter winners, bill shock periods and switching savings.
- Trust, privacy and early access expectations for test data.

All uploaded file handling and tariff calculations happen in the browser session. The app does not upload meter data to a server.

## Tech Stack

- Vite
- React
- TypeScript
- JSZip for browser-local ZIP extraction
- Node's built-in test runner for parser, calculator and messaging checks

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

## Uploaded-data insight layer

EnergyLens now includes a first value layer for real uploaded AGL usage-history files, not just generic tariff copy.

The parser and UI explicitly handle AGL exports where `StartDate` and `EndDate` fields may be blank or incomplete. Use your own browser-local AGL `MyUsageData` CSV export, or the ZIP downloaded from AGL if it contains that CSV. Do not commit private usage files, account numbers, NMIs or retailer exports to this repo.

The app separates what is trustworthy from what needs assumptions:

- Trusted: row count, import/usage channel, solar/export channel, ProfileReadValue totals, quality flags and ordered interval series.
- Not trusted without extra input: exact dates, weekdays, seasons, public holidays and exact time-of-use alignment.
- Usable with an explicit assumption: index-based interval-of-day patterns, approximate period length, import/export totals, peak import windows, solar/export-heavy windows and free-window suitability.

The uploaded-data insight panel now shows:

- Data-quality explanation.
- Approximate analysed period.
- Daily import/export averages.
- Export-to-import ratio.
- Import and export peak interval patterns.
- Free-window import/export share.
- Evening peak import share.
- Solar/export opportunity narrative.
- Plan-fit narrative with uncertainty labels.

Product principle: when retailer exports omit timestamps, EnergyLens should not pretend exact calendar facts. The product value is to be honest about uncertainty while still extracting useful household-specific patterns from the ordered interval data.
