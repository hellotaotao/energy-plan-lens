import type { MeterInterval, MeterSeries, ParsedAglUsageData } from './aglCsv'
import type { TariffCalculationResult } from './tariffs'

export type ClockWindow = {
  label: string
  start: string
  end: string
}

export type UsageInsightOptions = {
  intervalMinutes?: number | null
  freeWindow?: ClockWindow
  peakWindow?: ClockWindow
  flatResult?: TariffCalculationResult | null
  timeOfUseResult?: TariffCalculationResult | null
}

export type WindowKwhInsight = {
  label: string
  start: string
  end: string
  importKwh: number
  importShare: number
  exportKwh: number
  exportShare: number
}

export type UsageInsights = {
  assumedIntervalMinutes: number | null
  intervalTimingSource: 'timestamps' | 'user' | 'row-count' | 'default-30-minute' | 'none'
  intervalTimingLabel: string
  periodDays: number | null
  dataQuality: {
    trusted: string[]
    notTrusted: string[]
    qualityFlagSummary: string
  }
  totals: {
    importKwh: number
    exportKwh: number
    netImportKwh: number
    exportToImportRatio: number | null
    averageDailyImportKwh: number | null
    averageDailyExportKwh: number | null
  }
  patterns: {
    importPeakSlot: string | null
    importPeakAverageKwh: number | null
    exportPeakSlot: string | null
    exportPeakAverageKwh: number | null
    highestImportIntervalKwh: number | null
    highestImportIntervalPosition: string | null
    highestDailyImportKwh: number | null
    highestDailyExportKwh: number | null
  }
  freeWindow: WindowKwhInsight
  peakWindow: WindowKwhInsight
  narratives: {
    dataQuality: string
    freeWindowSuitability: string
    solarOpportunity: string
    planFit: string
  }
}

type SlotSummary = {
  slot: number
  averageKwh: number
}

type IntervalChoice = {
  minutes: number | null
  source: UsageInsights['intervalTimingSource']
  label: string
}

const DEFAULT_INTERVAL_MINUTES = 30
const DEFAULT_FREE_WINDOW: ClockWindow = { label: 'Free window', start: '12:00', end: '15:00' }
const DEFAULT_PEAK_WINDOW: ClockWindow = { label: 'Evening peak', start: '15:00', end: '21:00' }

export function generateUsageInsights(
  data: ParsedAglUsageData,
  options: UsageInsightOptions = {},
): UsageInsights {
  const intervalChoice = chooseIntervalMinutes(data, options.intervalMinutes)
  const assumedIntervalMinutes = intervalChoice.minutes
  const periodDays = assumedIntervalMinutes
    ? roundTo((Math.max(data.channels.import.rowCount, data.channels.export.rowCount) * assumedIntervalMinutes) / 1440, 2)
    : null
  const freeWindow = options.freeWindow ?? DEFAULT_FREE_WINDOW
  const peakWindow = options.peakWindow ?? DEFAULT_PEAK_WINDOW
  const freeWindowInsight = summarizeWindow(data, freeWindow, assumedIntervalMinutes)
  const peakWindowInsight = summarizeWindow(data, peakWindow, assumedIntervalMinutes)
  const importPeak = summarizePeakSlot(data.channels.import, assumedIntervalMinutes)
  const exportPeak = summarizePeakSlot(data.channels.export, assumedIntervalMinutes)
  const highestImport = summarizeHighestInterval(data.channels.import, assumedIntervalMinutes)
  const highestDailyImportKwh = summarizeHighestDailyTotal(data.channels.import, assumedIntervalMinutes)
  const highestDailyExportKwh = summarizeHighestDailyTotal(data.channels.export, assumedIntervalMinutes)
  const trusted = buildTrustedFacts(data, assumedIntervalMinutes)
  const notTrusted = buildNotTrustedFacts(data, assumedIntervalMinutes)
  const totals = {
    importKwh: data.channels.import.totalKwh,
    exportKwh: data.channels.export.totalKwh,
    netImportKwh: roundTo(data.channels.import.totalKwh - data.channels.export.totalKwh, 3),
    exportToImportRatio:
      data.channels.import.totalKwh > 0 ? roundTo(data.channels.export.totalKwh / data.channels.import.totalKwh, 3) : null,
    averageDailyImportKwh: periodDays ? roundTo(data.channels.import.totalKwh / periodDays, 2) : null,
    averageDailyExportKwh: periodDays ? roundTo(data.channels.export.totalKwh / periodDays, 2) : null,
  }

  return {
    assumedIntervalMinutes,
    intervalTimingSource: intervalChoice.source,
    intervalTimingLabel: intervalChoice.label,
    periodDays,
    dataQuality: {
      trusted,
      notTrusted,
      qualityFlagSummary: formatQualityFlags(data.qualityFlags),
    },
    totals,
    patterns: {
      importPeakSlot: importPeak ? formatSlot(importPeak.slot, assumedIntervalMinutes) : null,
      importPeakAverageKwh: importPeak?.averageKwh ?? null,
      exportPeakSlot: exportPeak ? formatSlot(exportPeak.slot, assumedIntervalMinutes) : null,
      exportPeakAverageKwh: exportPeak?.averageKwh ?? null,
      highestImportIntervalKwh: highestImport?.kwh ?? null,
      highestImportIntervalPosition: highestImport?.position ?? null,
      highestDailyImportKwh,
      highestDailyExportKwh,
    },
    freeWindow: freeWindowInsight,
    peakWindow: peakWindowInsight,
    narratives: {
      dataQuality: buildDataQualityNarrative(data, assumedIntervalMinutes),
      freeWindowSuitability: buildFreeWindowNarrative(freeWindowInsight, peakWindowInsight, assumedIntervalMinutes),
      solarOpportunity: buildSolarNarrative(totals.exportToImportRatio, freeWindowInsight),
      planFit: buildPlanFitNarrative(options.flatResult, options.timeOfUseResult, assumedIntervalMinutes),
    },
  }
}

