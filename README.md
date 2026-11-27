# Ivanna Saldaña · Makeup Artist

Portada y dashboard de Ivanna Saldaña, Makeup Artist. En Windows, el servidor local guarda la cuenta, los borradores, la versión publicada y las fotos en `%LOCALAPPDATA%\IvannaMakeupAcademy`, fuera de la carpeta del sitio.

- Hero editorial animado con una sola foto. Las demás se distribuyen entre Quién soy y el portafolio de Cursos.
- Cintillo promocional ondulado cuyo texto sigue la curva al desplazarse por el hero. El texto, el enlace y la visibilidad se administran desde el panel.
- Cronómetro del próximo curso con fecha y zona horaria reales.
- Ajustes de velocidad e intensidad de los destellos del hero, Subscripciones, Comunidad y Quién soy en **Destellos**.
- Inicio de sesión con usuario y contraseña. El candado del pie de página lleva al acceso o al dashboard si ya hay una sesión activa.
- En **Configuración → WhatsApp** puedes editar el número internacional del botón flotante. El campo vacío oculta el botón al publicar.
- Editor de marca, menú, hero, cronómetro, subscripciones, biografía, cursos, textos de fotos y pie de página. El editor permite cambiar la foto del hero con la galería original o subir una foto JPG, PNG o WebP de hasta 6 MB.
- Cuatro tarjetas de subscripción editables y una tarjeta central para el evento en vivo. Las cinco abren la inscripción y el pago por QR en la portada.
- Debajo del registro, los clips se desplazan de izquierda a derecha en una cinta continua que se detiene al pasar el puntero. Un clic o toque abre la publicación original en otra pestaña. En **Clips de redes** puedes agregar enlaces públicos de YouTube, Instagram y TikTok, subir la captura de cada clip y ajustar la velocidad. Los clips aparecen en la portada al publicar la configuración con su captura.
- Registro de la comunidad en la portada. El icono de usuario abre el formulario de acceso para visitantes o el menú **Mi espacio / Cerrar sesión** si hay una sesión activa. En Mi espacio cada estudiante consulta sus inscripciones y accede a su curso o transmisión tras la aprobación del pago.

## Ejecutar

Instala las dependencias y ejecuta el servidor con Node.js 22 o posterior.

```powershell
npm ci
node server.js
```

Abre `http://127.0.0.1:4187/`. El candado abre el formulario de usuario y contraseña. Para dar de alta una cuenta en una instalación nueva, usa `node server.js --create-admin nombre-de-usuario` en la terminal y escribe la contraseña cuando se solicite. Reinicia el servidor después de crearla.

Para crear la cuenta protegida o ascender al administrador existente con el mismo usuario, usa `node server.js --set-superadmin nombre-de-usuario`. La contraseña se solicita en la terminal y se guarda como hash. La cuenta no se puede eliminar desde el panel.

El servidor escucha en la interfaz local. Para publicarlo, usa un proxy HTTPS que preserve el encabezado `Host` y configura `IVANNA_PUBLIC_ORIGIN` con el origen del sitio, por ejemplo `https://tudominio.com`. Respalda la carpeta de datos para conservar el CMS, los avisos y el archivo privado `push-keys.json`.

## App y notificaciones

En la campanita de la portada y de **Mi espacio** está **Instalar app**. Ahí las estudiantes pueden activar o desactivar las notificaciones web del dispositivo. En iPhone y iPad se instala desde **Compartir → Añadir a pantalla de inicio** y el permiso se activa desde la app instalada.

La campanita enlaza al estado del comprobante, al contenido habilitado o a la noticia en el feed. En **Admin → Notificaciones y novedades** se pueden publicar noticias con fotos y enlaces, con envío push opcional. En producción configura `IVANNA_PUSH_CONTACT` con un contacto VAPID, por ejemplo `mailto:contacto@tudominio.com`. El envío requiere acceso HTTPS saliente desde el servidor a los proveedores de Web Push.

**Mi espacio → Feed** aparece debajo de **Mis cursos** con tres publicaciones por página y accesos directos a **Podio** y **Shop**. Cualquier visitante puede leer y compartir las publicaciones. Las estudiantes con sesión iniciada pueden publicar texto o fotos, comentar y dar corazones. Los enlaces escritos son clicables. **Admin → Comunidad** permite ocultar y restaurar contenido.

En **Mi espacio → Perfil** se pueden actualizar el nombre, el correo y el WhatsApp. Cambiar el correo o la contraseña requiere confirmar la contraseña actual y cierra las demás sesiones. En el perfil público se muestran el nombre guardado, la especialidad, la foto y las redes que se agreguen.

