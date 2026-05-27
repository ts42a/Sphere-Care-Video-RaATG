// help_support.js

// ─────────────────────────────────────────────
// FAQ DATA — aligned with Sphere Care Architecture
// ─────────────────────────────────────────────
const FAQS = [
  {
    q: 'What is Sphere Care used for?',
    a: 'Sphere Care is a secure, role-based aged care platform that supports recording and live sessions, real-time transcription, AI safety flags, records management, staff/family communication, audit logs, and retention controls.'
  },
  {
    q: 'How do I create or manage a booking?',
    a: 'Go to Bookings from the sidebar. Select Month or Week view, choose a date, and create or review an appointment. Bookings are linked to residents, clinicians, appointment types, availability, and notifications.'
  },
  {
    q: 'How does a recording become a care record?',
    a: 'When staff start a recording or live session, the system creates a session, stores the media, generates transcript segments, links the content to a record, and produces an AI summary for review in the Records Library.'
  },
  {
    q: 'What are AI flags?',
    a: 'AI flags are safety alerts created when the system detects possible issues such as fall risk, agitation, distress, or medication refusal. Staff should review each flag, confirm or dismiss it, and then resolve or escalate it.'
  },
  {
    q: 'How should staff review an AI flag?',
    a: 'Open Flags & Reviews, select the flag, review the category, severity, confidence level, related record or clip, and timestamp. Then mark the review outcome as confirmed, false alarm, resolved, or escalated.'
  },
  {
    q: 'Where are transcripts and summaries stored?',
    a: 'Transcripts are stored as transcript segments linked to call sessions and records. AI summaries are stored with the related record so staff can search and review the resident timeline in the Records Library.'
  },
  {
    q: 'Who can access resident information?',
    a: 'Access is controlled by role-based permissions. Admins, nurses, carers, clinicians, family members, and auditors have different access levels. Resident-level access should follow facility scope, resident assignments, consent, and family contact rules.'
  },
  {
    q: 'What actions are audited?',
    a: 'Sensitive actions should be written to audit logs, including viewing or downloading records, viewing resident profiles, reviewing or resolving flags, logging in or out, and changing permissions or roles.'
  },
  {
    q: 'How do messages and notifications work?',
    a: 'Messages are organised into threads with members and read states. Notifications are generated for unread messages, booking updates, AI flags, missed medication events, and other important care activities.'
  },
  {
    q: 'What happens if medication is missed or overdue?',
    a: 'Medication schedules create administration instances. Staff record whether medication was given or missed. Missed or overdue medication can trigger a notification and may also create an optional safety flag.'
  },
  {
    q: 'Why can I not access some pages?',
    a: 'Some pages are restricted by RBAC. For example, Staff & Roles, Admin Console, Reports, audit-related actions, and permission changes may only be available to Admin or authorised users.'
  },
  {
    q: 'How is resident media protected?',
    a: 'Media should be stored securely using encrypted storage and accessed through time-limited signed URLs. The system should avoid storing unnecessary personal information in logs and should follow retention policies for media, transcripts, and audit events.'
  }
];


