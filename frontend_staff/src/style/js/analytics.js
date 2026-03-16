let barChart, pieChart, kpiBarChart;
let currentPeriod = '30d';

// ── DEPT BAR COLOURS (matching screenshot) ──
const DEPT_COLOURS = ['#3b82f6','#f59e0b','#22c55e','#a855f7','#ef4444','#06b6d4'];
const PIE_COLOURS  = ['#22c55e','#f59e0b','#ef4444','#3b82f6','#a855f7'];

// ── AUTH GUARD ──
function checkAccess() {
  try {
    const user  = JSON.parse(localStorage.getItem('user') || '{}');
    const token = localStorage.getItem('access_token');
    if (!token || !user.role) { window.location.href = 'register-login.html'; return false; }
    if (user.role !== 'admin') {
      document.getElementById('access-denied').style.display = 'flex';
      document.getElementById('main-panel').style.display    = 'none';
      document.getElementById('period-select').style.display = 'none';
      return false;
    }
    document.getElementById('access-denied').style.display = 'none';
    const panel = document.getElementById('main-panel');
    panel.style.display = 'flex';
    return true;
  } catch { window.location.href = 'register-login.html'; return false; }
}

// ── TABS ──
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ── PERIOD CHANGE ──
function onPeriodChange() {
  currentPeriod = document.getElementById('period-select').value;
  loadData();
}

// ── LOAD DATA ──
async function loadData() {
  try {
    const res  = await fetch(`${API_BASE}/analytics/report?period=${currentPeriod}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderBarChart(data.monthly_activity);
    renderPieChart(data.task_distribution);
    renderDeptBars(data.department_performance);
    renderKPIs(data.task_distribution);
    renderKpiBar(data.task_distribution);
  } catch {
    // Fallback demo data matching screenshot
    renderBarChart([
      {month:'Mon',count:44},{month:'Tue',count:37},{month:'Wed',count:50},
      {month:'Thu',count:41},{month:'Fri',count:45},{month:'Sat',count:31},{month:'Sun',count:25},
    ]);
    renderPieChart([
      {task_type:'Completed',count:45,percentage:45},
      {task_type:'Pending',count:28,percentage:28},
      {task_type:'Escalated',count:15,percentage:15},
      {task_type:'Scheduled',count:12,percentage:12},
    ]);
    renderDeptBars([
      {department:'Emergency Care',score:96},
      {department:'Cardiology',score:91},
      {department:'Neurology',score:88},
      {department:'Pediatrics',score:85},
      {department:'Orthopaedics',score:82},
    ]);
    renderKPIs([
      {task_type:'Completed',count:45,percentage:45},
      {task_type:'Pending',count:28,percentage:28},
      {task_type:'Escalated',count:15,percentage:15},
      {task_type:'Scheduled',count:12,percentage:12},
    ]);
    renderKpiBar([
      {task_type:'Completed',count:45,percentage:45},
      {task_type:'Pending',count:28,percentage:28},
      {task_type:'Escalated',count:15,percentage:15},
      {task_type:'Scheduled',count:12,percentage:12},
    ]);
  }
}

// ── BAR CHART ──
function renderBarChart(data) {
  const ctx = document.getElementById('bar-chart').getContext('2d');
  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.month),
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: '#3b82f6',
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Manrope', size: 11 } } },
        y: { grid: { color: '#f0f4f8' }, ticks: { font: { family: 'Manrope', size: 11 } }, beginAtZero: true },
      }
    }
  });
}

// ── PIE CHART ──
function renderPieChart(data) {
  const ctx = document.getElementById('pie-chart').getContext('2d');
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: data.map(d => `${d.task_type}: ${d.percentage}%`),
      datasets: [{
        data: data.map(d => d.percentage),
        backgroundColor: PIE_COLOURS,
        borderWidth: 2,
        borderColor: '#fff',
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { family: 'Manrope', size: 11 }, padding: 14, boxWidth: 12 }
        }
      }
    }
  });
}

// ── DEPT BARS ──
function renderDeptBars(data) {
  const el = document.getElementById('dept-list');
  el.innerHTML = data.map((d, i) => `
    <div class="dept-row">
      <div class="dept-label-row">
        <span class="dept-name">${d.department}</span>
        <span class="dept-score">${d.score}%</span>
      </div>
      <div class="dept-bar-bg">
        <div class="dept-bar-fill" style="width:${d.score}%;background:${DEPT_COLOURS[i % DEPT_COLOURS.length]};">
          ${d.score >= 20 ? d.score + '%' : ''}
        </div>
      </div>
    </div>
  `).join('');
  // Animate bars in
  setTimeout(() => {
    el.querySelectorAll('.dept-bar-fill').forEach(b => b.style.width = b.style.width);
  }, 50);
}

// ── KPI CARDS ──
function renderKPIs(taskData) {
  const total     = taskData.reduce((s, d) => s + d.count, 0);
  const completed = taskData.find(d => d.task_type === 'Completed')?.count || 0;
  const pending   = taskData.find(d => d.task_type === 'Pending')?.count   || 0;
  const escalated = taskData.find(d => d.task_type === 'Escalated')?.count || 0;
  const rate      = total ? Math.round(completed / total * 100) : 0;

  document.getElementById('kpi-grid').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Total Bookings</div>
      <div class="kpi-num" style="color:var(--blue);">${total}</div>
      <div class="kpi-sub">This period</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Completion Rate</div>
      <div class="kpi-num" style="color:var(--green);">${rate}%</div>
      <div class="kpi-sub">${completed} completed</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Pending</div>
      <div class="kpi-num" style="color:var(--amber);">${pending}</div>
      <div class="kpi-sub">Awaiting action</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Escalated</div>
      <div class="kpi-num" style="color:var(--red);">${escalated}</div>
      <div class="kpi-sub">Needs review</div>
    </div>
  `;
}

// ── KPI BAR CHART ──
function renderKpiBar(data) {
  const ctx = document.getElementById('kpi-bar-chart').getContext('2d');
  if (kpiBarChart) kpiBarChart.destroy();
  kpiBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.task_type),
      datasets: [{
        label: 'Bookings',
        data: data.map(d => d.count),
        backgroundColor: PIE_COLOURS,
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Manrope', size: 12 } } },
        y: { grid: { color: '#f0f4f8' }, ticks: { font: { family: 'Manrope', size: 12 } }, beginAtZero: true },
      }
    }
  });
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  if (checkAccess()) loadData();
});