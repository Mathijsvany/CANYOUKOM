import { useState, useEffect, useCallback } from 'react'
import { Activity, MapPin, Mountain, Search, Timer, Weight, Zap, ChevronRight, TrendingUp } from 'lucide-react'
import { calculateTargetWattsForUser, calculateEtalonWkg, SurfaceType } from './physics-model'
import { getStravaLoginUrl, exchangeCodeForToken, StravaAuthParams, exploreSegments, getSegmentDetails, StravaSegmentExplore, parseKomTimeToSeconds } from './strava-api'
import { PowerProfile, estimateMaxPowerForDuration } from './power-profile'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from 'react-leaflet'

// Component to track map movement and update our center state
function MapTracker({ setMapCenter }: { setMapCenter: (center: [number, number]) => void }) {
    const map = useMapEvents({
        moveend: () => {
            const center = map.getCenter();
            setMapCenter([center.lat, center.lng]);
        }
    });
    return null;
}

function App() {
    const [auth, setAuth] = useState<StravaAuthParams | null>(null);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [searchRadius, setSearchRadius] = useState<number>(5); // Default 5km
    const [nearbySegments, setNearbySegments] = useState<StravaSegmentExplore[]>([]);
    const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
    const [mapCenter, setMapCenter] = useState<[number, number]>([50.8503, 4.3517]); // Default Brussels

    const [distance, setDistance] = useState<number>(0); // meters
    const [elevation, setElevation] = useState<number>(0); // meters
    const [komTime, setKomTime] = useState<number>(0); // seconds
    const [hasKomData, setHasKomData] = useState<boolean>(true); // Tracks if Strava provided a KOM
    const [surfaceType, setSurfaceType] = useState<SurfaceType>('tarmac');

    const [userWeight, setUserWeight] = useState<number>(75); // kg
    const [userBikeWeight, setUserBikeWeight] = useState<number>(8); // kg

    const [powerProfile, setPowerProfile] = useState<PowerProfile>({
        power1m: 600, // Default puncheur watts
        power5m: 400, // Default VO2 watts
        power20m: 300 // Default FTP
    });

    useEffect(() => {
        // Load auth from local storage if available
        const savedAuth = localStorage.getItem('stravaAuth');
        if (savedAuth) {
            setAuth(JSON.parse(savedAuth));
        }

        // Check if returning from Strava OAuth
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        if (code && !auth) {
            setIsAuthenticating(true);
            exchangeCodeForToken(code).then((tokenData) => {
                if (tokenData) {
                    setAuth(tokenData);
                    localStorage.setItem('stravaAuth', JSON.stringify(tokenData));
                    // Clean URL
                    window.history.replaceState({}, document.title, "/");
                }
                setIsAuthenticating(false);
            });
        }
    }, []);

    useEffect(() => {
        // Try to get user's location on startup to set the map center
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                setMapCenter([position.coords.latitude, position.coords.longitude]);
            }, () => {
                console.log("Could not get initial geolocation.");
            });
        }
    }, []);

    const findClimbsNearby = useCallback(async () => {
        if (!auth) return;
        setIsSearching(true);
        setNearbySegments([]);

        const lat = mapCenter[0];
        const lng = mapCenter[1];

        // 1 degree of latitude is ~111km. 
        // 1 degree of longitude is ~111km * cos(latitude)
        const latOffset = searchRadius / 111.0;
        const lngOffset = searchRadius / (111.0 * Math.cos(lat * (Math.PI / 180)));

        const bounds = `${lat - latOffset},${lng - lngOffset},${lat + latOffset},${lng + lngOffset}`;

        const segments = await exploreSegments(auth.accessToken, bounds);
        setNearbySegments(segments);
        setIsSearching(false);
    }, [auth, searchRadius, mapCenter]);

    const selectSegment = async (segment: StravaSegmentExplore) => {
        setActiveSegmentId(segment.id);
        if (!auth) return;

        const details = await getSegmentDetails(auth.accessToken, segment.id);
        if (details) {
            console.log("Segment Data Loaded:", details.name, "KOM String:", details.xoms?.kom);
            setDistance(details.distance);
            setElevation(details.total_elevation_gain);

            // Auto-detect surface type from name
            const nameLower = details.name.toLowerCase();
            if (nameLower.includes('kassei') || nameLower.includes('cobble') || nameLower.includes('pave')) {
                setSurfaceType('cobbles');
            } else if (nameLower.includes('gravel') || nameLower.includes('dirt') || nameLower.includes('unpaved') || nameLower.includes('strade')) {
                setSurfaceType('gravel');
            } else {
                setSurfaceType('tarmac');
            }

            let komString = details.xoms?.kom;

            if (komString && komString !== "null") {
                const seconds = parseKomTimeToSeconds(komString);
                setKomTime(seconds);
                setHasKomData(true);
            } else {
                setKomTime(0);
                setHasKomData(false);
            }
        }
    };

    // Basic calculation
    const target = calculateTargetWattsForUser(distance, elevation, komTime, userWeight, userBikeWeight, surfaceType);
    const etalon = calculateEtalonWkg(distance, elevation, komTime, surfaceType);

    // Estimate user's capacity for this specific duration
    const estimatedUserCapacity = estimateMaxPowerForDuration(komTime, powerProfile);
    const capacityRatio = komTime > 0 ? (estimatedUserCapacity / target.requiredWatts) : 0;
    const isAttainable = capacityRatio >= 1.0;

    return (
        <div className="app-container">
            <div className="max-width-wrapper">

                {/* Header */}
                <header className="header" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <div className="icon-container-main">
                            <Zap className="icon-emerald" size={32} />
                        </div>
                        <h1 className="title">Can You KOM?</h1>
                        <p className="subtitle">
                            Discover exactly how many watts you need to push to take the crown. Based on the
                            ProCyclingStats Etalon physics model.
                        </p>
                    </div>
                    <div>
                        {!auth ? (
                            <a
                                href={getStravaLoginUrl()}
                                className="strava-connect-btn"
                            >
                                {isAuthenticating ? "Connecting..." : "Connect with Strava"}
                            </a>
                        ) : (
                            <div style={{ color: "var(--accent-light)", fontWeight: "600", padding: "0.5rem 1rem", backgroundColor: "var(--accent-glow)", borderRadius: "1rem" }}>
                                ✓ Connected to Strava
                            </div>
                        )}
                    </div>
                </header>

                <main className="main-grid">

                    {/* Inputs Section */}
                    <div className="card inputs-section glass-panel">

                        {!auth ? (
                            <section className="text-center py-12">
                                <Mountain className="w-16 h-16 text-emerald-500/20 mx-auto mb-4" />
                                <h2 className="text-xl font-medium text-white mb-2">Connect to find climbs</h2>
                                <p className="text-neutral-400 mb-6">We need access to your Strava to locate actual segment data near you.</p>
                                <a href={getStravaLoginUrl()} className="strava-connect-btn">Connect with Strava</a>
                            </section>
                        ) : (
                            <section>
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="section-title mb-0">
                                        <MapPin className="icon-emerald" size={20} />
                                        Nearby Climbs
                                    </h2>
                                    <button
                                        onClick={findClimbsNearby}
                                        disabled={isSearching}
                                        style={{ backgroundColor: "var(--accent-glow)", color: "var(--accent-light)", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.2)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}
                                    >
                                        <Search size={16} /> {isSearching ? "Searching..." : "Search Area"}
                                    </button>
                                </div>

                                <div className="input-field" style={{ marginBottom: "1.5rem" }}>
                                    <label className="flex-label">
                                        <span>Search Radius</span>
                                        <span className="sub-label">{searchRadius} km</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="1" max="25" step="1"
                                        value={searchRadius}
                                        onChange={e => setSearchRadius(Number(e.target.value))}
                                        style={{ width: "100%", accentColor: "var(--accent-color)" }}
                                    />
                                </div>

                                <MapContainer center={mapCenter} zoom={12} scrollWheelZoom={true} className="map-container">
                                    {/* Using a dark map tile layer from CartoDB */}
                                    <TileLayer
                                        attribution='&copy; <a href="https://carto.com/">Carto</a>'
                                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                    />
                                    <MapTracker setMapCenter={setMapCenter} />

                                    <Circle
                                        center={mapCenter}
                                        radius={searchRadius * 1000}
                                        pathOptions={{ color: 'var(--accent-color)', fillColor: 'var(--accent-glow)', fillOpacity: 0.1, weight: 1 }}
                                    />

                                    {nearbySegments.map(seg => (
                                        <Marker
                                            position={seg.start_latlng}
                                            key={seg.id}
                                            eventHandlers={{
                                                click: () => selectSegment(seg),
                                            }}
                                        >
                                            <Popup>
                                                <strong>{seg.name}</strong><br />
                                                {(seg.distance / 1000).toFixed(1)}km @ {seg.avg_grade}%
                                            </Popup>
                                        </Marker>
                                    ))}
                                </MapContainer>

                                {nearbySegments.length > 0 && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "300px", overflowY: "auto", paddingRight: "0.5rem" }}>
                                        {nearbySegments.map(seg => (
                                            <button
                                                key={seg.id}
                                                onClick={() => selectSegment(seg)}
                                                style={{
                                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                                    padding: "1rem", borderRadius: "12px", textAlign: "left",
                                                    backgroundColor: activeSegmentId === seg.id ? "rgba(16, 185, 129, 0.1)" : "rgba(0,0,0,0.3)",
                                                    border: activeSegmentId === seg.id ? "1px solid var(--accent-color)" : "1px solid var(--border-color)",
                                                    cursor: "pointer", transition: "all 0.2s"
                                                }}
                                            >
                                                <div>
                                                    <h4 style={{ color: "var(--text-main)", fontWeight: "500", marginBottom: "0.25rem" }}>{seg.name}</h4>
                                                    <div style={{ display: "flex", gap: "1rem", color: "var(--text-sub)", fontSize: "0.875rem" }}>
                                                        <span>{(seg.distance / 1000).toFixed(1)} km</span>
                                                        <span>{seg.avg_grade}%</span>
                                                        <span>{seg.elev_difference}m gain</span>
                                                    </div>
                                                </div>
                                                <ChevronRight size={20} color="var(--text-sub)" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        <hr className="divider" />

                        <section>
                            <h2 className="section-title">
                                <Weight className="icon-emerald" size={20} />
                                Rider & Bike
                            </h2>
                            <div className="input-field" style={{ marginBottom: "1.25rem" }}>
                                <label>Surface Type</label>
                                <select
                                    value={surfaceType}
                                    onChange={e => setSurfaceType(e.target.value as SurfaceType)}
                                    style={{
                                        width: "100%", backgroundColor: "#000", border: "1px solid var(--border-color)",
                                        borderRadius: "0.75rem", padding: "0.75rem 1rem", color: "var(--text-main)",
                                        fontFamily: "var(--font-sans)", fontSize: "1rem"
                                    }}
                                >
                                    <option value="tarmac">Smooth Tarmac (Asfalt)</option>
                                    <option value="cobbles">Cobblestones (Kasseien)</option>
                                    <option value="gravel">Gravel / Dirt (Onverhard)</option>
                                </select>
                            </div>
                            <div className="input-group mb-6">
                                <div className="input-field">
                                    <label>Your Weight (kg)</label>
                                    <input type="number" value={userWeight} onChange={e => setUserWeight(Number(e.target.value))} />
                                </div>
                                <div className="input-field">
                                    <label>Bike Weight (kg)</label>
                                    <input type="number" value={userBikeWeight} onChange={e => setUserBikeWeight(Number(e.target.value))} />
                                </div>
                            </div>

                            <h2 className="section-title" style={{ marginTop: "1rem" }}>
                                <TrendingUp className="icon-emerald" size={20} />
                                Power Profile (Max Watts)
                            </h2>
                            <div className="input-group" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                                <div className="input-field">
                                    <label>1 Min</label>
                                    <input type="number" value={powerProfile.power1m} onChange={e => setPowerProfile({ ...powerProfile, power1m: Number(e.target.value) })} />
                                </div>
                                <div className="input-field">
                                    <label>5 Min</label>
                                    <input type="number" value={powerProfile.power5m} onChange={e => setPowerProfile({ ...powerProfile, power5m: Number(e.target.value) })} />
                                </div>
                                <div className="input-field">
                                    <label>20 Min</label>
                                    <input type="number" value={powerProfile.power20m} onChange={e => setPowerProfile({ ...powerProfile, power20m: Number(e.target.value) })} />
                                </div>
                            </div>
                        </section>

                    </div>

                    {/* Results Section */}
                    <div className="results-section">

                        <div className="result-card primary-result neon-border glass-panel">
                            <div className="bg-icon-blur">
                                <Activity size={128} className="icon-emerald opacity-low" />
                            </div>

                            <h3 className="result-label">Your Target</h3>

                            {!hasKomData || komTime === 0 ? (
                                <div style={{ padding: "2rem 0", color: "var(--text-sub)", fontStyle: "italic" }}>
                                    KOM data not available for this segment via the Strava API.
                                </div>
                            ) : (
                                <>
                                    <div className="result-value-container">
                                        <span className="result-value">
                                            {Math.round(target.requiredWatts)}
                                        </span>
                                        <span className="result-unit">Watts</span>
                                    </div>
                                    <div className="result-subtext">
                                        {target.requiredWkg.toFixed(2)} W/kg for {(komTime / 60).toFixed(1)} minutes
                                    </div>

                                    {/* Verdict block */}
                                    <div style={{
                                        marginTop: "1.5rem",
                                        padding: "1rem",
                                        borderRadius: "12px",
                                        backgroundColor: isAttainable ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                                        border: `1px solid ${isAttainable ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                                        textAlign: "center"
                                    }}>
                                        <h4 style={{ color: isAttainable ? "#10B981" : "#EF4444", marginBottom: "0.25rem", fontSize: "1.1rem" }}>
                                            {isAttainable ? "KOM is Possible! 👑" : "Needs More Training 🥵"}
                                        </h4>
                                        <p style={{ color: "var(--text-main)", fontSize: "0.9rem" }}>
                                            Your estimated capacity for this duration is <strong>{Math.round(estimatedUserCapacity)}W</strong>.
                                            <br />
                                            <span style={{ color: "var(--text-sub)", fontSize: "0.8rem" }}>
                                                ({Math.round(capacityRatio * 100)}% of required power)
                                            </span>
                                        </p>
                                    </div>

                                    {surfaceType !== 'tarmac' && (
                                        <div style={{ marginTop: "1rem", backgroundColor: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: "8px", padding: "0.75rem", fontSize: "0.85rem", color: "#FCD34D" }}>
                                            ⚠️ <strong>{surfaceType === 'cobbles' ? 'Cobbles' : 'Gravel'} Penalty Active:</strong> The high rolling resistance of this surface significantly increases the total watts required.
                                        </div>
                                    )}

                                    <div className="stats-grid" style={{ marginTop: "1.5rem" }}>
                                        <div className="stat-box">
                                            <h4>Avg. Gradient</h4>
                                            <p>{distance > 0 ? ((elevation / distance) * 100).toFixed(1) : 0}%</p>
                                        </div>
                                        <div className="stat-box">
                                            <h4>KOM Speed</h4>
                                            <p>{komTime > 0 ? ((distance / 1000) / (komTime / 3600)).toFixed(1) : 0} km/h</p>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="result-card secondary-result glass-panel outline-panel">
                            <h4 className="secondary-label">
                                <Timer size={16} />
                                Etalon Standard <span className="text-muted">(60kg rider, 7kg bike)</span>
                            </h4>
                            <div className="secondary-stats">
                                {!hasKomData ? (
                                    <div className="stat text-muted">N/A</div>
                                ) : (
                                    <>
                                        <div className="stat">
                                            <span>{komTime > 0 ? Math.round(etalon.etalonWatts) : 0}W</span>
                                        </div>
                                        <div className="stat">
                                            <span>{komTime > 0 ? etalon.etalonWkg.toFixed(2) : 0} W/kg</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                    </div>

                </main>
            </div>
        </div>
    )
}

export default App