El podio muestra a las cinco personas con más actividad y se actualiza en la portada y debajo del feed. Cuando aún no hay actividad que puntúe, aparecen cinco posiciones de ejemplo identificadas como tales.

## Referidos y descuentos

En **Admin → Configuración → Referidos y descuentos** se pueden activar el código promocional del sitio y las invitaciones personales. Admin puede usar el mismo porcentaje para ambas personas o configurarlos por separado. En **Mi perfil → Mis referidos** se puede comprobar y guardar un código único y copiar su enlace. Los enlaces anteriores siguen asociados a la misma cuenta. Los códigos del sitio se aplican en el pago y los códigos personales al registrarse.

El descuento de bienvenida se reserva para una inscripción. Cuando se aprueba la primera compra real de la persona invitada, quien la invitó gana un descuento de un solo uso que se aplica en su próxima compra disponible. Cada orden admite un descuento y conserva el importe al enviar el comprobante. Para cobrarlo por QR, usa un código bancario que permita ingresar el monto.

## Finanzas

**Admin → Finanzas** muestra cobros reales aprobados, pagos en revisión, descuentos e ingresos por curso y país. El período usa la fecha de aprobación o registro en hora de Bolivia. Puedes registrar gastos, comisiones y devoluciones ya realizadas, adjuntar comprobantes, anular movimientos y exportar el reporte a CSV o imprimirlo. Los importes se calculan por moneda.

## Rutas

- `/` — portada pública.
- `/admin` — entrada desde el candado.
- `/admin/login` — inicio de sesión.
- `/admin/dashboard` — editor protegido.
- `/?preview=1` — vista previa privada del borrador.
- `/#comunidad` — registro debajo de Subscripciones. Bolivia (+591) muestra un selector con los nueve departamentos. Los demás países muestran ciudades y permiten escribir otra. El permiso de contacto por WhatsApp es opcional.
- `/mi-espacio` — acceso, inscripción y aula del estudiante. `/academia` redirige a esta página.

Usa **Guardar borrador** para guardar una revisión privada, **Vista previa** para verla en la portada y **Publicar cambios** para actualizar la versión visible a todos los navegadores. Si el navegador conserva una edición del prototipo en la misma dirección, el dashboard ofrece recuperarla durante la primera configuración.

El menú del dashboard abre una pantalla por sección. **Textos** reúne el contenido editable, **Orden de secciones** cambia la posición de los bloques de la portada y **Configuración → Integraciones** reúne los ajustes de WAHA, PlugNmeet y los avisos. El cobro se realiza por QR manual. La pasarela de pago externa queda para una etapa posterior.

## Abrir inscripciones a un curso o evento

1. En **Cursos**, elige **Vivos**, **Especiales** o **Cursos**. Completa título, descripción, precio en Bs e instrucciones y sube el QR bancario. Para cada oferta nueva, sube una portada JPG, PNG o WebP de hasta 6 MB o elige una de la galería. Un curso puede tener hasta 24 capítulos reordenables, y un especial tiene una sola lección. Cada capítulo o lección admite texto y un video MP4 de hasta 64 MB. Para un vivo, ingresa el enlace HTTPS de la transmisión y configura la fecha y hora si corresponde.
2. Pulsa **Crear y publicar** o **Publicar y abrir inscripciones**. Las nuevas tarjetas aparecen en **Subscripciones** con la portada, el título, la descripción y el monto publicado. El estudiante paga por QR y adjunta obligatoriamente el comprobante en JPG, PNG, WebP o PDF de hasta 8 MB antes de enviar **¡Ya pagué!**.
3. En **Revisión de pagos**, abre el comprobante y comprueba el depósito y el monto en el banco. Al aprobarlo habilitas el curso o evento y queda registrado en el historial de esa compra. Si lo rechazas con un motivo, el estudiante puede adjuntar otro comprobante. En **Mi espacio** se muestra el estado y se pueden activar avisos del navegador.
4. Cerrar inscripciones impide crear órdenes nuevas. Las ya iniciadas conservan su precio y QR, y los pagos aprobados conservan el acceso a la lección publicada.

El cobro se realiza mediante el QR del titular. En desarrollo los archivos se guardan en la carpeta privada del servidor. En Cloudflare los videos, comprobantes y demás archivos subidos se guardan en R2. El acceso a cada video se valida en el Worker con la sesión y el pedido aprobado.

Para instalar las tres publicaciones de demostración en una instalación local, detén el servidor y ejecuta `node server.js --seed-demo` con FFmpeg disponible en `PATH`. Después inicia el servidor. Las demos aparecen en Subscripciones con un QR sin valor de pago y videos de muestra. Sus avisos se aprueban desde **Revisión de pagos** y sus importes quedan fuera de las métricas de ventas. Puedes ocultarlas con **Cerrar inscripciones**. El comando conserva las demos que ya existen.

