"""
Sky-geometry math for stereo-moon calibration.

Port of the relevant pieces of viewer/src/astronomy.ts to Python. Uses the
`astronomy` package (astronomy-engine's Python port) for ephemerides and
sidereal time; everything else is pure numpy vector math.

Run `uv run python astro.py` to execute the self-test, which asserts that
the ported `stereo_correction` matches viewer-exported keyframes to ±0.01°.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import astronomy as ae
import numpy as np

AU_TO_KM = 149_597_870.7
EARTH_RADIUS_KM = 6371.0
DEG = np.pi / 180.0
E_NORTH = np.array([0.0, 0.0, 1.0])


@dataclass(frozen=True)
class Site:
    name: str
    lat: float  # degrees
    lon: float  # degrees


BOSTON = Site("boston", lat=42.36, lon=-71.06)
SANTIAGO = Site("santiago", lat=-33.45, lon=-70.66)

# Matches SIM_START / SIM_END in viewer/src/astronomy.ts.
SIM_START = datetime(2026, 3, 2, 22, 41, 0, tzinfo=timezone.utc)
SIM_END = datetime(2026, 3, 3, 15, 0, 0, tzinfo=timezone.utc)


def _to_ae_time(when: datetime) -> ae.Time:
    """astronomy.Time accepts ISO-8601 strings with millisecond precision."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    iso = when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
          f"{when.microsecond // 1000:03d}Z"
    return ae.Time(iso)


def observer_j2000(site: Site, when: datetime) -> np.ndarray:
    """Observer position in J2000 equatorial coordinates (AU).

    Spherical Earth + GAST rotation of ECEF. Matches `observerJ2000` in
    viewer/src/astronomy.ts exactly.
    """
    t = _to_ae_time(when)
    lat_rad = site.lat * DEG
    lon_rad = site.lon * DEG
    r = EARTH_RADIUS_KM / AU_TO_KM
    cos_lat = np.cos(lat_rad)
    sin_lat = np.sin(lat_rad)
    ecef_x = r * cos_lat * np.cos(lon_rad)
    ecef_y = r * cos_lat * np.sin(lon_rad)
    ecef_z = r * sin_lat

    gast_rad = ae.SiderealTime(t) * 15.0 * DEG
    cg = np.cos(gast_rad)
    sg = np.sin(gast_rad)
    return np.array([
        ecef_x * cg - ecef_y * sg,
        ecef_x * sg + ecef_y * cg,
        ecef_z,
    ])


