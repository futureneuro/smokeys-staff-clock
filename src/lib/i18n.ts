export type Lang = 'en' | 'es';

const translations: Record<Lang, Record<string, string>> = {
    en: {
        // Header
        appTitle: "SMOKEY'S",
        staffClock: 'Staff Clock',
        adminPortal: 'Admin Portal',

        // Permission screen
        permTitle: 'Location Needed',
        permMessage: 'Tap the button below to allow location access so you can clock in.',
        permButton: '📍 ENABLE LOCATION',

        // Loading
        loadingTitle: 'Verifying your location...',
        loadingHint: 'Please allow location access when prompted',

        // Location error
        locErrorTitle: 'Location Required',
        locDeniedTitle: 'Location Access Denied',
        locDeniedMsg: 'Your browser has blocked location access for this site.',
        iosHelpTitle: 'How to fix on iPhone:',
        iosStep1: '1. Open Settings → Safari',
        iosStep2: '2. Scroll down → tap "Clear History and Website Data"',
        iosStep3: '3. Or: Settings → Safari → Advanced → Website Data → search this site → Delete',
        iosStep4: '4. Come back here and tap the button below',
        tryAgain: 'TRY AGAIN',

        // Distance error (templates use {dist} and {radius})
        distError: 'You are {dist} away. Must be within {radius} of Smokey\'s.',

        // Ready / form
        locVerified: 'Location verified',
        away: 'away',
        staffId: 'Staff ID',
        staffIdPlaceholder: 'e.g. SMK001',
        pin: 'PIN',
        pinPlaceholder: 'Enter your PIN',
        checkIn: '✦ CHECK IN',
        checkOut: 'CHECK OUT ✦',
        enterBoth: 'Please enter your Staff ID and PIN.',
        noLocation: 'Location not available. Please refresh and allow location access.',
        networkError: 'Network error. Please check your connection and try again.',
        adminDashboard: 'Admin Dashboard →',

        // Success
        checkInQuote: '"Clock in. Stay sharp."',
        checkOutQuote: '"Good hustle. See you tomorrow."',
        totalHours: 'Total Hours',
        done: 'Done',

        // Language toggle
        langToggle: '🇨🇴 Español',
    },
    es: {
        // Header
        appTitle: "SMOKEY'S",
        staffClock: 'Reloj de Personal',
        adminPortal: 'Portal de Admin',

        // Permission screen
        permTitle: 'Ubicación Necesaria',
        permMessage: 'Toca el botón para permitir el acceso a tu ubicación y poder registrarte.',
        permButton: '📍 ACTIVAR UBICACIÓN',

        // Loading
        loadingTitle: 'Verificando tu ubicación...',
        loadingHint: 'Por favor permite el acceso a tu ubicación',

        // Location error
        locErrorTitle: 'Ubicación Requerida',
        locDeniedTitle: 'Acceso a Ubicación Denegado',
        locDeniedMsg: 'Tu navegador ha bloqueado el acceso a la ubicación para este sitio.',
        iosHelpTitle: 'Cómo arreglarlo en iPhone:',
        iosStep1: '1. Abre Ajustes → Safari',
        iosStep2: '2. Baja → toca "Borrar historial y datos de sitios web"',
        iosStep3: '3. O: Ajustes → Safari → Avanzado → Datos de sitios web → busca este sitio → Eliminar',
        iosStep4: '4. Regresa aquí y toca el botón de abajo',
        tryAgain: 'INTENTAR DE NUEVO',

        // Distance error
        distError: 'Estás a {dist} de distancia. Debes estar dentro de {radius} de Smokey\'s.',

        // Ready / form
        locVerified: 'Ubicación verificada',
        away: 'de distancia',
        staffId: 'ID de Empleado',
        staffIdPlaceholder: 'ej. SMK001',
        pin: 'PIN',
        pinPlaceholder: 'Ingresa tu PIN',
        checkIn: '✦ ENTRADA',
        checkOut: 'SALIDA ✦',
        enterBoth: 'Por favor ingresa tu ID de empleado y PIN.',
        noLocation: 'Ubicación no disponible. Actualiza la página y permite el acceso.',
        networkError: 'Error de red. Revisa tu conexión e intenta de nuevo.',
        adminDashboard: 'Panel de Admin →',

        // Success
        checkInQuote: '"A trabajar. Vamos con todo."',
        checkOutQuote: '"Buen trabajo. Nos vemos mañana."',
        totalHours: 'Horas Totales',
        done: 'Listo',

        // Language toggle
        langToggle: '🇺🇸 English',
    },
};

export function t(lang: Lang, key: string, vars?: Record<string, string>): string {
    let str = translations[lang]?.[key] ?? translations.en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            str = str.replace(`{${k}}`, v);
        }
    }
    return str;
}

export function formatDistance(km: number, lang: Lang): string {
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
}

/**
 * Format a date/time string in Medellín timezone (America/Bogota, UTC-5).
 */
export function formatTimeMedellin(isoString: string, lang: Lang): string {
    const locale = lang === 'es' ? 'es-CO' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Bogota',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(isoString));
}

export function formatDateTimeMedellin(isoString: string, lang: Lang): string {
    const locale = lang === 'es' ? 'es-CO' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
        timeZone: 'America/Bogota',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(isoString));
}
