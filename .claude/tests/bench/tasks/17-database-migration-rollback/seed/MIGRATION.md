# Account status migration

The rollback currently converts every account to enabled. Make the migration
round-trip preserve active and disabled rows, remain idempotent, and add a test
that fails when the original rollback is restored.
