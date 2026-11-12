# Go Lunch — contrato de interfaz

## Dirección visual

Go Lunch es una herramienta operativa corporativa: debe sentirse clara,
confiable y rápida, no decorativa. La identidad se construye con azul marino,
azul Glovis, superficies blancas y fondos fríos. La firma aprobada es
`public/go-lunch.svg`; la interfaz recorta su isotipo cuando el espacio es
compacto. Glovis usa `public/glovis.svg` sobre superficies claras y
`public/glovis-white.svg` directamente sobre azul, sin placa ni padding.
Los PNG se conservan únicamente para favicons e íconos de instalación, donde
la compatibilidad del sistema operativo importa más que la escalabilidad. Esa
familia deriva sin redibujo de `assets/brand/go-lunch-3d.png`: el arte 3D
aprobado se conserva cuadrado, opaco y con su fondo blanco original.

La app usa la familia `public/icono-*` y el panel la familia `public/panel-*`.
Ambas muestran el mismo símbolo 3D para mantener continuidad entre pestañas,
accesos instalados y el Dock de macOS. La versión maestra del Dock es de
1024 px; las variantes de 16 a 512 px son reducciones directas del original.
Los demás originales autorizados, incluido el trazo monocromático, viven en
`assets/brand/` y no deben redibujarse desde CSS.

## Principios

- Una pantalla, una tarea principal. Las funciones administrativas se agrupan
  por contexto y las pruebas nunca compiten con la operación diaria.
- En móvil, la acción principal permanece accesible y el contenido puede crecer
  mediante scroll sin comprimir controles ni listas.
- Las zonas, turnos y horarios se muestran con nombres operativos, no con claves
  internas de base de datos.
- Los estados críticos se dicen con texto además de color: lista actualizada,
  lista guardada, falta lista de hoy, pendiente,
  entregado, cerrado, no verificado y fuera de zona.
- Los controles táctiles tienen al menos 44 px de alto y foco visible.
- Los cambios de apariencia deben conservar IDs, contratos de datos y la clase
  `.oculto` de las PWA existentes.

## Pedidos de cobertura

En Menú especial, el desplegable «Cambiar menú de esta fecha» mantiene separada la edición de un día de la publicación por periodo. Consulta el menú y la elegibilidad antes de habilitar las tres opciones; muestra el motivo cuando hoy, el historial o los pedidos impiden editar. Al guardar, el servidor vuelve a comprobar fecha futura, pedidos no cancelados y versión del menú, y separa el día sin cambiar las opciones vecinas. Un conflicto conserva lo escrito y pide consultar de nuevo. Solo administración guarda; gerente consulta.

La solicitud del supervisor se presenta como una lista de personas y alimentos,
no como una orden financiera. La pantalla muestra únicamente horario, menú,
zona, responsable y beneficiarios. Costos y acuerdos comerciales no aparecen.

El panel administrativo mantiene cuatro bloques: menú especial, supervisores
autorizados, solicitudes/producción y autorizaciones vigentes. En reparto, las
coberturas se distinguen visualmente, pero comparten el mismo patrón de escaneo
de las entregas regulares.

Los supervisores conservan su número y clave; pueden crear varios folios para hoy con turno, zona, responsable y hora propios. Altas, modificaciones y cancelaciones requieren al menos dos horas antes de la entrega, comprobadas por el reloj del servidor y la función transaccional de PostgreSQL. Un cambio de horario también debe respetar el límite del horario anterior. Mis pedidos de hoy muestra folios confirmados, entregados y cancelados. Cada empleado admite una cobertura por turno y día entre todos los supervisores y zonas; puede tener otra en el otro turno y su pedido regular.

El menú especial es compartido. El panel revisa cada 30 segundos y alerta por cada folio nuevo o modificado, mostrando turno, zona y hora; intenta imprimir solo ese folio y conserva la acción manual de respaldo. La confirmación de impresión se identifica por folio y revisión, de modo que un cambio con igual cantidad vuelve a avisar. La alarma solo se apaga cuando el operador confirma Comanda impresa. Los botones por folio conviven con los consolidados por turno.