Con las publicaciones demo ya creadas y el servidor detenido, `node server.js --seed-demo-student` prepara una cuenta de prueba con el curso por etapas y el especial aprobados, y el vivo en revisión. La contraseña se muestra al crear la cuenta.

En **Mi espacio**, **Avisos de inscripción** reúne la verificación, la aprobación y los rechazos. **Mis cursos** muestra los capítulos y especiales habilitados y destaca los vivos inscritos con su fecha y cuenta regresiva cuando están programados. Los videos alojados en la plataforma se reproducen con un enlace temporal ligado a la sesión y una marca de acceso personal. El reproductor oculta el control de descarga en navegadores compatibles, y la página deshabilita su propia API de captura de pantalla. La captura del sistema operativo y la reproducción en servicios externos dependen de esas plataformas.

### Correos de inscripción

Configura `RESEND_API_KEY` con una clave de envío de Resend e `IVANNA_EMAIL_FROM` con un remitente de un dominio verificado. Para los enlaces se usa `IVANNA_PUBLIC_ORIGIN`, salvo que se defina `IVANNA_SITE_URL`. Las compras reales generan un correo al recibir el comprobante y otro tras aprobar el pago. El panel muestra si cada aviso está en cola, si el proveedor lo aceptó o si falló el envío. Las demos se pueden verificar desde el sitio sin enviar correos externos.

### WhatsApp de revisión con WAHA

Cuando una persona adjunta un comprobante a una compra real, se guarda el pago en **Verificando comprobante** y se pone el aviso de WhatsApp en cola. El aviso lleva el nombre, el curso, el monto a verificar y un enlace al pago en el dashboard. Si está habilitado, adjunta el archivo. Cuando el servidor de WAHA rechaza el formato o carece de la operación de adjuntos, envía el enlace protegido. El estado de entrega se ve en **Revisión de pagos**. Admin valida el depósito y aprueba o rechaza el comprobante manualmente.

1. En Northflank crea un servicio a partir de la imagen oficial `devlikeapro/waha`. Selecciona una versión estable concreta y usa una réplica con volumen persistente en `/app/.sessions`.
2. En secretos del servicio configura `WAHA_API_KEY`, `WAHA_DASHBOARD_USERNAME`, `WAHA_DASHBOARD_PASSWORD`, `WHATSAPP_SWAGGER_USERNAME` y `WHATSAPP_SWAGGER_PASSWORD`. Usa el puerto HTTP interno 3000 detrás del ingreso HTTPS de Northflank. Si puedes restringir el acceso por IP estable o por encabezado en el ingreso, aplica la política en el servicio. WAHA usa el encabezado `X-Api-Key`.
3. Desde el dashboard de WAHA inicia la sesión `default` y escanea su QR con el WhatsApp que enviará los avisos. La cuenta de destino se configura por separado.
4. En **Admin → Configuración → Integraciones → WhatsApp · WAHA**, guarda el URL HTTPS, el nombre de sesión, la clave, el número destinatario con código de país y el origen del sitio. **Probar conexión** consulta el estado de la sesión. Habilita los avisos cuando la sesión figure conectada.

