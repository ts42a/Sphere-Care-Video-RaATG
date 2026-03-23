# Multi-Database Architecture Overview

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sphere Care Application                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
        ┌───────▼────────┐        ┌────────▼──────────┐
        │  Master DB     │        │   Admin Auth     │
        │ (Admins only)  │        │   Service        │
        │                │        │                  │
        │ - Admin Users  │        │ - JWT Token      │
        │ - Organization │        │ - Includes       │
        │   Data         │        │   admin_id       │
        └────────────────┘        └────────┬─────────┘
                                           │
                        ┌──────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────┐
        │   Extract admin_id from JWT     │
        └──────────────┬──────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  AdminDatabaseManager       │
        │  get_admin_session_local()  │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────────────────────────────┐
        │        Load Admin-Specific Database                │
        │     (from databases/admin_{id}/sphere_care.db)    │
        └──────────────┬──────────────────────────────────────┘
                       │
    ┌──────────────────┼──────────────────┐
    │                  │                  │
    ▼                  ▼                  ▼
┌────────────┐   ┌────────────┐   ┌────────────┐
│  Residents │   │   Staff    │   │   Bookings │
│            │   │            │   │            │
│ admin_id=1 │   │ admin_id=1 │   │ admin_id=1 │
└────────────┘   └────────────┘   └────────────┘

    ┌──────────────────┼──────────────────┐
    │                  │                  │
    ▼                  ▼                  ▼
┌────────────┐   ┌────────────┐   ┌────────────┐
│  Cameras   │   │   Flags    │   │ Alerts     │
│            │   │            │   │            │
│ admin_id=1 │   │ admin_id=1 │   │ admin_id=1 │
└────────────┘   └────────────┘   └────────────┘
```

## Database File Structure

```
databases/
│
├── admin_1/                          # Care Center 1
│   ├── sphere_care.db               # Contains all data for admin 1
│   │   ├── users (admin_id=1)
│   │   ├── residents (admin_id=1)
│   │   ├── staff (admin_id=1)
│   │   ├── bookings (admin_id=1)
│   │   └── ... (all tables)
│   │
│   └── uploads/
│       ├── documents/
│       │   └── resident_documents_1.pdf
│       ├── images/
│       │   └── resident_photo_1.jpg
│       └── videos/
│           └── camera_feed_1.mp4
│
├── admin_2/                          # Care Center 2
│   ├── sphere_care.db               # Completely isolated from admin_1
│   │   ├── users (admin_id=2)
│   │   ├── residents (admin_id=2)
│   │   ├── staff (admin_id=2)
│   │   └── ... (all tables)
│   │
│   └── uploads/
│       ├── documents/
│       ├── images/
│       └── videos/
│
└── admin_N/                          # Care Center N
    ├── sphere_care.db
    └── uploads/
```

## Data Relationships

### Admin 1 (Example)
```
┌─────────────────────────────────────────────────────┐
│ ADMIN 1 - Central Care Centre                       │
│ Database: databases/admin_1/sphere_care.db          │
└─────────────────────────────────────────────────────┘
         │
         ├─ STAFF
         │  ├─ id: 1, admin_id: 1, name: "Alice Smith"
         │  ├─ id: 2, admin_id: 1, name: "Bob Johnson"
         │  └─ id: 3, admin_id: 1, name: "Carol Davis"
         │
         ├─ RESIDENTS
         │  ├─ id: 1, admin_id: 1, name: "John Doe", room: "101"
         │  ├─ id: 2, admin_id: 1, name: "Jane Smith", room: "102"
         │  ├─ id: 3, admin_id: 1, name: "Bob Wilson", room: "103"
         │  └─ id: 4, admin_id: 1, name: "Alice Brown", room: "104"
         │
         ├─ BOOKINGS
         │  ├─ id: 1, admin_id: 1, resident_id: 1, ...
         │  └─ id: 2, admin_id: 1, resident_id: 2, ...
         │
         ├─ CAMERAS
         │  ├─ id: 1, admin_id: 1, room: "101", resident_name: "John"
         │  └─ id: 2, admin_id: 1, room: "102", resident_name: "Jane"
         │
         └─ ... all other tables
```

### Admin 2 (Example)
```
┌─────────────────────────────────────────────────────┐
│ ADMIN 2 - Westside Care Tower                       │
│ Database: databases/admin_2/sphere_care.db          │
└─────────────────────────────────────────────────────┘
         │
         ├─ STAFF
         │  ├─ id: 1, admin_id: 2, name: "David Lee"
         │  └─ id: 2, admin_id: 2, name: "Emma Watson"
         │
         ├─ RESIDENTS
         │  ├─ id: 1, admin_id: 2, name: "Robert Jones", room: "201"
         │  └─ id: 2, admin_id: 2, name: "Mary Garcia", room: "202"
         │
         └─ ... all other tables
