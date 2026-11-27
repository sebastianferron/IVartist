(() => {
  const photos = [
    { id: "purple", title: "Editorial violeta", alt: "Ivanna con maquillaje violeta y body paint de fantasía", focal: "50% 31%", mobile: "50% 25%" },
    { id: "red", title: "Campaña aniversario", alt: "Maquillaje rojo, tocado brillante y body paint de aniversario", focal: "54% 35%", mobile: "52% 32%" },
    { id: "bolivia", title: "Identidad boliviana", alt: "Maquillaje tricolor y escudo de Bolivia pintado a mano", focal: "50% 30%", mobile: "50% 28%" },
    { id: "santa-cruz", title: "Homenaje a Santa Cruz", alt: "Maquillaje verde y escudo cruceño pintado a mano", focal: "50% 28%", mobile: "50% 24%" },
    { id: "chocolate", title: "Arte en chocolate", alt: "Maquillaje de fantasía con tocado inspirado en chocolate", focal: "50% 40%", mobile: "50% 35%" },
    { id: "editorial", title: "Belleza editorial", alt: "Retrato de Ivanna con delineado animal print y accesorios dorados", focal: "54% 32%", mobile: "54% 21%" },
    { id: "brand", title: "Body paint de marca", alt: "Maquillaje con cristales y pintura corporal roja para una campaña", focal: "50% 30%", mobile: "50% 25%" },
  ];

  const courseTopics = {
    purple: ["Maquillaje artístico", "Desarrolla un look de fantasía con color, texturas y detalles que se aprecian en cámara."],
    red: ["Maquillaje para campañas", "Lleva una idea de marca desde la paleta y el diseño hasta el acabado para fotografía."],
    bolivia: ["Color y composición corporal", "Combina líneas, color y símbolos para construir una pieza de maquillaje artístico con identidad propia."],
    "santa-cruz": ["Body paint e identidad", "Traslada símbolos y motivos culturales a la piel con líneas precisas y contrastes de color."],
    chocolate: ["Caracterización creativa", "Explora la ilusión de volumen, el contraste y las texturas para diseñar un personaje propio."],
    editorial: ["Belleza editorial", "Diseña un look para cámara con preparación de piel, técnica de ojos y atención a los detalles."],
    brand: ["Body paint publicitario", "Practica la composición y la precisión para integrar un logotipo en un diseño corporal."],
  };

  const text = (key, label, value, max = 120) => ({ key, label, value, type: "text", max });
  const area = (key, label, value, max = 500) => ({ ...text(key, label, value, max), type: "textarea" });
  const link = (key, label, value) => ({ ...text(key, label, value, 500), type: "link" });
  const toggle = (key, label) => ({ key, label, value: true, type: "checkbox" });
  const select = (key, label, value, options) => ({ key, label, value, type: "select", options });
  const photoOptions = photos.map(({ id, title }) => [id, title]);
  const communityCountries = {
    BO: { name: "Bolivia", prefix: "+591", departments: ["Beni", "Chuquisaca", "Cochabamba", "La Paz", "Oruro", "Pando", "Potosí", "Santa Cruz", "Tarija"] },
    AR: { name: "Argentina", prefix: "+54", cities: ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Salta", "La Plata", "San Miguel de Tucumán"] },
    BR: { name: "Brasil", prefix: "+55", cities: ["São Paulo", "Rio de Janeiro", "Brasília", "Belo Horizonte", "Curitiba", "Salvador", "Recife", "Fortaleza", "Manaus", "Porto Alegre", "Campo Grande", "Corumbá"] },
    CA: { name: "Canadá", prefix: "+1", cities: ["Toronto", "Montreal", "Vancouver", "Ottawa", "Calgary", "Edmonton"] },
    CL: { name: "Chile", prefix: "+56", cities: ["Santiago", "Valparaíso", "Concepción", "Antofagasta", "Iquique", "Arica", "Temuco"] },
    CO: { name: "Colombia", prefix: "+57", cities: ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga"] },
    CR: { name: "Costa Rica", prefix: "+506", cities: ["San José", "Alajuela", "Cartago", "Heredia", "Liberia"] },
    CU: { name: "Cuba", prefix: "+53", cities: ["La Habana", "Santiago de Cuba", "Camagüey", "Holguín", "Santa Clara"] },
    EC: { name: "Ecuador", prefix: "+593", cities: ["Quito", "Guayaquil", "Cuenca", "Manta", "Ambato", "Loja"] },
    SV: { name: "El Salvador", prefix: "+503", cities: ["San Salvador", "Santa Ana", "San Miguel", "Santa Tecla", "Soyapango"] },
    ES: { name: "España", prefix: "+34", cities: ["Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza", "Málaga", "Bilbao", "Murcia"] },
    US: { name: "Estados Unidos", prefix: "+1", cities: ["Nueva York", "Los Ángeles", "Chicago", "Houston", "Miami", "Dallas", "San Francisco", "Washington D. C."] },
    GT: { name: "Guatemala", prefix: "+502", cities: ["Ciudad de Guatemala", "Quetzaltenango", "Antigua Guatemala", "Escuintla", "Mixco"] },
    HN: { name: "Honduras", prefix: "+504", cities: ["Tegucigalpa", "San Pedro Sula", "La Ceiba", "Choluteca", "Comayagua"] },
    MX: { name: "México", prefix: "+52", cities: ["Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Tijuana", "Mérida", "León", "Querétaro", "Cancún"] },
    NI: { name: "Nicaragua", prefix: "+505", cities: ["Managua", "León", "Granada", "Masaya", "Estelí"] },
    PA: { name: "Panamá", prefix: "+507", cities: ["Ciudad de Panamá", "Colón", "David", "Santiago de Veraguas", "Chitré"] },
    PY: { name: "Paraguay", prefix: "+595", cities: ["Asunción", "Ciudad del Este", "Encarnación", "Luque", "San Lorenzo"] },
    PE: { name: "Perú", prefix: "+51", cities: ["Lima", "Arequipa", "Cusco", "Trujillo", "Piura", "Tacna", "Puno", "Chiclayo"] },
    DO: { name: "República Dominicana", prefix: "+1", cities: ["Santo Domingo", "Santiago de los Caballeros", "La Romana", "Puerto Plata", "San Cristóbal"] },
    UY: { name: "Uruguay", prefix: "+598", cities: ["Montevideo", "Salto", "Paysandú", "Maldonado", "Rivera"] },
    VE: { name: "Venezuela", prefix: "+58", cities: ["Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay", "Mérida"] },
  };
  const plans = [
    { id: "esencial", name: "Esencial", photo: "editorial", first: ["Preparación de piel", "Encuentra una rutina y una base que se adapten a ti."], second: ["Look de diario", "Construye un acabado pulido con pasos sencillos."] },
    { id: "profesional", name: "Profesional", photo: "red", first: ["Técnica de ojos", "Profundidad, definición y control del difuminado."], second: ["Maquillaje social", "Adapta el acabado a la luz y a la ocasión."] },
    { id: "editorial", name: "Editorial", photo: "bolivia", first: ["Dirección de look", "Traduce una referencia visual en un maquillaje de campaña."], second: ["Color y textura", "Explora contrastes, detalles y acabados para cámara."] },
    { id: "artistico", name: "Artístico", photo: "chocolate", first: ["Body paint", "Explora el maquillaje como pintura sobre el cuerpo."], second: ["Diseño creativo", "Integra composición, silueta y accesorios en un concepto."] },
  ];
  const homeSections = [
    ["inicio", "Inicio"], ["subscripciones", "Subscripciones"], ["comunidad", "Comunidad y registro"],
    ["clips", "Clips de redes"], ["quien-soy", "Quién soy"], ["cursos", "Cursos"], ["resenas", "Reseñas"], ["podio", "Podio de participantes"],
  ];
  const groups = [
    { id: "orden-secciones", title: "Orden de secciones", fields: [
      { key: "sectionOrder", label: "Orden de secciones", type: "section-order", value: homeSections.map(([id]) => id) },
    ] },
    { id: "marca", title: "Marca y menú", fields: [
      text("brandName", "Nombre en el encabezado", "IVANNA SALDAÑA"),
      text("brandSubtitle", "Subtítulo de la marca", "MAKEUP ARTIST"),
      text("navHome", "Menú · Inicio", "Inicio", 24),
      text("navSubscriptions", "Menú · Subscripciones", "Subscripciones", 24),
      text("navAbout", "Menú · Quién soy", "Quién soy", 24),
      text("navCourses", "Menú · Cursos", "Cursos", 24),
      text("accountGuestLabel", "Menú · Acceso de usuario", "Entrar a Mi espacio", 60),
      text("accountMemberLabel", "Menú · Usuario con sesión iniciada", "Mis cursos", 60),
      text("accountMenuSpace", "Menú de usuario · Mi espacio", "Mi espacio", 60),
      text("accountMenuLogout", "Menú de usuario · Cerrar sesión", "Cerrar sesión", 60),
      text("accountLoginTitle", "Acceso de usuario · Título", "Entrar a Mi espacio", 60),
      text("accountLoginSubmit", "Acceso de usuario · Botón", "Iniciar sesión", 60),
      text("accountLoginRegister", "Acceso de usuario · Enlace de registro", "Crear mi cuenta", 60),
      text("accountLoginClose", "Acceso de usuario · Cerrar formulario", "Cerrar formulario", 60),
      text("accountLoginPending", "Acceso de usuario · Mensaje de espera", "Abriendo Mi espacio…"),
      text("accountLoginError", "Acceso de usuario · Mensaje de conexión", "No se pudo iniciar sesión. Vuelve a intentar."),
      text("footerName", "Nombre en el pie de página", "IVANNA SALDAÑA"),
      text("footerSubtitle", "Subtítulo del pie de página", "Makeup Artist · Bolivia"),
      text("footerCommunityLabel", "Enlace de la comunidad en el pie de página", "Comunidad"),
      text("pageTitle", "Título de la pestaña", "Ivanna Saldaña · Makeup Artist"),
      area("pageDescription", "Descripción para buscadores", "Ivanna Saldaña · Makeup Artist en Bolivia. Portafolio y cursos de maquillaje.", 240),
    ] },
    { id: "whatsapp-contacto", title: "WhatsApp", fields: [
      { ...text("whatsappNumber", "Número con código de país (+591 para Bolivia). Déjalo vacío para ocultar el botón.", "", 32), type: "tel" },
    ] },
    { id: "hero", title: "Hero y foto", fields: [
      select("featuredImage", "Foto del hero", "editorial", photoOptions),
      select("motionIntensity", "Intensidad de la animación", "1", [["0", "Sutil"], ["1", "Editorial"], ["2", "Intensa"]]),
      text("kicker", "Etiqueta superior", "IVANNA SALDAÑA MAKEUP ARTIST · BOLIVIA", 80),
      text("titleMain", "Título principal", "CONVIERTE TU TALENTO", 80),
      text("titleAccent", "Título destacado", "EN ARTE QUE IMPACTA.", 80),
      area("description", "Descripción", "Domina técnica, color y creatividad con una formación diseñada para transformar tu pasión por el maquillaje en una identidad profesional.", 240),
      text("primaryText", "Texto del botón principal", "QUIERO RESERVAR MI CUPO", 50),
      link("primaryHref", "Enlace del botón principal", "#subscripciones"),
      text("secondaryText", "Texto del botón secundario", "EXPLORAR CURSOS", 50),
      link("secondaryHref", "Enlace del botón secundario", "#cursos"),
    ] },
    { id: "cintillo", title: "Cintillo", fields: [
      toggle("announcementEnabled", "Mostrar cintillo"),
      text("announcementText", "Texto del cintillo", "INSCRIPCIONES ABIERTAS · MASTERCLASS INTENSIVA · CUPOS LIMITADOS"),
      link("announcementHref", "Enlace del cintillo", "#proximo-curso"),
    ] },
    { id: "destellos", title: "Destellos", fields: [
      select("sparkleSpeed", "Velocidad de los destellos", "8", [["12", "Lenta"], ["8", "Media"], ["5", "Ágil"]]),
      select("sparkleIntensity", "Intensidad de los destellos", "1", [["0", "Apagados"], ["1", "Sutil"], ["2", "Media"], ["3", "Alta"]]),
    ] },
    { id: "cronometro", title: "Próximo curso y cronómetro", fields: [
      toggle("countdownEnabled", "Mostrar próximo curso"),
      text("countdownLabel", "Etiqueta de la tarjeta", "PRÓXIMO CURSO", 50),
      text("countdownOverline", "Modalidad", "MASTERCLASS EN VIVO", 50),
      text("countdownTitle", "Nombre del curso", "Maquillaje artístico de alto impacto", 80),
      area("countdownSubtitle", "Descripción breve", "Una experiencia intensiva con técnica, composición y dirección creativa.", 140),
      { key: "countdownTarget", label: "Fecha y hora", value: "2026-12-15T19:00", type: "datetime-local" },
      select("countdownTimezone", "Zona horaria", "America/La_Paz", [["America/La_Paz", "Bolivia"], ["America/Lima", "Perú"], ["America/Argentina/Buenos_Aires", "Argentina"], ["America/Mexico_City", "Ciudad de México"]]),
      text("countdownTimezoneText", "Etiqueta de hora (opcional, automática si está vacía)", "", 50),
      text("countdownDays", "Etiqueta de días", "DÍAS", 12),
      text("countdownHours", "Etiqueta de horas", "HORAS", 12),
      text("countdownMinutes", "Etiqueta de minutos", "MIN", 12),
      text("countdownSeconds", "Etiqueta de segundos", "SEG", 12),
      text("countdownButtonText", "Texto del botón", "Reservar mi lugar", 50),
      link("countdownButtonHref", "Enlace del botón", "#subscripciones"),
      select("countdownEndBehavior", "Al llegar a cero", "message", [["message", "Mostrar mensaje de inicio"], ["hide", "Ocultar tarjeta"], ["closed", "Mostrar mensaje de cierre"]]),
      text("countdownStartedTitle", "Título de inicio", "La experiencia comienza ahora"),
      area("countdownStartedCopy", "Mensaje de inicio", "El curso ya está en marcha. Consulta la próxima edición disponible."),
      text("countdownClosedTitle", "Título de cierre", "Inscripciones cerradas"),
      area("countdownClosedCopy", "Mensaje de cierre", "Esta edición ya comenzó. Muy pronto anunciaremos una nueva fecha."),
    ] },
    { id: "comunidad", title: "Comunidad y registro", fields: [
      text("communityTitle", "Primera parte del título", "Forma parte de", 65),
      text("communityAccent", "Texto destacado", "la comunidad.", 65),
      area("communityCopy", "Descripción", "Crea tu cuenta para apuntarte a los cursos y tener tus inscripciones y lecciones en un mismo lugar.", 280),
      text("communityNameLabel", "Etiqueta del campo nombre", "Nombre", 48),
      text("communityCountryLabel", "Etiqueta del país", "País", 48),
      text("communityDepartmentLabel", "Etiqueta del departamento en Bolivia", "Departamento", 48),
      text("communityDepartmentPlaceholder", "Opción inicial de departamento", "Elige tu departamento", 60),
      text("communityCityLabel", "Etiqueta de la ciudad", "Ciudad", 48),
      text("communityCityPlaceholder", "Opción inicial de ciudad", "Elige tu ciudad", 60),
      text("communityOtherCityOption", "Opción para una ciudad fuera de la lista", "Otra ciudad", 60),
      text("communityOtherCityLabel", "Etiqueta para escribir otra ciudad", "Escribe tu ciudad", 60),
      text("communityAgeLabel", "Etiqueta de la edad", "Edad", 48),
      text("communityWhatsAppLabel", "Etiqueta del WhatsApp", "WhatsApp", 48),
      text("communityPhoneHelp", "Ayuda del número de WhatsApp", "Escribe el número local. El prefijo se agrega automáticamente.", 140),
      text("communityInterestLabel", "Pregunta de interés", "¿Qué te interesa aprender?", 90),
      text("communityInterestPlaceholder", "Opción inicial de interés", "Elige una opción", 70),
      area("communityInterests", "Opciones de interés (una por línea)", "Automaquillaje\nMaquillaje profesional\nMaquillaje editorial\nMaquillaje artístico y body paint\nAún no lo sé", 900),
      text("communityEmailLabel", "Etiqueta del campo correo", "Correo electrónico", 48),
      text("communityPasswordLabel", "Etiqueta del campo contraseña", "Contraseña", 48),
      text("communityPasswordHelp", "Ayuda de contraseña", "Usa al menos 10 caracteres.", 120),
      text("communityReferralLabel", "Campo de código de invitación", "Código de invitación (opcional)", 75),
      text("communityShowPassword", "Control para ver la contraseña", "Mostrar contraseña", 60),
      area("communityConsent", "Permiso opcional de contacto por WhatsApp", "Autorizo a Ivanna Saldaña a contactarme por WhatsApp sobre sus cursos (opcional).", 250),
      text("communitySubmit", "Botón de registro", "Unirme a la comunidad", 60),
      text("communityPending", "Mensaje durante el registro", "Creando tu cuenta…"),
      text("communitySuccess", "Mensaje de registro completado", "Tu cuenta está lista. Abriendo Mi espacio…"),
      text("communityError", "Mensaje cuando no se puede conectar", "No se pudo crear tu cuenta. Vuelve a intentar."),
      text("academyCta", "Enlace para miembros", "Ya tengo cuenta", 60),
      link("academyHref", "Destino para miembros", "/mi-espacio"),
      text("communityGreeting", "Saludo a miembros", "Hola,", 60),
      text("communityMemberCopy", "Descripción para miembros", "Consulta tus inscripciones y lecciones en Mi espacio.", 160),
      text("communityMemberLink", "Botón para ir a los cursos", "Ir a mis cursos", 60),
    ] },
    { id: "clips-redes", title: "Clips de redes", fields: [
      text("socialClipsTitle", "Título", "Clips de redes"),
      select("socialClipSpeed", "Velocidad de desplazamiento", "72", [
        ["36", "Suave"], ["54", "Moderada"], ["72", "Ágil"], ["96", "Rápida"], ["128", "Muy rápida"],
      ]),
      { key: "socialClips", label: "Clips", type: "clips", value: [
        { url: "https://www.instagram.com/reel/CkLYtyfNB29/", title: "Maquillaje artístico de Ivanna" },
        { url: "https://www.instagram.com/reel/ChXRMK9tif2/", title: "Arte sobre la piel" },
      ] },
    ] },
    { id: "subscripciones", title: "Subscripciones", fields: [
      text("subscriptionsTitle", "Título", "Subscripciones"),
      toggle("subscriptionLiveEnabled", "Destacar el evento en vivo configurado en Cronómetros"),
      text("subscriptionLiveBadge", "Etiqueta del evento destacado", "EN VIVO", 36),
      { key: "subscriptionLiveEndsAt", label: "Fin del evento destacado (opcional, misma zona del cronómetro)", value: "", type: "datetime-local" },
      text("subscriptionLiveCta", "Botón de inscripción del evento", "Inscribirme", 60),
      area("subscriptionsCopy", "Descripción", "Explora cursos, especiales y clases en vivo de maquillaje, desde tu rutina diaria hasta el body paint."),
      text("subscriptionsCta", "Texto del enlace", "Explorar formación", 60),
      link("subscriptionsHref", "Destino del enlace", "#cursos"),
      text("subscriptionPricePending", "Texto cuando falta el precio", "Precio por anunciar", 48),
    ] },
    ...plans.map(({ id, name, photo, first, second }) => ({ id: `plan-${id}`, title: `Plan ${name}`, fields: [
      toggle(`${id}-enabled`, "Mostrar plan"),
      text(`${id}-name`, "Nombre del plan", name, 30),
      select(`${id}-photo`, "Foto de portada", photo, photoOptions),
      text(`${id}-first-title`, "Primer beneficio", first[0], 60),
      area(`${id}-first-detail`, "Detalle del primer beneficio", first[1], 140),
      text(`${id}-second-title`, "Segundo beneficio", second[0], 60),
      area(`${id}-second-detail`, "Detalle del segundo beneficio", second[1], 140),
      text(`${id}-price`, "Precio informativo antes de abrir inscripciones", "", 40),
      text(`${id}-cta`, "Texto del botón de pago", "Pagar curso", 48),
    ] })),
    { id: "quien-soy", title: "Quién soy", fields: [
      text("aboutTitle", "Título", "Quién soy"),
      text("aboutName", "Nombre", "Ivanna Saldaña"),
      area("aboutCopy", "Biografía", "Mi trabajo en maquillaje va de la belleza editorial al body paint. En mis cursos comparto las técnicas de color, composición y ejecución que uso para llevar una idea de la primera prueba al look final.", 1600),
      select("aboutImage", "Foto de perfil", "editorial", photoOptions),
    ] },
    { id: "cursos", title: "Cursos y portafolio", fields: [
      text("coursesTitle", "Título", "Cursos"),
      area("coursesCopy", "Descripción", "Conoce las técnicas que trabajo en mis cursos, desde el maquillaje editorial hasta el diseño de personajes y el body paint."),
      text("coursesCta", "Texto del enlace", "Ver próximo curso", 60),
      link("coursesHref", "Destino del enlace", "#subscripciones"),
      ...photos.flatMap(({ id, title }) => [
        text(`courseTitle-${id}`, `Título del tema · ${title}`, courseTopics[id][0], 90),
        area(`courseCopy-${id}`, `Qué aprenderás · ${title}`, courseTopics[id][1], 260),
      ]),
    ] },
    { id: "resenas", title: "Reseñas", fields: [
      text("reviewsTitle", "Título", "Reseñas de los cursos"),
      area("reviewsCopy", "Descripción", "Lee lo que comparten quienes ya completaron un curso."),
      text("reviewsEmpty", "Mensaje para la sección sin reseñas", "Todavía no hay reseñas publicadas.", 120),
      text("reviewsMore", "Botón para ver más", "Ver más reseñas", 48),
      text("reviewsDemoLabel", "Etiqueta pública de los ejemplos", "Reseña demo", 48),
    ] },
    { id: "podio", title: "Podio de participantes", fields: [
      text("rankingTitle", "Título", "Podio de participantes"),
      area("rankingCopy", "Descripción", "Las cinco personas con más actividad en los cursos y la comunidad."),
      text("rankingSampleLabel", "Etiqueta de los ejemplos de podio", "Podio de ejemplo"),
    ] },
    { id: "fotos", title: "Textos de las fotografías", fields: photos.flatMap(({ id, title, alt }) => [
      text(`photoTitle-${id}`, `Pie de foto · ${title}`, title, 90),
      text(`photoAlt-${id}`, `Descripción accesible · ${title}`, alt, 180),
    ]) },
  ];
  const fields = groups.flatMap((group) => group.fields);
  const defaults = Object.fromEntries(fields.map(({ key, value }) => [key, value]));

  const editorGroups = groups.flatMap((group) => {
    if (group.id === "orden-secciones") return [{ ...group, area: "orden-secciones" }];
    const isCopy = ({ key, type }) => (type === "text" || type === "textarea") && !key.endsWith("-price");
    const copy = group.fields.filter(isCopy);
    const settings = group.fields.filter((field) => !isCopy(field));
    return [
      ...(copy.length ? [{ ...group, id: `textos-${group.id}`, title: group.id === "hero" ? "Hero" : group.title, area: "textos", fields: copy }] : []),
      ...(settings.length ? [{ ...group, area: "configuracion", fields: settings }] : []),
    ];
  });

  function normalizeSectionOrder(order) {
    const known = homeSections.map(([id]) => id);
    const chosen = Array.isArray(order) ? order.filter((id) => known.includes(id)) : [];
    return [...new Set([...chosen, ...known])];
  }

  function parseSocialClip(link) {
    let url;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname;

    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
      const short = /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname);
      const id = host === "youtu.be" ? /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1]
        : short?.[1] || (url.pathname === "/watch" && url.searchParams.get("v"));
      if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      return {
        key: `youtube:${id}`, platform: short ? "YouTube Shorts" : "YouTube",
        url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      };
    }
    if (["instagram.com", "www.instagram.com"].includes(host)) {
      const post = /^\/(reel|reels|p)\/([A-Za-z0-9_-]{5,24})\/?$/.exec(url.pathname);
      if (!post) return null;
      const type = post[1] === "p" ? "p" : "reel";
      const canonical = `https://www.instagram.com/${type}/${post[2]}/`;
      return { key: `instagram:${post[2]}`, platform: "Instagram", url: canonical };
    }
    if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
      const post = /^\/@([A-Za-z0-9._]+)\/video\/(\d{10,24})\/?$/.exec(url.pathname);
      if (!post) return null;
      return {
        key: `tiktok:${post[2]}`, platform: "TikTok",
        url: `https://www.tiktok.com/@${post[1]}/video/${post[2]}`,
      };
    }
    return null;
  }

  function mergeHomeConfig(config) {
    const merged = { ...defaults, ...config };
    merged.sectionOrder = normalizeSectionOrder(merged.sectionOrder);
    if (merged.subscriptionsCopy === "Cuatro formas de avanzar en maquillaje, desde tu rutina diaria hasta el body paint.") {
      merged.subscriptionsCopy = defaults.subscriptionsCopy;
    }
    for (const { id } of plans) {
      const key = `${id}-cta`;
      if (["Suscribirme con QR", "Próximamente"].includes(merged[key])) merged[key] = defaults[key];
    }
    if (config && !Object.hasOwn(config, "subscriptionLiveHref") && merged.subscriptionLiveCta === "Ver planes") {
      merged.subscriptionLiveCta = defaults.subscriptionLiveCta;
    }
    if (config && !Object.hasOwn(config, "courseTitle-purple") && merged.coursesCopy === "Explora acabados y estilos de mi portafolio, del maquillaje editorial al arte corporal.") {
      merged.coursesCopy = defaults.coursesCopy;
    }
    for (const key of ["brandName", "brandSubtitle", "footerName", "footerSubtitle", "pageTitle", "pageDescription", "kicker"]) {
      if (typeof merged[key] === "string") {
        merged[key] = merged[key].replace(/\bmakeup academy\b/gi, (role) => role === role.toUpperCase() ? "MAKEUP ARTIST" : "Makeup Artist");
      }
    }
    return merged;
  }
  const interestOptions = (config) => {
    const options = (config.communityInterests || "").split(/\r?\n/).map((option) => option.trim()).filter(Boolean);
    return [...new Set(options.length ? options : defaults.communityInterests.split("\n"))];
  };
  const uploadPattern = /^upload-[a-f0-9]{32}\.(?:jpg|png|webp)$/;
  const photoSource = (id) => uploadPattern.test(id) ? `/media/${id}` : `assets/hero-${id}.jpeg`;
  const sampleCovers = {
    "instagram:CkLYtyfNB29": "/assets/reel-maquillaje-artistico.jpg",
    "instagram:ChXRMK9tif2": "/assets/reel-arte-sobre-la-piel.jpg",
  };
  function socialClipCover(clip, cover) {
    if (uploadPattern.test(cover) || photos.some(({ id }) => id === cover)) return photoSource(cover);
    return sampleCovers[clip?.key] || "";
  }
  const keys = { published: "ivanna.hero.published.v1", draft: "ivanna.hero.draft.v1" };
  function normalizeWhatsAppNumber(value) {
    if (typeof value !== "string") return "";
    const number = value.trim();
    if (!/^\+?[\d\s().-]+$/.test(number)) return "";
    const digits = number.replace(/[^\d]/g, "");
    return /^[1-9]\d{6,14}$/.test(digits) ? digits : "";
  }

  function zonedDateTimeToDate(localDateTime, timeZone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localDateTime || "");
    if (!match) return new Date(NaN);
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let guess = target;
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const shown = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, Number(value)]));
        guess += target - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
      }
    } catch {
      return new Date(target);
    }
    return new Date(guess);
  }

  const config = { defaults, fields, groups, editorGroups, homeSections, photos, plans, photoSource, uploadPattern, keys, communityCountries, interestOptions, mergeHomeConfig, parseSocialClip, socialClipCover, normalizeWhatsAppNumber, normalizeSectionOrder, zonedDateTimeToDate };
  if (typeof module !== "undefined" && module.exports) module.exports = config;
  else window.homeConfig = config;
})();
