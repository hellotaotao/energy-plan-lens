import JSZip from 'jszip'

import { parseAglUsageCsv, type ParsedAglUsageData } from './aglCsv.js'

export type BrowserLocalUsageFile = {
  name: string
  size?: number
  text: () => Promise<string>
  arrayBuffer: () => Promise<ArrayBuffer>
}

export type AglUsageFileAnalysis = {
  sourceFileName: string
  csvFileName: string
  parsed: ParsedAglUsageData
  warnings: string[]
}

const CSV_EXTENSION = '.csv'
const ZIP_EXTENSION = '.zip'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_ZIP_ENTRY_COUNT = 100
const MAX_CSV_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
const MAX_SELECTED_ZIP_CSV_COMPRESSED_BYTES = 10 * 1024 * 1024

type ZipEntryWithPrivateSizeData = JSZip.JSZipObject & {
  _data?: {
    compressedSize?: number
    uncompressedSize?: number
  }
}

export async function parseAglUsageFile(file: BrowserLocalUsageFile): Promise<AglUsageFileAnalysis> {
  const fileName = file.name.trim() || 'uploaded file'
  const lowerName = fileName.toLowerCase()

  assertKnownSizeWithinLimit(file.size, MAX_UPLOAD_BYTES, 'Uploaded file')

  if (lowerName.endsWith(CSV_EXTENSION)) {
    const csvText = await file.text()
    assertCsvTextWithinLimit(csvText, 'CSV file')
    return parseCsvFile(fileName, fileName, csvText, [])
  }

  if (lowerName.endsWith(ZIP_EXTENSION)) {
    return parseZipFile(fileName, await file.arrayBuffer())
  }

  throw new Error('Unsupported file type. Upload an AGL usage .csv file, or a .zip containing one CSV file.')
}

async function parseZipFile(sourceFileName: string, buffer: ArrayBuffer): Promise<AglUsageFileAnalysis> {
  assertKnownSizeWithinLimit(buffer.byteLength, MAX_UPLOAD_BYTES, 'Uploaded ZIP file')

  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files)

  if (entries.length > MAX_ZIP_ENTRY_COUNT) {
    throw new Error(
      `The ZIP file contains ${entries.length.toLocaleString('en-AU')} entries. Please upload a smaller AGL export ZIP with no more than ${MAX_ZIP_ENTRY_COUNT.toLocaleString('en-AU')} entries.`,
    )
  }

  const csvEntries = entries.filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(CSV_EXTENSION),
  )

  if (csvEntries.length === 0) {
    throw new Error('The ZIP file does not contain a CSV file.')
  }

  const preferredEntry =
    csvEntries.find((entry) => entry.name.toLowerCase().includes('myusagedata')) ?? csvEntries[0]
  const zipWarnings = [`Read ${preferredEntry.name} from ${sourceFileName}. Files stay in this browser session only.`]

  if (csvEntries.length > 1) {
    zipWarnings.push(`ZIP contained ${csvEntries.length} CSV files; using ${preferredEntry.name}.`)
  }

  assertZipCsvEntryWithinLimits(preferredEntry)
  const csvText = await preferredEntry.async('string')
  assertCsvTextWithinLimit(csvText, `CSV file ${preferredEntry.name}`)
  return parseCsvFile(sourceFileName, preferredEntry.name, csvText, zipWarnings)
}

function assertKnownSizeWithinLimit(size: number | undefined, maxBytes: number, label: string) {
  if (size !== undefined && size > maxBytes) {
    throw new Error(
      `${label} is ${formatBytes(size)}, which is too large for browser-local analysis. Please upload a file under ${formatBytes(maxBytes)}.`,
    )
  }
}

function assertCsvTextWithinLimit(csvText: string, label: string) {
  if (csvText.length > MAX_CSV_UNCOMPRESSED_BYTES) {
    throw new Error(
      `${label} expands to more than ${formatBytes(MAX_CSV_UNCOMPRESSED_BYTES)} of text. Please export a smaller date range before analysing it in the browser.`,
    )
  }
}

function assertZipCsvEntryWithinLimits(entry: JSZip.JSZipObject) {
  const { compressedSize, uncompressedSize } = getZipEntrySizes(entry)

  if (compressedSize !== undefined && compressedSize > MAX_SELECTED_ZIP_CSV_COMPRESSED_BYTES) {
    throw new Error(
      `The selected CSV inside the ZIP is ${formatBytes(compressedSize)} compressed, which is too large for browser-local analysis. Please upload a smaller AGL usage export.`,
    )
  }

  if (uncompressedSize !== undefined && uncompressedSize > MAX_CSV_UNCOMPRESSED_BYTES) {
    throw new Error(
      `The selected CSV inside the ZIP expands to ${formatBytes(uncompressedSize)}, which is too large for browser-local analysis. Please upload a smaller date range.`,
    )
  }
}

function getZipEntrySizes(entry: JSZip.JSZipObject) {
  const sizeData = (entry as ZipEntryWithPrivateSizeData)._data
  return {
    compressedSize: sizeData?.compressedSize,
    uncompressedSize: sizeData?.uncompressedSize,
  }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${bytes.toLocaleString('en-AU')} bytes`
}

function parseCsvFile(
  sourceFileName: string,
  csvFileName: string,
  csvText: string,
  fileWarnings: string[],
): AglUsageFileAnalysis {
  const parsed = parseAglUsageCsv(csvText)

  return {
    sourceFileName,
    csvFileName,
    parsed,
    warnings: [...fileWarnings, ...parsed.warnings],
  }
}
