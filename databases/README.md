# Databases Directory

This directory stores isolated SQLite databases for each admin/care center in the Sphere Care system.

## Structure

```
databases/
├── admin_1/
│   ├── sphere_care.db          # Database containing all admin_1's data
│   └── uploads/
│       ├── documents/
│       ├── images/
│       └── videos/
│
├── admin_2/
│   ├── sphere_care.db          # Database containing all admin_2's data
│   └── uploads/
│       ├── documents/
│       ├── images/
│       └── videos/
│
└── admin_N/
    ├── sphere_care.db
    └── uploads/
```

## Key Points

### Database Organization
- **Each admin gets a unique folder** named `admin_{admin_id}`
- **Complete data isolation** - No shared data between admins
- **Separate uploads folder** for each admin's files
- **SQLite database file** (`sphere_care.db`) contains all tables with admin_id records

### How It Works

1. **Master Database** (separate, not in this folder)
   - Contains only admin user accounts
   - Used for login and authentication
   - Managed separately in root backend config

2. **Admin Database** (in this folder)
   - Created when a new admin registers
   - Contains residents, staff, bookings, cameras, flags, etc.
   - All records tagged with `admin_id`
   - Completely isolated from other admins

### Tables in Each Database

Every admin database contains:
```
users                 (admin_id, user_id, ...)
staff                 (admin_id, staff_id, ...)
residents             (admin_id, resident_id, ...)
bookings              (admin_id, booking_id, ...)
cameras               (admin_id, camera_id, ...)
camera_alerts         (admin_id, alert_id, ...)
flags                 (admin_id, flag_id, ...)
flag_comments         (admin_id, comment_id, ...)
records               (admin_id, record_id, ...)
conversations         (admin_id, conversation_id, ...)
messages              (admin_id, message_id, ...)
notifications         (admin_id, notification_id, ...)
alerts                (admin_id, alert_id, ...)
ai_insights           (admin_id, insight_id, ...)
```

