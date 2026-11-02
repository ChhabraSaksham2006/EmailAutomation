export const HARD_LIMITS = {
  TARGET_BOUNCE_RATE: 0.02,        // under 2% target
  PAUSE_BOUNCE_RATE: 0.03,         // auto-pause mailbox at 3% rolling 7-day bounce rate
  MAX_COMPLAINTS_BEFORE_PAUSE: 1,  // pause mailbox on any spam complaint (0 target)
  DEFAULT_DAILY_CAP: 35,           // 30 to 40 recommended
  MAX_DAILY_CAP: 50,               // hard ceiling 50
  MAX_SEQUENCE_STEPS: 3,           // 3 emails maximum
  MIN_PACING_SECONDS: 30,          // 30 seconds minimum gap
  MAX_PACING_SECONDS: 120,         // 2 minutes maximum gap
  WORD_COUNT_MIN: 50,
  WORD_COUNT_MAX: 120,
  MAX_CSV_ROWS: 2500
};

export const DEFAULT_SEND_WINDOW = {
  // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  days: [2, 3, 4], // Default Tuesday to Thursday
  startHour: 9,    // 09:00 in recipient's local timezone
  endHour: 11      // 11:00 in recipient's local timezone
};

// Countries cleared by default (US & India B2B baseline)
export const DEFAULT_CLEARED_COUNTRIES = ['US', 'USA', 'UNITED STATES', 'IN', 'IND', 'INDIA'];

export const RESTRICTED_REGIONS_INFO = {
  EU_UK: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'UK'],
  CANADA: ['CA', 'CAN', 'CANADA'],
  INDIA: ['IN', 'IND', 'INDIA']
};

export const LAWFUL_BASIS_OPTIONS = [
  'legitimate_interest_b2b',
  'explicit_consent',
  'existing_business_relationship',
  'public_corporate_contact_b2b'
];

export const ALLOWED_CONTACT_SOURCES = [
  'manual_research',
  'company_website',
  'linkedin_hand_curated',
  'conference_attendee',
  'inbound_referral',
  'crm_export'
];

export const OPT_OUT_KEYWORDS = [
  'unsubscribe',
  'remove me',
  'take me off',
  'stop emailing',
  'do not contact',
  'don\'t contact',
  'opt out',
  'opt-out',
  'not interested',
  'no thanks',
  'please stop',
  'never email'
];

export const AUTO_REPLY_SUBJECT_PATTERNS = [
  /out of office/i,
  /automatic reply/i,
  /auto-reply/i,
  /autoreply/i,
  /on vacation/i,
  /away from my mail/i,
  /annual leave/i,
  /maternity leave/i,
  /paternity leave/i,
  /abwesenheitsnotiz/i,
  /réponse automatique/i
];

export const BOUNCE_SENDER_PATTERNS = [
  /mailer-daemon/i,
  /postmaster/i,
  /mail delivery subsystem/i,
  /delivery status notification/i
];

export const STARTER_PLAYBOOK_SEQUENCE = {
  name: 'B2B Value Playbook (3-Step Plain Text)',
  sendWindow: {
    days: [2, 3, 4],
    startHour: 9,
    endHour: 11
  },
  stopRules: {
    onReply: true,
    onBounce: true,
    onOptOut: true
  },
  steps: [
    {
      delayDays: 0,
      subjectTemplate: 'Quick question about {{default company "your team"}}',
      bodyTemplate: `Hi {{default first_name "there"}},

I help {{default target_role_plural "B2B teams"}} with {{default one_line_value "streamlining outbound operations"}}. Would a short chat be worth it to see if it’s relevant for {{default company "your team"}}?

If not, just reply “no thanks” and I won’t follow up.

{{sender_name}} {{sender_title}}, {{sender_company}}
{{sender_address}}`
    },
    {
      delayDays: 4,
      subjectTemplate: 'Re: Quick question about {{company}}',
      bodyTemplate: `Hi {{default first_name "there"}}, following up in case my note got buried. {{default follow_up_angle "Happy to share a short 2-sentence example of how similar teams approach this."}} I’m happy to send details by email if that’s easier. A quick “not now” is welcome too.

{{sender_name}} {{sender_title}}, {{sender_company}}
{{sender_address}}`
    },
    {
      delayDays: 9,
      subjectTemplate: 'Re: Quick question about {{company}}',
      bodyTemplate: `Hi {{default first_name "there"}}, last note from me. If {{default topic "this"}} isn’t a priority right now, no problem at all. If it becomes one, you know where to find me.

{{sender_name}} {{sender_title}}, {{sender_company}}
{{sender_address}}`
    }
  ]
};
