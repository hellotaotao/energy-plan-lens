export type EnergyChannel = 'import' | 'export' | 'other'

export type MeterInterval = {
  index: number
  kwh: number
  sourceRowNumber: number
  qualityFlag: string
  registerCode: string
  rateTypeDescription: string
  start?: Date
  end?: Date
}

export type MeterSeries = {
  channel: EnergyChannel
  label: string
  rowCount: number
  totalKwh: number
  intervals: MeterInterval[]
  qualityFlags: Record<string, number>
}

export type MissingIntervalGap = {
  channel: EnergyChannel
  afterIndex: number
  beforeIndex: number
  missingCount: number
  expectedMinutes: number
  actualMinutes: number
}

export type ParsedAglUsageData = {
  source: 'agl-csv'
  rowCount: number
  channels: {
    import: MeterSeries
    export: MeterSeries
  }
  otherSeries: MeterSeries[]
  qualityFlags: Record<string, number>
  accountNumbers: string[]
  nmis: string[]
  missingIdentifierFields: {
    accountNumber: number
    nmi: number
  }
  hasTimestamps: boolean
  missingTimestampRows: number
  intervalMinutes: number | null
  intervalInference: 'timestamps' | 'row-count' | null
  missingIntervals: MissingIntervalGap[]
  warnings: string[]
}

type CsvRow = Record<string, string>

type ParseOptions = {
  candidateIntervalMinutes?: number[]
}

const REQUIRED_HEADERS = [
  'AccountNumber',
  'NMI',
  'DeviceNumber',
  'DeviceType',
  'RegisterCode',
  'RateTypeDescription',
  'StartDate',
  'EndDate',
  'ProfileReadValue',
  'RegisterReadValue',
  'QualityFlag',
]

const DEFAULT_INTERVAL_CANDIDATES = [5, 15, 30, 60]