function chooseIntervalMinutes(data: ParsedAglUsageData, providedIntervalMinutes: number | null | undefined): IntervalChoice {
  if (providedIntervalMinutes && providedIntervalMinutes > 0) {
    return {
      minutes: providedIntervalMinutes,
      source: data.hasTimestamps ? 'timestamps' : 'user',
      label: data.hasTimestamps
        ? `${providedIntervalMinutes}-minute intervals from file timestamps.`
        : `${providedIntervalMinutes}-minute intervals supplied by the user because timestamps are missing.`,
    }
  }

  if (data.intervalMinutes && data.intervalMinutes > 0) {
    return {
      minutes: data.intervalMinutes,
      source: data.intervalInference ?? (data.hasTimestamps ? 'timestamps' : 'row-count'),
      label:
        data.intervalInference === 'timestamps'
          ? `${data.intervalMinutes}-minute intervals inferred from file timestamps.`
          : `${data.intervalMinutes}-minute intervals inferred from row count because timestamps are missing.`,
    }
  }

  if (!data.hasTimestamps && Math.max(data.channels.import.rowCount, data.channels.export.rowCount) >= 48) {
    return {
      minutes: DEFAULT_INTERVAL_MINUTES,
      source: 'default-30-minute',
      label: 'Defaulting to 30-minute ordered intervals because timestamps are missing and no safe interval length was found.',
    }
  }

  return {
    minutes: null,
    source: 'none',
    label: 'No interval timing is available.',
  }
}

function buildTrustedFacts(data: ParsedAglUsageData, assumedIntervalMinutes: number | null): string[] {
  const facts = [
    `${data.rowCount.toLocaleString('en-AU')} AGL rows were parsed.`,
    `Usage/import and Solar/export are separated by register description and code.`,
    `Channel totals and quality flags come directly from ProfileReadValue.`,
  ]

  if (assumedIntervalMinutes) {
    facts.push('Rows keep their original file order for totals and sequence checks.')
  }

  return facts
}

function buildNotTrustedFacts(data: ParsedAglUsageData, assumedIntervalMinutes: number | null): string[] {
  const facts: string[] = []

  if (!data.hasTimestamps) {
    facts.push('Exact dates, weekdays, seasons and public holidays cannot be trusted because StartDate and EndDate are blank.')
  } else if (data.missingTimestampRows > 0) {
    facts.push('Some exact interval timestamps are missing, so dated analysis is incomplete.')
  }

  if (assumedIntervalMinutes && !data.hasTimestamps) {
    facts.push(
      `Clock labels use a ${assumedIntervalMinutes}-minute interval assumption and assume the first interval is midnight; shift them if the retailer export started at another time.`,
    )
  }

  if (data.missingIdentifierFields.accountNumber === data.rowCount || data.missingIdentifierFields.nmi === data.rowCount) {
    facts.push('AccountNumber and NMI are not available for identity or meter-level validation.')
  }

  return facts
}