// ─────────────────────────────────────────────
// QUICK GUIDES DATA — no alert(), modal based
// ─────────────────────────────────────────────
const GUIDES = {
  bookings: {
    title: 'Booking & Availability',
    icon: '📅',
    page: 'booking.html',
    steps: [
      'Open Bookings from the sidebar.',
      'Choose Month or Week view.',
      'Select a date to create or review an appointment.',
      'Check the resident, clinician, appointment type, time, location, and status.',
      'Booking updates should trigger notifications for relevant users.'
    ]
  },

  residents: {
    title: 'Resident Management',
    icon: '🏠',
    page: 'residents.html',
    steps: [
      'Open Residents from the sidebar.',
      'Select a resident profile.',
      'Review resident details, room, care status, family contact, and assigned staff.',
      'Only authorised users should access resident information.',
      'Viewing resident profiles should be treated as a sensitive action for audit logging.'
    ]
  },

  flags: {
    title: 'AI Flag Review Workflow',
    icon: '⚠️',
    page: 'flags.html',
    steps: [
      'Open Flags & Reviews from the sidebar.',
      'Filter flags by severity, category, status, or resident.',
      'Review the AI-detected issue, confidence score, related record, and timestamp.',
      'Choose an outcome such as confirm, false alarm, resolve, or escalate.',
      'Relevant staff should receive notifications after important flag updates.'
    ]
  },

  recording: {
    title: 'Recording → Transcript → Record → Summary',
    icon: '🎥',
    page: 'recording.html',
    steps: [
      'Open Recording Console from the sidebar.',
      'Start a recording or live session.',
      'The system stores the media and creates a linked session.',
      'Speech-to-text generates transcript segments.',
      'A record and AI summary are created for review in Records Library.'
    ]
  },

  staff: {
    title: 'Staff, Roles & RBAC',
    icon: '👥',
    page: 'staff.html',
    steps: [
      'Open Staff & Roles from the sidebar.',
      'Review staff accounts, roles, facility scope, and assigned units.',
      'Update user roles only if you have admin permission.',
      'RBAC controls access to resident records, admin pages, reports, and review actions.',
      'Role and permission changes should be recorded in audit logs.'
    ]
  },

  account: {
    title: 'Account & Security',
    icon: '⚙️',
    page: 'account.html',
    steps: [
      'Open Account from the sidebar.',
      'Review your profile and account details.',
      'Use a strong password and update it when needed.',
      'Admin accounts may require stronger security controls.',
      'Login and logout events should be included in audit logging.'
    ]
  },

  records: {
    title: 'Records Library & Media Catalog',
    icon: '📁',
    page: 'records.html',
    steps: [
      'Open Records Library from the sidebar.',
      'Search records by resident, date, transcript, or summary.',
      'Review linked media, transcript segments, and AI summaries.',
      'Download or view media only when authorised.',
      'Sensitive record access should be written to audit logs.'
    ]
  },

  messages: {
    title: 'Messaging & Notifications',
    icon: '💬',
    page: 'message.html',
    steps: [
      'Open Messages from the sidebar.',
      'Select or create a direct, group, or resident-related thread.',
      'Send messages to authorised staff or family members.',
      'Unread messages update message read states.',
      'Notifications are sent for unread or important messages.'
    ]
  },

  admin: {
    title: 'Admin Console & Audit',
    icon: '🔐',
    page: 'admin.html',
    steps: [
      'Open Admin Console from the sidebar.',
      'Manage users, roles, facility settings, and compliance controls.',
      'Review audit events for sensitive actions.',
      'Check access rules, retention settings, and system status.',
      'Use audit logs as append-only records for compliance.'
    ]
  },

  medication: {
    title: 'Medication Scheduling',
    icon: '💊',
    page: 'booking.html',
    steps: [
      'Create or review medication schedules for residents.',
      'The system generates scheduled administration instances.',
      'Staff record medication as given or missed.',
      'Missed or overdue medication can trigger notifications.',
      'Medication refusal or risk can also become an AI or safety flag.'
    ]
  }
};


// ─────────────────────────────────────────────
// RENDER FAQ
// ─────────────────────────────────────────────
function renderFAQ(filter = '') {
  const list = document.getElementById('faq-list');
  if (!list) return;

  const safeFilter = filter.trim().toLowerCase();

  const filtered = safeFilter
    ? FAQS.filter(f =>
        f.q.toLowerCase().includes(safeFilter) ||
        f.a.toLowerCase().includes(safeFilter)
      )
    : FAQS;

  if (!filtered.length) {
    list.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">No results found. Try a different search term.</div>';
    return;
  }

  list.innerHTML = filtered.map((f, i) => {
    const qText = safeFilter ? highlightText(f.q, safeFilter) : escapeHTML(f.q);
    const aText = safeFilter ? highlightText(f.a, safeFilter) : escapeHTML(f.a);

    return `
      <div class="faq-item">
        <div class="faq-q" onclick="toggleFAQ(this)" id="faq-q-${i}">
          <span>${qText}</span>
          <svg class="faq-chevron" viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="faq-a" id="faq-a-${i}">${aText}</div>
      </div>
    `;
  }).join('');
}


