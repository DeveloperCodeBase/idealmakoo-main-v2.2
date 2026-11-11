ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method text NOT NULL DEFAULT 'totp' CHECK (mfa_method IN ('totp','email','sms'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_method text CHECK (mfa_pending_method IS NULL OR mfa_pending_method IN ('totp','email','sms'));
CREATE TABLE IF NOT EXISTS mfa_channel_challenges (
  challenge_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('email','sms')),
  purpose text NOT NULL CHECK (purpose IN ('enroll','login')),
  destination_encrypted text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_channel_challenges_user_idx ON mfa_channel_challenges(user_id,purpose,expires_at);
