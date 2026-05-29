/**
 * Tests for flags.js logic
 * Covers: severity colour mapping, status badge, filter logic
 */

function getSeverityColor(severity) {
  const map = { High: '#dc2626', Medium: '#d97706', Low: '#059669' };
  return map[severity] || '#6b7280';
}

function getStatusBadgeClass(status) {
  const map = {
    'Pending Review': 'badge-warning',
    'Open':           'badge-info',
    'Resolved':       'badge-success',
    'false_alarm':    'badge-neutral',
    'in_review':      'badge-warning',
    'confirmed':      'badge-danger',
    'escalated':      'badge-danger',
  };
  return map[status] || 'badge-default';
}

function filterFlags(flags, { severity, status, search }) {
  return flags.filter(f => {
    if (severity && f.severity !== severity) return false;
    if (status && f.status !== status) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!f.resident_name.toLowerCase().includes(q) &&
          !f.event_type.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

const SAMPLE_FLAGS = [
  { id: 1, resident_name: 'Hannah Li',   event_type: 'Distress', severity: 'Medium', status: 'Pending Review' },
  { id: 2, resident_name: 'George Patel',event_type: 'Pain',     severity: 'High',   status: 'Pending Review' },
  { id: 3, resident_name: 'Sarah J',     event_type: 'Pain',     severity: 'Low',    status: 'Resolved' },
  { id: 4, resident_name: 'Patrick Ellis',event_type:'Agitation',severity: 'Low',    status: 'Open' },
];

describe('getSeverityColor', () => {
  test('High = red', () => expect(getSeverityColor('High')).toBe('#dc2626'));
  test('Medium = amber', () => expect(getSeverityColor('Medium')).toBe('#d97706'));
  test('Low = green', () => expect(getSeverityColor('Low')).toBe('#059669'));
  test('unknown = grey', () => expect(getSeverityColor('Unknown')).toBe('#6b7280'));
});

describe('getStatusBadgeClass', () => {
  test('Pending Review → badge-warning', () => {
    expect(getStatusBadgeClass('Pending Review')).toBe('badge-warning');
  });
  test('Resolved → badge-success', () => {
    expect(getStatusBadgeClass('Resolved')).toBe('badge-success');
  });
  test('unknown → badge-default', () => {
    expect(getStatusBadgeClass('something')).toBe('badge-default');
  });
});

describe('filterFlags', () => {
  test('no filter returns all', () => {
    expect(filterFlags(SAMPLE_FLAGS, {})).toHaveLength(4);
  });

  test('filter by severity', () => {
    const result = filterFlags(SAMPLE_FLAGS, { severity: 'High' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  test('filter by status', () => {
    const result = filterFlags(SAMPLE_FLAGS, { status: 'Resolved' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  test('search by resident name', () => {
    const result = filterFlags(SAMPLE_FLAGS, { search: 'hannah' });
    expect(result).toHaveLength(1);
    expect(result[0].resident_name).toBe('Hannah Li');
  });

  test('search by event type', () => {
    const result = filterFlags(SAMPLE_FLAGS, { search: 'pain' });
    expect(result).toHaveLength(2);
  });

  test('combined filter', () => {
    const result = filterFlags(SAMPLE_FLAGS, { severity: 'Low', status: 'Resolved' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });
});