function toggleFAQ(el) {
  const isOpen = el.classList.contains('open');

  document.querySelectorAll('.faq-q').forEach(q => q.classList.remove('open'));
  document.querySelectorAll('.faq-a').forEach(a => a.classList.remove('open'));

  if (!isOpen) {
    el.classList.add('open');
    el.nextElementSibling.classList.add('open');
  }
}


function searchFAQ(val) {
  renderFAQ(val.trim().toLowerCase());
}


// ─────────────────────────────────────────────
// QUICK GUIDE MODAL
// ─────────────────────────────────────────────
function openGuide(key) {
  const guide = GUIDES[key];
  if (!guide) return;

  ensureGuideModal();

  const modal = document.getElementById('guide-modal');
  const icon = document.getElementById('guide-modal-icon');
  const title = document.getElementById('guide-modal-title');
  const body = document.getElementById('guide-modal-body');
  const openPageBtn = document.getElementById('guide-open-page-btn');

  icon.textContent = guide.icon;
  title.textContent = guide.title;

  body.innerHTML = `
    <div class="guide-modal-subtitle">
      Follow these steps based on the Sphere Care MVP workflow.
    </div>

    <div class="guide-step-list">
      ${guide.steps.map((step, index) => `
        <div class="guide-step">
          <div class="guide-step-num">${index + 1}</div>
          <div class="guide-step-text">${escapeHTML(step)}</div>
        </div>
      `).join('')}
    </div>
  `;

  openPageBtn.onclick = function() {
    window.location.href = guide.page;
  };

  modal.classList.add('open');
}


function closeGuideModal() {
  const modal = document.getElementById('guide-modal');
  if (modal) {
    modal.classList.remove('open');
  }
}


