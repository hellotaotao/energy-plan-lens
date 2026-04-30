import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAglUsageCsv } from '../.test-build/src/domain/aglCsv.js'
import { calculateTariffCost, compareTariffs } from '../.test-build/src/domain/tariffs.js'
import { generateUsageInsights } from '../.test-build/src/domain/usageInsights.js'

const header =
  'AccountNumber,NMI,DeviceNumber,DeviceType,RegisterCode,RateTypeDescription,StartDate,EndDate,ProfileReadValue,RegisterReadValue,QualityFlag'

const row = ({
  register = '15987#E1',
  type = 'Usage',
  start = '',
  end = '',
  value = 0,
  flag = 'A',
} = {}) => `,,000000000700315987,COMMS4D,${register},${type},${start},${end},${value},0,${flag}`

test('AGL CSV parser groups usage/import and solar/export with index-based warnings when timestamps are blank', () => {
  const csv = [
    header,
    row({ register: '15987#B1', type: 'Solar', value: 1.25 }),
    row({ register: '15987#B1', type: 'Solar', value: 0.75, flag: 'U' }),
    row({ value: 2.5 }),
    row({ value: 1 }),
  ].join('\n')

  const parsed = parseAglUsageCsv(csv)

  assert.equal(parsed.rowCount, 4)
  assert.equal(parsed.channels.export.rowCount, 2)
  assert.equal(parsed.channels.import.rowCount, 2)
  assert.equal(parsed.channels.export.totalKwh, 2)
  assert.equal(parsed.channels.import.totalKwh, 3.5)
  assert.equal(parsed.qualityFlags.A, 3)
  assert.equal(parsed.qualityFlags.U, 1)
  assert.equal(parsed.hasTimestamps, false)
  assert.equal(parsed.intervalMinutes, null)
  assert.equal(parsed.channels.import.intervals[0].index, 0)
  assert.equal(parsed.channels.import.intervals[0].start, undefined)
  assert.ok(parsed.warnings.some((warning) => warning.includes('missing StartDate or EndDate')))
  assert.ok(parsed.warnings.some((warning) => warning.includes('NMI is blank')))
})

test('AGL CSV parser infers interval minutes from dated rows and reports timestamp gaps', () => {
  const csv = [
    header,
    row({ start: '2026-01-01T00:00:00', end: '2026-01-01T00:30:00', value: 1 }),
    row({ start: '2026-01-01T00:30:00', end: '2026-01-01T01:00:00', value: 1 }),
    row({ start: '2026-01-01T01:30:00', end: '2026-01-01T02:00:00', value: 1 }),
  ].join('\n')

  const parsed = parseAglUsageCsv(csv)

  assert.equal(parsed.hasTimestamps, true)
  assert.equal(parsed.intervalMinutes, 30)
  assert.equal(parsed.intervalInference, 'timestamps')
  assert.equal(parsed.missingIntervals.length, 1)
  assert.deepEqual(parsed.missingIntervals[0], {
    channel: 'import',
    afterIndex: 1,
    beforeIndex: 2,
    missingCount: 1,
    expectedMinutes: 30,
    actualMinutes: 60,
  })
})

test('AGL CSV parser rejects malformed quoted CSV content', () => {
  const csv = [header, '123,NMI1,device,type,15987#E1,Usage,,,"1.25,0,A'].join('\n')

  assert.throws(() => parseAglUsageCsv(csv), /opened quoted field was not closed/)
})

test('AGL CSV parser preserves signed values and parses quoted thousands separators', () => {
  const csv = [
    header,
    row({ value: '"1,234.5"' }),
    row({ register: '15987#B1', type: 'Solar', value: '-2.25' }),
  ].join('\n')

  const parsed = parseAglUsageCsv(csv)

  assert.equal(parsed.channels.import.totalKwh, 1234.5)
  assert.equal(parsed.channels.export.totalKwh, -2.25)
})

test('AGL CSV parser can infer a missing-timestamp interval from unambiguous row count', () => {
  const rows = [header]

  for (let index = 0; index < 24; index += 1) {
    rows.push(row({ value: 1 }))
  }

  const parsed = parseAglUsageCsv(rows.join('\n'))

  assert.equal(parsed.hasTimestamps, false)
  assert.equal(parsed.intervalMinutes, 60)
  assert.equal(parsed.intervalInference, 'row-count')
  assert.ok(parsed.warnings.some((warning) => warning.includes('60-minute intervals were inferred from row count')))
})

