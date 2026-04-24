import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const searchableCopy = appSource.toLowerCase()

const assertMentions = (terms, context) => {
  const missing = terms.filter((term) => !searchableCopy.includes(term.toLowerCase()))

  assert.deepEqual(missing, [], `Missing concrete messaging for ${context}: ${missing.join(', ')}`)
}

test('homepage names the product and Australian market context', () => {
  assertMentions(['Energy Plan Lens', 'Australia', 'NEM', 'retailers', 'tariff'], 'market positioning')
})

test('homepage identifies concrete target users', () => {
  assertMentions(
    ['smart meter', 'solar', 'EV', 'heat pump', 'renters', 'homeowners', 'families'],
    'target users',
  )
})

test('homepage explains pain points with current comparison approaches', () => {
  assertMentions(
    ['estimate', 'averages', 'retailer plan pages', 'bill shock'],
    'comparison-site pain points',
  )
})

test('homepage maps tariff modelling features to household value', () => {
  assertMentions(
    [
      'interval data',
      'flat rate',
      'time-of-use',
      'demand charges',
      'controlled load',
      'solar feed-in',
      'daily supply charge',
      'seasonal rates',
      'weekend',
      'weekday',
      'plan changes over time',
      'annual total cost',
      'monthly curves',
      'summer',
      'winter',
      'switching savings',
    ],
    'feature-to-value mapping',
  )
})

test('homepage presents a concrete upload-and-calculate workflow', () => {
  assertMentions(
    ['download', 'upload', 'replay', 'calculate', 'compare', 'recommendations', 'early access', 'test data'],
    'workflow steps',
  )
})
