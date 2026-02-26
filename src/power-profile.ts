/**
 * User Power Profile & Curve Interpolation
 * 
 * Provides methods to estimate a user's maximum power output for a specific duration
 * based on three anchor points (e.g., 1m, 5m, 20m maximums).
 */

export interface PowerProfile {
    power1m: number; // 60 seconds
    power5m: number; // 300 seconds
    power20m: number; // 1200 seconds
}

/**
 * Very basic logarithmic interpolation/extrapolation.
 * Power curves generally follow a shape somewhat similar to P(t) = A + B * ln(t) 
 * or Critical Power models. For a Proof of Concept, log interpolation between known points is often sufficient.
 */
export function estimateMaxPowerForDuration(seconds: number, profile: PowerProfile): number {
    if (seconds <= 0) return profile.power1m;

    // Define the anchor points
    const points = [
        { t: 60, p: profile.power1m },
        { t: 300, p: profile.power5m },
        { t: 1200, p: profile.power20m }
    ];

    // If shorter than our shortest known point, cap it (or we could extrapolate for sprint, but sprint is highly variable)
    if (seconds <= points[0].t) {
        // Simple linear interpolation from 1 sec (assuming 1.5x 1m power) down to 1m
        const sprintPower = profile.power1m * 1.5;
        const slope = (profile.power1m - sprintPower) / (points[0].t - 1);
        return sprintPower + slope * (seconds - 1);
    }

    // Find the two anchor points framing our target duration
    let p1 = points[0];
    let p2 = points[2];

    if (seconds <= points[1].t) {
        p1 = points[0]; // 1m
        p2 = points[1]; // 5m
    } else {
        p1 = points[1]; // 5m
        p2 = points[2]; // 20m
    }

    // Logarithmic interpolation: P(t) = m * ln(t) + b
    // ln(t1)*m + b = P1
    // ln(t2)*m + b = P2
    // m = (P2 - P1) / (ln(t2) - ln(t1))

    const ln1 = Math.log(p1.t);
    const ln2 = Math.log(p2.t);

    const m = (p2.p - p1.p) / (ln2 - ln1);
    const b = p1.p - (m * ln1);

    const estimatedPower = m * Math.log(seconds) + b;

    return Math.max(0, estimatedPower); // Never return negative watts
}