def moon_j2000(when: datetime) -> np.ndarray:
    """Moon geocentric position in J2000 equatorial coordinates (AU)."""
    t = _to_ae_time(when)
    v = ae.GeoVector(ae.Body.Moon, t, aberration=True)
    return np.array([v.x, v.y, v.z])


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def _raw_basis(observer_pos: np.ndarray, moon_pos: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(gaze, up_raw, right_raw) image-plane basis for a horizon-leveled
    tracking telescope.

    `up_raw` is the observer's zenith projected perpendicular to the gaze.
    `right_raw = cross(gaze, up_raw)`. Matches the raw-camera construction in
    both `gazeCorrection` and `stereoCorrection` in the TS code.
    """
    gaze = _unit(moon_pos - observer_pos)
    zenith = _unit(observer_pos)
    up = _unit(zenith - gaze * float(np.dot(zenith, gaze)))
    right = np.cross(gaze, up)
    return gaze, up, right


def stereo_correction(observer_pos: np.ndarray,
                      moon_pos: np.ndarray,
                      shared_baseline: np.ndarray) -> float:
    """Degrees. Angle of the shared stereo baseline in the raw image plane,
    measured from the image's +right direction toward +up (CCW positive).

    The video rotator applies `-stereo_correction` to bring the baseline
    horizontal. Same convention as `boston_rotation_deg` / `santiago_rotation_deg`
    in stereo-moon-keyframes.json.
    """
    gaze, up, right = _raw_basis(observer_pos, moon_pos)
    b_proj = shared_baseline - gaze * float(np.dot(shared_baseline, gaze))
    return float(np.degrees(np.arctan2(np.dot(b_proj, up), np.dot(b_proj, right))))


def field_angle_in_raw(observer_pos: np.ndarray,
                       moon_pos: np.ndarray,
                       fiducial_j2000: np.ndarray = E_NORTH) -> float:
    """Degrees. Angle of `fiducial_j2000` projected onto the raw image plane.

    CCW-positive measured from the camera's +right toward +up. Used by the
    cumulative field-rotation helpers to trace out a scalar curve whose time
    derivative matches the corresponding real-video ECC rotation rate.

    With the default fiducial (J2000 north), the curve tracks the alt-az
    camera basis only. To match the ECC rotation of real moon pixels you
    want a fiducial that rotates WITH the moon's body — see
    `moon_body_x_j2000` and `cumulative_moon_image_rotation`.
    """
    gaze, up, right = _raw_basis(observer_pos, moon_pos)
    f_proj = fiducial_j2000 - gaze * float(np.dot(fiducial_j2000, gaze))
    return float(np.degrees(np.arctan2(np.dot(f_proj, up), np.dot(f_proj, right))))


def moon_body_x_j2000(when: datetime) -> np.ndarray:
    """Unit vector along the moon's prime meridian (body X-axis) in J2000.

    The moon rotates synchronously at ~13.18°/day; over an 8 h capture that
    is ~4.4° of additional image rotation on top of the camera-basis change.
    The real ECC-measured rotation curve captures this because it's tracking
    the moon's pixels; the analytical curve must use a body-fixed fiducial
    to capture it too.

    Uses astronomy-engine's `RotationAxis(Body.Moon, t)` for the pole
    direction (IAU north) and the spin angle W. Builds a rotation matrix
    about the pole, applied to the ascending node of the moon's equator on
    the J2000 equator. Verified against a finite-difference comparison
    against `axis.spin` (agreement to 5 mdeg over 8 h).
    """
    t = _to_ae_time(when)
    ax = ae.RotationAxis(ae.Body.Moon, t)
    pole = np.array([ax.north.x, ax.north.y, ax.north.z])
    pole = pole / np.linalg.norm(pole)
    node = np.cross(E_NORTH, pole)
    node = node / np.linalg.norm(node)
    spin_rad = np.radians(ax.spin)
    c, s = np.cos(spin_rad), np.sin(spin_rad)
    return node * c + np.cross(pole, node) * s + pole * np.dot(pole, node) * (1 - c)


def cumulative_field_rotation(times: Iterable[datetime], site: Site) -> np.ndarray:
    """Cumulative raw-view field rotation (camera basis only) vs. the first
    sample. Uses J2000 north as the fiducial — does NOT track the moon's
    body rotation. Kept for diagnostics and comparison.
    """
    times = list(times)
    angles = np.empty(len(times))
    for i, when in enumerate(times):
        obs = observer_j2000(site, when)
        moon = moon_j2000(when)
        angles[i] = field_angle_in_raw(obs, moon, E_NORTH)
    unwrapped = np.degrees(np.unwrap(np.radians(angles)))
    return unwrapped - unwrapped[0]


def cumulative_moon_image_rotation(times: Iterable[datetime], site: Site) -> np.ndarray:
    """Cumulative rotation of the moon's image in the raw view, in degrees.

    This is the curve calibrate.py shape-matches against the real video's
    ECC rotation curve. Uses the moon's body X-axis (prime meridian direction,
    transformed to J2000 via `RotationAxis`) as the fiducial — which rotates
    together with the moon's visible features, so it reproduces what ECC
    sees on the real pixels.
    """
    times = list(times)
    angles = np.empty(len(times))
    for i, when in enumerate(times):
        obs = observer_j2000(site, when)
        moon = moon_j2000(when)
        fid = moon_body_x_j2000(when)
        angles[i] = field_angle_in_raw(obs, moon, fid)
    unwrapped = np.degrees(np.unwrap(np.radians(angles)))
    return unwrapped - unwrapped[0]


def shared_baseline(when: datetime, left: Site, right: Site) -> np.ndarray:
    """left→right baseline vector in J2000 (AU).

    Both cameras in the stereo pair MUST use the same baseline direction.
    Passing (Boston, Santiago) to both renderings is what keeps parallax
    purely horizontal in the rotated outputs.
    """
    return observer_j2000(right, when) - observer_j2000(left, when)


# ---- Self-test -----------------------------------------------------------

def _self_test():
    """Port-parity test against the checked-in stereo-moon-keyframes.json.

    The first row of that file is the Boston video start time:
        utc: 2026-03-02 22:41:00 UTC
        boston_rotation_deg:   -37.339
        santiago_rotation_deg:  37.833

    We compute the same quantities here and assert agreement to 0.01°.
    """
    when = datetime(2026, 3, 2, 22, 41, 0, tzinfo=timezone.utc)
    boston_pos = observer_j2000(BOSTON, when)
    santiago_pos = observer_j2000(SANTIAGO, when)
    moon_pos = moon_j2000(when)
    baseline = santiago_pos - boston_pos  # Boston → Santiago

    boston_angle = stereo_correction(boston_pos, moon_pos, baseline)
    santiago_angle = stereo_correction(santiago_pos, moon_pos, baseline)

    expected = {"boston": -37.339, "santiago": 37.833}
    tol = 0.01
    print(f"Boston stereo_correction  : {boston_angle:+.4f}°  "
          f"(expected {expected['boston']:+.3f}°)")
    print(f"Santiago stereo_correction: {santiago_angle:+.4f}°  "
          f"(expected {expected['santiago']:+.3f}°)")

    assert abs(boston_angle - expected["boston"]) < tol, \
        f"Boston diverges from TS by {boston_angle - expected['boston']:+.4f}°"
    assert abs(santiago_angle - expected["santiago"]) < tol, \
        f"Santiago diverges from TS by {santiago_angle - expected['santiago']:+.4f}°"

    # Field-rotation sanity: non-trivial over 2h. The curve isn't
    # monotonic near moonrise — field rotation rate passes through zero as
    # azimuth crosses the local east meridian — but it must be non-zero.
    from datetime import timedelta
    times = [when + timedelta(minutes=m) for m in range(0, 121, 5)]
    curve = cumulative_field_rotation(times, BOSTON)
    print(f"Boston 2h field rotation  : {curve[-1]:+.2f}° "
          f"(over {len(times)} samples)")
    assert abs(curve[-1]) > 0.5, "field rotation should be non-trivial over 2h"

    print("\n✓ All self-tests pass.")


if __name__ == "__main__":
    _self_test()
