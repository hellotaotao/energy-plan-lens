import type { MeterInterval, ParsedAglUsageData } from './aglCsv'

export type DayClass = 'weekday' | 'weekend'

export type ImportRateWindow = {
  label: string
  start: string
  end: string
  centsPerKwh: number
  days?: DayClass[]
}

export type TariffPlan = {
  id: string
  name: string
  dailySupplyCents: number
  importRates: ImportRateWindow[]
  exportFeedInCents: number
  notes?: string[]
}

export type TariffCalculationOptions = {
  startDateTime?: string | Date
  intervalMinutes?: number
  periodDays?: number
  demoMode?: boolean
}

export type TariffCalculationResult = {
  tariffId: string
  tariffName: string
  status: 'priced' | 'needs_start_time'
  totalCostDollars: number | null
  supplyCostDollars: number
  importCostDollars: number
  exportCreditDollars: number
  importKwh: number
  exportKwh: number
  periodDays: number | null
  warnings: string[]
}

export const AGL_THREE_FOR_FREE_ASSUMPTIONS: TariffPlan = {
  id: 'agl-three-for-free-assumptions',
  name: 'AGL Three for Free style assumptions',
  dailySupplyCents: 120,
  exportFeedInCents: 5,
  importRates: [
    { label: 'General import', start: '00:00', end: '12:00', centsPerKwh: 32 },
    { label: 'Free energy window', start: '12:00', end: '15:00', centsPerKwh: 0 },
    { label: 'General import', start: '15:00', end: '24:00', centsPerKwh: 32 },
  ],
  notes: [
    'Illustrative defaults only; edit daily supply, import rates and feed-in credit before relying on results.',
    'Time-of-use pricing needs dated interval data or a user-provided start date/time.',
  ],
}

export const SIMPLE_FLAT_ASSUMPTIONS: TariffPlan = {
  id: 'simple-flat-assumptions',
  name: 'Simple flat-rate assumptions',
  dailySupplyCents: 110,
  exportFeedInCents: 5,
  importRates: [{ label: 'Flat import', start: '00:00', end: '24:00', centsPerKwh: 30 }],
  notes: ['Illustrative flat-rate comparator for sanity-checking time-of-use plans.'],
}

export function calculateTariffCost(
  data: ParsedAglUsageData,
  tariff: TariffPlan,
  options: TariffCalculationOptions = {},
): TariffCalculationResult {
  const warnings: string[] = []
  const importSeries = data.channels.import
  const exportSeries = data.channels.export
  const requiresTimeOfDay = tariff.importRates.length > 1 || !isFullDayWindow(tariff.importRates[0])
  const hasDatedIntervals = importSeries.intervals.some((interval) => interval.start)
  const providedStart = parseStartDate(options.startDateTime)
  let intervalMinutes = options.intervalMinutes ?? data.intervalMinutes
  let syntheticStart = providedStart

  if (!hasDatedIntervals && providedStart) {
    warnings.push('Using the user-provided start date/time because the meter file has no interval timestamps.')
  }

  if (!hasDatedIntervals && intervalMinutes) {
    warnings.push(
      `Using ${intervalMinutes}-minute interval positions because the meter file has no timestamps; period and time-of-use results are assumption-based.`,
    )
  }

  if (requiresTimeOfDay && !hasDatedIntervals && !syntheticStart) {
    if (!options.demoMode) {
      warnings.push(
        'Time-of-use pricing needs dated interval data or a user-provided start date/time. No exact comparison was calculated.',
      )
      return emptyResult(data, tariff, warnings, options.periodDays ?? null)
    }

    syntheticStart = new Date('2000-01-01T00:00:00')
    intervalMinutes ??= 30
    warnings.push(
      'Demo mode: the file has no timestamps, so intervals were priced from a synthetic midnight start and should not be treated as an exact bill comparison.',
    )
  }

  if ((requiresTimeOfDay || syntheticStart) && !hasDatedIntervals && !intervalMinutes) {
    warnings.push('An interval length is required when pricing index-based rows against time-of-day rates.')
    return emptyResult(data, tariff, warnings, options.periodDays ?? null)
  }

  const periodDays = inferPeriodDays(data, intervalMinutes, options.periodDays)

  if (periodDays === null) {
    warnings.push('Daily supply charge was not applied because the data period could not be inferred.')
  }

  const importCostDollars = calculateImportCost(importSeries.intervals, tariff, syntheticStart, intervalMinutes)
  const exportCreditDollars = roundMoney((exportSeries.totalKwh * tariff.exportFeedInCents) / 100)
  const supplyCostDollars = periodDays === null ? 0 : roundMoney((periodDays * tariff.dailySupplyCents) / 100)
  const totalCostDollars = roundMoney(supplyCostDollars + importCostDollars - exportCreditDollars)

  return {
    tariffId: tariff.id,
    tariffName: tariff.name,
    status: 'priced',
    totalCostDollars,
    supplyCostDollars,
    importCostDollars,
    exportCreditDollars,
    importKwh: importSeries.totalKwh,
    exportKwh: exportSeries.totalKwh,
    periodDays,
    warnings,
  }
}

