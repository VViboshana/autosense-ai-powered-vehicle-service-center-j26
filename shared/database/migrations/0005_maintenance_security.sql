/*
    Schemas reserved for the predictive maintenance and security components. Their owners add tables here in their
    own numbered migrations (see docs/DEVELOPING.md). Nothing reads them yet.
*/
CREATE SCHEMA IF NOT EXISTS maintenance;
COMMENT ON SCHEMA maintenance IS 'Predictive maintenance and job-length forecasts (owner: Munasinghe)';

CREATE SCHEMA IF NOT EXISTS security;
COMMENT ON SCHEMA security IS 'Security and safety alerts (owner: Viboshana T G V)';