## Crédito de desarrollo en la portada

La portada de identificación muestra «Desarrollado por» con el SVG original
`public/2j-logo.svg` de Double J Blacklabs. Se coloca en la esquina inferior
izquierda del escritorio; en móvil queda al pie de la portada con espacio
reservado, sin cubrir el formulario ni el acceso de supervisores. Solo aparece
en esa portada y conserva los colores y proporciones del archivo proporcionado.

El panel administrativo repite el crédito al pie de la barra lateral izquierda.
En escritorio la barra permanece visible al desplazar el contenido; en ventanas
bajas permite desplazamiento propio para mantener accesibles todas las opciones.
En móvil el crédito acompaña la fila de navegación horizontal.

## PWA y caché

Todo cambio dentro de `/public` debe acompañarse de un incremento de `VERSION`
en `public/sw.js`. Cualquier asset nuevo que deba funcionar sin señal se agrega
también a `PRECARGA`.

## Dashboard integrado

El total de comidas muestra el desglose de regulares y coberturas, incluidas extraordinarias vigentes. Los indicadores de empleados activos cuentan personas únicas; los de entrega cuentan comidas. Cada comida ocupa una fila que identifica empleado, servicio, folio y horario, de modo que una cobertura no sobrescriba un pedido regular. Se excluyen coberturas canceladas, se conserva el historial de empleados desactivados y las extraordinarias se califican contra su hora autorizada. El refresco de 30 segundos se mantiene.

Los indicadores se presentan en dos bloques con unidades explícitas: Comidas primero, con tarjetas Regulares, Coberturas, Total de comidas, Entregadas, Pendientes y No surtidas · Sin cargo; Empleados después, con Activos, Con pedido, Vieron sin pedir y No abrieron. Las tardías se muestran como subconjunto de las entregadas. En móvil, Regulares y Coberturas comparten fila, Total ocupa el ancho y Entregadas/Pendientes quedan juntas debajo.

## Etiquetas de reparto

Formato predeterminado horizontal de 200 × 62 mm: rollo Brother de 62 mm y corte de 200 mm. Los 110 mm adicionales quedan en blanco únicamente en el extremo izquierdo para cerrar recipientes de polipropileno. El bloque impreso de 90 × 62 mm conserva exactamente sus fuentes, márgenes interiores de 9 mm, distribución, QR de 32 mm, número de empleado y fecha. No se añade espacio al extremo derecho ni se amplía el contenido. La pestaña se usa para el cierre y el QR permanece sobre una cara plana del recipiente.

Las coberturas conservan su calibración física al 85 %, centrada dentro del bloque de 90 mm situado después de la pestaña izquierda. La escala del navegador es 100 % y el marco completo mide 200 × 62 mm, una sola página por etiqueta. El formato anterior de 90 × 62 mm permanece seleccionable, con su diseño y calibración previos.

## Grupo activo de reparto

La extensión de reparto guiado corresponde a v62 y conserva el mundo operativo, temas, logos y controles existentes; esta documentación no certifica despliegue. Hay un punto fijo oficial ASLA y otro REFIS. La captura directa de administración se hace desde un móvil físicamente en cada sitio; el flujo aprobado de propuestas para v63 permite que el repartidor capture allí y administración revise desde PC, como se describe abajo. GPS propone el punto y el horario sugiere el servicio de la agenda del día; las coberturas conservan folio y horario propios. Sin GPS o ante una sugerencia incorrecta, «Cambiar punto o servicio» permite selección manual entre las zonas autorizadas.

**Regla de servicio estable.** Punto, horario y cantidad pendiente preceden a «Comenzar entrega», que registra llegada y abre cámara o prepara el lector. Una vez iniciado, reloj y GPS no cambian el servicio activo. El cambio de punto o servicio requiere una acción explícita; «Finalizar reparto» cierra el escaneo sin marcar pendientes. No se ofrece «Entregar» en la lista ni cierre masivo al supervisor.

