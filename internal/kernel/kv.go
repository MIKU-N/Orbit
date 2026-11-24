package kernel

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type dbKVStore struct {
	db       *sql.DB
	pluginID string
}

func (s *dbKVStore) Get(ctx context.Context, userID int64, key string) (json.RawMessage, bool, error) {
	var raw string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT v_json FROM plugin_kv WHERE plugin_id = ? AND user_id = ? AND k = ?`,
		s.pluginID, userID, key,
	).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return json.RawMessage(raw), true, nil
}

func (s *dbKVStore) Set(ctx context.Context, userID int64, key string, val json.RawMessage) error {
	var parsed any
	if err := json.Unmarshal(val, &parsed); err != nil {
		return err
	}
	normalized, _ := json.Marshal(parsed)
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO plugin_kv (plugin_id, user_id, k, v_json, updated_at) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(plugin_id, user_id, k) DO UPDATE SET v_json = excluded.v_json, updated_at = excluded.updated_at`,
		s.pluginID, userID, key, string(normalized), time.Now().UTC(),
	)
	return err
}

func (s *dbKVStore) Delete(ctx context.Context, userID int64, key string) error {
	_, err := s.db.ExecContext(
		ctx,
		`DELETE FROM plugin_kv WHERE plugin_id = ? AND user_id = ? AND k = ?`,
		s.pluginID, userID, key,
	)
	return err
}

func (s *dbKVStore) List(ctx context.Context, userID int64) (map[string]json.RawMessage, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT k, v_json FROM plugin_kv WHERE plugin_id = ? AND user_id = ? ORDER BY k ASC`,
		s.pluginID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			out[k] = json.RawMessage(v)
		}
	}
	return out, nil
}