export function compareTariffs(
  data: ParsedAglUsageData,
  tariffs: TariffPlan[],
  options: TariffCalculationOptions = {},
): TariffCalculationResult[] {
  return tariffs
    .map((tariff) => calculateTariffCost(data, tariff, options))
    .sort((left, right) => (left.totalCostDollars ?? Number.POSITIVE_INFINITY) - (right.totalCostDollars ?? Number.POSITIVE_INFINITY))
}

function calculateImportCost(
  intervals: MeterInterval[],
  tariff: TariffPlan,
  syntheticStart: Date | undefined,
  intervalMinutes: number | null,
): number {
  if (tariff.importRates.length === 1 && isFullDayWindow(tariff.importRates[0])) {
    const totalKwh = intervals.reduce((total, interval) => total + interval.kwh, 0)
    return roundMoney((totalKwh * tariff.importRates[0].centsPerKwh) / 100)
  }

  const cost = intervals.reduce((total, interval) => {
    const timestamp = interval.start ?? syntheticTimestamp(syntheticStart, interval.index, intervalMinutes)
    const rate = timestamp ? rateForTimestamp(tariff.importRates, timestamp) : tariff.importRates[0]
    return total + (interval.kwh * rate.centsPerKwh) / 100
  }, 0)

  return roundMoney(cost)
}

function syntheticTimestamp(start: Date | undefined, index: number, intervalMinutes: number | null): Date | undefined {
  if (!start || !intervalMinutes) {
    return undefined
  }

  return new Date(start.getTime() + index * intervalMinutes * 60000)
}

function rateForTimestamp(rates: ImportRateWindow[], timestamp: Date): ImportRateWindow {
  const minuteOfDay = timestamp.getHours() * 60 + timestamp.getMinutes()
  const dayClass: DayClass = timestamp.getDay() === 0 || timestamp.getDay() === 6 ? 'weekend' : 'weekday'
  return (
    rates.find((rate) => {
      const daysMatch = !rate.days || rate.days.includes(dayClass)
      return daysMatch && timeInWindow(minuteOfDay, parseClock(rate.start), parseClock(rate.end))
    }) ?? rates[0]
  )
}

function timeInWindow(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) {
    return true
  }

  if (start < end) {
    return minuteOfDay >= start && minuteOfDay < end
  }

  return minuteOfDay >= start || minuteOfDay < end
}

function parseClock(value: string): number {
  if (value === '24:00') {
    return 1440
  }

  const [hour = '0', minute = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute)
}

function isFullDayWindow(rate: ImportRateWindow | undefined): boolean {
  if (!rate) {
    return false
  }

  return parseClock(rate.start) === 0 && parseClock(rate.end) === 1440 && !rate.days
}

function inferPeriodDays(
  data: ParsedAglUsageData,
  intervalMinutes: number | null,
  explicitPeriodDays: number | undefined,
): number | null {
  if (explicitPeriodDays !== undefined) {
    return explicitPeriodDays
  }

  if (intervalMinutes) {
    const intervalCount = Math.max(data.channels.import.rowCount, data.channels.export.rowCount)
    return roundPeriod((intervalCount * intervalMinutes) / 1440)
  }

  const datedIntervals = [...data.channels.import.intervals, ...data.channels.export.intervals].filter(
    (interval) => interval.start,
  )

  if (datedIntervals.length < 2) {
    return null
  }

  const startTimes = datedIntervals.map((interval) => interval.start?.getTime() ?? 0)
  const minStart = Math.min(...startTimes)
  const maxStart = Math.max(...startTimes)
  return roundPeriod((maxStart - minStart) / 86400000)
}

function parseStartDate(value: string | Date | undefined): Date | undefined {
  if (!value) {
    return undefined
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function emptyResult(
  data: ParsedAglUsageData,
  tariff: TariffPlan,
  warnings: string[],
  periodDays: number | null,
): TariffCalculationResult {
  return {
    tariffId: tariff.id,
    tariffName: tariff.name,
    status: 'needs_start_time',
    totalCostDollars: null,
    supplyCostDollars: 0,
    importCostDollars: 0,
    exportCreditDollars: 0,
    importKwh: data.channels.import.totalKwh,
    exportKwh: data.channels.export.totalKwh,
    periodDays,
    warnings,
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundPeriod(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}
