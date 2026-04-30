import './App.css'
import { UploadAnalyseSection } from './components/UploadAnalyseSection'
import { aglSampleUsageSummary } from './domain/sampleUsageSummary'
import { AGL_THREE_FOR_FREE_ASSUMPTIONS, SIMPLE_FLAT_ASSUMPTIONS } from './domain/tariffs'

type PlanComparison = {
  name: string
  type: string
  cost: string
  delta: string
  highlight?: boolean
}

type MonthlyPoint = {
  month: string
  cost: string
  height: number
  marker?: string
}

const planComparisons: PlanComparison[] = [
  {
    name: 'Harbour Flat Saver',
    type: 'Flat rate + solar feed-in',
    cost: '$2,184',
    delta: 'Best full year',
    highlight: true,
  },
  {
    name: 'NEM Time Shift',
    type: 'time-of-use, weekend and weekday rates',
    cost: '$2,336',
    delta: '+$152',
  },
  {
    name: 'Peak Demand Plus',
    type: 'Demand charges + daily supply charge',
    cost: '$2,502',
    delta: '+$318',
  },
  {
    name: 'Solar Flex Retail',
    type: 'Seasonal rates + controlled load',
    cost: '$2,419',
    delta: '+$235',
  },
]

const monthlyCurve: MonthlyPoint[] = [
  { month: 'Jan', cost: '$236', height: 82, marker: 'cooling' },
  { month: 'Feb', cost: '$219', height: 74 },
  { month: 'Mar', cost: '$176', height: 52 },
  { month: 'Apr', cost: '$154', height: 42 },
  { month: 'May', cost: '$167', height: 48 },
  { month: 'Jun', cost: '$244', height: 86, marker: 'heat pump' },
  { month: 'Jul', cost: '$258', height: 92 },
  { month: 'Aug', cost: '$231', height: 80 },
  { month: 'Sep', cost: '$149', height: 38 },
  { month: 'Oct', cost: '$133', height: 32 },
  { month: 'Nov', cost: '$141', height: 36 },
  { month: 'Dec', cost: '$187', height: 58 },
]

const userGroups = [
  'Smart meter households with 12 or 24 months of interval data',
  'Solar homes testing solar feed-in tradeoffs',
  'EV and heat pump owners with shifted load',
  'Renters, homeowners and families comparing retailers carefully',
]

const painPoints = [
  {
    title: 'Averages miss your real shape',
    copy: 'Retailer comparison sites estimate from averages, but your evening EV charging, weekend loads or solar exports can change the winner.',
  },
  {
    title: 'Retailer pages hide the maths',
    copy: 'Retailer plan pages split tariff rules across PDFs, footnotes, seasonal tables and demand charge definitions.',
  },
  {
    title: 'Bill shock arrives too late',
    copy: 'A cheap headline rate can still create bill shock during summer cooling, winter heating or one demand spike.',
  },
]

const workflowSteps = [
  {
    step: '01',
    title: 'Download your interval file',
    copy: 'Start with the smart meter interval usage data Australian households can request from their distributor or retailer.',
  },
  {
    step: '02',
    title: 'Upload usage and plan rules',
    copy: 'The roadmap upload-and-calculate workflow will accept usage files, tariff sheets and retailer plan changes over time.',
  },
  {
    step: '03',
    title: 'Replay every interval',
    copy: 'EnergyLens will replay each interval through each tariff formula instead of estimating from typical usage bands.',
  },
  {
    step: '04',
    title: 'Calculate, compare and recommend',
    copy: 'See annual total cost, monthly curves, summer and winter winners, switching savings and practical recommendations.',
  },
]

const tariffFeatures = [
  {
    feature: 'Flat rate',
    value: 'Shows whether a simple plan beats complex discounting once your actual kWh are priced.',
  },
  {
    feature: 'Time-of-use',
    value: 'Tests shoulder, peak and off-peak windows against your real morning and evening load.',
  },
  {
    feature: 'Demand charges',
    value: 'Finds the monthly demand intervals that could dominate a bill.',
  },
  {
    feature: 'Controlled load',
    value: 'Separates hot water or dedicated circuits when the data and tariff support it.',
  },
  {
    feature: 'Solar feed-in',
    value: 'Balances import rates against export credits for solar households.',
  },
  {
    feature: 'Daily supply charge',
    value: 'Adds fixed charges so low-usage homes are not misled by cheap energy rates.',
  },
  {
    feature: 'Seasonal rates',
    value: 'Compares summer and winter price windows for cooling and heating patterns.',
  },
  {
    feature: 'Weekend and weekday rates',
    value: 'Captures work-from-home, school holiday and weekend load shifts.',
  },
]

const switchingStrategies = [
  'Best plan for the whole year if you only want one retailer.',
  'Best summer plan and best winter plan when seasonal switching would have saved more.',
  'Bill shock periods where a demand spike, feed-in change or tariff reset drove the result.',
]


const kwhFormatter = new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 3,
  minimumFractionDigits: 0,
})