function summarizeWindow(
  data: ParsedAglUsageData,
  window: ClockWindow,
  intervalMinutes: number | null,
): WindowKwhInsight {
  return {
    ...window,
    importKwh: sumWindow(data.channels.import, window, intervalMinutes),
    importShare: share(sumWindow(data.channels.import, window, intervalMinutes), data.channels.import.totalKwh),
    exportKwh: sumWindow(data.channels.export, window, intervalMinutes),
    exportShare: share(sumWindow(data.channels.export, window, intervalMinutes), data.channels.export.totalKwh),
  }
}

function sumWindow(series: MeterSeries, window: ClockWindow, intervalMinutes: number | null): number {
  const startMinute = parseClock(window.start)
  const endMinute = parseClock(window.end)
  const total = series.intervals.reduce((sum, interval) => {
    const minute = minuteOfDay(interval, intervalMinutes)
    return minute !== null && timeInWindow(minute, startMinute, endMinute) ? sum + interval.kwh : sum
  }, 0)

  return roundTo(total, 3)
}

function summarizePeakSlot(series: MeterSeries, intervalMinutes: number | null): SlotSummary | null {
  if (!intervalMinutes || series.intervals.length === 0) {
    return null
  }

  const slotsPerDay = Math.round(1440 / intervalMinutes)
  const sums = new Array<number>(slotsPerDay).fill(0)
  const counts = new Array<number>(slotsPerDay).fill(0)

  for (const interval of series.intervals) {
    const slot = slotOfDay(interval, intervalMinutes)

    if (slot === null) {
      continue
    }

    sums[slot] += interval.kwh
    counts[slot] += 1
  }

  let best: SlotSummary | null = null

  for (let slot = 0; slot < slotsPerDay; slot += 1) {
    if (counts[slot] === 0) {
      continue
    }

    const averageKwh = roundTo(sums[slot] / counts[slot], 3)

    if (!best || averageKwh > best.averageKwh) {
      best = { slot, averageKwh }
    }
  }

  return best
}

function summarizeHighestInterval(
  series: MeterSeries,
  intervalMinutes: number | null,
): { kwh: number; position: string } | null {
  const highest = series.intervals.reduce<MeterInterval | null>(
    (best, interval) => (!best || interval.kwh > best.kwh ? interval : best),
    null,
  )

  if (!highest) {
    return null
  }

  const day = intervalMinutes ? Math.floor((highest.index * intervalMinutes) / 1440) + 1 : null
  const slot = intervalMinutes ? formatSlot(slotOfDay(highest, intervalMinutes) ?? 0, intervalMinutes) : null

  return {
    kwh: roundTo(highest.kwh, 3),
    position: day && slot ? `ordered day ${day}, ${slot}` : `row ${highest.sourceRowNumber.toLocaleString('en-AU')}`,
  }
}

function summarizeHighestDailyTotal(series: MeterSeries, intervalMinutes: number | null): number | null {
  if (!intervalMinutes || series.intervals.length === 0) {
    return null
  }

  const totals = new Map<number, number>()

  for (const interval of series.intervals) {
    const day = Math.floor((interval.index * intervalMinutes) / 1440)
    totals.set(day, (totals.get(day) ?? 0) + interval.kwh)
  }

  return roundTo(Math.max(...totals.values()), 3)
}

function minuteOfDay(interval: MeterInterval, intervalMinutes: number | null): number | null {
  if (interval.start) {
    return interval.start.getHours() * 60 + interval.start.getMinutes()
  }

  if (!intervalMinutes) {
    return null
  }

  return (interval.index * intervalMinutes) % 1440
}

function slotOfDay(interval: MeterInterval, intervalMinutes: number): number | null {
  const minute = minuteOfDay(interval, intervalMinutes)
  return minute === null ? null : Math.floor(minute / intervalMinutes)
}