**Regla de una comida por confirmación.** Cámara y lector identifican cada paquete por QR. La captura por número de empleado se conserva como excepción de etiqueta dañada: muestra nombre, platillo, zona y horario, permite elegir entre varias coincidencias y confirma una comida específica. El método cámara/lector/manual queda auditado. Para paquetes regulares recibidos por supervisor se indica su nombre una vez y se escanea cada etiqueta; cobertura mantiene responsable por folio. La confirmación conserva el contexto individual de fecha, zona y turno. El servidor verifica la asignación almacenada y vuelve a comparar zona y turno al escribir; cada elemento de la cola conserva su grupo y los registros antiguos sin contexto permanecen para revisión, salvo confirmación previa del servidor.

**Regla de lista disponible.** La descarga de hoy reúne todas las zonas autorizadas, horarios, puntos y datos GPS disponibles para continuar sin señal. Los estados textuales «Lista actualizada», «Lista guardada» y «Falta lista de hoy» describen la disponibilidad de la jornada; una indicación de conexión del navegador por sí sola no garantiza actualización. Una lista de hoy guardada permite nuevas marcas sin conexión; una de ayer no. La cola conserva cada entrega aunque cambie el servicio o el día y nunca se borra para resolver errores. Cámara, GPS y sincronización requieren la app abierta y visible. Se conservan estilos y formatos carta de los impresos y el manual.

## Propuestas de puntos de entrega

Flujo aprobado para v63, pendiente de contrastar con la implementación terminada; no acredita despliegue. Extiende Reparto y puntos y Entrega dentro del estilo operativo existente, sin nuevos tokens ni cambios en los formatos carta. Se conserva la captura directa del administrador desde un móvil en el sitio como alternativa.

**Separación de propuesta y punto oficial.** «Enviar ubicación del punto» corresponde a una zona sin GPS oficial. El repartidor elige ASLA o REFIS estando en el sitio, concede permiso GPS, espera varias muestras con precisión de 25 m o menos y confirma la zona antes de enviar. La propuesta usa la identidad de su sesión habitual, incluido «Reparto general» en acceso legado, sin pedir ni inventar otro nombre. No crea un punto oficial ni registra comidas, llegadas o entregas. Los estados distinguen «Pendiente de subida» sin conexión y «Pendiente de aprobación» una vez enviada; se conserva la propuesta local para reintentar.

**Revisión antes de activar.** Gerente o administrador revisa desde PC, en Cocina → Reparto y puntos, identidad, zona, coordenadas GPS, precisión y hora. Aprobar crea el punto oficial con radio de 150 m únicamente si aún no existe; no sustituye uno ya oficial. Rechazar requiere motivo y una nueva captura del repartidor. Entrega utiliza el punto aprobado para detección automática después de actualizar su lista con señal; mientras tanto conserva la selección manual. El repartidor no modifica el punto oficial. La confirmación y los estados deben expresar esta diferencia con texto, dentro de los controles y tablas existentes.

## Selección de impresos de cocina

La tarjeta Impresión comparte fecha, turno (Todos/A/B) y zona (Todas/ASLA/REFIS) entre comanda y etiquetas. Los documentos identifican la selección y calculan sus cantidades después de filtrar los pedidos. Los tamaños de etiquetas y márgenes de impresión se conservan.

## Acceso de supervisores desde portada

El enlace a /cobertura.html está disponible tanto en la identificación como en el estado cerrado o sin menú del servicio regular. El corte regular no oculta la entrada de supervisores; la autorización, el menú de hoy y la anticipación de dos horas se verifican dentro de su propio flujo. No se ofrecen pedidos cuando ya no cabe una entrega con ese margen dentro del mismo día.

## Autorización de pedidos extraordinarios

En Coberturas, gerente o administrador conserva el registro extraordinario de hoy cuando haya ventana de preparación y entrega. El formulario pide personas y platillos del menú especial vigente, responsable, zona, turno, hora futura de entrega y motivo. Registra rol autorizador y hora del servidor, conserva folios entregados y usa una clave de reintento para evitar duplicaciones. La confirmación ofrece comanda y etiquetas del folio nuevo. Este permiso administrativo es independiente de la anticipación obligatoria de dos horas del supervisor. El consolidado identifica horarios programados y reparto conserva esa hora también sin señal.