export function parseAglUsageCsv(csvText: string, options: ParseOptions = {}): ParsedAglUsageData {
  const rows = parseCsv(csvText)

  if (rows.length === 0) {
    throw new Error('CSV is empty.')
  }

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim())
  const headerIndex = new Map(headers.map((header, index) => [header, index]))
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerIndex.has(header))

  if (missingHeaders.length > 0) {
    throw new Error(`CSV is missing required AGL headers: ${missingHeaders.join(', ')}`)
  }

  const importSeries = createSeries('import', 'Usage / import')
  const exportSeries = createSeries('export', 'Solar / export')
  const otherSeriesByLabel = new Map<string, MeterSeries>()
  const qualityFlags: Record<string, number> = {}
  const accountNumbers = new Set<string>()
  const nmis = new Set<string>()
  const warnings: string[] = []
  let missingAccountNumber = 0
  let missingNmi = 0
  let missingTimestampRows = 0
  let parsedRowCount = 0

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rowToObject(headers, rows[rowIndex])

    if (Object.values(row).every((value) => value.trim() === '')) {
      continue
    }

    parsedRowCount += 1

    const accountNumber = row.AccountNumber.trim()
    const nmi = row.NMI.trim()
    const registerCode = row.RegisterCode.trim()
    const rateTypeDescription = row.RateTypeDescription.trim()
    const qualityFlag = row.QualityFlag.trim() || 'unknown'
    const start = parseAglDate(row.StartDate)
    const end = parseAglDate(row.EndDate)
    const channel = classifyChannel(rateTypeDescription, registerCode)
    const kwh = parseKwh(row.ProfileReadValue, row.RegisterReadValue)

    if (accountNumber) {
      accountNumbers.add(accountNumber)
    } else {
      missingAccountNumber += 1
    }

    if (nmi) {
      nmis.add(nmi)
    } else {
      missingNmi += 1
    }

    if (!start || !end) {
      missingTimestampRows += 1
    }

    increment(qualityFlags, qualityFlag)

    const series = getSeries(channel, rateTypeDescription, importSeries, exportSeries, otherSeriesByLabel)
    const interval: MeterInterval = {
      index: series.intervals.length,
      kwh,
      sourceRowNumber: rowIndex + 1,
      qualityFlag,
      registerCode,
      rateTypeDescription,
    }

    if (start) {
      interval.start = start
    }

    if (end) {
      interval.end = end
    }

    series.intervals.push(interval)
    series.rowCount += 1
    series.totalKwh += kwh
    increment(series.qualityFlags, qualityFlag)
  }

  finaliseSeries(importSeries)
  finaliseSeries(exportSeries)
  const otherSeries = Array.from(otherSeriesByLabel.values()).map(finaliseSeries)
  const hasTimestamps = missingTimestampRows < parsedRowCount
  const timestampIntervalMinutes = inferIntervalMinutesFromTimestamps([importSeries, exportSeries, ...otherSeries])
  const rowCountIntervalMinutes = timestampIntervalMinutes
    ? null
    : inferIntervalMinutesFromRowCount(
        Math.max(importSeries.rowCount, exportSeries.rowCount),
        options.candidateIntervalMinutes ?? DEFAULT_INTERVAL_CANDIDATES,
      )
  const intervalMinutes = timestampIntervalMinutes ?? rowCountIntervalMinutes
  const intervalInference = timestampIntervalMinutes ? 'timestamps' : rowCountIntervalMinutes ? 'row-count' : null
  const missingIntervals = intervalMinutes ? detectMissingIntervals([importSeries, exportSeries, ...otherSeries], intervalMinutes) : []

  if (importSeries.rowCount !== exportSeries.rowCount && importSeries.rowCount > 0 && exportSeries.rowCount > 0) {
    warnings.push(
      `Import and export channels have different interval counts (${importSeries.rowCount} vs ${exportSeries.rowCount}).`,
    )
  }

  if (missingTimestampRows > 0) {
    warnings.push(
      `${missingTimestampRows.toLocaleString('en-AU')} rows are missing StartDate or EndDate, so intervals are kept in file order by index rather than treated as exact dated readings.`,
    )

    if (importSeries.rowCount > 0 || exportSeries.rowCount > 0) {
      warnings.push(
        'Ordered interval values can support totals and index-based pattern analysis, but exact dates, weekdays and time-of-use windows require a timing assumption.',
      )
    }
  }

  if (!timestampIntervalMinutes && !rowCountIntervalMinutes) {
    warnings.push('Interval minutes could not be inferred safely from timestamps or row count.')
  }

  if (!hasTimestamps && rowCountIntervalMinutes) {
    warnings.push(
      `${rowCountIntervalMinutes}-minute intervals were inferred from row count because timestamps are missing. Treat time-of-use analysis as assumption-based until a real start time is supplied.`,
    )
  }

  if (missingAccountNumber === parsedRowCount) {
    warnings.push('AccountNumber is blank for every row.')
  }

  if (missingNmi === parsedRowCount) {
    warnings.push('NMI is blank for every row.')
  }

  if (missingIntervals.length > 0) {
    warnings.push(`Detected ${missingIntervals.length} timestamp gap(s) larger than the inferred interval.`)
  }

  return {
    source: 'agl-csv',
    rowCount: parsedRowCount,
    channels: {
      import: importSeries,
      export: exportSeries,
    },
    otherSeries,
    qualityFlags,
    accountNumbers: Array.from(accountNumbers),
    nmis: Array.from(nmis),
    missingIdentifierFields: {
      accountNumber: missingAccountNumber,
      nmi: missingNmi,
    },
    hasTimestamps,
    missingTimestampRows,
    intervalMinutes,
    intervalInference,
    missingIntervals,
    warnings,
  }
}

export function parseCsv(csvText: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentValue = ''
  let inQuotes = false

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index]
    const nextChar = csvText[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentValue)
      currentValue = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      currentRow.push(currentValue)
      rows.push(currentRow)
      currentRow = []
      currentValue = ''
      continue
    }

    currentValue += char
  }

  if (inQuotes) {
    throw new Error('CSV appears malformed: an opened quoted field was not closed.')
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue)
    rows.push(currentRow)
  }

  return rows
}

export function inferIntervalMinutesFromRowCount(
  rowCount: number,
  candidates: number[] = DEFAULT_INTERVAL_CANDIDATES,
): number | null {
  if (rowCount <= 0) {
    return null
  }

  const exactMatches = candidates.filter((minutes) => {
    const intervalsPerDay = 1440 / minutes
    return Number.isInteger(intervalsPerDay) && rowCount % intervalsPerDay === 0
  })

  return exactMatches.length === 1 ? exactMatches[0] : null
}

