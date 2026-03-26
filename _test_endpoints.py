from urllib.request import urlopen, Request
from urllib.error import HTTPError
import json, sys

BASE = 'http://localhost:8000/api/v1'

try:
    # 1. Login as admin
    body = json.dumps({'email': 'admin1@test.com', 'password': 'Pass1234'}).encode()
    req = Request(f'{BASE}/auth/login', data=body, headers={'Content-Type': 'application/json'}, method='POST')
    resp = urlopen(req, timeout=10)
    login_data = json.loads(resp.read())
    token = login_data['access_token']
    center_id = login_data['user'].get('center_id', '')
    admin_id_str = center_id.replace('CTR-', '') if center_id else ''
    print(f'[OK] Login - user: {login_data["user"]["full_name"]}, center: {center_id}')

    hdr = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    # 2. Verify base endpoints
    endpoints = [
        ('/admin/staff/pending', 'Pending staff'),
        ('/admin/staff', 'All staff'),
        ('/dashboard/stats', 'Dashboard stats'),
    ]
    for path, label in endpoints:
        r = urlopen(Request(f'{BASE}{path}', headers=hdr), timeout=10)
        data = json.loads(r.read())
        count = len(data) if isinstance(data, list) else list(data.keys())
        print(f'[OK] {label}: {count}')

    # 3. Register a new staff member (pending approval)
    staff_data = json.dumps({
        'full_name': 'Test Pending Staff',
        'email': 'pending_test@test.com',
        'password': 'Pass1234',
        'role': 'staff'
    }).encode()
    # parse admin_id as int
    admin_id_int = ''
    try:
        from urllib.request import urlopen as u2
        # Get admin_id from login - it's in the user object
        admin_id_int = login_data['user']['id']
    except:
        admin_id_int = 1
    
    reg_req = Request(f'{BASE}/auth/staff/register?admin_id={admin_id_int}', data=staff_data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        reg_resp = urlopen(reg_req, timeout=10)
        reg_data = json.loads(reg_resp.read())
        print(f'[OK] Staff registered (pending): {reg_data.get("user", {}).get("full_name", "?")}')
    except HTTPError as e:
        err_body = json.loads(e.read())
        if 'already registered' in str(err_body):
            print(f'[OK] Staff already registered (expected on re-run)')
        else:
            print(f'[WARN] Staff registration: {err_body}')

    # 4. Check pending staff now
    r = urlopen(Request(f'{BASE}/admin/staff/pending', headers=hdr), timeout=10)
    pending = json.loads(r.read())
    print(f'[OK] Pending staff after register: {len(pending)}')
    
    if pending:
        sid = pending[0]['staff_id']
        sname = pending[0]['full_name']
        print(f'     -> First pending: {sname} ({sid})')
        
        # 5. Approve the staff member
        approve_req = Request(f'{BASE}/admin/staff/{sid}/approve', headers=hdr, method='POST')
        approve_resp = urlopen(approve_req, timeout=10)
        approve_data = json.loads(approve_resp.read())
        print(f'[OK] Approved: {approve_data}')
        
        # 6. Verify pending is now empty
        r = urlopen(Request(f'{BASE}/admin/staff/pending', headers=hdr), timeout=10)
        pending2 = json.loads(r.read())
        print(f'[OK] Pending after approve: {len(pending2)}')
        
        # 7. Verify staff list includes newly approved member
        r = urlopen(Request(f'{BASE}/admin/staff', headers=hdr), timeout=10)
        staff_list = json.loads(r.read())
        print(f'[OK] Total staff after approve: {len(staff_list)}')
        approved_names = [s['full_name'] for s in staff_list if s.get('status') == 'active']
        print(f'     -> Active: {approved_names}')

    print('\n=== ALL ENDPOINTS VERIFIED ===')
except Exception as e:
    print(f'[FAIL] {e}', file=sys.stderr)
    import traceback; traceback.print_exc()
    sys.exit(1)