La hora se captura como texto de 24 horas, con ejemplo 17:30 = 5:30 p. m., para evitar segmentos AM/PM incompletos en Safari. La validación del formulario identifica el campo en español, lo enfoca y lo desplaza al centro de la vista. Los errores conservan las filas y el resto de los datos; el servidor mantiene la validación de hora futura del mismo día.

## Checklist de salida

En Cocina → Impresión, el checklist comparte fecha, turno y zona con los demás impresos. Lista comidas regulares y coberturas existentes, con folio y horario propio, y separa cada lote por zona/turno en papel carta. Las hojas de continuación repiten identificación y se numeran; una sola firma y hora real de salida se capturan a mano al final de cada lote.

## Márgenes y paginación de impresos

Los documentos carta usan márgenes de 14 mm. Al imprimir, el checklist sigue flujo normal, sin altura mínima ni pie empujado con flex: Safari debe mantener conteo, continuación y firma dentro de su hoja. Listas y menús repiten cabeceras y evitan cortar filas. Las etiquetas en carta se distribuyen en filas de elementos indivisibles; el rollo conserva sus medidas y márgenes calibrados. Las comandas de 58 mm mantienen un área propia con margen vertical repetido de 2 mm.

## Orden del checklist por menú

Dentro de cada lote de turno y zona, el checklist agrupa por opción en el orden del menú y ordena por número de empleado de forma numérica, con nombre como desempate. Opción, número y nombre son las primeras columnas; horario y casilla quedan al final. Cada grupo muestra platillo original y total de la opción. La paginación reserva espacio para encabezados y nombres largos, conserva las continuaciones identificadas y una sola firma al final del lote.

## Reportes consolidados

Cocina, comanda general, etiquetas, checklist y los Excel usan la misma consulta de comidas regulares y coberturas vigentes, incluidas extraordinarias. Cada comida tiene identidad y estado propios; una misma persona puede aparecer varias veces. Los reportes separan Regulares, Coberturas y Total, con filtros de fecha, turno, zona y servicio. Los impresos de folio y las alarmas de supervisores permanecen disponibles para imprimir solo nuevos agregados.

Las extraordinarias usan la hora autorizada para preparación y puntualidad. Las calificaciones solo incluyen regulares, que son los que permiten encuesta. Facturación aplica temporalmente el mismo costo unitario a ambos servicios, decisión confirmada por Francisco el 7/nov/2026; muestra entregados y pendientes con cargo para conciliación y separa las incidencias sin cargo, excluidas de los servicios facturables y el subtotal pero conservadas en el detalle auditado. Un error de lectura de coberturas no se presenta como una lista completa. Los formatos de papel, QR y calibraciones físicas se conservan.

## Integridad de los folios de supervisor

Cada alta usa una clave de reintento para recuperar el mismo folio si se pierde la respuesta. Edición y cancelación se dirigen a un ID propio y comparan la versión leída; una sesión atrasada debe actualizar. Ningún folio con entregas iniciadas se modifica o cancela. Los empleados que permanecen en un folio editado conservan su QR; si cambia la preparación u horario, cocina sustituye los impresos previos por los actualizados. Las cancelaciones conservan el historial y liberan la asignación de cobertura. Las funciones anteriores quedan limitadas a folios legados y no sobrescriben lotes nuevos durante la transición.

## Reporte diario para el cliente

Extensión del mundo corporativo operativo existente: Dashboard comparte la fecha de servicio con «Reporte diario / PDF» y ofrece «Elaboró» opcional. El documento usa Arial local, papel carta vertical y márgenes de 14 mm; incrusta los SVG aprobados de Go Lunch y Glovis. Conserva blanco y tablas legibles, negro al imprimir y azul de marca en los controles de pantalla. En móvil, la hoja permite desplazamiento horizontal indicado sin ocultar los controles.

