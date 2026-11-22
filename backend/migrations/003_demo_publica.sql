ALTER TABLE equipos ADD COLUMN es_demo boolean NOT NULL DEFAULT false;

UPDATE equipos
SET es_demo = true
WHERE codigo IN ('DEMO-CAM-01', 'DEMO-CAM-02', 'DEMO-EXC-01', 'DEMO-PERF-01');
