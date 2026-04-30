import { useMemo, useState, type ChangeEvent } from 'react'

import { parseAglUsageFile, type AglUsageFileAnalysis } from '../domain/usageFile'
import {
  AGL_THREE_FOR_FREE_ASSUMPTIONS,
  calculateTariffCost,
  SIMPLE_FLAT_ASSUMPTIONS,
  type TariffCalculationResult,
  type TariffPlan,
} from '../domain/tariffs'
import type { ParsedAglUsageData } from '../domain/aglCsv'
import { generateUsageInsights, type UsageInsights } from '../domain/usageInsights'

const kwhFormatter = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 3,
  minimumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en-AU')
const moneyFormatter = new Intl.NumberFormat('en-AU', {
  currency: 'AUD',
  style: 'currency',
})
const percentFormatter = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 1,
  style: 'percent',
})

type EditableFlatPlanForm = {
  name: string
  dailySupplyCents: string
  importCents: string
  exportFeedInCents: string
}

type ComparisonSummary = {
  winnerName: string
  comparedName: string
  savingDollars: number
  isTie: boolean
}

const DEFAULT_FLAT_PLAN_FORM: EditableFlatPlanForm = {
  name: SIMPLE_FLAT_ASSUMPTIONS.name,
  dailySupplyCents: String(SIMPLE_FLAT_ASSUMPTIONS.dailySupplyCents),
  importCents: String(SIMPLE_FLAT_ASSUMPTIONS.importRates[0]?.centsPerKwh ?? 30),
  exportFeedInCents: String(SIMPLE_FLAT_ASSUMPTIONS.exportFeedInCents),
}

function formatKwh(kwh: number) {
  return `${kwhFormatter.format(kwh)} kWh`
}

function formatMoney(value: number | null) {
  return value === null ? 'Needs timing' : moneyFormatter.format(value)
}

function formatMaybeKwh(kwh: number | null) {
  return kwh === null ? 'Needs timing' : formatKwh(kwh)
}

function formatPercent(value: number | null) {
  return value === null ? 'Needs timing' : percentFormatter.format(value)
}

function formatDays(value: number | null) {
  return value === null ? 'Unknown' : `${numberFormatter.format(value)} days`
}

function formatQualityFlags(flags: Record<string, number>) {
  const entries = Object.entries(flags).sort(([left], [right]) => left.localeCompare(right))

  if (entries.length === 0) {
    return 'None detected'
  }

  return entries.map(([flag, count]) => `${flag}: ${numberFormatter.format(count)}`).join(' · ')
}

function hasDatedIntervals(data: ParsedAglUsageData) {
  return [...data.channels.import.intervals, ...data.channels.export.intervals, ...data.otherSeries.flatMap((series) => series.intervals)].some(
    (interval) => interval.start,
  )
}

function getTimestampStatus(data: ParsedAglUsageData) {
  if (!data.hasTimestamps) {
    return {
      label: 'No timestamps in file',
      detail: `${numberFormatter.format(data.missingTimestampRows)} rows are missing StartDate or EndDate. Clock labels and TOU pricing need an explicit timing assumption.`,
    }
  }

  if (data.missingTimestampRows > 0) {
    return {
      label: 'Partial timestamps',
      detail: `${numberFormatter.format(data.missingTimestampRows)} rows are missing StartDate or EndDate.`,
    }
  }

  return {
    label: 'Timestamps available',
    detail: data.intervalMinutes
      ? `${data.intervalMinutes}-minute intervals inferred from timestamps.`
      : 'Dated intervals were found, but interval length was not inferred.',
  }
}

type CalculationState = {
  flatResult: TariffCalculationResult
  touResult: TariffCalculationResult | null
  touBlockedReason: string | null
  comparisonSummary: ComparisonSummary | null
  hasDatedIntervals: boolean
  intervalMinutes: number | null
  usesAssumedTiming: boolean
}

