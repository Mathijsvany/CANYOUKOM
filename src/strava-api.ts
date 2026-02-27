// Strava API config constants
export const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID;
export const STRAVA_CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET;
export const STRAVA_REDIRECT_URI = window.location.origin; // Dynamically uses localhost or the deployed domain

const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';

export interface StravaAuthParams {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}

/**
 * Constructs the URL to redirect the user to Strava's login page
 */
export function getStravaLoginUrl(): string {
    if (!STRAVA_CLIENT_ID) {
        console.error("Missing VITE_STRAVA_CLIENT_ID in .env file");
        return '#';
    }

    const params = new URLSearchParams({
        client_id: STRAVA_CLIENT_ID,
        response_type: 'code',
        redirect_uri: STRAVA_REDIRECT_URI,
        approval_prompt: 'force',
        scope: 'read,activity:read' // required to read profile and activities
    });

    return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges the temporary authorization code (from URL) for an access token
 */
export async function exchangeCodeForToken(code: string): Promise<StravaAuthParams | null> {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
        console.error("Missing Strava Client ID or Secret in environment variables.");
        return null;
    }

    try {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
            }),
        });

        if (!response.ok) {
            throw new Error(`Strava auth failed: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at,
        };
    } catch (error) {
        console.error("Error exchanging code for token", error);
        return null;
    }
}

/**
 * Refreshes an expired Strava access token
 */
export async function refreshStravaToken(refreshToken: string): Promise<StravaAuthParams | null> {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
        return null;
    }

    try {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
        });

        if (!response.ok) {
            throw new Error(`Strava auth refresh failed: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at,
        };
    } catch (error) {
        console.error("Error refreshing token", error);
        return null;
    }
}

export interface StravaSegmentExplore {
    id: number;
    name: string;
    distance: number;
    avg_grade: number;
    start_latlng: [number, number];
    end_latlng: [number, number];
    elev_difference: number;
}

/**
 * Searches for segments in a targeted bounding box.
 * Bounds format: "sw_lat,sw_lng,ne_lat,ne_lng"
 */
export async function exploreSegments(accessToken: string, bounds: string): Promise<StravaSegmentExplore[]> {
    const url = `https://www.strava.com/api/v3/segments/explore?bounds=${bounds}&activity_type=riding`;

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) throw new Error("Failed to fetch segments");

        const data = await response.json();
        let segments = data.segments as StravaSegmentExplore[];

        // Filter segments to focus on actual climbs (e.g. at least 4% average gradient)
        segments = segments.filter(s => s.avg_grade >= 4.0);

        return segments;
    } catch (err) {
        console.error(err);
        return [];
    }
}

export interface StravaSegmentDetail {
    id: number;
    name: string;
    distance: number;
    average_grade: number;
    maximum_grade: number;
    elevation_high: number;
    elevation_low: number;
    total_elevation_gain: number;
    xoms: {
        kom: string; // Formatting like "20:30"
        qom: string;
    };
}

/**
 * Gets detailed data for a specific segment, including the current KOM time.
 */
export async function getSegmentDetails(accessToken: string, segmentId: number): Promise<StravaSegmentDetail | null> {
    const url = `https://www.strava.com/api/v3/segments/${segmentId}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) throw new Error("Failed to fetch segment details");

        const data = await response.json();
        return data as StravaSegmentDetail;
    } catch (err) {
        console.error(err);
        return null;
    }
}

/**
 * Parses the Strava "MM:SS" or "HH:MM:SS" KOM string into total seconds.
 */
export function parseKomTimeToSeconds(komString: string): number {
    if (!komString) return 1; // Fallback to avoid Infinity watts

    // Handle formats like "45s" or "x s"
    if (komString.toLowerCase().includes('s') && !komString.includes(':')) {
        const match = komString.match(/(\d+)\s*s/i);
        if (match) return parseInt(match[1], 10);
    }

    // Handle standard "MM:SS" or "H:MM:SS"
    const cleanString = komString.replace(/[^\d:]/g, ''); // Remove any weird characters
    const parts = cleanString.split(':').map(Number);

    if (parts.length === 2) {
        if (Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return 1;
        return parts[0] * 60 + parts[1]; // MM:SS
    } else if (parts.length === 3) {
        if (Number.isNaN(parts[0]) || Number.isNaN(parts[1]) || Number.isNaN(parts[2])) return 1;
        return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
    }

    // Fallback: Just try parsing it as a pure number of seconds
    const fallback = parseInt(komString, 10);
    return Number.isNaN(fallback) || fallback <= 0 ? 1 : fallback;
}
