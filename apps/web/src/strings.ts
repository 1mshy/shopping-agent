// Every user-facing string of the minimal UI, in English, in one plain object so the i18n work of
// Phase 3 can lift it into locale files. Functions take the values they interpolate.
export const t = {
  appName: 'Agentic Dasher',
  loading: 'Loading…',
  retry: 'Try again',
  serverUnreachable: 'The server cannot be reached.',
  sessionEnded: 'Your session ended. Sign in again.',
  unknown: 'unknown',
  notReadYet: 'not read yet',
  never: 'never',
  none: 'none',
  save: 'Save',
  saving: 'Saving…',
  back: '← Back',

  // Gate
  setupTitle: 'Choose the owner password',
  setupIntro:
    'This instance has no password yet. Choose one now: it protects everything here. Use at least 15 characters; a phrase of four short words works.',
  passwordLabel: 'Password',
  passwordConfirmLabel: 'Repeat the password',
  passwordTooShort: (min: number) => `The password needs at least ${min} characters.`,
  passwordMismatch: 'The two passwords differ.',
  setupSubmit: 'Set the password',
  loginTitle: 'Sign in',
  loginSubmit: 'Sign in',
  loginFailed: 'The password was not accepted.',
  throttled: (seconds: number | null) =>
    seconds === null
      ? 'Too many attempts. Wait a while, then try again.'
      : `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
  logout: 'Log out',

  // Navigation
  navWatches: 'Watches',
  navAlerts: 'Alerts',
  navSettings: 'Settings',
  navDiagnostics: 'Diagnostics',

  // Locale step
  localeTitle: 'Your market',
  localeIntro:
    'Prices are read and shown in the currency a store bills in, never converted. Say where you shop so the agent knows your market.',
  countryLabel: 'Country (ISO 3166-1 alpha-2, e.g. DE, CA, US)',
  currencyLabel: 'Currency (ISO 4217, e.g. EUR, CAD, USD)',
  currencyNoDefault: 'There is no default currency: pick one or type its code.',
  languageLabel: 'Language (BCP 47, e.g. en, fr-CA, de)',
  localeSubmit: 'Save market',
  localeRefused: (field: string, message: string) => `${field}: ${message}`,
  localeChange: 'Change market',

  // Watches
  watchesTitle: 'Watches',
  pastePlaceholder: 'Paste a product link or type a name',
  pasteSubmit: 'Watch',
  watchCreated: 'Watch added.',
  watchExists: 'You already watch this.',
  marketNotSet: 'Set your market first.',
  noWatches: 'No watches yet. Paste a product link above.',
  showArchived: 'Show archived',
  status: { active: 'active', paused: 'paused', archived: 'archived' } as Record<string, string>,
  lookup: 'Lookup',
  lookupError: 'Lookup error',
  noDiscoverySource:
    'Watching by name needs the store directory, which is not built yet. Paste a product link instead.',
  counts: (tracked: number, candidate: number, excluded: number) =>
    `${tracked} tracked · ${candidate} candidate · ${excluded} excluded`,
  reference: 'Reference price',
  referenceNone: 'none yet',
  lastDropAlert: 'Last price-drop alert',
  lastRestockAlert: 'Last restock alert',
  delivery: {
    accepted: 'delivered',
    awaiting_delivery: 'awaiting delivery',
    undelivered: 'not delivered',
  } as Record<string, string>,
  open: 'Open',

  // Watch detail
  checkNow: 'Check now',
  checking: 'Checking…',
  checkQueued: 'Check started; the page refreshes in a moment.',
  pause: 'Pause',
  resume: 'Resume',
  archive: 'Archive',
  archiveConfirm: 'Archive this watch? It stops being checked.',
  rulesTitle: 'Rules',
  dropLabel: 'Alert on a drop of at least (%)',
  dropInvalid: 'The drop is a percent above 0 and below 100, with at most two decimals.',
  targetLabel: (currency: string | null) =>
    currency === null ? 'Target price (set your market first)' : `Target price (${currency})`,
  targetInvalid: (currency: string, digits: number) =>
    digits === 0
      ? `The target is a whole amount of ${currency}, without decimals.`
      : `The target is an amount of ${currency} with at most ${digits} decimals, like 19.99.`,
  targetMismatch:
    'The target is in a different currency from the prices read; it is never compared.',
  restockLabel: 'Alert when back in stock',
  rulesSaved: 'Rules saved.',
  listingsTitle: 'Listings',
  noListings: 'No listings yet.',
  price: 'Price',
  sticker: 'sticker',
  freshCurrent: 'current',
  freshStale: (when: string) => `stale: read ${when}`,
  freshNone: 'no price read',
  availability: 'Availability',
  condition: 'Condition',
  conditionUnknownFlag: 'condition unknown',
  lastRead: 'Last read',
  nextCheck: 'Next check',
  errors: 'Consecutive errors',
  lastError: 'Last error',
  trust: 'trust',
  role: 'Role',
  exclude: 'Exclude',
  track: 'Track',
  wrongMatch: 'Wrong match',
  history: 'History',
  hideHistory: 'Hide history',

  // History
  historyValues: 'Price observations',
  observedAt: 'Observed at',
  historyEmpty: 'No prices recorded yet.',
  historyOnePoint: 'One price recorded so far.',
  latestPrice: 'Latest price',
  verdict: 'Deal verdict',
  verdictLabel: {
    lowest_seen: 'lowest price seen',
    good_price: 'good price',
    typical: 'typical price',
    high: 'above usual',
    cheapest_of_n: 'cheapest of the stores compared',
  } as Record<string, string>,
  verdictNone: 'not judged yet',
  median90d: '90-day median',
  lowestRecorded: 'Lowest recorded',
  daysOfHistory: (n: number) => `${n} day${n === 1 ? '' : 's'} of history`,
  unjudgedReason: {
    no_current_price: 'no current price',
    current_out_of_stock: 'out of stock now',
    current_stale: 'the current price is stale',
    history_under_14_days: 'under 14 days of history',
    history_under_35_days: 'under 35 days of history',
    fewer_than_3_price_levels: 'fewer than 3 price levels',
    no_priced_time_in_window: 'no priced time in the window',
    no_peers: 'no other stores to compare yet',
    not_cheapest: 'not the cheapest',
    outlier: 'the price looks like an outlier',
  } as Record<string, string>,
  verdictRefused: (reason: string) => `No verdict: ${reason}`,
  otherCurrencyPoints: (n: number) =>
    `${n} reading${n === 1 ? '' : 's'} in another currency left out of the line.`,

  // Alerts
  alertsTitle: 'Alerts',
  noAlerts: 'No alerts yet.',
  loadMore: 'Load more',
  inApp: {
    pending: 'pending',
    accepted: 'delivered',
    failed: 'failed',
  } as Record<string, string>,
  inAppNone: 'no in-app delivery',

  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password (at least 15 characters)',
  repeatNewPassword: 'Repeat new password',
  passwordChanged: 'Password changed. Other sessions have ended.',

  // Settings
  settingsTitle: 'Settings',
  robotsMode: 'robots.txt handling',
  settingSource: (value: string, source: string) => `Current setting: ${value} (${source}).`,
  market: 'Market',
  channelsTitle: 'Notification channels',
  noChannels: 'No channels.',
  test: 'Test',
  testResult: (text: string) => `Test: ${text}`,
  enabled: 'on',
  disabled: 'off',

  // Diagnostics
  diagnosticsTitle: 'Diagnostics',
  jobsTitle: 'Jobs',
  jobColumn: 'Job',
  lastRunColumn: 'Last run',
  nextRunColumn: 'Next run',
  outcomeColumn: 'Outcome',
  startedColumn: 'Started',
  runsTitle: 'Recent runs',
  noRuns: 'No runs yet.',
} as const;
