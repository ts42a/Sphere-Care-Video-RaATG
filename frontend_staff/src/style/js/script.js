function showPage(name) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  const targetPage = document.getElementById('page-' + name);
  if (targetPage) {
    targetPage.classList.add('active');
  }
}

function setRole(role) {
  const btnStaff = document.getElementById('btn-staff');
  const btnAdmin = document.getElementById('btn-admin');

  if (!btnStaff || !btnAdmin) return;

  if (role === 'staff') {
    btnStaff.classList.add('active');
    btnAdmin.classList.remove('active');
  } else {
    btnAdmin.classList.add('active');
    btnStaff.classList.remove('active');
  }
}

function togglePwd(inputId, eyeElement) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.type = input.type === 'password' ? 'text' : 'password';

  if (eyeElement) {
    eyeElement.style.opacity = input.type === 'text' ? '0.6' : '1';
  }
}

const labels = {
  dashboard: 'Dashboard',
  recording: 'Recording Console',
  monitoring: 'Live Monitoring',
  records: 'Records Library',
  flags: 'Flags & Reviews',
  residents: 'Residents',
  bookings: 'Bookings',
  staff: 'Staff & Roles',
  admin: 'Admin Console',
  reports: 'Reports / Analytics',
  notifications: 'Notifications',
  messages: 'Messages',
  help: 'Help & Support',
  account: 'Account'
};

function navigate(page, el) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });

  if (el) {
    el.classList.add('active');
  }

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) {
    topbarTitle.textContent = labels[page] || page;
  }

  document.querySelectorAll('.page-section').forEach(section => {
    section.classList.remove('active');
  });

  const targetSection = document.getElementById('sec-' + page);
  if (targetSection) {
    targetSection.classList.add('active');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const topbarDate = document.getElementById('topbar-date');
  if (topbarDate) {
    const d = new Date();
    topbarDate.textContent = d.toLocaleDateString('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
});
