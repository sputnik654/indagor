-- Схема аналитики INDAGOR (D1). События анонимные, ПДн не хранятся.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,            -- unix ms
  day     TEXT    NOT NULL,            -- московский день YYYY-MM-DD
  ty      TEXT    NOT NULL,            -- pv | cg | dr
  c       INTEGER NOT NULL DEFAULT 0,  -- согласие: 1/0
  p       TEXT    NOT NULL DEFAULT '/',
  d       TEXT    NOT NULL DEFAULT 'unknown',
  l       TEXT    NOT NULL DEFAULT '',
  w       INTEGER NOT NULL DEFAULT 0,
  dur     INTEGER,                     -- секунды, только для dr
  r       TEXT    NOT NULL DEFAULT '', -- referrer host
  sid     TEXT    NOT NULL DEFAULT '', -- только при согласии
  u_src   TEXT    NOT NULL DEFAULT '',
  u_med   TEXT    NOT NULL DEFAULT '',
  u_cmp   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_events_day     ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_day_ty  ON events(day, ty);
CREATE INDEX IF NOT EXISTS idx_events_sid     ON events(sid);