test('flat tariff calculator can price index-based intervals when interval length is provided', () => {
  const csv = [
    header,
    row({ register: '15987#B1', type: 'Solar', value: 0.25 }),
    row({ register: '15987#B1', type: 'Solar', value: 0.75 }),
    row({ value: 1 }),
    row({ value: 2 }),
  ].join('\n')
  const parsed = parseAglUsageCsv(csv)
  const tariff = {
    id: 'flat-test',
    name: 'Flat test',
    dailySupplyCents: 100,
    exportFeedInCents: 5,
    importRates: [{ label: 'Flat', start: '00:00', end: '24:00', centsPerKwh: 30 }],
  }

  const result = calculateTariffCost(parsed, tariff, { intervalMinutes: 30 })

  assert.equal(result.status, 'priced')
  assert.equal(result.importCostDollars, 0.9)
  assert.equal(result.exportCreditDollars, 0.05)
  assert.equal(result.supplyCostDollars, 0.04)
  assert.equal(result.totalCostDollars, 0.89)
})

test('time-of-use calculator needs a real start time unless demo mode is explicitly requested', () => {
  const csv = [
    header,
    row({ value: 1 }),
    row({ value: 1 }),
    row({ value: 1 }),
    row({ value: 1 }),
    row({ value: 1 }),
    row({ value: 1 }),
  ].join('\n')
  const parsed = parseAglUsageCsv(csv)
  const touTariff = {
    id: 'tou-test',
    name: 'TOU test',
    dailySupplyCents: 0,
    exportFeedInCents: 0,
    importRates: [
      { label: 'Morning', start: '00:00', end: '12:00', centsPerKwh: 40 },
      { label: 'Free', start: '12:00', end: '15:00', centsPerKwh: 0 },
      { label: 'Evening', start: '15:00', end: '24:00', centsPerKwh: 40 },
    ],
  }

  const blocked = calculateTariffCost(parsed, touTariff)
  assert.equal(blocked.status, 'needs_start_time')
  assert.equal(blocked.totalCostDollars, null)

  const priced = calculateTariffCost(parsed, touTariff, {
    startDateTime: '2026-01-01T11:30:00',
    intervalMinutes: 30,
  })
  assert.equal(priced.status, 'priced')
  assert.equal(priced.importCostDollars, 0.4)
  assert.ok(priced.warnings.some((warning) => warning.includes('user-provided start date/time')))

  const ranked = compareTariffs(parsed, [touTariff], {
    startDateTime: '2026-01-01T11:30:00',
    intervalMinutes: 30,
  })
  assert.equal(ranked[0].tariffId, 'tou-test')
})

test('insights use blank-date ordered intervals without pretending exact dates are known', () => {
  const rows = [header]

  for (let slot = 0; slot < 48; slot += 1) {
    rows.push(row({ register: '15987#B1', type: 'Solar', value: slot >= 24 && slot < 30 ? 2 : 0 }))
  }

  for (let slot = 0; slot < 48; slot += 1) {
    const value = slot >= 30 && slot < 42 ? 1 : slot >= 24 && slot < 30 ? 0.05 : 0.1
    rows.push(row({ value }))
  }

  const parsed = parseAglUsageCsv(rows.join('\n'))
  const insights = generateUsageInsights(parsed, { intervalMinutes: 30 })

  assert.equal(parsed.hasTimestamps, false)
  assert.equal(parsed.channels.export.intervals[0].index, 0)
  assert.equal(parsed.channels.import.intervals[0].index, 0)
  assert.ok(parsed.warnings.some((warning) => warning.includes('Ordered interval values')))
  assert.equal(insights.periodDays, 1)
  assert.equal(insights.freeWindow.importKwh, 0.3)
  assert.equal(insights.freeWindow.exportKwh, 12)
  assert.equal(insights.peakWindow.importKwh, 12)
  assert.equal(insights.patterns.importPeakSlot, '15:00-15:30')
  assert.ok(insights.dataQuality.notTrusted.some((item) => item.includes('Exact dates')))
  assert.ok(insights.narratives.freeWindowSuitability.includes('shifting flexible load'))
})

test('insights label default 30-minute timing when timestamps are missing', () => {
  const rows = [header]

  for (let slot = 0; slot < 48; slot += 1) {
    rows.push(row({ value: slot === 24 ? 2 : 0.1 }))
  }

  const parsed = parseAglUsageCsv(rows.join('\n'))
  const insights = generateUsageInsights(parsed)

  assert.equal(parsed.intervalMinutes, null)
  assert.equal(insights.assumedIntervalMinutes, 30)
  assert.equal(insights.intervalTimingSource, 'default-30-minute')
  assert.ok(insights.intervalTimingLabel.includes('Defaulting to 30-minute ordered intervals'))
  assert.ok(insights.dataQuality.notTrusted.some((item) => item.includes('30-minute interval assumption')))
})
