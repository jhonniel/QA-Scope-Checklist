-- Each phase can keep a tray colour. Preset names (indigo, teal, amber,
-- violet, rose) or a custom #rrggbb. Existing rows stay indigo so the first
-- phase looks the same as before this column existed.

ALTER TABLE project_phases ADD COLUMN color VARCHAR(20) NOT NULL DEFAULT 'indigo';
