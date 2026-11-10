-- Stable keyset traversal for account management, including older staff when
-- many newer customer registrations exist. No user or credential rows change.
CREATE INDEX IF NOT EXISTS users_directory_created_idx
  ON users (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS users_directory_staff_created_idx
  ON users (created_at DESC, id DESC) WHERE role <> 'customer';
