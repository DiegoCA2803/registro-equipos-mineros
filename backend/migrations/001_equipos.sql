CREATE TABLE equipos (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo text NOT NULL UNIQUE CHECK (codigo = btrim(codigo) AND codigo <> ''),
    tipo text NOT NULL CHECK (tipo IN ('camion', 'excavadora', 'perforadora')),
    horometro numeric(12, 2) NOT NULL CHECK (horometro >= 0 AND horometro <> 'NaN'::numeric)
);