function buildCalculationState(
  data: ParsedAglUsageData,
  startDateTime: string,
  intervalMinutesInput: string,
  flatPlan: TariffPlan,
): CalculationState {
  const datedIntervals = hasDatedIntervals(data)
  const enteredInterval = Number(intervalMinutesInput)
  const intervalMinutes = Number.isFinite(enteredInterval) && enteredInterval > 0 ? enteredInterval : data.intervalMinutes
  const trimmedStart = startDateTime.trim()
  const hasManualTiming = !datedIntervals && trimmedStart.length > 0 && Boolean(intervalMinutes)
  const sharedOptions = {
    intervalMinutes: intervalMinutes ?? undefined,
    startDateTime: hasManualTiming ? trimmedStart : undefined,
  }
  const flatResult = calculateTariffCost(data, flatPlan, sharedOptions)

  if (!datedIntervals && !hasManualTiming) {
    return {
      flatResult,
      touResult: null,
      touBlockedReason:
        'Three for Free has time-of-day windows, so it needs file timestamps or an assumed start date/time plus interval length.',
      comparisonSummary: null,
      hasDatedIntervals: datedIntervals,
      intervalMinutes,
      usesAssumedTiming: false,
    }
  }

  const touResult = calculateTariffCost(data, AGL_THREE_FOR_FREE_ASSUMPTIONS, sharedOptions)

  return {
    flatResult,
    touResult,
    touBlockedReason: null,
    comparisonSummary: buildComparisonSummary(flatResult, touResult),
    hasDatedIntervals: datedIntervals,
    intervalMinutes,
    usesAssumedTiming: hasManualTiming,
  }
}

function buildFlatPlan(form: EditableFlatPlanForm): TariffPlan {
  return {
    id: 'editable-flat-plan',
    name: form.name.trim() || 'My flat-rate plan',
    dailySupplyCents: parseNonNegativeNumber(form.dailySupplyCents, SIMPLE_FLAT_ASSUMPTIONS.dailySupplyCents),
    exportFeedInCents: parseNonNegativeNumber(form.exportFeedInCents, SIMPLE_FLAT_ASSUMPTIONS.exportFeedInCents),
    importRates: [
      {
        label: 'Flat import',
        start: '00:00',
        end: '24:00',
        centsPerKwh: parseNonNegativeNumber(
          form.importCents,
          SIMPLE_FLAT_ASSUMPTIONS.importRates[0]?.centsPerKwh ?? 30,
        ),
      },
    ],
    notes: ['Editable browser-local flat-rate plan entered from a bill or fact sheet.'],
  }
}

