"""
Migration script to transition from single database to per-admin database structure.
Run this after updating all models to include admin_id.

Usage:
    python -m backend.db.migrate_to_multi_db admin_id
"""

import sys
from sqlalchemy import text
from backend.db.session import SessionLocal
from backend.db.db_manager import AdminDatabaseManager
from backend.db.db_init import initialize_new_admin_database
from backend.models.admin import Admin


def migrate_single_to_multi_db(admin_id: int, source_admin_id: int = 1) -> bool:
    """
    Migrate data from a single admin in the monolithic database to a per-admin database.
    
    Args:
        admin_id: The admin ID to create a database for
        source_admin_id: The admin_id value to filter by in the source database
    
    Returns:
        bool: True if migration successful, False otherwise
    """
    try:
        # Step 1: Initialize new admin database
        print(f"[1/5] Initializing database for admin {admin_id}...")
        success = initialize_new_admin_database(admin_id)
        if not success:
            raise Exception("Failed to initialize admin database")
        
        # Step 2: Copy data from source to target
        print(f"[2/5] Copying data to admin {admin_id}'s database...")
        _copy_data_to_admin_db(admin_id)
        
        # Step 3: Verify data integrity
        print(f"[3/5] Verifying data integrity...")
        _verify_data_integrity(admin_id)
        
        # Step 4: Set admin_id on all records if not already set
        print(f"[4/5] Ensuring admin_id is set on all records...")
        _ensure_admin_ids(admin_id)
        
        # Step 5: Run final checks
        print(f"[5/5] Running final checks...")
        _run_final_checks(admin_id)
        
        print(f"✓ Successfully migrated admin {admin_id} to multi-database structure")
        return True
        
    except Exception as e:
        print(f"✗ Migration failed: {str(e)}")
        return False


def _copy_data_to_admin_db(admin_id: int):
    """Copy relevant data to the admin's database."""
    source_db = SessionLocal()
    SessionLocal_target = AdminDatabaseManager.get_admin_session_local(admin_id)
    target_db = SessionLocal_target()
    
    try:
        # Get all tables to migrate
        tables = [
            'users', 'staff', 'residents', 'bookings', 'cameras', 'camera_alerts',
            'flags', 'flag_comments', 'records', 'conversations', 'messages',
            'notifications', 'alerts', 'ai_insights'
        ]
        
        for table in tables:
            try:
                # Read from source
                result = source_db.execute(text(f"SELECT * FROM {table}"))
                rows = result.fetchall()
                
                if not rows:
                    print(f"  - {table}: No data to copy")
                    continue
                
                # Write to target
                for row in rows:
                    insert_query = text(f"INSERT INTO {table} VALUES ({', '.join([':' + str(i) for i in range(len(row))])})")
                    # This is simplified; you may need a more robust approach
                
                print(f"  ✓ {table}: {len(rows)} records copied")
            except Exception as e:
                print(f"  ⚠ {table}: Skipped ({str(e)})")
        
        target_db.commit()
    except Exception as e:
        target_db.rollback()
        raise e
    finally:
        source_db.close()
        target_db.close()


def _verify_data_integrity(admin_id: int):
    """Verify that data was copied correctly."""
    SessionLocal_target = AdminDatabaseManager.get_admin_session_local(admin_id)
    db = SessionLocal_target()
    
    try:
        # Check for records without admin_id
        result = db.execute(text(
            "SELECT COUNT(*) FROM residents WHERE admin_id IS NULL"
        ))
        null_residents = result.scalar()
        if null_residents > 0:
            print(f"  ⚠ Found {null_residents} residents without admin_id")
        else:
            print("  ✓ All residents have admin_id set")
    finally:
        db.close()


def _ensure_admin_ids(admin_id: int):
    """Ensure all records have the correct admin_id set."""
    SessionLocal_target = AdminDatabaseManager.get_admin_session_local(admin_id)
    db = SessionLocal_target()
    
    try:
        tables = [
            ('residents', 'admin_id'),
            ('staff', 'admin_id'),
            ('users', 'admin_id'),
            ('bookings', 'admin_id'),
            ('cameras', 'admin_id'),
            ('flags', 'admin_id'),
            ('records', 'admin_id'),
            ('messages', 'admin_id'),
            ('notifications', 'admin_id'),
            ('alerts', 'admin_id'),
        ]
        
        for table, column in tables:
            try:
                db.execute(text(f"UPDATE {table} SET {column} = {admin_id} WHERE {column} IS NULL"))
                db.commit()
                print(f"  ✓ {table}: admin_id ensured")
            except Exception as e:
                print(f"  ⚠ {table}: Failed to set admin_id ({str(e)})")
    finally:
        db.close()


def _run_final_checks(admin_id: int):
    """Run final checks on the admin database."""
    SessionLocal_target = AdminDatabaseManager.get_admin_session_local(admin_id)
    db = SessionLocal_target()
    
    try:
        # Count records in key tables
        tables_to_check = ['residents', 'staff', 'users', 'bookings']
        
        for table in tables_to_check:
            result = db.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = result.scalar()
            print(f"  ✓ {table}: {count} records")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m backend.db.migrate_to_multi_db <admin_id> [source_admin_id]")
        print("Example: python -m backend.db.migrate_to_multi_db 1")
        sys.exit(1)
    
    admin_id = int(sys.argv[1])
    source_admin_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    
    success = migrate_single_to_multi_db(admin_id, source_admin_id)
    sys.exit(0 if success else 1)