function rowToObject(headers: string[], values: string[]): CsvRow {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
}

function createSeries(channel: EnergyChannel, label: string): MeterSeries {
  return {
    channel,
    label,
    rowCount: 0,
    totalKwh: 0,
    intervals: [],
    qualityFlags: {},
  }
}

function getSeries(
  channel: EnergyChannel,
  rateTypeDescription: string,
  importSeries: MeterSeries,
  exportSeries: MeterSeries,
  otherSeriesByLabel: Map<string, MeterSeries>,
): MeterSeries {
  if (channel === 'import') {
    return importSeries
  }

  if (channel === 'export') {
    return exportSeries
  }

  const label = rateTypeDescription || 'Other'
  const existing = otherSeriesByLabel.get(label)

  if (existing) {
    return existing
  }

  const created = createSeries('other', label)
  otherSeriesByLabel.set(label, created)
  return created
}

function classifyChannel(rateTypeDescription: string, registerCode: string): EnergyChannel {
  const description = rateTypeDescription.toLowerCase()
  const code = registerCode.toLowerCase()

  if (description.includes('solar') || description.includes('export') || code.includes('#b')) {
    return 'export'
  }

  if (description.includes('usage') || description.includes('import') || code.includes('#e')) {
    return 'import'
  }

  return 'other'
}

function parseKwh(profileReadValue: string, registerReadValue: string): number {
  const profileValue = parseNumber(profileReadValue)

  if (Number.isFinite(profileValue)) {
    return profileValue
  }

  const registerValue = parseNumber(registerReadValue)
  return Number.isFinite(registerValue) ? registerValue : 0
}

function parseNumber(value: string): number {
  return Number.parseFloat(value.trim().replace(/,/g, ''))
}

function parseAglDate(value: string): Date | undefined {
  const trimmed = value.trim()

  if (!trimmed) {
    return undefined
  }

  const parsed = new Date(trimmed)

  if (!Number.isNaN(parsed.getTime())) {
    return parsed
  }

  const australianDate = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  )

  if (!australianDate) {
    return undefined
  }

  const [, day, month, year, hour = '0', minute = '0', second = '0'] = australianDate
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
}

function inferIntervalMinutesFromTimestamps(seriesList: MeterSeries[]): number | null {
  const counts = new Map<number, number>()

  for (const series of seriesList) {
    for (let index = 1; index < series.intervals.length; index += 1) {
      const previous = series.intervals[index - 1].start
      const current = series.intervals[index].start

      if (!previous || !current) {
        continue
      }

      const deltaMinutes = Math.round((current.getTime() - previous.getTime()) / 60000)

      if (deltaMinutes > 0) {
        counts.set(deltaMinutes, (counts.get(deltaMinutes) ?? 0) + 1)
      }
    }
  }

  let bestMinutes: number | null = null
  let bestCount = 0

  for (const [minutes, count] of counts) {
    if (count > bestCount) {
      bestMinutes = minutes
      bestCount = count
    }
  }

  return bestMinutes
}

function detectMissingIntervals(seriesList: MeterSeries[], intervalMinutes: number): MissingIntervalGap[] {
  const gaps: MissingIntervalGap[] = []

  for (const series of seriesList) {
    for (let index = 1; index < series.intervals.length; index += 1) {
      const previous = series.intervals[index - 1]
      const current = series.intervals[index]

      if (!previous.start || !current.start) {
        continue
      }

      const actualMinutes = Math.round((current.start.getTime() - previous.start.getTime()) / 60000)
      const missingCount = Math.round(actualMinutes / intervalMinutes) - 1

      if (missingCount > 0) {
        gaps.push({
          channel: series.channel,
          afterIndex: previous.index,
          beforeIndex: current.index,
          missingCount,
          expectedMinutes: intervalMinutes,
          actualMinutes,
        })
      }
    }
  }

  return gaps
}

function finaliseSeries<T extends MeterSeries>(series: T): T {
  series.totalKwh = roundTo(series.totalKwh, 6)
  return series
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}