[Imagen oficial](https://github.com/devlikeapro/waha) · [Seguridad de WAHA](https://waha.devlike.pro/docs/how-to/security/) · [Persistencia de sesiones](https://waha.devlike.pro/docs/how-to/storages/) · [Despliegues en Northflank](https://northflank.com/docs/v1/application/run/run-an-image-from-a-container-registry) · [Políticas de acceso](https://northflank.com/docs/v1/application/network/add-security-policies-for-ports)

### Cursos en vivo y grabaciones con PlugNmeet

La conexión queda desactivada inicialmente. Cuando tengas el VPS, instala el servidor y habilita su grabador. En **Admin → Configuración → Integraciones → PlugNmeet**, guarda el servidor HTTPS, la clave y el secreto. Configura la URL del cliente si lo despliegas por separado y activa las preferencias de grabación de las salas nuevas.

En **Cursos → Vivos**, selecciona **PlugNmeet** y publica el vivo. El panel de ese vivo permite abrir la sala como moderador, consultar su estado, cerrarla y descargar las grabaciones procesadas. Las participantes con pago aprobado entran desde **Mi espacio** cuando la sala esté abierta. Después de editar una grabación, exporta el MP4 de hasta 64 MB por capítulo y súbelo desde **Cursos** o **Especiales**.

[Guía de instalación](https://www.plugnmeet.org/docs/installation) · [Cliente](https://github.com/mynaparrot/plugNmeet-client) · [Grabador](https://github.com/mynaparrot/plugNmeet-recorder)

## Reseñas de cursos

En **Mi espacio**, los capítulos con video se marcan como vistos al terminar de reproducirlos por completo. Las lecciones que solo tienen texto se pueden marcar como leídas. El avance se guarda por capítulo y el curso se finaliza cuando todos están vistos o leídos. Entonces se habilita la reseña de 1 a 5 estrellas. La reseña aparece debajo de **Cursos** tras aprobarla en **Dashboard → Moderar reseñas**, donde también se puede editar o eliminar.

En **Mi espacio → Mi perfil**, cada participante puede subir una foto JPG, PNG o WebP de hasta 5 MB y agregar sus usuarios de Instagram, TikTok, Facebook y YouTube. Los enlaces se crean automáticamente. Las reseñas aprobadas muestran el perfil actualizado, incluida la foto o el avatar genérico. Los perfiles públicos muestran el primer nombre y los datos que la persona agrega en este formulario.

Debajo del contenido de cada curso, las personas con acceso aprobado comparten un contador de corazones y pueden enviar comentarios. Cada cuenta puede añadir o quitar su propio corazón. Los comentarios se publican en el curso tras aprobarlos en **Dashboard → Comentarios de cursos**. Allí el administrador también puede ocultarlos.

## Verificación

```powershell
npm test
npm run build
npm run worker:check
```

## Antes de publicar en producción

### Cloudflare, Supabase y GitHub

El repositorio es [IVartist](https://github.com/sebastianferron/IVartist). **Pages** sirve los archivos públicos y enruta la API y las páginas protegidas al Worker `ivartist-api` mediante el binding `IVARTIST_API`. El navegador usa el mismo dominio para toda la aplicación. **Supabase** conserva cuentas, sesiones, cursos, pagos y configuración, por colección. El Worker serializa las operaciones y cada escritura en Supabase comprueba la revisión anterior para evitar sobreescribir cambios concurrentes. Las claves de WAHA, PlugNmeet y Web Push se cifran antes de guardarse. **R2** es privado y se accede a través del Worker.

1. En el proyecto Supabase dedicado a IVartist aplica el SQL de `supabase/migrations/` con el editor SQL o el CLI enlazado a ese proyecto. Habilita la API de datos. La migración concede acceso a las funciones de lectura y escritura únicamente al rol de servicio. Guarda la URL del proyecto y una clave `sb_secret_…` para el Worker.
2. En Cloudflare crea el bucket privado `ivartist-private-media`. Conserva `r2.dev` y el dominio público del bucket deshabilitados. La configuración de `cloudflare/wrangler.worker.jsonc` declara el bucket, un Durable Object y un disparador por minuto para los avisos.
3. Crea el Worker `ivartist-api` y configura `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `IVANNA_PUBLIC_ORIGIN` (el origen HTTPS exacto que usará Pages), `IVANNA_STATE_KEY` (32 bytes aleatorios en hexadecimal) e `IVANNA_ADMIN_ACCOUNT` (JSON privado con el hash del administrador, generado con `node server.js --set-superadmin nombre-de-usuario`). Genera la cuenta de producción con una contraseña propia. Puedes definir temporalmente `IVANNA_DATA_DIR` apuntando a una carpeta nueva para generar ese `admin.json` sin afectar la cuenta local. Conserva la clave de cifrado en un lugar seguro para poder restaurar las integraciones desde un respaldo.
4. Agrega `RESEND_API_KEY`, `IVANNA_EMAIL_FROM` e `IVANNA_PUSH_CONTACT`. En Cloudflare guarda esos valores y los anteriores como secretos o variables privadas del Worker. Despliega el Worker con `npx wrangler deploy --config cloudflare/wrangler.worker.jsonc`.
5. Conecta **Cloudflare Pages** al repositorio de GitHub y configura el comando de compilación `npm run build`, el directorio `dist` y el dominio cuyo origen guardaste en el Worker. El binding `IVARTIST_API` en `wrangler.jsonc` conecta Pages con el Worker. Mantén el Worker desplegado antes de publicar Pages.

La base de producción empieza vacía. Mantén el respaldo privado de la instalación local para preparar la migración de cuentas, pedidos y archivos cuando se defina el proyecto de destino. Evita publicar archivos de datos, claves, comprobantes y videos en GitHub.

[Pages Functions](https://developers.cloudflare.com/pages/functions/) · [R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) · [Claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys) · [Resend](https://resend.com/docs/api-reference/emails/send-email)

La fecha inicial del cronómetro (`15 de diciembre de 2026, 19:00`, zona `America/La_Paz`) es un valor de demostración porque no se proporcionó la fecha real del curso. Debe reemplazarse desde el panel antes del despliegue público.