function parseNonNegativeNumber(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function buildComparisonSummary(
  first: TariffCalculationResult,
  second: TariffCalculationResult,
): ComparisonSummary | null {
  if (first.totalCostDollars === null || second.totalCostDollars === null) {
    return null
  }

  const [winner, compared] =
    first.totalCostDollars <= second.totalCostDollars ? [first, second] : [second, first]
  const savingDollars = Math.abs(first.totalCostDollars - second.totalCostDollars)

  return {
    winnerName: winner.tariffName,
    comparedName: compared.tariffName,
    savingDollars,
    isTie: savingDollars < 0.01,
  }
}

function CalculationCard({
  result,
  caption,
  indicative,
}: {
  result: TariffCalculationResult
  caption: string
  indicative?: boolean
}) {
  return (
    <article className="calculation-card">
      <div className="calculation-card-heading">
        <div>
          <p className="eyebrow">Calculation card</p>
          <h3>{result.tariffName}</h3>
        </div>
        {indicative ? <span className="status-pill warning-pill">Indicative only</span> : <span className="status-pill">Priced</span>}
      </div>
      <p>{caption}</p>
      <strong className="calculation-total">{formatMoney(result.totalCostDollars)}</strong>
      <div className="calculation-breakdown">
        <span>Supply {formatMoney(result.supplyCostDollars)}</span>
        <span>Import {formatMoney(result.importCostDollars)}</span>
        <span>Export credit −{formatMoney(result.exportCreditDollars)}</span>
        <span>Period {result.periodDays === null ? 'unknown' : `${result.periodDays} days`}</span>
      </div>
      {result.warnings.length > 0 ? (
        <ul className="inline-warning-list">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function InsightTextList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="insight-list-block">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function DataValueInsightsPanel({ insights }: { insights: UsageInsights }) {
  return (
    <div className="data-value-panel">
      <div className="insight-narrative-card">
        <div>
          <p className="eyebrow">Data quality</p>
          <h3>What this file can and cannot prove</h3>
          <p>{insights.narratives.dataQuality}</p>
          <p className="small-note">Timing basis: {insights.intervalTimingLabel}</p>
          <p className="small-note">Quality flags: {insights.dataQuality.qualityFlagSummary}</p>
        </div>
        <div className="quality-list-grid">
          <InsightTextList items={insights.dataQuality.trusted} title="Trusted" />
          <InsightTextList items={insights.dataQuality.notTrusted} title="Needs assumption" />
        </div>
      </div>

      <div className="metric-grid upload-metric-grid">
        <article className="sample-metric">
          <span>Approx period</span>
          <strong>{formatDays(insights.periodDays)}</strong>
          <small>
            {insights.assumedIntervalMinutes
              ? `${insights.assumedIntervalMinutes}-minute ordered intervals · ${insights.intervalTimingSource === 'timestamps' ? 'from timestamps' : 'assumption-based'}`
              : 'No interval length available'}
          </small>
        </article>
        <article className="sample-metric">
          <span>Daily import avg</span>
          <strong>{formatMaybeKwh(insights.totals.averageDailyImportKwh)}</strong>
        </article>
        <article className="sample-metric">
          <span>Daily export avg</span>
          <strong>{formatMaybeKwh(insights.totals.averageDailyExportKwh)}</strong>
        </article>
        <article className="sample-metric">
          <span>Export / import</span>
          <strong>{formatPercent(insights.totals.exportToImportRatio)}</strong>
        </article>
      </div>

      <div className="insight-card-grid">
        <article className="calculation-card insight-card">
          <p className="eyebrow">Interval pattern</p>
          <h3>Load shape</h3>
          <p>
            Import peaks around <strong>{insights.patterns.importPeakSlot ?? 'unknown'}</strong> at{' '}
            <strong>{formatMaybeKwh(insights.patterns.importPeakAverageKwh)}</strong> per interval on average.
            The highest import interval is{' '}
            <strong>{formatMaybeKwh(insights.patterns.highestImportIntervalKwh)}</strong>
            {insights.patterns.highestImportIntervalPosition
              ? ` at ${insights.patterns.highestImportIntervalPosition}`
              : ''}
            .
          </p>
          <div className="calculation-breakdown">
            <span>Max ordered-day import {formatMaybeKwh(insights.patterns.highestDailyImportKwh)}</span>
            <span>Max ordered-day export {formatMaybeKwh(insights.patterns.highestDailyExportKwh)}</span>
          </div>
        </article>

        <article className="calculation-card insight-card">
          <p className="eyebrow">Free-window fit</p>
          <h3>
            {insights.freeWindow.start}-{insights.freeWindow.end}
          </h3>
          <p>{insights.narratives.freeWindowSuitability}</p>
          <div className="calculation-breakdown">
            <span>Import there {formatMaybeKwh(insights.freeWindow.importKwh)}</span>
            <span>Import share {formatPercent(insights.freeWindow.importShare)}</span>
            <span>Peak import {formatMaybeKwh(insights.peakWindow.importKwh)}</span>
            <span>Peak share {formatPercent(insights.peakWindow.importShare)}</span>
          </div>
        </article>

        <article className="calculation-card insight-card">
          <p className="eyebrow">Solar opportunity</p>
          <h3>Export-heavy profile</h3>
          <p>{insights.narratives.solarOpportunity}</p>
          <div className="calculation-breakdown">
            <span>Export peak {insights.patterns.exportPeakSlot ?? 'unknown'}</span>
            <span>Avg peak export {formatMaybeKwh(insights.patterns.exportPeakAverageKwh)}</span>
            <span>Free-window export {formatMaybeKwh(insights.freeWindow.exportKwh)}</span>
            <span>Export share {formatPercent(insights.freeWindow.exportShare)}</span>
          </div>
        </article>

        <article className="calculation-card insight-card">
          <p className="eyebrow">Plan narrative</p>
          <h3>What the calculator can say now</h3>
          <p>{insights.narratives.planFit}</p>
          <p className="small-note">
            Exact TOU savings should be treated as a scenario unless the file supplies timestamps or the start
            datetime is known.
          </p>
        </article>
      </div>
    </div>
  )
}

export function UploadAnalyseSection() {
  const [analysis, setAnalysis] = useState<AglUsageFileAnalysis | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [startDateTime, setStartDateTime] = useState('')
  const [intervalMinutesInput, setIntervalMinutesInput] = useState('30')
  const [flatPlanForm, setFlatPlanForm] = useState<EditableFlatPlanForm>(DEFAULT_FLAT_PLAN_FORM)

  const flatPlan = useMemo(() => buildFlatPlan(flatPlanForm), [flatPlanForm])

  const calculationState = useMemo(() => {
    if (!analysis) {
      return null
    }

    return buildCalculationState(analysis.parsed, startDateTime, intervalMinutesInput, flatPlan)
  }, [analysis, flatPlan, intervalMinutesInput, startDateTime])

  const insights = useMemo(() => {
    if (!analysis) {
      return null
    }

    return generateUsageInsights(analysis.parsed, {
      flatResult: calculationState?.flatResult ?? null,
      intervalMinutes: calculationState?.intervalMinutes ?? null,
      timeOfUseResult: calculationState?.touResult ?? null,
    })
  }, [analysis, calculationState])

  const timestampStatus = analysis ? getTimestampStatus(analysis.parsed) : null
  const uniqueWarnings = analysis ? Array.from(new Set(analysis.warnings)) : []

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setIsReading(true)
    setUploadError(null)

    try {
      const nextAnalysis = await parseAglUsageFile(file)
      setAnalysis(nextAnalysis)
      setStartDateTime('')

      if (nextAnalysis.parsed.intervalMinutes) {
        setIntervalMinutesInput(String(nextAnalysis.parsed.intervalMinutes))
      }
    } catch (error) {
      setAnalysis(null)
      setUploadError(error instanceof Error ? error.message : 'Could not read this usage file.')
    } finally {
      setIsReading(false)
    }
  }

  function updateFlatPlanField(field: keyof EditableFlatPlanForm, value: string) {
    setFlatPlanForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  return (
    <section className="section-band upload-analyse-section" id="upload-analyse">
      <div className="section-heading upload-heading">
        <p className="eyebrow">Try it locally</p>
        <h2>Upload an AGL usage CSV or ZIP and analyse it in your browser.</h2>
        <p>
          Nothing is sent anywhere: the file is read by this page, parsed locally, then priced against the simple
          flat and AGL Three for Free style assumptions already in the calculator model.
        </p>
      </div>

      <div className="upload-panel">
        <label className="file-dropzone">
          <span>Choose AGL usage file</span>
          <strong>.csv or .zip</strong>
          <input accept=".csv,.zip,text/csv,application/zip" onChange={handleFileChange} type="file" />
        </label>
        <div className="upload-help">
          <p>
            Use the AGL <strong>MyUsageData</strong> export directly, or a ZIP that contains the CSV. Analysis is
            browser-local only.
          </p>
          {isReading ? <span className="status-pill">Reading file…</span> : null}
          {uploadError ? <div className="upload-error">{uploadError}</div> : null}
        </div>
      </div>

      {analysis ? (
        <div className="analysis-results">
          <div className="result-summary-card">
            <div>
              <p className="eyebrow">Parsed file</p>
              <h3>{analysis.sourceFileName}</h3>
              {analysis.csvFileName !== analysis.sourceFileName ? <p>CSV inside ZIP: {analysis.csvFileName}</p> : null}
            </div>
            <span className="status-pill success-pill">Ready</span>
          </div>

          <div className="metric-grid upload-metric-grid">
            <article className="sample-metric">
              <span>Total rows</span>
              <strong>{numberFormatter.format(analysis.parsed.rowCount)}</strong>
            </article>
            <article className="sample-metric">
              <span>Rows per channel</span>
              <strong>
                Import {numberFormatter.format(analysis.parsed.channels.import.rowCount)} · Export{' '}
                {numberFormatter.format(analysis.parsed.channels.export.rowCount)}
                {analysis.parsed.otherSeries.length > 0
                  ? ` · Other ${analysis.parsed.otherSeries
                      .map((series) => numberFormatter.format(series.rowCount))
                      .join(' / ')}`
                  : ''}
              </strong>
            </article>
            <article className="sample-metric">
              <span>Import kWh</span>
              <strong>{formatKwh(analysis.parsed.channels.import.totalKwh)}</strong>
            </article>
            <article className="sample-metric">
              <span>Export / solar kWh</span>
              <strong>{formatKwh(analysis.parsed.channels.export.totalKwh)}</strong>
            </article>
            <article className="sample-metric wide-metric">
              <span>Quality flags</span>
              <strong>{formatQualityFlags(analysis.parsed.qualityFlags)}</strong>
            </article>
            <article className="sample-metric wide-metric">
              <span>Timestamps</span>
              <strong>{timestampStatus?.label}</strong>
              <small>{timestampStatus?.detail}</small>
            </article>
          </div>

          {insights ? <DataValueInsightsPanel insights={insights} /> : null}

          {!calculationState?.hasDatedIntervals ? (
            <div className="timing-input-card">
              <div>
                <p className="eyebrow">Optional timing assumption</p>
                <h3>Add a start datetime to unlock the Three for Free demo calculation.</h3>
                <p>
                  If the exact first interval time is unknown, treat the time-of-use result as indicative only. The
                  interval length defaults to 30 minutes for common AGL interval exports, but you can change it here.
                  Flat pricing can still run without a time of day.
                </p>
              </div>
              <label>
                Start datetime
                <input
                  onChange={(event) => setStartDateTime(event.target.value)}
                  type="datetime-local"
                  value={startDateTime}
                />
              </label>
              <label>
                Interval minutes
                <input
                  min="1"
                  onChange={(event) => setIntervalMinutesInput(event.target.value)}
                  step="1"
                  type="number"
                  value={intervalMinutesInput}
                />
              </label>
            </div>
          ) : null}

          <div className="tariff-editor-card">
            <div>
              <p className="eyebrow">Bill rates</p>
              <h3>Enter a flat-rate plan from your bill or fact sheet.</h3>
              <p>
                These numbers stay in the browser and immediately reprice the uploaded usage file. Use cents,
                not dollars, for each tariff input.
              </p>
            </div>
            <div className="tariff-input-grid">
              <label>
                Plan name
                <input
                  onChange={(event) => updateFlatPlanField('name', event.target.value)}
                  type="text"
                  value={flatPlanForm.name}
                />
              </label>
              <label>
                Daily supply c/day
                <input
                  min="0"
                  onChange={(event) => updateFlatPlanField('dailySupplyCents', event.target.value)}
                  step="0.01"
                  type="number"
                  value={flatPlanForm.dailySupplyCents}
                />
              </label>
              <label>
                Import c/kWh
                <input
                  min="0"
                  onChange={(event) => updateFlatPlanField('importCents', event.target.value)}
                  step="0.01"
                  type="number"
                  value={flatPlanForm.importCents}
                />
              </label>
              <label>
                Feed-in c/kWh
                <input
                  min="0"
                  onChange={(event) => updateFlatPlanField('exportFeedInCents', event.target.value)}
                  step="0.01"
                  type="number"
                  value={flatPlanForm.exportFeedInCents}
                />
              </label>
            </div>
          </div>

          {calculationState?.comparisonSummary ? (
            <div className="comparison-summary-card">
              <div>
                <p className="eyebrow">Local comparison</p>
                <h3>{calculationState.comparisonSummary.isTie ? 'The priced plans are effectively tied.' : calculationState.comparisonSummary.winnerName}</h3>
                <p>
                  {calculationState.comparisonSummary.isTie
                    ? 'The two priced tariff assumptions are within one cent for this uploaded usage file.'
                    : `${calculationState.comparisonSummary.winnerName} is ${formatMoney(
                        calculationState.comparisonSummary.savingDollars,
                      )} cheaper than ${calculationState.comparisonSummary.comparedName} for this data period.`}
                </p>
              </div>
              <span className={`status-pill ${calculationState.usesAssumedTiming ? 'warning-pill' : 'success-pill'}`}>
                {calculationState.usesAssumedTiming
                  ? 'Scenario only'
                  : calculationState.comparisonSummary.isTie
                    ? 'No material gap'
                    : `${formatMoney(calculationState.comparisonSummary.savingDollars)} saving`}
              </span>
            </div>
          ) : null}

          <div className="calculation-grid">
            {calculationState ? (
              <CalculationCard
                caption="Editable flat import rate plus feed-in credit from the bill-rate inputs above. Time of day is not needed for this calculation."
                indicative={!calculationState.hasDatedIntervals && Boolean(calculationState.intervalMinutes)}
                result={calculationState.flatResult}
              />
            ) : null}
            {calculationState?.touResult ? (
              <CalculationCard
                caption={
                  calculationState.usesAssumedTiming
                    ? 'Uses your supplied start datetime and interval length to replay the free 12:00–15:00 window.'
                    : 'Uses timestamps from the file to replay the free 12:00–15:00 window.'
                }
                indicative={calculationState.usesAssumedTiming}
                result={calculationState.touResult}
              />
            ) : calculationState?.touBlockedReason ? (
              <article className="calculation-card blocked-card">
                <p className="eyebrow">TOU blocked</p>
                <h3>{AGL_THREE_FOR_FREE_ASSUMPTIONS.name}</h3>
                <p>{calculationState.touBlockedReason}</p>
              </article>
            ) : null}
          </div>

          <div className="warnings-panel">
            <p className="eyebrow">Detected warnings / errors</p>
            {uniqueWarnings.length > 0 ? (
              <ul>
                {uniqueWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>No parser warnings or upload errors detected.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
