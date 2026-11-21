CREATE TABLE mantenimientos (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipo_id integer NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    horometro numeric(12, 2) NOT NULL CHECK (horometro >= 0 AND horometro <> 'NaN'::numeric),
    fecha timestamptz NOT NULL DEFAULT now(),
    UNIQUE (equipo_id, horometro)
);