function buildDataQualityNarrative(data: ParsedAglUsageData, assumedIntervalMinutes: number | null): string {
  if (!data.hasTimestamps && assumedIntervalMinutes) {
    return `The usage values are useful for totals and ordered interval patterns, but exact calendar analysis is blocked by blank StartDate and EndDate fields. Clock-based patterns use a clearly labelled ${assumedIntervalMinutes}-minute timing assumption.`
  }

  if (!data.hasTimestamps) {
    return 'The usage values are useful for totals only; interval timing needs a defensible interval-length assumption before pattern analysis.'
  }

  return 'The file includes timestamps, so totals, interval order and time-of-day pricing can be analysed from the meter data.'
}

function buildFreeWindowNarrative(
  freeWindow: WindowKwhInsight,
  peakWindow: WindowKwhInsight,
  intervalMinutes: number | null,
): string {
  if (!intervalMinutes) {
    return 'Free-window suitability cannot be assessed until interval length or timestamps are available.'
  }

  if (freeWindow.importShare < 0.08) {
    return `Only ${formatPercent(freeWindow.importShare)} of import sits in the free window while ${formatPercent(
      peakWindow.importShare,
    )} sits in the peak window, so the plan fit depends on shifting flexible load rather than current behaviour.`
  }

  return `${formatPercent(freeWindow.importShare)} of import already sits in the free window, so the plan has natural load-shift value before behaviour changes.`
}

function buildSolarNarrative(exportToImportRatio: number | null, freeWindow: WindowKwhInsight): string {
  if (exportToImportRatio === null) {
    return 'Solar opportunity cannot be assessed without import kWh.'
  }

  if (exportToImportRatio >= 1) {
    return `Export is ${roundTo(exportToImportRatio, 2)}x import, with ${formatPercent(
      freeWindow.exportShare,
    )} of export landing in the free-window clock position; batteries, hot water and EV charging are the obvious value levers.`
  }

  return `Export is ${formatPercent(exportToImportRatio)} of import, so feed-in credit matters but import-rate savings remain the main lever.`
}

function buildPlanFitNarrative(
  flatResult: TariffCalculationResult | null | undefined,
  timeOfUseResult: TariffCalculationResult | null | undefined,
  intervalMinutes: number | null,
): string {
  if (!flatResult || !timeOfUseResult || flatResult.totalCostDollars === null || timeOfUseResult.totalCostDollars === null) {
    return intervalMinutes
      ? 'Flat pricing can be trusted from totals; time-of-use savings need dated intervals or a clearly stated start-time assumption.'
      : 'Flat pricing can be trusted from totals; time-of-use savings are blocked until interval timing is known.'
  }

  const difference = Math.abs(flatResult.totalCostDollars - timeOfUseResult.totalCostDollars)
  const winner =
    flatResult.totalCostDollars <= timeOfUseResult.totalCostDollars ? flatResult.tariffName : timeOfUseResult.tariffName
  const loser =
    flatResult.totalCostDollars <= timeOfUseResult.totalCostDollars ? timeOfUseResult.tariffName : flatResult.tariffName

  if (difference < 0.01) {
    return 'The priced tariff assumptions are effectively tied for this uploaded data period.'
  }

  return `${winner} is $${difference.toFixed(2)} cheaper than ${loser} for the priced data period.`
}

function formatQualityFlags(flags: Record<string, number>): string {
  const entries = Object.entries(flags).sort(([left], [right]) => left.localeCompare(right))

  if (entries.length === 0) {
    return 'No quality flags detected.'
  }

  return entries.map(([flag, count]) => `${flag}: ${count.toLocaleString('en-AU')}`).join(' · ')
}

function share(value: number, total: number): number {
  return total > 0 ? roundTo(value / total, 4) : 0
}

function formatPercent(value: number): string {
  return `${roundTo(value * 100, 1)}%`
}

function formatSlot(slot: number, intervalMinutes: number | null): string {
  if (!intervalMinutes) {
    return 'unknown interval'
  }

  const start = slot * intervalMinutes
  const end = start + intervalMinutes
  return `${formatClock(start)}-${formatClock(end)}`
}

function parseClock(value: string): number {
  if (value === '24:00') {
    return 1440
  }

  const [hour = '0', minute = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute)
}

function formatClock(totalMinutes: number): string {
  const normalized = totalMinutes % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
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

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}
