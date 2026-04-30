import assert from 'node:assert/strict'
import test from 'node:test'

import JSZip from 'jszip'

import { parseAglUsageFile } from '../.test-build/src/domain/usageFile.js'

const header =
  'AccountNumber,NMI,DeviceNumber,DeviceType,RegisterCode,RateTypeDescription,StartDate,EndDate,ProfileReadValue,RegisterReadValue,QualityFlag'

const csv = [
  header,
  ',,000000000700315987,COMMS4D,15987#E1,Usage,,,1.25,0,A',
  ',,000000000700315987,COMMS4D,15987#B1,Solar,,,0.5,0,U',
].join('\n')

function textFile(name, content) {
  return {
    name,
    async text() {
      return content
    },
    async arrayBuffer() {
      return new TextEncoder().encode(content).buffer
    },
  }
}

function bufferFile(name, buffer) {
  return {
    name,
    async text() {
      return buffer.toString('utf8')
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    },
  }
}

test('usage file helper parses a direct AGL CSV file locally', async () => {
  const analysis = await parseAglUsageFile(textFile('MyUsageData.csv', csv))

  assert.equal(analysis.sourceFileName, 'MyUsageData.csv')
  assert.equal(analysis.csvFileName, 'MyUsageData.csv')
  assert.equal(analysis.parsed.rowCount, 2)
  assert.equal(analysis.parsed.channels.import.totalKwh, 1.25)
  assert.equal(analysis.parsed.channels.export.totalKwh, 0.5)
  assert.ok(analysis.warnings.some((warning) => warning.includes('missing StartDate or EndDate')))
})

test('usage file helper extracts and parses an AGL CSV from a ZIP file', async () => {
  const zip = new JSZip()
  zip.file('nested/MyUsageData_28-04-2026.csv', csv)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  const analysis = await parseAglUsageFile(bufferFile('MyUsageData_28-04-2026.zip', zipBuffer))

  assert.equal(analysis.sourceFileName, 'MyUsageData_28-04-2026.zip')
  assert.equal(analysis.csvFileName, 'nested/MyUsageData_28-04-2026.csv')
  assert.equal(analysis.parsed.rowCount, 2)
  assert.ok(analysis.warnings[0].includes('Read nested/MyUsageData_28-04-2026.csv'))
})

test('usage file helper rejects unsupported file types', async () => {
  await assert.rejects(
    parseAglUsageFile(textFile('usage.txt', csv)),
    /Unsupported file type/,
  )
})

test('usage file helper rejects oversized browser files before reading content', async () => {
  const file = {
    name: 'MyUsageData.csv',
    size: 26 * 1024 * 1024,
    async text() {
      throw new Error('text should not be read')
    },
    async arrayBuffer() {
      throw new Error('buffer should not be read')
    },
  }

  await assert.rejects(parseAglUsageFile(file), /too large for browser-local analysis/)
})

test('usage file helper rejects ZIP files with too many entries', async () => {
  const zip = new JSZip()

  for (let index = 0; index < 101; index += 1) {
    zip.file(`extra-${index}.txt`, 'x')
  }

  zip.file('MyUsageData.csv', csv)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  await assert.rejects(
    parseAglUsageFile(bufferFile('MyUsageData.zip', zipBuffer)),
    /contains 102 entries/,
  )
})

test('usage file helper rejects ZIP CSV entries that expand too large', async () => {
  const zip = new JSZip()
  zip.file('MyUsageData.csv', 'a'.repeat(21 * 1024 * 1024))
  const zipBuffer = await zip.generateAsync({ compression: 'DEFLATE', type: 'nodebuffer' })

  await assert.rejects(
    parseAglUsageFile(bufferFile('MyUsageData.zip', zipBuffer)),
    /expands to .*too large/,
  )
})