**Regla de conciliación por comida.** La primera hoja muestra seis indicadores: regulares solicitadas + coberturas solicitadas = total solicitado; entregadas + pendientes + no surtidas sin cargo = total solicitado. El detalle de entregas incluye únicamente entregas registradas sin incidencia, agrupadas por turno y zona, con número de empleado, nombre, platillo, servicio, folio cuando corresponde, hora prevista y entrega registrada. Cada comida conserva su identidad aunque la misma persona reciba varias; las extraordinarias muestran su propia hora autorizada. Cada grupo cierra con subtotal de regulares, coberturas y total; el cierre diario repite ese desglose de entregadas. Las continuaciones repiten marcas, fecha, generación, identificación del grupo y columnas; todas las hojas llevan numeración «Página n de N». «Elaboró» aparece solo si se captura; no se pide firma, porque el reporte se envía por correo.

Es una fotografía de los registros disponibles al generarlo: sincronizar primero los escáneres de reparto y regenerar si faltaban entregas. «Imprimir / Guardar PDF» abre el diálogo nativo: carta vertical, escala 100 % y encabezados/pies del navegador desactivados. El operador guarda el PDF y lo adjunta al correo.

La vista diaria reutiliza `ImpresionPanel.abrir`, igual que los menús y las listas. Se muestra dentro de la pestaña actual y conserva la sesión, la fecha y el desplazamiento del dashboard. «Volver al panel» permanece fuera del iframe de la hoja, disponible mientras se desplaza el reporte y excluido de la impresión. Se restaura el foco al botón que abrió la vista. Una respuesta cuya fecha ya no coincide con el selector se descarta antes de abrirla; los errores dejan al operador en el dashboard con un aviso.

La consulta `/api/reporte-entregas/:fecha` devuelve HTML con `no-store`, bajo autorización de admin o gerente; la clave viaja en `x-admin-key` y no se incorpora a la URL ni al documento imprimible/PDF. Reutiliza la consulta de comidas vigente y da prioridad a las incidencias sin cargo sobre cualquier marca previa de entrega.

## Incidencias sin cargo

Extensión del mundo operativo existente, con la misma paleta, tipografía, controles y tablas. Dashboard ofrece «Registrar no surtido» por comida regular o de cobertura a admin y gerente. El diálogo identifica fecha, empleado, platillo y folio cuando corresponde; presenta motivo obligatorio en una línea (5–500 caracteres), confirmación explícita de que cocina o reparto no surtió la comida, «Cancelar» y «Autorizar sin cargo». Si existe entrega registrada, advierte antes de autorizar. El foco inicial va al motivo, los errores aparecen dentro del diálogo y conservan el texto, y los controles se bloquean durante el registro. El rol procede de la sesión y la hora del servidor.

**Regla de incidencia visible.** El estado «No surtido · Sin cargo» se expresa con texto y fondo neutro, acompañado por motivo, rol y fecha/hora. Tiene prioridad sobre la entrega previa; esa marca se conserva y se identifica como «Marca previa rectificada». No se presenta como entrega pendiente ni como falta de recogida del empleado. Dashboard y PDF cuentan las incidencias por separado; producción conserva las solicitudes originales. Las incidencias se excluyen de entregadas, pendientes, no recogidos, merma por empleado, encuesta y puntualidad. Reparto no ofrece esas comidas; un escaneo atrasado no revierte la incidencia y un folio que la contiene no admite edición ni cancelación.

**Regla de conciliación sin cargo.** El PDF mantiene logos aprobados, carta vertical y márgenes de 14 mm. «Incidencias sin cargo» forma grupos por turno y zona, con empleado, platillo, servicio, folio cuando corresponde, motivo y autorización por rol/hora. Conserva cabeceras, continuaciones y numeración; los motivos largos crecen en las filas sin recortarse. El Excel de operación incluye «Incidencias_Sin_Cargo» y facturación conserva «Auditoria_Detalle» aun cuando excluye esas comidas del cargo. El manual indica regenerar y reemplazar ante RRHH cualquier PDF previamente enviado; la app no modifica nómina externa. Se mantiene la regla de cobro para quien realmente no recoge su comida; esta extensión no activa OTP ni WhatsApp.
