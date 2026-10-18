"""
Splits the model's output into findings and "possible damage".

The model runs once at a low threshold. Regions at or above the normal threshold are findings, as before. Weaker
regions become possible damage for the technician to accept or dismiss: the test set showed the model misses subtle
damage (dents, scratches, cracks), and those misses often sit just below the threshold. They never count towards the
severity unless a technician accepts them.
"""
from .severity import vehicle_overlap

DUPLICATE_OVERLAP = 0.5  # a weaker region lying mostly on a finding is the same damage seen again, not a new one


def split_findings(regions: list[dict], confidence: float, max_possible: int) -> list[dict]:
    """Marks each kept region with possible: true/false. Findings first, then the strongest possible ones."""
    findings = [dict(r, possible=False) for r in regions if r['confidence'] >= confidence]
    weaker = sorted((r for r in regions if r['confidence'] < confidence), key=lambda r: r['confidence'], reverse=True)
    possible = []
    for r in weaker:
        if len(possible) >= max_possible:
            break
        if any(vehicle_overlap(r['polygon'], r['bbox'], f['polygon']) >= DUPLICATE_OVERLAP for f in findings + possible):
            continue
        possible.append(dict(r, possible=True))
    return findings + possible