```

## Request Flow

### 1. Admin Login
```
┌──────────────┐
│ Admin enters │
│ credentials  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│ POST /api/auth/login         │
│ {email, password}            │
└──────┬───────────────────────┘
       │
       ▼
┌────────────────────────────────┐
│ Authenticate against Master DB │
│ (backend/db/session.py)        │
└──────┬─────────────────────────┘
       │
       ▼
┌────────────────────────────┐
│ Create JWT with admin_id   │
│ Token: {sub, admin_id, ..} │
└──────┬─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ Return JWT Token    │
│ to Client           │
└─────────────────────┘
```

### 2. Access Protected Route
```
┌──────────────┐
│ Send Request │
│ with JWT     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│ GET /api/residents           │
│ Header: Authorization: Bearer │
└──────┬───────────────────────┘
       │
       ▼
┌────────────────────────────────┐
│ Dependency: get_admin_context_db│
│ Extracts admin_id from JWT      │
└──────┬─────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ AdminDatabaseManager             │
│ get_admin_session_local(admin_id)│
└──────┬────────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│ Open database for admin_id       │
│ databases/admin_1/sphere_care.db │
└──────┬─────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Query residents WHERE admin_id = 1   │
│ Returns only admin_1's residents     │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────┐
│ Return data  │
│ to client    │
└──────────────┘
```

## Key Components

### 1. AdminDatabaseManager (backend/db/db_manager.py)
```
┌────────────────────────────────────────┐
│    AdminDatabaseManager                │
├────────────────────────────────────────┤
│ + ensure_admin_db_folder()             │
│ + get_admin_db_path()                  │
│ + get_admin_engine()                   │
│ + get_admin_session_local()            │
│ + initialize_admin_db()                │
│ + get_admin_folder_structure()         │
│ + ensure_admin_subdirectories()        │
└────────────────────────────────────────┘
```

### 2. Database Session Strategy
```
Single Request →
    ↓
JWT Token (contains admin_id)
    ↓
Dependency Injection (get_admin_context_db)
    ↓
AdminDatabaseManager.get_admin_session_local(admin_id)
    ↓
SessionLocal Factory for admin_id
    ↓
SQLAlchemy Session
    ↓
Query Data with automatic admin_id filtering
    ↓
Response to client
```

### 3. Multi-Tenancy Layer
```
Application Layer (API Routes)
    ↓ [admin_id filter in queries]
    ↓
Repository/Service Layer
    ↓ [admin_id parameter passed]
    ↓
Database Session Layer
    ↓ [admin_id in where clauses]
    ↓
Admin-Specific Database
```

## Security Model

### Isolation Levels

1. **Database Level**
   - Physical database files separated
   - No shared database connections
   - No cross-admin database access possible

2. **Session Level**
   - Each request gets admin-specific session
   - Session cannot access other admin's database

3. **Query Level**
   - All queries must include admin_id filter
   - Database constraints enforce admin_id on foreign keys

4. **API Level**
   - JWT token contains admin_id
   - Dependency injection enforces admin context
   - All responses filtered by admin_id

### Attack Prevention

```
Scenario: Admin 2 tries to access Admin 1's residents

Request: GET /api/residents?admin_id=1
Header: JWT with admin_id=2

Flow:
1. get_admin_context_db extracts admin_id=2 from JWT
2. SessionLocal for admin_id=2 loaded
3. Query: SELECT * FROM residents WHERE admin_id=2
4. Result: Only admin_2's residents returned
5. admin_id=1 filter in query parameter ignored

Result: ✓ SECURE - Request parameter ignored, JWT token used
```

## Performance Considerations

### Advantages
- ✓ Faster queries on smaller datasets
- ✓ Independent backups per admin
- ✓ Easier to scale horizontally
- ✓ Better disk I/O distribution

### Trade-offs
- ⚠️ More database files to manage
- ⚠️ Backups must handle multiple databases
- ⚠️ Slightly more complex deployment
- ⚠️ Folder structure must be maintained

## Scaling Strategy

As the system grows:

```
Phase 1: Single Server
databases/admin_1/
databases/admin_2/
databases/admin_3/
...

Phase 2: Load Balancing
server1/databases/admin_1-10/
server2/databases/admin_11-20/
server3/databases/admin_21-30/

Phase 3: Cloud Storage
cloud-storage/admin_1/
cloud-storage/admin_2/
(S3, Azure Blob, etc.)
```

## Monitoring & Maintenance

### Key Metrics
- Database file sizes per admin
- Query performance by admin
- Storage usage trends
- Backup completion rates

### Administrative Tasks
- Periodic backups of all admin databases
- Schema migrations across all databases
- Disk space monitoring
- Performance optimization

## Summary

The multi-database architecture provides:
- **Data Isolation**: Each admin completely isolated
- **Security**: No cross-admin data leakage
- **Scalability**: Easy to add new admins
- **Reliability**: Independent backup/restore
- **Performance**: Optimized query performance
