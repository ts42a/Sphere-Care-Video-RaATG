// ── FAQ DATA ──
const FAQS = [
  {
    q: 'How do I create a new booking for a resident?',
    a: 'Go to Bookings in the sidebar, click the calendar date you want, then fill in the doctor, resident, and appointment type. The booking will appear on the calendar immediately.'
  },
  {
    q: 'How do I reset my password?',
    a: 'Go to Account in the sidebar, scroll to the Change Password section, enter your current password followed by your new password. Make sure it has at least 8 characters, one uppercase letter, one number, and one special character.'
  },
  {
    q: 'What does an AI flag mean and what should I do?',
    a: 'An AI flag is automatically raised when the system detects a potential concern — such as pain, distress, or a fall risk — based on camera footage or audio. Review the flag in Flags & Reviews, watch the video clip if available, then mark it as Resolved or Escalate to a senior staff member.'
  },
  {
    q: 'Why is a camera showing as offline?',
    a: 'A camera goes offline when it loses network connectivity or is powered down. Check the physical connection and power supply. If the issue persists, contact your facility IT team or submit a support ticket below.'
  },
  {
    q: 'How do I add or edit a staff member?',
    a: 'Staff & Roles is accessible to Admin accounts only. Go to Staff & Roles, find the staff member in the table, and click the eye icon to open the edit modal. You can update their shift time, assigned unit, status, and role.'
  },
  {
    q: 'Can staff members see admin-only pages?',
    a: 'No. Pages like Staff & Roles, Admin Console, and Reports & Analytics are restricted to Admin accounts. Staff accounts will see an Access Denied screen if they try to navigate there.'
  },
  {
    q: 'How do I upload a profile photo?',
    a: 'Go to Account in the sidebar and click on the avatar circle at the top of your profile card, or click the camera icon. Select an image file under 3MB. Your photo is saved locally in your browser.'
  },
  {
    q: 'How do notifications work?',
    a: 'Notifications are generated from bookings and AI alerts. The Notifications page shows all activity from the current week, filterable by type. You can mark individual notifications as read or they will automatically clear once actioned.'
  },
];

// ── RENDER FAQ ──
function renderFAQ(filter = '') {
  const list = document.getElementById('faq-list');
  const filtered = filter
    ? FAQS.filter(f => f.q.toLowerCase().includes(filter) || f.a.toLowerCase().includes(filter))
    : FAQS;

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">No results found. Try a different search term.</div>';
    return;
  }

  list.innerHTML = filtered.map((f, i) => {
    const qText = filter ? f.q.replace(new RegExp(`(${filter})`, 'gi'), '<span class="highlight">$1</span>') : f.q;
    const aText = filter ? f.a.replace(new RegExp(`(${filter})`, 'gi'), '<span class="highlight">$1</span>') : f.a;
    return `
      <div class="faq-item">
        <div class="faq-q" onclick="toggleFAQ(this)" id="faq-q-${i}">
          <span>${qText}</span>
          <svg class="faq-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="faq-a" id="faq-a-${i}">${aText}</div>
      </div>`;
  }).join('');
}

function toggleFAQ(el) {
  const isOpen = el.classList.contains('open');
  // Close all
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

// ── QUICK GUIDES ──
const GUIDES = {
  bookings:   'Navigate to Bookings → select Month or Week view → click a date to see existing bookings → use the right panel to view today\'s appointments.',
  residents:  'Go to Residents → click any resident card to see full profile, AI summary, and care history.',
  flags:      'Open Flags & Reviews → filter by severity or status → click a flag to watch the video clip and read the AI transcript → mark as Resolved or Escalate.',
  recording:  'Go to Recording Console → view live camera feeds → click a camera tile to expand → AI alerts appear in the right panel.',
  staff:      'Admin only: go to Staff & Roles → view the staff table → click the eye icon to edit shift times, units, or status.',
  account:    'Go to Account → click your avatar to upload a photo → edit your name → use Change Password to update your credentials.',
};

function openGuide(key) {
  alert(`📖  ${GUIDES[key]}`);
}

// ── SUBMIT TICKET ──
function submitTicket() {
  const cat     = document.getElementById('ticket-cat').value;
  const subject = document.getElementById('ticket-subject').value.trim();
  const msg     = document.getElementById('ticket-msg').value.trim();

  if (!cat)     { showToast('Please select a category', false); return; }
  if (!subject) { showToast('Please enter a subject', false); return; }
  if (!msg)     { showToast('Please describe your issue', false); return; }

  // In production: POST to your support API
  document.getElementById('ticket-cat').value     = '';
  document.getElementById('ticket-subject').value = '';
  document.getElementById('ticket-msg').value     = '';
  showToast('✓  Ticket submitted! We\'ll get back to you within 24 hours.');
}

// ── CHECK API STATUS ──
async function checkStatus() {
  try {
    const res = await fetch('http://localhost:8000/docs', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    // API is up — already showing green
  } catch {
    const el = document.getElementById('status-api');
    el.innerHTML = '<span class="dot dot-amber"></span>Checking…';
  }
}

// ── TOAST ──
function showToast(msg, success = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = success ? '#065f46' : '#7f1d1d';
  t.style.borderLeftColor = success ? 'var(--teal)' : 'var(--red)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ── KEYBOARD SHORTCUTS ──
document.addEventListener('keydown', e => {
  if (e.altKey) {
    const map = { d:'dashboard.html', b:'booking.html', f:'flags.html', m:'message.html' };
    if (map[e.key.toLowerCase()]) {
      e.preventDefault();
      window.location.href = map[e.key.toLowerCase()];
    }
  }
});