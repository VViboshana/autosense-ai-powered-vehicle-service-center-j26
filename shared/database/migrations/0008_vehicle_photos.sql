/*
    Vehicle photos: a customer adds a photo of their car when they ask to add it (vehicle_claims.photo_key); approving
    the request makes it the vehicle's photo (vehicles.photo_key), which the customer can change later.
    Keys are paths inside the upload store (like damage.inspection_images.storage_key), never full disk paths.
    Requests made before this migration have no photo, so the columns allow null; the API requires one for new requests.
*/
ALTER TABLE workshop.vehicle_claims ADD COLUMN photo_key varchar(300);
ALTER TABLE workshop.vehicles ADD COLUMN photo_key varchar(300);
