-- Keyset reference selection must not sort an entire request/quote history.
CREATE INDEX requests_created_keyset_idx ON requests(created_at DESC,id DESC);
CREATE INDEX requests_kind_created_keyset_idx ON requests(kind,created_at DESC,id DESC);
CREATE INDEX quote_snapshots_request_created_keyset_idx ON quote_snapshots(request_id,created_at DESC,id DESC);