const rowFormatter = new Intl.NumberFormat('en-AU')

function formatKwh(kwh: number) {
  return `${kwhFormatter.format(kwh)} kWh`
}

function SampleUsageDataSection() {
  const freeWindow = AGL_THREE_FOR_FREE_ASSUMPTIONS.importRates.find((rate) => rate.centsPerKwh === 0)
  const sampleMetrics = [
    { label: 'Usage / import', value: formatKwh(aglSampleUsageSummary.totalImportKwh) },
    { label: 'Solar / export', value: formatKwh(aglSampleUsageSummary.totalExportKwh) },
    {
      label: 'Rows per channel',
      value: rowFormatter.format(aglSampleUsageSummary.intervalRowsPerChannel),
    },
    {
      label: 'Quality flags',
      value: `${rowFormatter.format(aglSampleUsageSummary.qualityFlags.A)} A · ${rowFormatter.format(
        aglSampleUsageSummary.qualityFlags.U,
      )} U`,
    },
  ]

  return (
    <section className="section-band sample-data-section" id="sample-data">
      <div className="section-heading">
        <p className="eyebrow">Real local sample</p>
        <h2>AGL interval data now feeds the calculator model.</h2>
        <p>
          The local file <strong>{aglSampleUsageSummary.fileName}</strong> has been parsed into separate
          Usage/import and Solar/export series, with quality flags preserved for later filtering.
        </p>
      </div>

      <div className="sample-data-grid">
        {sampleMetrics.map((metric) => (
          <article className="sample-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>

      <div className="sample-warning" role="note">
        <strong>Timestamp warning:</strong> {aglSampleUsageSummary.warning}
      </div>

      <div className="tariff-assumption-card">
        <div>
          <p className="eyebrow">Calculator assumptions</p>
          <h3>Configurable flat vs Three for Free style comparison</h3>
          <p>
            The domain model includes a simple flat-rate comparator and an AGL Three for Free style tariff with
            editable daily supply, feed-in credit and import windows.
          </p>
        </div>
        <ul>
          <li>{SIMPLE_FLAT_ASSUMPTIONS.name}: flat import sanity check.</li>
          <li>
            {AGL_THREE_FOR_FREE_ASSUMPTIONS.name}: {freeWindow?.start ?? '12:00'}–{freeWindow?.end ?? '15:00'}
            import window priced at {freeWindow?.centsPerKwh ?? 0}c/kWh.
          </li>
          <li>Exact time-of-use replay requires dated intervals or a user-supplied start datetime.</li>
        </ul>
      </div>
    </section>
  )
}

function ProductPreview() {
  return (
    <section className="product-preview" aria-label="EnergyLens mock dashboard preview">
      <div className="preview-header">
        <div>
          <p className="eyebrow">Mock annual replay</p>
          <h2>Actual interval data priced through four plans</h2>
        </div>
        <div className="preview-status">12 months analysed</div>
      </div>

      <div className="summary-strip">
        <div>
          <span>Annual winner</span>
          <strong>Harbour Flat Saver</strong>
        </div>
        <div>
          <span>Switching savings</span>
          <strong>$318</strong>
        </div>
        <div>
          <span>Summer winner</span>
          <strong>Solar Flex Retail</strong>
        </div>
        <div>
          <span>Winter winner</span>
          <strong>Harbour Flat Saver</strong>
        </div>
      </div>

      <div className="comparison-table">
        {planComparisons.map((plan) => (
          <div className={plan.highlight ? 'comparison-row is-best' : 'comparison-row'} key={plan.name}>
            <div>
              <strong>{plan.name}</strong>
              <span>{plan.type}</span>
            </div>
            <div className="row-cost">{plan.cost}</div>
            <div className="row-delta">{plan.delta}</div>
          </div>
        ))}
      </div>

      <div className="curve-panel">
        <div className="curve-heading">
          <h3>Monthly curves expose seasonal pressure</h3>
          <span>Summer cooling and winter heat pump load</span>
        </div>
        <div className="bar-chart" aria-label="Monthly cost curve from January to December">
          {monthlyCurve.map((point) => (
            <div className="bar-item" key={point.month}>
              <span className="bar-cost">{point.cost}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ height: `${point.height}%` }} />
              </div>
              <span className="bar-month">{point.month}</span>
              {point.marker ? <span className="bar-marker">{point.marker}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function App() {
  return (
    <main>
      <header className="site-header" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="EnergyLens home">
          <span className="brand-mark">EL</span>
          <span>EnergyLens</span>
        </a>
        <nav>
          <a href="#problem">Problem</a>
          <a href="#workflow">How it works</a>
          <a href="#upload-analyse">Upload</a>
          <a href="#sample-data">Real data</a>
          <a href="#privacy">Privacy</a>
          <a className="nav-cta" href="#early-access">
            Early access
          </a>
        </nav>
      </header>

      <section className="hero-section" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Australian electricity plan comparison for smart meter data</p>
          <h1>Replay your real usage through every tariff before you switch.</h1>
          <p className="hero-lede">
            EnergyLens compares electricity retailers by pricing your actual interval data through
            each tariff formula. Retailer comparison sites estimate from averages; this shows what you would
            have actually paid in Australia across NEM plans.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#upload-analyse">
              Upload usage file
            </a>
            <a className="secondary-button" href="#workflow">
              See the workflow
            </a>
          </div>
          <div className="audience-list" aria-label="Target users">
            {userGroups.map((group) => (
              <span key={group}>{group}</span>
            ))}
          </div>
        </div>
        <ProductPreview />
      </section>

      <UploadAnalyseSection />

      <section className="section-band" id="problem">
        <div className="section-heading">
          <p className="eyebrow">The problem</p>
          <h2>Plan pages are built for averages. Your bill is built from intervals.</h2>
          <p>
            A household with solar exports, an EV, a heat pump or controlled load can move from cheapest to
            expensive when the tariff changes by season, weekend, weekday or demand window.
          </p>
        </div>
        <div className="pain-grid">
          {painPoints.map((point) => (
            <article className="info-card" key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-band workflow-band" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>From smart meter file to plan recommendations.</h2>
          <p>
            The future calculator is designed around a concrete upload-and-calculate workflow for real
            interval usage and real retailer tariffs.
          </p>
        </div>
        <div className="workflow-grid">
          {workflowSteps.map((item) => (
            <article className="workflow-step" key={item.step}>
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <SampleUsageDataSection />

      <section className="split-section">
        <div className="section-heading compact">
          <p className="eyebrow">Tariff modelling</p>
          <h2>Every major rule that changes a household bill.</h2>
          <p>
            EnergyLens is being shaped to model the details that make Australian electricity plans hard
            to compare by eye.
          </p>
        </div>
        <div className="feature-list" aria-label="Tariff modelling features">
          {tariffFeatures.map((item) => (
            <article className="feature-row" key={item.feature}>
              <h3>{item.feature}</h3>
              <p>{item.value}</p>
            </article>
          ))}
          <article className="feature-row wide-row">
            <h3>Plan changes over time</h3>
            <p>
              Handles mid-year tariff resets, retailer updates and meter data spanning multiple plan periods
              so the annual total cost is not flattened into one assumed rate.
            </p>
          </article>
        </div>
      </section>

      <section className="insight-section">
        <div>
          <p className="eyebrow">Seasonal insight</p>
          <h2>See why a plan wins, not just that it wins.</h2>
        </div>
        <div className="insight-grid">
          <article>
            <span>Monthly curves</span>
            <p>Spot the months where cooling, winter heating or export changes move the ranking.</p>
          </article>
          <article>
            <span>Summer vs winter</span>
            <p>Compare whether one plan wins all year or only during high-load seasons.</p>
          </article>
          <article>
            <span>Bill shock periods</span>
            <p>Trace the exact interval patterns behind expensive bills before choosing a retailer.</p>
          </article>
        </div>
      </section>

      <section className="split-section strategy-section">
        <div className="section-heading compact">
          <p className="eyebrow">Switching strategy</p>
          <h2>Recommendations that match how households actually decide.</h2>
          <p>
            The calculator roadmap includes recommendations for single-plan simplicity and for financially
            careful families willing to switch when the data proves it.
          </p>
        </div>
        <div className="strategy-list">
          {switchingStrategies.map((strategy) => (
            <div className="strategy-item" key={strategy}>
              <span aria-hidden="true">+</span>
              <p>{strategy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="privacy-section" id="privacy">
        <div className="section-heading">
          <p className="eyebrow">Trust and privacy</p>
          <h2>Your meter file should be treated like household financial data.</h2>
          <p>
            EnergyLens will be designed to minimise collection, explain what is uploaded, avoid selling
            household interval data, and make deletion straightforward. Early test data can be anonymised or
            synthetic while the tariff engine is validated.
          </p>
        </div>
        <div className="privacy-grid">
          <article>
            <h3>Transparent inputs</h3>
            <p>Usage files, tariff assumptions and retailer plan rules are shown before results are trusted.</p>
          </article>
          <article>
            <h3>Data minimisation</h3>
            <p>Only the fields needed to calculate plan costs should be used, with account identifiers removed.</p>
          </article>
          <article>
            <h3>No hidden brokerage</h3>
            <p>The product direction is analysis first, so recommendations can be explained by the replayed maths.</p>
          </article>
        </div>
      </section>

      <section className="cta-section" id="early-access">
        <div>
          <p className="eyebrow">Roadmap</p>
          <h2>Help shape the upload-and-calculate tariff engine.</h2>
          <p>
            Join early access if you can share a sample smart meter interval file, a retailer tariff sheet or
            anonymised test data. The next milestone is a working calculator that produces annual total cost,
            seasonal curves and switching savings from real Australian usage.
          </p>
        </div>
        <a className="primary-button dark-button" href="mailto:hello@energyplanlens.example?subject=Energy%20Plan%20Lens%20early%20access">
          Send test data
        </a>
      </section>
    </main>
  )
}

export default App
