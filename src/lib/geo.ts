export interface GeoPosition {
    lat: number;
    lng: number;
}

export function getCurrentPosition(): Promise<GeoPosition> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser.'));
            return;
        }

        const onSuccess = (position: GeolocationPosition) => {
            resolve({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
            });
        };

        const onError = (error: GeolocationPositionError) => {
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    reject(new Error('Location access denied. Please enable location services in your browser settings to check in.'));
                    break;
                case error.POSITION_UNAVAILABLE:
                    reject(new Error('Location information is unavailable. Please try again.'));
                    break;
                case error.TIMEOUT:
                    reject(new Error('Location request timed out. Please try again.'));
                    break;
                default:
                    reject(new Error('An unknown error occurred while getting location.'));
            }
        };

        // Try high accuracy first, fall back to low accuracy on timeout
        navigator.geolocation.getCurrentPosition(
            onSuccess,
            (err) => {
                if (err.code === err.TIMEOUT) {
                    // Retry without high accuracy (helps on some iOS devices)
                    navigator.geolocation.getCurrentPosition(
                        onSuccess,
                        onError,
                        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
                    );
                } else {
                    onError(err);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
            }
        );
    });
}

/**
 * Haversine formula — returns distance between two GPS points in **kilometers**.
 */
export function haversineDistance(
    a: GeoPosition,
    b: GeoPosition
): number {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
        sinLat * sinLat +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}
