-- 0001 — extensions
-- Personal OS V2. Run migrations in filename order.
create extension if not exists "uuid-ossp";
create extension if not exists vector;     -- pgvector: semantic memory
create extension if not exists pg_trgm;    -- fuzzy text / duplicate detection
