/**
 * CANYOUKOM - Physics Model (Based on Lantern Rouge / ProCyclingStats "Etalon" model)
 * 
 * This module calculates the power required to overcome gravity, rolling resistance,
 * and aerodynamic drag to maintain a certain speed on a climb.
 */

// --- Constants ---
const GRAVITY = 9.81; // m/s^2
const AIR_DENSITY = 1.225; // kg/m^3 (approx at sea level and 15C)
const DEFAULT_CRR = 0.004; // Coefficient of rolling resistance (good tarmac + race tires)
const DEFAULT_CDA = 0.35; // Aerodynamic drag coefficient (rider on hoods/drops)
const DRIVETRAIN_LOSS = 0.03; // Usually ~3% energy lost in the drivetrain

/**
 * Core function to calculate required Watts for a specific time and segment
 */
export function calculateRequiredPower(
    distanceMeters: number,
    elevationMeters: number,
    timeSeconds: number,
    riderWeightKg: number,
    bikeWeightKg: number = 8.0,
    cda: number = DEFAULT_CDA,
    crr: number = DEFAULT_CRR,
): number {
    const totalMass = riderWeightKg + bikeWeightKg;
    const velocity = distanceMeters / timeSeconds; // Speed in m/s
    const gradient = elevationMeters / distanceMeters; // Approximate gradient (m/m)

    // 1. Gravity Power (P_gravity) = m * g * v * sin(atan(gradient))
    // For normal cycling gradients, sin(atan(gradient)) is roughly equal to the gradient itself.
    const pGravity = totalMass * GRAVITY * velocity * gradient;

    // 2. Rolling Resistance Power (P_rolling) = m * g * v * Crr * cos(atan(gradient))
    // For normal gradients, cos(...) is extremely close to 1.
    const pRolling = totalMass * GRAVITY * Math.cos(Math.atan(gradient)) * crr * velocity;

    // 3. Aerodynamic Power (P_aero) = 0.5 * rho * CdA * v^3 (without drafting)
    const pAero = 0.5 * AIR_DENSITY * cda * Math.pow(velocity, 3);

    // Total absolute watts required at the wheel
    const wheelPower = pGravity + pRolling + pAero;

    // Total watts required at the pedals (compensating for drivetrain loss)
    const pedalPower = wheelPower / (1 - DRIVETRAIN_LOSS);

    return pedalPower;
}

/**
 * Calculates the "Etalon" W/kg according to the article standard.
 * Etalon uses a standardised 60kg rider to make climbing performances comparable,
 * ignoring the actual weight of the rider who set the KOM.
 */
export function calculateEtalonWkg(
    distanceMeters: number,
    elevationMeters: number,
    komTimeSeconds: number
): { etalonWatts: number; etalonWkg: number } {
    const ETALON_RIDER_WEIGHT = 60.0; // Standardized to 60kg
    const ETALON_BIKE_WEIGHT = 7.0; // Typically around 7kg for pros when calculating Etalon

    const etalonWatts = calculateRequiredPower(
        distanceMeters,
        elevationMeters,
        komTimeSeconds,
        ETALON_RIDER_WEIGHT,
        ETALON_BIKE_WEIGHT,
        0.32, // Pros typically have slightly lower CdA
        0.003 // Pros typically use faster tires/tubulars
    );

    return {
        etalonWatts: etalonWatts,
        etalonWkg: etalonWatts / ETALON_RIDER_WEIGHT
    };
}

/**
 * Predicts the required Watts for the current user to beat or match the KOM time.
 */
export function calculateTargetWattsForUser(
    distanceMeters: number,
    elevationMeters: number,
    komTimeSeconds: number,
    userWeightKg: number,
    userBikeWeightKg: number
): { requiredWatts: number, requiredWkg: number } {
    const requiredWatts = calculateRequiredPower(
        distanceMeters,
        elevationMeters,
        komTimeSeconds,
        userWeightKg,
        userBikeWeightKg
    );

    return {
        requiredWatts,
        requiredWkg: requiredWatts / userWeightKg
    };
}

// Example calculation based on the article's Jay Vine example (Col de Beixalis)
// Distance: approx 6.6km according to public data, but the gradient is steep and speed is high.
// This is just a structural test to ensure the math functions hold together.
// Let's assume a generalized steep climb: 5km, 9% gradient (450m elevation), time 15min (900s)
const exampleTest = calculateEtalonWkg(5000, 450, 900);
// console.log("Etalon W/kg:", exampleTest.etalonWkg); // ~ 6.2 W/kg