function ensureGuideModal() {
  if (document.getElementById('guide-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'guide-modal';
  modal.className = 'guide-modal-overlay';

  modal.innerHTML = `
    <div class="guide-modal-card">
      <div class="guide-modal-header">
        <div class="guide-modal-title-wrap">
          <div class="guide-modal-icon" id="guide-modal-icon">📖</div>
          <div>
            <h3 id="guide-modal-title">Quick Guide</h3>
            <p>Sphere Care workflow guide</p>
          </div>
        </div>
        <button class="guide-modal-close" onclick="closeGuideModal()">×</button>
      </div>

      <div class="guide-modal-body" id="guide-modal-body"></div>

      <div class="guide-modal-footer">
        <button class="guide-btn guide-btn-secondary" onclick="closeGuideModal()">Close</button>
        <button class="guide-btn guide-btn-primary" id="guide-open-page-btn">Open Page</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeGuideModal();
    }
  });

  injectGuideModalCSS();
}


function injectGuideModalCSS() {
  if (document.getElementById('guide-modal-style')) return;

  const style = document.createElement('style');
  style.id = 'guide-modal-style';

  style.textContent = `
    .guide-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;
    }

    .guide-modal-overlay.open {
      opacity: 1;
      pointer-events: all;
    }

    .guide-modal-card {
      width: 100%;
      max-width: 540px;
      background: var(--card, #ffffff);
      border-radius: 20px;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.25);
      overflow: hidden;
      transform: translateY(18px) scale(0.98);
      transition: transform 0.22s ease;
      border: 1px solid rgba(226, 232, 240, 0.9);
    }

    .guide-modal-overlay.open .guide-modal-card {
      transform: translateY(0) scale(1);
    }

    .guide-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 22px 24px 18px;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }

    .guide-modal-title-wrap {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .guide-modal-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: rgba(46, 196, 182, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 21px;
      flex-shrink: 0;
    }

    .guide-modal-header h3 {
      margin: 0;
      font-size: 17px;
      font-weight: 800;
      color: var(--text, #111827);
    }

    .guide-modal-header p {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--text3, #94a3b8);
    }

    .guide-modal-close {
      width: 34px;
      height: 34px;
      border: none;
      border-radius: 10px;
      background: var(--soft, #f1f5f9);
      color: var(--text3, #64748b);
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      transition: 0.18s ease;
    }

    .guide-modal-close:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    .guide-modal-body {
      padding: 22px 24px;
    }

    .guide-modal-subtitle {
      font-size: 13px;
      color: var(--text3, #64748b);
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .guide-step-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .guide-step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
      border-radius: 14px;
      background: var(--soft, #f8fafc);
      border: 1px solid var(--border, #e5e7eb);
    }

    .guide-step-num {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--primary, #2563eb);
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .guide-step-text {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text, #1f2937);
      font-weight: 500;
    }

    .guide-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 24px 22px;
      border-top: 1px solid var(--border, #e5e7eb);
    }

    .guide-btn {
      border: none;
      border-radius: 12px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      transition: 0.18s ease;
    }

    .guide-btn-secondary {
      background: var(--soft, #f1f5f9);
      color: var(--text, #334155);
    }

    .guide-btn-secondary:hover {
      background: #e2e8f0;
    }

    .guide-btn-primary {
      background: var(--primary, #2563eb);
      color: #fff;
    }

    .guide-btn-primary:hover {
      filter: brightness(0.95);
      transform: translateY(-1px);
    }
  `;

  document.head.appendChild(style);
}


// ─────────────────────────────────────────────
// SUBMIT SUPPORT TICKET
// ─────────────────────────────────────────────
function submitTicket() {
  const cat = document.getElementById('ticket-cat').value;
  const subject = document.getElementById('ticket-subject').value.trim();
  const msg = document.getElementById('ticket-msg').value.trim();

  if (!cat) {
    showToast('Please select a category', false);
    return;
  }

  if (!subject) {
    showToast('Please enter a subject', false);
    return;
  }

  if (!msg) {
    showToast('Please describe your issue', false);
    return;
  }

  // No backend API yet.
  // For MVP front-end demo, clear the form and show success.
  document.getElementById('ticket-cat').value = '';
  document.getElementById('ticket-subject').value = '';
  document.getElementById('ticket-msg').value = '';

  showToast('✓ Ticket submitted! We will get back to you within 24 hours.');
}


// ─────────────────────────────────────────────
// CHECK API STATUS
// ─────────────────────────────────────────────
async function checkStatus() {
  try {
    await fetch('http://localhost:8000/docs', {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
  } catch {
    const el = document.getElementById('status-api');
    if (el) {
      el.innerHTML = '<span class="dot dot-amber"></span>Checking…';
    }
  }
}


// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function showToast(msg, success = true) {
  const t = document.getElementById('toast');
  if (!t) return;

  t.textContent = msg;
  t.style.background = success ? '#065f46' : '#7f1d1d';
  t.style.borderLeftColor = success ? 'var(--teal)' : 'var(--red)';
  t.classList.add('show');

  setTimeout(() => {
    t.classList.remove('show');
  }, 3500);
}


// ─────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeGuideModal();
  }

  if (e.altKey) {
    const map = {
      d: 'dashboard.html',
      b: 'booking.html',
      f: 'flags.html',
      m: 'message.html'
    };

    const target = map[e.key.toLowerCase()];

    if (target) {
      e.preventDefault();
      window.location.href = target;
    }
  }
});


// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function highlightText(text, keyword) {
  const safeText = escapeHTML(text);
  const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (!safeKeyword) return safeText;

  return safeText.replace(
    new RegExp(`(${safeKeyword})`, 'gi'),
    '<span class="highlight">$1</span>'
  );
}


// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  renderFAQ();
  checkStatus();
});