All tables include `admin_id` column for data consistency (typically equals the folder's admin number).

## Operations

### Create New Admin Database
```python
from backend.db.db_init import initialize_new_admin_database

# Called when admin registers
success = initialize_new_admin_database(admin_id=123)
# Creates: databases/admin_123/ with sphere_care.db and uploads/ folders
```

### Query Admin's Data
```python
from backend.db.db_manager import AdminDatabaseManager

admin_id = 123
SessionLocal = AdminDatabaseManager.get_admin_session_local(admin_id)
db = SessionLocal()

# Query data (automatically uses databases/admin_123/sphere_care.db)
residents = db.query(Resident).filter(Resident.admin_id == admin_id).all()

db.close()
```

### List All Admins
```python
from backend.db.db_init import list_all_admin_databases

all_dbs = list_all_admin_databases()
# Returns: {1: '/path/to/admin_1/sphere_care.db', 2: '/path/to/admin_2/sphere_care.db', ...}
```

### Verify Admin Database Exists
```python
from backend.db.db_init import verify_admin_database_exists

exists = verify_admin_database_exists(admin_id=123)
# Returns: True if database exists and is accessible, False otherwise
```

## Backup & Restore

### Backup All Admin Databases
```bash
# Unix/Linux
for dir in databases/admin_*/; do
    admin_id=$(basename "$dir" | sed 's/admin_//')
    tar -czf "backup_admin_${admin_id}_$(date +%Y%m%d).tar.gz" "$dir"
done

# Windows PowerShell
Get-ChildItem databases/admin_* | foreach {
    $admin_id = $_.Name -replace "admin_", ""
    $date = Get-Date -Format "yyyyMMdd"
    Compress-Archive -Path $_.FullName -DestinationPath "backup_admin_${admin_id}_${date}.zip"
}
```

### Backup Single Admin
```bash
# Unix/Linux
tar -czf "backup_admin_1_$(date +%Y%m%d).tar.gz" databases/admin_1/

# Windows PowerShell
Compress-Archive -Path databases/admin_1 -DestinationPath "backup_admin_1_20240101.zip"
```

### Restore Admin Database
```bash
# Unix/Linux
tar -xzf backup_admin_1_20240101.tar.gz -C .

# Windows PowerShell
Expand-Archive -Path backup_admin_1_20240101.zip -DestinationPath . -Force
```

## File Management

### Storage Per Admin
```
admin_1/
├── sphere_care.db              # ~2-10MB depending on data
└── uploads/
    ├── documents/              # PDFs, reports, etc.
    ├── images/                 # Photos, screenshots
    └── videos/                 # Camera feeds, recordings
```

### Disk Usage Commands
```bash
# Check size of specific admin database
du -sh databases/admin_1/

# Check all admin databases
du -sh databases/admin_*/

# Find largest databases
du -sh databases/admin_*/ | sort -h

# Check total databases size
du -sh databases/
```

## Database Maintenance

### Update Database Schema
When you make schema changes:

```python
from backend.db.db_init import migrate_admin_database

# Migrate specific admin
migrate_admin_database(admin_id=1)

# Migrate all admins
from backend.db.db_init import list_all_admin_databases

for admin_id in list_all_admin_databases().keys():
    migrate_admin_database(admin_id=admin_id)
```

### Database Cleanup
```python
from backend.db.db_manager import AdminDatabaseManager

# Remove old admin database
admin_id = 999
db_path = AdminDatabaseManager.get_admin_db_path(admin_id)
# Manually delete: shutil.rmtree(f"databases/admin_{admin_id}")
```

### Export Admin Data
```python
from backend.db.db_manager import AdminDatabaseManager
import sqlite3

admin_id = 1
db_path = AdminDatabaseManager.get_admin_db_path(admin_id).replace("sqlite:///", "")

# Export to CSV
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT * FROM residents")
residents = cursor.fetchall()

import csv
with open(f"admin_{admin_id}_residents.csv", "w") as f:
    writer = csv.writer(f)
    writer.writerows(residents)

conn.close()
```

## Permissions & Access Control

### Directory Permissions (Linux/Mac)
```bash
# Restrict access to databases folder
chmod 700 databases/

# Restrict each admin's folder
chmod 700 databases/admin_*/

# Allow read/write for application only
chown app_user:app_group databases/
chown app_user:app_group databases/admin_*
```

### Windows Security
```powershell
# Set NTFS permissions
$acl = Get-Acl "databases"
$permission = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "AppUser",
    "Modify",
    "ContainerInherit, ObjectInherit",
    "None",
    "Allow"
)
$acl.SetAccessRule($permission)
Set-Acl "databases" $acl
```

## Troubleshooting

### Issue: "No such file or directory: databases/admin_1/sphere_care.db"
**Solution**: Run initialization
```python
from backend.db.db_init import initialize_new_admin_database
initialize_new_admin_database(admin_id=1)
```

### Issue: Database File Locked
**Solution**: Check for active connections
```bash
# Find processes using the database
lsof | grep sphere_care.db
```

### Issue: Corrupted Database
**Solution**: Attempt repair
```python
import sqlite3
db_path = "databases/admin_1/sphere_care.db"
conn = sqlite3.connect(db_path)
conn.execute("PRAGMA integrity_check")
```

### Issue: Out of Disk Space
**Solution**: Check storage usage
```bash
du -sh databases/
du -sh databases/admin_*/
df -h  # Check filesystem
```

## Best Practices

✅ **DO**
- [ ] Backup all admin databases regularly
- [ ] Monitor disk usage per admin
- [ ] Use read-only access when possible
- [ ] Maintain folder structure
- [ ] Keep admin_id consistent with database IDs
- [ ] Test disaster recovery procedures

❌ **DON'T**
- [ ] Never manually delete admin folders without backup
- [ ] Don't share database files between instances
- [ ] Don't modify sphere_care.db files directly
- [ ] Don't ignore permission errors
- [ ] Don't mix admin databases

## Monitoring Script

```python
# Monitor all admin databases
from backend.db.db_init import list_all_admin_databases
from backend.db.db_manager import AdminDatabaseManager
import os

for admin_id, db_path in list_all_admin_databases().items():
    folder_size = sum(
        os.path.getsize(os.path.join(dirpath, filename))
        for dirpath, dirnames, filenames in os.walk(f"databases/admin_{admin_id}")
        for filename in filenames
    ) / (1024 * 1024)  # Convert to MB
    
    print(f"Admin {admin_id}: {folder_size:.2f} MB")
```

## Summary

The `databases/` directory structure ensures:
- ✓ Complete data isolation between care centers
- ✓ Easy backup and restore per admin
- ✓ Scalable storage organization
- ✓ Secure file separation
- ✓ Simple admin database management
