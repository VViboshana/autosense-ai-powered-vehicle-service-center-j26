/*
    Bay occupancy: the number plate the occupancy service read on the vehicle parked in a bay (plates.py), so the
    vehicle can be linked to its job by plate instead of by guess. Only text is stored, never a picture.
    - plate_text: as shown ("WP KP-0683"); plate_core: what is matched ("KP0683": letters and digits, no province code)
    - plate_votes / plate_reads: how many readings agreed / were made (a plate counts only when readings agree)
    - plate_stable / plate_done: the readings agree / the service stopped reading this vehicle
    occupancy.bay_status holds the current vehicle's plate (cleared when the bay turns free);
    occupancy.bay_state_events keeps it on the "occupied" event it belongs to, as evidence for the evaluation.
*/
ALTER TABLE occupancy.bay_status
    ADD COLUMN plate_text  varchar(20),
    ADD COLUMN plate_core  varchar(12),
    ADD COLUMN plate_votes smallint,
    ADD COLUMN plate_reads smallint,
    ADD COLUMN plate_stable boolean NOT NULL DEFAULT false,   -- the readings agree: the plate counts
    ADD COLUMN plate_done  boolean NOT NULL DEFAULT false;    -- the service stopped reading (agreed, or gave up)

ALTER TABLE occupancy.bay_state_events
    ADD COLUMN plate_text  varchar(20),
    ADD COLUMN plate_votes smallint,
    ADD COLUMN plate_reads smallint;
