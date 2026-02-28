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
        locDeniedMsg: 'Your phone has blocked location access for this site.',
        iosHelpTitle: 'How to fix on iPhone:',
        iosStep1: '1. Open Settings → Privacy & Security → Location Services',
        iosStep2: '2. Make sure Location Services is ON',
        iosStep3: '3. Scroll down → tap Safari Websites (or Chrome) → select "While Using the App" or "Ask Next Time"',
        iosStep4: '4. Come back here, reload the page, and tap Enable Location',
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

        // ── Staff portal ──
        staffPortal: 'Staff Portal',
        staffLoginEnterBoth: 'Please enter your Staff ID and PIN.',
        staffLoginFailed: 'Login failed. Please try again.',
        staffLoginLocked: 'Account temporarily locked',
        staffLoginRetryIn: 'Retry in',
        staffLoginSignIn: 'SIGN IN',
        staffLoginSigningIn: 'Signing in...',
        staffLoginBackToClock: 'Back to Clock',

        // Dashboard
        dashTitle: 'Dashboard',
        dashHome: 'Home',
        dashHistory: 'History',
        dashTasks: 'Tasks',
        dashMessages: 'Messages',
        dashProfile: 'Profile',
        dashLogout: 'Logout',

        // Attendance card
        attTitle: 'Attendance',
        attCheckedIn: 'Checked In',
        attCheckedOut: 'Checked Out',
        attLastCheckIn: 'Last check-in',
        attCheckInBtn: '✦ CHECK IN',
        attCheckOutBtn: 'CHECK OUT ✦',
        attNeedLocation: 'Location needed for check-in/out',
        attTooFar: 'You are too far from the restaurant',

        // Shift card
        shiftTitle: "Today's Shift",
        shiftStart: 'Start',
        shiftEnd: 'End',
        shiftRole: 'Role',
        shiftOnTime: 'On time',
        shiftLateBy: 'Late by {min} min',
        shiftNoShift: 'No shift scheduled',

        // Tasks card
        tasksTitle: "Today's Tasks",
        tasksDue: 'Due',
        tasksCompleted: 'Completed',
        tasksOverdue: 'Overdue',
        tasksMarkDone: 'Done',
        tasksNoTasks: 'No tasks for today',
        tasksViewAll: 'View All Tasks →',

        // Messages card
        msgTitle: 'Messages',
        msgUnread: '{count} unread',
        msgNoMessages: 'No messages',
        msgOpenInbox: 'Open Inbox →',

        // Alerts card
        alertsTitle: 'Alerts',
        alertLate: 'You are late for your shift',
        alertForgotCheckout: 'You forgot to check out yesterday',
        alertNoAlerts: 'No alerts',

        // History page
        histTitle: 'Attendance History',
        histDate: 'Date',
        histIn: 'In',
        histOut: 'Out',
        histHours: 'Hours',
        histStatus: 'Status',
        histLate: 'Late',
        histAdjusted: 'Adjusted',
        histStillIn: 'Still In',
        histNoRecords: 'No attendance records found',

        // Tasks page
        tasksPageTitle: 'Tasks',
        tasksTabToday: 'Today',
        tasksTabUpcoming: 'Upcoming',
        tasksTabCompleted: 'Completed',
        tasksEmpty: 'No tasks',
        tasksDueDate: 'Due: {date}',

        // Messages page
        msgPageTitle: 'Messages',
        msgSend: 'Send',
        msgPlaceholder: 'Type a message...',
        msgEmpty: 'No messages yet',

        // Profile page
        profileTitle: 'Profile',
        profileName: 'Name',
        profileRole: 'Role',
        profileStaffId: 'Staff ID',
        profileLogout: 'LOG OUT',
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
        locDeniedMsg: 'Tu teléfono ha bloqueado el acceso a la ubicación para este sitio.',
        iosHelpTitle: 'Cómo arreglarlo en iPhone:',
        iosStep1: '1. Abre Ajustes → Privacidad y seguridad → Localización',
        iosStep2: '2. Asegúrate que Localización esté ACTIVADA',
        iosStep3: '3. Baja → toca Safari (o Chrome) → selecciona "Mientras se usa" o "Preguntar la próxima vez"',
        iosStep4: '4. Regresa aquí, recarga la página, y toca Activar Ubicación',
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

        // ── Staff portal ──
        staffPortal: 'Portal de Empleados',
        staffLoginEnterBoth: 'Ingresa tu ID y PIN.',
        staffLoginFailed: 'Error al iniciar sesión.',
        staffLoginLocked: 'Cuenta bloqueada temporalmente',
        staffLoginRetryIn: 'Reintentar en',
        staffLoginSignIn: 'INICIAR SESIÓN',
        staffLoginSigningIn: 'Ingresando...',
        staffLoginBackToClock: 'Volver al Reloj',

        // Dashboard
        dashTitle: 'Panel',
        dashHome: 'Inicio',
        dashHistory: 'Historial',
        dashTasks: 'Tareas',
        dashMessages: 'Mensajes',
        dashProfile: 'Perfil',
        dashLogout: 'Salir',

        // Attendance card
        attTitle: 'Asistencia',
        attCheckedIn: 'Registrado',
        attCheckedOut: 'Salida Registrada',
        attLastCheckIn: 'Última entrada',
        attCheckInBtn: '✦ ENTRADA',
        attCheckOutBtn: 'SALIDA ✦',
        attNeedLocation: 'Se necesita ubicación para registrar',
        attTooFar: 'Estás muy lejos del restaurante',

        // Shift card
        shiftTitle: 'Turno de Hoy',
        shiftStart: 'Inicio',
        shiftEnd: 'Fin',
        shiftRole: 'Rol',
        shiftOnTime: 'A tiempo',
        shiftLateBy: 'Tarde por {min} min',
        shiftNoShift: 'Sin turno programado',

        // Tasks card
        tasksTitle: 'Tareas de Hoy',
        tasksDue: 'Pendientes',
        tasksCompleted: 'Completadas',
        tasksOverdue: 'Vencidas',
        tasksMarkDone: 'Hecho',
        tasksNoTasks: 'Sin tareas para hoy',
        tasksViewAll: 'Ver Todas →',

        // Messages card
        msgTitle: 'Mensajes',
        msgUnread: '{count} sin leer',
        msgNoMessages: 'Sin mensajes',
        msgOpenInbox: 'Abrir Bandeja →',

        // Alerts card
        alertsTitle: 'Alertas',
        alertLate: 'Llegas tarde a tu turno',
        alertForgotCheckout: 'Olvidaste registrar salida ayer',
        alertNoAlerts: 'Sin alertas',

        // History page
        histTitle: 'Historial de Asistencia',
        histDate: 'Fecha',
        histIn: 'Entrada',
        histOut: 'Salida',
        histHours: 'Horas',
        histStatus: 'Estado',
        histLate: 'Tarde',
        histAdjusted: 'Ajustado',
        histStillIn: 'Aún Dentro',
        histNoRecords: 'No se encontraron registros',

        // Tasks page
        tasksPageTitle: 'Tareas',
        tasksTabToday: 'Hoy',
        tasksTabUpcoming: 'Próximas',
        tasksTabCompleted: 'Completadas',
        tasksEmpty: 'Sin tareas',
        tasksDueDate: 'Vence: {date}',

        // Messages page
        msgPageTitle: 'Mensajes',
        msgSend: 'Enviar',
        msgPlaceholder: 'Escribe un mensaje...',
        msgEmpty: 'Sin mensajes aún',

        // Profile page
        profileTitle: 'Perfil',
        profileName: 'Nombre',
        profileRole: 'Rol',
        profileStaffId: 'ID de Empleado',
        profileLogout: 'CERRAR SESIÓN',
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
