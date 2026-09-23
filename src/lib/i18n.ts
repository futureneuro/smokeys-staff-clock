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

        // Task proof photos
        proofRequired: 'Photo required',
        proofDone: 'Photo attached',
        proofHint: 'This task needs a photo showing the work is done before it can be completed.',
        proofTake: '📸 Take photo',
        proofRetake: 'Replace photo',
        proofUploading: 'Uploading…',
        proofPhoto: 'Proof photo',
        proofRequiredError: 'Add the photo first, then mark it complete.',
        proofBadge: 'Needs photo',

        // ── Inventory: counts and waste ──
    countsTitle: 'Stock counts',
    countsIntro: 'Count what is physically there, and the system compares it against what it expected.',
    countsThresholds: 'Alerts fire when an item is short by more than {pct}% and {value}.',
    newCount: '+ New count',
    noCounts: 'No counts yet. The first one sets the baseline, so nothing is flagged until the second.',
    colDate: 'DATE',
    colArea: 'AREA',
    colItems: 'ITEMS',
    colNeedsLook: 'NEEDS A LOOK',
    colShortfall: 'SHORTFALL',
    colNote: 'NOTE',
    view: 'View',

    countSheetTitle: 'Count the stock',
    countSheetIntro: 'Write down what you actually find. Leave an item blank to skip it.',
    countBlindNote: 'The expected figure is hidden on purpose — that is what makes the count worth doing.',
    dateCounted: 'DATE COUNTED *',
    area: 'AREA',
    everywhere: 'Everywhere',
    whoNote: 'WHO / NOTE',
    whoPlaceholder: 'Carlos — kitchen',
    highPriority: '🔴 High priority',
    mediumPriority: '🟡 Medium',
    normalPriority: '⚪ Normal',
    highPriorityHint: 'Proteins and other high-value items. If time is short, count only these.',
    itemsCounted: '{n} item(s) counted',
    notANumber: '{n} NOT A NUMBER',
    saveCount: 'Save count and compare',
    saving: 'Saving…',
    cancel: 'Cancel',
    systemSays: 'system says',
    inUnit: 'in',
    noItemsInArea: 'No counted items in this area.',

    resultTitle: 'Count result',
    resultIntro: 'Difference between what was found and what the system expected. Stock has been adjusted to match the count.',
    back: 'Back',
    statItems: 'ITEMS COUNTED',
    statNeedsLook: 'NEEDS A LOOK',
    statShortfall: 'SHORTFALL VALUE',
    alertLine: '{n} item(s) are short by more than the alert threshold.',
    alertAdvice: 'Before treating this as theft, check whether waste, staff meals or a missing purchase explain it.',
    colExpected: 'EXPECTED',
    colCounted: 'COUNTED',
    colDifference: 'DIFFERENCE',
    colValue: 'VALUE',
    check: 'CHECK',

    wasteTitle: 'Waste and adjustments',
    wasteIntro: 'Anything that leaves stock without being sold. The POS has nowhere to record this, and without it every spoiled tomato shows up as a shortfall.',
    wasteWhat: 'WHAT',
    wasteChoose: '— choose an item —',
    wasteHowMuch: 'HOW MUCH',
    wasteReason: 'REASON',
    wasteDate: 'DATE',
    wasteNote: 'NOTE',
    wasteNoteRequired: 'Required — explain the correction',
    wasteNoteOptional: 'Optional',
    wasteRecord: 'Record it',
    wasteRecent: 'Recorded in the last 14 days',
    wasteEmpty: 'Nothing recorded yet. If waste never gets logged, the count will keep reporting shortfalls that nobody can explain.',
    wasteOpeningHint: 'Opening stock ADDS to the count. Use it once per item when starting out, to record what was already there.',
    wasteStaffHint: 'Staff meals normally come from a separate shop. Only record it here if it actually came out of restaurant stock.',
    wasteRecorded: 'Recorded {qty} of {item}.',
    colItem: 'ITEM',
    colQty: 'QUANTITY',
    colReason: 'REASON',

    reason_waste: 'Waste / spoiled',
    reason_count: 'Count difference',
    reason_sale: 'Sold',
    reason_purchase: 'Purchase',
    reason_staff_meal: 'Staff meal',
    reason_comp: 'Comped or remade',
    reason_transfer_out: 'Moved elsewhere',
    reason_adjustment: 'Manual correction',
    reason_opening: 'Opening stock (adds)',

    area_kitchen: 'Kitchen',
    area_bar: 'Bar',
    area_fridge: 'Fridge',
    area_freezer: 'Freezer',
    area_dry_store: 'Dry store',
    area_other: 'Other',

    loading: 'Loading…',

    // Monthly report
    reportTitle: 'Monthly report',
    reportIntro: 'Everything that happened to the inventory in one month: what sold, what was bought, what was lost, and what is left on the shelf.',
    reportMonth: 'MONTH',
    reportRefresh: 'Refresh',
    reportAiButton: '✨ Summarise with AI',
    reportAiWorking: 'Reading the month…',
    reportAiTitle: 'AI summary',
    reportAiHint: 'Written from the numbers below. Check anything surprising against the tables before acting on it.',
    reportCardRevenue: 'SALES (MENU PRICES)',
    reportCardSold: 'ITEMS SOLD',
    reportCardSpend: 'SPENT ON PURCHASES',
    reportCardLoss: 'LOSSES',
    reportCardStock: 'STOCK ON HAND',
    reportCardLow: 'RUNNING LOW',
    reportDays: '{days} day(s) with sales, {pos} from the POS',
    reportPosLine: 'POS reported {items} items and {revenue} across {days} imported day(s){held}.',
    reportPosHeld: ', {held} day(s) still held for mapping',
    reportSold: 'What sold',
    reportSoldEmpty: 'No confirmed sales this month. Import days from the POS or type them in under Sales.',
    reportPurchased: 'What was bought',
    reportPurchasedEmpty: 'No confirmed purchases this month.',
    reportUsage: 'Where stock went',
    reportLosses: 'Losses',
    reportLossesEmpty: 'Nothing lost, wasted or written off this month.',
    reportConsumed: 'Used by sales',
    reportStock: 'What is left',
    reportStockEmpty: 'No tracked items yet.',
    reportStockHint: 'Only items that are out, negative, or have under a week left. The full shelf is under Stock.',
    reportStockFine: 'Nothing is running low. See the Stock tab for the full shelf.',
    reportAlerts: 'Variance alerts this month',
    reportAlertsEmpty: 'No stock count raised an alert this month.',
    reportPartial: 'Sales exist for only {days} of {total} day(s) this month, so the picture is partial.',
    colMenuItem: 'MENU ITEM',
    colDays: 'DAYS',
    colRevenue: 'REVENUE',
    colSpend: 'SPENT',
    colPurchases: 'PURCHASES',
    colStock: 'IN STOCK',
    colDaysLeft: 'DAYS LEFT',
    colSeverity: 'SEVERITY',
    colStatus: 'STATUS',
    colTitle: 'TITLE',
    colMissing: 'MISSING',
        statusChangeFailed: 'Could not save the change. Check your connection and try again.',
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

        // Task proof photos
        proofRequired: 'Se requiere foto',
        proofDone: 'Foto adjuntada',
        proofHint: 'Esta tarea necesita una foto que muestre el trabajo hecho antes de poder completarse.',
        proofTake: '📸 Tomar foto',
        proofRetake: 'Cambiar la foto',
        proofUploading: 'Subiendo…',
        proofPhoto: 'Foto de evidencia',
        proofRequiredError: 'Primero suba la foto y luego marque la tarea como completada.',
        proofBadge: 'Falta foto',

        // ── Inventory: counts and waste ──
    // Counts — list
    countsTitle: 'Conteos de inventario',
    countsIntro: 'Cuente lo que hay físicamente y el sistema lo compara con lo que esperaba.',
    countsThresholds: 'Se avisa cuando falta más de {pct}% y más de {value}.',
    newCount: '+ Nuevo conteo',
    noCounts: 'Todavía no hay conteos. El primero fija la base, así que no se avisa nada hasta el segundo.',
    colDate: 'FECHA',
    colArea: 'ÁREA',
    colItems: 'PRODUCTOS',
    colNeedsLook: 'PARA REVISAR',
    colShortfall: 'FALTANTE',
    colNote: 'NOTA',
    view: 'Ver',

    // Counts — sheet
    countSheetTitle: 'Contar el inventario',
    countSheetIntro: 'Anote lo que encuentre. Deje en blanco lo que no cuente.',
    countBlindNote: 'La cantidad esperada está oculta a propósito — eso es lo que hace que el conteo sirva.',
    dateCounted: 'FECHA DEL CONTEO *',
    area: 'ÁREA',
    everywhere: 'Todo',
    whoNote: 'QUIÉN / NOTA',
    whoPlaceholder: 'Carlos — cocina',
    highPriority: '🔴 Prioridad alta',
    mediumPriority: '🟡 Media',
    normalPriority: '⚪ Normal',
    highPriorityHint: 'Proteínas y productos caros. Si hay poco tiempo, cuente solo estos.',
    itemsCounted: '{n} producto(s) contados',
    notANumber: '{n} NO SON NÚMEROS',
    saveCount: 'Guardar conteo y comparar',
    saving: 'Guardando…',
    cancel: 'Cancelar',
    systemSays: 'el sistema dice',
    inUnit: 'en',
    noItemsInArea: 'No hay productos para contar en esta área.',

    // Counts — result
    resultTitle: 'Resultado del conteo',
    resultIntro: 'Diferencia entre lo encontrado y lo esperado. El inventario ya quedó ajustado al conteo.',
    back: 'Volver',
    statItems: 'PRODUCTOS CONTADOS',
    statNeedsLook: 'PARA REVISAR',
    statShortfall: 'VALOR DEL FALTANTE',
    alertLine: '{n} producto(s) tienen un faltante mayor al límite.',
    alertAdvice: 'Antes de pensar en robo, revise si se explica por desperdicio, comida del personal o una compra sin registrar.',
    colExpected: 'ESPERADO',
    colCounted: 'CONTADO',
    colDifference: 'DIFERENCIA',
    colValue: 'VALOR',
    check: 'REVISAR',

    // Waste
    wasteTitle: 'Desperdicio y ajustes',
    wasteIntro: 'Todo lo que sale del inventario sin venderse. El POS no tiene dónde anotarlo, y sin esto cada tomate dañado aparece como faltante.',
    wasteWhat: 'QUÉ',
    wasteChoose: '— elija un producto —',
    wasteHowMuch: 'CUÁNTO',
    wasteReason: 'MOTIVO',
    wasteDate: 'FECHA',
    wasteNote: 'NOTA',
    wasteNoteRequired: 'Obligatorio — explique la corrección',
    wasteNoteOptional: 'Opcional',
    wasteRecord: 'Registrar',
    wasteRecent: 'Registrado en los últimos 14 días',
    wasteEmpty: 'Nada registrado todavía. Si el desperdicio no se anota, el conteo va a seguir mostrando faltantes que nadie puede explicar.',
    wasteOpeningHint: 'El inventario inicial SUMA. Úselo una vez por producto al empezar, para registrar lo que ya había.',
    wasteStaffHint: 'La comida del personal normalmente viene de un mercado aparte. Anótela aquí solo si salió del inventario del restaurante.',
    wasteRecorded: 'Registrado {qty} de {item}.',
    colItem: 'PRODUCTO',
    colQty: 'CANTIDAD',
    colReason: 'MOTIVO',

    // Reasons
    reason_waste: 'Desperdicio / dañado',
    reason_count: 'Diferencia de conteo',
    reason_sale: 'Venta',
    reason_purchase: 'Compra',
    reason_staff_meal: 'Comida del personal',
    reason_comp: 'Cortesía o plato rehecho',
    reason_transfer_out: 'Trasladado a otro lado',
    reason_adjustment: 'Corrección manual',
    reason_opening: 'Inventario inicial (suma)',

    // Areas
    area_kitchen: 'Cocina',
    area_bar: 'Bar',
    area_fridge: 'Nevera',
    area_freezer: 'Congelador',
    area_dry_store: 'Bodega',
    area_other: 'Otro',

    loading: 'Cargando…',

    // Informe mensual
    reportTitle: 'Informe mensual',
    reportIntro: 'Todo lo que pasó con el inventario en un mes: qué se vendió, qué se compró, qué se perdió y qué queda en la estantería.',
    reportMonth: 'MES',
    reportRefresh: 'Actualizar',
    reportAiButton: '✨ Resumen con IA',
    reportAiWorking: 'Leyendo el mes…',
    reportAiTitle: 'Resumen de la IA',
    reportAiHint: 'Escrito a partir de los números de abajo. Revise cualquier dato sorprendente contra las tablas antes de actuar.',
    reportCardRevenue: 'VENTAS (PRECIO DE CARTA)',
    reportCardSold: 'ARTÍCULOS VENDIDOS',
    reportCardSpend: 'GASTADO EN COMPRAS',
    reportCardLoss: 'PÉRDIDAS',
    reportCardStock: 'INVENTARIO ACTUAL',
    reportCardLow: 'POR AGOTARSE',
    reportDays: '{days} día(s) con ventas, {pos} desde el POS',
    reportPosLine: 'El POS reportó {items} artículos y {revenue} en {days} día(s) importado(s){held}.',
    reportPosHeld: ', {held} día(s) aún esperando asignación',
    reportSold: 'Qué se vendió',
    reportSoldEmpty: 'No hay ventas confirmadas este mes. Importe días desde el POS o regístrelos en Ventas.',
    reportPurchased: 'Qué se compró',
    reportPurchasedEmpty: 'No hay compras confirmadas este mes.',
    reportUsage: 'A dónde fue el inventario',
    reportLosses: 'Pérdidas',
    reportLossesEmpty: 'Nada perdido, desperdiciado ni dado de baja este mes.',
    reportConsumed: 'Consumido por ventas',
    reportStock: 'Qué queda',
    reportStockEmpty: 'Todavía no hay productos con seguimiento.',
    reportStockHint: 'Solo lo agotado, en negativo o con menos de una semana. La estantería completa está en Stock.',
    reportStockFine: 'Nada por agotarse. La estantería completa está en la pestaña Stock.',
    reportAlerts: 'Alertas de diferencias este mes',
    reportAlertsEmpty: 'Ningún conteo generó alerta este mes.',
    reportPartial: 'Solo hay ventas para {days} de {total} día(s) del mes, así que la foto es parcial.',
    colMenuItem: 'PLATO',
    colDays: 'DÍAS',
    colRevenue: 'VENTAS',
    colSpend: 'GASTADO',
    colPurchases: 'COMPRAS',
    colStock: 'EN STOCK',
    colDaysLeft: 'DÍAS RESTANTES',
    colSeverity: 'GRAVEDAD',
    colStatus: 'ESTADO',
    colTitle: 'TÍTULO',
    colMissing: 'FALTANTE',
        statusChangeFailed: 'No se pudo guardar el cambio. Revise la conexión e intente de nuevo.',
    },
};

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
    let str = translations[lang]?.[key] ?? translations.en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            str = str.replaceAll(`{${k}}`, String(v));
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

const LANG_KEY = 'smokeys_lang';

// Spanish by default: the people who use the count and waste screens every
// week work in the restaurant. Stored under the same key as the rest of the
// app so nobody has to choose their language twice.
export function getLang(): Lang {
    if (typeof window === 'undefined') return 'es';
    try {
        const saved = window.localStorage.getItem(LANG_KEY);
        return saved === 'en' || saved === 'es' ? saved : 'es';
    } catch {
        return 'es';
    }
}

export function setLang(lang: Lang): void {
    try {
        window.localStorage.setItem(LANG_KEY, lang);
    } catch {
        // Private browsing or blocked storage; the choice just will not persist.
    }
}
